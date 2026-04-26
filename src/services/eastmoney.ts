/**
 * 东方财富 push2 HTTP API 封装模块
 *
 * 适用环境：Electron 主进程（Node.js 18+），内置 fetch，可直接访问东方财富 HTTP API。
 * 无需 Python，速度极快（毫秒级 vs 秒级）。
 *
 * 文档：docs/东方财富API文档.md
 */

import { log } from '../utils/logger';
import type { CompanyDetail } from '../types';

// ── 接口常量 ──────────────────────────────────────────────────────────────────

/** 批量行情接口（无分页，一次返回所有请求的股票/指数） */
export const EASTMONEY_QUOTE_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get';

/** 模拟浏览器的请求头，避免被东方财富服务器拦截 */
export const EASTMONEY_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.eastmoney.com/',
  'Accept': 'application/json, text/plain, */*',
};

// ── ut Token 管理 ─────────────────────────────────────────────────────────────

/**
 * 东方财富 ut token 池。
 * ut 是 push2 接口的鉴权参数，社区常用固定值有效期较长。
 * 维护多个备用值，当前值失效时自动轮换到下一个。
 */
const EASTMONEY_UT_POOL = [
  'b2884a393a59ad64002292a3e90d46a5', // 主用
  'bd1d9ddb04089700cf9c27f6f7426281', // 备用 1
  'fa617be9e8966c902622023f04936795', // 备用 2
];

let eastMoneyUtIndex = 0;

/** 获取当前有效的 ut token */
export function getEastMoneyUt(): string {
  const ut = EASTMONEY_UT_POOL[eastMoneyUtIndex % EASTMONEY_UT_POOL.length];
  return ut;
}

/**
 * 将 ut 轮换到下一个备用值。
 * 当服务器返回 rc !== 0（ut 失效）时调用。
 */
export function rotateEastMoneyUt(): void {
  eastMoneyUtIndex = (eastMoneyUtIndex + 1) % EASTMONEY_UT_POOL.length;
}

// ── secid 工具函数 ────────────────────────────────────────────────────────────

/**
 * 将 6 位 A 股代码转换为东方财富 secid 格式。
 * - 上交所（6 开头）→ `1.xxxxxx`
 * - 深交所/北交所（其他）→ `0.xxxxxx`
 */
export function toEastMoneySecid(symbol: string): string {
  const secid = symbol.startsWith('6') ? `1.${symbol}` : `0.${symbol}`;
  return secid;
}

/**
 * 港股 secid 格式：`116.{5位代码}`，不足 5 位时左补零。
 * 例：`9988` → `116.09988`，`700` → `116.00700`
 *
 * 注意：东方财富 push2 接口对港股个股使用市场代码 `116`（旧版 `90` 已废弃）。
 */
export function toHKSecid(symbol: string): string {
  // 去掉 .HK 后缀（如 "09988.HK" → "09988"）
  const code = symbol.replace(/\.HK$/i, '');
  const secid = `116.${code.padStart(5, '0')}`;
  return secid;
}

/**
 * 美股个股在东方财富的市场代码：
 * - `105` 纳斯达克（NASDAQ）—— 默认值，覆盖大多数科技股
 * - `106` 纽交所（NYSE）—— 主要覆盖中概股（BABA、JD、PDD 等）及传统蓝筹
 *
 * 注意：以前同时发 105/106/107 试探，现已根据 ticker 精准选择市场代码，
 * 减少 2/3 的请求载荷，并对未知 ticker 保留 105+106 双市场兜底。
 */
export const US_MARKET_NASDAQ = 105 as const;
export const US_MARKET_NYSE = 106 as const;

/**
 * 已知走 NYSE（市场代码 106）的美股 ticker 白名单。
 *
 * 主要包含两类：
 * 1. **中概股**：BABA、JD、PDD、BIDU、NIO、XPEV、LI、TME、BILI、HUYA、IQ、DIDI、KE、TAL、EDU、YMM、TIGR、FUTU、DOYU、ZH、ATHM、QFIN
 * 2. **NYSE 蓝筹**：BRK.B、JPM、BAC、WMT、KO、DIS、NKE、MA、V、PG、JNJ、XOM、CVX
 *
 * 未在白名单中的 ticker 默认走 NASDAQ（105），并在首次请求未命中时自动补发 NYSE 兜底。
 */
const US_NYSE_TICKERS = new Set<string>([
  // 中概股
  'BABA', 'JD', 'PDD', 'BIDU', 'NIO', 'XPEV', 'LI', 'TME', 'BILI', 'HUYA',
  'IQ', 'DIDI', 'KE', 'TAL', 'EDU', 'YMM', 'TIGR', 'FUTU', 'DOYU', 'ZH',
  'ATHM', 'QFIN', 'NTES', 'VIPS',
  // NYSE 蓝筹
  'BRK.B', 'JPM', 'BAC', 'WMT', 'KO', 'DIS', 'NKE', 'MA', 'V', 'PG',
  'JNJ', 'XOM', 'CVX', 'PFE', 'UNH', 'HD', 'MCD', 'IBM', 'GE', 'F',
]);

/**
 * 根据 ticker 推断美股的东方财富市场代码（105 或 106）。
 *
 * - 命中 NYSE 白名单 → 106（中概股、NYSE 蓝筹）
 * - 其余 → 105（NASDAQ，默认）
 */
export function getUSMarketCode(symbol: string): 105 | 106 {
  const code = US_NYSE_TICKERS.has(symbol.toUpperCase()) ? US_MARKET_NYSE : US_MARKET_NASDAQ;
  return code;
}

/**
 * 为美股 symbol 生成主市场 secid。
 * 例：`AAPL` → `'105.AAPL'`，`BABA` → `'106.BABA'`
 */
export function toUSSecid(symbol: string): string {
  const secid = `${getUSMarketCode(symbol)}.${symbol.toUpperCase()}`;
  return secid;
}

// ── 指数 secid 映射表 ─────────────────────────────────────────────────────────

export interface IndexSecidEntry {
  /** 东方财富 secid，格式：{市场代码}.{指数代码} */
  secid: string;
  /** 应用内使用的 symbol（与 useStockStore.indices 对应） */
  symbol: string;
  /** 中文名称 */
  name: string;
}

/**
 * 本项目关注的 8 个关键指数 secid 映射。
 *
 * 市场代码说明：
 * - `1`   上交所指数（如上证指数 1.000001）
 * - `0`   深交所指数（如深证成指 0.399001、创业板指 0.399006）
 * - `100` 美股/全球指数（如纳斯达克 100.NDX、标普 500 100.SPX、道琼斯 100.DJIA、恒生 100.HSI）
 * - `124` 港股专属指数（如恒生科技 124.HSTECH）
 *
 * 注意：
 * - 恒生指数 HSI 在东方财富 push2 接口里走的是市场代码 `100`（与全球指数同列），
 *   而恒生科技 HSTECH 走的是港股专属市场代码 `124`，两者不一致，必须分别配置。
 * - secid 列表与请求 URL 见：docs/东方财富API文档.md
 */
export const INDEX_SECID_MAP: IndexSecidEntry[] = [
  { secid: '1.000001',   symbol: '000001.SH', name: '上证指数' },
  { secid: '0.399001',   symbol: '399001.SZ', name: '深证成指' },
  { secid: '0.399006',   symbol: '399006.SZ', name: '创业板指' },
  { secid: '100.NDX',    symbol: '.IXIC',     name: '纳斯达克' },
  { secid: '100.SPX',    symbol: '.INX',      name: '标普500'  },
  { secid: '100.DJIA',   symbol: '.DJI',      name: '道琼斯'   },
  { secid: '100.HSI',    symbol: 'HSI',       name: '恒生指数' },
  { secid: '124.HSTECH', symbol: 'HSTECH',    name: '恒生科技' },
];

// ── 核心请求函数 ──────────────────────────────────────────────────────────────

/** 东方财富 push2 接口原始响应结构 */
interface EastMoneyResponse {
  rc: number;
  data?: {
    diff?: Array<Record<string, unknown>>;
  };
}

/**
 * 判断当前是否运行在浏览器（渲染进程）环境。
 * 主进程（Node.js）下 typeof window === 'undefined'。
 */
function isBrowserEnv(): boolean {
  const result = typeof window !== 'undefined' && typeof (globalThis as { fetch?: unknown }).fetch === 'function';
  return result;
}

/**
 * 主进程专用：使用 Node 内置 `https` 模块发起 HTTPS GET 请求，返回响应文本。
 *
 * 为什么不直接用 Node 18+ 的 fetch（undici）：
 * - undici 在某些网络环境（企业代理 / 严格 TLS / IPv6 优先）下会抛 `TypeError: fetch failed`，
 *   真正的根因被包在 `error.cause` 里，调试体验极差。
 * - undici 不支持 `family: 4` 强制 IPv4，IPv6 不通时会黑屏 8s 才超时。
 * - https 模块原生支持 `rejectUnauthorized: false` 和 `family: 4`，且错误信息直接可读。
 *
 * 配置要点：
 * - `family: 4` 强制 IPv4，避免 IPv6 路由不通导致的黑屏挂起
 * - `rejectUnauthorized: false` 跳过 TLS 证书校验，规避企业网络中间证书问题
 * - 显式 `timeout` 防止 socket 无限挂起
 * - 错误时附带 errno/code 等关键字段，便于定位真实根因
 */
