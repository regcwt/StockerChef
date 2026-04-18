"""
BaseStockProvider — 所有数据提供器的抽象基类

设计参考 TradingAgents-CN 的 BaseStockDataProvider，
但针对 StockerChef 的同步调用场景做了简化（去掉 async/await）。
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
import time


@dataclass
class QuoteData:
    """标准化实时行情数据"""
    symbol: str
    name: str
    price: float
    change: float
    change_percent: float
    open: float
    high: float
    low: float
    previous_close: float
    volume: int
    timestamp: int = field(default_factory=lambda: int(time.time()))


@dataclass
class HistoricalBar:
    """标准化历史 K 线数据（单根 Bar）"""
    date: str          # YYYY-MM-DD
    open: float
    high: float
    low: float
    close: float
    volume: int
    source: str        # 数据来源标注，如 'akshare' / 'tushare' / 'yfinance'


@dataclass
class SearchResult:
    """标准化搜索结果"""
    symbol: str
    display_symbol: str
    description: str
    market_type: str   # 'A股' / '港股' / '美股'


class BaseStockProvider(ABC):
    """
    股票数据提供器抽象基类。

    子类必须实现：
      - provider_name: str 属性
      - is_available() → bool
      - get_quotes(symbols) → list[QuoteData]
      - search(query) → list[SearchResult]
      - get_history(symbol, start_date, end_date) → list[HistoricalBar]
    """

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """提供器名称，用于日志和数据来源标注"""
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """
        检查当前提供器是否可用（依赖库已安装、Token 已配置等）。
        不发起网络请求，仅做本地检查。
        """
        ...

    @abstractmethod
    def get_quotes(self, symbols: list[str]) -> list[QuoteData]:
        """
        获取指定代码列表的实时行情。

        Args:
            symbols: 标准化后的代码列表（格式由子类定义）

        Returns:
            QuoteData 列表，获取失败的代码静默跳过
        """
        ...

    @abstractmethod
    def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        """
        搜索股票代码或名称。

        Args:
            query: 搜索关键词（代码前缀或名称关键词）
            limit: 最多返回条数

        Returns:
            SearchResult 列表
        """
        ...

    @abstractmethod
    def get_history(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
    ) -> list[HistoricalBar]:
        """
        获取历史 K 线数据。

        Args:
            symbol: 股票代码
            start_date: 开始日期，YYYY-MM-DD
            end_date: 结束日期，YYYY-MM-DD

        Returns:
            HistoricalBar 列表，按日期升序排列
        """
        ...

    # ── 辅助工具方法 ──────────────────────────────────────────────────────────

    @staticmethod
    def safe_float(value, default: float = 0.0) -> float:
        """安全转换为浮点数，None/空/NaN 返回 default"""
        try:
            if value is None or value == "":
                return default
            result = float(value)
            return default if result != result else result  # NaN 检查
        except (ValueError, TypeError):
            return default

    @staticmethod
    def safe_int(value, default: int = 0) -> int:
        """安全转换为整数"""
        try:
            if value is None or value == "":
                return default
            return int(float(value))
        except (ValueError, TypeError):
            return default

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(available={self.is_available()})>"
