import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import Store from 'electron-store';
import { readFileSync, existsSync } from 'fs';
import {
  fetchCNQuotes,
  fetchHKQuotes,
  fetchUSQuotes,
  fetchIndices as fetchEastMoneyIndices,
} from '../services/eastmoney';

// Disable hardware acceleration to prevent GPU process crashes on macOS
// This is safe for stock dashboard apps that don't need 3D rendering
app.disableHardwareAcceleration();

const store = new Store();

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    // 完全隐藏原生标题栏，实现沉浸式效果
    titleBarStyle: 'hidden',
    // macOS：将红绿黄交通灯移出可见区域，实现真正无标题栏
    trafficLightPosition: { x: -100, y: -100 },
    icon: process.platform === 'darwin'
      ? resolve(__dirname, '../../resources/icon.icns')
      : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // ── 全局放开跨域：所有渲染进程发起的 HTTP/HTTPS 请求允许任意源 ────────────
  // 1. CSP 的 connect-src 放开为 * https: http:，允许 fetch/axios 调用任意域名
  // 2. 响应头注入 Access-Control-Allow-* 系列，让浏览器侧 CORS 预检通过
  // 3. 同时拦截 OPTIONS 预检请求，直接返回 200 + 完整 CORS 头
  //
  // ⚠️ 安全权衡：保留 contextIsolation: true + nodeIntegration: false（renderer 仍无 Node 能力）
  //              仅放开网络层 CORS，等价于浏览器扩展 "Allow CORS"，对桌面端股票看板可接受
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = app.isPackaged
      ? [
          "default-src 'self';",
          "script-src 'self';",
          "style-src 'self' 'unsafe-inline';",
          "img-src 'self' data: https: http:;",
          "connect-src 'self' https: http: ws: wss: data:;",
        ].join(' ')
      : [
          "default-src 'self' 'unsafe-inline' http://localhost:* ws://localhost:*;",
          "script-src 'self' 'unsafe-inline';",
          "style-src 'self' 'unsafe-inline';",
          "img-src 'self' data: https: http:;",
          "connect-src 'self' https: http: ws: wss: data: http://localhost:* ws://localhost:*;",
        ].join(' ');

    // electron 的 responseHeaders 值是 string[]，统一去掉服务器原本可能返回的 CORS 头，避免冲突
    const cleanedHeaders: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(details.responseHeaders ?? {})) {
      if (!/^access-control-/i.test(key)) {
        cleanedHeaders[key] = Array.isArray(value) ? value : [String(value)];
      }
    }

    // 注：Access-Control-Allow-Origin 设为 *，不能同时启用 Allow-Credentials: true（CORS 规范限制）
    //     桌面应用不依赖第三方 cookie，可接受。如未来需要发凭证请求，再改为按 Origin 回写。
    callback({
      responseHeaders: {
        ...cleanedHeaders,
        'Content-Security-Policy': [csp],
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Methods': ['GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD'],
        'Access-Control-Allow-Headers': ['*'],
        'Access-Control-Expose-Headers': ['*'],
        'Access-Control-Max-Age': ['86400'],
      },
    });
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 禁用 GPU 硬件加速，避免 GPU process crash 和网络服务崩溃
// macOS 上 Electron 28+ 的常见问题，禁用后对股票看板应用无影响
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  // 开发模式下手动设置 Dock 图标（打包后由 electron-builder 自动处理）
  // 用 try-catch 包裹，避免路径不存在时抛出未捕获异常导致 UnhandledPromiseRejection
  if (process.platform === 'darwin' && !app.isPackaged) {
    try {
      // 开发模式下 __dirname = dist-electron/，icon.png 在项目根的 resources/ 下
      // 正确路径：dist-electron/../resources/icon.png（一层 ..，不是两层）
      // app.dock.setIcon() 在 macOS 上只接受 .png，不接受 .icns
      const dockIconPath = resolve(__dirname, '../resources/icon.png');
      app.dock.setIcon(dockIconPath);
    } catch (err) {
      console.warn('[StockerChef] Failed to set dock icon:', err);
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for window controls（自定义标题栏按钮）
ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow?.close();
});

// IPC handlers for electron-store
ipcMain.handle('store-get', (_event, key: string) => {
  return store.get(key);
});

ipcMain.handle('store-set', (_event, key: string, value: unknown) => {
  store.set(key, value);
  return true;
});

// IPC handlers for user settings（数据源 Key 等用户配置）
// 存储在 electron-store 的 'settings' 命名空间下，与 watchlist 隔离
ipcMain.handle('settings-get', (_event, key: string) => {
  return store.get(`settings.${key}`);
});

