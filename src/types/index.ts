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

/**
 * 公司详情（来自东方财富多个接口聚合：push2 扩展字段 + emweb F10）。
 *
 * 数据来源：
 * - **基础信息 / 估值 / 交易**：东方财富 push2 stock/get 接口（fields 扩展为 30+ 字段）
 * - **公司资料 / 财务摘要**：东方财富 emweb F10 接口（A股/港股/美股各一套）
 *
 * 所有字段全部 optional，因为不同市场（A 股 / 港股 / 美股）东方财富返回字段差异较大：
 * - A 股：字段最全（5 大类基本都有）
 * - 港股：缺所属概念、ROE、毛利率等
 * - 美股：仅有公司简介、行业、总市值、PE 等少量字段
 *
 * 字段命名约定：
 * - 价格 / 金额：number，单位与东方财富原始返回一致（具体见字段注释）
 * - 比率（涨跌幅 / 换手率 / 振幅）：number，百分比数值（如 1.23 表示 1.23%）
 * - 日期：string，`YYYY-MM-DD` 格式
 * - 大市值字段（marketCap / floatMarketCap）：number，单位**元**（不是百万元，与 Finnhub 不同）
 */
export interface CompanyDetail {
  // ── 基础信息 ──────────────────────────────────────────
  /** 公司全名（如「贵州茅台酒股份有限公司」） */
  companyName?: string;
  /** 股票简称（如「贵州茅台」） */
  shortName?: string;
  /** 所属行业（如「白酒行业」） */
  industry?: string;
  /** 所属概念 / 板块，多个用 `、` 分隔（仅 A 股有） */
  concepts?: string;
  /** 上市日期，`YYYY-MM-DD` 格式 */
  listingDate?: string;
  /** 上市交易所（如「上交所」「深交所」「港交所」「NASDAQ」「NYSE」） */
  exchange?: string;

  // ── 估值 ──────────────────────────────────────────────
  /** 总市值（单位：元） */
  marketCap?: number;
  /** 流通市值（单位：元） */
  floatMarketCap?: number;
  /** 总股本（单位：股） */
  totalShares?: number;
  /** 流通股本（单位：股） */
  floatShares?: number;
  /** 市盈率 TTM */
  peTTM?: number;
  /** 市净率 PB */
  pb?: number;
  /** 市销率 PS */
  ps?: number;

  // ── 交易 ──────────────────────────────────────────────
  /** 今开 */
  openPrice?: number;
  /** 昨收 */
  previousClose?: number;
  /** 当日最高 */
  dayHigh?: number;
  /** 当日最低 */
  dayLow?: number;
  /** 当日成交量（单位：股） */
  volume?: number;
  /** 当日成交额（单位：元） */
  turnover?: number;
  /** 换手率（百分比，如 1.23 表示 1.23%） */
  turnoverRate?: number;
  /** 振幅（百分比） */
  amplitude?: number;
  /** 52 周最高 */
  yearHigh?: number;
  /** 52 周最低 */
  yearLow?: number;

  // ── 公司资料 ──────────────────────────────────────────
  /** 注册地 */
  registeredAddress?: string;
  /** 办公地址 */
  officeAddress?: string;
  /** 董事长 */
  chairman?: string;
  /** 总经理 / CEO */
  ceo?: string;
  /** 员工人数 */
  employees?: number;
  /** 公司简介 */
  description?: string;
  /** 公司官网 */
  website?: string;

  // ── 财务（最新一期） ──────────────────────────────────
  /** 财报报告期，`YYYY-MM-DD` 格式（如「2024-09-30」） */
  reportDate?: string;
  /** 营业收入（单位：元） */
  revenue?: number;
  /** 净利润（单位：元） */
  netProfit?: number;
  /** 毛利率（百分比） */
  grossMargin?: number;
  /** 净资产收益率 ROE（百分比） */
  roe?: number;
  /** 每股收益 EPS（单位：元） */
  eps?: number;
  /** 每股净资产 BPS（单位：元） */
  bps?: number;
  /** 每股经营现金流（单位：元） */
  cashFlowPerShare?: number;
  /** 资产负债率（百分比） */
  debtAssetRatio?: number;
  /** 营收同比增长（百分比，可能为负） */
  revenueYoY?: number;
  /** 归母净利润同比增长（百分比，可能为负） */
  netProfitYoY?: number;

  /**
   * 财务历史趋势（最近 N 期，按报告期倒序，最近的在前）。
   * 仅 A 股有；港股 / 美股留空。
   */
  financialHistory?: FinanceSnapshot[];

  // ── 板块 / 概念 / 题材 ────────────────────────────────
  /**
   * 所属板块分类（A 股专有，来自 RPT_F10_CORETHEME_BOARDTYPE）。
   * 包括「行业」「地域板块」「概念板块」「题材板块」「指数成分」等多组。
   */
  boards?: BoardItem[];

  // ── 元数据 ────────────────────────────────────────────
  /** 数据所属市场，便于 UI 区分 */
  market?: 'cn' | 'hk' | 'us';
  /** 数据是否有部分缺失（用于 UI 提示「该市场仅支持部分字段」） */
  partial?: boolean;
}

/** 单期财务快照（用于 financialHistory） */
export interface FinanceSnapshot {
  /** 报告期 `YYYY-MM-DD` */
  reportDate: string;
  /** 营业收入（元） */
  revenue?: number;
  /** 归母净利润（元） */
  netProfit?: number;
  /** 毛利率（%） */
  grossMargin?: number;
  /** ROE（%） */
  roe?: number;
  /** 基本 EPS（元） */
  eps?: number;
}

/** 板块/概念/题材条目 */
export interface BoardItem {
  /** 板块代码（如 BK0438） */
  boardCode: string;
  /** 板块名称（如「食品饮料」「酿酒概念」） */
  boardName: string;
  /**
   * 板块类型：
   * - `industry` 行业
   * - `region` 地域板块
   * - `concept` 概念板块
   * - `theme` 题材
   * - `index` 指数成分
   * - `other` 其他
   */
  boardType: 'industry' | 'region' | 'concept' | 'theme' | 'index' | 'other';
  /** 入选理由（部分概念有，如「主营业务为...」） */
  reason?: string;
}
