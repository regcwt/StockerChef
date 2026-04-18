#!/usr/bin/env python3
"""
股票数据获取脚本（AKShare + yfinance 多数据源）
供 Electron main 进程通过 child_process 调用

数据源策略（参考 TradingAgents-CN providers 架构）：
  A 股实时行情  → AKShare stock_zh_a_spot()（新浪财经）+ 30s 缓存 + 指数退避重试
  港股实时行情  → AKShare stock_hk_spot()（新浪财经）+ 10min 缓存 + threading.Lock
  A 股历史 K 线 → AKShare stock_zh_a_hist()（东方财富）
  港股历史 K 线 → AKShare stock_hk_daily()（新浪财经）
  美股历史 K 线 → yfinance（降级备选）

用法：
  python3 scripts/yfinance_fetch.py --action cn_quote --symbols 000001,600519
  python3 scripts/yfinance_fetch.py --action cn_search --query 茅台
  python3 scripts/yfinance_fetch.py --action hk_quote --symbols 03690.HK,00700.HK
  python3 scripts/yfinance_fetch.py --action hk_search --query 美团
  python3 scripts/yfinance_fetch.py AAPL 2024-01-01 2024-04-01
"""

import sys
import json
import time
import threading
from datetime import datetime, timedelta

# ─── 工具函数 ────────────────────────────────────────────────────────────────

def safe_float(value, default=0.0):
    """安全转换为浮点数，None/空/NaN 返回 default"""
    try:
        if value is None or value == '':
            return default
        result = float(value)
        # NaN 检查
        if result != result:
            return default
        return result
    except (ValueError, TypeError):
        return default


def safe_int(value, default=0):
    """安全转换为整数"""
    try:
        if value is None or value == '':
            return default
        return int(float(value))
    except (ValueError, TypeError):
        return default


def normalize_hk_symbol(symbol: str) -> str:
    """
    标准化港股代码：03690.HK → 03690（5位数字）
    yfinance 格式（03690.HK）→ AKShare 格式（03690）
    """
    upper = symbol.upper().strip()
    if upper.endswith('.HK'):
        code = upper[:-3]  # 去掉 .HK
        return code.zfill(5)  # 补全前导零到 5 位
    return upper.zfill(5)


# ─── A 股股票列表缓存（进程级，5min TTL，用于搜索）────────────────────────
# 使用 stock_info_a_code_name()，比 stock_zh_a_spot() 更稳定（不受反爬影响）

_cn_list_cache: list = []
_cn_list_cache_time: float = 0.0
_CN_LIST_CACHE_TTL: float = 300.0  # 5 分钟


def load_cn_stock_list() -> list:
    """
    获取 A 股全量股票列表（代码 + 名称），用于搜索。
    数据源：ak.stock_info_a_code_name()，稳定不受反爬影响。
    """
    global _cn_list_cache, _cn_list_cache_time
    now = time.time()
    if _cn_list_cache and (now - _cn_list_cache_time) < _CN_LIST_CACHE_TTL:
        return _cn_list_cache

    import akshare as ak
    df = ak.stock_info_a_code_name()
    result = [
        {"code": str(row["code"]), "name": str(row["name"])}
        for _, row in df.iterrows()
    ]
    _cn_list_cache = result
    _cn_list_cache_time = now
    return result


def _fetch_cn_quote_via_hist(symbol: str) -> dict:
    """
    获取单只 A 股的实时行情（取最近 5 个交易日历史数据的最新一条）。
    数据源：ak.stock_zh_a_hist()（东方财富），比 stock_zh_a_spot() 更稳定。
    带指数退避重试（最多 3 次），参考 TradingAgents-CN AKShareProvider 的重试机制。
    """
    import akshare as ak
    from datetime import datetime, timedelta

    today = datetime.now().strftime('%Y%m%d')
    start = (datetime.now() - timedelta(days=7)).strftime('%Y%m%d')

    max_retries = 3
    retry_delay = 1.0

    for attempt in range(max_retries):
        try:
            df = ak.stock_zh_a_hist(
                symbol=symbol,
                period="daily",
                start_date=start,
                end_date=today,
                adjust="",
            )
            if df is None or df.empty:
                return {}

            latest = df.iloc[-1]
            close = safe_float(latest["收盘"])
            prev_close = safe_float(df.iloc[-2]["收盘"]) if len(df) >= 2 else close
            change = round(close - prev_close, 4)
            change_pct = round((change / prev_close * 100) if prev_close else 0, 4)

            return {
                "code": symbol,
                "name": str(latest.get("股票代码", symbol)),
                "price": close,
                "change": safe_float(latest.get("涨跌额", change)),
                "change_percent": safe_float(latest.get("涨跌幅", change_pct)),
                "open": safe_float(latest["开盘"]),
                "high": safe_float(latest["最高"]),
                "low": safe_float(latest["最低"]),
                "previous_close": prev_close,
                "volume": safe_int(latest["成交量"]),
            }
        except Exception as err:
            if attempt < max_retries - 1:
                print(f"[AKShare] A股{symbol}行情第{attempt+1}次获取失败: {err}，{retry_delay:.0f}s后重试", file=sys.stderr)
                time.sleep(retry_delay)
                retry_delay *= 2
            else:
                raise RuntimeError(f"A股{symbol}行情获取失败（已重试{max_retries}次）: {err}")


