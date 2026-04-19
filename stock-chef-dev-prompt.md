# StockerChef — 产品设计文档

> **文档定位**：本文档是 StockerChef 的产品功能规划文档，记录已实现功能的设计意图，以及未来迭代方向。开发时以 `AGENTS.md` 为技术约束首要参考，以本文档为功能需求首要参考。

---

## 一、项目定位

**StockerChef** 是一款面向个人投资者的 macOS 桌面股票看板应用，核心价值是：

- **零切换成本**：在桌面常驻，无需打开浏览器或手机 App
- **自选股聚焦**：只看自己关心的股票，信息密度高、噪音低
- **多市场覆盖**：同时支持 A 股、港股、美股实时行情监控
- **轻量分析辅助**：提供真实技术指标（RSI/SMA，基于历史 K 线数据）

**目标用户**：有一定投资经验、关注 A 股/港股/美股市场、习惯在 Mac 上工作的个人投资者。

**数据来源**：
- **A 股**：Tushare Pro（有 Token 时优先）→ AKShare stock_zh_a_hist_tx（腾讯财经，降级）
- **港股**：AKShare stock_hk_spot（新浪财经，10min 缓存）→ stock_hk_daily（降级）
- **美股**：Finnhub 免费 API（60次/分钟限额）
- **历史 K 线**：AKShare / yfinance（双数据源降级）

---

## 二、技术栈

| 层次 | 技术选型 | 说明 |
|------|----------|------|
| 桌面容器 | Electron | macOS 原生窗口，IPC 安全通信，自定义无标题栏 |
| 前端框架 | React 18 + TypeScript | 严格类型，`noUnusedLocals: true` |
| 构建工具 | Vite + `vite-plugin-electron` | 同时构建 renderer 和 main 进程 |
| UI 组件库 | Ant Design 5.x | 跟随系统深色/浅色模式 |
| 状态管理 | Zustand | 全局 watchlist、quotes、indices 等状态 |
| HTTP 客户端 | Axios | 所有 Finnhub 请求必须经过 `apiRequest()` 限流队列 |
| 本地持久化 | electron-store | 存储路径：`~/Library/Application Support/stocker-chef/` |
| 数据层（Python） | AKShare / Tushare / yfinance | 多 Provider 架构，`scripts/providers/` 包 |

---

## 三、已实现功能（当前版本）

### 3.1 股票仪表盘（Dashboard）

**自选股管理**
- 搜索框智能路由：A 股（纯数字/中文）→ AKShare 本地全量数据匹配；港股（X.HK 格式）→ 本地即时识别；美股（纯字母）→ 本地即时识别 + Finnhub 异步补充
- 点击搜索结果一键添加，symbol 自动转大写；港股代码自动补全前导零到 5 位（如 `3690.HK` → `03690.HK`）
- 自选股列表通过 IPC 持久化到 `electron-store`，key 固定为 `'watchlist'`
- 删除按钮移除自选股，同步清除报价缓存

**实时报价展示（行式表格）**
- 行式表格布局，列可配置（代码/最新价/涨跌幅/涨跌额/最高/最低/今开/昨收/成交量）
- 按市场分组并发请求：A 股 → `getCNQuote`（AKShare 批量）；港股 → `getHKQuote`（AKShare 批量）；美股 → `getQuoteDirect`（Finnhub 并发）
- 涨跌色风格可切换：中国风格（红涨绿跌）/ 美股风格（绿涨红跌），持久化到 `electron-store`
- 刷新间隔可配置（10s / 1min / 5min / 10min / 30min），默认 5 分钟
- 冷启动时先展示当天报价缓存，同时后台刷新
- 加载中显示 Spin 占位，API 限流时展示 Warning Alert

**关键指数卡片**
- 页面顶部展示 8 个预设指数：上证指数、深证成指、创业板指、纳斯达克、标普500、道琼斯、恒生指数、恒生科技
- 数据来源：A 股指数 → AKShare；港股指数 → AKShare；美股指数 → AKShare（取最近两日日线计算涨跌）
- 数据未到时显示占位符 `—`，不阻塞页面渲染