function nodeHttpsGet(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // 仅在主进程引入 https，避免被 vite 打包到渲染端
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('node:https') as typeof import('node:https');
    const { URL } = require('node:url') as typeof import('node:url');

    const parsed = new URL(url);
    const req = https.request(
      {
        method: 'GET',
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          ...headers,
          'Accept-Encoding': 'identity', // 主动禁用压缩，避免下游解压逻辑出错
          Connection: 'close',           // 不复用连接，规避 keep-alive 半关闭问题
        },
        family: 4,                       // 强制 IPv4，避免 IPv6 路由不通
        rejectUnauthorized: false,       // 放宽 TLS 校验，兼容企业网络拦截
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString('utf-8');
          if (status >= 200 && status < 300) {
            log.debug(`[EastMoney] nodeHttpsGet -> status=${status} bodyLen=${body.length} url=${url}`);
            resolve(body);
          } else {
            reject(new Error(`HTTPS ${status} - body[0..200]=${body.slice(0, 200)}`));
          }
        });
        res.on('error', (err) => reject(err));
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`));
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      // 把 errno/code/syscall/hostname 都拼出来，方便定位真实根因（DNS/TLS/路由）
      const detail = [
        err.message,
        err.code ? `code=${err.code}` : '',
        err.errno !== undefined ? `errno=${err.errno}` : '',
        err.syscall ? `syscall=${err.syscall}` : '',
        (err as NodeJS.ErrnoException & { hostname?: string }).hostname
          ? `hostname=${(err as NodeJS.ErrnoException & { hostname?: string }).hostname}`
          : '',
      ].filter(Boolean).join(' | ');
      reject(new Error(`[https.request] ${detail}`));
    });
    req.end();
  });
}

/**
 * 跨环境 HTTP GET：主进程用 Node `https` 模块（绕开 undici 的诸多坑），
 * 渲染进程兜底走浏览器 fetch（**仅** `fetchKLineData` 在渲染进程使用，
 * 因为东方财富 K 线域名 push2his 当前在 dev 环境下未触发 CORS）。
 *
 * ⚠️ 重要：自选股行情 `fetchQuotes` / 指数行情 `fetchIndices` **必须**在主进程调用，
 * 不能在渲染进程直 import 后 fetch，否则浏览器 CORS preflight 会让请求挂死，
 * 表现为「所有备用 ut 均已尝试，东方财富接口不可用: Failed to fetch」（参见 AGENTS.md BUG-014）。
 * 它们对应的 IPC 通道分别为 `stock-get-quotes` / `stock-get-indices`，由 main.ts 注册。
 *
 * 统一返回响应文本，由调用方自行 JSON.parse。
 */
async function crossEnvGetText(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  if (isBrowserEnv()) {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    log.debug(`[EastMoney] crossEnvGetText(browser) -> status=${response.status} bodyLen=${text.length}`);
    return text;
  }
  return nodeHttpsGet(url, headers, timeoutMs);
}

/**
 * fetchEastMoneyBatch 的请求类型，用于在日志中区分"指数批量"和"个股批量"。
 * - `index`：拉取关键指数行情（fetchIndices）
 * - `quote`：拉取股票行情（fetchQuotes / fetchCNQuotes / fetchHKQuotes / fetchUSQuotes 及兜底请求）
 */
export type EastMoneyBatchKind = 'index' | 'quote';

/**
 * 为单次东方财富批量请求生成短的唯一 sessionId，便于在大量并发日志里串联同一次请求的所有日志。
 *
 * 组成：`{kind}-{时间戳后6位}-{secids哈希后4位}-{随机3位}`
 * - 时间戳后 6 位：保证按时间排序时易读，同毫秒内冲突概率极低
 * - secids 哈希：同一组 secids 在不同请求中会得到不同 sessionId（因为有随机后缀），
 *   但相同 secids 的 hash 段一致，方便从日志里看出"两次请求其实问的是同一组"
 * - 随机 3 位：兜底防同毫秒同 secids 撞车
 *
 * 不引入 crypto / uuid 依赖，主进程和渲染进程都能直接跑。
 */
function generateBatchSessionId(kind: EastMoneyBatchKind, secids: string[], ts: number): string {
  // 简易非加密哈希（djb2 变体），输出 4 位 base36
  let hash = 5381;
  const joined = secids.join(',');
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
  }
  const hashSeg = Math.abs(hash).toString(36).slice(0, 4).padStart(4, '0');
  const tsSeg = String(ts).slice(-6);
  const randSeg = Math.random().toString(36).slice(2, 5).padStart(3, '0');
  return `${kind}-${tsSeg}-${hashSeg}-${randSeg}`;
}

/**
 * 调用东方财富 push2 接口批量获取行情数据。
 *
 * - 自动使用当前 ut 值发起请求
 * - 若服务器返回 `rc !== 0`（ut 失效），自动轮换到下一个备用 ut 并重试
 * - 最多尝试所有备用 ut 值，全部失败时抛出异常
 * - 每次调用生成一个唯一 `sessionId` 注入到所有日志，方便在并发场景串联同一次请求的日志
 *
 * @param secids 东方财富 secid 列表，格式如 `['1.000001', '100.NDX']`
 * @param kind 请求类型，`'index'` 表示指数批量、`'quote'` 表示个股批量。仅用于日志标记，不影响请求参数
 * @returns diff 数组（原始字段），每项对应一个 secid 的行情数据
 * @throws 所有备用 ut 均失败时抛出 Error
 */
export async function fetchEastMoneyBatch(
  secids: string[],
  kind: EastMoneyBatchKind,
): Promise<Array<Record<string, unknown>>> {
  const sessionId = generateBatchSessionId(kind, secids, Date.now());
  log.debug(`[EastMoney][${sessionId}] fetchEastMoneyBatch start: kind=${kind} count=${secids.length} secids=${secids.join(',')}`);

  let lastNetError: unknown = null;

  for (let attempt = 0; attempt < EASTMONEY_UT_POOL.length; attempt++) {
    const params = new URLSearchParams({
      fltt: '2',
      invt: '2',
      // f2 现价、f3 涨跌幅%、f4 涨跌额、f5 成交量(手)、f12 代码、f13 市场代码、f14 名称
      // f15 最高、f16 最低、f17 今开、f18 昨收
      // ⚠️ f13 必须取！fetchQuotes 用它来反推 item 属于哪个市场（0/1=A股、105/106/107=美股、116=港股），
      //    如果不取，所有 item 的 f13 都是 undefined，市场分流逻辑全部失败，
      //    会导致 missingUS 永远等于全部美股 → 每次都额外发一次"美股兜底"请求（参见 BUG-015）
      fields: 'f2,f3,f4,f5,f12,f13,f14,f15,f16,f17,f18',
      secids: secids.join(','),
      ut: getEastMoneyUt(),
      np: '1',
      pi: '0',
      pz: String(secids.length),
    });
    const url = `${EASTMONEY_QUOTE_URL}?${params.toString()}`;
    log.debug(`[EastMoney][${sessionId}] fetchEastMoneyBatch: attempt=${attempt} url=${url.slice(0, 320)}`);

    let bodyText: string;
    try {
      // 主进程走 node:https（绕开 undici 的 TLS/IPv6 坑），渲染进程走浏览器 fetch
      // 超时拉到 15s，避免冷启动 DNS 慢误判失败
      bodyText = await crossEnvGetText(url, EASTMONEY_HEADERS, 15000);
    } catch (err) {
      lastNetError = err;
      // 网络层错误（DNS/TLS/timeout）：把详细错误打出来，立即重试下一个 ut
      // 注意 undici 的 fetch failed 错误，真正根因在 err.cause 里，要一并打印
      const cause = (err as { cause?: unknown }).cause;
      log.warn(
        `[EastMoney][${sessionId}] 请求失败 attempt=${attempt} url=${url.slice(0, 120)}... err=${err instanceof Error ? err.message : String(err)}`,
        cause ? `cause=${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}` : '',
      );
      continue;
    }

    let data: EastMoneyResponse;
    try {
      data = JSON.parse(bodyText) as EastMoneyResponse;
      log.debug(`[EastMoney][${sessionId}] fetchEastMoneyBatch: attempt=${attempt} bodyLen=${bodyText.length}, data=${JSON.stringify(data)}`);
    } catch (parseErr) {
      lastNetError = parseErr;
      log.warn(`[EastMoney][${sessionId}] JSON 解析失败 body[0..200]=${bodyText.slice(0, 200)}`);
      continue;
    }

    if (data.rc === 0 && data.data?.diff) {
      log.debug(`[EastMoney][${sessionId}] fetchEastMoneyBatch done: attempt=${attempt} diffLen=${data.data.diff.length}`);
      return data.data.diff;
    }

    // rc !== 0 通常表示 ut 失效，轮换到下一个备用值后重试
    log.warn(`[EastMoney][${sessionId}] rc=${data.rc} 视为 ut 失效，轮换 ut 后重试`);
    rotateEastMoneyUt();
  }

  // 所有 ut 都试过仍失败：把最后一次网络错误的根因带出去，方便上层定位
  const detail = lastNetError instanceof Error
    ? `${lastNetError.message}${(lastNetError as { cause?: unknown }).cause ? ` | cause=${String((lastNetError as { cause?: Error }).cause?.message ?? (lastNetError as { cause?: unknown }).cause)}` : ''}`
    : String(lastNetError ?? 'unknown');
  log.error(`[EastMoney][${sessionId}] 请求失败，所有备用 ut 均已尝试，东方财富接口不可用: ${detail}`);
  throw new Error(`所有备用 ut 均已尝试，东方财富接口不可用: ${detail}`);
}

// ── 高层业务函数 ──────────────────────────────────────────────────────────────

/**
 * 解析东方财富接口返回的数值字段。
 *
 * 东方财富对停牌、缺数据等场景会返回字符串 `"-"`，直接 `Number("-")` 得到 `NaN`，
 * 因此统一在此处兜底转换：非有效数字一律返回 `undefined`，避免污染下游展示。
 */
function parseEastMoneyNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '-' || value === '') return undefined;
  const num = Number(value);
  const result = Number.isFinite(num) ? num : undefined;
  return result;
}

export interface StockQuoteResult {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  /** 当日最高价 */
  high?: number;
  /** 当日最低价 */
  low?: number;
  /** 今日开盘价 */
  open?: number;
  /** 昨日收盘价 */
  previousClose?: number;
  /** 当日成交量（东方财富返回单位：手；A 股 1 手=100 股，港股/美股以接口原值为准） */
  volume?: number;
  timestamp: number;
}

export interface IndexQuoteResult {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

/**
 * 批量获取港股实时行情。
 *
 * 港股代码格式：5 位数字（不含 .HK 后缀），如 `['09988', '00700']`。
 * 也接受带 .HK 后缀的格式，如 `['09988.HK', '00700.HK']`，内部会自动去除后缀。
 *
 * @param symbols 港股代码列表
 * @returns 行情结果数组，代码不存在时对应项为 null（已过滤）
 */
export async function fetchHKQuotes(symbols: string[]): Promise<StockQuoteResult[]> {
  log.debug(`[EastMoney] fetchHKQuotes(symbols=${JSON.stringify(symbols)})`);
  const secids = symbols.map(toHKSecid);
  const diff = await fetchEastMoneyBatch(secids, 'quote');

  const now = Math.floor(Date.now() / 1000);

  // 建立 f12（5 位港股代码）→ 行情 映射
  const codeToQuote = new Map<string, Record<string, unknown>>();
  for (const item of diff) {
    const code = String(item.f12 ?? '').padStart(5, '0');
    codeToQuote.set(code, item);
  }

  const result = symbols
    .map((symbol): StockQuoteResult | null => {
      // 统一去掉 .HK 后缀，并补齐 5 位
      const code = symbol.replace(/\.HK$/i, '').padStart(5, '0');
      const item = codeToQuote.get(code);
      if (!item) return null;
      return {
        symbol,
        name: String(item.f14 ?? symbol),
        price: Number(item.f2) || 0,
        change: Number(item.f4) || 0,
        changePercent: Number(item.f3) || 0,
        high: parseEastMoneyNumber(item.f15),
        low: parseEastMoneyNumber(item.f16),
        open: parseEastMoneyNumber(item.f17),
        previousClose: parseEastMoneyNumber(item.f18),
        volume: parseEastMoneyNumber(item.f5),
        timestamp: now,
      };
    })
    .filter((item): item is StockQuoteResult => item !== null);
  log.debug(`[EastMoney] fetchHKQuotes -> ${result.length}/${symbols.length} matched, sample=${JSON.stringify(result.slice(0, 2))}`);
  return result;
}

/**
 * 批量获取美股实时行情。
 *
 * 市场代码精准匹配策略（避免 105/106/107 三发请求带来的 3 倍载荷）：
 * - 命中 NYSE 白名单 → 主市场 `106`（中概股 BABA/XPEV 及 NYSE 蓝筹）
 * - 其余 → 主市场 `105`（NASDAQ，覆盖 AAPL/GOOGL/TSLA 等绝大多数科技股）
 * - 首轮请求未命中的 ticker 自动用另一个市场补一次（兜底冷门标的）
 *
 * @param symbols 美股代码列表，如 `['AAPL', 'BABA', 'TSLA']`
 * @returns 行情结果数组，代码不存在时对应项为 null（已过滤）
 */
export async function fetchUSQuotes(symbols: string[]): Promise<StockQuoteResult[]> {
  log.debug(`[EastMoney] fetchUSQuotes(symbols=${JSON.stringify(symbols)})`);
  const now = Math.floor(Date.now() / 1000);

  // ① 主市场请求：每个 symbol 仅发一个 secid（105 或 106）
  const primarySecids = symbols.map(toUSSecid);
  const primaryDiff = await fetchEastMoneyBatch(primarySecids, 'quote');

  const codeToQuote = new Map<string, Record<string, unknown>>();
  for (const item of primaryDiff) {
    const code = String(item.f12 ?? '').toUpperCase();
    if (code) codeToQuote.set(code, item);
  }

  // ② 兜底：主市场未命中的 ticker，换另一个市场再补一次（白名单未覆盖的冷门标的）
  const missing = symbols.filter((s) => !codeToQuote.has(s.toUpperCase()));
  if (missing.length > 0) {
    const fallbackSecids = missing.map((s) => {
      const fallbackMarket = getUSMarketCode(s) === US_MARKET_NASDAQ ? US_MARKET_NYSE : US_MARKET_NASDAQ;
      return `${fallbackMarket}.${s.toUpperCase()}`;
    });
    try {
      const fallbackDiff = await fetchEastMoneyBatch(fallbackSecids, 'quote');
      for (const item of fallbackDiff) {
        const code = String(item.f12 ?? '').toUpperCase();
        if (code && !codeToQuote.has(code)) codeToQuote.set(code, item);
      }
    } catch (err) {
      // 兜底失败不影响主市场结果，仅打印警告
      log.warn('[EastMoney] US fallback market request failed:', err);
    }
  }

  const result = symbols
    .map((symbol): StockQuoteResult | null => {
      const item = codeToQuote.get(symbol.toUpperCase());
      if (!item) return null;
      return {
        symbol,
        name: String(item.f14 ?? symbol),
        price: Number(item.f2) || 0,
        change: Number(item.f4) || 0,
        changePercent: Number(item.f3) || 0,
        high: parseEastMoneyNumber(item.f15),
        low: parseEastMoneyNumber(item.f16),
        open: parseEastMoneyNumber(item.f17),
        previousClose: parseEastMoneyNumber(item.f18),
        volume: parseEastMoneyNumber(item.f5),
        timestamp: now,
      };
    })
    .filter((item): item is StockQuoteResult => item !== null);
  log.debug(`[EastMoney] fetchUSQuotes -> ${result.length}/${symbols.length} matched, sample=${JSON.stringify(result.slice(0, 2))}`);
  return result;
}

/**
 * 判断 symbol 所属市场。
 * - `cn`：6 位纯数字（A 股）
 * - `hk`：以 `.HK` 结尾，或单纯 5 位以内数字带 .HK 后缀
 * - `us`：其他（默认按美股 ticker 处理）
 */
export type MarketType = 'cn' | 'hk' | 'us';

export function detectMarket(symbol: string): MarketType {
  let market: MarketType;
  if (/^\d{6}$/.test(symbol)) market = 'cn';
  else if (/\.HK$/i.test(symbol)) market = 'hk';
  else market = 'us';
  return market;
}

/**
 * 将 symbol 转换为东方财富 push2 接口 secid（统一入口）。
 * 内部根据 `detectMarket` 派发到 `toEastMoneySecid` / `toHKSecid` / `toUSSecid`。
 */
export function toQuoteSecid(symbol: string): string {
  let secid: string;
  switch (detectMarket(symbol)) {
    case 'cn': secid = toEastMoneySecid(symbol); break;
    case 'hk': secid = toHKSecid(symbol); break;
    case 'us': secid = toUSSecid(symbol); break;
  }
  return secid;
}

/**
 * 统一批量获取实时行情（A 股 + 港股 + 美股混合）。
 *
 * 一次 push2 请求拿到所有市场的行情，无需在调用方按市场分组。
 * 内部按 symbol 自动派发到对应 secid 拼装函数：
 * - A 股 (6 位纯数字) → `0./1.XXXXXX`
 * - 港股 (XXXXX.HK) → `116.XXXXX`
 * - 美股 (其他) → `105./106.TICKER`（按白名单选择）
 *
 * 反查回填规则（按 symbol 的市场区分 key 格式，避免不同市场代码冲突）：
 * - A 股：f12 6 位代码（左补零）
 * - 港股：f12 5 位代码（左补零）
 * - 美股：f12 ticker（大写）
 *
 * 美股冷门 ticker 兜底：主市场（105 或 106）未命中时，自动用另一市场补一次请求。
 *
 * @param symbols 任意市场的 symbol 列表，如 `['600519', '09988.HK', 'AAPL', 'BABA']`
 * @returns 行情结果数组，未命中的 symbol 不出现在结果中（由调用方决定如何展示）
 */
export async function fetchQuotes(symbols: string[]): Promise<StockQuoteResult[]> {
  log.debug(`[EastMoney] fetchQuotes(symbols=${JSON.stringify(symbols)})`);
  if (symbols.length === 0) {
    log.debug('[EastMoney] fetchQuotes -> [] (empty input)');
    return [];
  }

  const now = Math.floor(Date.now() / 1000);

  // 为每个 symbol 计算其所属市场和主 secid
  const symbolMeta = symbols.map((symbol) => ({
    symbol,
    market: detectMarket(symbol),
    secid: toQuoteSecid(symbol),
  }));

  // ① 主请求：一次性拿所有市场的行情
  const primaryDiff = await fetchEastMoneyBatch(symbolMeta.map((m) => m.secid), 'quote');

  // 按市场分别建立 f12 → 行情 的映射，避免不同市场同代码冲突（虽然概率极低，但要严谨）
  const cnCodeToQuote = new Map<string, Record<string, unknown>>();
  const hkCodeToQuote = new Map<string, Record<string, unknown>>();
  const usCodeToQuote = new Map<string, Record<string, unknown>>();

  // 通过 push2 返回的 f13（market code）反推该项属于哪个市场
  // f13 取值：0=深交所、1=上交所、105=NASDAQ、106=NYSE、107=AMEX、116=港股
  for (const item of primaryDiff) {
    const f12 = String(item.f12 ?? '');
    const f13 = Number(item.f13);
    if (!f12) continue;

    if (f13 === 0 || f13 === 1) {
      cnCodeToQuote.set(f12.padStart(6, '0'), item);
    } else if (f13 === 116) {
      hkCodeToQuote.set(f12.padStart(5, '0'), item);
    } else if (f13 === 105 || f13 === 106 || f13 === 107) {
      usCodeToQuote.set(f12.toUpperCase(), item);
    }
  }

  // ② 美股兜底：主市场未命中的 ticker 换另一个市场补一次请求
  const missingUS = symbolMeta.filter(
    (m) => m.market === 'us' && !usCodeToQuote.has(m.symbol.toUpperCase()),
  );
  if (missingUS.length > 0) {
    const fallbackSecids = missingUS.map((m) => {
      const fallbackMarket = getUSMarketCode(m.symbol) === US_MARKET_NASDAQ ? US_MARKET_NYSE : US_MARKET_NASDAQ;
      return `${fallbackMarket}.${m.symbol.toUpperCase()}`;
    });
    try {
      const fallbackDiff = await fetchEastMoneyBatch(fallbackSecids, 'quote');
      for (const item of fallbackDiff) {
        const code = String(item.f12 ?? '').toUpperCase();
        if (code && !usCodeToQuote.has(code)) usCodeToQuote.set(code, item);
      }
    } catch (err) {
      log.warn('[EastMoney] US fallback market request failed:', err);
    }
  }

  // ③ 按原始 symbol 顺序回填
  const result = symbolMeta
    .map(({ symbol, market }): StockQuoteResult | null => {
      let item: Record<string, unknown> | undefined;
      if (market === 'cn') {
        item = cnCodeToQuote.get(symbol);
      } else if (market === 'hk') {
        const code = symbol.replace(/\.HK$/i, '').padStart(5, '0');
        item = hkCodeToQuote.get(code);
      } else {
        item = usCodeToQuote.get(symbol.toUpperCase());
      }
      if (!item) return null;
      return {
        symbol,
        name: String(item.f14 ?? symbol),
        price: Number(item.f2) || 0,
        change: Number(item.f4) || 0,
        changePercent: Number(item.f3) || 0,
        high: parseEastMoneyNumber(item.f15),
        low: parseEastMoneyNumber(item.f16),
        open: parseEastMoneyNumber(item.f17),
        previousClose: parseEastMoneyNumber(item.f18),
        volume: parseEastMoneyNumber(item.f5),
        timestamp: now,
      };
    })
    .filter((item): item is StockQuoteResult => item !== null);
  log.debug(`[EastMoney] fetchQuotes -> ${result.length}/${symbols.length} matched, sample=${JSON.stringify(result.slice(0, 2))}`);
  return result;
}

/**
 * 批量获取 A 股实时行情。
 *
 * @param symbols 6 位 A 股代码列表，如 `['600519', '000001']`
 * @returns 行情结果数组，代码不存在时对应项为 null（已过滤）
 */
export async function fetchCNQuotes(symbols: string[]): Promise<StockQuoteResult[]> {
  log.debug(`[EastMoney] fetchCNQuotes(symbols=${JSON.stringify(symbols)})`);
  const secids = symbols.map(toEastMoneySecid);
  const diff = await fetchEastMoneyBatch(secids, 'quote');

  const now = Math.floor(Date.now() / 1000);

  // 建立 code → 行情 映射（f12 不含市场前缀）
  const codeToQuote = new Map<string, Record<string, unknown>>();
  for (const item of diff) {
    const code = String(item.f12 ?? '').padStart(6, '0');
    codeToQuote.set(code, item);
  }

  const result = symbols
    .map((symbol): StockQuoteResult | null => {
      const item = codeToQuote.get(symbol);
      if (!item) return null;
      return {
        symbol,
        name: String(item.f14 ?? symbol),
        price: Number(item.f2) || 0,
        change: Number(item.f4) || 0,
        changePercent: Number(item.f3) || 0,
        high: parseEastMoneyNumber(item.f15),
        low: parseEastMoneyNumber(item.f16),
        open: parseEastMoneyNumber(item.f17),
        previousClose: parseEastMoneyNumber(item.f18),
        volume: parseEastMoneyNumber(item.f5),
        timestamp: now,
      };
    })
    .filter((item): item is StockQuoteResult => item !== null);
  log.debug(`[EastMoney] fetchCNQuotes -> ${result.length}/${symbols.length} matched, sample=${JSON.stringify(result.slice(0, 2))}`);
  return result;
}

// ── K 线历史数据 ──────────────────────────────────────────────────────────────

/** 东方财富 K 线历史接口 URL */
export const EASTMONEY_KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

/** K 线周期类型 */
export type KLinePeriod = 'daily' | 'weekly' | 'monthly';

/** K 线复权类型 */
export type KLineAdjust = 'none' | 'pre' | 'post';

/** K 线数据点（与 HistoricalDataPoint 兼容） */
export interface KLineDataPoint {
  /** 日期，格式 YYYY-MM-DD */
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

/** K 线请求结果 */
export interface KLineResult {
  data: KLineDataPoint[];
  /** 数据来源标识 */
  source: 'eastmoney';
}

/**
 * 将 symbol 转换为东方财富 K 线接口所需的 secid。
 * 支持 A 股、港股、美股。
 */
function toKLineSecid(symbol: string): string {
  log.debug(`[EastMoney] toKLineSecid(symbol=${symbol})`);
  let secid: string;
  // 港股：XXXXX.HK → 116.XXXXX
  if (/\.HK$/i.test(symbol)) {
    secid = toHKSecid(symbol);
  } else {
    // 美股指数（.IXIC / .INX 等）→ 100.NDX / 100.SPX
    const indexEntry = INDEX_SECID_MAP.find((entry) => entry.symbol === symbol);
    if (indexEntry) {
      secid = indexEntry.secid;
    } else if (!/^\d{6}$/.test(symbol)) {
      // 美股个股（非 6 位纯数字）→ 按白名单选 105 或 106
      secid = toUSSecid(symbol);
    } else {
      // A 股：6 开头 → 上交所，其他 → 深交所
      secid = toEastMoneySecid(symbol);
    }
  }
  log.debug(`[EastMoney] toKLineSecid(symbol=${symbol}) -> ${secid}`);
  return secid;
}

/**
 * 通过东方财富 K 线接口获取历史行情数据。
 *
 * 接口返回格式（klines 数组每项）：
 * "日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率"
 *
 * @param symbol 股票代码（A 股 6 位、港股 XXXXX.HK、美股 AAPL 等）
 * @param startDate 开始日期，格式 YYYYMMDD 或 YYYY-MM-DD
 * @param endDate 结束日期，格式 YYYYMMDD 或 YYYY-MM-DD
 * @param period K 线周期，默认日 K
 * @param adjust 复权类型，默认前复权
 */
export async function fetchKLineData(
  symbol: string,
  startDate: string,
  endDate: string,
  period: KLinePeriod = 'daily',
  adjust: KLineAdjust = 'pre',
): Promise<KLineResult> {
  log.debug(`[EastMoney] fetchKLineData(symbol=${symbol}, startDate=${startDate}, endDate=${endDate}, period=${period}, adjust=${adjust})`);
  const secid = toKLineSecid(symbol);

  // 周期代码：101=日K，102=周K，103=月K
  const kltMap: Record<KLinePeriod, string> = { daily: '101', weekly: '102', monthly: '103' };
  // 复权代码：0=不复权，1=前复权，2=后复权
  const fqtMap: Record<KLineAdjust, string> = { none: '0', pre: '1', post: '2' };

  // 统一日期格式为 YYYYMMDD（去掉连字符）
  const beg = startDate.replace(/-/g, '');
  const end = endDate.replace(/-/g, '');

  const params = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: kltMap[period],
    fqt: fqtMap[adjust],
    beg,
    end,
    lmt: '500',
  });

  const url = `${EASTMONEY_KLINE_URL}?${params.toString()}`;
  const response = await fetch(url, {
    headers: EASTMONEY_HEADERS,
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw new Error(`K 线接口 HTTP ${response.status}`);

  const json = await response.json() as { rc: number; data?: { klines?: string[] } };
  if (json.rc !== 0 || !json.data?.klines) {
    throw new Error(`K 线接口返回异常 rc=${json.rc}`);
  }

  const data: KLineDataPoint[] = json.data.klines.map((line) => {
    // 格式：日期,开盘,收盘,最高,最低,成交量,...
    const parts = line.split(',');
    return {
      date: parts[0],           // YYYY-MM-DD
      open: Number(parts[1]),
      close: Number(parts[2]),
      high: Number(parts[3]),
      low: Number(parts[4]),
      volume: Number(parts[5]),
    };
  });

  log.debug(`[EastMoney] fetchKLineData -> source=eastmoney points=${data.length} firstDate=${data[0]?.date ?? 'N/A'} lastDate=${data[data.length - 1]?.date ?? 'N/A'}`);
  return { data, source: 'eastmoney' };
}

/**
 * 批量获取关键指数行情（基于 INDEX_SECID_MAP 中预设的 6 个指数）。
 *
 * @returns 指数行情结果数组
 */
export async function fetchIndices(): Promise<IndexQuoteResult[]> {
  const secids = INDEX_SECID_MAP.map((entry) => entry.secid);
  const diff = await fetchEastMoneyBatch(secids, 'index');

  // 建立 f12 代码 → secid 的映射（f12 不含市场前缀）
  const codeToSecid = new Map<string, string>();
  for (const entry of INDEX_SECID_MAP) {
    const code = entry.secid.split('.').slice(1).join('.');
    codeToSecid.set(code, entry.secid);
  }
  const secidToMeta = new Map(INDEX_SECID_MAP.map((entry) => [entry.secid, entry]));

  const result = diff
    .map((raw): IndexQuoteResult | null => {
      const f12 = String(raw.f12 ?? '');
      const secid = codeToSecid.get(f12);
      const meta = secid ? secidToMeta.get(secid) : undefined;
      if (!meta) return null;
      return {
        symbol: meta.symbol,
        name: meta.name,
        price: Number(raw.f2) || 0,
        change: Number(raw.f4) || 0,
        changePercent: Number(raw.f3) || 0,
      };
    })
    .filter((item): item is IndexQuoteResult => item !== null);
  log.debug(`[EastMoney] fetchIndices -> ${result.length}/${INDEX_SECID_MAP.length} matched, items=${JSON.stringify(result.map((r) => `${r.symbol}=${r.price}(${r.changePercent}%)`))}`);
  return result;
}

// ── 东方财富 资讯接口 ────────────────────────────────────────────────────────

/**
 * 东方财富个股资讯接口 URL（JSONP 协议）。
 *
 * 接口实测可用，返回 `cmsArticleWebOld` 数组，每项含 date / title / content / mediaName / url。
 * - 接口域名：search-api-web.eastmoney.com
 * - 协议：JSONP，响应格式 `{callback}({...JSON})`，需剥离 callback 包装
 * - 请求方式：GET，关键参数为 URL-encoded JSON 串放在 `param` 字段里
 *
 * ⚠️ 重要：必须在主进程调用，不能在渲染进程直 fetch（同 fetchQuotes，参见 BUG-014）。
 */
export const EASTMONEY_NEWS_URL = 'https://search-api-web.eastmoney.com/search/jsonp';

/** 东方财富资讯接口返回的单条文章原始结构 */
interface EastMoneyArticleRaw {
  date?: string;        // "2026-04-24 19:26:11"
  title?: string;       // 含 <em>关键词</em> 高亮标签
  content?: string;     // 含 <em>关键词</em> 高亮标签
  mediaName?: string;   // 来源媒体，如 "财联社"
  url?: string;         // 文章链接
  image?: string;
  code?: string;
}

interface EastMoneyNewsResponse {
  code?: number;
  result?: {
    cmsArticleWebOld?: EastMoneyArticleRaw[];
  };
}

/** 渲染层使用的资讯条目（与 src/types/index.ts 的 NewsItem 对齐） */
export interface EastMoneyNewsItem {
  title: string;
  source: string;
  /** ISO 8601 格式时间，如 "2026-04-24T19:26:11.000+08:00" */
  publishedAt: string;
  url: string;
  summary?: string;
}

/**
 * 把东方财富资讯接口返回的高亮标签 `<em>...</em>` 剥掉，并 trim。
 *
 * 接口为了在搜索结果里高亮关键词，会在 title/content 里包 `<em>` 标签，
 * 直接展示在 UI 上是糟糕体验，统一在 service 层清洗。
 */
function stripHighlightTags(text: string): string {
  return text.replace(/<\/?em>/gi, '').trim();
}

/**
 * 东方财富返回的 date 是上海本地时间字符串 "YYYY-MM-DD HH:mm:ss"，
 * 转为带时区的 ISO 字符串，避免被前端 new Date() 误判为 UTC。
 */
function eastMoneyDateToIso(date: string): string {
  if (!date) return new Date().toISOString();
  // "2026-04-24 19:26:11" → "2026-04-24T19:26:11+08:00"
  const trimmed = date.trim();
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed.replace(' ', 'T')}+08:00`;
  }
  // 兜底：原样塞给 Date 解析，失败则用当前时间
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/**
 * 把应用层 symbol 归一化为东方财富资讯接口的 keyword：
 * - A 股 6 位纯数字：原样（如 "600519"）
 * - 港股 "XXXXX.HK"：去掉 .HK 后缀（如 "09988.HK" → "09988"）
 * - 美股 ticker：原样大写（如 "AAPL"）
 *
 * 东财资讯接口对 keyword 做的是模糊匹配，A 股代码、港股代码、美股 ticker 都可命中。
 */
