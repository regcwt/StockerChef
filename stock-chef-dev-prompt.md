# StockerChef — 产品设计文档

> **文档定位**：本文档是 StockerChef 的产品功能规划文档，记录已实现功能的设计意图，以及未来迭代方向。开发时以 `AGENTS.md` 为技术约束首要参考，以本文档为功能需求首要参考。

---

## 一、项目定位

**StockerChef** 是一款面向个人投资者的 macOS 桌面股票看板应用，核心价值是：

- **零切换成本**：在桌面常驻，无需打开浏览器或手机 App
- **自选股聚焦**：只看自己关心的股票，信息密度高、噪音低
- **轻量分析辅助**：提供基础技术指标参考，帮助用户形成初步判断

**目标用户**：有一定投资经验、主要关注美股市场、习惯在 Mac 上工作的个人投资者。

**数据来源**：Finnhub 免费 API（美股，60次/分钟限额）。

---

## 二、技术栈

| 层次 | 技术选型 | 说明 |
|------|----------|------|
| 桌面容器 | Electron | macOS 原生窗口，IPC 安全通信 |
| 前端框架 | React 18 + TypeScript | 严格类型，`noUnusedLocals: true` |
| 构建工具 | Vite + `vite-plugin-electron` | 同时构建 renderer 和 main 进程 |
| UI 组件库 | Ant Design 5.x | 跟随系统深色/浅色模式 |
| 状态管理 | Zustand | 全局 watchlist 和 quotes 状态 |
| HTTP 客户端 | Axios | 所有请求必须经过 `apiRequest()` 限流队列 |
| 本地持久化 | electron-store | 存储路径：`~/Library/Application Support/stocker-chef/` |
| 路由 | React Router v6 | 两个主路由：`/` 和 `/analysis/:symbol` |

---

## 三、已实现功能（v1.0 基线）

### 3.1 股票仪表盘（`/`）

**自选股管理**
- 搜索框实时搜索 Finnhub 股票代码（输入即触发，结果最多展示 5 条）
- 点击搜索结果一键添加到自选股列表，symbol 自动转大写
- 每张股票卡片右上角有删除按钮，点击移除自选股
- 自选股列表通过 IPC 持久化到 `electron-store`，key 固定为 `'watchlist'`

**实时报价展示**
- 卡片式布局，响应式网格（xs:1列 / sm:2列 / md:3列 / lg:4列）
- 每张卡片展示：股票代码、最新价、涨跌额、涨跌幅百分比
- 涨跌颜色：上涨绿色（`#52c41a`）、下跌红色（`#ff4d4f`），卡片左边框同色
- 报价每 10 秒自动轮询刷新，支持手动点击"Refresh All Quotes"按钮触发
- 加载中显示 Spin 占位，API 限流时展示 Warning Alert

**导航**
- 点击股票卡片跳转到 `/analysis/:symbol` 分析页

---

### 3.2 股票分析页（`/analysis/:symbol`）

**顶部报价区**
- 展示股票代码、公司名称、最新价、涨跌幅
- 报价通过 `useStockQuote` hook 每 10 秒自动刷新

**详情 Tab**
- 通过 Finnhub `stock/profile2` 接口获取公司基本信息
- 展示字段：公司名称、Symbol、市值（⚠️ 当前展示值偏小 100 万倍，已知 Bug）、行业/国家、开盘价、昨收价、日内高低、成交量、最后更新时间

**新闻 Tab**
- 获取最近 7 天内最多 20 条相关新闻
- 展示：标题（可点击跳转原文）、来源、发布时间、摘要（截断展示）
- 内置 5 分钟内存缓存，减少重复 API 调用

**技术分析 Modal**
- 点击"Technical Analysis"按钮触发
- 展示模拟指标：RSI(14)、SMA20、SMA50、SMA200
- 根据 RSI 和均线位置输出 Buy / Hold / Sell 建议
- ⚠️ **所有指标均为随机模拟值**，页面内有免责声明，不可用于真实投资决策

---

### 3.3 基础设施

**API 限流队列**（`src/services/stockApi.ts`）
- 最大 30 次/分钟（Finnhub 免费层 60次/分钟的 50%）
- 请求间隔约 2000ms，超出时自动排队等待
- 统一错误处理：429 限流、401 鉴权失败、网络错误

**IPC 安全通信**
- `contextIsolation: true` + `nodeIntegration: false`
- Renderer 只能通过 `window.electronAPI.getStore()` / `window.electronAPI.setStore()` 访问本地存储

