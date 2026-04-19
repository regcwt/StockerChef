import axios from 'axios';
import type { Quote, NewsItem, StockProfile, SearchResult, Stock, HistoricalDataPoint, HistoricalDataResult } from '@/types';

const BASE_URL = 'https://finnhub.io/api/v1';

/**
 * 获取 Finnhub API Key
 * 从 electron-store 用户设置读取（Settings 页面配置）
 */
const getFinnhubApiKey = async (): Promise<string> => {
  try {
    const storedKey = await window.electronAPI.getSettings('finnhubApiKey');
    if (storedKey && typeof storedKey === 'string' && storedKey.trim()) {
      return storedKey.trim();
    }
  } catch {
    // electron-store 不可用时（如纯 Web 环境）忽略错误
  }
  return '';
};

// Rate limiting configuration
const MAX_REQUESTS_PER_MINUTE = 30; // 50% of Finnhub free tier limit (60/min)
const REQUEST_INTERVAL = 60000 / MAX_REQUESTS_PER_MINUTE; // ~2000ms between requests

let requestQueue: Array<() => void> = [];
let isProcessing = false;
let lastRequestTime = 0;

// Request queue processor
const processQueue = async () => {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  const waitTime = Math.max(0, REQUEST_INTERVAL - timeSinceLastRequest);
  
  if (waitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  const request = requestQueue.shift();
  if (request) {
    request();
    lastRequestTime = Date.now();
  }
  
  isProcessing = false;
  
  // Process next request
  setTimeout(() => processQueue(), 100);
};

// Wrapper for API requests with rate limiting
const apiRequest = async <T>(fn: () => Promise<T>): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    
    processQueue();
  });
};

/** Key 为空时抛出友好错误，引导用户去 Settings 页面配置 */
const requireApiKey = async (): Promise<string> => {
  const key = await getFinnhubApiKey();
  if (!key) {
    throw new Error('Finnhub API Key not configured. Please go to Settings to add your key.');
  }
  return key;
};

export const getQuote = async (symbol: string): Promise<Quote> => {
  return apiRequest(async () => {
    const token = await requireApiKey();
    const response = await axios.get(`${BASE_URL}/quote`, {
      params: { symbol, token },
    });

    const data = response.data;

    return {
      symbol,
      price: data.c || 0,
      change: data.d || 0,
      changePercent: data.dp || 0,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc,
      timestamp: new Date().toISOString(),
    };
  });
};

/**
 * 直接并发获取单只美股报价（不走限流队列）
 * 用于 Dashboard 批量刷新场景：多只股票同时发出请求，不串行等待
 * Finnhub 免费层 60次/分钟，10只以内的自选股并发完全安全
 */
