import { create } from 'zustand';
import type { Quote, StockQuestion, IndexQuote } from '@/types';

/** 涨跌色风格：cn = 红涨绿跌（中国），us = 绿涨红跌（美股） */
export type ColorMode = 'cn' | 'us';

/** 根据 colorMode 返回涨跌对应的颜色 */
export const getChangeColors = (colorMode: ColorMode) => ({
  up: colorMode === 'cn' ? '#dc2626' : '#16a34a',
  down: colorMode === 'cn' ? '#16a34a' : '#dc2626',
  upBg: colorMode === 'cn' ? 'rgba(220, 38, 38, 0.08)' : 'rgba(22, 163, 74, 0.08)',
  downBg: colorMode === 'cn' ? 'rgba(22, 163, 74, 0.08)' : 'rgba(220, 38, 38, 0.08)',
});

/** 单只股票的价格/涨幅提醒阈值配置 */
export interface AlertThreshold {
  symbol: string;
  /** 价格高于此值时提醒（undefined = 不设置） */
  priceAbove?: number;
  /** 价格低于此值时提醒（undefined = 不设置） */
  priceBelow?: number;
  /** 涨幅高于此百分比时提醒，默认 +5 */
  changeAbove: number;
  /** 涨幅低于此百分比时提醒，默认 -5 */
  changeBelow: number;
  /** 是否启用提醒 */
  enabled: boolean;
}

/** 首页可配置的列 key */
export type ColumnKey =
  | 'symbol'
  | 'price'
  | 'change'
  | 'changePercent'
  | 'high'
  | 'low'
  | 'open'
  | 'previousClose'
  | 'volume';

/** 列定义配置 */
export const COLUMN_DEFINITIONS: { key: ColumnKey; label: string; description: string; alwaysVisible?: boolean }[] = [
  { key: 'symbol',        label: '代码',   description: '股票代码',     alwaysVisible: true },
  { key: 'price',         label: '最新价', description: '当前最新成交价' },
  { key: 'changePercent', label: '涨跌幅', description: '当日涨跌百分比' },
  { key: 'change',        label: '涨跌额', description: '当日涨跌金额' },
  { key: 'high',          label: '最高',   description: '当日最高价' },
  { key: 'low',           label: '最低',   description: '当日最低价' },
  { key: 'open',          label: '今开',   description: '今日开盘价' },
  { key: 'previousClose', label: '昨收',   description: '昨日收盘价' },
  { key: 'volume',        label: '成交量', description: '当日成交量（股）' },
];

/** 默认显示的列 */
export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = [
  'symbol', 'price', 'changePercent', 'change', 'high', 'low', 'open', 'previousClose',
];

/** 数据刷新频率（单位：秒），可选值：10 / 60 / 300 / 600 / 1800 */
export type RefreshInterval = 10 | 60 | 300 | 600 | 1800;

/** 刷新频率选项配置 */
export const REFRESH_INTERVAL_OPTIONS: { value: RefreshInterval; label: string; description: string }[] = [
  { value: 10,   label: '10 秒',  description: '高频，适合盯盘' },
  { value: 60,   label: '1 分钟', description: '较高频，实时性强' },
  { value: 300,  label: '5 分钟', description: '默认，平衡实时性与 API 用量' },
  { value: 600,  label: '10 分钟', description: '低频，节省 API 配额' },
  { value: 1800, label: '30 分钟', description: '最低频，适合长线观察' },
];

/** 首页报价缓存快照，用于冷启动时先展示当天缓存数据 */
export interface QuotesCache {
  /** 缓存日期，格式 YYYY-MM-DD */
  date: string;
  /** symbol → Quote 的快照 */
  quotes: Record<string, Quote>;
}

/** 获取今天的日期字符串，格式 YYYY-MM-DD */
export const getTodayDateString = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

interface StockState {
  watchlist: string[];
  quotes: Record<string, Quote>;
  /** symbol → 公司名称的映射，添加股票时从搜索结果保存，持久化到 electron-store */
  symbolNames: Record<string, string>;
  loading: boolean;
  error: string | null;
  rateLimited: boolean;
  colorMode: ColorMode;
  refreshInterval: RefreshInterval;
  alertThresholds: Record<string, AlertThreshold>;
  visibleColumns: ColumnKey[];