function symbolToNewsKeyword(symbol: string): string {
  return symbol.replace(/\.HK$/i, '').toUpperCase().trim();
}

/**
 * 调用东方财富个股资讯接口，返回最近 N 条新闻。
 *
 * @param symbol  应用层 symbol（A 股 6 位 / 港股 XXXXX.HK / 美股 ticker）
 * @param pageSize 单次返回条数，默认 20，最大不建议超过 50
 *
 * 实现要点：
 * 1. JSONP 接口需要 callback 参数包名，这里固定用 `jQuery`，响应是 `jQuery({...})`，要剥包装
 * 2. param 字段是 URL-encoded JSON，必须 encodeURIComponent
 * 3. Referer 必须带上 so.eastmoney.com，否则东财会返回空结果
 * 4. 主进程调用走 nodeHttpsGet（与 fetchQuotes 同链路），不走 undici fetch
 */
export async function fetchEastMoneyNews(symbol: string, pageSize: number = 20): Promise<EastMoneyNewsItem[]> {
  const keyword = symbolToNewsKeyword(symbol);
  if (!keyword) {
    log.warn(`[EastMoney][news] symbol 解析为空 keyword，跳过：symbol=${symbol}`);
    return [];
  }

  const param = {
    uid: '',
    keyword,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default',
        sort: 'default',
        pageIndex: 1,
        pageSize,
        preTag: '<em>',
        postTag: '</em>',
      },
    },
  };

  const callback = 'jQuery';
  const url = `${EASTMONEY_NEWS_URL}?cb=${callback}&param=${encodeURIComponent(JSON.stringify(param))}`;
  const headers = {
    ...EASTMONEY_HEADERS,
    Referer: 'https://so.eastmoney.com/',
  };

  log.log(`[EastMoney][news] fetchEastMoneyNews start: symbol=${symbol} keyword=${keyword} pageSize=${pageSize}`);

  let raw: string;
  try {
    raw = await crossEnvGetText(url, headers, 8000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[EastMoney][news] HTTP 请求失败: symbol=${symbol} ${msg}`);
    throw err;
  }

  // 剥掉 JSONP 包装：jQuery({...}) → {...}
  // 兼容尾部分号、回车、空白
  const match = raw.match(/^[^(]*\((.*)\)\s*;?\s*$/s);
  if (!match) {
    log.warn(`[EastMoney][news] 响应不是 JSONP 格式: symbol=${symbol} body[0..200]=${raw.slice(0, 200)}`);
    return [];
  }

  let parsed: EastMoneyNewsResponse;
  try {
    parsed = JSON.parse(match[1]) as EastMoneyNewsResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[EastMoney][news] JSON 解析失败: symbol=${symbol} ${msg} body[0..200]=${match[1].slice(0, 200)}`);
    return [];
  }

  const articles = parsed.result?.cmsArticleWebOld ?? [];
  const items: EastMoneyNewsItem[] = articles
    .filter((a) => a.title && a.url)
    .map((a) => ({
      title: stripHighlightTags(a.title ?? ''),
      source: a.mediaName?.trim() || '东方财富',
      publishedAt: eastMoneyDateToIso(a.date ?? ''),
      url: (a.url ?? '').trim(),
      summary: a.content ? stripHighlightTags(a.content) : undefined,
    }));

  log.log(`[EastMoney][news] fetchEastMoneyNews done: symbol=${symbol} keyword=${keyword} -> ${items.length} 条`);
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// 公司详情接口（Company Detail）
//
// 数据来源说明：
// - **push2 stock/get**：扩展 fields 一次拿实时交易 + 估值字段（今开/昨收/52周高低/总市值/PE/PB 等）
// - **emweb F10**：A 股 / 港股 / 美股各一套，拿公司资料（董事长/办公地址/员工数/简介）+ 部分财务摘要
//
// 三个市场的 emweb 接口域名 / 路径不同，且字段差异较大（A 股最全，美股最少），
// 因此为每个市场各写一个 fetch 函数，最后由 `fetchCompanyDetail(symbol)` 主入口按市场派发。
//
// 所有 fetch 函数都通过 `crossEnvGetText`，优先复用主进程 `nodeHttpsGet`，
// 在 dev 渲染端误调用时也能尝试浏览器 fetch（CORS 失败由调用方降级处理）。
// ─────────────────────────────────────────────────────────────────────────────

