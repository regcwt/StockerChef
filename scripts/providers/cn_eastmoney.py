"""
CnEastMoneyProvider — A股东方财富实时行情数据提供器

数据源：东方财富 push2 HTTP API（免费，无需 Token）
  - 实时行情：https://push2.eastmoney.com/api/qt/ulist.np/get
             批量获取多只股票的实时价格、涨跌额、涨跌幅、名称
  - 历史 K 线：不支持（由 CnAKShareProvider 负责）
  - 搜索：不支持（由 CnAKShareProvider 负责）

优势：
  - 批量请求：一次 HTTP 请求获取所有自选股行情，无需逐只请求
  - 速度极快：直接 HTTP JSON 接口，无 tqdm 进度条污染问题
  - 数据实时：返回当前实时价格（非历史日线收盘价）

API 字段说明：
  f2  = 最新价
  f3  = 涨跌幅（%）
  f4  = 涨跌额
  f12 = 股票代码（6 位纯数字）
  f14 = 股票名称

市场前缀规则（secids 参数）：
  6 开头（上交所）→ 1.600519
  其他（深交所）  → 0.000001
  8/4 开头（北交所）→ 0.830946

⚠️ 网络注意：东方财富 push2 接口对 Python urllib/requests 有 SSL/TLS 层面的限制，
   会返回 RemoteDisconnected 错误。使用 subprocess 调用系统 curl 可绕过此限制。
   curl 不可用时自动降级到 urllib（可能失败）。

缓存策略：无（每次调用都实时请求，批量接口速度足够快）
"""
import sys
import time
import json
import subprocess
import urllib.request
import urllib.parse

from .base import BaseStockProvider, QuoteData, HistoricalBar, SearchResult

# 东方财富批量行情接口
_EASTMONEY_QUOTE_URL = "https://push2.eastmoney.com/api/qt/ulist.np/get"
_EASTMONEY_UT = "b2884a393a59ad64002292a3e90d46a5"
_REQUEST_TIMEOUT = 10  # 秒


