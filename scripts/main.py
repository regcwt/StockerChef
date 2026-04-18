#!/usr/bin/env python3
"""
StockerChef 数据获取统一入口

供 Electron main 进程通过 child_process 调用。
基于 providers/ 包的多 Provider 架构，每个市场独立管理数据源。

Provider 优先级由调用方通过 --cn-providers / --hk-providers / --us-providers 参数控制，
默认值与 Settings.tsx 中的 DEFAULT_*_PROVIDERS 保持一致：
  A 股：tushare,akshare
  港股：akshare_hk
  美股：finnhub,yfinance

用法（--action 模式）：
  python3 scripts/main.py --action cn_quote --symbols 000001,600519 \\
      [--cn-providers tushare,akshare] [--tushare-token TOKEN]
  python3 scripts/main.py --action cn_search --query 茅台 \\
      [--cn-providers tushare,akshare] [--tushare-token TOKEN]
  python3 scripts/main.py --action hk_quote --symbols 03690.HK,00700.HK \\
      [--hk-providers akshare_hk]
  python3 scripts/main.py --action hk_search --query 美团
  python3 scripts/main.py --action us_quote --symbols AAPL,TSLA \\
      [--us-providers finnhub,yfinance]

用法（历史 K 线模式，兼容旧调用）：
  python3 scripts/main.py <symbol> <start_date> <end_date> \\
      [--cn-providers tushare,akshare] [--tushare-token TOKEN]
"""

import sys
import json
import argparse
import os

# 将 scripts/ 目录加入 Python 路径，确保 providers 包可被导入
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from providers import (
    CnAKShareProvider,
    CnTushareProvider,
    HkAKShareProvider,
    UsYFinanceProvider,
    QuoteData,
    HistoricalBar,
    SearchResult,
)


# ── 序列化辅助 ────────────────────────────────────────────────────────────────

def quote_to_dict(q: QuoteData) -> dict:
    return {
        "symbol": q.symbol,
        "name": q.name,
        "price": q.price,
        "change": q.change,
        "changePercent": q.change_percent,
        "open": q.open,
        "high": q.high,
        "low": q.low,
        "previousClose": q.previous_close,
        "volume": q.volume,
        "timestamp": q.timestamp,
    }


def bar_to_dict(b: HistoricalBar) -> dict:
    return {
        "date": b.date,
        "open": b.open,
        "high": b.high,
        "low": b.low,
        "close": b.close,
        "volume": b.volume,
        "source": b.source,
    }


def search_to_dict(s: SearchResult) -> dict:
    return {
        "symbol": s.symbol,
        "displaySymbol": s.display_symbol,
        "description": s.description,
        "type": s.market_type,
    }


# ── Provider 工厂（按优先级列表构建 provider 链）────────────────────────────

def _make_cn_provider(provider_id: str, tushare_token: str | None):
    """根据 provider_id 构建 A 股 Provider 实例，不可用时返回 None。"""
    if provider_id == 'tushare':
        if not tushare_token:
            return None
        p = CnTushareProvider(token=tushare_token)
        return p if p.is_available() else None
    if provider_id == 'akshare':
        return CnAKShareProvider()
    return None

def _make_hk_provider(provider_id: str):
    """根据 provider_id 构建港股 Provider 实例，不可用时返回 None。"""
    if provider_id in ('akshare_hk', 'akshare'):
        return HkAKShareProvider()
    return None

def _make_us_provider(provider_id: str):
    """根据 provider_id 构建美股 Provider 实例，不可用时返回 None。"""
    if provider_id == 'yfinance':
        return UsYFinanceProvider()
    return None

# ── Action 处理函数 ───────────────────────────────────────────────────────────