**主题系统**（`src/theme/config.ts`）
- 自动跟随 macOS 系统深色/浅色模式
- 主色调 `#1890ff`，圆角 `8px`

---

## 四、待实现功能（Backlog）

> 以下功能按优先级排序，P0 最高。实现时须遵守 `AGENTS.md` 中的所有约束。

---

### P0：修复已知 Bug

#### BUG-001 修复：市值展示单位错误
- **问题**：`getProfile()` 返回的 `marketCapitalization` 单位是百万美元，但 `formatMarketCap()` 将其当作美元处理，导致展示值偏小 100 万倍
- **修复方案 A**：在 `getProfile()` 中将 `data.marketCapitalization * 1_000_000` 后再赋值给 `Stock.marketCap`
- **修复方案 B**：修改 `formatMarketCap()` 接受百万美元单位的输入，内部乘以 `1_000_000` 后再换算
- **推荐方案 B**：改动范围更小，只需修改 `src/utils/format.ts`，不影响数据层

#### BUG-002 修复：搜索结果不自动清空
- **问题**：点击搜索框外部空白处，搜索结果下拉列表不会关闭
- **修复方案**：在搜索 Input 上添加 `onBlur` 处理，延迟 200ms 后清空 `searchResults`（延迟是为了让点击搜索结果的事件先触发）

#### BUG-004 修复：TypeScript 编译错误
- 删除 `App.tsx` 中未使用的 `theme` import
- 将 `Analysis.tsx` 中 `<Text ellipsis={{ rows: 2 }}>` 改为 `<Typography.Paragraph ellipsis={{ rows: 2 }}>`
- 从 `Dashboard.tsx` 解构中移除未使用的 `updateQuote` 和 `loading`

---

### P1：仪表盘增强

#### 1.1 股票卡片展示公司名称
- **现状**：卡片只显示 symbol（如 `AAPL`），不显示公司名称
- **需求**：在 symbol 下方展示公司简称（如 `Apple Inc.`）
- **实现思路**：在 `addToWatchlist()` 时同步调用 `getProfile()` 获取公司名，存入新的持久化字段（key: `'stockNames'`，格式：`Record<string, string>`）；卡片渲染时从该字段读取

#### 1.2 自选股排序与分组
- **需求**：支持用户手动拖拽排序自选股卡片
- **实现思路**：引入 `@dnd-kit/core` 实现拖拽排序，排序结果持久化到 `electron-store`（key: `'watchlistOrder'`）
- **约束**：不修改 `'watchlist'` key 的存储格式，排序信息单独存储

#### 1.3 涨跌幅排行榜视图
- **需求**：在仪表盘顶部增加一个迷你排行榜，展示自选股中涨幅最大和跌幅最大的各 3 只
- **实现思路**：基于 `quotes` 状态计算，无需新增 API 调用；使用 Ant Design `Statistic` 组件展示

#### 1.4 价格提醒（系统通知）
- **需求**：用户可为每只股票设置价格上限/下限提醒，触发时发送 macOS 系统通知
- **实现思路**：
  1. 新增 IPC 通道 `notify`，在 `main.ts` 中使用 Electron `Notification` API
  2. 在 `preload.ts` 暴露 `window.electronAPI.notify(title, body)`
  3. 更新 `electron.d.ts` 类型声明
  4. 在 `useStockStore.ts` 新增 `priceAlerts` 状态（key: `'priceAlerts'`，格式：`Record<string, { upper?: number; lower?: number }>`）
  5. 在报价刷新逻辑中检查是否触发提醒

---

### P2：分析页增强

#### 2.1 52 周高低价展示
- **现状**：`Stock` 类型已定义 `high52Week` 和 `low52Week` 字段，但 `getProfile()` 未填充这两个字段
- **需求**：在详情 Tab 中展示 52 周最高价和最低价，以及当前价格在区间内的位置（进度条）
- **实现思路**：Finnhub `stock/profile2` 接口不提供 52 周数据，需调用 `metric` 接口（`/stock/metric?symbol=AAPL&metric=all`）获取 `52WeekHigh` 和 `52WeekLow`；在 `stockApi.ts` 新增 `getMetrics(symbol)` 函数

#### 2.2 同行业对比
- **需求**：在分析页新增"同行业对比"Tab，展示同行业 3-5 只股票的关键指标对比（市值、涨跌幅）
- **实现思路**：Finnhub 提供 `/stock/peers` 接口返回同行业股票列表；对列表中的股票批量调用 `getQuote()`，结果以表格形式展示
- **约束**：批量请求必须走 `apiRequest()` 队列，不能并发直接调用