/** push2 stock/get 单股详情接口（与批量 ulist.np/get 不同，单股专用） */
export const EASTMONEY_STOCK_DETAIL_URL = 'https://push2.eastmoney.com/api/qt/stock/get';

/** A 股 emweb F10 - 公司资料 + 高管 + 经营信息 */
export const EASTMONEY_HSF10_COMPANY_URL = 'https://emweb.eastmoney.com/PC_HSF10/CompanyManagement/PageAjax';

/** A 股 emweb F10 - 核心财务指标（最近一期主要财务数据） */
export const EASTMONEY_HSF10_FINANCE_URL = 'https://emweb.eastmoney.com/PC_HSF10/NewFinanceAnalysis/MainTargetAjax';

/** A 股 emweb F10 - 公司基本信息（注册地址/办公地址/上市日期/概念板块） */
export const EASTMONEY_HSF10_BASIC_URL = 'https://emweb.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax';

/** 港股 emweb F10 - 公司资料 */
export const EASTMONEY_HKF10_COMPANY_URL = 'https://emweb.eastmoney.com/PC_HKF10/CompanyProfile/PageAjax';

/** 美股 emweb F10 - 公司资料 */
export const EASTMONEY_USF10_COMPANY_URL = 'https://emweb.eastmoney.com/pc_usf10/CompanyAndIssueProfile/PageAjax';