def handle_cn_quote(
    symbols: list[str],
    cn_providers: list[str],
    tushare_token: str | None,
) -> list[dict]:
    """
    按优先级顺序尝试各 A 股 Provider，第一个返回非空结果的为准。
    若所有 provider 均失败，返回空列表。

    注意：AKShare 内部使用 tqdm 进度条，默认输出到 stdout，会污染 JSON 输出。
    通过临时将 sys.stdout 重定向到 sys.stderr，确保 stdout 只有纯 JSON。
    """
    _real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        for provider_id in cn_providers:
            provider = _make_cn_provider(provider_id, tushare_token)
            if provider is None:
                continue
            try:
                quotes = provider.get_quotes(symbols)
                if quotes:
                    print(f"[CN Quote] 使用 {provider_id}", file=sys.stderr)
                    return [quote_to_dict(q) for q in quotes]
            except Exception as err:
                print(f"[CN Quote] {provider_id} 失败: {err}，尝试下一个", file=sys.stderr)
        return []
    finally:
        sys.stdout = _real_stdout

def handle_cn_search(
    query: str,
    cn_providers: list[str],
    tushare_token: str | None,
) -> list[dict]:
    """
    按优先级顺序搜索 A 股，第一个返回非空结果的为准。

    注意：AKShare 内部使用 tqdm 进度条，默认输出到 stdout，会污染 JSON 输出。
    通过临时将 sys.stdout 重定向到 sys.stderr，确保 stdout 只有纯 JSON。
    """
    _real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        for provider_id in cn_providers:
            provider = _make_cn_provider(provider_id, tushare_token)
            if provider is None:
                continue
            try:
                results = provider.search(query)
                if results:
                    print(f"[CN Search] 使用 {provider_id}", file=sys.stderr)
                    return [search_to_dict(s) for s in results]
            except Exception as err:
                print(f"[CN Search] {provider_id} 失败: {err}，尝试下一个", file=sys.stderr)
        return []
    finally:
        sys.stdout = _real_stdout

def handle_hk_quote(symbols: list[str], hk_providers: list[str]) -> list[dict]:
    """
    按优先级顺序获取港股行情，第一个返回非空结果的为准。

    注意：AKShare 内部使用 tqdm 进度条，默认输出到 stdout，会污染 JSON 输出。
    通过临时将 sys.stdout 重定向到 sys.stderr，确保 stdout 只有纯 JSON。
    """
    _real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        for provider_id in hk_providers:
            provider = _make_hk_provider(provider_id)
            if provider is None:
                continue
            try:
                quotes = provider.get_quotes(symbols)
                if quotes:
                    print(f"[HK Quote] 使用 {provider_id}", file=sys.stderr)
                    return [quote_to_dict(q) for q in quotes]
            except Exception as err:
                print(f"[HK Quote] {provider_id} 失败: {err}，尝试下一个", file=sys.stderr)
        return []
    finally:
        sys.stdout = _real_stdout

def handle_hk_search(query: str, hk_providers: list[str]) -> list[dict]:
    """
    按优先级顺序搜索港股，第一个返回非空结果的为准。

    注意：AKShare 内部使用 tqdm 进度条，默认输出到 stdout，会污染 JSON 输出。
    通过临时将 sys.stdout 重定向到 sys.stderr，确保 stdout 只有纯 JSON。
    """
    _real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        for provider_id in hk_providers:
            provider = _make_hk_provider(provider_id)
            if provider is None:
                continue
            try:
                results = provider.search(query)
                if results:
                    return [search_to_dict(s) for s in results]
            except Exception as err:
                print(f"[HK Search] {provider_id} 失败: {err}，尝试下一个", file=sys.stderr)
        return []
    finally:
        sys.stdout = _real_stdout

def handle_us_quote(symbols: list[str], us_providers: list[str]) -> list[dict]:
    """
    按优先级顺序获取美股行情，第一个返回非空结果的为准。

    注意：yfinance 等库可能输出到 stdout，通过临时重定向确保 JSON 纯净。
    """
    _real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        for provider_id in us_providers:
            provider = _make_us_provider(provider_id)
            if provider is None:
                continue
            try:
                quotes = provider.get_quotes(symbols)
                if quotes:
                    print(f"[US Quote] 使用 {provider_id}", file=sys.stderr)
                    return [quote_to_dict(q) for q in quotes]
            except Exception as err:
                print(f"[US Quote] {provider_id} 失败: {err}，尝试下一个", file=sys.stderr)
        return []
    finally:
        sys.stdout = _real_stdout

