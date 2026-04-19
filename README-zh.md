# StockerChef - 桌面股票看板

基于 Electron + React + Vite + TypeScript + Ant Design 构建的 macOS 桌面股票监控应用。

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**[📖 中文文档](README-zh.md)** | **[English Documentation](README.md)**

## 功能特性

- 📊 **实时行情监控** - 自选股价格自动刷新，支持 A 股、港股、美股，刷新间隔可配置（10s ~ 30min）
- 📈 **技术分析** - 基于真实 K 线数据计算 RSI、SMA 指标及买卖建议
- 📉 **K 线图表** - 使用 lightweight-charts v5 渲染专业 K 线图
- 💬 **AI 对话分析** - 多轮对话 AI 股票分析，支持 Markdown 渲染
- 📰 **股票新闻** - 聚合每只股票的最新资讯
- 🔔 **价格提醒** - 价格/涨幅阈值触发 macOS 系统通知
- 🔀 **拖拽排序** - 自选股列表支持拖拽排序（@dnd-kit）
- 💾 **本地持久化** - 自选股、对话历史、设置自动保存，重启不丢失
- 🌓 **深色/浅色模式** - 自动跟随系统主题
- ⚡ **智能限流** - 请求队列机制，避免触发 API 频率限制
- 🎨 **现代 UI** - 基于 Ant Design 5.x 的美观界面

## 技术栈

- **桌面框架**: Electron 28.x
- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite 5.x
- **UI 组件库**: Ant Design 5.x
- **状态管理**: Zustand 4.x
- **HTTP 客户端**: Axios
- **路由**: React Router v6
- **本地存储**: electron-store
- **数据源**:
  - **A 股**: AKShare（腾讯财经）/ Tushare Pro（可选）
  - **港股**: AKShare（新浪财经）
  - **美股**: Finnhub API + yfinance
  - **指数**: AKShare（上证/恒生/纳斯达克/标普等）
- **Python 依赖**: akshare, tushare（可选）, yfinance

## 环境要求

- Node.js 18.x 或更高版本
- Python 3.8 或更高版本（用于获取股票数据）
- npm 或 yarn
- macOS 系统（`.dmg` 打包仅支持 macOS）

## 快速开始

### 1. 克隆项目

```bash
git clone <repository-url>
cd StockerChef
```

### 2. 安装依赖

#### 2.1 安装 Node.js 依赖

```bash
npm install
```

这将安装所有前端和 Electron 相关的依赖包（包括 Electron 本身约 150MB）。

#### 2.2 安装 Python 依赖（必需）

应用使用 Python 脚本获取 A 股、港股和美股数据，必须安装以下依赖：

**方式一：系统级安装（推荐，简单快速）**

```bash
python3 -m pip install --break-system-packages -r requirements.txt
```

**方式二：使用虚拟环境（推荐用于开发）**

```bash
# 创建虚拟环境
python3 -m venv .venv

# 激活虚拟环境
source .venv/bin/activate

# 安装依赖
python3 -m pip install -r requirements.txt
```

**必需的 Python 包：**
- `akshare` - A 股、港股、美股指数数据（免费，无需配置）
- `tushare` - A 股数据（可选，需要申请 Token）
- `yfinance` - 美股历史 K 线数据（免费，无需配置）

**验证安装：**

```bash
# 测试 Python 脚本是否正常工作
python3 scripts/main.py --action get_indices
```

如果看到返回 JSON 格式的指数数据（上证指数、恒生指数、纳斯达克等），说明安装成功。

### 3. 配置 Finnhub API Key（可选）

Finnhub Key 是**可选配置**，用于以下功能：
- ✅ 美股实时报价
- ✅ 股票搜索
- ✅ 公司新闻
- ✅ 公司档案信息

**不影响的功能**（无需 Finnhub Key）：
- ✅ A 股/港股实时行情
- ✅ 历史 K 线数据
- ✅ 技术分析（RSI/SMA）
- ✅ K 线图表

**获取 API Key：**