/**
 * push2 stock/get 单股扩展字段集。
 *
 * 字段含义（push2 接口的官方含义，部分字段不同市场存在差异）：
 * - **价格类**：f43 当前价 / f44 当日最高 / f45 当日最低 / f46 今开 / f60 昨收
 * - **量额类**：f47 成交量（手）/ f48 成交额（元）/ f57 代码 / f58 名称
 * - **股本类**：f84 总股本（股）/ f85 流通股本（股）/ f86 时间戳
 * - **市值类**：f116 总市值（元）/ f117 流通市值（元）
 * - **估值类**：f162 PE-TTM / f167 市净率 PB / f173 ROE / f55 EPS / f130 市销率 PS
 * - **行业/板块**：f127 所属行业 / f128 所属板块（地域，仅 A 股）
 * - **波动类**：f7 振幅 / f8 换手率 / f9 PE(动态) / f10 量比
 * - **52周**：f350 52周最高 / f351 52周最低（push2 stock/get 单股接口下经常缺失，
 *   截图诊断证实，所以保留请求但不强依赖；首选从 datacenter-web 拿）
 *
 * ⚠️ **数值规约（关键修复）**：
 * 切换到 **fltt=2** 后所有字段都是直接的浮点/整数：
 * - 价格 f43/f44/f45/f46/f60 直接是元（不再是 ×100 的整数）
 * - PE f162 / PB f167 / EPS f55 / ROE f173 直接是浮点（早期代码错误地除了 100）
 * - 振幅 f7 / 换手率 f8 直接是百分比（如 0.85，不再除 100）
 * - 总市值 f116 / 流通市值 f117 单位是元
 * - 总股本 f84 / 流通股 f85 单位是股
 */
const STOCK_DETAIL_FIELDS = [
  'f43', 'f44', 'f45', 'f46', 'f60',
  'f47', 'f48', 'f57', 'f58', 'f86',
  'f84', 'f85', 'f116', 'f117',
  'f162', 'f167', 'f173', 'f127', 'f128', 'f130',
  'f55', 'f7', 'f8', 'f9', 'f10',
  'f350', 'f351',
].join(',');

