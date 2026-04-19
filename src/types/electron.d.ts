export interface ElectronAPI {
  /** 窗口控制（自定义标题栏按钮） */
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  getStore: (key: string) => Promise<unknown>;
  setStore: (key: string, value: unknown) => Promise<boolean>;
  /**
   * 获取股票历史 K 线数据（双数据源：AKShare 优先，yfinance 降级）
   * 返回 JSON 字符串，需调用方自行 JSON.parse()
   * 成功：{ data: HistoricalDataPoint[], source: 'akshare' | 'yfinance' } 的 JSON 字符串
   * 失败：{ error: string, message: string } 的 JSON 字符串
   */
  getStockHistory: (symbol: string, startDate: string, endDate: string) => Promise<string>;
  /** 读取用户设置项（存储在 electron-store 的 settings.* 命名空间） */
  getSettings: (key: string) => Promise<unknown>;
  /** 写入用户设置项 */
  setSettings: (key: string, value: unknown) => Promise<boolean>;
  /** 发送系统通知（股价/涨幅阈值触发提醒） */
  showNotification: (title: string, body: string) => Promise<void>;
  /**
   * 获取 A 股实时行情（通过 AKShare stock_zh_a_spot）
   * symbols: 逗号分隔的 6 位纯数字代码，如 "000001,600519"
   * 返回 JSON 字符串：Quote[] 或 { error, message }
   */
  getCNQuote: (symbols: string) => Promise<string>;
  /**
   * 搜索 A 股（从 AKShare 全量数据中模糊匹配代码/名称）
   * 返回 JSON 字符串：SearchResult[] 或 { error, message }
   */
  searchCNSymbol: (query: string) => Promise<string>;
  /**
   * 获取港股实时行情（东方财富 push2，secid 格式 90.XXXXX，支持 XXXXX.HK 格式）
   * 优先东方财富 HTTP API，失败时降级到 Python AKShare stock_hk_spot
   * symbols: 逗号分隔的港股代码，如 "03690.HK,00700.HK"
   * 返回 JSON 字符串：Quote[] 或 { error, message }
   */
  getHKQuote: (symbols: string) => Promise<string>;
  /**
   * 获取美股实时行情（东方财富 push2，按 ticker 白名单精准选择 105/106 市场代码）
   * 优先东方财富 HTTP API，失败时降级到 Python Provider 链（Finnhub → yfinance）
   * symbols: 逗号分隔的美股代码，如 "AAPL,MSFT,TSLA"
   * 返回 JSON 字符串：Quote[] 或 { error, message }
   */
  getUSQuote: (symbols: string) => Promise<string>;
  /**
   * 获取关键指数行情（上证、科创综指、纳斯达克、标普500、恒生、恒生科技）
   * 数据源：A 股指数 → AKShare stock_zh_index_spot_sina；港美指数 → yfinance
   * 返回 JSON 字符串：IndexQuote[] 或 { error, message }
   */
  getIndices: () => Promise<string>;
  /**
   * 获取预置股票数据（本地 JSON 文件，用于快速搜索）
   * market: 'cn' | 'hk' | 'us'
   * 返回 JSON 字符串：Array<{symbol: string, name: string, market: string}> 或 []
   */
  getPresetStockData: (market: 'cn' | 'hk' | 'us') => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