# ─── 港股全量数据缓存（进程级，10min TTL + threading.Lock）─────────────────
# 参考 TradingAgents-CN improved_hk.py 的缓存 + 线程锁策略

_hk_spot_cache_data = None
_hk_spot_cache_time: float = 0.0
_HK_SPOT_CACHE_TTL: float = 600.0  # 10 分钟
_hk_spot_lock = threading.Lock()


def load_hk_spot() -> list:
    """
    获取港股全量实时行情（带 10min 缓存 + threading.Lock 防并发重复调用）。
    参考 TradingAgents-CN improved_hk.py 的 _akshare_hk_spot_lock 策略。
    数据源：ak.stock_hk_spot()（新浪财经实时行情）。
    若接口失败，返回空列表（由调用方降级为 stock_hk_daily）。
    """
    global _hk_spot_cache_data, _hk_spot_cache_time

    # 快速路径：缓存有效时无需加锁
    now = time.time()
    if _hk_spot_cache_data is not None and (now - _hk_spot_cache_time) < _HK_SPOT_CACHE_TTL:
        return _hk_spot_cache_data

    # 缓存过期，加锁后再次检查（防止多线程重复拉取）
    # timeout=3：stock_hk_spot 已知可能不可用，快速失败后降级 stock_hk_daily
    acquired = _hk_spot_lock.acquire(timeout=3)
    if not acquired:
        print("[AKShare] 港股行情缓存锁等待超时，跳过", file=sys.stderr)
        return _hk_spot_cache_data or []

    try:
        # 获取锁后再次检查缓存（可能已被其他线程更新）
        now = time.time()
        if _hk_spot_cache_data is not None and (now - _hk_spot_cache_time) < _HK_SPOT_CACHE_TTL:
            return _hk_spot_cache_data

        import akshare as ak
        df = ak.stock_hk_spot()

        # 字段：代码/中文名称/最新价/涨跌额/涨跌幅/昨收/今开/最高/最低/成交量/成交额
        result = []
        for _, row in df.iterrows():
            code = str(row["代码"]).zfill(5)  # 确保 5 位，如 03690
            result.append({
                "code": code,
                "name": str(row.get("中文名称", "")),
                "price": safe_float(row.get("最新价")),
                "change": safe_float(row.get("涨跌额")),
                "change_percent": safe_float(row.get("涨跌幅")),
                "open": safe_float(row.get("今开")),
                "high": safe_float(row.get("最高")),
                "low": safe_float(row.get("最低")),
                "previous_close": safe_float(row.get("昨收")),
                "volume": safe_int(row.get("成交量")),
            })

        _hk_spot_cache_data = result
        _hk_spot_cache_time = time.time()
        print(f"[AKShare] 港股行情缓存更新：{len(result)} 只", file=sys.stderr)
        return result
    except Exception as err:
        print(f"[AKShare] stock_hk_spot 失败: {err}", file=sys.stderr)
        return _hk_spot_cache_data or []
    finally:
        _hk_spot_lock.release()

# ─── A 股接口 ────────────────────────────────────────────────────────────────

