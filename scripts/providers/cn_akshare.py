"""
CnAKShareProvider — A股 AKShare 数据提供器

数据源：AKShare（免费，无需 Token）
  - 实时行情：stock_zh_a_spot()（新浪财经，3min 缓存，返回当前实时价格）
             降级：stock_zh_a_hist_tx()（腾讯财经日线，取最近一天收盘价）
  - 搜索：stock_info_a_code_name()（股票列表，5min 缓存）
  - 历史 K 线：stock_zh_a_hist()（东方财富）

重试策略：指数退避，最多 3 次（参考 TradingAgents-CN AKShareProvider）
缓存策略：
  - 实时行情全量快照：3 分钟进程级缓存（避免每次都拉全量数据）
  - 股票列表：5 分钟进程级缓存

⚠️ 重要：stock_zh_a_hist_tx 是历史日线接口，盘中取到的是昨天收盘价，不是实时价格。
   实时行情必须使用 stock_zh_a_spot（新浪财经），该接口返回当前实时价格和时间戳。
"""
import sys
import time
import threading
from datetime import datetime, timedelta
from typing import Optional

from .base import BaseStockProvider, QuoteData, HistoricalBar, SearchResult

# ── 进程级缓存 ────────────────────────────────────────────────────────────────
_stock_list_cache: list[dict] = []
_stock_list_cache_time: float = 0.0
_STOCK_LIST_CACHE_TTL: float = 300.0  # 5 分钟

# A 股实时行情全量快照缓存（stock_zh_a_spot，3 分钟 TTL）
# key: 代码（带市场前缀，如 sh600519 / sz000001）→ dict（行情字段）
_cn_spot_cache: dict[str, dict] = {}
_cn_spot_cache_time: float = 0.0
_CN_SPOT_CACHE_TTL: float = 180.0  # 3 分钟
_cn_spot_lock = threading.Lock()


