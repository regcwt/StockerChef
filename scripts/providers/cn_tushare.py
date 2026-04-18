"""
CnTushareProvider — A股 Tushare 数据提供器

数据源：Tushare Pro（需要 Token，免费注册可获得基础权限）
  - 实时行情：daily()（日线数据，取最新一天）
  - 搜索：stock_basic()（股票基础信息列表，10min 缓存）
  - 历史 K 线：daily()（复权日线数据）

Token 获取：https://tushare.pro/register?reg=7
权限说明：免费用户可访问 daily、stock_basic 等基础接口

优先级：当 Tushare Token 已配置时，优先于 AKShare 使用。
"""
import sys
import time
from datetime import datetime, timedelta
from typing import Optional

from .base import BaseStockProvider, QuoteData, HistoricalBar, SearchResult

# ── 进程级缓存 ────────────────────────────────────────────────────────────────
_stock_basic_cache: list[dict] = []
_stock_basic_cache_time: float = 0.0
_STOCK_BASIC_CACHE_TTL: float = 600.0  # 10 分钟


class CnTushareProvider(BaseStockProvider):
    """
    A股 Tushare Pro 数据提供器。
    需要 Token，数据质量和稳定性优于 AKShare 免费接口。
    """

    def __init__(self, token: str):
        """
        Args:
            token: Tushare Pro API Token（从 Settings 页面配置）
        """
        self._token = token.strip() if token else ""
        self._api = None  # 延迟初始化

    @property
    def provider_name(self) -> str:
        return "Tushare"

    def is_available(self) -> bool:
        """Token 非空且 tushare 库已安装"""
        if not self._token:
            return False
        try:
            import tushare  # noqa: F401
            return True
        except ImportError:
            return False

    def _get_api(self):
        """延迟初始化 Tushare Pro API 对象"""
        if self._api is None:
            import tushare as ts
            ts.set_token(self._token)
            self._api = ts.pro_api()
        return self._api

    # ── 股票基础信息（搜索用）────────────────────────────────────────────────

    def _load_stock_basic(self) -> list[dict]:
        """
        获取 A 股全量股票基础信息（代码 + 名称）。
        数据源：Tushare stock_basic()，10 分钟进程级缓存。
        """
        global _stock_basic_cache, _stock_basic_cache_time
        now = time.time()
        if _stock_basic_cache and (now - _stock_basic_cache_time) < _STOCK_BASIC_CACHE_TTL:
            return _stock_basic_cache

        pro = self._get_api()
        # 分别获取上交所和深交所股票列表
        result = []
        for exchange in ("SSE", "SZSE"):
            try:
                df = pro.stock_basic(
                    exchange=exchange,
                    list_status="L",
                    fields="ts_code,symbol,name",
                )
                if df is not None and not df.empty:
                    for _, row in df.iterrows():
                        # ts_code 格式：600519.SH / 000001.SZ，symbol 是纯 6 位数字
                        result.append({
                            "code": str(row["symbol"]),
                            "ts_code": str(row["ts_code"]),
                            "name": str(row["name"]),
                        })
            except Exception as err:
                print(f"[Tushare] 获取 {exchange} 股票列表失败: {err}", file=sys.stderr)

        _stock_basic_cache = result
        _stock_basic_cache_time = now
        return result

    def _symbol_to_ts_code(self, symbol: str) -> str:
        """
        将 6 位纯数字代码转换为 Tushare ts_code 格式。
        规则：6 开头 → .SH（上交所），其他 → .SZ（深交所）
        """
        if symbol.startswith("6"):
            return f"{symbol}.SH"
        return f"{symbol}.SZ"

    # ── BaseStockProvider 接口实现 ────────────────────────────────────────────

    def get_quotes(self, symbols: list[str]) -> list[QuoteData]:
        """
        获取 A 股实时行情（Tushare daily 接口取最新一天）。
        Tushare 免费层 daily 接口有调用频率限制，逐只获取。
        """
        pro = self._get_api()
        stock_list = self._load_stock_basic()
        name_map = {item["code"]: item["name"] for item in stock_list}
        now_ts = int(time.time())

        today = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=7)).strftime("%Y%m%d")

        result = []
        for symbol in symbols:
            ts_code = self._symbol_to_ts_code(symbol)
            try:
                df = pro.daily(
                    ts_code=ts_code,
                    start_date=start,
                    end_date=today,
                )
                if df is None or df.empty:
                    continue

                # Tushare daily 返回按日期降序，取第一行（最新）
                latest = df.iloc[0]
                close = self.safe_float(latest.get("close"))
                pre_close = self.safe_float(latest.get("pre_close"))
                change = round(close - pre_close, 4)
                change_pct = self.safe_float(latest.get("pct_chg"))  # 已是百分比

                result.append(QuoteData(
                    symbol=symbol,
                    name=name_map.get(symbol, symbol),
                    price=close,
                    change=change,
                    change_percent=change_pct,
                    open=self.safe_float(latest.get("open")),
                    high=self.safe_float(latest.get("high")),
                    low=self.safe_float(latest.get("low")),
                    previous_close=pre_close,
                    volume=self.safe_int(latest.get("vol")),  # Tushare vol 单位：手（100股）
                    timestamp=now_ts,
                ))
            except Exception as err:
                print(f"[Tushare] {symbol} 行情获取失败: {err}", file=sys.stderr)

        return result

    def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        """从 Tushare 股票基础信息中模糊匹配代码或名称"""
        stock_list = self._load_stock_basic()
        query_lower = query.lower().strip()

        results = []
        for item in stock_list:
            code = item["code"]
            name = item["name"]
            if code.startswith(query_lower) or query_lower in name.lower():
                results.append(SearchResult(
                    symbol=code,
                    display_symbol=code,
                    description=name,
                    market_type="A股",
                ))
            if len(results) >= limit:
                break
        return results

    def get_history(self, symbol: str, start_date: str, end_date: str) -> list[HistoricalBar]:
        """
        A 股历史 K 线（Tushare daily 接口）。
        返回不复权日线数据，按日期升序排列。
        """
        pro = self._get_api()
        ts_code = self._symbol_to_ts_code(symbol)

        start_fmt = start_date.replace("-", "")
        end_fmt = end_date.replace("-", "")

        df = pro.daily(
            ts_code=ts_code,
            start_date=start_fmt,
            end_date=end_fmt,
        )
        if df is None or df.empty:
            return []

        # Tushare 返回降序，需要反转为升序
        df = df.sort_values("trade_date", ascending=True)

        return [
            HistoricalBar(
                date=f"{row['trade_date'][:4]}-{row['trade_date'][4:6]}-{row['trade_date'][6:]}",
                open=round(self.safe_float(row.get("open")), 4),
                high=round(self.safe_float(row.get("high")), 4),
                low=round(self.safe_float(row.get("low")), 4),
                close=round(self.safe_float(row.get("close")), 4),
                volume=self.safe_int(row.get("vol")),
                source="tushare",
            )
            for _, row in df.iterrows()
        ]
