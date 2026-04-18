# StockerChef 完整数据流

## 1. 自选股持久化流程

```
用户操作（添加/删除股票）
        │
        ▼
Dashboard.tsx
  handleAddStock(symbol) / handleRemoveStock(symbol)
        │
        ▼
useStockStore.addToWatchlist(symbol) / removeFromWatchlist(symbol)
  - 强制 symbol.toUpperCase().trim()
  - 更新内存中的 watchlist 数组
  - 调用 saveWatchlist()
        │
        ▼
window.electronAPI.setStore('watchlist', watchlist)
  [renderer 进程边界]
        │  contextBridge（preload.ts）
        ▼
ipcRenderer.invoke('store-set', 'watchlist', watchlist)
        │  IPC 通道
        ▼
ipcMain.handle('store-set', ...) [main.ts]
        │
        ▼electron-store（本地磁盘）
  存储路径：~/Library/Application Support/StockerChef/config.json
  （由 electron-store 默认行为决定：name='config', cwd=app.getPath('userData')）
```

## 关键边界说明```

## 2. 应用启动时加载自选股

```
App 启动
        │
        ▼
Dashboard.tsx useEffect（组件挂载）
  useStockStore.getState().loadWatchlist()
        │
        ▼
window.electronAPI.getStore('watchlist')
        │  IPC: store-get
        ▼
electron-store.get('watchlist') → string[]
        │
        ▼
useStockStore.set({ watchlist: saved })
        │
        ▼
触发 Dashboard 重渲染，显示已保存的自选股
        │
        ▼
useEffect 检测到 watchlist 变化，触发 fetchAllQuotes()
```

## 3. 实时报价轮询流程（Dashboard）

```
Dashboard 挂载 / watchlist 变化
        │
        ▼
useEffect 设置 setInterval(fetchAllQuotes, 10000)
        │
        ▼  每 10 秒触发
fetchAllQuotes()
  watchlist.map(symbol => getQuote(symbol))
        │  Promise.all 并发，但每个请求仍走限流队列
        ▼
stockApi.getQuote(symbol)
  → apiRequest() 限流队列（间隔 ~2000ms 出队）
        │
        ▼
axios.get('https://finnhub.io/api/v1/quote', { symbol, token })
        │
        ▼
Finnhub API 响应 { c, d, dp, h, l, o, pc }
        │  字段映射：c→price, d→change, dp→changePercent
        ▼
返回 Quote 对象
        │
        ▼
useStockStore.updateQuotes(validQuotes)
  → 更新 quotes Map
        │
        ▼
Dashboard 重渲染，股票卡片显示最新价格
```

## 4. 分析页数据流

```
用户点击股票卡片
        │
        ▼
navigate('/analysis/:symbol')
        │
        ▼
Analysis.tsx 挂载
  ├── useStockQuote(symbol, 10000)  → 每 10s 轮询报价
  ├── useStockNews(symbol)          → 一次性获取新闻（5min 缓存）
  └── useEffect → getProfile(symbol) → 一次性获取公司信息
        │
        ▼
用户点击"Technical Analysis"按钮
        │
        ▼
generateAnalysis()
  ⚠️ 注意：以下均为随机模拟值，非真实计算
  - RSI = 30 + Math.random() * 40
  - SMA20 = price * (0.95 + Math.random() * 0.1)
  - SMA50 = price * (0.9 + Math.random() * 0.2)
  - SMA200 = price * (0.8 + Math.random() * 0.4)
        │
        ▼
setAnalysis(result) → Modal 展示
```

## 5. 新闻缓存机制

```
useStockNews(symbol) 被调用
        │
        ▼
检查 newsCache.get(symbol)
  ├── 命中且未过期（< 5min）→ 直接返回缓存数据
  └── 未命中或已过期
            │
            ▼
        getNews(symbol) → apiRequest() → Finnhub company-news API
        获取最近 7 天新闻，最多返回 20 条
            │
            ▼
        newsCache.set(symbol, { data, timestamp: Date.now() })
            │
            ▼
        setNews(data) → 组件重渲染
```

## 关键边界说明

| 边界 | 说明 |
|------|------|
| renderer / main 进程边界 | 只能通过 `window.electronAPI` 跨越，不能直接 import electron 模块 |
| API 限流边界 | 所有 Finnhub 请求必须经过 `apiRequest()` 队列，间隔 ~2000ms |
| 新闻缓存边界 | `newsCache` 是模块级内存缓存，应用重启后失效 |
| 数据持久化边界 | 只有 `watchlist` 被持久化，`quotes` 和 `news` 是运行时数据 |