class CnEastMoneyProvider(BaseStockProvider):
    """
    A股东方财富实时行情数据提供器。
    免费无需 Token，批量 HTTP 接口，速度快，数据实时。
    仅支持实时行情（get_quotes），不支持历史 K 线和搜索。

    ⚠️ 使用 subprocess curl 发起请求，绕过东方财富对 Python HTTP 客户端的 SSL 限制。
    """

    @property
    def provider_name(self) -> str:
        return "EastMoney"

    def is_available(self) -> bool:
        """始终可用（依赖系统 curl 或标准库 urllib）"""
        return True

    # ── 市场前缀辅助 ─────────────────────────────────────────────────────────

    @staticmethod
    def _to_secid(symbol: str) -> str:
        """
        将 6 位 A 股代码转换为东方财富 secid 格式。
        上交所（6 开头）→ 1.xxxxxx
        深交所（其他）  → 0.xxxxxx
        北交所（8/4 开头）→ 0.xxxxxx
        """
        if symbol.startswith("6"):
            return f"1.{symbol}"
        return f"0.{symbol}"

    # ── 批量实时行情（curl 实现）─────────────────────────────────────────────

    def _fetch_via_curl(self, url: str) -> str:
        """
        通过 subprocess 调用系统 curl 发起 HTTP 请求。
        东方财富 push2 接口对 Python urllib/requests 有 SSL/TLS 限制，
        curl 可绕过此限制正常获取数据。
        """
        result = subprocess.run(
            [
                "curl", "-s",
                "--max-time", str(_REQUEST_TIMEOUT),
                "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "-H", "Referer: https://www.eastmoney.com/",
                "-H", "Accept: application/json, text/plain, */*",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=_REQUEST_TIMEOUT + 5,
        )
        if result.returncode != 0:
            raise RuntimeError(f"curl 返回非零退出码 {result.returncode}: {result.stderr.strip()}")
        if not result.stdout.strip():
            raise RuntimeError("curl 返回空响应")
        return result.stdout

    def _fetch_via_urllib(self, url: str) -> str:
        """
        通过 urllib 发起 HTTP 请求（备用方案，东方财富可能拒绝）。
        """
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://www.eastmoney.com/",
                "Accept": "application/json, text/plain, */*",
            },
        )
        with urllib.request.urlopen(req, timeout=_REQUEST_TIMEOUT) as response:
            return response.read().decode("utf-8")

    def _fetch_batch_quotes(self, symbols: list[str]) -> dict[str, dict]:
        """
        批量获取 A 股实时行情。
        返回 dict，key 为 6 位代码，value 为行情字段。
        优先使用 curl，失败时降级到 urllib。

        API 文档参考：docs/东方财富API文档.md
        """
        secids = ",".join(self._to_secid(s) for s in symbols)
        params = urllib.parse.urlencode({
            "fltt": "2",
            "invt": "2",
            "fields": "f2,f3,f4,f12,f14",
            "secids": secids,
            "ut": _EASTMONEY_UT,
            "np": "1",
            "pi": "0",
            "pz": str(len(symbols)),
        })
        url = f"{_EASTMONEY_QUOTE_URL}?{params}"

        # 优先使用 curl（绕过东方财富对 Python HTTP 客户端的 SSL 限制）
        raw = None
        try:
            raw = self._fetch_via_curl(url)
        except Exception as curl_err:
            print(f"[EastMoney] curl 请求失败: {curl_err}，降级到 urllib", file=sys.stderr)
            try:
                raw = self._fetch_via_urllib(url)
            except Exception as urllib_err:
                print(f"[EastMoney] urllib 请求也失败: {urllib_err}", file=sys.stderr)
                return {}

        data = json.loads(raw)
        if data.get("rc") != 0 or not data.get("data"):
            return {}

        result: dict[str, dict] = {}
        for item in data["data"].get("diff", []):
            code = str(item.get("f12", "")).zfill(6)
            price = self.safe_float(item.get("f2"))
            change_percent = self.safe_float(item.get("f3"))
            change = self.safe_float(item.get("f4"))
            name = str(item.get("f14", ""))
            result[code] = {
                "price": price,
                "change": change,
                "change_percent": change_percent,
                "name": name,
                # 东方财富批量接口不返回 open/high/low/volume，置为 0
                "open": 0.0,
                "high": 0.0,
                "low": 0.0,
                "previous_close": round(price - change, 4) if price and change else 0.0,
                "volume": 0,
            }
        return result

    # ── BaseStockProvider 接口实现 ────────────────────────────────────────────

    def get_quotes(self, symbols: list[str]) -> list[QuoteData]:
        """
        批量获取 A 股实时行情（东方财富 push2 接口）。
        一次 HTTP 请求获取所有 symbols 的实时价格，速度极快。
        """
        if not symbols:
            return []

        now_ts = int(time.time())

        try:
            batch = self._fetch_batch_quotes(symbols)
        except Exception as err:
            print(f"[EastMoney] 批量行情请求失败: {err}", file=sys.stderr)
            return []

        result = []
        for symbol in symbols:
            raw = batch.get(symbol)
            if raw and raw["price"] > 0:
                result.append(QuoteData(
                    symbol=symbol,
                    name=raw["name"] or symbol,
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
            else:
                print(f"[EastMoney] {symbol} 未在返回数据中找到或价格为 0", file=sys.stderr)

        return result

    def get_indices(self) -> list[dict]:
        """
        从东方财富 push2 接口批量获取首页关键指数行情。

        指数 secid 映射（东方财富市场代码，共 8 个）：
          1.000001   → 上证指数   （上交所指数，市场代码 1）
          0.399001   → 深证成指   （深交所指数，市场代码 0）
          0.399006   → 创业板指   （深交所指数，市场代码 0）
          100.NDX    → 纳斯达克   （美股指数，市场代码 100）
          100.SPX    → 标普500    （美股指数，市场代码 100）
          100.DJIA   → 道琼斯     （美股指数，市场代码 100）
          100.HSI    → 恒生指数   （恒生在 push2 接口里归在市场代码 100）
          124.HSTECH → 恒生科技   （港股专属市场代码 124）

        ⚠️ 恒生指数 HSI 与恒生科技 HSTECH 市场代码不同，必须分别配置。

        返回格式与 main.py handle_get_indices() 一致：
          [{"symbol": "000001.SH", "name": "上证指数", "price": ..., "change": ..., "changePercent": ...}, ...]
        """
        # secid → (前端 symbol, 中文名)
        index_secid_map = {
            "1.000001":   ("000001.SH", "上证指数"),
            "0.399001":   ("399001.SZ", "深证成指"),
            "0.399006":   ("399006.SZ", "创业板指"),
            "100.NDX":    (".IXIC",     "纳斯达克"),
            "100.SPX":    (".INX",      "标普500"),
            "100.DJIA":   (".DJI",      "道琼斯"),
            "100.HSI":    ("HSI",       "恒生指数"),
            "124.HSTECH": ("HSTECH",    "恒生科技"),
        }

        secids = ",".join(index_secid_map.keys())
        params = urllib.parse.urlencode({
            "fltt": "2",
            "invt": "2",
            "fields": "f2,f3,f4,f12,f14",
            "secids": secids,
            "ut": _EASTMONEY_UT,
            "np": "1",
            "pi": "0",
            "pz": str(len(index_secid_map)),
        })
        url = f"{_EASTMONEY_QUOTE_URL}?{params}"

        raw = None
        try:
            raw = self._fetch_via_curl(url)
        except Exception as curl_err:
            print(f"[EastMoney] 指数 curl 请求失败: {curl_err}，降级到 urllib", file=sys.stderr)
            try:
                raw = self._fetch_via_urllib(url)
            except Exception as urllib_err:
                print(f"[EastMoney] 指数 urllib 请求也失败: {urllib_err}", file=sys.stderr)
                return []

        try:
            data = json.loads(raw)
        except Exception as parse_err:
            print(f"[EastMoney] 指数 JSON 解析失败: {parse_err}", file=sys.stderr)
            return []

        if data.get("rc") != 0 or not data.get("data"):
            print(f"[EastMoney] 指数接口返回异常: rc={data.get('rc')}", file=sys.stderr)
            return []

        # 构建 secid → 行情 的映射（东方财富返回的 f12 是代码，不含市场前缀）
        # 需要通过 f14（名称）或 f12（代码）反查 secid
        # 由于 f12 不含市场前缀，用名称匹配更可靠
        name_to_meta: dict[str, tuple[str, str]] = {}
        for secid, (frontend_symbol, name) in index_secid_map.items():
            name_to_meta[name] = (frontend_symbol, name)

        # 同时建立 f12 代码 → secid 的映射（用于代码匹配）
        code_to_secid: dict[str, str] = {}
        for secid in index_secid_map:
            code = secid.split(".", 1)[1]  # 去掉市场前缀
            code_to_secid[code] = secid

        results = []
        for item in data["data"].get("diff", []):
            f12 = str(item.get("f12", ""))
            f14 = str(item.get("f14", ""))
            price = self.safe_float(item.get("f2")) or 0.0
            change_pct = self.safe_float(item.get("f3")) or 0.0
            change = self.safe_float(item.get("f4")) or 0.0

            # 优先通过 f12 代码匹配 secid，再查 frontend_symbol
            secid = code_to_secid.get(f12)
            if secid and secid in index_secid_map:
                frontend_symbol, display_name = index_secid_map[secid]
            else:
                # 降级：通过名称匹配
                meta = name_to_meta.get(f14)
                if not meta:
                    print(f"[EastMoney] 未知指数: f12={f12}, f14={f14}", file=sys.stderr)
                    continue
                frontend_symbol, display_name = meta

            results.append({
                "symbol": frontend_symbol,
                "name": display_name,
                "price": round(price, 2),
                "change": round(change, 2),
                "changePercent": round(change_pct, 2),
            })

        return results

    def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        """东方财富 Provider 不支持搜索，返回空列表。"""
        return []

    def get_history(self, symbol: str, start_date: str, end_date: str) -> list[HistoricalBar]:
        """东方财富 Provider 不支持历史 K 线，返回空列表。"""
        return []
