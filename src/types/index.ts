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
