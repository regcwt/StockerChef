import { useState, useEffect, useRef } from 'react';
import { Input, Button, Spin, Alert, Typography, Space, Tag, Modal, InputNumber, Switch, Tooltip } from 'antd';
import {
  SearchOutlined,
  LoadingOutlined,
  ReloadOutlined,
  PlusOutlined,
  RiseOutlined,
  FallOutlined,
  BellOutlined,
  BellFilled,
  DeleteOutlined,
} from '@ant-design/icons';
import { useStockStore, getChangeColors, COLUMN_DEFINITIONS } from '@/store/useStockStore';
import type { AlertThreshold, ColumnKey } from '@/store/useStockStore';
import { getQuoteDirect, searchSymbol, handleAPIError, isCNStock, isHKStock, searchCNSymbol } from '@/services/stockApi';
import type { SearchResult, Quote } from '@/types';
import { formatPrice, formatPercent } from '@/utils/format';

const { Title, Text } = Typography;

/** 实时日期时间组件，每秒更新，上下布局展示在标题旁 */
function CurrentDateTime() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
      <Text style={{ fontSize: 13, fontWeight: 600, color: '#4a5a78', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {dateStr}
      </Text>
      <Text style={{ fontSize: 11, color: '#8c9ab0', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {timeStr}
      </Text>
    </div>
  );
}

interface DashboardProps {
  onStockClick: (symbol: string) => void;
  onNavigateToSettings?: () => void;
}

/** 格式化成交量：超过 1 亿显示 X.XX 亿，超过 1 万显示 X.XX 万 */
const formatVolume = (volume?: number): string => {
  if (!volume) return '—';
  if (volume >= 1_0000_0000) return `${(volume / 1_0000_0000).toFixed(2)}亿`;
  if (volume >= 1_0000) return `${(volume / 1_0000).toFixed(2)}万`;
  return volume.toLocaleString();
};

/**
 * 判断 quote 是否为"无数据占位"（price 为 0 且 change 为 0）
 * 用于区分"数据获取失败/不支持"和"真实零价格"（后者在实际场景中不存在）
 */
const isPlaceholderQuote = (quote: Quote): boolean =>
  quote.price === 0 && quote.change === 0 && quote.changePercent === 0;

/** 根据 columnKey 从 quote 中取对应的显示值 */
const getCellValue = (key: ColumnKey, symbol: string, quote: Quote | undefined): string => {
  if (!quote) return '—';
  // 占位 quote（数据获取失败）：symbol 列正常显示，其他列显示 —
  if (key !== 'symbol' && isPlaceholderQuote(quote)) return '—';
  switch (key) {
    case 'symbol':        return symbol;
    case 'price':         return formatPrice(quote.price);
    case 'change':        return quote.change >= 0 ? `+${formatPrice(quote.change)}` : formatPrice(quote.change);
    case 'changePercent': return formatPercent(quote.changePercent);
    case 'high':          return formatPrice(quote.high ?? 0);
    case 'low':           return formatPrice(quote.low ?? 0);
    case 'open':          return formatPrice(quote.open ?? 0);
    case 'previousClose': return formatPrice(quote.previousClose ?? 0);
    case 'volume':        return formatVolume(quote.volume);
    default:              return '—';
  }
};

/** 判断某列是否应该用涨跌色着色 */
const isChangeColumn = (key: ColumnKey): boolean =>
  key === 'change' || key === 'changePercent';

const Dashboard = ({ onStockClick }: DashboardProps) => {
  const {
    watchlist, quotes, symbolNames, error, rateLimited,
    setRateLimited, setError, colorMode, refreshInterval,
    alertThresholds, visibleColumns, indices, fetchIndices,
  } = useStockStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // 是否正在从缓存恢复后的后台刷新（区别于用户手动刷新）
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);

  // 预置股票数据缓存（用于本地快速搜索）
  const [presetStocks, setPresetStocks] = useState<{
    cn: Array<{symbol: string; name: string; pinyinInitials: string; market: string}>;
    hk: Array<{symbol: string; name: string; pinyinInitials: string; market: string}>;
    us: Array<{symbol: string; name: string; market: string}>;
  }>({ cn: [], hk: [], us: [] });

  // 组件挂载时加载预置股票数据
  useEffect(() => {
    const loadPresetData = async () => {
      try {
        const [cnData, hkData, usData] = await Promise.all([
          window.electronAPI.getPresetStockData('cn'),
          window.electronAPI.getPresetStockData('hk'),
          window.electronAPI.getPresetStockData('us'),
        ]);
        
        setPresetStocks({
          cn: JSON.parse(cnData),
          hk: JSON.parse(hkData),
          us: JSON.parse(usData),
        });
      } catch (err) {
        console.error('[Preset Stocks] 加载失败:', err);
      }
    };
    loadPresetData();
  }, []);

  // 阈值提醒弹窗状态
  const [alertModalSymbol, setAlertModalSymbol] = useState<string | null>(null);
  const [alertForm, setAlertForm] = useState<Partial<AlertThreshold>>({});

  // 记录已触发过的提醒，避免同一条件重复通知（key: symbol-type）
  const triggeredAlertsRef = useRef<Set<string>>(new Set());

  // init 完成标记：用 state 而非 ref，确保 interval useEffect 能感知到变化并重新执行
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const initDashboard = async () => {
      await useStockStore.getState().loadWatchlist();
      await useStockStore.getState().loadSymbolNames();
      await useStockStore.getState().loadColorMode();
      await useStockStore.getState().loadRefreshInterval();
      await useStockStore.getState().loadAlertThresholds();
      await useStockStore.getState().loadVisibleColumns();

      // 先加载当天缓存展示，同时触发后台刷新
      const hasTodayCache = await useStockStore.getState().loadQuotesCache();
      if (hasTodayCache) {
        setBackgroundRefreshing(true);
      }

      // init 完成，触发 interval useEffect 启动
      setInitialized(true);

      // 指数数据不依赖 watchlist，在 init 完成后立即触发首次加载
      // 原因：useEffect 的 initialized 守卫会在下一个 render 周期才执行，
      // 而 initDashboard 里直接调用可以确保首次加载立即发起
      console.log('[INDICES DEBUG] Dashboard: Calling fetchIndices from initDashboard');
      useStockStore.getState().fetchIndices();
    };
    initDashboard();
  }, []);

  /** 检查单只股票的报价是否触发阈值，触发则发送系统通知 */
  const checkAlertThreshold = (symbol: string, quote: Quote) => {
    const threshold = alertThresholds[symbol];
    if (!threshold || !threshold.enabled) return;

    const { priceAbove, priceBelow, changeAbove, changeBelow } = threshold;
    const price = quote.price;
    const changePct = quote.changePercent;

    const notify = (key: string, title: string, body: string) => {
      if (triggeredAlertsRef.current.has(key)) return;
      triggeredAlertsRef.current.add(key);
      window.electronAPI.showNotification(title, body);
      setTimeout(() => triggeredAlertsRef.current.delete(key), 5 * 60 * 1000);
    };

    if (priceAbove !== undefined && price >= priceAbove) {
      notify(`${symbol}-priceAbove`, `📈 ${symbol} 价格提醒`, `当前价格 ${price.toFixed(2)} 已超过设定上限 ${priceAbove}`);
    }
    if (priceBelow !== undefined && price <= priceBelow) {
      notify(`${symbol}-priceBelow`, `📉 ${symbol} 价格提醒`, `当前价格 ${price.toFixed(2)} 已低于设定下限 ${priceBelow}`);
    }
    if (changePct >= changeAbove) {
      notify(`${symbol}-changeAbove`, `🚀 ${symbol} 涨幅提醒`, `今日涨幅 +${changePct.toFixed(2)}% 已超过设定上限 +${changeAbove}%`);
    }
    if (changePct <= changeBelow) {
      notify(`${symbol}-changeBelow`, `⚠️ ${symbol} 跌幅提醒`, `今日跌幅 ${changePct.toFixed(2)}% 已超过设定下限 ${changeBelow}%`);
    }
  };

  const fetchAllQuotes = async () => {
    if (watchlist.length === 0) return;
    setRefreshing(true);
    setError(null);
    try {
      // 将 watchlist 按 A 股 / 港股 / 美股分组
      const cnSymbols = watchlist.filter(isCNStock);
      const hkSymbols = watchlist.filter(isHKStock);
      const usSymbols = watchlist.filter((s) => !isCNStock(s) && !isHKStock(s));

      // A 股：批量通过 AKShare 获取（一次调用）
      const cnQuotePromise: Promise<Quote[]> = cnSymbols.length > 0
        ? (async () => {
            try {
              const rawJson = await window.electronAPI.getCNQuote(cnSymbols.join(','));
              const parsed = JSON.parse(rawJson);
              if (Array.isArray(parsed)) {
                // 顺便保存公司名称（A 股行情数据里有 name 字段）
                parsed.forEach((item: any) => {
                  if (item.symbol && item.name && item.name !== item.symbol) {
                    useStockStore.getState().setSymbolName(item.symbol, item.name);
                  }
                });
                return parsed.map((item: any): Quote => ({
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
                }));
              }
            } catch {
              // AKShare 不可用时静默跳过
            }
            return [];
          })()
        : Promise.resolve([]);

      // 港股：通过 AKShare 获取（一次调用，支持 XXXXX.HK 格式）
      // 加 90 秒超时兜底：AKShare 港股首次调用需要缓存全量数据（约 2745 只），耗时约 55 秒
      // 后续调用会使用缓存，速度会快很多
      const hkQuotePromise: Promise<Quote[]> = hkSymbols.length > 0
        ? Promise.race([
            (async () => {
              console.log('[HK DEBUG] Fetching HK quotes for symbols:', hkSymbols);
              try {
                const rawJson = await window.electronAPI.getHKQuote(hkSymbols.join(','));
                console.log('[HK DEBUG] Raw JSON response:', rawJson);
                const parsed = JSON.parse(rawJson);
                console.log('[HK DEBUG] Parsed result:', parsed);
                console.log('[HK DEBUG] Is array?', Array.isArray(parsed));
                if (Array.isArray(parsed)) {
                  // 顺便保存公司名称（港股行情数据里有 name 字段，stock_hk_spot 返回中文名）
                  parsed.forEach((item: any) => {
                    if (item.symbol && item.name && item.name !== item.symbol) {
                      useStockStore.getState().setSymbolName(item.symbol, item.name);
                    }
                  });
                  return parsed.map((item: any): Quote => ({
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
                  }));
                }
              } catch (err) {
                console.error('[HK DEBUG] Error fetching HK quotes:', err);
                // AKShare 不可用时静默跳过
              }
              return [] as Quote[];
            })(),
            new Promise<Quote[]>((resolve) => setTimeout(() => resolve([]), 90000)),
          ])
        : Promise.resolve([]);

      // 美股：直接并发请求（不走限流队列），多只股票同时发出，大幅缩短刷新时间
      // Finnhub 免费层 60次/分钟，10只以内自选股并发完全安全
      const usQuotePromises = usSymbols.map(async (symbol) => {
        try {
          return await getQuoteDirect(symbol);
        } catch (err: any) {
          if (err.response?.status === 429) {
            setRateLimited(true);
            setTimeout(() => setRateLimited(false), 60000);
          }
          return null;
        }
      });

      const [cnQuotes, hkQuotes, ...usResults] = await Promise.all([cnQuotePromise, hkQuotePromise, ...usQuotePromises]);
      const validQuotes = [...cnQuotes, ...hkQuotes, ...usResults.filter((q): q is Quote => q !== null)];
      console.log('[HK DEBUG] Valid quotes to update:', validQuotes);
      console.log('[HK DEBUG] HK quotes array:', hkQuotes);
      useStockStore.getState().updateQuotes(validQuotes);
      validQuotes.forEach((quote) => checkAlertThreshold(quote.symbol, quote));

      // 持久化有效报价到 electron-store（仅缓存 price > 0 的真实数据，避免占位 quote 污染缓存）
      // 下次启动时 loadQuotesCache() 会恢复，A 股/港股无需等待 Python 脚本重新加载
      if (validQuotes.some((q) => q.price > 0)) {
        useStockStore.getState().saveQuotesCache();
      }

      // 对本次刷新后仍无数据的 symbol 写入空占位 quote，避免 UI 无限 loading
      // 场景：港股 yfinance 限流、A 股 AKShare 不可用、Finnhub Key 缺失等
      const fetchedSymbols = new Set(validQuotes.map((q) => q.symbol));
      const currentQuotes = useStockStore.getState().quotes;
      const placeholderQuotes: Quote[] = watchlist
        .filter((s) => !fetchedSymbols.has(s) && currentQuotes[s] === undefined)
        .map((s): Quote => ({
          symbol: s,
          price: 0,
          change: 0,
          changePercent: 0,
          timestamp: new Date().toISOString(),
        }));
      if (placeholderQuotes.length > 0) {
        useStockStore.getState().updateQuotes(placeholderQuotes);
      }
    } catch (err: any) {
      setError(handleAPIError(err));
    } finally {
      setRefreshing(false);
      setBackgroundRefreshing(false);
    }
  };

  useEffect(() => {
    // 守卫：init 未完成时不启动刷新
    // 原因：initDashboard 异步加载 watchlist/refreshInterval 时，每次 store 状态变化都会触发本 useEffect
    // 加守卫后，只有 init 完成（initialized=true）后才会真正启动刷新和 interval
    if (!initialized) return;
    fetchAllQuotes();
    const interval = setInterval(fetchAllQuotes, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [initialized, watchlist, refreshInterval]);

  // 指数刷新独立 useEffect：不依赖 watchlist，只跟随 refreshInterval
  // 原因：指数是预设固定列表，与自选股无关，不应因 watchlist 变化而重复触发
  useEffect(() => {
    if (!initialized) return;
    console.log('[INDICES DEBUG] Dashboard: Calling fetchIndices from interval useEffect');
    fetchIndices();
    const interval = setInterval(fetchIndices, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [initialized, refreshInterval]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query || query.length < 1) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const trimmed = query.trim().toUpperCase();

      // 港股格式识别：X.HK / XXXX.HK / XXXXX.HK（本地即时，零网络延迟）
      // 用户输入 3690.HK 或 03690.HK 时立即给出结果，无需任何 API
      if (isHKStock(trimmed) || /^\d{1,6}\.HK$/i.test(trimmed)) {
        // 补全前导零到 5 位，与 addToWatchlist 保持一致
        const hkMatch = trimmed.match(/^(\d+)(\.HK)$/i);
        const normalizedSymbol = hkMatch
          ? hkMatch[1].padStart(5, '0') + '.HK'
          : trimmed;
        
        // 尝试从预置数据中获取名称
        const hkStock = presetStocks.hk.find(s => s.symbol === normalizedSymbol);
        setSearchResults([{
          symbol: normalizedSymbol,
          displaySymbol: normalizedSymbol,
          description: hkStock?.name || '港股',
          type: 'HK',
        }]);
        return;
      }

      // A 股搜索：纯数字 或 包含中文字符 → 优先使用预置数据（快）
      const isCNQuery = /^\d+$/.test(query) || /[\u4e00-\u9fa5]/.test(query);
      if (isCNQuery) {
        // 先搜索预置数据
        const presetResults = searchPresetStocks(query);
        if (presetResults.length > 0) {
          setSearchResults(presetResults);
          setSearching(false);
          return;
        }
        // 预置数据未找到，降级为 AKShare 搜索
        const results = await searchCNSymbol(query);
        setSearchResults(results.slice(0, 5));
        return;
      }

      // 美股搜索：优先使用预置数据
      // 先搜索预置数据
      const presetResults = searchPresetStocks(query);
      if (presetResults.length > 0) {
        setSearchResults(presetResults);
        setSearching(false);
        return;
      }
      
      // 预置数据未找到，降级为 Finnhub 搜索
      const results = await searchSymbol(query);
      setSearchResults(results.slice(0, 5));
    } catch (err: any) {
      const errorMessage = handleAPIError(err);
      if (!errorMessage.includes('API Key not configured')) {
        setError(errorMessage);
      }
    } finally {
      setSearching(false);
    }
  };

  /** 搜索预置股票数据（本地快速搜索） */
  const searchPresetStocks = (query: string): SearchResult[] => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    const results: SearchResult[] = [];
    const seen = new Set<string>(); // 去重

    // 搜索 A股
    for (const stock of presetStocks.cn) {
      const matchSymbol = stock.symbol.startsWith(trimmed);
      const matchName = stock.name.toLowerCase().includes(trimmed);
      const matchPinyin = stock.pinyinInitials?.toLowerCase().includes(trimmed) || false;
      
      if (matchSymbol || matchName || matchPinyin) {
        if (!seen.has(stock.symbol)) {
          seen.add(stock.symbol);
          results.push({
            symbol: stock.symbol,
            displaySymbol: stock.symbol,
            description: stock.name,
            type: 'A股',
          });
        }
      }
      if (results.length >= 10) break; // 限制数量
    }

    // 搜索港股
    for (const stock of presetStocks.hk) {
      const matchSymbol = stock.symbol.toLowerCase().startsWith(trimmed);
      const matchName = stock.name.toLowerCase().includes(trimmed);
      const matchPinyin = stock.pinyinInitials?.toLowerCase().includes(trimmed) || false;
      
      if (matchSymbol || matchName || matchPinyin) {
        if (!seen.has(stock.symbol)) {
          seen.add(stock.symbol);
          results.push({
            symbol: stock.symbol,
            displaySymbol: stock.symbol,
            description: stock.name,
            type: '港股',
          });
        }
      }
      if (results.length >= 10) break;
    }

    // 搜索美股
    for (const stock of presetStocks.us) {
      if (stock.symbol.toLowerCase().startsWith(trimmed) || stock.name.toLowerCase().includes(trimmed)) {
        if (!seen.has(stock.symbol)) {
          seen.add(stock.symbol);
          results.push({
            symbol: stock.symbol,
            displaySymbol: stock.symbol,
            description: stock.name,
            type: '美股',
          });
        }
      }
      if (results.length >= 10) break;
    }

    return results.slice(0, 5); // 最多返回 5 条
  };

  /**
   * 添加新股票后立即获取该股票的最新报价，不等待下一个 interval 周期
   * 根据 symbol 类型走对应数据源（A股→AKShare，港股→yfinance，美股→Finnhub）
   */
  const fetchSingleQuote = async (symbol: string): Promise<void> => {
    try {
      let quote: Quote | null = null;

      if (isCNStock(symbol)) {
        const rawJson = await window.electronAPI.getCNQuote(symbol);
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const item = parsed[0];
          quote = {
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
      } else if (isHKStock(symbol)) {
        const rawJson = await window.electronAPI.getHKQuote(symbol);
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const item = parsed[0];
          quote = {
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
      } else {
        quote = await getQuoteDirect(symbol);
      }

      if (quote) {
        useStockStore.getState().updateQuotes([quote]);
      } else {
        // 数据获取失败（限流/网络不通）时写入占位 quote，避免 UI 一直显示 —
        // 下一个 interval 周期会重试，占位 quote 会被真实数据覆盖
        const existingQuote = useStockStore.getState().quotes[symbol];
        if (!existingQuote) {
          useStockStore.getState().updateQuotes([{
            symbol,
            price: 0,
            change: 0,
            changePercent: 0,
            timestamp: new Date().toISOString(),
          }]);
        }
      }
    } catch {
      // 单只股票获取失败时静默跳过，不影响已有数据
    }
  };

  const handleAddStock = async (symbol: string, name?: string) => {
    await useStockStore.getState().addToWatchlist(symbol);
    // 保存公司名称（从搜索结果的 description 字段获取）
    // 注意：必须与 addToWatchlist 里的港股补全逻辑保持一致，否则 key 不匹配
    if (name && name.trim() && name !== '港股' && name !== '美股') {
      let normalizedSymbol = symbol.toUpperCase().trim();
      const hkMatch = normalizedSymbol.match(/^(\d{1,4})(\.HK)$/i);
      if (hkMatch) {
        normalizedSymbol = hkMatch[1].padStart(5, '0') + hkMatch[2].toUpperCase();
      }
      await useStockStore.getState().setSymbolName(normalizedSymbol, name.trim());
    }
    setSearchQuery('');
    setSearchResults([]);
    // 添加成功后立即获取该股票最新报价，无需等待下一个 interval 周期
    fetchSingleQuote(symbol);
  };

  const handleRemoveStock = async (symbol: string) => {
    await useStockStore.getState().removeFromWatchlist(symbol);
  };

  // 涨跌色
  const { up: upColor, down: downColor } = getChangeColors(colorMode);

  // 统计涨跌数
  const gainers = watchlist.filter((s) => (quotes[s]?.change ?? 0) >= 0).length;
  const losers = watchlist.length - gainers;

  // 列定义（只取可见列）
  const visibleColumnDefs = COLUMN_DEFINITIONS.filter((col) => visibleColumns.includes(col.key));

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* ── 页面标题栏（含右侧指数卡片）── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          {/* 左侧：标题 + 副标题 + 操作按钮 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Title level={2} style={{ margin: 0, fontWeight: 700, letterSpacing: '-0.03em', fontSize: 26, lineHeight: 1 }}>
                自选股
              </Title>
              <div style={{ width: 1, height: 28, background: 'rgba(100,120,160,0.2)', borderRadius: 1 }} />
              <CurrentDateTime />
            </div>
            <Text style={{ color: '#6b7fa8', fontSize: 13, marginTop: 2, display: 'block' }}>
              {watchlist.length} 只股票 · 每 {refreshInterval >= 60 ? `${refreshInterval / 60} 分钟` : `${refreshInterval} 秒`} 自动刷新
              {backgroundRefreshing && (
                <Tag
                  icon={<LoadingOutlined />}
                  color="processing"
                  style={{ marginLeft: 8, fontSize: 11, borderRadius: 8, padding: '0 6px' }}
                >
                  刷新中
                </Tag>
              )}
            </Text>
            {watchlist.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <Tag icon={<RiseOutlined />} color="error" style={{ borderRadius: 20, padding: '2px 12px', fontSize: 13, fontWeight: 600 }}>
                  {gainers} 涨
                </Tag>
                <Tag icon={<FallOutlined />} color="success" style={{ borderRadius: 20, padding: '2px 12px', fontSize: 13, fontWeight: 600 }}>
                  {losers} 跌
                </Tag>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => fetchAllQuotes()}
                  style={{ borderRadius: 20, fontWeight: 500 }}
                >
                  刷新
                </Button>
              </div>
            )}
          </div>

          {/* 右侧：关键指数卡片（始终展示预设 6 个，数据未到时用占位符）*/}
          {(() => {
            // 预设指数列表，顺序固定
            const PRESET_INDICES = [
              { symbol: '000001.SH', name: '上证指数' },
              { symbol: '.IXIC',     name: '纳斯达克' },
              { symbol: 'HSTECH',    name: '恒生科技' },
              { symbol: '000688.SH', name: '科创综指' },
              { symbol: 'HSI',       name: '恒生指数' },
              { symbol: '.INX',      name: '标普500'  },
            ];
            // 用 symbol 建立快速查找 map
            const indexDataMap = new Map(indices.map((idx) => [idx.symbol, idx]));

            return (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {PRESET_INDICES.map(({ symbol, name }) => {
                  const data = indexDataMap.get(symbol);
                  const hasData = !!data;
                  const isUp = hasData && data.change >= 0;
                  const indexColor = hasData ? (isUp ? upColor : downColor) : '#c0cce0';
                  const sign = hasData && isUp ? '+' : '';

                  return (
                    <div
                      key={symbol}
                      style={{
                        padding: '10px 16px',
                        borderRadius: 14,
                        background: 'rgba(255,255,255,0.7)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(79, 110, 247, 0.1)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                        minWidth: 100,
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 11, color: '#8a9cc8', fontWeight: 600, marginBottom: 4 }}>
                        {name}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: hasData ? '#0f1a2e' : '#c0cce0', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                        {hasData ? data.price.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—'}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: indexColor, marginTop: 3 }}>
                        {hasData ? (
                          <>
                            {sign}{data.change.toFixed(2)}
                            <span style={{ marginLeft: 4 }}>
                              {sign}{data.changePercent.toFixed(2)}%
                            </span>
                          </>
                        ) : '— —%'}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── 搜索栏 ── */}
      <div
        className="glass-card"
        style={{ marginBottom: 16, padding: '16px 20px', borderRadius: 16 }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Input.Search
            placeholder="搜索股票代码或名称（如 AAPL、TSLA）"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onSearch={() => {}}
            onBlur={() => setTimeout(() => setSearchResults([]), 200)}
            prefix={<SearchOutlined />}
            enterButton={
              <Button
                type="primary"
                style={{ width: 72, minWidth: 72 }}
                loading={searching}
              >
                {!searching && '添加'}
              </Button>
            }
            size="large"
          />
          {searchResults.length > 0 && (
            <div
              style={{
                background: 'rgba(255,255,255,0.95)',
                borderRadius: 12,
                border: '1px solid rgba(79, 110, 247, 0.15)',
                overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(79, 110, 247, 0.1)',
              }}
            >
              {searchResults.map((result, index) => (
                <div
                  key={result.symbol}
                  className="search-result-item"
                  onClick={() => handleAddStock(result.symbol, result.description)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    cursor: 'pointer',
                    borderBottom: index < searchResults.length - 1 ? '1px solid rgba(79, 110, 247, 0.06)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: 'linear-gradient(135deg, rgba(79,110,247,0.12), rgba(79,110,247,0.06))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 11, color: '#4f6ef7',
                      }}
                    >
                      {(result.displaySymbol || result.symbol).slice(0, 3)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#1a2e22' }}>
                        {result.displaySymbol || result.symbol}
                      </div>
                      <div style={{ fontSize: 11, color: '#7a9e8a', marginTop: 1 }}>{result.description}</div>
                    </div>
                  </div>
                  <PlusOutlined style={{ color: '#4f6ef7', fontSize: 13 }} />
                </div>
              ))}
            </div>
          )}
        </Space>
      </div>

      {/* ── 错误提示 ── */}
      {error && (
        <Alert message="错误" description={error} type="error" closable onClose={() => setError(null)}
          style={{ marginBottom: 12, borderRadius: 12 }} />
      )}
      {rateLimited && (
        <Alert message="API 限流" description="已触发 Finnhub 频率限制，约 60 秒后自动恢复。" type="warning" closable
          onClose={() => setRateLimited(false)} style={{ marginBottom: 12, borderRadius: 12 }} />
      )}

      {/* ── 行式表格 ── */}
      {watchlist.length === 0 ? (
        <div
          style={{
            textAlign: 'center', padding: '80px 24px',
            background: 'rgba(255,255,255,0.5)', borderRadius: 20,
            border: '2px dashed rgba(79, 110, 247, 0.2)',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
          <Title level={4} style={{ color: '#3d5070', marginBottom: 8 }}>自选股为空</Title>
          <Text style={{ color: '#6b7fa8' }}>在上方搜索框添加股票开始追踪</Text>
        </div>
      ) : (
        <div
          className="glass-card"
          style={{ borderRadius: 16, overflow: 'hidden' }}
        >
          {/* 表头 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: buildGridTemplate(visibleColumnDefs.map((c) => c.key)),
              padding: '10px 16px',
              background: 'rgba(79, 110, 247, 0.04)',
              borderBottom: '1px solid rgba(79, 110, 247, 0.1)',
            }}
          >
            {visibleColumnDefs.map((col) => (
              <div
                key={col.key}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#8a9cc8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  textAlign: col.key === 'symbol' ? 'left' : 'right',
                }}
              >
                {col.label}
              </div>
            ))}
            {/* 操作列 */}
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8a9cc8', textAlign: 'right' }}>操作</div>
          </div>

          {/* 数据行 */}
          {watchlist.map((symbol, rowIndex) => {
            const quote = quotes[symbol];
            // 关键调试：记录 03690.HK 的渲染数据
            if (symbol === '03690.HK') {
              console.log('[HK DEBUG RENDER] ===== 渲染 03690.HK =====');
              console.log('[HK DEBUG RENDER] Symbol:', symbol);
              console.log('[HK DEBUG RENDER] Quote:', quote);
              console.log('[HK DEBUG RENDER] Quote keys:', quote ? Object.keys(quote) : 'undefined');
              console.log('[HK DEBUG RENDER] Is placeholder?', quote ? (quote.price === 0 && quote.change === 0 && quote.changePercent === 0) : 'N/A');
              console.log('[HK DEBUG RENDER] All store quotes keys:', Object.keys(quotes));
            }
            const isPositive = quote ? quote.change >= 0 : true;
            const changeColor = isPositive ? upColor : downColor;
            const isLastRow = rowIndex === watchlist.length - 1;

            return (
              <div
                key={symbol}
                onClick={() => onStockClick(symbol)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: buildGridTemplate(visibleColumnDefs.map((c) => c.key)),
                  padding: '14px 16px',
                  borderBottom: isLastRow ? 'none' : '1px solid rgba(79, 110, 247, 0.06)',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                  alignItems: 'center',
                }}
                className="stock-row"
              >
                {visibleColumnDefs.map((col) => {
                  const value = getCellValue(col.key, symbol, quote);
                  const colored = isChangeColumn(col.key) && quote;
                  const isSymbolCol = col.key === 'symbol';

                  return (
                    <div
                      key={col.key}
                      style={{
                        fontSize: isSymbolCol ? 14 : 13,
                        fontWeight: isSymbolCol ? 700 : 500,
                        color: colored ? changeColor : isSymbolCol ? '#1a2e22' : '#3d5070',
                        textAlign: isSymbolCol ? 'left' : 'right',
                        letterSpacing: isSymbolCol ? '-0.01em' : undefined,
                      }}
                    >
                      {quote === undefined && col.key !== 'symbol' ? (
                        <Spin indicator={<LoadingOutlined style={{ fontSize: 12, color: '#4f6ef7' }} spin />} />
                      ) : isSymbolCol ? (
                        <div>
                          <div>{value}</div>
                          {symbolNames[symbol] && (
                            <div style={{ fontSize: 11, fontWeight: 400, color: '#8a9cc8', marginTop: 1 }}>
                              {symbolNames[symbol]}
                            </div>
                          )}
                        </div>
                      ) : (
                        value
                      )}
                    </div>
                  );
                })}

                {/* 操作列：铃铛 + 删除 */}
                <div
                  style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Tooltip title="设置价格提醒">
                    <div
                      onClick={() => {
                        const existing = alertThresholds[symbol];
                        setAlertForm(existing || { symbol, changeAbove: 5, changeBelow: -5, enabled: true });
                        setAlertModalSymbol(symbol);
                      }}
                      style={{
                        cursor: 'pointer',
                        color: alertThresholds[symbol]?.enabled ? '#4f6ef7' : '#c0cce0',
                        fontSize: 14, padding: 4, borderRadius: 6,
                        display: 'flex', alignItems: 'center',
                        transition: 'color 0.2s',
                      }}
                    >
                      {alertThresholds[symbol]?.enabled ? <BellFilled /> : <BellOutlined />}
                    </div>
                  </Tooltip>
                  <Tooltip title="删除">
                    <DeleteOutlined
                      onClick={() => handleRemoveStock(symbol)}
                      style={{ cursor: 'pointer', color: '#c0cce0', fontSize: 14, padding: 4, borderRadius: 6, transition: 'color 0.2s' }}
                    />
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 阈值提醒设置弹窗 ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BellFilled style={{ color: '#4f6ef7', fontSize: 16 }} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>价格提醒 · {alertModalSymbol}</span>
          </div>
        }
        open={alertModalSymbol !== null}
        onCancel={() => setAlertModalSymbol(null)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button
              danger
              onClick={async () => {
                if (alertModalSymbol) {
                  await useStockStore.getState().removeAlertThreshold(alertModalSymbol);
                  setAlertModalSymbol(null);
                }
              }}
              style={{ borderRadius: 10 }}
            >
              删除提醒
            </Button>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => setAlertModalSymbol(null)} style={{ borderRadius: 10 }}>取消</Button>
              <Button
                type="primary"
                onClick={async () => {
                  if (!alertModalSymbol) return;
                  await useStockStore.getState().setAlertThreshold({
                    symbol: alertModalSymbol,
                    priceAbove: alertForm.priceAbove,
                    priceBelow: alertForm.priceBelow,
                    changeAbove: alertForm.changeAbove ?? 5,
                    changeBelow: alertForm.changeBelow ?? -5,
                    enabled: alertForm.enabled ?? true,
                  });
                  setAlertModalSymbol(null);
                }}
                style={{ borderRadius: 10, background: 'linear-gradient(135deg, #4f6ef7, #6b84f8)', border: 'none' }}
              >
                保存
              </Button>
            </div>
          </div>
        }
        width={440}
        styles={{ body: { padding: '20px 24px' } }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', background: 'rgba(79, 110, 247, 0.04)',
              borderRadius: 12, border: '1px solid rgba(79, 110, 247, 0.1)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#0f1a2e' }}>启用提醒</div>
              <div style={{ fontSize: 12, color: '#6b7fa8', marginTop: 2 }}>开启后满足条件时发送系统通知</div>
            </div>
            <Switch
              checked={alertForm.enabled ?? true}
              onChange={(checked) => setAlertForm((prev) => ({ ...prev, enabled: checked }))}
              style={{ background: alertForm.enabled ? '#4f6ef7' : undefined }}
            />
          </div>

          <div style={{ padding: '16px 18px', background: 'rgba(255,255,255,0.6)', borderRadius: 12, border: '1px solid rgba(79, 110, 247, 0.1)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#0f1a2e', marginBottom: 14 }}>📊 涨跌幅提醒（默认 ±5%）</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#6b7fa8', marginBottom: 6 }}>涨幅超过（%）</div>
                <InputNumber
                  value={alertForm.changeAbove ?? 5}
                  onChange={(val) => setAlertForm((prev) => ({ ...prev, changeAbove: val ?? 5 }))}
                  min={0} max={100} step={0.5} precision={1} prefix="+" suffix="%"
                  style={{ width: '100%', borderRadius: 10 }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6b7fa8', marginBottom: 6 }}>跌幅超过（%）</div>
                <InputNumber
                  value={alertForm.changeBelow ?? -5}
                  onChange={(val) => setAlertForm((prev) => ({ ...prev, changeBelow: val ?? -5 }))}
                  min={-100} max={0} step={0.5} precision={1} suffix="%"
                  style={{ width: '100%', borderRadius: 10 }}
                />
              </div>
            </div>
          </div>

          <div style={{ padding: '16px 18px', background: 'rgba(255,255,255,0.6)', borderRadius: 12, border: '1px solid rgba(79, 110, 247, 0.1)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#0f1a2e', marginBottom: 14 }}>💰 价格提醒（可选）</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#6b7fa8', marginBottom: 6 }}>价格高于（USD）</div>
                <InputNumber
                  value={alertForm.priceAbove}
                  onChange={(val) => setAlertForm((prev) => ({ ...prev, priceAbove: val ?? undefined }))}
                  min={0} step={1} precision={2} prefix="$" placeholder="不设置"
                  style={{ width: '100%', borderRadius: 10 }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6b7fa8', marginBottom: 6 }}>价格低于（USD）</div>
                <InputNumber
                  value={alertForm.priceBelow}
                  onChange={(val) => setAlertForm((prev) => ({ ...prev, priceBelow: val ?? undefined }))}
                  min={0} step={1} precision={2} prefix="$" placeholder="不设置"
                  style={{ width: '100%', borderRadius: 10 }}
                />
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: '#8a9cc8', lineHeight: 1.6 }}>
            💡 提醒触发后 5 分钟内不会重复通知，避免频繁打扰
          </div>
        </Space>
      </Modal>
    </div>
  );
};

/** 根据列 key 列表生成 CSS grid-template-columns */
const buildGridTemplate = (keys: ColumnKey[]): string => {
  const widthMap: Record<ColumnKey, string> = {
    symbol:        '80px',
    price:         '1fr',
    change:        '1fr',
    changePercent: '1fr',
    high:          '1fr',
    low:           '1fr',
    open:          '1fr',
    previousClose: '1fr',
    volume:        '1fr',
  };
  const colWidths = keys.map((key) => widthMap[key] ?? '1fr').join(' ');
  // 最后追加操作列固定宽度
  return `${colWidths} 72px`;
};

export default Dashboard;
