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
  /** A 股实时行情（多只，逗号分隔代码，返回 JSON 字符串） */
  getCNQuote: (symbols: string) => ipcRenderer.invoke('stock-get-cn-quote', symbols),
  /** A 股搜索（返回 JSON 字符串） */
  searchCNSymbol: (query: string) => ipcRenderer.invoke('stock-search-cn', query),
  /** 港股实时行情（通过 yfinance，支持 XXXX.HK 格式，返回 JSON 字符串） */
  getHKQuote: (symbols: string) => ipcRenderer.invoke('stock-get-hk-quote', symbols),
  /** 关键指数行情（上证、科创综指、纳斯达克、标普、恒生、恒生科技，返回 JSON 字符串） */
  getIndices: () => ipcRenderer.invoke('stock-get-indices'),
  /** 预置股票数据（本地 JSON 文件，用于快速搜索） */
  getPresetStockData: (market: 'cn' | 'hk' | 'us') =>
    ipcRenderer.invoke('stock-get-preset-data', market),
});