  // Actions
  addToWatchlist: (symbol: string) => Promise<void>;
  removeFromWatchlist: (symbol: string) => Promise<void>;
  /** 保存 symbol 对应的公司名称（从搜索结果的 description 字段获取） */
  setSymbolName: (symbol: string, name: string) => Promise<void>;
  loadSymbolNames: () => Promise<void>;
  updateQuote: (symbol: string, quote: Quote) => void;
  updateQuotes: (quotes: Quote[]) => void;
  loadWatchlist: () => Promise<void>;
  saveWatchlist: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setRateLimited: (limited: boolean) => void;
  setColorMode: (mode: ColorMode) => Promise<void>;
  loadColorMode: () => Promise<void>;
  setRefreshInterval: (interval: RefreshInterval) => Promise<void>;
  loadRefreshInterval: () => Promise<void>;
  setAlertThreshold: (threshold: AlertThreshold) => Promise<void>;
  removeAlertThreshold: (symbol: string) => Promise<void>;
  loadAlertThresholds: () => Promise<void>;
  setVisibleColumns: (columns: ColumnKey[]) => Promise<void>;
  loadVisibleColumns: () => Promise<void>;
  /** 从 electron-store 加载当天的报价缓存，若是当天则写入 quotes */
  loadQuotesCache: () => Promise<boolean>;
  /** 将当前 quotes 快照保存到 electron-store */
  saveQuotesCache: () => Promise<void>;
  /** 用户在分析页面输入的历史问题列表 */
  questions: StockQuestion[];
  /** 从 electron-store 加载历史问题 */
  loadQuestions: () => Promise<void>;
  /** 新增一条问题记录并持久化 */
  addQuestion: (symbol: string, question: string) => Promise<void>;
  /** 删除指定 id 的问题记录 */
  deleteQuestion: (id: string) => Promise<void>;
  /** 关键指数行情（上证、科创综指、纳斯达克、标普、恒生、恒生科技） */
  indices: IndexQuote[];
  /** 拉取最新指数行情，失败时静默保留上次数据 */
  fetchIndices: () => Promise<void>;
}