#### 2.3 历史走势迷你图
- **需求**：在股票卡片和分析页顶部展示最近 30 天的价格走势迷你折线图
- **实现思路**：引入 `recharts` 库（轻量，与 Ant Design 兼容好）；历史数据来源需要 Finnhub 付费接口，**免费层替代方案**：使用 Yahoo Finance 非官方 API 或在 UI 上明确标注"历史图表需要付费 API"
- **约束**：如使用模拟数据，必须在图表上方显示"模拟数据"标签

#### 2.4 财务指标展示
- **需求**：在详情 Tab 新增财务指标区块，展示 P/E Ratio、EPS、ROE、Debt/Equity 等
- **实现思路**：调用 Finnhub `/stock/metric?metric=all` 接口；在 `src/types/index.ts` 新增 `StockMetrics` 类型；在 `stockApi.ts` 新增 `getMetrics(symbol)` 函数

---

### P3：体验优化

#### 3.1 全局搜索快捷键
- **需求**：按下 `Cmd+K` 打开全局搜索框（类似 Spotlight），可快速搜索并跳转到股票分析页
- **实现思路**：在 `App.tsx` 中监听 `keydown` 事件；使用 Ant Design `Modal` + `Input.Search` 实现搜索 UI

#### 3.2 自选股导入/导出
- **需求**：支持将自选股列表导出为 CSV 文件，以及从 CSV 文件批量导入
- **实现思路**：
  1. 新增 IPC 通道 `export-watchlist` 和 `import-watchlist`，在 `main.ts` 中使用 `dialog.showSaveDialog()` / `dialog.showOpenDialog()` 和 `fs` 模块处理文件
  2. 在 `preload.ts` 暴露对应方法
  3. 在 Dashboard 顶部添加导入/导出按钮

#### 3.3 刷新倒计时显示
- **需求**：在仪表盘右下角显示距离下次自动刷新的倒计时（如"下次刷新：8s"）
- **实现思路**：在 `Dashboard.tsx` 中新增 `countdown` 状态，每秒递减，刷新时重置为 10

#### 3.4 空状态引导优化
- **现状**：watchlist 为空时显示 Ant Design 默认 `Empty` 组件，文案简单
- **需求**：替换为更友好的引导页，包含：示例股票代码（AAPL、TSLA、MSFT）的快速添加按钮、简短的使用说明

#### 3.5 键盘导航支持
- **需求**：在仪表盘支持方向键选择股票卡片，Enter 键跳转分析页，Delete 键删除选中股票
- **实现思路**：在 `Dashboard.tsx` 中维护 `selectedIndex` 状态，监听 `keydown` 事件

---

### P4：架构升级（长期）

#### 4.1 修复技术分析为真实计算
- **现状**：RSI、SMA 均为随机模拟值
- **需求**：接入真实历史 K 线数据，计算真实技术指标
- **数据来源选项**：
  - Finnhub 付费层（`/stock/candle` 接口）
  - Alpha Vantage 免费层（每分钟 5 次，每天 500 次）
  - Yahoo Finance 非官方 API（不稳定，不推荐生产使用）
- **实现约束**：修复后必须移除 UI 上的"模拟数据"免责声明，并在 `AGENTS.md` 的 3.3 节更新约束

#### 4.2 多数据源支持
- **需求**：支持切换数据源（Finnhub / Alpha Vantage），在设置页配置 API Key
- **实现思路**：抽象 `IStockDataProvider` 接口，`stockApi.ts` 改为工厂模式；新增设置页 `/settings`

#### 4.3 投资组合追踪
- **需求**：支持记录持仓（买入价、数量），计算盈亏
- **实现思路**：新增 `Portfolio` 类型和持久化存储（key: `'portfolio'`）；新增 `/portfolio` 路由页面
- **约束**：持仓数据不得与实时报价数据混存，分开持久化

#### 4.4 数据导出与备份
- **需求**：支持将自选股、持仓记录、价格提醒配置一键导出为 JSON 备份文件，并支持从备份恢复
- **实现思路**：在 `main.ts` 中实现完整的 `electron-store` 序列化/反序列化逻辑

---

## 五、数据类型规划

### 已定义（`src/types/index.ts`）

