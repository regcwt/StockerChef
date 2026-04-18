#!/usr/bin/env python3
"""
股票历史数据获取脚本 — 双数据源架构
供 Electron main 进程通过 child_process 调用
https://akshare.akfamily.xyz/

数据源策略（参考 TradingAgents-CN 的多数据源降级机制）：
  1. AKShare（优先）：免费、无 API Key、支持 A 股和美股
     - A 股：ak.stock_zh_a_hist()
     - 美股：ak.stock_us_hist()
  2. yfinance（降级）：AKShare 失败时自动切换

Symbol 识别规则：
  - 纯数字 6 位（如 000001、600036）→ A 股
  - 其他（如 AAPL、TSLA）→ 美股

用法：
  python3 scripts/stock_fetch.py <symbol> <start_date> <end_date>
  python3 scripts/stock_fetch.py AAPL 2024-01-01 2024-04-01
  python3 scripts/stock_fetch.py 000001 2024-01-01 2024-04-01

输出：
  成功：JSON 对象，包含 data（OHLCV 数组）和 source（数据来源）
  失败：JSON 对象，包含 error 和 message 字段
"""

import sys
import json
from datetime import datetime, timedelta


def is_a_share(symbol: str) -> bool:
    """判断是否为 A 股代码（纯数字 6 位）"""
    return symbol.isdigit() and len(symbol) == 6


def normalize_date_for_akshare(date_str: str) -> str:
    """将 YYYY-MM-DD 转换为 AKShare 要求的 YYYYMMDD 格式"""
    return date_str.replace("-", "")


def normalize_row(date_str: str, open_price: float, high: float, low: float,
                  close: float, volume: float) -> dict:
    """统一输出格式"""
    return {
        "date": date_str,
        "open": round(float(open_price), 4),
        "high": round(float(high), 4),
        "low": round(float(low), 4),
        "close": round(float(close), 4),
        "volume": int(volume),
    }


# ── AKShare 数据源 ────────────────────────────────────────────────────────────

def fetch_a_share_via_akshare(symbol: str, start_date: str, end_date: str) -> list:
    """
    通过 AKShare 获取 A 股历史数据
    参考 TradingAgents-CN 的 AKShareProvider 实现
    使用前复权（qfq）与 TradingAgents-CN 保持一致
    """
    import akshare as ak

    ak_start = normalize_date_for_akshare(start_date)
    ak_end = normalize_date_for_akshare(end_date)

    df = ak.stock_zh_a_hist(
        symbol=symbol,
        period="daily",
        start_date=ak_start,
        end_date=ak_end,
        adjust="qfq",   # 前复权，与 TradingAgents-CN 保持一致
    )

    if df is None or df.empty:
        return []

    result = []
    for _, row in df.iterrows():
        # AKShare A 股列名：日期、开盘、收盘、最高、最低、成交量
        result.append(normalize_row(
            date_str=str(row["日期"]),
            open_price=row["开盘"],
            high=row["最高"],
            low=row["最低"],
            close=row["收盘"],
            volume=row["成交量"],
        ))

    return result


def fetch_us_stock_via_akshare(symbol: str, start_date: str, end_date: str) -> list:
    """
    通过 AKShare 获取美股历史数据
    AKShare 美股 symbol 格式：纳斯达克加 .O 后缀，纽交所加 .N 后缀
    先尝试 .O（纳斯达克），再尝试 .N（纽交所），最后尝试原始 symbol
    """
    import akshare as ak

    ak_start = normalize_date_for_akshare(start_date)
    ak_end = normalize_date_for_akshare(end_date)

    # 依次尝试不同的交易所后缀
    symbol_candidates = [f"{symbol}.O", f"{symbol}.N", symbol]

    last_error = None
    for candidate in symbol_candidates:
        try:
            df = ak.stock_us_hist(
                symbol=candidate,
                period="daily",
                start_date=ak_start,
                end_date=ak_end,
                adjust="qfq",
            )

            if df is None or df.empty:
                continue

            result = []
            for _, row in df.iterrows():
                # AKShare 美股列名：日期、开盘、收盘、最高、最低、成交量
                result.append(normalize_row(
                    date_str=str(row["日期"]),
                    open_price=row["开盘"],
                    high=row["最高"],
                    low=row["最低"],
                    close=row["收盘"],
                    volume=row["成交量"],
                ))

            if result:
                return result

        except Exception as error:
            last_error = error
            continue

    if last_error:
        raise last_error
    return []