class CnAKShareProvider(BaseStockProvider):
    """
    A股 AKShare 数据提供器。
    免费无需 Token，作为 A股数据的基础降级方案。
    """

    @property
    def provider_name(self) -> str:
        return "AKShare"

    def is_available(self) -> bool:
        try:
            import akshare  # noqa: F401
            return True
        except ImportError:
            return False

    # ── 股票列表（搜索用）────────────────────────────────────────────────────

    def _load_stock_list(self) -> list[dict]:
        """
        获取 A 股全量股票列表（代码 + 名称）。
        数据源：stock_info_a_code_name()，稳定不受反爬影响。
        5 分钟进程级缓存。
        """
        global _stock_list_cache, _stock_list_cache_time
        now = time.time()
        if _stock_list_cache and (now - _stock_list_cache_time) < _STOCK_LIST_CACHE_TTL:
            return _stock_list_cache

        import akshare as ak
        df = ak.stock_info_a_code_name()
        result = [
            {"code": str(row["code"]), "name": str(row["name"])}
            for _, row in df.iterrows()
        ]
        _stock_list_cache = result
        _stock_list_cache_time = now
        return result

    # ── A 股代码前缀辅助 ─────────────────────────────────────────────────────

    @staticmethod
    def _add_market_prefix(symbol: str) -> str:
        """
        为 A 股代码添加市场前缀，供腾讯财经接口使用。
        深交所（000/001/002/003/300/301）→ sz 前缀
        上交所（600/601/603/605/688）→ sh 前缀
        北交所（8/4 开头）→ bj 前缀
        """
        if symbol.startswith(("000", "001", "002", "003", "300", "301")):
            return f"sz{symbol}"
        if symbol.startswith(("600", "601", "603", "605", "688")):
            return f"sh{symbol}"
        if symbol.startswith(("8", "4")):
            return f"bj{symbol}"
        # 默认尝试深交所
        return f"sz{symbol}"

    # ── A 股全量实时行情快照（stock_zh_a_spot，3min 缓存）────────────────────

    def _load_cn_spot(self) -> dict[str, dict]:
        """
        获取 A 股全量实时行情快照（新浪财经）。
        返回 dict，key 为带市场前缀的代码（如 sh600519 / sz000001），value 为行情字段。
        3 分钟进程级缓存 + threading.Lock 防并发重复拉取。

        ⚠️ 重要：stock_zh_a_spot 返回的是当前实时价格（含时间戳字段），
           不同于 stock_zh_a_hist_tx（历史日线，盘中取到的是昨天收盘价）。
        """
        global _cn_spot_cache, _cn_spot_cache_time

        now = time.time()
        if _cn_spot_cache and (now - _cn_spot_cache_time) < _CN_SPOT_CACHE_TTL:
            return _cn_spot_cache

        acquired = _cn_spot_lock.acquire(timeout=30)
        if not acquired:
            print("[AKShare] A股实时行情缓存锁等待超时，使用旧缓存", file=sys.stderr)
            return _cn_spot_cache

        try:
            now = time.time()
            if _cn_spot_cache and (now - _cn_spot_cache_time) < _CN_SPOT_CACHE_TTL:
                return _cn_spot_cache

            import akshare as ak
            df = ak.stock_zh_a_spot()
            if df is None or df.empty:
                return _cn_spot_cache

            result: dict[str, dict] = {}
            for _, row in df.iterrows():
                code = str(row["代码"])  # 格式如 sh600519 / sz000001
                prev_close = self.safe_float(row.get("昨收"))
                price = self.safe_float(row.get("最新价"))
                change = self.safe_float(row.get("涨跌额"))
                change_percent = self.safe_float(row.get("涨跌幅"))
                result[code] = {
                    "price": price,
                    "change": change,
                    "change_percent": change_percent,
                    "open": self.safe_float(row.get("今开")),
                    "high": self.safe_float(row.get("最高")),
                    "low": self.safe_float(row.get("最低")),
                    "previous_close": prev_close,
                    "volume": self.safe_float(row.get("成交量", 0)),
                }

            _cn_spot_cache = result
            _cn_spot_cache_time = time.time()
            print(f"[AKShare] A股实时行情快照已更新，共 {len(result)} 只", file=sys.stderr)
            return result
        except Exception as err:
            print(f"[AKShare] A股实时行情快照获取失败（stock_zh_a_spot）: {err}", file=sys.stderr)
            return _cn_spot_cache
        finally:
            _cn_spot_lock.release()

    # ── 单只 A 股实时行情 ────────────────────────────────────────────────────

    def _fetch_single_quote(self, symbol: str) -> Optional[dict]:
        """
        获取单只 A 股实时行情。
        主数据源：stock_zh_a_spot（新浪财经全量实时行情，3min 缓存）
        降级：stock_zh_a_hist_tx（腾讯财经历史日线，取最近一天收盘价）

        ⚠️ 注意：stock_zh_a_hist_tx 是历史日线接口，盘中取到的是昨天收盘价，
           不是实时价格，仅作为 stock_zh_a_spot 不可用时的降级方案。
        """
        tx_symbol = self._add_market_prefix(symbol)

        # 主路径：从全量实时行情快照中查找
        try:
            spot_map = self._load_cn_spot()
            if spot_map and tx_symbol in spot_map:
                return spot_map[tx_symbol]
        except Exception as err:
            print(f"[AKShare] A股 {symbol} 实时行情查找失败: {err}", file=sys.stderr)

        # 降级路径：stock_zh_a_hist_tx（腾讯财经历史日线）
        # ⚠️ 此接口返回的是历史收盘价，盘中数据为昨天收盘价，非实时
        print(f"[AKShare] A股 {symbol} 降级到 stock_zh_a_hist_tx（历史日线）", file=sys.stderr)
        import akshare as ak

        today = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=10)).strftime("%Y%m%d")

        try:
            df = ak.stock_zh_a_hist_tx(
                symbol=tx_symbol,
                start_date=start,
                end_date=today,
            )
            if df is None or df.empty:
                return None

            latest = df.iloc[-1]
            close = self.safe_float(latest["close"])
            prev_close = self.safe_float(df.iloc[-2]["close"]) if len(df) >= 2 else close
            change = round(close - prev_close, 4)
            change_percent = round((change / prev_close * 100) if prev_close else 0.0, 4)

            return {
                "price": close,
                "change": change,
                "change_percent": change_percent,
                "open": self.safe_float(latest["open"]),
                "high": self.safe_float(latest["high"]),
                "low": self.safe_float(latest["low"]),
                "previous_close": prev_close,
                "volume": 0,
            }
        except Exception as err:
            print(f"[AKShare] A股 {symbol} 获取失败（腾讯财经降级）: {err}", file=sys.stderr)
            return None

    # ── BaseStockProvider 接口实现 ────────────────────────────────────────────

    def get_quotes(self, symbols: list[str]) -> list[QuoteData]:
        """
        逐只获取 A 股实时行情（stock_zh_a_hist_tx 腾讯财经取最新一天）。
        股票名称从缓存的股票列表获取（仅使用已缓存数据，不触发网络请求），
        确保行情数据获取不受股票列表加载失败或超时的影响。
        """
        # 仅使用已有缓存，不主动触发 stock_info_a_code_name() 网络请求
        # 原因：stock_info_a_code_name() 内部有 tqdm 进度条且可能超时，
        # 会阻塞行情获取；名称仅用于展示，不影响核心数据
        global _stock_list_cache
        name_map = {item["code"]: item["name"] for item in _stock_list_cache}

        now_ts = int(time.time())

        result = []
        for symbol in symbols:
            raw = self._fetch_single_quote(symbol)
            if raw:
                result.append(QuoteData(
                    symbol=symbol,
                    name=name_map.get(symbol, symbol),
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
        return result

    def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        """
        搜索 A 股股票。
        优先使用已缓存的股票列表进行模糊匹配（无网络请求）；
        若缓存为空（stock_info_a_code_name 未加载），则对纯数字查询直接验证代码有效性。
        """
        query_lower = query.lower().strip()

        # 优先使用已缓存的股票列表（不触发网络请求）
        global _stock_list_cache
        if _stock_list_cache:
            results = []
            for item in _stock_list_cache:
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

        # 缓存为空时：对纯数字查询，直接尝试获取行情验证代码有效性
        # 原因：stock_info_a_code_name() 内部有 tqdm 进度条且可能超时，
        # 不适合在搜索路径中调用；纯数字查询通常是用户直接输入代码
        if query_lower.isdigit() and 4 <= len(query_lower) <= 6:
            raw = self._fetch_single_quote(query_lower.zfill(6))
            if raw:
                symbol = query_lower.zfill(6)
                return [SearchResult(
                    symbol=symbol,
                    display_symbol=symbol,
                    description="A股",
                    market_type="A股",
                )]

        return []

    def get_history(self, symbol: str, start_date: str, end_date: str) -> list[HistoricalBar]:
        """A 股历史 K 线（stock_zh_a_hist，东方财富）"""
        import akshare as ak

        start_fmt = start_date.replace("-", "")
        end_fmt = end_date.replace("-", "")

        df = ak.stock_zh_a_hist(
            symbol=symbol,
            period="daily",
            start_date=start_fmt,
            end_date=end_fmt,
            adjust="",
        )
        if df is None or df.empty:
            return []

        return [
            HistoricalBar(
                date=str(row["日期"]),
                open=round(self.safe_float(row["开盘"]), 4),
                high=round(self.safe_float(row["最高"]), 4),
                low=round(self.safe_float(row["最低"]), 4),
                close=round(self.safe_float(row["收盘"]), 4),
                volume=self.safe_int(row["成交量"]),
                source="akshare",
            )
            for _, row in df.iterrows()
        ]