```typescript
Quote           // 实时报价：symbol, price, change, changePercent, high, low, open, previousClose, volume, timestamp
Stock           // 股票基本信息：symbol, name, price, change, changePercent, marketCap?, peRatio?, high52Week?, low52Week?, description?
NewsItem        // 新闻条目：title, source, publishedAt, url, summary?
AnalysisResult  // 技术分析（模拟）：symbol, rsi?, sma20?, sma50?, sma200?, recommendation, summary
StockProfile    // Finnhub 公司档案（API 原始格式）：name, exchange, marketCapitalization, country, industry...
SearchResult    // 搜索结果：symbol, description, displaySymbol, type
```

### 待新增（随功能迭代补充到 `src/types/index.ts`）

```typescript
// P1.4 价格提醒
interface PriceAlert {
  upper?: number;   // 价格上限，触发时通知
  lower?: number;   // 价格下限，触发时通知
}
// 存储格式：Record<string, PriceAlert>，key 为 symbol

// P2.4 财务指标
interface StockMetrics {
  peRatio?: number;           // 市盈率（TTM）
  eps?: number;               // 每股收益
  roe?: number;               // 净资产收益率（%）
  debtToEquity?: number;      // 负债权益比
  high52Week?: number;        // 52 周最高价
  low52Week?: number;         // 52 周最低价
  dividendYield?: number;     // 股息率（%）
}

// P4.3 持仓记录
interface PortfolioPosition {
  symbol: string;
  shares: number;             // 持仓数量
  averageCost: number;        // 平均成本价（USD）
  purchasedAt: string;        // 首次买入时间（ISO 8601）
}
```

---

## 六、API 接口规划

### 已实现（`src/services/stockApi.ts`）

| 函数 | Finnhub 接口 | 说明 |
|------|-------------|------|
| `getQuote(symbol)` | `GET /quote` | 实时报价 |
| `getProfile(symbol)` | `GET /stock/profile2` | 公司基本信息 |
| `getNews(symbol)` | `GET /company-news` | 最近 7 天新闻（最多 20 条） |
| `searchSymbol(query)` | `GET /search` | 股票代码搜索 |

### 待实现

| 函数 | Finnhub 接口 | 对应功能 |
|------|-------------|---------|
| `getMetrics(symbol)` | `GET /stock/metric?metric=all` | P2.1 52周高低 / P2.4 财务指标 |
| `getPeers(symbol)` | `GET /stock/peers` | P2.2 同行业对比 |
| `getCandles(symbol, resolution, from, to)` | `GET /stock/candle` | P4.1 真实历史 K 线（付费） |

---

## 七、IPC 通道规划

### 已实现

| 通道名 | 方向 | 说明 |
|--------|------|------|
| `store-get` | renderer → main | 读取 electron-store |
| `store-set` | renderer → main | 写入 electron-store |

### 待实现

| 通道名 | 方向 | 对应功能 |
|--------|------|---------|
| `notify` | renderer → main | P1.4 价格提醒系统通知 |
| `export-watchlist` | renderer → main | P3.2 导出自选股 CSV |
| `import-watchlist` | renderer → main | P3.2 导入自选股 CSV |
| `export-backup` | renderer → main | P4.4 全量数据备份 |
| `import-backup` | renderer → main | P4.4 从备份恢复 |

---

## 八、已知约束与限制

1. **仅支持美股**：Finnhub 免费层只提供美股数据，A 股/港股需要其他数据源
2. **API 限额**：Finnhub 免费层 60次/分钟，自选股超过 20 只时 10 秒轮询会触发限流
3. **技术分析为模拟数据**：RSI、SMA 均为随机值，不可用于真实投资决策
4. **市值展示有 Bug**：当前展示值偏小 100 万倍（见 BUG-001）
5. **仅支持 macOS 打包**：`electron-builder` 配置仅生成 `.dmg`，Windows/Linux 需额外配置
6. **无自动化测试**：当前无单元测试和 E2E 测试，修改后需手动验证

---

## 九、开发规范

> 详细约束见 `AGENTS.md`，以下是关键原则摘要。

- **所有 API 调用必须经过 `apiRequest()` 限流队列**，禁止直接调用 `axios.get()`
- **Renderer 进程禁止直接使用 Node.js API**，必须通过 `window.electronAPI` IPC 桥接
- **新增持久化字段必须使用新 key**，禁止修改 `'watchlist'` key
- **新增数据类型必须定义在 `src/types/index.ts`**，不在组件文件内定义共享类型
- **数字格式化必须使用 `src/utils/format.ts`** 中的函数，不在组件内手写格式化逻辑
- **新增 IPC 通道必须同时更新** `main.ts`、`preload.ts`、`electron.d.ts` 三个文件