def handle_get_indices() -> list[dict]:
    """
    获取关键指数行情：
      - A 股指数（上证、科创综指）→ AKShare stock_zh_index_daily
      - 港股指数（恒生、恒生科技）→ AKShare stock_hk_index_spot_sina
      - 美股指数（纳斯达克、标普）→ AKShare index_us_stock_sina（取最近两日对比）
    
    注意：AKShare 内部使用 tqdm 进度条，默认输出到 stdout，会污染 JSON 输出。
    通过临时将 sys.stdout 重定向到 sys.stderr，确保 stdout 只有纯 JSON。
    """
    import akshare as ak
    import sys

    print("[INDICES DEBUG] Starting handle_get_indices()", file=sys.stderr)

    # 将 stdout 临时重定向到 stderr，防止 AKShare 内部的 tqdm 进度条污染 JSON 输出
    # 必须用 try/finally 确保 stdout 一定被恢复，否则后续的 print(json.dumps(...)) 也会丢失
    _real_stdout = sys.stdout
    sys.stdout = sys.stderr

    results = []

    def _parse_row(r: dict, symbol: str, name: str) -> dict | None:
        """从新浪指数行情行解析为统一格式，直接使用涨跌额/涨跌幅字段"""
        try:
            print(f"[INDICES DEBUG] _parse_row input: {r}", file=sys.stderr)
            price = float(r.get("最新价", 0) or 0)
            change = float(r.get("涨跌额", 0) or 0)
            change_pct = float(r.get("涨跌幅", 0) or 0)
            result = {
                "symbol": symbol,
                "name": name,
                "price": round(price, 2),
                "change": round(change, 2),
                "changePercent": round(change_pct, 2),
            }
            print(f"[INDICES DEBUG] _parse_row output: {result}", file=sys.stderr)
            return result
        except Exception as e:
            print(f"[INDICES DEBUG] _parse_row failed: {e}", file=sys.stderr)
            return None

    try:
        # ── A 股指数（上证、科创综指）────────────────────────────────────────
        # stock_zh_index_daily 取最近两日日线数据计算涨跌（更稳定）
        print("[INDICES DEBUG] Fetching A-share indices...", file=sys.stderr)
        cn_index_map = {
            "sh000001": ("上证指数", "000001.SH"),
            "sh000688": ("科创综指", "000688.SH"),
        }
        for sina_code, (name, symbol) in cn_index_map.items():
            try:
                print(f"[INDICES DEBUG] Fetching {sina_code} ({name})...", file=sys.stderr)
                df_cn = ak.stock_zh_index_daily(symbol=sina_code)
                print(f"[INDICES DEBUG] {sina_code} DataFrame shape: {df_cn.shape if df_cn is not None else 'None'}", file=sys.stderr)
                if df_cn is not None:
                    print(f"[INDICES DEBUG] {sina_code} columns: {df_cn.columns.tolist()}", file=sys.stderr)
                    print(f"[INDICES DEBUG] {sina_code} last 2 rows:\n{df_cn.tail(2)}", file=sys.stderr)
                if df_cn is None or len(df_cn) < 2:
                    print(f"[INDICES DEBUG] {sina_code} skipped: insufficient data", file=sys.stderr)
                    continue
                df_cn = df_cn.sort_values("date").tail(2).reset_index(drop=True)
                price = float(df_cn.iloc[-1]["close"])
                prev_close = float(df_cn.iloc[-2]["close"])
                change = price - prev_close
                change_pct = (change / prev_close * 100) if prev_close else 0
                result = {
                    "symbol": symbol,
                    "name": name,
                    "price": round(price, 2),
                    "change": round(change, 2),
                    "changePercent": round(change_pct, 2),
                }
                print(f"[INDICES DEBUG] {sina_code} result: {result}", file=sys.stderr)
                results.append(result)
            except Exception as e:
                print(f"[INDICES DEBUG] {sina_code} failed: {e}", file=sys.stderr)

        # ── 港股指数（恒生指数、恒生科技）───────────────────────────────────
        print("[INDICES DEBUG] Fetching HK indices...", file=sys.stderr)
        try:
            df_hk = ak.stock_hk_index_spot_sina()
            print(f"[INDICES DEBUG] HK index DataFrame shape: {df_hk.shape if df_hk is not None else 'None'}", file=sys.stderr)
            if df_hk is not None:
                print(f"[INDICES DEBUG] HK index columns: {df_hk.columns.tolist()}", file=sys.stderr)
            hk_index_map = {
                "HSI":    "恒生指数",
                "HSTECH": "恒生科技",
            }
            for code, name in hk_index_map.items():
                try:
                    row = df_hk[df_hk["代码"] == code]
                    print(f"[INDICES DEBUG] HK {code} found rows: {len(row)}", file=sys.stderr)
                    if not row.empty:
                        item = _parse_row(row.iloc[0].to_dict(), code, name)
                        if item:
                            results.append(item)
                    else:
                        print(f"[INDICES DEBUG] HK {code} not found in DataFrame", file=sys.stderr)
                except Exception as e:
                    print(f"[INDICES DEBUG] HK {code} parsing failed: {e}", file=sys.stderr)
        except Exception as e:
            print(f"[INDICES DEBUG] HK indices fetch failed: {e}", file=sys.stderr)

        # ── 美股指数（纳斯达克、标普500）────────────────────────────────────
        # index_us_stock_sina 返回历史日线，取最近两日计算涨跌
        print("[INDICES DEBUG] Fetching US indices...", file=sys.stderr)
        us_index_map = {
            ".IXIC": "纳斯达克",
            ".INX":  "标普500",
        }
        for sina_code, name in us_index_map.items():
            try:
                print(f"[INDICES DEBUG] Fetching {sina_code} ({name})...", file=sys.stderr)
                df_us = ak.index_us_stock_sina(symbol=sina_code)
                print(f"[INDICES DEBUG] {sina_code} DataFrame shape: {df_us.shape if df_us is not None else 'None'}", file=sys.stderr)
                if df_us is not None:
                    print(f"[INDICES DEBUG] {sina_code} columns: {df_us.columns.tolist()}", file=sys.stderr)
                if df_us is None or len(df_us) < 2:
                    print(f"[INDICES DEBUG] {sina_code} skipped: insufficient data", file=sys.stderr)
                    continue
                df_us = df_us.sort_values("date").tail(2).reset_index(drop=True)
                price = float(df_us.iloc[-1]["close"])
                prev_close = float(df_us.iloc[-2]["close"])
                change = price - prev_close
                change_pct = (change / prev_close * 100) if prev_close else 0
                result = {
                    "symbol": sina_code,
                    "name": name,
                    "price": round(price, 2),
                    "change": round(change, 2),
                    "changePercent": round(change_pct, 2),
                }
                print(f"[INDICES DEBUG] {sina_code} result: {result}", file=sys.stderr)
                results.append(result)
            except Exception as e:
                print(f"[INDICES DEBUG] {sina_code} failed: {e}", file=sys.stderr)
    finally:
        # 无论是否发生异常，都必须恢复 stdout
        sys.stdout = _real_stdout

    print(f"[INDICES DEBUG] Final results count: {len(results)}", file=sys.stderr)
    print(f"[INDICES DEBUG] Final results: {results}", file=sys.stderr)

    return results


