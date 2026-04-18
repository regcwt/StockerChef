请为我生成一个基于 Electron + React + Vite + TypeScript + Ant Design 的 macOS 桌面股票看板应用初始代码。

## 技术栈要求
- 框架：Electron + React 18 + TypeScript
- 构建：Vite（使用 `vite-plugin-electron` 集成 Electron）
- UI 组件：Ant Design 5.x
- 状态管理：Zustand 或 React Context（优先 Zustand）
- 数据请求：Axios
- 本地存储：electron-store 或 localStorage
- 股票实时数据 API：使用免费 API（优先选择 Alpha Vantage 或 Finnhub，需处理 API 限频，建议使用 WebSocket 或轮询，注明需申请免费 API Key 并配置到 `.env`）
- 新闻数据：与股票实时 API 相同提供商或 NewsAPI（免费层）

## 应用结构与页面导航
应用包含两个主要页面，使用 React Router v6 管理路由：

1. **首页（股票仪表盘）**：路由 `/`
2. **股票分析页**：路由 `/analysis/:symbol`

顶部导航栏（Ant Design Layout.Header）包含应用标题，首页有“添加股票”按钮。

## 功能模块详情

### 1. 股票仪表盘（首页）
- 展示用户自选的股票列表，以卡片或表格形式显示：
  - 股票代码、名称
  - 最新价、涨跌幅、涨跌额（红绿颜色标识）
  - 可删除股票（每项有删除图标）
- 顶部有“添加股票”输入框（支持输入美股代码如 AAPL, TSLA 或 A 股代码需自行约定）
- 点击股票卡片/行，跳转到 `/analysis/:symbol` 详情页
- 数据实时更新（可配置 10 秒轮询最新报价，或模拟 WebSocket 连接）

### 2. 股票分析页
- 展示股票基本信息：代码、名称、最新价、涨跌幅
- 包含两个 Tab 页签：
  - **详情**：显示公司简介、市值、市盈率、52周高低等基本面数据（从 API 获取）
  - **新闻**：列表显示该股票相关新闻（标题、来源、发布时间、可点击原文链接）
- 页面底部或右上角有一个“分析”按钮，点击后在同一页面下方或弹出 Modal 显示**技术分析图表**（或简单分析结果，如模拟的移动平均线或 RSI 评语；若引入图表库可用 recharts 或 lightweight-charts，这里优先用文字分析结果以降低复杂度）

### 3. 本地数据持久化
- 用户自选股票列表保存在本地（electron-store）
- 应用启动时加载自选列表，并请求实时数据

## UI 风格与布局
- 使用 Ant Design 的 Layout（Sider + Content 或纯顶部导航）
- 主色调：深色/浅色自动跟随系统（使用 Ant Design ConfigProvider 主题）
- 卡片式股票列表，响应式布局

## 关键代码要求
1. **Electron 主进程**：创建窗口，处理 IPC 通信（如果使用 electron-store，通过 preload 暴露安全 API）
2. **Preload 脚本**：暴露 `electronAPI` 对象，包含 `store.get/set` 方法用于读取/写入自选列表
3. **React 部分**：
   - 封装 API 请求模块（`services/stockApi.ts`），包含获取报价、详情、新闻的函数
   - 自定义 Hook：`useStockQuote(symbol)` 实现定时轮询
   - 页面组件：`Dashboard.tsx`, `Analysis.tsx`
4. **环境变量**：在 `.env` 中配置 `VITE_STOCK_API_KEY`，并在代码中使用

## 注意事项
- 免费 API 通常有调用频率限制，请在前端实现请求节流与错误处理（如 API 返回限频错误时暂停轮询并提示用户）
- 若无法获取真实新闻数据，可生成模拟数据，但需在代码注释中标明切换方式
- 所有 TypeScript 类型需明确定义（如 `Stock`, `Quote`, `NewsItem`）

## 最终交付物
- 完整的项目目录结构
- 可运行 `npm run dev` 启动桌面应用
- 清晰的 README 说明如何获取 API Key 及配置

请生成代码。