/**
 * 东方财富 push2 HTTP API 封装模块
 *
 * 适用环境：Electron 主进程（Node.js 18+），内置 fetch，可直接访问东方财富 HTTP API。
 * 无需 Python，速度极快（毫秒级 vs 秒级）。
 *
 * 文档：docs/东方财富API文档.md
 */

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
  return EASTMONEY_UT_POOL[eastMoneyUtIndex % EASTMONEY_UT_POOL.length];
}

/**
 * 将 ut 轮换到下一个备用值。
 * 当服务器返回 rc !== 0（ut 失效）时调用。
 */
export function rotateEastMoneyUt(): void {
  eastMoneyUtIndex = (eastMoneyUtIndex + 1) % EASTMONEY_UT_POOL.length;
  console.warn(`[EastMoney] ut 轮换到备用值 #${eastMoneyUtIndex}: ${getEastMoneyUt()}`);
}

// ── secid 工具函数 ────────────────────────────────────────────────────────────

/**
 * 将 6 位 A 股代码转换为东方财富 secid 格式。
 * - 上交所（6 开头）→ `1.xxxxxx`
 * - 深交所/北交所（其他）→ `0.xxxxxx`
 */
export function toEastMoneySecid(symbol: string): string {
  return symbol.startsWith('6') ? `1.${symbol}` : `0.${symbol}`;
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
  return `116.${code.padStart(5, '0')}`;
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
  return US_NYSE_TICKERS.has(symbol.toUpperCase()) ? US_MARKET_NYSE : US_MARKET_NASDAQ;
}

/**
 * 为美股 symbol 生成主市场 secid。
 * 例：`AAPL` → `'105.AAPL'`，`BABA` → `'106.BABA'`
 */
export function toUSSecid(symbol: string): string {
  return `${getUSMarketCode(symbol)}.${symbol.toUpperCase()}`;
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
  return typeof window !== 'undefined' && typeof (globalThis as { fetch?: unknown }).fetch === 'function';
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
 * 跨环境 HTTP GET：渲染进程用浏览器 fetch（CORS 已在主进程放开），
 * 主进程用 Node `https` 模块（绕开 undici 的诸多坑）。
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
    return response.text();
  }
  return nodeHttpsGet(url, headers, timeoutMs);
}

/**
 * 调用东方财富 push2 接口批量获取行情数据。
 *
 * - 自动使用当前 ut 值发起请求
 * - 若服务器返回 `rc !== 0`（ut 失效），自动轮换到下一个备用 ut 并重试
 * - 最多尝试所有备用 ut 值，全部失败时抛出异常
 *
 * @param secids 东方财富 secid 列表，格式如 `['1.000001', '100.NDX']`
 * @returns diff 数组（原始字段），每项对应一个 secid 的行情数据
 * @throws 所有备用 ut 均失败时抛出 Error
 */
export async function fetchEastMoneyBatch(
  secids: string[],
): Promise<Array<Record<string, unknown>>> {
  let lastNetError: unknown = null;

  for (let attempt = 0; attempt < EASTMONEY_UT_POOL.length; attempt++) {
    const params = new URLSearchParams({
      fltt: '2',
      invt: '2',
      // f2 现价、f3 涨跌幅%、f4 涨跌额、f5 成交量(手)、f12 代码、f14 名称
      // f15 最高、f16 最低、f17 今开、f18 昨收
      fields: 'f2,f3,f4,f5,f12,f14,f15,f16,f17,f18',
      secids: secids.join(','),
      ut: getEastMoneyUt(),
      np: '1',
      pi: '0',
      pz: String(secids.length),
    });
    const url = `${EASTMONEY_QUOTE_URL}?${params.toString()}`;

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
      console.warn(
        `[EastMoney] 请求失败 attempt=${attempt} url=${url.slice(0, 120)}... err=${err instanceof Error ? err.message : String(err)}`,
        cause ? `cause=${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}` : '',
      );
      continue;
    }

    let data: EastMoneyResponse;
    try {
      data = JSON.parse(bodyText) as EastMoneyResponse;
    } catch (parseErr) {
      lastNetError = parseErr;
      console.warn(`[EastMoney] JSON 解析失败 body[0..200]=${bodyText.slice(0, 200)}`);
      continue;
    }

    if (data.rc === 0 && data.data?.diff) {
      return data.data.diff;
    }

    // rc !== 0 通常表示 ut 失效，轮换到下一个备用值后重试
    console.warn(`[EastMoney] rc=${data.rc}，当前 ut 可能已失效`);
    rotateEastMoneyUt();
  }

  // 所有 ut 都试过仍失败：把最后一次网络错误的根因带出去，方便上层定位
  const detail = lastNetError instanceof Error
    ? `${lastNetError.message}${(lastNetError as { cause?: unknown }).cause ? ` | cause=${String((lastNetError as { cause?: Error }).cause?.message ?? (lastNetError as { cause?: unknown }).cause)}` : ''}`
    : String(lastNetError ?? 'unknown');
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
  return Number.isFinite(num) ? num : undefined;
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
  const secids = symbols.map(toHKSecid);
  const diff = await fetchEastMoneyBatch(secids);

  const now = Math.floor(Date.now() / 1000);

  // 建立 f12（5 位港股代码）→ 行情 映射
  const codeToQuote = new Map<string, Record<string, unknown>>();
  for (const item of diff) {
    const code = String(item.f12 ?? '').padStart(5, '0');
    codeToQuote.set(code, item);
  }

  return symbols
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
  const now = Math.floor(Date.now() / 1000);

  // ① 主市场请求：每个 symbol 仅发一个 secid（105 或 106）
  const primarySecids = symbols.map(toUSSecid);
  const primaryDiff = await fetchEastMoneyBatch(primarySecids);

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
      const fallbackDiff = await fetchEastMoneyBatch(fallbackSecids);
      for (const item of fallbackDiff) {
        const code = String(item.f12 ?? '').toUpperCase();
        if (code && !codeToQuote.has(code)) codeToQuote.set(code, item);
      }
    } catch (err) {
      // 兜底失败不影响主市场结果，仅打印警告
      console.warn('[EastMoney] US fallback market request failed:', err);
    }
  }

  return symbols
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
}

