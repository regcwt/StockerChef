export interface Stock {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  marketCap?: number;
  peRatio?: number;
  high52Week?: number;
  low52Week?: number;
  description?: string;
}

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
  previousClose?: number;
  timestamp: string;
}

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  summary?: string;
}

export interface AnalysisResult {
  symbol: string;
  rsi?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  recommendation: 'Buy' | 'Sell' | 'Hold';
  summary: string;
}

export interface StockProfile {
  name: string;
  exchange: string;
  marketCapitalization: number;
  ipo: string;
  country: string;
  industry: string;
  finnhubIndustry: string;
  weburl: string;
  logo: string;
  phone: string;
}

export interface SearchResult {
  symbol: string;
  description: string;
  displaySymbol: string;
  type: string;
}

export interface HistoricalDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalDataResult {
  data: HistoricalDataPoint[];
  /** 数据来源：akshare（优先）、yfinance（降级）、simulated（两者均不可用时的随机模拟） */
  source: 'akshare' | 'yfinance' | 'simulated';
  error?: string;
}

/** 用户在分析页面输入的问题记录 */
export interface StockQuestion {
  /** 唯一 ID，格式：timestamp-random */
  id: string;
  /** 关联的股票代码 */
  symbol: string;
  /** 用户输入的问题内容 */
  question: string;
  /** 创建时间，ISO 8601 格式 */
  createdAt: string;
}
