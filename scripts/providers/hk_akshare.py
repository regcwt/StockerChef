"""
HkAKShareProvider — 港股 AKShare 数据提供器

数据源：AKShare（免费，无需 Token）
  - 实时行情：stock_hk_spot()（新浪财经，10min 缓存 + threading.Lock）
             降级：stock_hk_daily() 取最新一条
  - 搜索：从 stock_hk_spot() 全量数据中模糊匹配
  - 历史 K 线：stock_hk_daily()（新浪财经）

缓存策略：
  - stock_hk_spot 全量数据：10 分钟进程级缓存 + threading.Lock（防并发重复拉取）
    参考 TradingAgents-CN improved_hk.py 的 _akshare_hk_spot_lock 策略

代码格式：
  - 外部（watchlist）：03690.HK（yfinance 格式）
  - AKShare 内部：03690（5 位纯数字）
"""
import sys
import time
import threading
from datetime import datetime, timedelta
from typing import Optional

from .base import BaseStockProvider, QuoteData, HistoricalBar, SearchResult

# ── 港股全量实时行情缓存（进程级，10min TTL + threading.Lock）────────────────
_hk_spot_cache: Optional[list[dict]] = None
_hk_spot_cache_time: float = 0.0
_HK_SPOT_CACHE_TTL: float = 600.0  # 10 分钟
_hk_spot_lock = threading.Lock()


def _normalize_hk_symbol(symbol: str) -> str:
    """
    标准化港股代码：03690.HK → 03690（5 位数字）
    """
    upper = symbol.upper().strip()
    if upper.endswith(".HK"):
        return upper[:-3].zfill(5)
    return upper.zfill(5)


