"""
UsYFinanceProvider — 美股 yfinance 数据提供器

数据源：yfinance（免费，无需 Token）
  - 实时行情：yf.Ticker.fast_info（轻量级，比 .info 快）
  - 搜索：yfinance 不支持搜索，此方法返回空列表（由 Finnhub 负责美股搜索）
  - 历史 K 线：yf.Ticker.history()

注意：yfinance 有请求频率限制，高频调用可能触发 429 Too Many Requests。
"""
import sys
from datetime import datetime, timedelta

from .base import BaseStockProvider, QuoteData, HistoricalBar, SearchResult


class UsYFinanceProvider(BaseStockProvider):
    """
    美股 yfinance 数据提供器。
    免费无需 Token，主要用于历史 K 线获取。
    实时行情由 Finnhub 负责（通过 stockApi.ts），此 Provider 作为降级备选。
    """

    @property
    def provider_name(self) -> str:
        return "yfinance"

    def is_available(self) -> bool:
        try:
            import yfinance  # noqa: F401
            return True
        except ImportError:
            return False

    def get_quotes(self, symbols: list[str]) -> list[QuoteData]:
        """
        获取美股实时行情（yfinance fast_info）。
        注意：美股实时行情主要由 Finnhub 负责，此方法作为降级备选。

        fast_info 字段（已验证）：
          last_price, previous_close, open, day_high, day_low, last_volume
        """
        import yfinance as yf
        import time

        now_ts = int(time.time())
        result = []

        for symbol in symbols:
            try:
                ticker = yf.Ticker(symbol.upper())
                info = ticker.fast_info

                price = float(getattr(info, "last_price", None) or 0)
                prev_close = float(getattr(info, "previous_close", None) or 0)
                change = round(price - prev_close, 4)
                change_pct = round((change / prev_close * 100) if prev_close else 0, 4)

                result.append(QuoteData(
                    symbol=symbol.upper(),
                    name=symbol.upper(),  # fast_info 不含公司名，由 Finnhub profile 补充
                    price=price,
                    change=change,
                    change_percent=change_pct,
                    open=float(getattr(info, "open", None) or 0),
                    high=float(getattr(info, "day_high", None) or 0),
                    low=float(getattr(info, "day_low", None) or 0),
                    previous_close=prev_close,
                    volume=int(getattr(info, "last_volume", None) or 0),
                    timestamp=now_ts,
                ))
            except Exception as err:
                print(f"[yfinance] {symbol} 行情获取失败: {err}", file=sys.stderr)

        return result

    def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        """
        yfinance 不支持搜索接口，返回空列表。
        美股搜索由 Finnhub searchSymbol 负责（通过 stockApi.ts）。
        """
        return []

    def get_history(self, symbol: str, start_date: str, end_date: str) -> list[HistoricalBar]:
        """美股历史 K 线（yfinance Ticker.history）"""
        import yfinance as yf

        end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
        end_date_exclusive = end_dt.strftime("%Y-%m-%d")

        ticker = yf.Ticker(symbol.upper())
        hist = ticker.history(
            start=start_date,
            end=end_date_exclusive,
            auto_adjust=True,
            actions=False,
        )
        if hist is None or hist.empty:
            return []

        return [
            HistoricalBar(
                date=date_index.strftime("%Y-%m-%d"),
                open=round(float(row["Open"]), 4),
                high=round(float(row["High"]), 4),
                low=round(float(row["Low"]), 4),
                close=round(float(row["Close"]), 4),
                volume=int(row["Volume"]),
                source="yfinance",
            )
            for date_index, row in hist.iterrows()
        ]