export const useStockStore = create<StockState>((set, get) => ({
  watchlist: [],
  quotes: {},
  symbolNames: {},
  loading: false,
  error: null,
  rateLimited: false,
  colorMode: 'cn',
  refreshInterval: 300,
  alertThresholds: {},
  visibleColumns: DEFAULT_VISIBLE_COLUMNS,
  questions: [],
  indices: [],

  setSymbolName: async (symbol: string, name: string) => {
    if (!name || !name.trim()) return;
    const updated = { ...get().symbolNames, [symbol]: name.trim() };
    set({ symbolNames: updated });
    try {
      await window.electronAPI.setStore('symbolNames', updated);
    } catch (error) {
      console.error('Failed to save symbolNames:', error);
    }
  },

  loadSymbolNames: async () => {
    try {
      const saved = await window.electronAPI.getStore('symbolNames');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        set({ symbolNames: saved as Record<string, string> });
      }
    } catch (error) {
      console.error('Failed to load symbolNames:', error);
    }
  },

  addToWatchlist: async (symbol: string) => {
    let upperSymbol = symbol.toUpperCase().trim();

    // 港股代码补全前导零到 5 位（如 3690.HK → 03690.HK）
    // 原因：yfinance 要求港股代码必须是 5 位数字 + .HK，缺少前导零会导致数据获取失败
    const hkMatch = upperSymbol.match(/^(\d{1,4})(\.HK)$/i);
    if (hkMatch) {
      upperSymbol = hkMatch[1].padStart(5, '0') + hkMatch[2].toUpperCase();
    }

    const currentWatchlist = get().watchlist;
    
    if (currentWatchlist.includes(upperSymbol)) {
      return; // Already in watchlist
    }
    
    const newWatchlist = [...currentWatchlist, upperSymbol];
    set({ watchlist: newWatchlist });
    
    // Save to electron-store
    await get().saveWatchlist();
  },
  
  removeFromWatchlist: async (symbol: string) => {
    const newWatchlist = get().watchlist.filter(s => s !== symbol);
    set({ watchlist: newWatchlist });
    
    // Remove quote data
    const newQuotes = { ...get().quotes };
    delete newQuotes[symbol];
    set({ quotes: newQuotes });
    
    // Save to electron-store
    await get().saveWatchlist();
  },
  
  updateQuote: (symbol: string, quote: Quote) => {
    set((state) => ({
      quotes: {
        ...state.quotes,
        [symbol]: quote,
      },
    }));
  },
  
  updateQuotes: (quotes: Quote[]) => {
    console.log('[STORE DEBUG] updateQuotes called with:', quotes);
    const quotesMap = quotes.reduce((acc, quote) => {
      acc[quote.symbol] = quote;
      return acc;
    }, {} as Record<string, Quote>);
    
    set((state) => {
      const newState = {
        quotes: {
          ...state.quotes,
          ...quotesMap,
        },
      };
      console.log('[STORE DEBUG] New quotes state:', newState.quotes);
      return newState;
    });
  },
  
  loadWatchlist: async () => {
    try {
      const saved = await window.electronAPI.getStore('watchlist');
      if (Array.isArray(saved)) {
        set({ watchlist: saved });
      }
    } catch (error) {
      console.error('Failed to load watchlist:', error);
    }
  },
  
  saveWatchlist: async () => {
    try {
      await window.electronAPI.setStore('watchlist', get().watchlist);
    } catch (error) {
      console.error('Failed to save watchlist:', error);
    }
  },
  
  setLoading: (loading: boolean) => {
    set({ loading });
  },
  
  setError: (error: string | null) => {
    set({ error });
  },
  
  setRateLimited: (limited: boolean) => {
    set({ rateLimited: limited });
  },

  setColorMode: async (mode: ColorMode) => {
    set({ colorMode: mode });
    try {
      await window.electronAPI.setStore('colorMode', mode);
    } catch (error) {
      console.error('Failed to save colorMode:', error);
    }
  },

  loadColorMode: async () => {
    try {
      const saved = await window.electronAPI.getStore('colorMode');
      if (saved === 'cn' || saved === 'us') {
        set({ colorMode: saved });
      }
    } catch (error) {
      console.error('Failed to load colorMode:', error);
    }
  },

  setRefreshInterval: async (interval: RefreshInterval) => {
    set({ refreshInterval: interval });
    try {
      await window.electronAPI.setStore('refreshInterval', interval);
    } catch (error) {
      console.error('Failed to save refreshInterval:', error);
    }
  },

  loadRefreshInterval: async () => {
    try {
      // v2 迁移：旧版本默认值是 10 秒，新版本默认 5 分钟（300 秒）
      // 通过 refreshIntervalMigrated 标记区分"旧默认值 10"和"用户主动选择 10"
      const migrated = await window.electronAPI.getStore('refreshIntervalMigrated');
      if (!migrated) {
        // 首次迁移：忽略旧存储值，写入新默认值并标记已迁移
        set({ refreshInterval: 300 });
        await window.electronAPI.setStore('refreshInterval', 300);
        await window.electronAPI.setStore('refreshIntervalMigrated', true);
        return;
      }
      const saved = await window.electronAPI.getStore('refreshInterval');
      if (saved === 10 || saved === 60 || saved === 300 || saved === 600 || saved === 1800) {
        set({ refreshInterval: saved });
      } else {
        set({ refreshInterval: 300 });
      }
    } catch (error) {
      console.error('Failed to load refreshInterval:', error);
    }
  },

  setAlertThreshold: async (threshold: AlertThreshold) => {
    const current = get().alertThresholds;
    const updated = { ...current, [threshold.symbol]: threshold };
    set({ alertThresholds: updated });
    try {
      await window.electronAPI.setStore('alertThresholds', updated);
    } catch (error) {
      console.error('Failed to save alertThresholds:', error);
    }
  },

  removeAlertThreshold: async (symbol: string) => {
    const current = { ...get().alertThresholds };
    delete current[symbol];
    set({ alertThresholds: current });
    try {
      await window.electronAPI.setStore('alertThresholds', current);
    } catch (error) {
      console.error('Failed to save alertThresholds:', error);
    }
  },

  loadAlertThresholds: async () => {
    try {
      const saved = await window.electronAPI.getStore('alertThresholds');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        set({ alertThresholds: saved as Record<string, AlertThreshold> });
      }
    } catch (error) {
      console.error('Failed to load alertThresholds:', error);
    }
  },

  setVisibleColumns: async (columns: ColumnKey[]) => {
    // 始终保证 symbol 列可见
    const withSymbol: ColumnKey[] = columns.includes('symbol') ? columns : ['symbol' as ColumnKey, ...columns];
    set({ visibleColumns: withSymbol });
    try {
      await window.electronAPI.setStore('visibleColumns', withSymbol);
    } catch (error) {
      console.error('Failed to save visibleColumns:', error);
    }
  },

  loadVisibleColumns: async () => {
    try {
      const saved = await window.electronAPI.getStore('visibleColumns');
      if (Array.isArray(saved) && saved.length > 0) {
        set({ visibleColumns: saved as ColumnKey[] });
      }
    } catch (error) {
      console.error('Failed to load visibleColumns:', error);
    }
  },

  loadQuotesCache: async () => {
    try {
      const saved = await window.electronAPI.getStore('quotesCache');
      if (
        saved &&
        typeof saved === 'object' &&
        !Array.isArray(saved) &&
        typeof (saved as QuotesCache).date === 'string' &&
        typeof (saved as QuotesCache).quotes === 'object'
      ) {
        const cache = saved as QuotesCache;
        const isToday = cache.date === getTodayDateString();
        if (isToday && Object.keys(cache.quotes).length > 0) {
          set({ quotes: cache.quotes });
          return true;
        }
      }
    } catch (error) {
      console.error('Failed to load quotesCache:', error);
    }
    return false;
  },

  saveQuotesCache: async () => {
    try {
      const cache: QuotesCache = {
        date: getTodayDateString(),
        quotes: get().quotes,
      };
      await window.electronAPI.setStore('quotesCache', cache);
    } catch (error) {
      console.error('Failed to save quotesCache:', error);
    }
  },

  loadQuestions: async () => {
    try {
      const saved = await window.electronAPI.getStore('stockQuestions');
      if (Array.isArray(saved)) {
        set({ questions: saved as StockQuestion[] });
      }
    } catch (error) {
      console.error('Failed to load questions:', error);
    }
  },

  addQuestion: async (symbol: string, question: string) => {
    const newQuestion: StockQuestion = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      symbol: symbol.toUpperCase(),
      question: question.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [newQuestion, ...get().questions];
    set({ questions: updated });
    try {
      await window.electronAPI.setStore('stockQuestions', updated);
    } catch (error) {
      console.error('Failed to save questions:', error);
    }
  },

  deleteQuestion: async (id: string) => {
    const updated = get().questions.filter((q) => q.id !== id);
    set({ questions: updated });
    try {
      await window.electronAPI.setStore('stockQuestions', updated);
    } catch (error) {
      console.error('Failed to delete question:', error);
    }
  },

  fetchIndices: async () => {
    try {
      console.log('[INDICES DEBUG] fetchIndices: Calling window.electronAPI.getIndices()');
      const rawJson = await window.electronAPI.getIndices();
      console.log('[INDICES DEBUG] fetchIndices: Raw JSON response:', rawJson);
      
      // 从 rawJson 中提取最后一个完整 JSON 数组（防止 AKShare tqdm 进度条污染 stdout）
      const jsonMatch = rawJson.match(/(\[[\s\S]*\])\s*$/);
      const cleanJson = jsonMatch ? jsonMatch[1] : rawJson;
      console.log('[INDICES DEBUG] fetchIndices: Clean JSON:', cleanJson);
      
      const parsed = JSON.parse(cleanJson);
      console.log('[INDICES DEBUG] fetchIndices: Parsed result:', parsed);
      console.log('[INDICES DEBUG] fetchIndices: Is array?', Array.isArray(parsed));
      
      if (Array.isArray(parsed)) {
        console.log('[INDICES DEBUG] fetchIndices: Updating indices with', parsed.length, 'items');
        set({ indices: parsed as IndexQuote[] });
      } else {
        console.warn('[INDICES DEBUG] fetchIndices: Parsed result is not an array!', typeof parsed);
      }
    } catch (error) {
      // 静默失败：保留上次数据，不影响主流程
      console.error('[INDICES DEBUG] fetchIndices: Failed with error:', error);
    }
  },
}));
