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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