def handle_history(
    symbol: str,
    start_date: str,
    end_date: str,
    cn_providers: list[str] | None = None,
    hk_providers: list[str] | None = None,
    tushare_token: str | None = None,
) -> dict:
    """
    历史 K 线路由：
      - 纯 6 位数字 → A 股（Tushare 优先 → AKShare 兜底）
      - XXXXX.HK   → 港股（HkAKShareProvider: stock_hk_daily）
      - 其他       → 美股（yfinance）

    A 股降级规则：
      1. 有 Token 且 Tushare 可用 → 调用 Tushare.get_history()
         - 返回非空数据 → 直接返回，source = "tushare"
         - 返回空数据或抛出异常 → 降级 AKShare
      2. 无 Token 或 Tushare 不可用 → 直接走 AKShare

    注意：AKShare/yfinance 内部可能输出到 stdout，通过临时重定向确保 JSON 纯净。
    """
    effective_cn = cn_providers if cn_providers else DEFAULT_CN
    effective_hk = hk_providers if hk_providers else DEFAULT_HK

    _real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        if symbol.isdigit() and len(symbol) == 6:
            # ── A 股：按 cn_providers 优先级顺序尝试 ──────────────────────────
            for provider_id in effective_cn:
                provider = _make_cn_provider(provider_id, tushare_token)
                if provider is None:
                    continue
                try:
                    bars = provider.get_history(symbol, start_date, end_date)
                    if bars:
                        print(f"[History CN] {symbol} 使用 {provider_id}", file=sys.stderr)
                        return {"data": [bar_to_dict(b) for b in bars], "source": provider_id}
                    print(f"[History CN] {provider_id} 返回空数据，尝试下一个", file=sys.stderr)
                except Exception as err:
                    print(f"[History CN] {provider_id} 失败: {err}，尝试下一个", file=sys.stderr)
            # 所有 provider 均失败
            return {"data": [], "source": "akshare", "error": "All CN providers failed"}

        elif symbol.upper().endswith(".HK"):
            # ── 港股：按 hk_providers 优先级顺序尝试 ─────────────────────────
            for provider_id in effective_hk:
                provider = _make_hk_provider(provider_id)
                if provider is None:
                    continue
                try:
                    bars = provider.get_history(symbol, start_date, end_date)
                    if bars:
                        source = bars[0].source
                        print(f"[History HK] {symbol} 使用 {provider_id}", file=sys.stderr)
                        return {"data": [bar_to_dict(b) for b in bars], "source": source}
                    print(f"[History HK] {provider_id} 返回空数据，尝试下一个", file=sys.stderr)
                except Exception as err:
                    print(f"[History HK] {provider_id} 失败: {err}，尝试下一个", file=sys.stderr)
            return {"data": [], "source": "akshare", "error": "All HK providers failed"}

        else:
            # ── 美股：yfinance ────────────────────────────────────────────────
            provider = UsYFinanceProvider()
            bars = provider.get_history(symbol, start_date, end_date)
            source = bars[0].source if bars else "yfinance"
            return {"data": [bar_to_dict(b) for b in bars], "source": source}
    finally:
        sys.stdout = _real_stdout