**价格提醒**
- 每只股票可单独设置涨跌幅阈值（默认 ±5%）和价格上下限
- 触发时通过 Electron `Notification` API 发送 macOS 系统通知
- 5 分钟内同一条件不重复通知

**列配置**
- 用户可自定义显示哪些列，配置持久化到 `electron-store`（key: `'visibleColumns'`）
- `symbol` 列始终可见，其余列可自由勾选

---

### 3.2 股票分析页（Analysis）

**顶部报价区**
- 展示股票代码、公司名称、最新价、涨跌幅
- 报价通过 `useStockQuote` hook 按配置间隔自动刷新

**详情 Tab**
- 通过 Finnhub `stock/profile2` 接口获取公司基本信息（仅美股）
- 展示字段：公司名称、Symbol、市值、行业/国家、开盘价、昨收价、日内高低、成交量、最后更新时间

**新闻 Tab**
- 获取最近 7 天内最多 20 条相关新闻（Finnhub，仅美股）
- 展示：标题（可点击跳转原文）、来源、发布时间、摘要（截断展示）
- 内置 5 分钟内存缓存，减少重复 API 调用

**K 线图 Tab**
- 展示历史 K 线图（基于 `getHistoricalData()` 获取真实数据）
- 数据来源标注：`[AKShare]` / `[yfinance]` / `[SIMULATED DATA]`（网络不通时降级）

**技术分析 Modal**
- 点击"Technical Analysis"按钮触发
- 基于真实历史 K 线数据计算：RSI(14)、SMA20、SMA50、SMA200
- 根据 RSI 和均线位置输出 Buy / Hold / Sell 建议
- 数据来源标注：`[AKShare]`、`[yfinance]`、`[SIMULATED DATA]`（网络不通时降级为随机模拟）

**历史问题记录**
- 用户可在分析页输入问题，记录持久化到 `electron-store`（key: `'stockQuestions'`）
- 支持按 symbol 过滤查看历史问题，支持删除

---

### 3.3 设置页（Settings）

**数据源配置**
- **AKShare**：免费无需配置，显示 Ready 状态
- **yfinance**：免费无需配置，显示 Ready 状态
- **Tushare**：输入 Token 后存储到 `settings.tushareToken`，A 股行情优先使用
- **Finnhub**：输入 API Key 后存储到 `settings.finnhubApiKey`，美股行情使用
- Key 保存后立即生效，无需重启

**Provider 优先级配置**
- A 股 Provider 优先级：`tushare,akshare`（可调整顺序）
- 港股 Provider 优先级：`akshare_hk`
- 美股 Provider 优先级：`finnhub,yfinance`

**涨跌色风格**
- 中国风格（红涨绿跌）/ 美股风格（绿涨红跌）

---

### 3.4 基础设施

**多市场数据路由**（`scripts/main.py` + `scripts/providers/`）
- A 股（6位纯数字）→ Tushare（有 Token）→ AKShare stock_zh_a_hist_tx（腾讯财经）
- 港股（XXXXX.HK）→ AKShare stock_hk_spot（新浪财经，10min 缓存）→ stock_hk_daily（降级）
- 美股（其他）→ Finnhub / yfinance
- 所有 Python 输出均有 stdout 重定向保护，防止 AKShare tqdm 进度条污染 JSON

**API 限流队列**（`src/services/stockApi.ts`）
- 最大 30 次/分钟（Finnhub 免费层 60次/分钟的 50%）
- 请求间隔约 2000ms，超出时自动排队等待
- 统一错误处理：429 限流、401 鉴权失败、网络错误

**IPC 安全通信**
- `contextIsolation: true` + `nodeIntegration: false`
- Renderer 只能通过 `window.electronAPI.*` 访问主进程能力
- 完整 IPC 通道列表见 `AGENTS.md` 第 4 节

**主题系统**（`src/theme/config.ts`）
- 自动跟随 macOS 系统深色/浅色模式
- 主色调 `#1890ff`，圆角 `8px`

