import { create } from 'zustand';
import type { Quote, Conversation, ConversationMessage, IndexQuote, UserProfile } from '@/types';

/** 随机 emoji 头像池 */
const EMOJI_AVATAR_POOL = ['🐯', '🦊', '🐼', '🐨', '🦁', '🐸', '🦄', '🐙', '🦋', '🐬'];
/** 随机用户名池 */
const USERNAME_POOL = ['投资达人', '股市老手', '价值猎手', '趋势追踪者', '量化先锋', '长线持有者', '波段高手'];

/** 生成默认用户资料（随机 emoji + 随机用户名） */
const generateDefaultUserProfile = (): UserProfile => ({
  username: USERNAME_POOL[Math.floor(Math.random() * USERNAME_POOL.length)],
  emojiAvatar: EMOJI_AVATAR_POOL[Math.floor(Math.random() * EMOJI_AVATAR_POOL.length)],
});

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
  /** 更新 watchlist 顺序 */
  updateWatchlistOrder: (newOrder: string[]) => Promise<void>;
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
  /** 历史对话列表（按 updatedAt 倒序） */
  conversations: Conversation[];
  /** 当前激活的对话 ID */
  activeConversationId: string | null;
  /** 从 electron-store 加载历史对话 */
  loadConversations: () => Promise<void>;
  /** 创建一条新对话，返回新对话 ID */
  createConversation: (symbol?: string) => Promise<string>;
  /** 向指定对话追加一条消息 */
  appendMessage: (conversationId: string, message: Omit<ConversationMessage, 'id' | 'createdAt'>) => Promise<ConversationMessage>;
  /** 删除指定 id 的对话 */
  deleteConversation: (id: string) => Promise<void>;
  /** 设置当前激活的对话 ID */
  setActiveConversationId: (id: string | null) => void;
  /** 关键指数行情（上证、科创综指、纳斯达克、标普、恒生、恒生科技） */
  indices: IndexQuote[];
  /** 拉取最新指数行情，失败时静默保留上次数据 */
  fetchIndices: () => Promise<void>;
  /** 用户个人资料（头像 + 用户名） */
  userProfile: UserProfile;
  /** 从 electron-store 加载用户资料，若无则生成随机默认值 */
  loadUserProfile: () => Promise<void>;
  /** 保存用户资料到 electron-store */
  saveUserProfile: (profile: UserProfile) => Promise<void>;
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
  conversations: [],
  activeConversationId: null,
  indices: [],
  userProfile: generateDefaultUserProfile(),

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
  
  updateWatchlistOrder: async (newOrder: string[]) => {
    set({ watchlist: newOrder });
    
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
    const quotesMap = quotes.reduce((acc, quote) => {
      acc[quote.symbol] = quote;
      return acc;
    }, {} as Record<string, Quote>);
    
    set((state) => ({
      quotes: {
        ...state.quotes,
        ...quotesMap,
      },
    }));
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
        const quoteList = Object.values(cache.quotes);

        // 字段完整性校验：旧版本缓存不含 high/low/open/previousClose 字段，
        // 直接丢弃，触发首次刷新拿到完整字段，避免用户长时间看到 — 占位符。
        const hasExtendedFields = quoteList.some(
          (q) =>
            q &&
            (q.high !== undefined ||
              q.low !== undefined ||
              q.open !== undefined ||
              q.previousClose !== undefined),
        );

        if (isToday && quoteList.length > 0 && hasExtendedFields) {
          set({ quotes: cache.quotes });
          return true;
        }

        // 缓存无效（过期 / 字段不全），主动清掉防止下次再误用
        if (quoteList.length > 0 && !hasExtendedFields) {
          await window.electronAPI.setStore('quotesCache', null);
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

  loadConversations: async () => {
    try {
      const saved = await window.electronAPI.getStore('conversations');
      if (Array.isArray(saved)) {
        set({ conversations: saved as Conversation[] });
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  },

  createConversation: async (symbol?: string) => {
    const now = new Date().toISOString();
    const newConversation: Conversation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: '新对话',
      symbol: symbol ? symbol.toUpperCase() : undefined,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    const updated = [newConversation, ...get().conversations];
    set({ conversations: updated, activeConversationId: newConversation.id });
    try {
      await window.electronAPI.setStore('conversations', updated);
    } catch (error) {
      console.error('Failed to save conversations:', error);
    }
    return newConversation.id;
  },

  appendMessage: async (conversationId: string, messageData: Omit<ConversationMessage, 'id' | 'createdAt'>) => {
    const now = new Date().toISOString();
    const newMessage: ConversationMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ...messageData,
      createdAt: now,
    };

    const updated = get().conversations.map((conv) => {
      if (conv.id !== conversationId) return conv;

      const updatedMessages = [...conv.messages, newMessage];
      // 第一条用户消息作为对话标题
      const firstUserMessage = updatedMessages.find((m) => m.role === 'user');
      const title = firstUserMessage
        ? firstUserMessage.content.slice(0, 20) + (firstUserMessage.content.length > 20 ? '…' : '')
        : conv.title;

      return { ...conv, messages: updatedMessages, title, updatedAt: now };
    });

    // 将更新后的 conversation 移到列表最前面（最新活跃在前）
    const targetIndex = updated.findIndex((c) => c.id === conversationId);
    if (targetIndex > 0) {
      const [target] = updated.splice(targetIndex, 1);
      updated.unshift(target);
    }

    set({ conversations: updated });
    try {
      await window.electronAPI.setStore('conversations', updated);
    } catch (error) {
      console.error('Failed to save conversations:', error);
    }
    return newMessage;
  },

  deleteConversation: async (id: string) => {
    const updated = get().conversations.filter((c) => c.id !== id);
    const activeId = get().activeConversationId;
    set({
      conversations: updated,
      activeConversationId: activeId === id ? (updated[0]?.id ?? null) : activeId,
    });
    try {
      await window.electronAPI.setStore('conversations', updated);
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  },

  loadUserProfile: async () => {
    try {
      const saved = await window.electronAPI.getStore('userProfile');
      if (saved && typeof saved === 'object') {
        set({ userProfile: saved as UserProfile });
      } else {
        // 首次使用：生成随机默认值并持久化
        const defaultProfile = generateDefaultUserProfile();
        set({ userProfile: defaultProfile });
        await window.electronAPI.setStore('userProfile', defaultProfile);
      }
    } catch (error) {
      console.error('Failed to load userProfile:', error);
    }
  },

  saveUserProfile: async (profile: UserProfile) => {
    set({ userProfile: profile });
    try {
      await window.electronAPI.setStore('userProfile', profile);
    } catch (error) {
      console.error('Failed to save userProfile:', error);
    }
  },

  setActiveConversationId: (id: string | null) => {
    set({ activeConversationId: id });
  },

  fetchIndices: async () => {
    try {
      // ⚠️ 必须走 IPC 让主进程（Node fetch）发起请求：
      // 渲染进程（Chromium）直接 fetch 东方财富会被 CORS 拦截
      // （东方财富不返回 Access-Control-Allow-Origin，且 User-Agent / Referer 在浏览器中是 unsafe header）
      console.log('[fetchIndices] 调用 window.electronAPI.getIndices()');
      const raw = await window.electronAPI.getIndices();
      const rawStr = String(raw ?? '');
      console.log('[fetchIndices] 主进程原始返回（前 500 字符）:', rawStr.slice(0, 500));

      const parsed: unknown = JSON.parse(rawStr);

      // 兼容三种返回形态：
      //   1. 数组 IndexQuote[]                         （东方财富/Python 正常路径）
      //   2. { error, message }                        （Python execFile 失败的降级返回）
      //   3. { indices: IndexQuote[] }                 （历史/兜底封装格式）
      let result: IndexQuote[] | null = null;
      if (Array.isArray(parsed)) {
        result = parsed as IndexQuote[];
      } else if (parsed && typeof parsed === 'object' && 'indices' in parsed
                 && Array.isArray((parsed as { indices: unknown }).indices)) {
        result = (parsed as { indices: IndexQuote[] }).indices;
      } else if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        console.warn('[fetchIndices] 主进程返回错误:', parsed);
      } else {
        console.warn('[fetchIndices] 主进程返回未知格式:', parsed);
      }

      if (result && result.length > 0) {
        console.log('[fetchIndices] 解析得到', result.length, '个指数:',
                    result.map((r) => `${r.symbol}=${r.price}`).join(', '));
        set({ indices: result });
      } else {
        console.warn('[fetchIndices] 解析后无有效指数数据，indices 保持不变');
      }
    } catch (err) {
      // 静默失败：保留上次数据，不影响主流程
      console.error('[fetchIndices] 失败:', err);
    }
  },
}));
