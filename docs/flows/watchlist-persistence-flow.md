# 自选股持久化流程

本文档详细说明自选股列表的完整生命周期：从用户操作到磁盘写入，以及应用启动时的加载流程。

## 存储位置

- **运行时**：`useStockStore.watchlist: string[]`（Zustand 内存状态）
- **持久化**：`electron-store` key `'watchlist'`，文件路径：`~/Library/Application Support/StockerChef/config.json`
  （`electron-store` 默认文件名为 `config.json`，`app.getPath('userData')` 在 macOS 下为 `~/Library/Application Support/<productName>`，`productName` 在 `package.json` 中配置为 `"StockerChef"`）

## 关键约束

- **key 不可更改**：`'watchlist'` 是硬编码的 key，修改会导致用户数据丢失
- **symbol 必须大写**：`addToWatchlist()` 中强制 `.toUpperCase().trim()`
- **去重**：`addToWatchlist()` 在添加前检查是否已存在，避免重复

## 添加股票流程

```
用户在搜索框选择股票
        │
        ▼
Dashboard.handleAddStock(symbol)
        │
        ▼
useStockStore.addToWatchlist(symbol)
  1. upperSymbol = symbol.toUpperCase().trim()
  2. 检查 currentWatchlist.includes(upperSymbol) → 已存在则直接返回
  3. newWatchlist = [...currentWatchlist, upperSymbol]
  4. set({ watchlist: newWatchlist })  ← 更新内存状态，触发 UI 重渲染
  5. await saveWatchlist()
        │
        ▼
useStockStore.saveWatchlist()
  await window.electronAPI.setStore('watchlist', get().watchlist)
        │  IPC: store-set
        ▼
main.ts: store.set('watchlist', value)
        │
        ▼
写入磁盘（同步完成）
```

## 删除股票流程

```
用户点击删除图标
        │
        ▼
Dashboard.handleRemoveStock(symbol)
  e.stopPropagation()  ← 阻止事件冒泡到卡片点击（导航到分析页）
        │
        ▼
useStockStore.removeFromWatchlist(symbol)
  1. newWatchlist = watchlist.filter(s => s !== symbol)
  2. set({ watchlist: newWatchlist })
  3. 同时清理 quotes 中的对应数据：delete newQuotes[symbol]
  4. set({ quotes: newQuotes })
  5. await saveWatchlist()
        │
        ▼
写入磁盘（同步完成）
```

## 应用启动加载流程

```
Electron 启动 → 加载 React 应用
        │
        ▼
Dashboard.tsx 挂载
  useEffect(() => {
    useStockStore.getState().loadWatchlist();
  }, []);
        │
        ▼
useStockStore.loadWatchlist()
  const saved = await window.electronAPI.getStore('watchlist')
  if (Array.isArray(saved)) {
    set({ watchlist: saved })
  }
        │
        ▼
watchlist 状态更新 → 触发 Dashboard 重渲染
        │
        ▼
另一个 useEffect 检测到 watchlist 变化
  → 触发 fetchAllQuotes()
  → 开始 10 秒轮询
```

## 常见错误场景

| 场景 | 表现 | 原因 |
|------|------|------|
| 首次启动无数据 | watchlist 为空 | 正常，electron-store 返回 `undefined`，`Array.isArray(undefined)` 为 false，不会报错 |
| IPC 调用失败 | 控制台报错，watchlist 不持久化 | `loadWatchlist` 和 `saveWatchlist` 有 try/catch，失败时只打印 console.error，不影响运行时状态 |
| 添加重复股票 | 无反应 | `addToWatchlist` 中的去重检查，属于正常行为 |
