#!/usr/bin/env python3
"""
股票数据获取脚本（yfinance + AKShare）
供 Electron main 进程通过 child_process 调用

用法：
  # 历史 K 线（美股/A股，兼容旧调用方式）
  python3 scripts/yfinance_fetch.py <symbol> <start_date> <end_date>

  # A 股实时行情（多只，逗号分隔）
  python3 scripts/yfinance_fetch.py --action cn_quote --symbols 000001,600519

  # A 股搜索
  python3 scripts/yfinance_fetch.py --action cn_search --query 茅台

输出：
  成功：JSON 数组或对象
  失败：JSON 对象，包含 error 字段
"""

import sys
import json
import time
from datetime import datetime, timedelta

# ─── A 股全量数据进程级缓存 ─────────────────────────────────────────────────
_cn_spot_cache: list = []
_cn_spot_cache_time: float = 0.0
_CN_SPOT_CACHE_TTL: float = 30.0  # 缓存 30 秒


def _parse_spot_row(row) -> dict:
    """将 stock_zh_a_spot DataFrame 行解析为标准字段 dict"""
    raw_code = str(row["代码"])  # e.g. sh600519 / sz000001 / bj920000
    pure_code = raw_code[2:] if len(raw_code) > 6 else raw_code

    def safe_float(val, default=0.0):
        try:
            return float(val) if val is not None else default
        except (ValueError, TypeError):
            return default

    def safe_int(val, default=0):
        try:
            return int(val) if val is not None else default
        except (ValueError, TypeError):
            return default

    return {
        "code": pure_code,
        "name": str(row["名称"]),
        "price": safe_float(row["最新价"]),
        "change": safe_float(row["涨跌额"]),
        "change_percent": safe_float(row["涨跌幅"]),
        "open": safe_float(row["今开"]),
        "high": safe_float(row["最高"]),
        "low": safe_float(row["最低"]),
        "previous_close": safe_float(row["昨收"]),
        "volume": safe_int(row["成交量"]),
    }


def _load_cn_spot_via_spot() -> list:
    """通过 stock_zh_a_spot（新浪）拉取全量 A 股实时行情"""
    import akshare as ak
    df = ak.stock_zh_a_spot()
    return [_parse_spot_row(row) for _, row in df.iterrows()]


def _load_cn_spot() -> list:
    """
    拉取 A 股全量实时行情，带 30s 进程级缓存。
    降级链：stock_zh_a_spot → 抛出异常
    """
    global _cn_spot_cache, _cn_spot_cache_time

    now = time.time()
    if _cn_spot_cache and (now - _cn_spot_cache_time) < _CN_SPOT_CACHE_TTL:
        return _cn_spot_cache

    data = _load_cn_spot_via_spot()
    _cn_spot_cache = data
    _cn_spot_cache_time = now
    return data


def fetch_cn_quotes(symbols: list) -> list:
    """
    获取指定 A 股代码列表的实时行情。
    symbols: 纯 6 位数字代码列表，如 ['000001', '600519']
    返回 list of Quote-compatible dict
    """
    all_data = _load_cn_spot()
    symbol_set = set(symbols)
    now_ts = int(time.time())

    result = []
    for item in all_data:
        if item["code"] in symbol_set:
            result.append({
                "symbol": item["code"],
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

    return result


def search_cn_stocks(query: str) -> list:
    """
    从 A 股全量数据中模糊匹配代码或名称。
    返回 list of SearchResult-compatible dict（最多 10 条）
    """
    all_data = _load_cn_spot()
    query_lower = query.lower().strip()

    matches = []
    for item in all_data:
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


def fetch_history(symbol: str, start_date: str, end_date: str) -> list:
    """
    获取股票历史 K 线数据。
    A 股（纯 6 位数字）优先走 AKShare，其余走 yfinance。
    """
    is_cn_stock = symbol.isdigit() and len(symbol) == 6
    if is_cn_stock:
        return _fetch_history_akshare(symbol, start_date, end_date)
    else:
        return _fetch_history_yfinance(symbol, start_date, end_date)


def _fetch_history_akshare(symbol: str, start_date: str, end_date: str) -> list:
    """通过 AKShare stock_zh_a_hist 获取 A 股历史 K 线"""
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
            "open": round(float(row["开盘"]), 4),
            "high": round(float(row["最高"]), 4),
            "low": round(float(row["最低"]), 4),
            "close": round(float(row["收盘"]), 4),
            "volume": int(row["成交量"]),
            "source": "akshare",
        })

    return result


def _fetch_history_yfinance(symbol: str, start_date: str, end_date: str) -> list:
    """通过 yfinance 获取美股历史 K 线"""
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


def main():
    args = sys.argv[1:]

    # ── 新模式：--action 参数 ──────────────────────────────────────────────
    if args and args[0] == "--action":
        if len(args) < 2:
            print(json.dumps({"error": "missing_action"}))
            sys.exit(1)

        action = args[1]

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

        else:
            print(json.dumps({"error": f"unknown_action: {action}"}))
            sys.exit(1)

        return

    # ── 旧模式：历史 K 线（兼容原有调用方式）────────────────────────────────
    if len(args) < 3:
        print(json.dumps({"error": "Usage: yfinance_fetch.py <symbol> <start_date> <end_date>"}))
        sys.exit(1)

    symbol = args[0].strip()
    # A 股代码保持原始 6 位数字，美股代码转大写
    if not (symbol.isdigit() and len(symbol) == 6):
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