class HkAKShareProvider(BaseStockProvider):
    """
    港股 AKShare 数据提供器。
    免费无需 Token，实时行情使用新浪财经接口（比 yfinance 历史接口更准确）。
    """

    @property
    def provider_name(self) -> str:
        return "AKShare-HK"

    def is_available(self) -> bool:
        try:
            import akshare  # noqa: F401
            return True
        except ImportError:
            return False

    # ── 港股全量实时行情（带缓存 + 锁）──────────────────────────────────────

    def _load_hk_spot(self) -> list[dict]:
        """
        获取港股全量实时行情。
        主数据源：ak.stock_hk_spot()（新浪财经）
        失败时返回空列表（由调用方降级为 stock_hk_daily）。
        带 10min 进程级缓存 + threading.Lock 防并发重复拉取。
        """
        global _hk_spot_cache, _hk_spot_cache_time

        # 快速路径：缓存有效时无需加锁
        now = time.time()
        if _hk_spot_cache is not None and (now - _hk_spot_cache_time) < _HK_SPOT_CACHE_TTL:
            return _hk_spot_cache

        # 缓存过期，加锁后再次检查（防止多线程重复拉取）
        acquired = _hk_spot_lock.acquire(timeout=60)
        if not acquired:
            print("[AKShare-HK] 港股行情缓存锁等待超时，使用旧缓存", file=sys.stderr)
            return _hk_spot_cache or []

        try:
            # 获取锁后再次检查（可能已被其他线程更新）
            now = time.time()
            if _hk_spot_cache is not None and (now - _hk_spot_cache_time) < _HK_SPOT_CACHE_TTL:
                return _hk_spot_cache

            import akshare as ak
            df = ak.stock_hk_spot()

            # 字段：代码/中文名称/最新价/涨跌额/涨跌幅/昨收/今开/最高/最低/成交量
            result = []
            for _, row in df.iterrows():
                code = str(row["代码"]).zfill(5)
                result.append({
                    "code": code,
                    "name": str(row.get("中文名称", "")),
                    "price": self.safe_float(row.get("最新价")),
                    "change": self.safe_float(row.get("涨跌额")),
                    "change_percent": self.safe_float(row.get("涨跌幅")),
                    "open": self.safe_float(row.get("今开")),
                    "high": self.safe_float(row.get("最高")),
                    "low": self.safe_float(row.get("最低")),
                    "previous_close": self.safe_float(row.get("昨收")),
                    "volume": self.safe_int(row.get("成交量")),
                })

            _hk_spot_cache = result
            _hk_spot_cache_time = time.time()
            print(f"[AKShare-HK] 港股行情缓存更新：{len(result)} 只", file=sys.stderr)
            return result

        except Exception as err:
            print(f"[AKShare-HK] stock_hk_spot 失败: {err}", file=sys.stderr)
            return _hk_spot_cache or []
        finally:
            _hk_spot_lock.release()

    def _fetch_single_via_daily(self, symbol: str) -> Optional[dict]:
        """
        降级方案：通过 stock_hk_daily（新浪财经历史接口）取最新一条作为实时行情。
        在 stock_hk_spot 中找不到对应代码时使用。
        """
        import akshare as ak
        import pandas as pd

        normalized = _normalize_hk_symbol(symbol)
        df = ak.stock_hk_daily(symbol=normalized, adjust="")
        if df is None or df.empty:
            return None

        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date")
        if df.empty:
            return None

        latest = df.iloc[-1]
        prev = df.iloc[-2] if len(df) >= 2 else latest
        close = self.safe_float(latest.get("close"))
        prev_close = self.safe_float(prev.get("close"))
        change = round(close - prev_close, 4)
        change_pct = round((change / prev_close * 100) if prev_close else 0, 4)

        return {
            "name": symbol,  # 降级时无法获取中文名
            "price": close,
            "change": change,
            "change_percent": change_pct,
            "open": self.safe_float(latest.get("open")),
            "high": self.safe_float(latest.get("high")),
            "low": self.safe_float(latest.get("low")),
            "previous_close": prev_close,
            "volume": self.safe_int(latest.get("volume")),
        }

    # ── BaseStockProvider 接口实现 ────────────────────────────────────────────

    def get_quotes(self, symbols: list[str]) -> list[QuoteData]:
        """
        获取港股实时行情。
        主数据源：stock_hk_spot()（新浪财经，10min 缓存）
        降级：stock_hk_daily() 取最新一条
        symbols: 外部格式，如 ['03690.HK', '00700.HK']
        """
        # 建立 5位代码 → 原始 symbol 的映射
        symbol_map: dict[str, str] = {}
        for sym in symbols:
            symbol_map[_normalize_hk_symbol(sym)] = sym

        spot_data = self._load_hk_spot()
        now_ts = int(time.time())

        result = []
        found_codes: set[str] = set()

        # 从全量缓存中查找
        for item in spot_data:
            if item["code"] in symbol_map:
                original_symbol = symbol_map[item["code"]]
                found_codes.add(item["code"])
                result.append(QuoteData(
                    symbol=original_symbol,
                    name=item["name"],
                    price=item["price"],
                    change=item["change"],
                    change_percent=item["change_percent"],
                    open=item["open"],
                    high=item["high"],
                    low=item["low"],
                    previous_close=item["previous_close"],
                    volume=item["volume"],
                    timestamp=now_ts,
                ))

        # 对未找到的代码，降级为 stock_hk_daily
        for code, original_symbol in symbol_map.items():
            if code in found_codes:
                continue
            try:
                print(
                    f"[AKShare-HK] {original_symbol} 未在 stock_hk_spot 中找到，"
                    f"降级为 stock_hk_daily",
                    file=sys.stderr,
                )
                raw = self._fetch_single_via_daily(original_symbol)
                if raw:
                    result.append(QuoteData(
                        symbol=original_symbol,
                        name=raw["name"],
                        price=raw["price"],
                        change=raw["change"],
                        change_percent=raw["change_percent"],
                        open=raw["open"],
                        high=raw["high"],
                        low=raw["low"],
                        previous_close=raw["previous_close"],
                        volume=raw["volume"],
                        timestamp=now_ts,
                    ))
            except Exception as err:
                print(f"[AKShare-HK] {original_symbol} 降级获取失败: {err}", file=sys.stderr)

        return result

    def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        """从港股全量数据中模糊匹配代码或名称"""
        spot_data = self._load_hk_spot()
        query_lower = query.lower().strip()

        results = []
        for item in spot_data:
            code = item["code"]
            name = item["name"]
            if code.startswith(query_lower) or query_lower in name.lower():
                results.append(SearchResult(
                    symbol=f"{code}.HK",
                    display_symbol=f"{code}.HK",
                    description=name,
                    market_type="港股",
                ))
            if len(results) >= limit:
                break
        return results

    def get_history(self, symbol: str, start_date: str, end_date: str) -> list[HistoricalBar]:
        """港股历史 K 线（stock_hk_daily，新浪财经）"""
        import akshare as ak
        import pandas as pd

        normalized = _normalize_hk_symbol(symbol)
        df = ak.stock_hk_daily(symbol=normalized, adjust="")
        if df is None or df.empty:
            return []

        df["date"] = pd.to_datetime(df["date"])
        mask = (df["date"] >= start_date) & (df["date"] <= end_date)
        df = df.loc[mask].sort_values("date")

        return [
            HistoricalBar(
                date=row["date"].strftime("%Y-%m-%d"),
                open=round(self.safe_float(row.get("open")), 4),
                high=round(self.safe_float(row.get("high")), 4),
                low=round(self.safe_float(row.get("low")), 4),
                close=round(self.safe_float(row.get("close")), 4),
                volume=self.safe_int(row.get("volume")),
                source="akshare",
            )
            for _, row in df.iterrows()
        ]