1. 访问 [https://finnhub.io/register](https://finnhub.io/register)
2. 注册免费账号
3. 在 [Dashboard](https://finnhub.io/dashboard) 复制 API Key

**配置方式：**

1. 启动应用后，进入 **设置 → 数据源** 页面
2. 在 Finnhub 输入框中粘贴 API Key
3. 点击保存，立即生效（无需重启）

### 4. 启动应用

```bash
npm run dev
```

这将同时启动：
- Vite 开发服务器（前端热更新）
- Electron 应用窗口

应用启动后，DevTools 会自动打开用于调试。

## 开发命令

```bash
# 启动开发模式
npm run dev

# 生产构建（类型检查 → 前端打包 → Electron 打包）
npm run build

# 预览生产构建（仅 Web 端）
npm run preview
```

## 项目结构

```
StockerChef/
├── src/                     # 源代码
│   ├── electron/            # Electron 主进程
│   │   ├── main.ts          # 主进程（窗口管理、IPC 处理）
│   │   └── preload.ts       # 安全 IPC 桥接
│   ├── components/          # 可复用 UI 组件
│   │   └── KLineChart.tsx   # K 线图表组件
│   ├── hooks/               # 自定义 React Hooks
│   │   ├── useStockQuote.ts # 股票报价轮询 Hook
│   │   └── useStockNews.ts  # 新闻获取 Hook（含缓存）
│   ├── pages/               # 页面组件
│   │   ├── Dashboard.tsx    # 自选股看板
│   │   ├── Analysis.tsx     # 股票分析页
│   │   └── Settings.tsx     # 设置页
│   ├── services/            # API 服务层
│   │   └── stockApi.ts      # Finnhub API 集成 + 限流队列
│   ├── store/               # Zustand 状态管理
│   │   └── useStockStore.ts # 全局股票状态
│   ├── styles/              # 全局样式
│   │   └── global.css       # CSS 工具类
│   ├── theme/               # Ant Design 主题配置
│   │   └── config.ts        # 深色/浅色主题
│   ├── types/               # TypeScript 类型定义
│   │   ├── index.ts         # 数据类型
│   │   └── electron.d.ts    # Electron API 类型
│   ├── utils/               # 工具函数
│   │   └── format.ts        # 格式化助手
│   ├── App.tsx              # 主应用组件
│   ├── main.tsx             # React 入口点
│   └── vite-env.d.ts        # Vite 环境类型
├── scripts/                 # Python 数据获取脚本
│   ├── main.py              # 统一入口
│   └── providers/           # 多 Provider 架构
│       ├── cn_akshare.py    # A 股 AKShare
│       ├── cn_tushare.py    # A 股 Tushare
│       ├── hk_akshare.py    # 港股 AKShare
│       └── us_yfinance.py   # 美股 yfinance
├── resources/               # 应用资源
│   └── icon.icns            # macOS 应用图标
├── requirements.txt         # Python 依赖列表
├── package.json             # Node.js 依赖
├── tsconfig.json            # TypeScript 配置
├── vite.config.ts           # Vite 配置
└── README.md                # 英文文档
```

## 使用说明

### 添加自选股

1. 在看板页面顶部使用搜索框
2. 输入股票代码或名称（如：`000001`、`茅台`、`AAPL`）
3. 点击搜索结果或按回车添加
4. 股票将出现在自选股列表中，带实时价格

### 查看股票分析

1. 点击看板中的任意股票卡片
2. 进入分析页面，可查看：
   - **详情**：公司信息、市值、行业等
   - **新闻**：最近 7 天相关新闻
   - **技术分析**：RSI(14)、SMA20/50/200 指标及买卖建议
3. 点击 K 线图表可查看详细走势图

### 删除股票

- 点击股票卡片上的删除图标（垃圾桶）即可从自选股中移除

### 配置数据源

进入 **设置 → 数据源** 页面：

- **AKShare**：免费，无需配置，状态显示 "Ready"
- **yfinance**：免费，无需配置，状态显示 "Ready"
- **Finnhub**：需要输入 API Key，用于美股数据
- **Tushare**（可选）：如需使用 Tushare 获取 A 股数据，需申请 Token 并配置

### 涨跌色风格

在设置页面可切换：
- **中国风格**：红涨绿跌
- **美股风格**：绿涨红跌

## 数据流架构

```
用户操作
  │
  ▼
React 组件（Dashboard / Analysis）
  │
  ▼
Zustand Store（状态管理）
  │
  ├─ 前端 API（Finnhub）→ 美股报价/新闻/搜索
  │
  └─ IPC 调用 → Electron 主进程
       │
       ▼
  Python 脚本（scripts/main.py）
       │
       ├─ AKShare → A 股/港股/指数数据
       ├─ yfinance → 美股历史 K 线
       └─ Tushare → A 股数据（可选）
       │
       ▼
  返回 JSON 数据 → 更新 Store → 触发 UI 重渲染
```

## API 限流机制

应用实现了客户端限流，遵守 Finnhub 免费层限制：

- **最大请求数**：每分钟 30 次（Finnhub 限额的 50%）
- **请求队列**：所有 API 调用通过队列，间隔 ~2 秒
- **自动退避**：触发限流时暂停并通知用户
- **新闻缓存**：新闻数据缓存 5 分钟，减少重复请求

如果遇到限流错误：
1. 等待 1-2 分钟后重试
2. 减少自选股数量
3. 考虑升级到 Finnhub 付费版

## 数据持久化

自选股列表通过 `electron-store` 自动保存到本地，数据在应用重启后仍然有效。

**存储位置（macOS）：**
```
~/Library/Application Support/stocker-chef/
```

**存储的 Key：**
- `watchlist` - 自选股代码列表（不要修改此 key，会导致数据丢失）
- `settings.finnhubApiKey` - Finnhub API Key
- `settings.cnProviderPriority` - A 股数据源优先级
- `settings.refreshInterval` - 刷新间隔（秒）

## 常见问题

### Python 脚本报错："No module named 'akshare'"

**原因**：Python 依赖未安装

**解决方法**：
```bash
# 安装 Python 依赖
python3 -m pip install --break-system-packages -r requirements.txt

# 验证安装
python3 scripts/main.py --action get_indices
```

### GPU 进程崩溃 / 网络服务崩溃（macOS）

**现象**：终端显示 `GPU process exited unexpectedly` 或 `Network service crashed`

**原因**：Electron 28+ 在 macOS 上的硬件加速兼容性问题

**解决方法**：
- ✅ 已在代码中修复：`app.disableHardwareAcceleration()` 已启用
- 如果仍看到此错误，重启应用即可
- 这些错误无害，不影响应用功能

### Finnhub "Invalid API key" 错误

**解决方法**：
1. 进入 **设置 → 数据源** 页面
2. 输入正确的 Finnhub API Key
3. 点击保存，立即生效

### "Rate limit exceeded" 错误

**原因**：短时间内请求过多

**解决方法**：
1. 等待 1-2 分钟后重试
2. 减少自选股数量
3. 增加刷新间隔（设置页面）

### 应用无法启动

**检查清单**：
```bash
# 1. 检查 Node.js 版本（应 >= 18）
node --version

# 2. 检查 Python 版本（应 >= 3.8）
python3 --version

# 3. 重新安装 Node.js 依赖
rm -rf node_modules dist dist-electron
npm install

# 4. 重新安装 Python 依赖
python3 -m pip install --break-system-packages -r requirements.txt
```

### 股票数据不加载

**排查步骤**：
1. 检查网络连接
2. 验证 Finnhub API Key 是否有效（设置页面）
3. 确认 Python 包已正确安装
4. 打开浏览器控制台查看错误信息（开发模式自动打开 DevTools）
5. A 股/港股：AKShare 可能暂时不可用，应用会自动重试

### 搜索结果不消失

**已知问题**：点击空白处不会清空搜索下拉列表

**临时解决**：手动清空搜索框内容

## 生产构建

创建可分发的 macOS 安装包：

```bash
npm run build
```

这将依次执行：
1. TypeScript 类型检查（`tsc`）
2. Vite 前端构建
3. Electron Builder 打包

**产物位置：**
- `dist/` - React 前端静态文件
- `dist-electron/` - Electron 主进程编译产物
- `dist/*.dmg` - macOS 安装包（可直接分发）

### 应用图标

应用使用 `resources/icon.icns` 作为图标，已配置用于：
- **macOS 应用图标**：Finder 和 Dock 中显示
- **DMG 安装器图标**：安装对话框中显示
- **窗口图标**：开发模式下使用

**图标要求：**
- 格式：`.icns`（macOS）或 `.png`（开发模式）
- 推荐尺寸：512x512 或 1024x1024 像素
- `resources/icon.icns` 已配置好，可直接使用

**替换图标：**
```bash
# 替换为自定义图标（保持文件名）
cp your-icon.icns resources/icon.icns
```

## 自定义配置

### 修改刷新间隔

在 `src/store/useStockStore.ts` 中修改默认值：

```typescript
refreshInterval: 300, // 默认 300 秒（5 分钟）
```

用户也可在设置页面自定义。

### 调整限流阈值

编辑 `src/services/stockApi.ts`：

```typescript
const MAX_REQUESTS_PER_MINUTE = 30; // 修改此值
```

### 修改数据源优先级

在设置页面配置，或修改默认值：

```typescript
// Settings.tsx
DEFAULT_CN_PROVIDERS = ['tushare', 'akshare']
DEFAULT_HK_PROVIDERS = ['akshare_hk']
DEFAULT_US_PROVIDERS = ['finnhub', 'yfinance']
```

## 安全说明

### Electron 安全边界

- ✅ `contextIsolation: true` - 启用上下文隔离
- ✅ `nodeIntegration: false` - 禁用 Node.js 集成
- ✅ 所有 IPC 通信通过 `preload.ts` 桥接
- ❌ **禁止**在渲染进程中直接使用 Node.js API

### API Key 存储

- Finnhub API Key 存储在 `electron-store` 中（本地文件）
- 不会上传到任何服务器
- 不会提交到 Git 仓库

## 未来计划

- [ ] WebSocket 实时推送（替代轮询）
- [ ] 投资组合跟踪
- [ ] 多个自选股列表
- [ ] 导出数据为 CSV
- [ ] 更多技术指标（MACD、BOLL 等）
- [ ] 更多数据源提供商

## 许可证

MIT License - 可自由用于个人或商业项目。

## 致谢

- [AKShare](https://github.com/akfamily/akshare) - A 股、港股、指数数据
- [yfinance](https://github.com/ranaroussi/yfinance) - 美股历史 K 线数据
- [Finnhub](https://finnhub.io/) - 美股实时报价和新闻 API
- [Ant Design](https://ant.design/) - 精美的 UI 组件库
- [Electron](https://www.electronjs.org/) - 桌面应用框架
- [lightweight-charts](https://www.tradingview.com/lightweight-charts/) - K 线图表渲染
- [TradingAgents-CN](https://github.com/TradingAgents-CN) - Python Provider 架构参考

---

**注意**：技术分析功能基于真实 K 线数据计算。当网络不可用时，AKShare/yfinance 会降级为随机模拟数据，UI 会明确标注数据来源（`[AKShare]` / `[yfinance]` / `[SIMULATED DATA]`）。