**自定义标题栏**
- 完全隐藏原生标题栏（`titleBarStyle: 'hidden'`），交通灯移出可见区域
- 自定义窗口控制按钮通过 IPC 调用 `window-minimize/maximize/close`

---

## 四、待实现功能（Backlog）

> 以下功能按优先级排序，P0 最高。实现时须遵守 `AGENTS.md` 中的所有约束。

---

### P0：修复已知 Bug

#### BUG-001 修复：市值展示单位错误（✅ 已修复）
- **问题**：`getProfile()` 返回的 `marketCapitalization` 单位是百万美元，但 `formatMarketCap()` 将其当作美元处理，导致展示值偏小 100 万倍
- **修复方式**：修改 `formatMarketCap()` 接受百万美元单位的输入，内部乘以 `1_000_000` 后再换算（方案 B）

#### BUG-002 修复：搜索结果不自动清空（待修复）
- **问题**：点击搜索框外部空白处，搜索结果下拉列表不会关闭
- **修复方案**：在搜索 Input 上添加 `onBlur` 处理，延迟 200ms 后清空 `searchResults`（延迟是为了让点击搜索结果的事件先触发）

---

### P1：分析页增强

#### 1.1 52 周高低价展示
- **现状**：`Stock` 类型已定义 `high52Week` 和 `low52Week` 字段，但 `getProfile()` 未填充这两个字段
- **需求**：在详情 Tab 中展示 52 周最高价和最低价，以及当前价格在区间内的位置（进度条）
- **实现思路**：Finnhub `stock/profile2` 接口不提供 52 周数据，需调用 `metric` 接口（`/stock/metric?symbol=AAPL&metric=all`）获取 `52WeekHigh` 和 `52WeekLow`；在 `stockApi.ts` 新增 `getMetrics(symbol)` 函数

#### 1.2 同行业对比
- **需求**：在分析页新增"同行业对比"Tab，展示同行业 3-5 只股票的关键指标对比（市值、涨跌幅）
- **实现思路**：Finnhub 提供 `/stock/peers` 接口返回同行业股票列表；对列表中的股票批量调用 `getQuote()`，结果以表格形式展示
- **约束**：批量请求必须走 `apiRequest()` 队列，不能并发直接调用

#### 1.3 财务指标展示
- **需求**：在详情 Tab 新增财务指标区块，展示 P/E Ratio、EPS、ROE、Debt/Equity 等
- **实现思路**：调用 Finnhub `/stock/metric?metric=all` 接口；在 `src/types/index.ts` 新增 `StockMetrics` 类型；在 `stockApi.ts` 新增 `getMetrics(symbol)` 函数

---

### P2：体验优化

#### 2.1 全局搜索快捷键
- **需求**：按下 `Cmd+K` 打开全局搜索框（类似 Spotlight），可快速搜索并跳转到股票分析页
- **实现思路**：在 `App.tsx` 中监听 `keydown` 事件；使用 Ant Design `Modal` + `Input.Search` 实现搜索 UI

#### 2.2 自选股导入/导出
- **需求**：支持将自选股列表导出为 CSV 文件，以及从 CSV 文件批量导入
- **实现思路**：
  1. 新增 IPC 通道 `export-watchlist` 和 `import-watchlist`，在 `main.ts` 中使用 `dialog.showSaveDialog()` / `dialog.showOpenDialog()` 和 `fs` 模块处理文件
  2. 在 `preload.ts` 暴露对应方法
  3. 在 Dashboard 顶部添加导入/导出按钮

#### 2.3 空状态引导优化
- **现状**：watchlist 为空时显示简单引导文案
- **需求**：增加示例股票代码（AAPL、TSLA、000001、03690.HK）的快速添加按钮，覆盖三个市场

---

### P3：架构升级（长期）

#### 3.1 A 股股票名称展示
- **现状**：A 股行情返回的 `name` 字段在 `stock_info_a_code_name()` 未缓存时降级为代码本身（如 `000001`）
- **需求**：在首次搜索/添加时异步加载股票名称缓存，持久化到 `electron-store`（key: `'stockNames'`）
- **约束**：`stock_info_a_code_name()` 有 tqdm 进度条，必须在 stdout 重定向保护下调用

