import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import Store from 'electron-store';

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

// IPC handler for A 股实时行情（通过 AKShare stock_zh_a_spot）
ipcMain.handle('stock-get-cn-quote', (_event, symbols: string): Promise<string> => {
  return new Promise((resolve) => {
    const scriptPath = process.env.VITE_DEV_SERVER_URL
      ? join(__dirname, '../../scripts/yfinance_fetch.py')
      : join(process.resourcesPath, 'scripts/yfinance_fetch.py');

    try {
      execFile(
        'python3',
        [scriptPath, '--action', 'cn_quote', '--symbols', symbols],
        { timeout: 60000 },
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
  });
});

// IPC handler for A 股搜索（从 AKShare 全量数据中模糊匹配）
ipcMain.handle('stock-search-cn', (_event, query: string): Promise<string> => {
  return new Promise((resolve) => {
    const scriptPath = process.env.VITE_DEV_SERVER_URL
      ? join(__dirname, '../../scripts/yfinance_fetch.py')
      : join(process.resourcesPath, 'scripts/yfinance_fetch.py');

    try {
      execFile(
        'python3',
        [scriptPath, '--action', 'cn_search', '--query', query],
        { timeout: 60000 },
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
  });
});

// IPC handler for system notifications（股价/涨幅阈值触发提醒）
ipcMain.handle('show-notification', (_event, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// IPC handler for stock historical data（双数据源：AKShare 优先，yfinance 降级）
// 通过 child_process 调用 Python 脚本获取历史 K 线数据
// 参考 TradingAgents-CN 的多数据源降级机制
ipcMain.handle(
  'stock-get-history',
  (_event, symbol: string, startDate: string, endDate: string): Promise<string> => {
    return new Promise((resolve) => {
      // 脚本路径：开发模式下相对于项目根目录，生产模式下相对于 app.getAppPath()
      const scriptPath = process.env.VITE_DEV_SERVER_URL
        ? join(__dirname, '../../scripts/stock_fetch.py')
        : join(process.resourcesPath, 'scripts/stock_fetch.py');

      try {
        execFile(
          'python3',
          [scriptPath, symbol, startDate, endDate],
          { timeout: 30000 },
          (error, stdout, stderr) => {
            if (error) {
              // 将错误信息序列化为 JSON 字符串返回，由 renderer 解析
              resolve(JSON.stringify({ error: 'exec_failed', message: stderr || error.message }));
              return;
            }
            // stdout 是 Python 脚本输出的 JSON 字符串
            resolve(stdout.trim());
          },
        );
      } catch (err: unknown) {
        // execFile 本身同步抛出异常时（如 python3 不存在）的兜底处理
        const message = err instanceof Error ? err.message : String(err);
        resolve(JSON.stringify({ error: 'exec_failed', message }));
      }
    });
  },
);
