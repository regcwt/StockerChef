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

/** 关键指数行情 */
export interface IndexQuote {
  /** 指数代码，如 '000001.SH'、'^IXIC' */
  symbol: string;
  /** 指数名称，如 '上证指数' */
  name: string;
  /** 最新点位 */
  price: number;
  /** 涨跌额 */
  change: number;
  /** 涨跌幅（百分比，如 1.23 表示 +1.23%） */
  changePercent: number;
}

/** 对话中的单条消息 */
export interface ConversationMessage {
  /** 唯一 ID */
  id: string;
  /** 消息角色：user = 用户，assistant = AI */
  role: 'user' | 'assistant';
  /** 消息内容（Markdown 格式） */
  content: string;
  /** 创建时间，ISO 8601 格式 */
  createdAt: string;
}

/** 一次完整的分析对话（包含多轮问答） */
export interface Conversation {
  /** 唯一 ID，格式：timestamp-random */
  id: string;
  /** 对话标题，自动取第一条用户消息的前 20 字 */
  title: string;
  /** 关联的股票代码（可选，用于 StockInfoBar 展示） */
  symbol?: string;
  /** 消息列表，按时间正序 */
  messages: ConversationMessage[];
  /** 创建时间，ISO 8601 格式 */
  createdAt: string;
  /** 最后更新时间，ISO 8601 格式 */
  updatedAt: string;
}

/** 用户个人资料（头像 + 用户名） */
export interface UserProfile {
  /** 用户名，默认随机生成 */
  username: string;
  /** 头像：base64 图片字符串（用户上传）；为空时使用随机 emoji 头像 */
  avatar?: string;
  /** emoji 头像（随机分配，无自定义图片时展示） */
  emojiAvatar: string;
}

/** @deprecated 使用 Conversation + ConversationMessage 替代 */
export interface StockQuestion {
  id: string;
  symbol: string;
  question: string;
  createdAt: string;
  answer?: string;
  answeredAt?: string;
}