/**
 * 调用 push2 stock/get 拿单股的扩展字段（行情 + 估值）。
 *
 * 与批量 `fetchQuotes` 的差异：
 * - 一次只查一只股，但能拿到估值类字段（PE/PB/总市值/流通市值等批量接口没有的）
 * - 用于 Company Details 页面，重新触发频率低（用户切换股票时才请求）
 *
 * **使用 fltt=2**（直接浮点），避免 fltt=1 整数模式的 ÷100 换算混乱（详见 STOCK_DETAIL_FIELDS 注释）。
 *
 * @param secid 东方财富 secid，如 `1.600519` / `0.000001` / `116.00700` / `105.AAPL`
 * @returns 解析后的 push2 字段对象，**不直接返回 CompanyDetail**，由调用方按市场组装
 */
async function fetchPush2StockDetail(secid: string): Promise<Record<string, unknown> | null> {
  log.log(`[EastMoney][detail] fetchPush2StockDetail(secid=${secid})`);
  const params = new URLSearchParams({
    ut: getEastMoneyUt(),
    invt: '2',
    fltt: '2',
    fields: STOCK_DETAIL_FIELDS,
    secid,
  });
  const url = `${EASTMONEY_STOCK_DETAIL_URL}?${params.toString()}`;
  log.log(`[EastMoney][detail] push2 url=${url}`);

  try {
    const text = await crossEnvGetText(url, EASTMONEY_HEADERS, 8000);
    log.log(`[EastMoney][detail] push2 raw response (first 800 chars): ${text.slice(0, 800)}`);
    const parsed = JSON.parse(text) as { rc?: number; data?: Record<string, unknown> };
    if (parsed.rc !== 0 || !parsed.data) {
      log.warn(`[EastMoney][detail] push2 stock/get 返回异常 rc=${parsed.rc} secid=${secid}`);
      return null;
    }
    // 关键字段诊断：把估值/量额/波动字段的实际值打出来
    const d = parsed.data;
    const probe = {
      f43_price: d['f43'], f44_high: d['f44'], f45_low: d['f45'], f46_open: d['f46'], f60_prev: d['f60'],
      f47_volume: d['f47'], f48_turnover: d['f48'],
      f7_amplitude: d['f7'], f8_turnoverRate: d['f8'],
      f116_marketCap: d['f116'], f117_floatMarketCap: d['f117'],
      f162_peTTM: d['f162'], f167_pb: d['f167'], f130_ps: d['f130'],
      f350_yearHigh: d['f350'], f351_yearLow: d['f351'],
      f127_industry: d['f127'], f58_name: d['f58'],
    };
    log.log(`[EastMoney][detail] push2 关键字段实测 secid=${secid}: ${JSON.stringify(probe)}`);
    return d;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[EastMoney][detail] push2 stock/get 失败 secid=${secid}: ${msg}`);
    return null;
  }
}

/**
 * 拉取 A 股板块/概念/题材列表（datacenter-web RPT_F10_CORETHEME_BOARDTYPE）。
 *
 * 实测返回示例（贵州茅台 600519）：
 * - 「贵州板块」(BOARD_TYPE='板块') → region
 * - 「食品饮料」(BOARD_TYPE='行业', BOARD_LEVEL='1') → industry
 * - 「酿酒概念」(SELECTED_BOARD_REASON 有值) → concept
 * - 「HS300_」「机构重仓」「西部大开发」(BOARD_TYPE=null) → theme
 *
 * 分类规则：
 * 1. BOARD_TYPE='行业' → industry
 * 2. BOARD_TYPE='板块' → region（地域板块）
 * 3. SELECTED_BOARD_REASON 非空 → concept（基于业务的概念分类）
 * 4. 其他 → theme（题材/指数成分）
 *
 * 仅 A 股；港美股调用此接口会返回空。
 *
 * @param secucode SECUCODE 格式：`600519.SH` / `000001.SZ` / `430090.BJ`
 */
async function fetchCNBoards(secucode: string): Promise<import('@/types').BoardItem[]> {
  log.debug(`[EastMoney][detail] fetchCNBoards secucode=${secucode}`);
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_CORETHEME_BOARDTYPE&columns=ALL&filter=(SECUCODE%3D%22${encodeURIComponent(secucode)}%22)&pageSize=50&pageNumber=1&sortColumns=NEW_BOARD_CODE&sortTypes=1`;
  try {
    const text = await crossEnvGetText(url, EASTMONEY_HEADERS, 8000);
    const parsed = JSON.parse(text) as { result?: { data?: Array<Record<string, unknown>> } };
    const rows = parsed.result?.data ?? [];
    const items: import('@/types').BoardItem[] = [];
    for (const row of rows) {
      const boardName = pickString(row, ['BOARD_NAME']);
      const boardCode = pickString(row, ['NEW_BOARD_CODE', 'BOARD_CODE']);
      if (!boardName || !boardCode) continue;
      const rawType = pickString(row, ['BOARD_TYPE']);
      const reason = pickString(row, ['SELECTED_BOARD_REASON']);
      let boardType: import('@/types').BoardItem['boardType'];
      if (rawType === '行业') boardType = 'industry';
      else if (rawType === '板块') boardType = 'region';
      else if (reason) boardType = 'concept';
      else if (boardName.includes('指数') || /^[A-Z]/.test(boardName)) boardType = 'index';
      else boardType = 'theme';
      items.push({ boardCode, boardName, boardType, reason });
    }
    log.debug(`[EastMoney][detail] fetchCNBoards 返回 ${items.length} 条板块`);
    return items;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[EastMoney][detail] fetchCNBoards 失败 secucode=${secucode}: ${msg}`);
    return [];
  }
}

/**
 * 调用 emweb 接口并解析为 JSON。emweb 接口约定：
 * - 返回纯 JSON（不是 JSONP）
 * - rc / errCode 字段不统一，按"能拿到 data 就算成功"处理
 * - 部分接口失败时返回 HTML 错误页，统一捕获 JSON.parse 异常
 */
async function fetchEmwebJson(url: string, label: string): Promise<Record<string, unknown> | null> {
  log.debug(`[EastMoney][detail] fetchEmwebJson(${label}) url=${url}`);
  try {
    const text = await crossEnvGetText(url, EASTMONEY_HEADERS, 8000);
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[EastMoney][detail] emweb ${label} 失败: ${msg}`);
    return null;
  }
}

/**
 * A 股 6 位代码转 emweb F10 接口需要的格式：`SH600519` / `SZ000001` / `BJ430090`。
 * 与 push2 secid（数字市场前缀）不同，emweb 用的是字母前缀。
 */
function toEmwebHSCode(symbol: string): string {
  if (symbol.startsWith('6')) return `SH${symbol}`;
  if (symbol.startsWith('4') || symbol.startsWith('8')) return `BJ${symbol}`;
  return `SZ${symbol}`;
}

/**
 * 拉取 A 股公司资料，聚合 emweb 三个 F10 子接口 + datacenter-web 财务接口 + push2 扩展字段。
 *
 * 子接口职责：
 * - CompanySurvey（emweb /PC_HSF10/CompanySurvey/PageAjax）：返回 `{ jbzl: [...], fxxg: [...] }`
 *   - jbzl[0]：公司全名(ORG_NAME)、简称(SECURITY_NAME_ABBR)、行业(EM2016/INDUSTRYCSRC1)、
 *     交易所(TRADE_MARKET)、董事长(CHAIRMAN)、总经理(PRESIDENT)、办公/注册地址、员工人数、公司简介、官网
 *   - fxxg[0]：上市日期(LISTING_DATE)、成立日期(FOUND_DATE)、发行价等
 * - CompanyManagement（emweb /PC_HSF10/CompanyManagement/PageAjax）：返回 `{ gglb: [...], cgbd: [...] }`
 *   - gglb：高管列表，POSITION 字段是逗号分隔的多职位串（如"董事长,法定代表人,非独立董事"）
 *   - 仅作 chairman/ceo 兜底（survey 里已有更准的字段）
 * - MainFinaData（datacenter-web RPT_F10_FINANCE_MAINFINADATA）：emweb F10 老接口已 302 失效，
 *   改走开放数据中心 v1，按 REPORT_DATE 倒序取第一条
 *
 * 字段缺失策略：任一子接口失败不阻塞其他字段，缺失字段保持 undefined。
 */