ipcMain.handle('settings-set', (_event, key: string, value: unknown) => {
  store.set(`settings.${key}`, value);
  return true;
});

// ── Python 脚本路径辅助 ──────────────────────────────────────────────────────
// 统一入口：scripts/main.py（基于 providers/ 包的多 Provider 架构）
function getPythonScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'scripts/main.py')
    // 开发模式：__dirname = dist-electron/，scripts/ 在项目根，只需一层 ..
    : join(__dirname, '../scripts/main.py');
}

// ── Provider 优先级辅助 ───────────────────────────────────────────────────────
// 从 electron-store 读取各市场 provider 优先级，供 Python 脚本使用
// 默认值与 Settings.tsx 中的 DEFAULT_*_PROVIDERS 保持一致

function getCnProviders(): string {
  const stored = store.get('settings.cnProviderPriority');
  if (Array.isArray(stored) && stored.length > 0) return (stored as string[]).join(',');
  return 'tushare,akshare';
}

function getHkProviders(): string {
  const stored = store.get('settings.hkProviderPriority');
  if (Array.isArray(stored) && stored.length > 0) return (stored as string[]).join(',');
  return 'akshare_hk';
}

function getUsProviders(): string {
  const stored = store.get('settings.usProviderPriority');
  if (Array.isArray(stored) && stored.length > 0) return (stored as string[]).join(',');
  return 'finnhub,yfinance';
}

// Token 辅助：从 electron-store 读取各 provider 的 Token/Key
function getTushareToken(): string {
  return (store.get('settings.tushareToken') as string | undefined) ?? '';
}

function getFinnhubApiKey(): string {
  return (store.get('settings.finnhubApiKey') as string | undefined) ?? '';
}

// 通用 Python 脚本执行辅助（带 try-catch 防止 execFile 同步抛出异常）
function runPythonScript(
  args: string[],
  timeoutMs: number,
  resolve: (value: string) => void,
): void {
  const scriptPath = getPythonScriptPath();
  try {
    execFile(
      'python3',
      [scriptPath, ...args],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          resolve(JSON.stringify({ error: 'exec_failed', message: stderr || error.message }));
          return;
        }
        resolve(stdout.trim());
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    resolve(JSON.stringify({ error: 'exec_failed', message }));
  }
}

// 构建 Token 参数列表（仅在 Token 非空时追加）
function buildTokenArgs(): string[] {
  const args: string[] = [];
  const tushareToken = getTushareToken();
  const finnhubKey = getFinnhubApiKey();
  if (tushareToken) args.push('--tushare-token', tushareToken);
  if (finnhubKey) args.push('--finnhub-key', finnhubKey);
  return args;
}

// IPC handler for A 股实时行情
// 优先使用东方财富 push2 HTTP API（Node.js fetch，毫秒级），降级到 Python
ipcMain.handle('stock-get-cn-quote', (_event, symbols: string): Promise<string> => {
  const symbolList = symbols.split(',').map((s) => s.trim()).filter(Boolean);

  // 优先：东方财富 push2（Node.js fetch，无需 Python）
  return fetchCNQuotes(symbolList)
    .then((result) => JSON.stringify(result))
    .catch((err) => {
      // 降级：Python Provider 链
      console.warn('[CN Quote] 东方财富失败，降级到 Python:', err.message);
      return new Promise<string>((resolve) => {
        const args = [
          '--action', 'cn_quote',
          '--symbols', symbols,
          '--cn-providers', getCnProviders(),
          ...buildTokenArgs(),
        ];
        runPythonScript(args, 60000, resolve);
      });
    });
});

// IPC handler for A 股搜索
// 数据源优先级由 settings.cnProviderPriority 控制
ipcMain.handle('stock-search-cn', (_event, query: string): Promise<string> => {
  return new Promise((resolve) => {
    const args = [
      '--action', 'cn_search',
      '--query', query,
      '--cn-providers', getCnProviders(),
      ...buildTokenArgs(),
    ];
    runPythonScript(args, 60000, resolve);
  });
});

// IPC handler for 港股实时行情
// 优先使用东方财富 push2 HTTP API（Node.js fetch，毫秒级），降级到 Python AKShare
ipcMain.handle('stock-get-hk-quote', (_event, symbols: string): Promise<string> => {
  const symbolList = symbols.split(',').map((s) => s.trim()).filter(Boolean);

  return fetchHKQuotes(symbolList)
    .then((result) => JSON.stringify(result))
    .catch((err) => {
      // 降级：Python Provider 链（AKShare stock_hk_spot）
      console.warn('[HK Quote] 东方财富失败，降级到 Python:', err.message);
      return new Promise<string>((resolve) => {
        const args = [
          '--action', 'hk_quote',
          '--symbols', symbols,
          '--hk-providers', getHkProviders(),
        ];
        // 增加到 90 秒以允许 AKShare 完成缓存（首次约 55 秒，后续会使用缓存）
        runPythonScript(args, 90000, resolve);
      });
    });
});

