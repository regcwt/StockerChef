"""
StockerChef 数据提供器包

架构参考 TradingAgents-CN providers 设计：
  - base.py            — BaseStockProvider 抽象基类
  - cn_akshare.py      — A股 AKShare Provider（免费，无需 Token）
  - cn_eastmoney.py    — A股 东方财富 Provider（免费，无需 Token，批量实时行情）
  - cn_tushare.py      — A股 Tushare Provider（需要 Token，数据质量更高）
  - hk_akshare.py      — 港股 AKShare Provider（免费，无需 Token）
  - us_yfinance.py     — 美股 yfinance Provider（免费，无需 Token）
"""
from .base import BaseStockProvider, QuoteData, HistoricalBar, SearchResult
from .cn_akshare import CnAKShareProvider
from .cn_eastmoney import CnEastMoneyProvider
from .cn_tushare import CnTushareProvider
from .hk_akshare import HkAKShareProvider
from .us_yfinance import UsYFinanceProvider

__all__ = [
    "BaseStockProvider",
    "QuoteData",
    "HistoricalBar",
    "SearchResult",
    "CnAKShareProvider",
    "CnEastMoneyProvider",
    "CnTushareProvider",
    "HkAKShareProvider",
    "UsYFinanceProvider",
]