export const getQuoteDirect = async (symbol: string): Promise<Quote | null> => {
  try {
    const token = await requireApiKey();
    const response = await axios.get(`${BASE_URL}/quote`, {
      params: { symbol, token },
    });
    const data = response.data;
    return {
      symbol,
      price: data.c || 0,
      change: data.d || 0,
      changePercent: data.dp || 0,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

export const getProfile = async (symbol: string): Promise<Partial<Stock>> => {
  return apiRequest(async () => {
    const token = await requireApiKey();
    const response = await axios.get(`${BASE_URL}/stock/profile2`, {
      params: { symbol, token },
    });

    const data: StockProfile = response.data;

    return {
      symbol,
      name: data.name || symbol,
      marketCap: data.marketCapitalization,
      description: `${data.country} - ${data.industry}`,
    };
  });
};

export const getNews = async (symbol: string): Promise<NewsItem[]> => {
  return apiRequest(async () => {
    const token = await requireApiKey();
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const toDateString = (date: Date) => date.toISOString().split('T')[0];

    const response = await axios.get(`${BASE_URL}/company-news`, {
      params: {
        symbol,
        from: toDateString(sevenDaysAgo),
        to: toDateString(today),
        token,
      },
    });

    return response.data.slice(0, 20).map((item: any) => ({
      title: item.headline,
      source: item.source,
      publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : '',
      url: item.url,
      summary: item.summary,
    }));
  });
};

export const searchSymbol = async (query: string): Promise<SearchResult[]> => {
  if (!query || query.length < 1) return [];

  return apiRequest(async () => {
    const token = await requireApiKey();
    const response = await axios.get(`${BASE_URL}/search`, {
      params: { q: query, token },
    });

    return response.data.result || [];
  });
};

// Error handler for API calls
export const handleAPIError = (error: any): string => {
  if (error.response) {
    if (error.response.status === 429) {
      return 'API rate limit exceeded. Please wait a moment.';
    }
    if (error.response.status === 401) {
      return 'Invalid API key. Please check your configuration.';
    }
    return `API Error: ${error.response.status}`;
  }
  if (error.request) {
    return 'Network error. Please check your connection.';
  }
  return error.message || 'Unknown error occurred';
};

/**
 * 获取股票历史 K 线数据（双数据源：AKShare 优先，yfinance 降级）
 * 参考 TradingAgents-CN 的多数据源降级机制
 *
 * 数据链路：Electron IPC → main 进程 → Python child_process → stock_fetch.py
 * stock_fetch.py 内部：AKShare（优先）→ yfinance（降级）
 *
 * @param symbol 股票代码（美股如 AAPL，A 股如 000001）
 * @param startDate 开始日期 YYYY-MM-DD
 * @param endDate 结束日期 YYYY-MM-DD（含）
 * @returns HistoricalDataResult，source 字段标明实际使用的数据源
 */
export const getHistoricalData = async (
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<HistoricalDataResult> => {
  try {
    const rawJson = await window.electronAPI.getStockHistory(symbol, startDate, endDate);
    const parsed = JSON.parse(rawJson);

    // Python 脚本返回错误对象
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return {
        data: [],
        source: 'simulated',
        error: parsed.message || parsed.error,
      };
    }

    // 成功格式一：{ data: HistoricalDataPoint[], source: 'akshare' | 'yfinance' }
    if (parsed && typeof parsed === 'object' && 'data' in parsed && Array.isArray(parsed.data)) {
      return {
        data: parsed.data as HistoricalDataPoint[],
        source: parsed.source === 'akshare' ? 'akshare' : 'yfinance',
      };
    }

    // 成功格式二：数组格式 [{date, open, high, low, close, volume, source}, ...]
    // yfinance_fetch.py 的旧版路由（美股/港股历史 K 线）直接返回数组
    if (Array.isArray(parsed) && parsed.length > 0) {
      const firstItem = parsed[0];
      const source = firstItem.source === 'akshare' ? 'akshare' : 'yfinance';
      return {
        data: parsed.map(({ source: _src, ...rest }: any) => rest) as HistoricalDataPoint[],
        source,
      };
    }

    // 空数组也是合法响应（如节假日无数据）
    if (Array.isArray(parsed) && parsed.length === 0) {
      return { data: [], source: 'simulated', error: 'No data returned for this date range' };
    }

    return { data: [], source: 'simulated', error: 'Unexpected response format from stock_fetch.py' };
  } catch (error: any) {
    return {
      data: [],
      source: 'simulated',
      error: error.message || 'Failed to fetch historical data',
    };
  }
};

// ─── A 股接口（通过 AKShare，不需要 Finnhub Key）────────────────────────────

/**
 * 判断是否为 A 股代码（纯 6 位数字）
 * 例：000001、600519、300750 → true；AAPL、TSLA → false
 */
export const isCNStock = (symbol: string): boolean =>
  /^\d{6}$/.test(symbol);

/**
 * 判断是否为港股代码（4-6 位数字 + .HK 后缀，大小写不敏感）
 * 例：03690.HK、00700.HK、3690.HK → true；AAPL、000001 → false
 * 注意：港股标准格式为 5 位数字（含前导零），addToWatchlist 会自动补全
 */
export const isHKStock = (symbol: string): boolean =>
  /^\d{4,6}\.HK$/i.test(symbol);

/**
 * 获取单只 A 股实时行情（通过 AKShare stock_zh_a_spot）
 * 返回与 Finnhub Quote 兼容的数据结构
 */
export const getCNQuote = async (symbol: string): Promise<Quote | null> => {
  try {
    const rawJson = await window.electronAPI.getCNQuote(symbol);
    const parsed = JSON.parse(rawJson);

    if (parsed && 'error' in parsed) {
      console.warn(`[AKShare] getCNQuote error for ${symbol}:`, parsed.message);
      return null;
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      const item = parsed[0];
      return {
        symbol: item.symbol,
        price: item.price ?? 0,
        change: item.change ?? 0,
        changePercent: item.changePercent ?? 0,
        high: item.high,
        low: item.low,
        open: item.open,
        previousClose: item.previousClose,
        volume: item.volume,
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  } catch (error: any) {
    console.warn(`[AKShare] getCNQuote failed for ${symbol}:`, error.message);
    return null;
  }
};

/**
 * 搜索 A 股（从 AKShare 全量数据中模糊匹配代码/名称）
 * 返回与 Finnhub SearchResult 兼容的数据结构
 */
export const searchCNSymbol = async (query: string): Promise<SearchResult[]> => {
  try {
    const rawJson = await window.electronAPI.searchCNSymbol(query);
    const parsed = JSON.parse(rawJson);

    if (parsed && 'error' in parsed) {
      console.warn('[AKShare] searchCNSymbol error:', parsed.message);
      return [];
    }

    if (Array.isArray(parsed)) {
      return parsed as SearchResult[];
    }

    return [];
  } catch (error: any) {
    console.warn('[AKShare] searchCNSymbol failed:', error.message);
    return [];
  }
};