// IPC handler for 美股实时行情
// 优先使用东方财富 push2 HTTP API（按 ticker 白名单精准选择 105/106 市场代码），降级到 Python
ipcMain.handle('stock-get-us-quote', (_event, symbols: string): Promise<string> => {
  const symbolList = symbols.split(',').map((s) => s.trim()).filter(Boolean);

  return fetchUSQuotes(symbolList)
    .then((result) => JSON.stringify(result))
    .catch((err) => {
      // 降级：Python Provider 链（Finnhub → yfinance）
      console.warn('[US Quote] 东方财富失败，降级到 Python:', err.message);
      return new Promise<string>((resolve) => {
        const args = [
          '--action', 'us_quote',
          '--symbols', symbols,
          '--us-providers', getUsProviders(),
          ...buildTokenArgs(),
        ];
        runPythonScript(args, 60000, resolve);
      });
    });
});

// IPC handler for 关键指数行情
// 走东方财富 push2 HTTP API（主进程 node:https，一次请求获取全部 8 个指数）
// ⚠️ 按需求**不再降级到 Python**：失败直接把真实错误（含 cause）回传前端，便于排查
ipcMain.handle('stock-get-indices', async (): Promise<string> => {
  console.log('[INDICES] 收到 stock-get-indices 请求，开始调用东方财富');
  try {
    const result = await fetchEastMoneyIndices();
    console.log('[INDICES] 东方财富返回', result.length, '个指数:',
                result.map((r) => `${r.symbol}=${r.price}`).join(', '));
    return JSON.stringify(result);
  } catch (err) {
    // 把根因（含 undici 的 cause）尽量完整地打到主进程日志和前端
    const cause = (err as { cause?: unknown }).cause;
    const detail = err instanceof Error
      ? `${err.name}: ${err.message}${cause ? ` | cause=${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}` : ''}`
      : String(err);
    console.error('[INDICES] 东方财富指数请求失败（不再降级到 Python）:', detail);
    if (err instanceof Error && err.stack) console.error(err.stack);
    return JSON.stringify({ error: 'indices_fetch_failed', message: detail });
  }
});

// IPC handler for system notifications（股价/涨幅阈值触发提醒）
ipcMain.handle('show-notification', (_event, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// ── 预置股票数据加载 ──────────────────────────────────────────────────────────
// 从 data/ 目录读取预下载的股票列表 JSON 文件
// 用于本地搜索，提升搜索速度和体验

function getPresetStockDataPath(market: 'cn' | 'hk' | 'us'): string {
  const filename = `stocks-${market}.json`;
  return app.isPackaged
    ? join(process.resourcesPath, `data/${filename}`)
    : join(__dirname, `../data/${filename}`);
}

ipcMain.handle('stock-get-preset-data', (_event, market: 'cn' | 'hk' | 'us'): string => {
  const filePath = getPresetStockDataPath(market);
  
  if (!existsSync(filePath)) {
    console.warn(`[Preset Stocks] ${market} 数据文件不存在: ${filePath}`);
    return JSON.stringify([]);
  }
  
  try {
    const data = readFileSync(filePath, 'utf-8');
    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Preset Stocks] 读取 ${market} 数据失败:`, message);
    return JSON.stringify([]);
  }
});

// IPC handler for stock historical data
// 数据源路由由 providers/ 架构根据 --cn-providers / --hk-providers / --us-providers 控制：
//   A 股（6位数字）→ 按 cnProviderPriority 顺序（默认 tushare → akshare）
//   港股（XXXXX.HK）→ 按 hkProviderPriority 顺序（默认 akshare_hk）
//   美股（其他）    → yfinance
ipcMain.handle(
  'stock-get-history',
  (_event, symbol: string, startDate: string, endDate: string): Promise<string> => {
    return new Promise((resolve) => {
      const args = [
        symbol, startDate, endDate,
        '--cn-providers', getCnProviders(),
        '--hk-providers', getHkProviders(),
        '--us-providers', getUsProviders(),
        ...buildTokenArgs(),
      ];
      runPythonScript(args, 30000, resolve);
    });
  },
);