def fetch_cn_quotes(symbols: list) -> list:
    """
    获取指定 A 股代码列表的实时行情。
    数据源：ak.stock_zh_a_hist()（东方财富），逐只并发获取最新一天数据。
    symbols: 纯 6 位数字代码列表，如 ['000001', '600519']
    """
    now_ts = int(time.time())
    # 从股票列表缓存中获取名称映射
    stock_list = load_cn_stock_list()
    name_map = {item["code"]: item["name"] for item in stock_list}

    result = []
    for symbol in symbols:
        try:
            quote = _fetch_cn_quote_via_hist(symbol)
            if quote:
                result.append({
                    "symbol": symbol,
                    "name": name_map.get(symbol, quote.get("name", symbol)),
                    "price": quote["price"],
                    "change": quote["change"],
                    "changePercent": quote["change_percent"],
                    "open": quote["open"],
                    "high": quote["high"],
                    "low": quote["low"],
                    "previousClose": quote["previous_close"],
                    "volume": quote["volume"],
                    "timestamp": now_ts,
                })
        except Exception as err:
            print(f"[AKShare] 跳过 {symbol}，获取失败: {err}", file=sys.stderr)
    return result


def search_cn_stocks(query: str) -> list:
    """
    从 A 股股票列表中模糊匹配代码或名称（最多 10 条）。
    数据源：ak.stock_info_a_code_name()，稳定不受反爬影响。
    """
    stock_list = load_cn_stock_list()
    query_lower = query.lower().strip()

    matches = []
    for item in stock_list:
        code = item["code"]
        name = item["name"]
        if code.startswith(query_lower) or query_lower in name.lower():
            matches.append({
                "symbol": code,
                "displaySymbol": code,
                "description": name,
                "type": "A股",
            })
        if len(matches) >= 10:
            break
    return matches


# ─── 港股接口 ────────────────────────────────────────────────────────────────

def _fetch_hk_single_via_daily(symbol: str) -> dict:
    """
    降级方案：通过 stock_hk_daily（新浪财经历史接口）取最新一条作为实时行情。
    在 stock_hk_spot 失败时使用。
    """
    import akshare as ak
    import pandas as pd
    from datetime import datetime, timedelta

    normalized = normalize_hk_symbol(symbol)
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=10)).strftime('%Y-%m-%d')

    df = ak.stock_hk_daily(symbol=normalized, adjust="")
    if df is None or df.empty:
        return {}

    df['date'] = pd.to_datetime(df['date'])
    df = df[df['date'] <= end_date].sort_values('date')
    if df.empty:
        return {}

    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) >= 2 else latest
    close = safe_float(latest.get("close"))
    prev_close = safe_float(prev.get("close"))
    change = round(close - prev_close, 4)
    change_pct = round((change / prev_close * 100) if prev_close else 0, 4)

    return {
        "code": normalized,
        "price": close,
        "change": change,
        "change_percent": change_pct,
        "open": safe_float(latest.get("open")),
        "high": safe_float(latest.get("high")),
        "low": safe_float(latest.get("low")),
        "previous_close": prev_close,
        "volume": safe_int(latest.get("volume")),
    }


def fetch_hk_quotes(symbols: list) -> list:
    """
    获取指定港股代码列表的实时行情。
    symbols: yfinance 格式，如 ['03690.HK', '00700.HK']
    主数据源：ak.stock_hk_spot()（新浪财经实时行情，10min 缓存）
    降级方案：ak.stock_hk_daily() 取最新一条（stock_hk_spot 失败时）
    """
    # 将输入代码标准化为 5 位数字（AKShare 格式）
    symbol_map = {}  # 5位代码 → 原始 symbol（含 .HK）
    for sym in symbols:
        normalized = normalize_hk_symbol(sym)
        symbol_map[normalized] = sym

    now_ts = int(time.time())
    result = []

    # 尝试从 stock_hk_spot 全量缓存中查找
    spot_data = load_hk_spot()
    found_codes = set()
    for item in spot_data:
        if item["code"] in symbol_map:
            original_symbol = symbol_map[item["code"]]
            found_codes.add(item["code"])
            result.append({
                "symbol": original_symbol,
                "name": item["name"],
                "price": item["price"],
                "change": item["change"],
                "changePercent": item["change_percent"],
                "open": item["open"],
                "high": item["high"],
                "low": item["low"],
                "previousClose": item["previous_close"],
                "volume": item["volume"],
                "timestamp": now_ts,
            })

    # 对 stock_hk_spot 中未找到的代码，降级为 stock_hk_daily
    missing_codes = set(symbol_map.keys()) - found_codes
    for code in missing_codes:
        original_symbol = symbol_map[code]
        try:
            print(f"[AKShare] {original_symbol} 未在 stock_hk_spot 中找到，降级为 stock_hk_daily", file=sys.stderr)
            quote = _fetch_hk_single_via_daily(original_symbol)
            if quote:
                result.append({
                    "symbol": original_symbol,
                    "name": original_symbol,  # 降级时无法获取中文名
                    "price": quote["price"],
                    "change": quote["change"],
                    "changePercent": quote["change_percent"],
                    "open": quote["open"],
                    "high": quote["high"],
                    "low": quote["low"],
                    "previousClose": quote["previous_close"],
                    "volume": quote["volume"],
                    "timestamp": now_ts,
                })
        except Exception as err:
            print(f"[AKShare] {original_symbol} 降级获取也失败: {err}", file=sys.stderr)

    return result


