# AGENTS.md — StockerChef

> **语言说明**：本文档统一使用简体中文。所有 agent 在此仓库工作时，应以本文档为首要参考。

---

## 目录

1. [项目概览](#1-项目概览)
2. [快速启动](#2-快速启动)
3. [核心约束](#3-核心约束)
4. [模块说明](#4-模块说明)
5. [数据类型](#5-数据类型)
6. [数据流](#6-数据流)
7. [Bug 历史](#7-bug-历史)
8. [扩展规范](#8-扩展规范)
9. [自验清单](#9-自验清单)
10. [文档目录结构](#10-文档目录结构)

---

## 1. 项目概览

- **这是什么**：macOS 桌面股票看板应用，基于 Electron + React + TypeScript 构建
- **核心功能**：自选股实时行情监控（10s 轮询）、股票新闻聚合、真实技术分析（RSI/SMA，基于历史 K 线数据）
- **数据来源**：
  - A 股实时行情：Tushare Pro（有 Token 时优先）→ AKShare stock_zh_a_hist_tx（腾讯财经，降级）
  - 港股实时行情：AKShare stock_hk_spot（新浪财经，10min 缓存）→ 降级 stock_hk_daily（stock_hk_spot 在部分网络环境下不可用，降级链总耗时约 10s，前端超时设为 35s）
  - 美股实时报价：Finnhub 免费 API（仅支持美股，60次/分钟限额）
  - A 股历史 K 线：Tushare daily（有 Token）→ AKShare stock_zh_a_hist_tx（腾讯财经，降级）
  - 港股历史 K 线：AKShare stock_hk_daily（新浪财经）
  - 美股历史 K 线：yfinance → 随机模拟（网络不通时）
  - **Python 数据层**：`scripts/providers/` 包（多 Provider 类架构，参考 TradingAgents-CN）
- **持久化**：自选股列表通过 IPC 存储在 `electron-store`，路径 `~/Library/Application Support/stocker-chef/`
- **⚠️ 重要限制**：历史数据依赖网络可用性，网络不通时技术分析降级为随机模拟数据；仅支持 macOS 打包

---

## 2. 快速启动

```bash
# 安装依赖
npm install

# 配置 Finnhub API Key（可选，两种方式二选一）
# 方式一：在应用内 Settings → Data Sources 页面输入并保存（推荐，无需重启）
# 方式二：通过 .env 文件配置（开发调试用）
cp .env.example .env
# 编辑 .env，填入 VITE_STOCK_API_KEY=your_finnhub_api_key

# 注意：不配置 Finnhub Key 时，历史 K 线和技术分析（AKShare/yfinance）仍可正常使用
# 仅搜索、实时报价、新闻功能需要 Finnhub Key

# 启动开发模式（同时启动 Vite dev server + Electron）
npm run dev

# 生产构建：依次执行 tsc 类型检查 → vite build → electron-builder 打包
npm run build
# 产物：
#   dist/          — React 前端静态文件
#   dist-electron/ — Electron 主进程编译产物（main.js、preload.js）
#   dist/*.dmg     — macOS 安装包（由 electron-builder 生成）
```

**环境要求**：Node.js 18.x+，macOS（`electron-builder` 打包 `.dmg` 仅支持 macOS）

---

## 3. 核心约束

> 这是最重要的章节。违反以下约束会导致安全漏洞、API 封禁或数据损坏。

### 3.1 Electron 安全边界 ⚠️ 最高优先级

**禁止**在 renderer 进程（`src/` 下除 `electron/` 外的所有文件）中直接使用任何 Node.js API。

原因：`main.ts` 中 `contextIsolation: true` + `nodeIntegration: false` 是 Electron 安全模型的核心。违反此约束会导致 XSS 攻击可以访问文件系统。

正确做法：
- 需要访问本地存储 → 通过 `window.electronAPI.getStore()` / `window.electronAPI.setStore()`
- 需要新增 IPC 通道 → 在 `src/electron/main.ts` 添加 `ipcMain.handle()`，在 `src/electron/preload.ts` 通过 `contextBridge.exposeInMainWorld()` 暴露

```typescript
// ❌ 禁止在 renderer 中
import Store from 'electron-store'; // 会报错，且违反安全模型

// ✅ 正确做法
const value = await window.electronAPI.getStore('watchlist');
```

### 3.2 API 请求必须走限流队列

**禁止**在任何地方直接调用 `axios.get()` 访问 Finnhub API。

原因：Finnhub 免费层限额 60次/分钟。`src/services/stockApi.ts` 中的 `apiRequest()` 函数实现了请求队列（间隔 ~2000ms），绕过它会触发 429 错误并导致 API Key 被临时封禁。

```typescript
// ❌ 禁止直接调用
const response = await axios.get('https://finnhub.io/api/v1/quote', { params: { token: API_KEY } });

// ✅ 必须通过 apiRequest 包装
const quote = await getQuote(symbol); // 内部已走队列
// 或自定义新接口时：
const result = await apiRequest(async () => axios.get(...));
```

### 3.9 Finnhub Key 缺失时的降级行为规范 ⚠️

Finnhub Key 是**可选配置**，Key 缺失时各功能的正确降级行为如下：

| 功能 | Key 缺失时的行为 | 错误处理方式 |
|------|----------------|------------|
| 股票搜索（`searchSymbol`） | 返回空结果 + 在搜索框下方显示友好提示 | **不触发**全局 Error Alert |
| 实时报价（`getQuote`） | 静默跳过，返回 null | **不触发**全局 Error Alert |
| 公司信息（`getProfile`） | 抛出错误，Analysis 页面显示加载失败 | 组件级错误处理 |
| 新闻（`getNews`） | 抛出错误，新闻 Tab 显示加载失败 | 组件级错误处理 |
| 历史 K 线（`getHistoricalData`） | **不受影响**，走 AKShare/yfinance | 无需处理 |

**禁止**：
- 将 "Finnhub API Key not configured" 错误传递给全局 `setError()`（会显示红色 Error Alert，体验差）
- 在 `fetchAllQuotes` 的内层 catch 中把 Key 缺失错误当成网络错误处理

**正确做法**：在调用 Finnhub 函数的 catch 中，先检查 `handleAPIError(err).includes('API Key not configured')`，是则静默处理。

### 3.3 技术分析数据来源说明（已升级为真实计算）

`Analysis.tsx` 中的 RSI(14)、SMA20、SMA50、SMA200 现在基于 AKShare/yfinance 的真实历史 K 线数据计算。

**降级规则**：
- AKShare 或 yfinance 可用 → 真实计算，UI 标注 `[AKShare]` 或 `[yfinance]`
- 两者均不可用（网络断开）→ 降级为随机模拟，UI 标注 `[SIMULATED DATA]`

**禁止**：
- 将技术分析结果存入持久化存储（每次点击按钮重新计算）
- 在 UI 上去掉数据来源标注（`[AKShare]` / `[yfinance]` / `[SIMULATED DATA]`）
- 基于模拟数据（`source === 'simulated'`）做任何业务逻辑判断

### 3.4 watchlist 存储 key 不可更改

`electron-store` 中自选股列表的 key 固定为字符串 `'watchlist'`，在 `useStockStore.ts` 的 `loadWatchlist()` 和 `saveWatchlist()` 中硬编码。

原因：已有用户数据存储在此 key 下，更改 key 会导致用户数据丢失。

如需新增持久化字段，使用新的 key 名称，不要修改 `'watchlist'` key。

### 3.5 symbol 必须大写

所有股票代码在存入 watchlist 前必须调用 `.toUpperCase().trim()`。

原因：Finnhub API 对大小写敏感，小写 symbol 会返回空数据。`addToWatchlist()` 已处理此逻辑，直接调用该方法即可，不要绕过它手动操作 `watchlist` 数组。

### 3.6 marketCap 展示单位存在 Bug，禁止在此基础上做计算

`src/services/stockApi.ts` 的 `getProfile()` 将 Finnhub 返回的 `marketCapitalization`（单位：百万美元）直接赋值给 `Stock.marketCap`，而 `src/utils/format.ts` 的 `formatMarketCap()` 将其当作美元处理，导致展示值偏小 100 万倍。

原因：这是初始实现时的单位理解错误，已记录为已知 Bug。

**禁止**：
- 基于 `Stock.marketCap` 做任何数值比较或业务计算（数值不可信）
- 在修复此 Bug 前，将 `marketCap` 存入持久化存储

**修复方式**：在 `getProfile()` 中将 `data.marketCapitalization` 乘以 `1_000_000` 后再赋值，或修改 `formatMarketCap()` 使其接受百万美元单位的输入。详见 `docs/known-issues/market-cap-unit-mismatch.md`。

### 3.7 新闻缓存不可跨 symbol 共享

`useStockNews.ts` 中的 `newsCache` 是模块级 `Map`，以 symbol 为 key，缓存 5 分钟。

**禁止**将此 Map 用于其他用途或在组件间共享引用。缓存仅用于减少 API 调用，不是数据源。

### 3.8 darkTheme algorithm 字段不可随意修改

`src/theme/config.ts` 中 `darkTheme.algorithm` 使用了 `(theme: any) => theme.darkAlgorithm` 的写法，TypeScript strict 模式下会有 `any` 类型警告。

原因：Ant Design 5.x 的 `ThemeConfig.algorithm` 类型定义较复杂，当前写法是可正常运行的妥协方案。

**正确修复方式**（如需消除 `any` 类型警告）：
```typescript
import { theme } from 'antd';
// ...
export const darkTheme: ThemeConfig = {
  // ...
  algorithm: theme.darkAlgorithm,  // 类型为 DerivativeFunc，无需 any
};
```
**禁止**：在未验证深色模式切换效果的情况下随意修改此字段。修改后必须在 `npm run dev` 中切换系统深色/浅色模式验证效果。

---

## 4. 模块说明

### `src/electron/main.ts` — Electron 主进程

**职责**：创建 BrowserWindow、注册 IPC handlers、管理应用生命周期。

**当前 IPC 通道**：
| 通道名 | 方向 | 参数 | 返回值 |
|--------|------|------|--------|
| `window-minimize` | renderer → main | — | void |
| `window-maximize` | renderer → main | — | void |
| `window-close` | renderer → main | — | void |
| `store-get` | renderer → main | `key: string` | `unknown`（存储的值） |
| `store-set` | renderer → main | `key: string, value: unknown` | `true` |
| `settings-get` | renderer → main | `key: string` | `unknown`（用户设置值） |
| `settings-set` | renderer → main | `key: string, value: unknown` | `true` |
| `stock-get-history` | renderer → main | `symbol: string, startDate: string, endDate: string` | JSON 字符串 |
| `stock-get-cn-quote` | renderer → main | `symbols: string`（逗号分隔 6 位代码） | JSON 字符串（`Quote[]`） |
| `stock-search-cn` | renderer → main | `query: string` | JSON 字符串（`SearchResult[]`） |
| `stock-get-hk-quote` | renderer → main | `symbols: string`（逗号分隔 XXXXX.HK） | JSON 字符串（`Quote[]`） |
| `stock-get-indices` | renderer → main | — | JSON 字符串（`IndexQuote[]`） |
| `show-notification` | renderer → main | `title: string, body: string` | void |

**settings 命名空间**：`settings-get/set` 在 electron-store 中以 `settings.{key}` 存储，与 `watchlist` 隔离。当前使用的 key：
- `settings.finnhubApiKey` — Finnhub API Key（用户在 Settings 页面配置）

**不负责**：任何业务逻辑、数据处理、UI 渲染。

### `src/electron/preload.ts` — IPC 桥接层

**职责**：通过 `contextBridge` 将 IPC 通道安全暴露给 renderer，是 main 进程和 renderer 进程之间的唯一合法通信桥梁。

**暴露的 API**：
- `window.electronAPI.minimizeWindow/maximizeWindow/closeWindow()` — 自定义标题栏窗口控制
- `window.electronAPI.getStore(key)` / `window.electronAPI.setStore(key, value)` — watchlist 等通用存储
- `window.electronAPI.getSettings(key)` / `window.electronAPI.setSettings(key, value)` — 用户设置（Finnhub Key 等）
- `window.electronAPI.getStockHistory(symbol, startDate, endDate)` — 历史 K 线数据（调用 Python 脚本）
- `window.electronAPI.getCNQuote(symbols)` — A 股实时行情（AKShare，逗号分隔代码）
- `window.electronAPI.searchCNSymbol(query)` — A 股搜索（AKShare 全量数据模糊匹配）
- `window.electronAPI.getHKQuote(symbols)` — 港股实时行情（AKShare stock_hk_spot，10min 缓存）
- `window.electronAPI.getIndices()` — 关键指数行情（上证/科创/纳斯达克/标普/恒生/恒生科技）
- `window.electronAPI.showNotification(title, body)` — 系统通知（股价阈值提醒）

**不负责**：业务逻辑，只做透传。新增 IPC 通道时，必须同时修改 `main.ts`（注册 handler）和 `preload.ts`（暴露方法）。

### `src/services/stockApi.ts` — API 服务层

**职责**：封装所有 Finnhub API 调用，实现请求限流队列，提供统一错误处理。

**API Key 读取机制**：
- `getFinnhubApiKey()` — 优先从 `electron-store` 的 `settings.finnhubApiKey` 读取用户配置的 Key，降级到 `.env` 的 `VITE_STOCK_API_KEY`
- `requireApiKey()` — 在 Key 为空时抛出友好错误 `"Finnhub API Key not configured. Please go to Settings to add your key."`
- **不再在模块顶层读取 `API_KEY`**，每次调用时动态获取，支持用户在 Settings 页面配置后立即生效

**导出函数**：
- `getQuote(symbol)` → `Promise<Quote>` — 获取实时报价（需要 Finnhub Key）
- `getProfile(symbol)` → `Promise<Partial<Stock>>` — 获取公司基本信息（需要 Finnhub Key）
- `getNews(symbol)` → `Promise<NewsItem[]>` — 获取最近 7 天新闻（需要 Finnhub Key）
- `searchSymbol(query)` → `Promise<SearchResult[]>` — 搜索股票代码（需要 Finnhub Key）
- `getHistoricalData(symbol, startDate, endDate)` → `Promise<HistoricalDataResult>` — 历史 K 线（AKShare → yfinance 降级，**不需要 Key**）
- `handleAPIError(error)` → `string` — 统一错误信息格式化
- `apiRequest<T>(fn)` → `Promise<T>` — 限流队列包装器（新增 API 时使用）

**不负责**：数据缓存（由 hooks 层负责）、状态管理（由 store 负责）。

### `src/store/useStockStore.ts` — 全局状态

**职责**：管理自选股列表（`watchlist`）、实时报价缓存（`quotes`）、关键指数（`indices`），负责与 `electron-store` 的读写同步。

**状态字段**：
| 字段 | 类型 | 说明 |
|------|------|------|
| `watchlist` | `string[]` | 自选股代码列表（大写） |
| `quotes` | `Record<string, Quote>` | symbol → 最新报价的映射 |
| `symbolNames` | `Record<string, string>` | symbol → 中文名称的映射（持久化） |
| `indices` | `IndexQuote[]` | 关键指数行情列表（6 个预设指数） |
| `loading` | `boolean` | 全局加载状态 |
| `error` | `string \| null` | 全局错误信息 |
| `rateLimited` | `boolean` | API 限流标志 |
| `colorMode` | `'cn' \| 'us'` | 涨跌色风格（cn=红涨绿跌，us=绿涨红跌） |
| `refreshInterval` | `number` | 自动刷新间隔（秒，默认 300） |
| `alertThresholds` | `Record<string, AlertThreshold>` | symbol → 价格/涨幅提醒阈值 |
| `visibleColumns` | `ColumnKey[]` | 自选股列表可见列配置 |

**关键 action**：
- `fetchIndices()` — 调用 `window.electronAPI.getIndices()` 获取指数行情，解析 JSON 后更新 `indices`
- `loadWatchlist()` / `saveWatchlist()` — 从 electron-store 读写自选股列表

**不负责**：新闻数据（由 `useStockNews` hook 管理）、技术分析数据（组件本地状态）。

### `src/hooks/useStockQuote.ts` — 报价轮询 Hook

**职责**：对单个 symbol 进行定时轮询（默认 10s），返回最新报价、加载状态和错误信息。

**使用场景**：`Analysis.tsx` 中对当前查看股票的实时报价更新。Dashboard 的批量刷新直接调用 `getQuote()` 而不使用此 hook（原因：批量场景需要并发控制）。

### `src/hooks/useStockNews.ts` — 新闻 Hook

**职责**：获取指定 symbol 的新闻，内置 5 分钟内存缓存（`newsCache` Map）。

**注意**：缓存在页面刷新后失效，不持久化。

### `src/pages/Dashboard.tsx` — 自选股看板

**职责**：展示自选股列表、搜索添加股票、批量刷新报价（定时 + 手动触发）、展示 6 个关键指数卡片。

**关键行为**：
- 组件挂载时依次调用 `loadWatchlist()`、`loadSymbolNames()`、`loadColorMode()`、`loadRefreshInterval()`、`loadAlertThresholds()`、`loadVisibleColumns()` 从 electron-store 加载数据
- 初始化完成后立即调用一次 `fetchIndices()`，之后与 `fetchAllQuotes` 同步触发（同一个 interval）
- 刷新间隔由用户在 Settings 中配置（`refreshInterval` 字段，默认 300s），不再固定 10s
- 点击股票卡片触发 `onStockClick(symbol)` prop 回调，由 App.tsx 切换到 Analysis tab
- 接受 `onNavigateToSettings?: () => void` prop，用于从搜索提示跳转到 Settings tab

**指数卡片区域**：
- 始终渲染 6 个预设指数卡片（`PRESET_INDICES` 数组），数据未到时用 `—` 占位
- 展示顺序（固定）：上证指数 → 纳斯达克 → 恒生科技 → 科创综指 → 恒生指数 → 标普500
- 数据来源：`useStockStore` 的 `indices` 字段，通过 `fetchIndices()` 更新

```typescript
const PRESET_INDICES = [
  { symbol: '000001.SH', name: '上证指数' },
  { symbol: '.IXIC',     name: '纳斯达克' },
  { symbol: 'HSTECH',    name: '恒生科技' },
  { symbol: '000688.SH', name: '科创综指' },
  { symbol: 'HSI',       name: '恒生指数' },
  { symbol: '.INX',      name: '标普500'  },
];
```

**Finnhub Key 缺失时的行为**：
- 搜索框输入 → 捕获 "API Key not configured" 错误 → 设置 `finnhubKeyMissing = true` → 搜索框下方显示友好提示（含跳转 Settings 链接）
- 报价刷新 → 内层 catch 静默跳过，不触发全局 Error Alert

### `src/pages/Analysis.tsx` — 股票分析页

**职责**：展示单只股票的详情（公司信息 + 实时报价）、新闻列表、真实技术分析（RSI/SMA）。

**关键行为**：
- 技术分析通过 `getHistoricalData()` 获取真实 K 线数据，计算 RSI(14)/SMA20/50/200，在 Modal 中展示
- 数据来源标注：`[AKShare]`、`[yfinance]`、`[SIMULATED DATA]`（网络不通时降级为随机模拟）
- 报价通过 `useStockQuote` hook 每 10s 自动刷新
- 公司 profile 仅在组件挂载时请求一次
- 接收 `initialSymbol` prop（由 App.tsx 传入），不再使用 `useParams`

### `src/pages/Settings.tsx` — 设置页

**职责**：用户偏好配置，包含数据源配置和涨跌色风格设置。

**数据源配置 Card（DataSourceCard 组件）**：
- **AKShare**：免费无需配置，显示 Ready 状态
- **yfinance**：免费无需配置，显示 Ready 状态
- **Finnhub**：需要用户输入 API Key，通过 `window.electronAPI.setSettings('finnhubApiKey', key)` 存储到 electron-store
- Key 保存后立即生效（`stockApi.ts` 每次调用时动态读取）
- 提供 Save / Clear 操作，Key 已配置时显示 Configured 状态

**涨跌色风格 Card**：中国风格（红涨绿跌）/ 美股风格（绿涨红跌），存储在 Zustand store 的 `colorMode` 字段。

### `src/theme/config.ts` — Ant Design 主题配置

**职责**：定义 `lightTheme` 和 `darkTheme` 两套 Ant Design 5.x `ThemeConfig`，由 `App.tsx` 根据系统深色模式偏好动态切换。

**关键约束**：
- `darkTheme` 中的 `algorithm` 字段当前写法为 `algorithm: (theme: any) => theme.darkAlgorithm`，使用了 `any` 类型，这是一个已知的类型妥协（正确写法应为 `import { theme } from 'antd'; algorithm: theme.darkAlgorithm`，但当前写法可正常运行）
- **禁止**将 `algorithm` 字段改为其他形式，除非同时验证深色模式切换仍然正常工作
- 主色调 `colorPrimary: '#1890ff'` 和圆角 `borderRadius: 8` 是全局设计规范，不要在组件内用内联样式覆盖

### `src/utils/format.ts` — 格式化工具

**职责**：提供统一的数字/日期格式化函数，所有 UI 展示层的格式化必须通过这里。

**导出函数**：`formatPrice`（USD 货币）、`formatPercent`（带符号百分比）、`formatMarketCap`（T/B/M/K 单位）、`formatDate`（本地化日期时间）

**⚠️ 已知 Bug**：`formatMarketCap` 函数将传入值直接按美元做 T/B/M/K 换算，但 Finnhub `getProfile()` 返回的 `marketCapitalization` 单位是**百万美元**。因此当前展示的市值数字偏小 100 万倍（如实际市值 3 万亿美元的公司，显示为 `$3.00M` 而非 `$3.00T`）。详见 `docs/known-issues/market-cap-unit-mismatch.md`。

### `src/components/KLineChart.tsx` — K 线图组件

**职责**：基于 lightweight-charts v5 渲染 K 线主图 + 成交量副图，供 `Analysis.tsx` 使用。

**关键配置**：
- 涨跌色：A 股风格（红涨 `#ef4444` / 绿跌 `#22c55e`）
- 时间轴日期格式：`YYYYMMDD`（如 `20260418`），通过 `tickMarkFormatter` 和 `localization.timeFormatter` 同时配置
- 成交量副图：独立 `priceScaleId: 'volume'`，占图表下方 25% 空间

**⚠️ lightweight-charts v5 的 time 类型**：
- `setData()` 传入的 `time` 字段是 `"YYYY-MM-DD"` 格式字符串
- `tickMarkFormatter` 和 `localization.timeFormatter` 回调收到的 `time` 参数是 **`BusinessDay` 对象** `{ year: number, month: number, day: number }`，**不是**字符串也**不是** Unix 时间戳
- 格式化时必须用 `(time as { year, month, day })` 解构，不能用 `new Date(time * 1000)`（会得到 NaN）

```typescript
// ✅ 正确写法
tickMarkFormatter: (time: unknown) => {
  const t = time as { year: number; month: number; day: number };
  return `${t.year}${String(t.month).padStart(2, '0')}${String(t.day).padStart(2, '0')}`;
}

// ❌ 错误写法（time 不是时间戳）
tickMarkFormatter: (time: number) => {
  const date = new Date(time * 1000); // NaN！
}
```

### `src/types/index.ts` — 核心类型定义

**职责**：定义所有跨模块共享的 TypeScript 接口。新增数据结构时必须在此文件定义类型，不要在组件文件内定义共享类型。

---

## 5. 数据类型

详见 `src/types/index.ts`，核心类型速查：

```typescript
Quote             // 实时报价：symbol, price, change, changePercent, volume?, high?, low?, open?, previousClose?, timestamp
Stock             // 股票基本信息：symbol, name, price, change, changePercent, marketCap?, description?
NewsItem          // 新闻条目：title, source, publishedAt, url, summary?
AnalysisResult    // 技术分析：symbol, rsi?, sma20?, sma50?, sma200?, recommendation, summary
SearchResult      // 搜索结果：symbol, description, displaySymbol, type
StockProfile      // Finnhub 公司档案（API 原始格式）：name, exchange, marketCapitalization, country, industry...
HistoricalDataPoint  // K 线数据点：date, open, high, low, close, volume
HistoricalDataResult // K 线结果：data, source('akshare'|'yfinance'|'simulated'), error?
IndexQuote        // 关键指数行情：symbol, name, price, change, changePercent
StockQuestion     // 用户问题记录：id, symbol, question, createdAt
```

**类型扩展规则**：
- 新增可选字段用 `?` 标注，不要破坏现有接口
- `AnalysisResult.recommendation` 是联合类型 `'Buy' | 'Sell' | 'Hold'`，不要改为 string
- `HistoricalDataResult.source` 是联合类型 `'akshare' | 'yfinance' | 'simulated'`，不要改为 string

---

## 6. 数据流

详见 `docs/flows/data-flow.md`，核心链路速查：

```
用户操作
  │
  ▼
React 组件（Dashboard / Analysis）
  │  调用 store action 或直接调用 service
  ▼
Zustand Store（useStockStore）
  │  watchlist 变更时触发 saveWatchlist()
  ▼
window.electronAPI.setStore()  ←── preload.ts contextBridge
  │
  ▼
IPC: store-set  ──→  main.ts ipcMain.handle('store-set')
  │
  ▼
electron-store（本地磁盘）

─────────────────────────────────────────

React 组件 / Hook
  │  调用 getQuote() / getNews() 等
  ▼
stockApi.ts apiRequest() 限流队列
  │  间隔 ~2000ms 出队
  ▼
axios → Finnhub API (https://finnhub.io/api/v1)
  │
  ▼
返回数据 → 更新 Store / Hook 本地状态 → 触发 React 重渲染

─────────────────────────────────────────

Dashboard 初始化 / 定时刷新（与 fetchAllQuotes 同一 interval）
  │  fetchIndices()
  ▼
window.electronAPI.getIndices()  ←── preload.ts contextBridge
  │
  ▼
IPC: stock-get-indices  ──→  main.ts → execFile(python3, main.py --action get_indices)
  │
  ▼
scripts/main.py handle_get_indices()
  ├── A 股指数（上证/科创）：ak.stock_zh_index_daily() 取最近两日计算涨跌
  ├── 港股指数（恒生/恒生科技）：ak.stock_hk_index_spot_sina()
  └── 美股指数（纳斯达克/标普）：ak.index_us_stock_sina() 取最近两日计算涨跌
  │  ⚠️ 调用 AKShare 前将 sys.stdout 重定向到 sys.stderr，防止 tqdm 污染 JSON 输出
  ▼
返回 JSON 字符串（IndexQuote[]）→ store.indices → Dashboard 指数卡片渲染
```

---

## 7. Bug 历史

### BUG-001：批量刷新时 watchlist 变化导致 interval 泄漏

**现象**：在 Dashboard 的 `useEffect` 中，`fetchAllQuotes` 依赖 `watchlist`，但 `setInterval` 的回调捕获的是旧的 `watchlist` 闭包。

**根因**：`useEffect` 的依赖数组包含 `watchlist`，每次 watchlist 变化都会重新创建 interval，但旧 interval 的清理依赖 cleanup 函数正确执行。

**现状**：当前实现通过 `useEffect` 的 cleanup（`return () => clearInterval(interval)`）处理，但如果 watchlist 频繁变化，可能存在短暂的多个 interval 并存。

**规避**：修改 watchlist 后，不要在 1 秒内快速连续操作，等待当前刷新周期完成。

### BUG-002：搜索结果不会自动清空

**现象**：在 Dashboard 搜索框输入后，点击空白处不会清空搜索结果下拉列表。

**根因**：`searchResults` 状态只在 `handleAddStock` 和 `handleSearch`（query 为空时）被清空，没有 onBlur 处理。

**现状**：已知问题，未修复。用户需要手动清空搜索框才能关闭下拉列表。

### BUG-003：技术分析 Modal 在 quote 为 null 时按钮禁用但状态不清空

**现象**：如果在 Analysis 页面 quote 加载失败后，`analysis` 状态仍保留上次的值，重新进入页面时 Modal 可能展示旧数据。

**根因**：`analysis` 状态在组件卸载时不会重置（React 组件重新挂载时状态初始化为 `null`，但路由切换后再切回同一 symbol 时组件会重新挂载，所以实际影响有限）。

**规避**：每次点击"Technical Analysis"按钮都会重新生成，不要依赖缓存的 `analysis` 状态。

### BUG-008：AKShare tqdm 进度条污染 stdout 导致 JSON.parse 失败（已修复）

**现象**：指数卡片始终显示占位符（`—`），即使 Python 脚本数据正常。

**根因**：`ak.stock_zh_index_spot_sina()` 等 AKShare 接口内部使用 tqdm 进度条，默认输出到 stdout。`execFile` 的 `stdout` 回调拿到的是 `进度条文本 + JSON` 混合内容，`JSON.parse` 失败，被 catch 静默掉，`indices` 永远是 `[]`。

**修复**：在 `handle_get_indices()` 里，调用 AKShare 前用 `try/finally` 临时将 `sys.stdout` 重定向到 `sys.stderr`，确保 stdout 只有纯 JSON 输出。

**规避原则**：所有调用 AKShare 接口的 Python 函数，如果其输出会被 `execFile` 的 stdout 捕获并 `JSON.parse`，必须在调用前将 `sys.stdout` 重定向到 `sys.stderr`，并在 `finally` 里恢复。

### BUG-009：`ak.stock_zh_index_spot_sina()` 在部分网络环境下返回 HTML 错误页（已修复）

**现象**：A 股指数（上证指数、科创综指）始终缺失，Python 脚本报 `Can not decode value starting with character '<'`。

**根因**：新浪财经接口 `stock_zh_index_spot_sina` 在部分网络环境下返回 HTML 错误页而非数据。

**修复**：改用 `ak.stock_zh_index_daily(symbol='sh000001')` 取最近两日日线数据计算涨跌（与美股指数处理方式一致，更稳定）。

**规避原则**：AKShare 的 `_spot_sina` 系列接口依赖新浪财经，网络不稳定时容易返回 HTML。优先使用 `_daily` 系列接口作为备选。

### BUG-010：AKShare tqdm 污染 stdout + 东方财富接口不可用导致 A 股数据完全无法获取（已修复）

**现象**：添加 A 股（6 位纯数字代码，如 000001、600519）到自选股后，行情始终显示 `—`，不显示任何价格数据。

**根因**：两个叠加的 Bug：

1. **tqdm stdout 污染**：`main.py` 的 `handle_cn_quote`、`handle_hk_quote` 等函数调用 AKShare 时，AKShare 内部的 `tqdm` 进度条默认输出到 `stdout`，导致前端 `execFile` 收到的不是纯 JSON，而是 `进度条文本 + JSON` 混合内容，`JSON.parse` 抛出异常，A 股数据完全无法获取。（`handle_get_indices` 已有保护，但其他 handle 函数没有。）

2. **东方财富接口不可用**：`CnAKShareProvider._fetch_single_quote()` 使用 `stock_zh_a_hist`（东方财富接口），该接口在部分网络环境下持续返回 `RemoteDisconnected('Remote end closed connection without response')`，重试 3 次后仍失败，返回空数组。

3. **`get_quotes()` 被 `_load_stock_list()` 阻塞**：`get_quotes()` 先调用 `_load_stock_list()` 获取股票名称映射，而 `stock_info_a_code_name()` 内部有 tqdm 且在部分网络下超时，导致整个行情获取被阻塞。

**修复**：
- `scripts/main.py`：在 `handle_cn_quote`、`handle_cn_search`、`handle_hk_quote`、`handle_hk_search`、`handle_us_quote`、`handle_history` 所有 handle 函数中统一加 `sys.stdout = sys.stderr` 重定向保护（与 `handle_get_indices` 一致），`finally` 块恢复。
- `scripts/providers/cn_akshare.py`：
  - `_fetch_single_quote()` 改用 `stock_zh_a_hist_tx`（腾讯财经接口），需要添加 `sz/sh/bj` 市场前缀（深交所 `sz`，上交所 `sh`，北交所 `bj`）。
  - `get_quotes()` 改为仅使用已有缓存（不主动触发 `_load_stock_list()` 网络请求），名称获取失败时降级为使用代码作为名称。
  - `search()` 改为缓存优先策略：有缓存时模糊匹配，无缓存时对纯数字查询直接验证代码有效性。

**规避原则**：
- 所有调用 AKShare 接口的 Python 函数，输出会被 `execFile` stdout 捕获时，必须先将 `sys.stdout` 重定向到 `sys.stderr`，并在 `finally` 里恢复。
- A 股实时行情优先使用 `stock_zh_a_hist_tx`（腾讯财经），不使用 `stock_zh_a_hist`（东方财富，网络可达性差）。
- `get_quotes()` 不应在关键路径上调用可能超时的辅助接口（如股票列表），名称缺失时用代码代替。

### BUG-007：Python 脚本历史 K 线返回数组格式，但前端期望对象格式（已修复）

**现象**：K 线图 Tab 显示空白，数据来源标注为"模拟数据"，即使 AKShare/yfinance 可用。

**根因**：`yfinance_fetch.py` 的历史 K 线路由（美股/港股）直接返回数组格式 `[{date, open, high, low, close, volume, source}, ...]`，但 `getHistoricalData()` 只处理了对象格式 `{data: [...], source: '...'}` 的响应，导致 `parsed.data` 为 `undefined`，最终返回 `{ data: [], source: 'simulated' }`。

**修复**：在 `src/services/stockApi.ts` 的 `getHistoricalData()` 中新增对数组格式的解析分支，从第一条数据的 `source` 字段提取数据来源。

**规避原则**：Python 脚本返回格式有两种，修改 Python 脚本时必须保持格式一致，或在前端同时兼容两种格式。

### BUG-010：lightweight-charts v5 的 `tickMarkFormatter` 收到的 time 是 BusinessDay 对象而非时间戳（已修复）

**现象**：K 线图底部时间轴刻度显示 `NaNNaNNaN`，crosshair 悬停显示 `10 4月 '26 00:00`，而非期望的 `20260418` 格式。

**根因**：
1. `tickMarkFormatter` 的 `time` 参数类型在 lightweight-charts v5 中是 `BusinessDay` 对象 `{ year, month, day }`，不是 Unix 时间戳，用 `new Date(time * 1000)` 会得到 NaN
2. crosshair 悬停日期需要通过 `localization.timeFormatter` 单独配置，`tickMarkFormatter` 只控制时间轴刻度，两者互相独立

**修复**：
- `tickMarkFormatter` 和 `localization.timeFormatter` 均改为解构 `BusinessDay` 对象：`(time as { year, month, day })` 后拼接 `YYYYMMDD`
- 同时开启 `timeVisible: true`（之前为 `false`，导致底部根本不显示日期）

**规避原则**：使用 lightweight-charts v5 时，所有时间格式化回调（`tickMarkFormatter`、`localization.timeFormatter`）收到的 `time` 参数类型是 `BusinessDay | UTCTimestamp`，日线数据传入的是 `BusinessDay`，必须按对象解构处理，不能当数字用。

### BUG-004：TypeScript 编译存在已知错误（已修复）

**现象**：运行 `npx tsc --noEmit` 曾报 4 个错误（未使用变量、`ellipsis.rows` 类型不兼容）。

**现状**：✅ 已修复。`npx tsc --noEmit` 当前 `EXIT_CODE:0`，零错误。

**修复内容**：
- `Dashboard.tsx`：移除未使用的 `updateQuote`、`loading` 解构；移除未使用的 `Empty` import
- `Analysis.tsx`：文件新版本已用 CSS `WebkitLineClamp` 替代 `ellipsis={{ rows: 2 }}`，无需改动
- `App.tsx`：文件新版本中 `theme` import 已不存在，无需改动

### BUG-006：`file_replace` 插入位置错误导致 import 区域被破坏

**现象**：在 Analysis.tsx 中使用 `file_replace` 添加 import 行时，因 `old_string` 匹配到了文件中间的某段内容，导致新的 import 行被插入到了 `const { Title, Text, Link } = Typography;` 之前，而不是文件顶部，最终造成所有 import 全部丢失，只剩两行重复的 `const` 声明。

**根因**：`file_replace` 的 `old_string` 必须在文件中**唯一存在**。当目标字符串在文件中有多处匹配时，工具会选择第一个匹配位置插入，可能不是预期位置。

**规避原则**：
- 修改 import 区域前，**必须先用 `sed -n '1,20p'` 或 `head` 确认文件头部的真实内容**，不要依赖 `read_file` 的缓存（工具缓存可能滞后）
- `old_string` 要包含足够多的上下文（至少 3-4 行），确保在文件中唯一匹配
- 修改 import 后立即运行 `npx tsc --noEmit` 验证，import 区域破坏会立即产生大量 `Cannot find name` 错误

### BUG-005：`app.dock.setIcon()` 和 `execFile` 抛出未捕获异常导致 UnhandledPromiseRejection

**现象**：启动 `npm run dev` 后控制台报 `UnhandledPromiseRejectionWarning`，应用可能无法正常启动。

**根因**：`src/electron/main.ts` 中两处代码在 `Promise` 上下文内抛出同步异常但未被捕获：
1. `app.whenReady().then()` 内调用 `app.dock.setIcon()`，若图标路径不存在则同步抛出异常，导致整个 `.then()` 回调的 Promise 变成 rejected 状态
2. `stock-get-history` IPC handler 中 `new Promise` 内调用 `execFile()`，若 `python3` 不存在则 `execFile` 同步抛出异常，Promise 变成 rejected 状态

**修复方式**：
- `app.dock.setIcon()` 调用用 `try-catch` 包裹，捕获后 `console.warn` 降级处理
- `execFile()` 调用用 `try-catch` 包裹，捕获后 `resolve(JSON.stringify({ error: 'exec_failed', message }))` 降级返回

**规避原则**：在 Electron `main.ts` 的 `app.whenReady().then()` 和 `ipcMain.handle()` 回调中，所有可能抛出异常的同步调用都必须用 `try-catch` 包裹，否则会产生 `UnhandledPromiseRejection`。

---

## 8. 扩展规范

> 典型任务复杂度：中等（4-7步）。以下模式覆盖最常见的扩展场景。

### 模式 A：新增 Finnhub API 端点

**适用场景**：需要调用 Finnhub 的新接口（如获取财务数据、内部人交易等）。

**步骤**：

1. **定义类型**（`src/types/index.ts`）
   - 新增接口的请求参数类型和响应数据类型
   - 如果是 Finnhub 原始响应格式，命名为 `XxxProfile` 或 `XxxResponse`
   - 如果是应用内使用的格式，命名为 `Xxx`

2. **实现 service 函数**（`src/services/stockApi.ts`）
   - 使用 `apiRequest()` 包装，不要直接调用 axios
   - 函数命名遵循 `getXxx(symbol)` 模式
   - 在函数内做数据格式转换（Finnhub 格式 → 应用内格式）
   - 导出函数

3. **创建 Hook**（`src/hooks/useXxx.ts`）
   - 如果需要轮询：参考 `useStockQuote.ts`，使用 `useRef` 管理 interval
   - 如果只需一次性获取：参考 `useStockNews.ts`，在 `useEffect` 中调用
   - 如果有缓存需求：在模块级定义 `Map<string, { data: T; timestamp: number }>`，缓存时长根据数据更新频率决定

4. **在页面中使用**（`src/pages/Analysis.tsx` 或新页面）
   - 调用 hook，处理 loading / error 状态
   - 使用 `src/utils/format.ts` 中的格式化函数展示数据
   - 数字展示统一用 `formatPrice` / `formatPercent` / `formatMarketCap`

5. **更新类型文档**（`src/types/index.ts` 注释）
   - 如果新类型有特殊约束（如某字段单位是千美元而非美元），在类型定义旁加注释

**验证**：`npx tsc --noEmit` 无类型错误

---

### 模式 B：新增 IPC 通道（主进程功能）

**适用场景**：需要在 renderer 中访问 Node.js 能力（文件系统、系统通知、剪贴板等）。

**步骤**：

1. **在 `src/electron/main.ts` 注册 handler**
   ```typescript
   ipcMain.handle('your-channel-name', async (_event, param1: string) => {
     // 实现逻辑
     return result;
   });
   ```

2. **在 `src/electron/preload.ts` 暴露方法**
   ```typescript
   contextBridge.exposeInMainWorld('electronAPI', {
     // 保留现有方法
     getStore: ...,
     setStore: ...,
     // 新增
     yourMethod: (param1: string) => ipcRenderer.invoke('your-channel-name', param1),
   });
   ```

3. **更新类型声明**（`src/types/electron.d.ts`）
   ```typescript
   export interface ElectronAPI {
     getStore: (key: string) => Promise<unknown>;
     setStore: (key: string, value: unknown) => Promise<boolean>;
     yourMethod: (param1: string) => Promise<ReturnType>; // 新增
   }
   ```

4. **在 renderer 中调用**
   ```typescript
   const result = await window.electronAPI.yourMethod(param1);
   ```

**验证**：`npx tsc --noEmit` 无类型错误；`npm run dev` 后在 DevTools Console 测试调用

---

### 模式 C：新增页面

**适用场景**：新增独立的路由页面（如投资组合页、设置页）。

**步骤**：

1. **创建页面组件**（`src/pages/YourPage.tsx`）
   - 从 `useStockStore` 获取需要的全局状态
   - 本地状态用 `useState`，副作用用 `useEffect`
   - 错误和加载状态必须有 UI 反馈（参考 Dashboard 的 Alert 组件）

2. **注册路由**（`src/App.tsx`）
   ```typescript
   <Route path="/your-path" element={<YourPage />} />
   ```
   同时在 `AppHeader` 中按需添加导航链接。

3. **更新导入**（`src/App.tsx`）
   ```typescript
   import YourPage from '@/pages/YourPage';
   ```

4. **如需导航到新页面**，在其他组件中：
   ```typescript
   const navigate = useNavigate();
   navigate('/your-path');
   ```

**验证**：`npx tsc --noEmit` 无类型错误

---

### 模式 D：新增持久化字段

**适用场景**：需要在 `electron-store` 中保存新的用户数据（如用户偏好、价格提醒阈值）。

**步骤**：

1. **在 `useStockStore.ts` 中新增状态字段和 action**
   - 新增 `loadXxx()` 和 `saveXxx()` 方法，使用新的 key 名称（不要复用 `'watchlist'`）
   - 在 `loadWatchlist()` 调用处（`Dashboard.tsx` 的 `useEffect`）同步调用 `loadXxx()`

2. **在需要的组件中调用 `saveXxx()`**，时机与 `saveWatchlist()` 保持一致（数据变更后立即保存）

**注意**：不要在 `electron-store` 中存储 `Quote` 数据（实时数据，无需持久化）。

---

## 9. 自验清单

> 由于本仓库无自动化测试和 CI，每次修改后必须手动执行以下检查。

### 计算型验证（必须全部通过）

```bash
# TypeScript 类型检查（最重要的自动化验证）
npx tsc --noEmit

# 检查是否有直接的 axios 调用绕过了限流队列
grep -r "axios\.get\|axios\.post" src/ --include="*.ts" --include="*.tsx" | grep -v "stockApi.ts"
# 期望：无输出（所有 axios 调用应只在 stockApi.ts 中）

# 检查是否有在 renderer 中直接 import electron 模块
grep -r "from 'electron'" src/ --include="*.ts" --include="*.tsx" | grep -v "src/electron/"
# 期望：无输出

# 检查是否有新的 IPC 通道未在 electron.d.ts 中声明
grep "ipcMain.handle" src/electron/main.ts
grep "electronAPI" src/types/electron.d.ts
# 手动对比：main.ts 中每个 handle 的通道，preload.ts 和 electron.d.ts 中都应有对应声明
```

### 推理型验证（修改后自查）

- [ ] 新增的 API 调用是否通过了 `apiRequest()` 包装？
- [ ] 新增的 IPC 通道是否同时更新了 `main.ts`、`preload.ts`、`electron.d.ts` 三个文件？
- [ ] 新增的数据类型是否定义在 `src/types/index.ts` 而不是组件文件内？
- [ ] 新增的格式化展示是否使用了 `src/utils/format.ts` 中的函数？
- [ ] 如果修改了 watchlist 相关逻辑，是否确认 `'watchlist'` key 未被更改？
- [ ] 如果新增了模拟数据，是否在 UI 上添加了免责声明？
- [ ] 新增的 Hook 是否在组件卸载时清理了 interval / 取消了异步操作？
- [ ] 调用 AKShare 的 Python 函数，是否在调用前将 `sys.stdout` 重定向到 `sys.stderr`（防止 tqdm 污染 JSON 输出）？
- [ ] 使用 lightweight-charts v5 的时间格式化回调（`tickMarkFormatter`、`localization.timeFormatter`）时，是否按 `BusinessDay` 对象 `{ year, month, day }` 解构，而非当作数字或字符串处理？
- [ ] Dashboard 的指数卡片顺序是否与 `PRESET_INDICES` 数组一致（上证→纳斯达克→恒生科技→科创→恒生→标普）？

---

## 10. 文档目录结构

```
docs/
├── decisions/          # 架构决策记录（ADR）
│   ├── README.md
│   ├── 001-electron-context-isolation.md   # 为什么启用 contextIsolation
│   └── 002-finnhub-rate-limit-strategy.md  # 限流队列设计决策
├── contracts/          # 模块间接口契约
│   ├── README.md
│   ├── ipc-channels.md                     # IPC 通道完整规范
│   └── finnhub-api-mapping.md              # Finnhub API 字段映射
├── known-issues/       # 已知问题与规避方案
│   ├── README.md
│   ├── simulated-technical-analysis.md     # 技术分析模拟数据说明
│   ├── rate-limit-behavior.md              # 限流触发时的行为说明
│   └── market-cap-unit-mismatch.md         # 市值展示单位错误（偏小 100 万倍）
└── flows/              # 数据流说明
    ├── data-flow.md                        # 完整数据流图
    └── watchlist-persistence-flow.md       # 自选股持久化流程
```

**设计文档**：`stock-chef-dev-prompt.md` 是本项目的原始需求文档，记录了初始设计意图，做架构决策时优先参考。
