/**
 * 统一日志工具
 *
 * 在每条日志前加上本地时间戳（精确到毫秒），保留原有的 `[模块]` 前缀语义。
 * 主进程（src/electron/）和渲染进程（src/）均可使用，无任何 Electron / Node 依赖。
 *
 * 用法：
 *   import { log } from '@/utils/logger';
 *   log.log('[INDICES] 收到请求');
 *   log.warn('[CN Quote] 降级:', err.message);
 *   log.error('Failed to save:', error);
 *
 * 输出示例：
 *   [2026-04-26 16:35:23.456] [INDICES] 收到请求
 *
 * ── 特性 ───────────────────────────────────────────────────────────────
 * 1. 时间戳：每条日志前置 `[YYYY-MM-DD HH:mm:ss.mmm]`
 * 2. 颜色：
 *    - 渲染进程（浏览器/Electron renderer）使用 console 的 %c CSS 样式
 *    - 主进程（Node.js）使用 ANSI 转义码（warn=黄、error=红、info/debug=灰）
 * 3. 日志级别：debug < info < log < warn < error
 *    - 开发环境：全开
 *    - 生产环境：默认屏蔽 debug/info（仅保留 log/warn/error）
 *    - 可通过 `log.setLevel('warn')` 运行时调整
 */

// ── 环境与平台检测 ────────────────────────────────────────────────────────────

/** 判断是否运行在浏览器/渲染进程（有 window 全局即认为是渲染进程） */
const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * 判断是否为开发环境
 * - 渲染进程：优先读 Vite 注入的 import.meta.env.DEV
 * - 主进程：读 process.env.NODE_ENV !== 'production'
 * 任意一处读不到时按 false（生产）处理，避免线上误开 debug
 */
function detectIsDev(): boolean {
  // 渲染进程：Vite 在编译期注入 import.meta.env.DEV
  // 用 unknown 强转回避 tsconfig 中可能没有 vite/client 类型声明的环境
  try {
    const meta = import.meta as unknown as { env?: { DEV?: boolean } };
    const viteDev = meta?.env?.DEV;
    if (typeof viteDev === 'boolean') return viteDev;
  } catch {
    // 不是 ESM 或没有 Vite 注入，继续往下走
  }
  // 主进程：Node.js
  try {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
      return process.env.NODE_ENV !== 'production';
    }
  } catch {
    // 没有 process（极端情况），按生产处理
  }
  return false;
}

const IS_DEV = detectIsDev();

// ── 日志级别 ──────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'log' | 'warn' | 'error' | 'silent';

/** 数值越大越严重，silent = 全部关闭 */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  log: 30,
  warn: 40,
  error: 50,
  silent: 100,
};

/** 当前最低输出级别。dev 默认 debug 全开，prod 默认屏蔽 debug/info */
let currentLevel: LogLevel = IS_DEV ? 'debug' : 'log';

function shouldLog(level: Exclude<LogLevel, 'silent'>): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentLevel];
}

// ── 时间戳 ────────────────────────────────────────────────────────────────────

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function formatTimestamp(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}]`;
}

// ── 颜色 ──────────────────────────────────────────────────────────────────────

/** ANSI 转义码（用于 Node.js / Electron 主进程终端输出） */
const ANSI = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
} as const;

/** 浏览器 console %c 的 CSS 样式（渲染进程） */
const CSS_STYLE = {
  debug: 'color:#9ca3af',                          // 灰
  info: 'color:#0891b2',                           // 青
  log: 'color:inherit',                            // 默认色
  warn: 'color:#ca8a04;font-weight:bold',          // 黄加粗
  error: 'color:#dc2626;font-weight:bold',         // 红加粗
} as const;

type LevelKey = keyof typeof CSS_STYLE;

/** 主进程：用 ANSI 包裹时间戳 */
function ansiWrap(level: LevelKey, ts: string): string {
  switch (level) {
    case 'warn': return `${ANSI.yellow}${ts}${ANSI.reset}`;
    case 'error': return `${ANSI.red}${ts}${ANSI.reset}`;
    case 'info': return `${ANSI.cyan}${ts}${ANSI.reset}`;
    case 'debug': return `${ANSI.gray}${ts}${ANSI.reset}`;
    default: return ts;
  }
}

// ── 输出实现 ──────────────────────────────────────────────────────────────────

/** console 方法名映射（避免在 prod 把 debug 也走 console.debug 被 DevTools 默认隐藏） */
const CONSOLE_FN: Record<LevelKey, (...args: unknown[]) => void> = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function emit(level: LevelKey, args: unknown[]): void {
  if (!shouldLog(level)) return;
  const ts = formatTimestamp();
  const fn = CONSOLE_FN[level];
  if (IS_BROWSER) {
    // 浏览器：%c 只对紧跟其后的字符串生效，所以把时间戳单独作为一段
    fn(`%c${ts}`, CSS_STYLE[level], ...args);
  } else {
    // Node：用 ANSI 包裹时间戳
    fn(ansiWrap(level, ts), ...args);
  }
}

// ── 对外 API ──────────────────────────────────────────────────────────────────

export const log = {
  debug: (...args: unknown[]): void => emit('debug', args),
  info: (...args: unknown[]): void => emit('info', args),
  log: (...args: unknown[]): void => emit('log', args),
  warn: (...args: unknown[]): void => emit('warn', args),
  error: (...args: unknown[]): void => emit('error', args),

  /** 运行时调整最低输出级别。例：log.setLevel('warn') 表示只输出 warn/error */
  setLevel: (level: LogLevel): void => {
    currentLevel = level;
  },
  /** 读取当前最低输出级别（便于排错） */
  getLevel: (): LogLevel => currentLevel,
  /** 当前是否处于开发环境（构建期决定，运行时只读） */
  isDev: IS_DEV,
};

export default log;
