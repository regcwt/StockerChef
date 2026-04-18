import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import Store from 'electron-store';
import { readFileSync, existsSync } from 'fs';

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

  // 设置 Content-Security-Policy，消除 Electron 安全警告
  // 开发模式需要允许 localhost Vite dev server 的 ws:// 和 http://
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const isDev = !!process.env.VITE_DEV_SERVER_URL;
    const csp = isDev
      ? [
          "default-src 'self' 'unsafe-inline' http://localhost:* ws://localhost:*;",
          "script-src 'self' 'unsafe-inline';",
          "style-src 'self' 'unsafe-inline';",
          "img-src 'self' data: https:;",
          "connect-src 'self' https://finnhub.io http://localhost:* ws://localhost:*;",
        ].join(' ')
      : [
          "default-src 'self';",
          "script-src 'self';",
          "style-src 'self' 'unsafe-inline';",
          "img-src 'self' data: https:;",
          "connect-src 'self' https://finnhub.io;",
        ].join(' ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
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
  if (process.platform === 'darwin' && process.env.VITE_DEV_SERVER_URL) {
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
  return process.env.VITE_DEV_SERVER_URL
    // 开发模式：__dirname = dist-electron/，scripts/ 在项目根，只需一层 ..
    ? join(__dirname, '../scripts/main.py')
    : join(process.resourcesPath, 'scripts/main.py');
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
// 数据源优先级由 settings.cnProviderPriority 控制，默认 tushare → akshare
ipcMain.handle('stock-get-cn-quote', (_event, symbols: string): Promise<string> => {
  return new Promise((resolve) => {
    const args = [
      '--action', 'cn_quote',
      '--symbols', symbols,
      '--cn-providers', getCnProviders(),
      ...buildTokenArgs(),
    ];
    runPythonScript(args, 60000, resolve);
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
// 数据源优先级由 settings.hkProviderPriority 控制，默认 akshare_hk
// 注意：AKShare 港股需要缓存全量数据（约 2745 只），首次调用需要 ~55 秒
ipcMain.handle('stock-get-hk-quote', (_event, symbols: string): Promise<string> => {
  return new Promise((resolve) => {
    console.log('[HK DEBUG main.ts] Getting HK quote for symbols:', symbols);
    const args = [
      '--action', 'hk_quote',
      '--symbols', symbols,
      '--hk-providers', getHkProviders(),
    ];
    console.log('[HK DEBUG main.ts] Python args:', args);
    // 增加到 90 秒以允许 AKShare 完成缓存（首次约 55 秒，后续会使用缓存）
    runPythonScript(args, 90000, (result) => {
      console.log('[HK DEBUG main.ts] Python result:', result);
      resolve(result);
    });
  });
});

// IPC handler for 关键指数行情
// 数据源：A 股指数（上证、科创综指）→ AKShare stock_zh_index_daily
//         港股指数（恒生、恒生科技）→ AKShare stock_hk_index_spot_sina
//         美股指数（纳斯达克、标普）→ AKShare index_us_stock_sina（最近两日对比计算涨跌）
ipcMain.handle('stock-get-indices', (): Promise<string> => {
  return new Promise((resolve) => {
    console.log('[INDICES DEBUG] main.ts: Executing Python script for get_indices');
    runPythonScript(['--action', 'get_indices'], 60000, (result) => {
      console.log('[INDICES DEBUG] main.ts: Python script result:', result);
      resolve(result);
    });
  });
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
  return process.env.VITE_DEV_SERVER_URL
    ? join(__dirname, `../data/${filename}`)
    : join(process.resourcesPath, `data/${filename}`);
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