#### 3.2 投资组合追踪
- **需求**：支持记录持仓（买入价、数量），计算盈亏
- **实现思路**：新增 `Portfolio` 类型和持久化存储（key: `'portfolio'`）；新增 `/portfolio` 路由页面
- **约束**：持仓数据不得与实时报价数据混存，分开持久化

#### 3.3 数据导出与备份
- **需求**：支持将自选股、持仓记录、价格提醒配置一键导出为 JSON 备份文件，并支持从备份恢复
- **实现思路**：在 `main.ts` 中实现完整的 `electron-store` 序列化/反序列化逻辑

---

## 五、数据类型规划

### 已定义（`src/types/index.ts`）

```typescript
Quote           // 实时报价：symbol, price, change, changePercent, high, low, open, previousClose, volume?, timestamp
Stock           // 股票基本信息：symbol, name, price, change, changePercent, marketCap?, peRatio?, high52Week?, low52Week?, description?
NewsItem        // 新闻条目：title, source, publishedAt, url, summary?
AnalysisResult  // 技术分析：symbol, rsi?, sma20?, sma50?, sma200?, recommendation, summary, source('akshare'|'yfinance'|'simulated')
StockProfile    // Finnhub 公司档案（API 原始格式）：name, exchange, marketCapitalization, country, industry...
SearchResult    // 搜索结果：symbol, description, displaySymbol, type
HistoricalDataPoint  // 历史 K 线单根：date, open, high, low, close, volume
HistoricalDataResult // 历史 K 线结果：data, source('akshare'|'yfinance'|'simulated'), error?
IndexQuote      // 指数行情：symbol, name, price, change, changePercent
StockQuestion   // 历史问题记录：id, symbol, question, createdAt
```

### 待新增（随功能迭代补充到 `src/types/index.ts`）

```typescript
// P1.3 财务指标
interface StockMetrics {
  peRatio?: number;           // 市盈率（TTM）
  eps?: number;               // 每股收益
  roe?: number;               // 净资产收益率（%）
  debtToEquity?: number;      // 负债权益比
  high52Week?: number;        // 52 周最高价
  low52Week?: number;         // 52 周最低价
  dividendYield?: number;     // 股息率（%）
}

// P3.2 持仓记录
interface PortfolioPosition {
  symbol: string;
  shares: number;             // 持仓数量
  averageCost: number;        // 平均成本价
  purchasedAt: string;        // 首次买入时间（ISO 8601）
}
```

---

## 六、API 接口规划

### 已实现（`src/services/stockApi.ts`）

| 函数 | 数据源 | 说明 |
|------|--------|------|
| `getQuote(symbol)` | Finnhub `GET /quote` | 美股实时报价（需 Key） |
| `getQuoteDirect(symbol)` | Finnhub `GET /quote` | 美股实时报价（不走限流队列，批量并发用） |
| `getProfile(symbol)` | Finnhub `GET /stock/profile2` | 公司基本信息（需 Key） |
| `getNews(symbol)` | Finnhub `GET /company-news` | 最近 7 天新闻（需 Key） |
| `searchSymbol(query)` | Finnhub `GET /search` | 美股代码搜索（需 Key） |
| `getHistoricalData(symbol, startDate, endDate)` | AKShare / yfinance（IPC） | 历史 K 线（三市场，不需要 Key） |
| `getCNQuote(symbol)` | AKShare stock_zh_a_hist_tx（IPC） | A 股实时行情（不需要 Key） |
| `searchCNSymbol(query)` | AKShare 全量数据（IPC） | A 股搜索（不需要 Key） |
| `isCNStock(symbol)` | 本地判断 | 是否为 A 股（6位纯数字） |
| `isHKStock(symbol)` | 本地判断 | 是否为港股（XXXXX.HK 格式） |

### 待实现

| 函数 | Finnhub 接口 | 对应功能 |
|------|-------------|---------|
| `getMetrics(symbol)` | `GET /stock/metric?metric=all` | P1.1 52周高低 / P1.3 财务指标 |
| `getPeers(symbol)` | `GET /stock/peers` | P1.2 同行业对比 |