# ── yfinance 数据源（降级备选）────────────────────────────────────────────────

def fetch_via_yfinance(symbol: str, start_date: str, end_date: str) -> list:
    """
    通过 yfinance 获取历史数据（降级备选）
    参考 TradingAgents-CN 的 YFinanceUtils.get_stock_data 实现
    """
    import yfinance as yf

    # yfinance 的 history() end_date 是不含的，需要加一天
    end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
    end_date_exclusive = end_dt.strftime("%Y-%m-%d")

    ticker = yf.Ticker(symbol)
    hist = ticker.history(
        start=start_date,
        end=end_date_exclusive,
        auto_adjust=True,   # 自动复权，与 TradingAgents-CN 保持一致
        actions=False,
    )

    if hist is None or hist.empty:
        return []

    result = []
    for date_index, row in hist.iterrows():
        result.append(normalize_row(
            date_str=date_index.strftime("%Y-%m-%d"),
            open_price=row["Open"],
            high=row["High"],
            low=row["Low"],
            close=row["Close"],
            volume=row["Volume"],
        ))

    return result


# ── 主入口：双数据源降级逻辑 ─────────────────────────────────────────────────

def fetch_with_fallback(symbol: str, start_date: str, end_date: str) -> dict:
    """
    双数据源降级获取历史数据
    优先 AKShare，失败时降级到 yfinance
    返回 { data, source } 或抛出异常
    """
    use_a_share = is_a_share(symbol)
    akshare_error = None
    yfinance_error = None

    # ── 第一优先级：AKShare ──
    try:
        if use_a_share:
            data = fetch_a_share_via_akshare(symbol, start_date, end_date)
        else:
            data = fetch_us_stock_via_akshare(symbol, start_date, end_date)

        if data:
            return {"data": data, "source": "akshare"}

        # AKShare 返回空数据，记录后继续降级
        akshare_error = "AKShare returned empty data"

    except Exception as error:
        akshare_error = str(error)

    # ── 第二优先级：yfinance（降级）──
    try:
        data = fetch_via_yfinance(symbol, start_date, end_date)

        if data:
            return {"data": data, "source": "yfinance"}

        yfinance_error = "yfinance returned empty data"

    except Exception as error:
        yfinance_error = str(error)

    # 两个数据源都失败，抛出包含两个错误信息的异常
    raise RuntimeError(
        f"All data sources failed. "
        f"AKShare: {akshare_error}. "
        f"yfinance: {yfinance_error}."
    )


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "invalid_args", "message": "Usage: stock_fetch.py <symbol> <start_date> <end_date>"}))
        sys.exit(1)

    symbol = sys.argv[1].upper().strip()
    start_date = sys.argv[2].strip()
    end_date = sys.argv[3].strip()

    try:
        result = fetch_with_fallback(symbol, start_date, end_date)
        # 输出格式：{ data: [...], source: 'akshare' | 'yfinance' }
        print(json.dumps(result))

    except Exception as error:
        error_message = str(error)
        # 区分限流错误和其他错误，方便前端做不同处理
        if "RateLimit" in error_message or "Too Many Requests" in error_message:
            print(json.dumps({"error": "rate_limited", "message": error_message}))
        else:
            print(json.dumps({"error": "fetch_failed", "message": error_message}))
        sys.exit(1)


if __name__ == "__main__":
    main()