async function fetchCNCompanyDetail(symbol: string): Promise<Partial<CompanyDetail>> {
  const code = toEmwebHSCode(symbol);
  // datacenter-web 财务接口要求 SECUCODE 格式：`688183.SH` / `000001.SZ` / `430090.BJ`
  const secucode = `${symbol}.${code.slice(0, 2)}`;
  // 取最近 4 期财务数据（季报 / 半年报 / 年报混合，按 REPORT_DATE 倒序）
  const financeUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECUCODE%3D%22${secucode}%22)&pageSize=4&pageNumber=1&sortColumns=REPORT_DATE&sortTypes=-1`;
  log.log(`[EastMoney][detail] fetchCNCompanyDetail symbol=${symbol} code=${code} secucode=${secucode}`);

  const [surveyRaw, mgmtRaw, financeRaw, push2, boards] = await Promise.all([
    fetchEmwebJson(`${EASTMONEY_HSF10_BASIC_URL}?code=${code}`, 'CN-Survey'),
    fetchEmwebJson(`${EASTMONEY_HSF10_COMPANY_URL}?code=${code}`, 'CN-Mgmt'),
    fetchEmwebJson(financeUrl, 'CN-Finance'),
    fetchPush2StockDetail(toEastMoneySecid(symbol)),
    fetchCNBoards(secucode),
  ]);

  const detail: Partial<CompanyDetail> = { market: 'cn' };

  // ── 解析 CompanySurvey ──────────────────
  if (surveyRaw) {
    const jbzl = pickFirstRow(surveyRaw, ['jbzl', 'JBZL']);
    if (jbzl) {
      detail.companyName = pickString(jbzl, ['ORG_NAME', 'ORG_NAME_CN', 'COMPANY_NAME']);
      detail.shortName = pickString(jbzl, ['SECURITY_NAME_ABBR', 'STOCK_NAME']);
      // 行业：EM2016 通常是"大行业-中行业-小行业"全路径；INDUSTRYCSRC1 是证监会行业
      detail.industry = pickString(jbzl, ['EM2016', 'INDUSTRYCSRC1', 'INDUSTRY']);
      detail.registeredAddress = pickString(jbzl, ['REG_ADDRESS', 'REGISTERED_ADDRESS']);
      detail.officeAddress = pickString(jbzl, ['ADDRESS', 'OFFICE_ADDRESS']);
      detail.website = pickString(jbzl, ['ORG_WEB', 'WEBSITE']);
      detail.description = pickString(jbzl, ['ORG_PROFILE', 'BUSINESS_SCOPE', 'MAIN_BUSINESS']);
      const employees = pickNumber(jbzl, ['EMP_NUM', 'EMPLOYEES']);
      if (employees !== undefined) detail.employees = employees;
      detail.exchange = pickString(jbzl, ['TRADE_MARKET', 'EXCHANGE']);
      // jbzl 里也带 CHAIRMAN / PRESIDENT 字段，比管理层接口更准（直接是当前任职人）
      detail.chairman = pickString(jbzl, ['CHAIRMAN']);
      detail.ceo = pickString(jbzl, ['PRESIDENT', 'GENERAL_MANAGER']);
    }
    // 上市日期 / 成立日期在 fxxg 子节点
    const fxxg = pickFirstRow(surveyRaw, ['fxxg', 'FXXG']);
    if (fxxg) {
      detail.listingDate = pickDateString(fxxg, ['LISTING_DATE', 'FOUND_DATE']);
    }
  }

  // ── 解析 CompanyManagement（仅作 chairman/ceo 兜底） ──────────
  // 实测 emweb 返回结构是 { gglb: [...] }（高管列表），POSITION 是逗号分隔的多职位串
  if (mgmtRaw && (!detail.chairman || !detail.ceo)) {
    const gglb = (mgmtRaw['gglb'] ?? mgmtRaw['GGLB']) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(gglb)) {
      for (const row of gglb) {
        const position = String(row['POSITION'] ?? row['ZW'] ?? '');
        const name = pickString(row, ['PERSON_NAME', 'NAME', 'XM']);
        if (!name) continue;
        // POSITION 形如 "董事长,法定代表人,非独立董事"，按逗号拆开判断
        const positions = position.split(/[,，、]/).map((p) => p.trim());
        if (!detail.chairman && positions.some((p) => /^(董事长|主席|chairman)$/i.test(p))) {
          detail.chairman = name;
        }
        if (!detail.ceo && positions.some((p) => /^(总经理|总裁|首席执行官|CEO)$/i.test(p))) {
          detail.ceo = name;
        }
        if (detail.chairman && detail.ceo) break;
      }
    }
  }

  // ── 解析 MainFinaData（datacenter-web 主要财务指标，取最近 4 期） ──────────
  // 返回结构：{ result: { data: [{...}, ...] }, success, message, code }
  // 字段约定（实测贵州茅台 600519）：
  // - REPORT_DATE / TOTALOPERATEREVE / PARENTNETPROFIT / XSMLL / ROEJQ / EPSJB
  // - BPS（每股净资产，元）/ MGJYXJJE（每股经营活动现金流，元）/ ZCFZL（资产负债率，%）
  // - YYZSRTBZZ（营收同比 %） / PARENTNETPROFITTBZZ（归母净利润同比 %）
  if (financeRaw) {
    const result = financeRaw['result'] as Record<string, unknown> | undefined;
    const list = (result?.['data'] ?? []) as Array<Record<string, unknown>>;
    log.log(`[EastMoney][detail] CN-Finance result.data length=${Array.isArray(list) ? list.length : 'NOT_ARRAY'} symbol=${symbol}`);
    if (Array.isArray(list) && list.length > 0) {
      const latest = list[0];
      // 把第一期的全部 key 打出来，便于核对字段名是否变更
      log.log(`[EastMoney][detail] CN-Finance latest keys: ${Object.keys(latest).slice(0, 60).join(',')}`);
      log.log(`[EastMoney][detail] CN-Finance latest 关键字段: ${JSON.stringify({
        REPORT_DATE: latest['REPORT_DATE'],
        TOTALOPERATEREVE: latest['TOTALOPERATEREVE'],
        PARENTNETPROFIT: latest['PARENTNETPROFIT'],
        YYZSRTBZZ: latest['YYZSRTBZZ'],
        PARENTNETPROFITTBZZ: latest['PARENTNETPROFITTBZZ'],
        XSMLL: latest['XSMLL'],
        ROEJQ: latest['ROEJQ'],
        EPSJB: latest['EPSJB'],
      })}`);
      detail.reportDate = pickDateString(latest, ['REPORT_DATE', 'REPORTDATE', 'NOTICE_DATE']);
      detail.revenue = pickNumber(latest, ['TOTALOPERATEREVE', 'TOTAL_OPERATE_INCOME', 'OPERATE_INCOME']);
      detail.netProfit = pickNumber(latest, ['PARENTNETPROFIT', 'PARENT_NETPROFIT', 'NETPROFIT']);
      detail.grossMargin = pickNumber(latest, ['XSMLL', 'GROSS_PROFIT_RATIO']);
      detail.roe = pickNumber(latest, ['ROEJQ', 'WEIGHT_AVG_ROE', 'ROE_AVG']);
      detail.eps = pickNumber(latest, ['EPSJB', 'BASIC_EPS', 'EPS']);
      detail.bps = pickNumber(latest, ['BPS']);
      detail.cashFlowPerShare = pickNumber(latest, ['MGJYXJJE']);
      detail.debtAssetRatio = pickNumber(latest, ['ZCFZL']);
      detail.revenueYoY = pickNumber(latest, ['YYZSRTBZZ', 'TOTAL_OPERATE_INCOME_YOY']);
      detail.netProfitYoY = pickNumber(latest, ['PARENTNETPROFITTBZZ', 'PARENT_NETPROFIT_YOY']);

      // 历史趋势：把 4 期都转成 FinanceSnapshot
      const history: import('@/types').FinanceSnapshot[] = [];
      for (const row of list) {
        const date = pickDateString(row, ['REPORT_DATE', 'REPORTDATE']);
        if (!date) continue;
        history.push({
          reportDate: date,
          revenue: pickNumber(row, ['TOTALOPERATEREVE', 'TOTAL_OPERATE_INCOME']),
          netProfit: pickNumber(row, ['PARENTNETPROFIT', 'PARENT_NETPROFIT']),
          grossMargin: pickNumber(row, ['XSMLL']),
          roe: pickNumber(row, ['ROEJQ']),
          eps: pickNumber(row, ['EPSJB']),
        });
      }
      if (history.length > 0) detail.financialHistory = history;
    }
  }

  // ── 合并板块/概念列表 ─────────────────────────────────
  if (boards.length > 0) {
    detail.boards = boards;
    // concepts 旧字段（顶层）：把概念名拼成"、"分隔的字符串作为兜底展示
    if (!detail.concepts) {
      const conceptNames = boards
        .filter((b) => b.boardType === 'concept' || b.boardType === 'theme')
        .map((b) => b.boardName);
      if (conceptNames.length > 0) detail.concepts = conceptNames.join('、');
    }
  }

  // ── 合并 push2 实时字段（覆盖 / 补充） ──────────
  applyPush2DetailFields(detail, push2);

  return detail;
}

/**
 * 拉取港股公司资料。港股 emweb F10 字段比 A 股少：
 * - 没有"所属概念"
 * - 财务数据接口不同（本实现暂不查财务，仅拿基础 + 公司资料 + push2 估值）
 * - 上市日期 / 公司简介 / 行业 / 注册地 在 CompanyProfile 接口
 */
async function fetchHKCompanyDetail(symbol: string): Promise<Partial<CompanyDetail>> {
  // 港股 emweb 用 5 位代码，不带 .HK 后缀
  const code = symbol.replace(/\.HK$/i, '').padStart(5, '0');
  log.log(`[EastMoney][detail] fetchHKCompanyDetail symbol=${symbol} code=${code}`);

  const [profileRaw, push2] = await Promise.all([
    fetchEmwebJson(`${EASTMONEY_HKF10_COMPANY_URL}?code=${code}`, 'HK-Profile'),
    fetchPush2StockDetail(toHKSecid(symbol)),
  ]);

  const detail: Partial<CompanyDetail> = { market: 'hk', partial: true };

  // 港股 emweb 实测返回结构（与 A 股 / 美股完全不同）：
  // {
  //   "zqzl": { zqdm, zqjc, ssrq(上市日期), jys(交易所), bk(板块), mgmz(每股面值) },
  //   "gszl": { gsmc(公司名), ywmc(英文名), zcd(注册地), bgdz(办公地址),
  //             gsclrq(成立日期), dsz(董事长), gswz(官网), gsms(公司秘书),
  //             ygrs(员工人数), gsjs(公司简介), sshy(所属行业), email, lxdh, ... }
  // }
  if (profileRaw) {
    const zqzl = profileRaw['zqzl'] as Record<string, unknown> | undefined;
    const gszl = profileRaw['gszl'] as Record<string, unknown> | undefined;
    if (zqzl && typeof zqzl === 'object') {
      // ssrq 形如 "2004/6/16 0:00:00" → 转 YYYY-MM-DD
      detail.listingDate = pickDateString(zqzl, ['ssrq']);
      detail.exchange = pickString(zqzl, ['jys']) ?? '香港交易所';
    }
    if (gszl && typeof gszl === 'object') {
      detail.companyName = pickString(gszl, ['gsmc', 'ywmc']);
      detail.registeredAddress = pickString(gszl, ['zcd', 'zcdz']);
      detail.officeAddress = pickString(gszl, ['bgdz']);
      detail.website = pickString(gszl, ['gswz']);
      // 公司简介（gsjs 通常带前导空格，这里直接 trim）
      const profile = pickString(gszl, ['gsjs']);
      if (profile) detail.description = profile;
      detail.chairman = pickString(gszl, ['dsz']);
      // 港股没有"总经理"字段，gsms 是公司秘书，不归入 ceo；让 ceo 走 push2 兜底（也可能为空）
      detail.industry = pickString(gszl, ['sshy', 'ssyw']);
      // 员工人数 ygrs 形如 "87,412"，pickNumber 内部会处理千分位
      const employees = pickNumber(gszl, ['ygrs']);
      if (employees !== undefined) detail.employees = employees;
    }
  }

  applyPush2DetailFields(detail, push2);

  return detail;
}

/**
 * 美股 ticker → emweb F10 code 格式：`AAPL.O`（NASDAQ）或 `BRK.A.N`（NYSE）。
 * 后缀规则与 push2 市场代码一致：105 → `.O`，106 → `.N`。
 */
function toEmwebUSCode(symbol: string): string {
  const ticker = symbol.toUpperCase();
  const suffix = getUSMarketCode(symbol) === US_MARKET_NASDAQ ? '.O' : '.N';
  return `${ticker}${suffix}`;
}

/**
 * 拉取美股公司资料。美股 emweb F10 字段最少：
 * - 主要是公司简介、行业、CEO、办公地址
 * - 没有"所属概念" / "总经理"（CEO 字段直接对应）
 * - 财务数据接口结构与 A 股 / 港股完全不同，本实现不查财务摘要
 */
async function fetchUSCompanyDetail(symbol: string): Promise<Partial<CompanyDetail>> {
  const code = toEmwebUSCode(symbol);
  log.log(`[EastMoney][detail] fetchUSCompanyDetail symbol=${symbol} code=${code}`);

  const [profileRaw, push2] = await Promise.all([
    fetchEmwebJson(`${EASTMONEY_USF10_COMPANY_URL}?code=${code}`, 'US-Profile'),
    fetchPush2StockDetail(toUSSecid(symbol)),
  ]);

  const detail: Partial<CompanyDetail> = { market: 'us', partial: true };

  if (profileRaw) {
    const info = pickFirstRow(profileRaw, ['CompanyProfile', 'gsgk', 'data']);
    if (info) {
      detail.companyName = pickString(info, ['ORG_NAME', 'COMPANY_NAME', 'ORG_NAME_CN']);
      detail.shortName = pickString(info, ['SECURITY_NAME_ABBR', 'SECUCODE_ABBR', 'STOCK_NAME']);
      detail.industry = pickString(info, ['BELONG_INDUSTRY', 'INDUSTRY']);
      detail.officeAddress = pickString(info, ['ADDRESS', 'OFFICE_ADDRESS']);
      detail.website = pickString(info, ['ORG_WEB', 'WEBSITE']);
      detail.description = pickString(info, ['ORG_PROFILE', 'COMPANY_PROFILE', 'BUSINESS_SCOPE']);
      detail.ceo = pickString(info, ['CEO', 'PRESIDENT', 'CHAIRMAN']);
      const employees = pickNumber(info, ['EMP_NUM', 'EMPLOYEES']);
      if (employees !== undefined) detail.employees = employees;
      detail.listingDate = pickDateString(info, ['LISTING_DATE', 'FOUND_DATE']);
      detail.exchange = pickString(info, ['TRADE_MARKET', 'EXCHANGE']) ?? (getUSMarketCode(symbol) === US_MARKET_NASDAQ ? 'NASDAQ' : 'NYSE');
    }
  }

  applyPush2DetailFields(detail, push2);

  return detail;
}

/**
 * 公司详情主入口。按 symbol 自动派发到 A股/港股/美股对应 fetch 函数。
 *
 * 整体策略：
 * - 任一子接口失败不抛异常，缺字段返回 undefined（保证 UI 总能渲染）
 * - 仅当所有子接口（emweb + push2）都返回空时，整体抛 `Error('无法获取公司详情')`
 *
 * @param symbol 股票代码（A股: 6 位数字；港股: XXXXX.HK；美股: ticker）
 */
export async function fetchCompanyDetail(symbol: string): Promise<CompanyDetail> {
  const market = detectMarket(symbol);
  log.log(`[EastMoney][detail] fetchCompanyDetail symbol=${symbol} market=${market}`);

  let detail: Partial<CompanyDetail>;
  switch (market) {
    case 'cn':
      detail = await fetchCNCompanyDetail(symbol);
      break;
    case 'hk':
      detail = await fetchHKCompanyDetail(symbol);
      break;
    case 'us':
      detail = await fetchUSCompanyDetail(symbol);
      break;
  }

  // 至少要有 companyName / shortName / 行业 / 公司简介之一才算成功
  const hasAny = !!(
    detail.companyName ||
    detail.shortName ||
    detail.industry ||
    detail.description ||
    detail.marketCap ||
    detail.peTTM
  );
  if (!hasAny) {
    throw new Error(`无法获取公司详情: symbol=${symbol} market=${market}（emweb 与 push2 均未返回有效数据）`);
  }

  // 显式补回 market（switch 分支已设过，这里兜底）
  detail.market = market;
  return detail as CompanyDetail;
}

// ── 公司详情解析的小工具 ──────────────────────────────────────────────────────

/**
 * 把 push2 stock/get 的扩展字段合并到 detail 上。
 *
 * **fltt=2** 模式下的字段单位约定（与批量 ulist 接口走 fltt=1 不同）：
 * - 价格 f43/f44/f45/f46/f60：直接是元（浮点）
 * - 振幅 f7 / 换手率 f8：直接是百分比数值（如 0.85 表示 0.85%）
 * - PE-TTM f162 / PB f167 / EPS f55 / ROE f173 / PS f130：直接是浮点
 * - 总市值 f116 / 流通市值 f117：单位元
 * - 总股本 f84 / 流通股 f85：单位股
 * - 成交量 f47：单位手；成交额 f48：单位元
 *
 * ⚠️ 历史 Bug：之前在 fltt=1 时所有价格 ÷100 是对的，但同时把 PE/PB/EPS 也错误地除了 100。
 * 现在统一切到 fltt=2，移除所有 ÷100 操作（详见 fetchPush2StockDetail 中 fltt 选择说明）。
 */
function applyPush2DetailFields(detail: Partial<CompanyDetail>, push2: Record<string, unknown> | null): void {
  if (!push2) return;

  // 价格类字段（fltt=2 直接浮点）
  if (detail.openPrice === undefined) detail.openPrice = parseEastMoneyNumber(push2['f46']);
  if (detail.previousClose === undefined) detail.previousClose = parseEastMoneyNumber(push2['f60']);
  if (detail.dayHigh === undefined) detail.dayHigh = parseEastMoneyNumber(push2['f44']);
  if (detail.dayLow === undefined) detail.dayLow = parseEastMoneyNumber(push2['f45']);
  if (detail.yearHigh === undefined) detail.yearHigh = parseEastMoneyNumber(push2['f350']);
  if (detail.yearLow === undefined) detail.yearLow = parseEastMoneyNumber(push2['f351']);

  // 成交量 / 成交额
  if (detail.volume === undefined) detail.volume = parseEastMoneyNumber(push2['f47']);
  if (detail.turnover === undefined) detail.turnover = parseEastMoneyNumber(push2['f48']);

  // 振幅 / 换手率（fltt=2 直接百分比数值）
  if (detail.amplitude === undefined) detail.amplitude = parseEastMoneyNumber(push2['f7']);
  if (detail.turnoverRate === undefined) detail.turnoverRate = parseEastMoneyNumber(push2['f8']);

  // 估值类（fltt=2 直接浮点，无需 ÷100）
  if (detail.peTTM === undefined) detail.peTTM = parseEastMoneyNumber(push2['f162']);
  if (detail.pb === undefined) detail.pb = parseEastMoneyNumber(push2['f167']);
  if (detail.ps === undefined) detail.ps = parseEastMoneyNumber(push2['f130']);
  // EPS / ROE：财务接口已设过则不覆盖；push2 仅作兜底
  if (detail.eps === undefined) detail.eps = parseEastMoneyNumber(push2['f55']);
  if (detail.roe === undefined) detail.roe = parseEastMoneyNumber(push2['f173']);

  // 总市值 / 流通市值（单位元）
  if (detail.marketCap === undefined) detail.marketCap = parseEastMoneyNumber(push2['f116']);
  if (detail.floatMarketCap === undefined) detail.floatMarketCap = parseEastMoneyNumber(push2['f117']);
  if (detail.totalShares === undefined) detail.totalShares = parseEastMoneyNumber(push2['f84']);
  if (detail.floatShares === undefined) detail.floatShares = parseEastMoneyNumber(push2['f85']);

  // 行业 / 板块（仅 A 股 push2 有，港美股为空）
  if (!detail.industry) {
    const ind = pickString(push2, ['f127']);
    if (ind) detail.industry = ind;
  }
  // f128 是地域板块（如"广东板块"），与 boards 列表中的 region 类型对应；
  // 不再覆盖 concepts 字段（concepts 由真正的概念列表填充）
  if (!detail.shortName) {
    const name = pickString(push2, ['f58']);
    if (name) detail.shortName = name;
  }
}

/**
 * 从 emweb 响应里挑第一行（emweb 接口返回结构通常是 `{ key: [{...}, ...] }`）。
 * 按 keys 顺序找到第一个非空数组，返回数组的第一个元素。
 */
function pickFirstRow(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const val = obj[key];
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0]) {
      return val[0] as Record<string, unknown>;
    }
    // 部分接口直接把对象放在 key 下
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return val as Record<string, unknown>;
    }
  }
  return null;
}

/** 安全取字符串字段，trim 后空串返回 undefined */
function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (val === undefined || val === null) continue;
    const str = String(val).trim();
    if (str && str !== '-' && str !== 'null') return str;
  }
  return undefined;
}

/** 安全取数字字段（复用 parseEastMoneyNumber 的兜底逻辑） */
function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const num = parseEastMoneyNumber(obj[key]);
    if (num !== undefined) return num;
  }
  return undefined;
}

/**
 * 取日期字段并归一化为 `YYYY-MM-DD`。
 * 接受多种输入：`2024-09-30` / `2024-09-30 00:00:00` / `20240930` / `2024/09/30`
 */
function pickDateString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  const raw = pickString(obj, keys);
  if (!raw) return undefined;
  // 已经是 YYYY-MM-DD 开头：截前 10 位
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // YYYYMMDD：插入分隔
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  // YYYY/MM/DD：替换分隔
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(raw)) {
    const [y, m, d] = raw.split(/[\/\s]/)[0].split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return raw;
}