/**
 * 判断 symbol 所属市场。
 * - `cn`：6 位纯数字（A 股）
 * - `hk`：以 `.HK` 结尾，或单纯 5 位以内数字带 .HK 后缀
 * - `us`：其他（默认按美股 ticker 处理）
 */
export type MarketType = 'cn' | 'hk' | 'us';

export function detectMarket(symbol: string): MarketType {
  if (/^\d{6}$/.test(symbol)) return 'cn';
  if (/\.HK$/i.test(symbol)) return 'hk';
  return 'us';
}

/**
 * 将 symbol 转换为东方财富 push2 接口 secid（统一入口）。
 * 内部根据 `detectMarket` 派发到 `toEastMoneySecid` / `toHKSecid` / `toUSSecid`。
 */
export function toQuoteSecid(symbol: string): string {
  switch (detectMarket(symbol)) {
    case 'cn': return toEastMoneySecid(symbol);
    case 'hk': return toHKSecid(symbol);
    case 'us': return toUSSecid(symbol);
  }
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
  if (symbols.length === 0) return [];

  const now = Math.floor(Date.now() / 1000);

  // 为每个 symbol 计算其所属市场和主 secid
  const symbolMeta = symbols.map((symbol) => ({
    symbol,
    market: detectMarket(symbol),
    secid: toQuoteSecid(symbol),
  }));

  // ① 主请求：一次性拿所有市场的行情
  const primaryDiff = await fetchEastMoneyBatch(symbolMeta.map((m) => m.secid));

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
      const fallbackDiff = await fetchEastMoneyBatch(fallbackSecids);
      for (const item of fallbackDiff) {
        const code = String(item.f12 ?? '').toUpperCase();
        if (code && !usCodeToQuote.has(code)) usCodeToQuote.set(code, item);
      }
    } catch (err) {
      console.warn('[EastMoney] US fallback market request failed:', err);
    }
  }

  // ③ 按原始 symbol 顺序回填
  return symbolMeta
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
}

/**
 * 批量获取 A 股实时行情。
 *
 * @param symbols 6 位 A 股代码列表，如 `['600519', '000001']`
 * @returns 行情结果数组，代码不存在时对应项为 null（已过滤）
 */
export async function fetchCNQuotes(symbols: string[]): Promise<StockQuoteResult[]> {
  const secids = symbols.map(toEastMoneySecid);
  const diff = await fetchEastMoneyBatch(secids);

  const now = Math.floor(Date.now() / 1000);

  // 建立 code → 行情 映射（f12 不含市场前缀）
  const codeToQuote = new Map<string, Record<string, unknown>>();
  for (const item of diff) {
    const code = String(item.f12 ?? '').padStart(6, '0');
    codeToQuote.set(code, item);
  }

  return symbols
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
  // 港股：XXXXX.HK → 116.XXXXX
  if (/\.HK$/i.test(symbol)) {
    return toHKSecid(symbol);
  }
  // 美股指数（.IXIC / .INX 等）→ 100.NDX / 100.SPX
  const indexEntry = INDEX_SECID_MAP.find((entry) => entry.symbol === symbol);
  if (indexEntry) return indexEntry.secid;
  // 美股个股（非 6 位纯数字）→ 按白名单选 105 或 106
  if (!/^\d{6}$/.test(symbol)) {
    return toUSSecid(symbol);
  }
  // A 股：6 开头 → 上交所，其他 → 深交所
  return toEastMoneySecid(symbol);
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

  return { data, source: 'eastmoney' };
}

/**
 * 批量获取关键指数行情（基于 INDEX_SECID_MAP 中预设的 6 个指数）。
 *
 * @returns 指数行情结果数组
 */
export async function fetchIndices(): Promise<IndexQuoteResult[]> {
  const secids = INDEX_SECID_MAP.map((entry) => entry.secid);
  const diff = await fetchEastMoneyBatch(secids);

  // 建立 f12 代码 → secid 的映射（f12 不含市场前缀）
  const codeToSecid = new Map<string, string>();
  for (const entry of INDEX_SECID_MAP) {
    const code = entry.secid.split('.').slice(1).join('.');
    codeToSecid.set(code, entry.secid);
  }
  const secidToMeta = new Map(INDEX_SECID_MAP.map((entry) => [entry.secid, entry]));

  return diff
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
}