# ── 优先级参数解析辅助 ───────────────────────────────────────────────────────

def parse_providers(raw: str | None, default: list[str]) -> list[str]:
    """将逗号分隔的 provider 字符串解析为列表，空值时返回默认值。"""
    if not raw:
        return default
    providers = [p.strip() for p in raw.split(",") if p.strip()]
    return providers if providers else default

DEFAULT_CN = ['tushare', 'akshare']
DEFAULT_HK = ['akshare_hk']
DEFAULT_US = ['finnhub', 'yfinance']

# ── 主入口 ────────────────────────────────────────────────────────────────────

def main():
    args_list = sys.argv[1:]

    # ── 历史 K 线兼容模式（旧调用：symbol start_date end_date [--cn-providers ...] [--tushare-token TOKEN]）
    # 判断依据：第一个参数不是 --action
    if args_list and args_list[0] != "--action":
        parser = argparse.ArgumentParser(add_help=False)
        parser.add_argument("symbol")
        parser.add_argument("start_date")
        parser.add_argument("end_date")
        parser.add_argument("--cn-providers", default=None)
        parser.add_argument("--hk-providers", default=None)
        parser.add_argument("--us-providers", default=None)
        parser.add_argument("--tushare-token", default=None)
        parser.add_argument("--finnhub-key", default=None)
        try:
            parsed = parser.parse_args(args_list)
        except SystemExit:
            print(json.dumps({"error": "invalid_args", "message": "Usage: main.py <symbol> <start_date> <end_date>"}))
            sys.exit(1)

        symbol = parsed.symbol.strip()
        if not (symbol.isdigit() and len(symbol) == 6) and not symbol.upper().endswith(".HK"):
            symbol = symbol.upper()

        cn_providers = parse_providers(parsed.cn_providers, DEFAULT_CN)
        hk_providers = parse_providers(parsed.hk_providers, DEFAULT_HK)

        try:
            result = handle_history(
                symbol, parsed.start_date, parsed.end_date,
                cn_providers=cn_providers,
                hk_providers=hk_providers,
                tushare_token=parsed.tushare_token,
            )
            print(json.dumps(result, ensure_ascii=False))
        except Exception as err:
            error_message = str(err)
            if "RateLimit" in error_message or "Too Many Requests" in error_message:
                print(json.dumps({"error": "rate_limited", "message": error_message}))
            else:
                print(json.dumps({"error": "fetch_failed", "message": error_message}))
            sys.exit(1)
        return

    # ── --action 模式 ──────────────────────────────────────────────────────────
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True,
                        choices=["cn_quote", "cn_search", "hk_quote", "hk_search", "us_quote", "get_indices"])
    parser.add_argument("--symbols", default=None, help="逗号分隔的股票代码列表")
    parser.add_argument("--query", default=None, help="搜索关键词")
    # Provider 优先级参数（逗号分隔，如 tushare,akshare）
    parser.add_argument("--cn-providers", default=None, help="A股 provider 优先级，如 tushare,akshare")
    parser.add_argument("--hk-providers", default=None, help="港股 provider 优先级，如 akshare_hk")
    parser.add_argument("--us-providers", default=None, help="美股 provider 优先级，如 finnhub,yfinance")
    # Token / Key
    parser.add_argument("--tushare-token", default=None, help="Tushare Pro API Token")
    parser.add_argument("--finnhub-key", default=None, help="Finnhub API Key（预留，当前美股行情由前端直接调用）")

    try:
        parsed = parser.parse_args(args_list)
    except SystemExit:
        print(json.dumps({"error": "invalid_args", "message": "参数解析失败"}))
        sys.exit(1)

    action = parsed.action
    tushare_token = parsed.tushare_token or None
    cn_providers = parse_providers(parsed.cn_providers, DEFAULT_CN)
    hk_providers = parse_providers(parsed.hk_providers, DEFAULT_HK)
    us_providers = parse_providers(parsed.us_providers, DEFAULT_US)

    try:
        if action == "cn_quote":
            if not parsed.symbols:
                print(json.dumps({"error": "missing_param", "message": "--symbols is required"}))
                sys.exit(1)
            symbols = [s.strip() for s in parsed.symbols.split(",") if s.strip()]
            result = handle_cn_quote(symbols, cn_providers, tushare_token)
            print(json.dumps(result, ensure_ascii=False))

        elif action == "cn_search":
            if not parsed.query:
                print(json.dumps({"error": "missing_param", "message": "--query is required"}))
                sys.exit(1)
            result = handle_cn_search(parsed.query, cn_providers, tushare_token)
            print(json.dumps(result, ensure_ascii=False))

        elif action == "hk_quote":
            if not parsed.symbols:
                print(json.dumps({"error": "missing_param", "message": "--symbols is required"}))
                sys.exit(1)
            symbols = [s.strip() for s in parsed.symbols.split(",") if s.strip()]
            result = handle_hk_quote(symbols, hk_providers)
            print(json.dumps(result, ensure_ascii=False))

        elif action == "hk_search":
            if not parsed.query:
                print(json.dumps({"error": "missing_param", "message": "--query is required"}))
                sys.exit(1)
            result = handle_hk_search(parsed.query, hk_providers)
            print(json.dumps(result, ensure_ascii=False))

        elif action == "us_quote":
            if not parsed.symbols:
                print(json.dumps({"error": "missing_param", "message": "--symbols is required"}))
                sys.exit(1)
            symbols = [s.strip() for s in parsed.symbols.split(",") if s.strip()]
            result = handle_us_quote(symbols, us_providers)
            print(json.dumps(result, ensure_ascii=False))

        elif action == "get_indices":
            result = handle_get_indices()
            print(json.dumps(result, ensure_ascii=False))

    except Exception as err:
        error_message = str(err)
        if "RateLimit" in error_message or "Too Many Requests" in error_message:
            print(json.dumps({"error": "rate_limited", "message": error_message}))
        else:
            print(json.dumps({"error": "fetch_failed", "message": error_message}))
        sys.exit(1)


if __name__ == "__main__":
    main()
