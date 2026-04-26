import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制（自定义标题栏按钮）
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  // 通用存储
  getStore: (key: string) => ipcRenderer.invoke('store-get', key),
  setStore: (key: string, value: unknown) => ipcRenderer.invoke('store-set', key, value),
  getStockHistory: (symbol: string, startDate: string, endDate: string) =>
    ipcRenderer.invoke('stock-get-history', symbol, startDate, endDate),
  getSettings: (key: string) => ipcRenderer.invoke('settings-get', key),
  setSettings: (key: string, value: unknown) => ipcRenderer.invoke('settings-set', key, value),
  showNotification: (title: string, body: string) => ipcRenderer.invoke('show-notification', title, body),
  /** 自选股批量行情（混合市场，A 股 + 港股 + 美股一次拿，逗号分隔，返回 JSON 字符串） */
  getQuotes: (symbols: string) => ipcRenderer.invoke('stock-get-quotes', symbols),
  /** A 股实时行情（多只，逗号分隔代码，返回 JSON 字符串） */
  getCNQuote: (symbols: string) => ipcRenderer.invoke('stock-get-cn-quote', symbols),
  /** A 股搜索（返回 JSON 字符串） */
  searchCNSymbol: (query: string) => ipcRenderer.invoke('stock-search-cn', query),
  /** 港股实时行情（东方财富 push2，支持 XXXXX.HK 格式，返回 JSON 字符串） */
  getHKQuote: (symbols: string) => ipcRenderer.invoke('stock-get-hk-quote', symbols),
  /** 美股实时行情（东方财富 push2，按 ticker 白名单精准选择 105/106 市场代码，返回 JSON 字符串） */
  getUSQuote: (symbols: string) => ipcRenderer.invoke('stock-get-us-quote', symbols),
  /** 关键指数行情（上证、科创综指、纳斯达克、标普、恒生、恒生科技，返回 JSON 字符串） */
  getIndices: () => ipcRenderer.invoke('stock-get-indices'),
  /** 个股资讯（东方财富 search-api，返回 JSON 字符串：NewsItem[] 或 { error, message }） */
  getNews: (symbol: string) => ipcRenderer.invoke('stock-get-news', symbol),
  /** 公司详情（东方财富 emweb F10 + push2 stock/get 聚合，返回 JSON 字符串：CompanyDetail 或 { error, message }） */
  getCompanyDetail: (symbol: string) => ipcRenderer.invoke('stock-get-company-detail', symbol),
  /** 预置股票数据（本地 JSON 文件，用于快速搜索） */
  getPresetStockData: (market: 'cn' | 'hk' | 'us') =>
    ipcRenderer.invoke('stock-get-preset-data', market),
});