def search_hk_stocks(query: str) -> list:
    """
    从港股全量数据中模糊匹配代码或名称（最多 10 条）。
    """
    all_data = load_hk_spot()
    query_lower = query.lower().strip()

    matches = []
    for item in all_data:
        code = item["code"]
        name = item["name"]
        # 代码前缀匹配 或 名称包含关键词
        if code.startswith(query_lower) or query_lower in name.lower():
            # 转换为 yfinance 格式（05位数字.HK）
            hk_symbol = code + ".HK"
            matches.append({
                "symbol": hk_symbol,
                "displaySymbol": hk_symbol,
                "description": name,
                "type": "港股",
            })
        if len(matches) >= 10:
            break
    return matches


# ─── 历史 K 线 ───────────────────────────────────────────────────────────────

def fetch_history(symbol: str, start_date: str, end_date: str) -> list:
    """
    获取股票历史 K 线数据。
    路由规则：
      - 纯 6 位数字 → A 股（AKShare stock_zh_a_hist）
      - XXXXX.HK 格式 → 港股（AKShare stock_hk_daily）
      - 其他 → 美股（yfinance）
    """
    if symbol.isdigit() and len(symbol) == 6:
        return _fetch_history_cn(symbol, start_date, end_date)
    elif symbol.upper().endswith('.HK'):
        return _fetch_history_hk(symbol, start_date, end_date)
    else:
        return _fetch_history_us(symbol, start_date, end_date)


def _fetch_history_cn(symbol: str, start_date: str, end_date: str) -> list:
    """A 股历史 K 线（AKShare stock_zh_a_hist，东方财富）"""
    import akshare as ak

    start_fmt = start_date.replace("-", "")
    end_fmt = end_date.replace("-", "")

    df = ak.stock_zh_a_hist(
        symbol=symbol,
        period="daily",
        start_date=start_fmt,
        end_date=end_fmt,
        adjust="",  # 不复权
    )

    if df is None or df.empty:
        return []

    result = []
    for _, row in df.iterrows():
        result.append({
            "date": str(row["日期"]),
            "open": round(safe_float(row["开盘"]), 4),
            "high": round(safe_float(row["最高"]), 4),
            "low": round(safe_float(row["最低"]), 4),
            "close": round(safe_float(row["收盘"]), 4),
            "volume": safe_int(row["成交量"]),
            "source": "akshare",
        })
    return result


def _fetch_history_hk(symbol: str, start_date: str, end_date: str) -> list:
    """
    港股历史 K 线（AKShare stock_hk_daily，新浪财经）。
    参考 TradingAgents-CN improved_hk.py 的 get_hk_stock_data_akshare 实现。
    """
    import akshare as ak
    import pandas as pd

    normalized = normalize_hk_symbol(symbol)  # 03690.HK → 03690

    df = ak.stock_hk_daily(symbol=normalized, adjust="")

    if df is None or df.empty:
        return []

    # 过滤日期范围
    df['date'] = pd.to_datetime(df['date'])
    mask = (df['date'] >= start_date) & (df['date'] <= end_date)
    df = df.loc[mask]

    if df.empty:
        return []

    result = []
    for _, row in df.iterrows():
        result.append({
            "date": row['date'].strftime('%Y-%m-%d'),
            "open": round(safe_float(row.get("open")), 4),
            "high": round(safe_float(row.get("high")), 4),
            "low": round(safe_float(row.get("low")), 4),
            "close": round(safe_float(row.get("close")), 4),
            "volume": safe_int(row.get("volume")),
            "source": "akshare",
        })
    return result