---

## 七、IPC 通道规划

### 已实现

| 通道名 | 方向 | 说明 |
|--------|------|------|
| `window-minimize` | renderer → main | 最小化窗口 |
| `window-maximize` | renderer → main | 最大化/还原窗口 |
| `window-close` | renderer → main | 关闭窗口 |
| `store-get` | renderer → main | 读取 electron-store |
| `store-set` | renderer → main | 写入 electron-store |
| `settings-get` | renderer → main | 读取用户设置（`settings.*` 命名空间） |
| `settings-set` | renderer → main | 写入用户设置 |
| `stock-get-history` | renderer → main | 历史 K 线（调用 Python scripts/main.py） |
| `stock-get-cn-quote` | renderer → main | A 股实时行情（AKShare） |
| `stock-search-cn` | renderer → main | A 股搜索（AKShare） |
| `stock-get-hk-quote` | renderer → main | 港股实时行情（AKShare） |
| `stock-get-indices` | renderer → main | 关键指数行情（8 个预设指数） |
| `show-notification` | renderer → main | macOS 系统通知（价格提醒） |

### 待实现

| 通道名 | 方向 | 对应功能 |
|--------|------|---------|
| `export-watchlist` | renderer → main | P2.2 导出自选股 CSV |
| `import-watchlist` | renderer → main | P2.2 导入自选股 CSV |
| `export-backup` | renderer → main | P3.3 全量数据备份 |
| `import-backup` | renderer → main | P3.3 从备份恢复 |

---

## 八、已知约束与限制

1. **多市场支持**：A 股（AKShare/Tushare）、港股（AKShare）、美股（Finnhub/yfinance）均已支持；Finnhub Key 为可选配置，不配置时 A 股/港股/历史 K 线仍可正常使用
2. **A 股行情接口**：使用 `stock_zh_a_hist_tx`（腾讯财经），无成交量字段（`volume` 返回 0）；东方财富接口（`stock_zh_a_hist`）在部分网络环境下不可用，已弃用
3. **A 股股票名称**：`stock_info_a_code_name()` 有 tqdm 进度条且可能超时，不在行情获取关键路径上调用；名称缓存为空时显示代码本身
4. **港股行情**：`stock_hk_spot` 在部分网络环境下不可用，降级到 `stock_hk_daily`，总耗时约 10s，前端超时设为 35s
5. **Finnhub API 限额**：免费层 60次/分钟，自选股超过 20 只时批量刷新会触发限流；默认刷新间隔已调整为 5 分钟
6. **技术分析**：RSI/SMA 基于真实历史 K 线数据计算（AKShare/yfinance）；网络不通时降级为随机模拟，UI 标注 `[SIMULATED DATA]`
7. **市值展示**：`formatMarketCap()` 已修复，接受百万美元单位输入，内部乘以 `1_000_000` 后换算
8. **仅支持 macOS 打包**：`electron-builder` 配置仅生成 `.dmg`，Windows/Linux 需额外配置
9. **无自动化测试**：当前无单元测试和 E2E 测试，修改后需手动验证（`npx tsc --noEmit` 是唯一自动化验证手段）
10. **Python 数据层 stdout 保护**：所有调用 AKShare 的 Python 函数必须在 `sys.stdout = sys.stderr` 保护下运行，防止 tqdm 进度条污染 JSON 输出

---

## 九、开发规范

> 详细约束见 `AGENTS.md`，以下是关键原则摘要。

- **所有 API 调用必须经过 `apiRequest()` 限流队列**，禁止直接调用 `axios.get()`
- **Renderer 进程禁止直接使用 Node.js API**，必须通过 `window.electronAPI` IPC 桥接
- **新增持久化字段必须使用新 key**，禁止修改 `'watchlist'` key
- **新增数据类型必须定义在 `src/types/index.ts`**，不在组件文件内定义共享类型
- **数字格式化必须使用 `src/utils/format.ts`** 中的函数，不在组件内手写格式化逻辑
- **新增 IPC 通道必须同时更新** `main.ts`、`preload.ts`、`electron.d.ts` 三个文件