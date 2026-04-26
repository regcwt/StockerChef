import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { StockQuoteResult } from '@/services/eastmoney';
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
  MenuOutlined,
  UpOutlined,
  DownOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStockStore, getChangeColors, COLUMN_DEFINITIONS } from '@/store/useStockStore';
import type { AlertThreshold, ColumnKey } from '@/store/useStockStore';
import { searchSymbol, handleAPIError, isCNStock, isHKStock, searchCNSymbol } from '@/services/stockApi';
import type { SearchResult, Quote } from '@/types';
import { formatPercent, formatPriceByMarket } from '@/utils/format';
import { log } from '@/utils/logger';

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

/**
 * 数据最后刷新时间指示器：展示绝对时间，格式 "YYYY-MM-DD HH:mm:ss"。
 * 由于展示的是固定时刻而非相对时长，无需 tick 自驱；只在 lastRefreshAt 变化时重渲染。
 * 未刷新过时显示 "等待首次刷新..."。
 */
function LastRefreshIndicator({ lastRefreshAt }: { lastRefreshAt: number | null }) {
  if (lastRefreshAt == null) {
    return <span style={{ color: '#8a9cc8' }}>等待首次刷新...</span>;
  }

  const d = new Date(lastRefreshAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      最后刷新：{formatted}
    </span>
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

/** 根据 columnKey 从 quote 中取对应的显示值（按 symbol 自动选择币种符号 ¥/HK$/$） */
const getCellValue = (key: ColumnKey, symbol: string, quote: Quote | undefined): string => {
  if (!quote) return '—';
  // 占位 quote（数据获取失败）：symbol 列正常显示，其他列显示 —
  if (key !== 'symbol' && isPlaceholderQuote(quote)) return '—';
  // 数值字段缺失时显示 —，避免 0 与"无数据"混淆
  const fmt = (v: number | undefined): string =>
    v === undefined || v === null ? '—' : formatPriceByMarket(v, symbol);
  switch (key) {
    case 'symbol':        return symbol;
    case 'price':         return fmt(quote.price);
    case 'change':        return quote.change >= 0
                            ? `+${formatPriceByMarket(quote.change, symbol)}`
                            : formatPriceByMarket(quote.change, symbol);
    case 'changePercent': return formatPercent(quote.changePercent);
    case 'high':          return fmt(quote.high);
    case 'low':           return fmt(quote.low);
    case 'open':          return fmt(quote.open);
    case 'previousClose': return fmt(quote.previousClose);
    case 'volume':        return formatVolume(quote.volume);
    default:              return '—';
  }
};

/** 判断某列是否应该用涨跌色着色 */
const isChangeColumn = (key: ColumnKey): boolean =>
  key === 'change' || key === 'changePercent';

// 可排序的股票行组件
const SortableItem = ({ symbol, onStockClick, sortDisabled, children }: {
  symbol: string;
  onStockClick: (symbol: string) => void;
  /** 为 true 时禁用拖拽（涨跌幅排序激活时使用，避免拖拽与排序冲突） */
  sortDisabled?: boolean;
  children: React.ReactNode;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: symbol,
    disabled: sortDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // 拖拽禁用时不展开 listeners / attributes，避免触发 dnd-kit 的拖拽行为；
  // 同时让点击事件正常冒泡到内层 .stock-row 触发 onStockClick
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(sortDisabled ? {} : attributes)}
      {...(sortDisabled ? {} : listeners)}
    >
      <div
        onClick={() => onStockClick(symbol)}
        className="stock-row"
      >
        {children}
      </div>
    </div>
  );
};

/** 预设指数列表，顺序固定，提取到模块级避免每次渲染重新创建。
 *  与 src/services/eastmoney.ts 的 INDEX_SECID_MAP 保持一致（共 8 个）。 */
const PRESET_INDICES = [
  { symbol: '000001.SH', name: '上证指数' },
  { symbol: '399001.SZ', name: '深证成指' },
  { symbol: '399006.SZ', name: '创业板指' },
  { symbol: '.IXIC',     name: '纳斯达克' },
  { symbol: '.INX',      name: '标普500'  },
  { symbol: '.DJI',      name: '道琼斯'   },
  { symbol: 'HSI',       name: '恒生指数' },
  { symbol: 'HSTECH',    name: '恒生科技' },
] as const;

const Dashboard = ({ onStockClick }: DashboardProps) => {
  const {
    watchlist, quotes, symbolNames, error, rateLimited,
    setRateLimited, setError, colorMode, refreshInterval,
    alertThresholds, visibleColumns, indices,
    dashboardInitialized, initDashboard, refreshDashboardData,
    lastRefreshAt,
  } = useStockStore();

  // 过滤状态：全部、A股、港股、美股
  const [filter, setFilter] = useState<'all' | 'cn' | 'hk' | 'us'>('all');

  // 涨跌幅排序状态：none=不排序（按 watchlist 原顺序）、desc=从大到小、asc=从小到大
  // 仅会话内有效，不持久化；与拖拽排序互斥（仅 none 时允许拖拽）
  const [changePercentSort, setChangePercentSort] = useState<'none' | 'desc' | 'asc'>('none');

  /** 三态切换：none → desc → asc → none */
  const toggleChangePercentSort = () => {
    setChangePercentSort((prev) =>
      prev === 'none' ? 'desc' : prev === 'desc' ? 'asc' : 'none'
    );
  };

  // 传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // 处理拖动结束
  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    
    if (!over) return;
    if (active.id === over.id) return;

    const oldIndex = watchlist.indexOf(active.id as string);
    const newIndex = watchlist.indexOf(over.id as string);

    if (oldIndex === -1 || newIndex === -1) return;

    // 创建新的顺序
    const newWatchlist = [...watchlist];
    newWatchlist.splice(oldIndex, 1);
    newWatchlist.splice(newIndex, 0, active.id as string);

    // 更新 watchlist 顺序
    await useStockStore.getState().updateWatchlistOrder(newWatchlist);
  };

  // 上移股票
  const handleMoveUp = async (symbol: string) => {
    const index = watchlist.indexOf(symbol);
    if (index > 0) {
      const newWatchlist = [...watchlist];
      [newWatchlist[index], newWatchlist[index - 1]] = [newWatchlist[index - 1], newWatchlist[index]];
      await useStockStore.getState().updateWatchlistOrder(newWatchlist);
    }
  };

  // 下移股票
  const handleMoveDown = async (symbol: string) => {
    const index = watchlist.indexOf(symbol);
    if (index < watchlist.length - 1) {
      const newWatchlist = [...watchlist];
      [newWatchlist[index], newWatchlist[index + 1]] = [newWatchlist[index + 1], newWatchlist[index]];
      await useStockStore.getState().updateWatchlistOrder(newWatchlist);
    }
  };

  // 根据过滤条件过滤股票（useMemo 避免每次渲染都重新遍历）
  const filteredWatchlist = useMemo(() => {
    const filtered = watchlist.filter((symbol) => {
      if (filter === 'all') return true;
      if (filter === 'cn') return isCNStock(symbol);
      if (filter === 'hk') return isHKStock(symbol);
      if (filter === 'us') return !isCNStock(symbol) && !isHKStock(symbol);
      return true;
    });

    // 不排序时直接返回（保持 watchlist 原顺序，拖拽生效）
    if (changePercentSort === 'none') return filtered;

    // 按涨跌幅排序：占位 quote（无数据）一律沉底，避免穿插到有效数据中间
    const getChangePct = (symbol: string): number | null => {
      const q = quotes[symbol];
      if (!q || isPlaceholderQuote(q)) return null;
      return q.changePercent;
    };

    return [...filtered].sort((a, b) => {
      const va = getChangePct(a);
      const vb = getChangePct(b);
      // 无数据的排在末尾
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return changePercentSort === 'desc' ? vb - va : va - vb;
    });
  }, [watchlist, filter, changePercentSort, quotes]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // 是否正在从缓存恢复后的后台刷新（区别于用户手动刷新）
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  // 用户手动点击刷新按钮时的 loading 状态
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

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
        log.error('[Preset Stocks] 加载失败:', err);
      }
    };
    loadPresetData();
  }, []);

  // 阈值提醒弹窗状态
  const [alertModalSymbol, setAlertModalSymbol] = useState<string | null>(null);
  const [alertForm, setAlertForm] = useState<Partial<AlertThreshold>>({});

  // 记录已触发过的提醒，避免同一条件重复通知（key: symbol-type）
  const triggeredAlertsRef = useRef<Set<string>>(new Set());

  /**
   * 价格阈值通知检查。仅在 fetchAllQuotes 拿到新报价后被回调一次/条。
   *
   * 用 ref 读 alertThresholds，避免回调本身把 alertThresholds 闭包进 store action
   * 后无法感知用户在运行时新增/修改阈值。
   */
  const alertThresholdsRef = useRef(alertThresholds);
  useEffect(() => { alertThresholdsRef.current = alertThresholds; }, [alertThresholds]);

  const checkAlertThreshold = useCallback((quote: Quote) => {
    const threshold = alertThresholdsRef.current[quote.symbol];
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
      notify(`${quote.symbol}-priceAbove`, `📈 ${quote.symbol} 价格提醒`, `当前价格 ${price.toFixed(2)} 已超过设定上限 ${priceAbove}`);
    }
    if (priceBelow !== undefined && price <= priceBelow) {
      notify(`${quote.symbol}-priceBelow`, `📉 ${quote.symbol} 价格提醒`, `当前价格 ${price.toFixed(2)} 已低于设定下限 ${priceBelow}`);
    }
    if (changePct >= changeAbove) {
      notify(`${quote.symbol}-changeAbove`, `🚀 ${quote.symbol} 涨幅提醒`, `今日涨幅 +${changePct.toFixed(2)}% 已超过设定上限 +${changeAbove}%`);
    }
    if (changePct <= changeBelow) {
      notify(`${quote.symbol}-changeBelow`, `⚠️ ${quote.symbol} 跌幅提醒`, `今日跌幅 ${changePct.toFixed(2)}% 已超过设定下限 ${changeBelow}%`);
    }
  }, []);

  // refreshInterval ref：让轮询 useEffect 不需要因 refreshInterval 变化而重建 interval
  const refreshIntervalRef = useRef(refreshInterval);
  useEffect(() => { refreshIntervalRef.current = refreshInterval; }, [refreshInterval]);

  // ── 启动 useEffect：mount 时调用 store.initDashboard() 完成首屏所有持久化配置加载 ──
  // initDashboard 内部已并行加载 watchlist / symbolNames / colorMode / refreshInterval /
  // alertThresholds / visibleColumns，并恢复当天 quotes 缓存。
  // store 内部用 dashboardInitialized 标记防重，React.StrictMode 双调也安全。
  useEffect(() => {
    initDashboard().then(() => {
      // 若有当天缓存恢复出来，UI 转入"后台刷新"状态以提示用户数据正在更新
      // （loadQuotesCache 已在 initDashboard 内执行；此处用 quotes 是否非空近似判断缓存命中）
      if (Object.keys(useStockStore.getState().quotes).length > 0) {
        setBackgroundRefreshing(true);
      }
    });
  // initDashboard 是 store 内稳定引用，无需作为依赖
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 轮询 useEffect：init 完成后立即触发首批刷新，再按 refreshInterval 周期轮询 ──
  // refreshDashboardData 内部并行拉取「指数 + 自选股」两类数据，互不阻塞。
  // 把价格阈值通知作为回调注入，让 store 不依赖 UI 层的具体副作用。
  useEffect(() => {
    if (!dashboardInitialized) return;

    const tick = () => {
      refreshDashboardData(checkAlertThreshold).finally(() => {
        setBackgroundRefreshing(false);
      });
    };

    tick(); // 首次立即拉
    const intervalId = setInterval(tick, refreshIntervalRef.current * 1000);
    return () => clearInterval(intervalId);
  // refreshDashboardData / checkAlertThreshold 都是稳定引用；refreshInterval 通过 ref 读最新值
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardInitialized]);

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
   * 添加新股票后立即获取该股票的最新报价，不等待下一个 interval 周期。
   * 走 IPC（stock-get-quotes）→ 主进程 node:https 调东方财富，绕开渲染进程 CORS 限制。
   * 主进程内部按 symbol 自动派发市场代码（A 股 / 港股 / 美股），调用方无需关心。
   */
  const fetchSingleQuote = async (symbol: string): Promise<void> => {
    try {
      let quote: Quote | null = null;
      const json = await window.electronAPI.getQuotes(symbol);
      const parsed = JSON.parse(json) as StockQuoteResult[] | { error: string; message: string };
      const results = Array.isArray(parsed) ? parsed : [];
      if (results.length > 0) {
        const item = results[0];
        quote = {
          symbol: item.symbol,
          price: item.price,
          change: item.change,
          changePercent: item.changePercent,
          high: item.high,
          low: item.low,
          open: item.open,
          previousClose: item.previousClose,
          volume: item.volume,
          timestamp: new Date().toISOString(),
        };
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

  // 统计涨跌数（useMemo 避免每次渲染都遍历 watchlist）
  const gainers = useMemo(
    () => watchlist.filter((s) => (quotes[s]?.change ?? 0) >= 0).length,
    [watchlist, quotes],
  );
  const losers = watchlist.length - gainers;

  // 列定义（只取可见列，useMemo 避免每次渲染都重新过滤）
  const visibleColumnDefs = useMemo(
    () => COLUMN_DEFINITIONS.filter((col) => visibleColumns.includes(col.key)),
    [visibleColumns],
  );

  // 指数数据 Map（useMemo 避免每次渲染都重新创建 Map）
  const indexDataMap = useMemo(
    () => new Map(indices.map((idx) => [idx.symbol, idx])),
    [indices],
  );

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* ── 页面标题栏（含下方指数卡片）── */}
      <div style={{ marginBottom: 14 }}>
        {/* 第 1 行：左侧 标题+时间 / 右侧 元信息+搜索框+涨跌Tag+刷新按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, rowGap: 6 }}>
          {/* 左侧：标题（含数量） + 实时日期时间 */}
          <Title level={2} style={{ margin: 0, fontWeight: 700, letterSpacing: '-0.03em', fontSize: 24, lineHeight: 1 }}>
            自选 ({watchlist.length})
          </Title>
          <div style={{ width: 1, height: 28, background: 'rgba(100,120,160,0.2)', borderRadius: 1 }} />
          <CurrentDateTime />
          {/* 最后刷新时间 / 频率（上下两行，与左侧时间对齐） */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: 600, color: '#4a5a78', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
              <LastRefreshIndicator lastRefreshAt={lastRefreshAt} />
            </Text>
            <Text style={{ fontSize: 11, color: '#8c9ab0', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
              每 {refreshInterval >= 60 ? `${refreshInterval / 60} 分钟` : `${refreshInterval} 秒`} 刷新
            </Text>
          </div>

          {/* 右侧：搜索框 + Tag + 刷新按钮，整组靠右 */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap', rowGap: 6 }}>
            {backgroundRefreshing && (
              <Tag icon={<LoadingOutlined />} color="processing" style={{ fontSize: 11, borderRadius: 8, padding: '0 6px', margin: 0 }}>
                刷新中
              </Tag>
            )}

            {/* 添加股票搜索框（搜索结果下拉浮于其下方） */}
            <div style={{ position: 'relative', width: 240 }}>
              <Input
                placeholder="搜索股票代码或名称"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onBlur={() => setTimeout(() => setSearchResults([]), 200)}
                prefix={<SearchOutlined style={{ color: '#8a9cc8' }} />}
                suffix={searching ? <LoadingOutlined style={{ color: '#4f6ef7' }} /> : null}
                style={{ borderRadius: 18, height: 36, fontSize: 13 }}
              />
              {searchResults.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: 'rgba(255,255,255,0.98)',
                    borderRadius: 12,
                    border: '1px solid rgba(79, 110, 247, 0.15)',
                    overflow: 'hidden',
                    boxShadow: '0 8px 24px rgba(79, 110, 247, 0.18)',
                    zIndex: 1000,
                  }}
                >
                  {searchResults.map((result, index) => (
                    <div
                      key={result.symbol}
                      className="search-result-item"
                      onMouseDown={(e) => {
                        // 用 onMouseDown 抢在 onBlur 之前触发，避免下拉先被关掉
                        e.preventDefault();
                        handleAddStock(result.symbol, result.description);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        cursor: 'pointer',
                        borderBottom: index < searchResults.length - 1 ? '1px solid rgba(79, 110, 247, 0.06)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <div
                          style={{
                            width: 28, height: 28, borderRadius: 8,
                            background: 'linear-gradient(135deg, rgba(79,110,247,0.12), rgba(79,110,247,0.06))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: 10, color: '#4f6ef7',
                            flexShrink: 0,
                          }}
                        >
                          {(result.displaySymbol || result.symbol).slice(0, 3)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, color: '#1a2e22', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {result.displaySymbol || result.symbol}
                          </div>
                          <div style={{ fontSize: 11, color: '#7a9e8a', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {result.description}
                          </div>
                        </div>
                      </div>
                      <PlusOutlined style={{ color: '#4f6ef7', fontSize: 12, flexShrink: 0, marginLeft: 8 }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {watchlist.length > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Tag icon={<RiseOutlined />} color="error" style={{ borderRadius: 14, padding: '0 10px', fontSize: 12, fontWeight: 600, lineHeight: '22px', margin: 0 }}>
                  {gainers} 涨
                </Tag>
                <Tag icon={<FallOutlined />} color="success" style={{ borderRadius: 14, padding: '0 10px', fontSize: 12, fontWeight: 600, lineHeight: '22px', margin: 0 }}>
                  {losers} 跌
                </Tag>
              </div>
            )}
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={isManualRefreshing}
              onClick={async () => {
                setIsManualRefreshing(true);
                try {
                  // 与启动/轮询走同一入口：内部并行刷新指数 + 自选股，
                  // 并把价格阈值通知回调注入，复用 store 的 in-flight 去重
                  await refreshDashboardData(checkAlertThreshold);
                } finally {
                  setIsManualRefreshing(false);
                }
              }}
              style={{ borderRadius: 14, fontWeight: 500, fontSize: 12, height: 28 }}
            >
              刷新
            </Button>
          </div>
        </div>

        {/* 第 2 行：8 个关键指数卡片，等宽分布占满整行 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
            gap: 6,
            marginTop: 10,
          }}
        >
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
                  padding: '6px 8px',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.7)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(79, 110, 247, 0.1)',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                  textAlign: 'center',
                  minWidth: 0, // 允许 grid 子项收缩，避免内容撑破布局
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: '#8a9cc8',
                    fontWeight: 600,
                    marginBottom: 3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {name}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: hasData ? '#0f1a2e' : '#c0cce0',
                    letterSpacing: '-0.02em',
                    lineHeight: 1.2,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {hasData ? data.price.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—'}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: indexColor,
                    marginTop: 1,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {hasData
                    ? `${sign}${data.change.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} (${sign}${data.changePercent.toFixed(2)}%)`
                    : '— (—%)'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 过滤Tab（与下方表格紧贴：去掉 marginBottom，只保留上圆角，去掉底边框）── */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '8px',
          background: 'rgba(255,255,255,0.7)',
          borderRadius: '12px 12px 0 0',
          border: '1px solid rgba(79, 110, 247, 0.1)',
          borderBottom: 'none',
        }}
      >
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '6px 16px',
            borderRadius: 8,
            border: 'none',
            background: filter === 'all' ? 'rgba(79, 110, 247, 0.1)' : 'transparent',
            color: filter === 'all' ? '#4f6ef7' : '#6b7fa8',
            fontWeight: filter === 'all' ? 600 : 400,
            fontSize: 13,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          全部
        </button>
        <button
          onClick={() => setFilter('cn')}
          style={{
            padding: '6px 16px',
            borderRadius: 8,
            border: 'none',
            background: filter === 'cn' ? 'rgba(79, 110, 247, 0.1)' : 'transparent',
            color: filter === 'cn' ? '#4f6ef7' : '#6b7fa8',
            fontWeight: filter === 'cn' ? 600 : 400,
            fontSize: 13,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          A股
        </button>
        <button
          onClick={() => setFilter('hk')}
          style={{
            padding: '6px 16px',
            borderRadius: 8,
            border: 'none',
            background: filter === 'hk' ? 'rgba(79, 110, 247, 0.1)' : 'transparent',
            color: filter === 'hk' ? '#4f6ef7' : '#6b7fa8',
            fontWeight: filter === 'hk' ? 600 : 400,
            fontSize: 13,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          港股
        </button>
        <button
          onClick={() => setFilter('us')}
          style={{
            padding: '6px 16px',
            borderRadius: 8,
            border: 'none',
            background: filter === 'us' ? 'rgba(79, 110, 247, 0.1)' : 'transparent',
            color: filter === 'us' ? '#4f6ef7' : '#6b7fa8',
            fontWeight: filter === 'us' ? 600 : 400,
            fontSize: 13,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          美股
        </button>
      </div>

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
          style={{ borderRadius: '0 0 16px 16px', overflow: 'hidden' }}
        >
          {/* 表头 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `${buildGridTemplate(visibleColumnDefs.map((c) => c.key))} 80px 72px`,
              gridColumnGap: '8px',
              padding: '10px 16px',
              background: 'rgba(79, 110, 247, 0.04)',
              borderBottom: '1px solid rgba(79, 110, 247, 0.1)',
            }}
          >
            {visibleColumnDefs.map((col) => {
              const isSortable = col.key === 'changePercent';
              const isActive = isSortable && changePercentSort !== 'none';
              // 排序按钮图标：none=双向箭头（提示可排序），desc=向下箭头，asc=向上箭头
              const sortIcon =
                changePercentSort === 'desc'
                  ? <ArrowDownOutlined />
                  : changePercentSort === 'asc'
                  ? <ArrowUpOutlined />
                  : <SwapOutlined rotate={90} />;
              const sortTooltip =
                changePercentSort === 'none'
                  ? '点击：按涨跌幅降序排列'
                  : changePercentSort === 'desc'
                  ? '当前：降序，点击切换为升序'
                  : '当前：升序，点击恢复默认顺序';

              // 表头基础色加深一档（#8a9cc8 → #5a6b8c），让默认状态也更易识别
              // 排序激活时用品牌主色 #4f6ef7 + 加粗，凸显当前生效的排序列
              const headerColor = isActive ? '#4f6ef7' : '#5a6b8c';
              // 图标颜色比文字更突出，激活时同主色，未激活时用中性深灰（不抢戏但清晰）
              const iconColor = isActive ? '#4f6ef7' : '#7a89a8';

              return (
                <div
                  key={col.key}
                  onClick={isSortable ? toggleChangePercentSort : undefined}
                  style={{
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 600,
                    color: headerColor,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    textAlign: col.key === 'symbol' ? 'left' : 'right',
                    cursor: isSortable ? 'pointer' : 'default',
                    userSelect: 'none',
                    transition: 'color 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: col.key === 'symbol' ? 'flex-start' : 'flex-end',
                    gap: 4,
                  }}
                  title={isSortable ? sortTooltip : undefined}
                >
                  <span>{col.label}</span>
                  {isSortable && (
                    <span
                      style={{
                        fontSize: 13,
                        lineHeight: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        color: iconColor,
                        fontWeight: 700,
                      }}
                    >
                      {sortIcon}
                    </span>
                  )}
                </div>
              );
            })}
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8a9cc8', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center' }}>排序</div>
            {/* 操作列 */}
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8a9cc8', textAlign: 'right' }}>操作</div>
          </div>

          {/* 数据行 */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredWatchlist}
              strategy={verticalListSortingStrategy}
            >
              {filteredWatchlist.map((symbol, rowIndex) => {
                const quote = quotes[symbol];
                const isPositive = quote ? quote.change >= 0 : true;
                const changeColor = isPositive ? upColor : downColor;
                const isLastRow = rowIndex === filteredWatchlist.length - 1;
                const isFirstRow = rowIndex === 0;

                return (
                  <SortableItem
                    key={symbol}
                    symbol={symbol}
                    onStockClick={onStockClick}
                    sortDisabled={changePercentSort !== 'none'}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `${buildGridTemplate(visibleColumnDefs.map((c) => c.key))} 80px 72px`,
                        gridColumnGap: '8px',
                        padding: '14px 16px',
                        borderBottom: isLastRow ? 'none' : '1px solid rgba(79, 110, 247, 0.06)',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                        alignItems: 'center',
                      }}
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
                      
                      {/* 排序操作区 */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 2,
                          padding: '2px',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* 拖动手柄 */}
                        <Tooltip title="拖动排序">
                          <div
                            style={{
                              cursor: 'grab',
                              color: '#c0cce0',
                              fontSize: 12,
                              padding: 3,
                              borderRadius: 4,
                              transition: 'color 0.2s',
                            }}
                          >
                            <MenuOutlined />
                          </div>
                        </Tooltip>
                        {/* 上移下移按钮 */}
                        <div style={{ display: 'flex', gap: 2 }}>
                          {/* 上移按钮 */}
                          <Tooltip title="上移">
                            <div
                              onClick={() => handleMoveUp(symbol)}
                              style={{
                                cursor: 'pointer',
                                color: !isFirstRow ? '#c0cce0' : '#e0e0e0',
                                fontSize: 12,
                                padding: 3,
                                borderRadius: 4,
                                transition: 'color 0.2s',
                                opacity: !isFirstRow ? 1 : 0.5,
                              }}
                            >
                              <UpOutlined />
                            </div>
                          </Tooltip>
                          {/* 下移按钮 */}
                          <Tooltip title="下移">
                            <div
                              onClick={() => handleMoveDown(symbol)}
                              style={{
                                cursor: 'pointer',
                                color: !isLastRow ? '#c0cce0' : '#e0e0e0',
                                fontSize: 12,
                                padding: 3,
                                borderRadius: 4,
                                transition: 'color 0.2s',
                                opacity: !isLastRow ? 1 : 0.5,
                              }}
                            >
                              <DownOutlined />
                            </div>
                          </Tooltip>
                        </div>
                      </div>

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
                  </SortableItem>
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* ── 错误提示（置于页面最底部，避免占据顶部黄金视觉区）── */}
      {error && (
        <Alert
          message="错误"
          description={error}
          type="error"
          closable
          onClose={() => setError(null)}
          style={{ marginTop: 12, borderRadius: 12 }}
        />
      )}
      {rateLimited && (
        <Alert
          message="API 限流"
          description="已触发 Finnhub 频率限制，约 60 秒后自动恢复。"
          type="warning"
          closable
          onClose={() => setRateLimited(false)}
          style={{ marginTop: 12, borderRadius: 12 }}
        />
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
    symbol:        'minmax(80px, 1fr)',
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
  return colWidths;
};

export default Dashboard;