def _fetch_history_us(symbol: str, start_date: str, end_date: str) -> list:
    """美股历史 K 线（yfinance）"""
    import yfinance as yf

    end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
    end_date_exclusive = end_dt.strftime("%Y-%m-%d")

    ticker = yf.Ticker(symbol)
    hist = ticker.history(
        start=start_date,
        end=end_date_exclusive,
        auto_adjust=True,
        actions=False,
    )

    if hist is None or hist.empty:
        return []

    result = []
    for date_index, row in hist.iterrows():
        result.append({
            "date": date_index.strftime("%Y-%m-%d"),
            "open": round(float(row["Open"]), 4),
            "high": round(float(row["High"]), 4),
            "low": round(float(row["Low"]), 4),
            "close": round(float(row["Close"]), 4),
            "volume": int(row["Volume"]),
            "source": "yfinance",
        })
    return result


# ─── 主入口 ──────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]

    # ── 新模式：--action 参数 ──────────────────────────────────────────────
    if args and args[0] == "--action":
        if len(args) < 2:
            print(json.dumps({"error": "missing_action"}))
            sys.exit(1)

        action = args[1]

        # ── A 股实时行情 ──────────────────────────────────────────────────
        if action == "cn_quote":
            try:
                symbols_idx = args.index("--symbols")
                symbols_str = args[symbols_idx + 1]
            except (ValueError, IndexError):
                print(json.dumps({"error": "missing --symbols parameter"}))
                sys.exit(1)

            symbols = [s.strip() for s in symbols_str.split(",") if s.strip()]
            try:
                data = fetch_cn_quotes(symbols)
                print(json.dumps(data, ensure_ascii=False))
            except Exception as err:
                print(json.dumps({"error": "fetch_failed", "message": str(err)}))
                sys.exit(1)

        # ── A 股搜索 ──────────────────────────────────────────────────────
        elif action == "cn_search":
            try:
                query_idx = args.index("--query")
                query = args[query_idx + 1]
            except (ValueError, IndexError):
                print(json.dumps({"error": "missing --query parameter"}))
                sys.exit(1)

            try:
                data = search_cn_stocks(query)
                print(json.dumps(data, ensure_ascii=False))
            except Exception as err:
                print(json.dumps({"error": "fetch_failed", "message": str(err)}))
                sys.exit(1)

        # ── 港股实时行情 ──────────────────────────────────────────────────
        elif action == "hk_quote":
            try:
                symbols_idx = args.index("--symbols")
                symbols_str = args[symbols_idx + 1]
            except (ValueError, IndexError):
                print(json.dumps({"error": "missing --symbols parameter"}))
                sys.exit(1)

            symbols = [s.strip() for s in symbols_str.split(",") if s.strip()]
            try:
                data = fetch_hk_quotes(symbols)
                print(json.dumps(data, ensure_ascii=False))
            except Exception as err:
                print(json.dumps({"error": "fetch_failed", "message": str(err)}))
                sys.exit(1)

        # ── 港股搜索 ──────────────────────────────────────────────────────
        elif action == "hk_search":
            try:
                query_idx = args.index("--query")
                query = args[query_idx + 1]
            except (ValueError, IndexError):
                print(json.dumps({"error": "missing --query parameter"}))
                sys.exit(1)

            try:
                data = search_hk_stocks(query)
                print(json.dumps(data, ensure_ascii=False))
            except Exception as err:
                print(json.dumps({"error": "fetch_failed", "message": str(err)}))
                sys.exit(1)

        else:
            print(json.dumps({"error": f"unknown_action: {action}"}))
            sys.exit(1)

        return

    # ── 旧模式：历史 K 线（兼容原有调用方式）────────────────────────────────
    if len(args) < 3:
        print(json.dumps({"error": "Usage: yfinance_fetch.py <symbol> <start_date> <end_date>"}))
        sys.exit(1)

    symbol = args[0].strip()
    # A 股代码保持原始 6 位数字，港股保持 XXXXX.HK，美股转大写
    if not (symbol.isdigit() and len(symbol) == 6) and not symbol.upper().endswith('.HK'):
        symbol = symbol.upper()

    start_date = args[1].strip()
    end_date = args[2].strip()

    try:
        data = fetch_history(symbol, start_date, end_date)
        print(json.dumps(data, ensure_ascii=False))
    except Exception as err:
        error_message = str(err)
        if "RateLimit" in error_message or "Too Many Requests" in error_message:
            print(json.dumps({"error": "rate_limited", "message": error_message}))
        else:
            print(json.dumps({"error": "fetch_failed", "message": error_message}))
        sys.exit(1)


if __name__ == "__main__":
    main()
