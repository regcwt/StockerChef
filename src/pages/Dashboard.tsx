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
import { getQuote, searchSymbol, handleAPIError, isCNStock, searchCNSymbol } from '@/services/stockApi';
import type { SearchResult, Quote } from '@/types';
import { formatPrice, formatPercent } from '@/utils/format';

const { Title, Text } = Typography;

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

/** 根据 columnKey 从 quote 中取对应的显示值 */
const getCellValue = (key: ColumnKey, symbol: string, quote: Quote | undefined): string => {
  if (!quote) return '—';
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
    watchlist, quotes, error, rateLimited,
    setRateLimited, setError, colorMode, refreshInterval,
    alertThresholds, visibleColumns,
  } = useStockStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // 是否正在从缓存恢复后的后台刷新（区别于用户手动刷新）
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);

  // 阈值提醒弹窗状态
  const [alertModalSymbol, setAlertModalSymbol] = useState<string | null>(null);
  const [alertForm, setAlertForm] = useState<Partial<AlertThreshold>>({});

  // 记录已触发过的提醒，避免同一条件重复通知（key: symbol-type）
  const triggeredAlertsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const initDashboard = async () => {
      await useStockStore.getState().loadWatchlist();
      await useStockStore.getState().loadColorMode();
      await useStockStore.getState().loadRefreshInterval();
      await useStockStore.getState().loadAlertThresholds();
      await useStockStore.getState().loadVisibleColumns();

      // 先加载当天缓存展示，同时触发后台刷新
      const hasTodayCache = await useStockStore.getState().loadQuotesCache();
      if (hasTodayCache) {
        // 有当天缓存：先展示缓存，后台静默刷新
        setBackgroundRefreshing(true);
      }
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
      // 将 watchlist 按 A 股 / 美股分组
      const cnSymbols = watchlist.filter(isCNStock);
      const usSymbols = watchlist.filter((s) => !isCNStock(s));

      // A 股：批量通过 AKShare 获取（一次调用）
      const cnQuotePromise: Promise<Quote[]> = cnSymbols.length > 0
        ? (async () => {
            try {
              const rawJson = await window.electronAPI.getCNQuote(cnSymbols.join(','));
              const parsed = JSON.parse(rawJson);
              if (Array.isArray(parsed)) {
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

      // 美股：通过 Finnhub 逐只获取（走限流队列）
      const usQuotePromises = usSymbols.map(async (symbol) => {
        try {
          return await getQuote(symbol);
        } catch (err: any) {
          const errorMessage = handleAPIError(err);
          if (errorMessage.includes('API Key not configured')) return null;
          if (err.response?.status === 429) {
            setRateLimited(true);
            setTimeout(() => setRateLimited(false), 60000);
          }
          return null;
        }
      });

      const [cnQuotes, ...usResults] = await Promise.all([cnQuotePromise, ...usQuotePromises]);
      const validQuotes = [...cnQuotes, ...usResults.filter((q): q is Quote => q !== null)];
      useStockStore.getState().updateQuotes(validQuotes);
      validQuotes.forEach((quote) => checkAlertThreshold(quote.symbol, quote));
    } catch (err: any) {
      setError(handleAPIError(err));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // 初始刷新：无论是否有缓存都需要刷新（有缓存时标记为后台刷新，无缓存时正常刷新）
    fetchAllQuotes();
    const interval = setInterval(fetchAllQuotes, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [watchlist, refreshInterval]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query || query.length < 1) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      // 判断是否为 A 股搜索：纯数字 或 包含中文字符
      const isCNQuery = /^\d+$/.test(query) || /[\u4e00-\u9fa5]/.test(query);
      let results;
      if (isCNQuery) {
        results = await searchCNSymbol(query);
      } else {
        results = await searchSymbol(query);
      }
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

  const handleAddStock = async (symbol: string) => {
    await useStockStore.getState().addToWatchlist(symbol);
    setSearchQuery('');
    setSearchResults([]);
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
      {/* ── 页面标题栏 ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <Title level={2} style={{ margin: 0, fontWeight: 700, letterSpacing: '-0.03em', fontSize: 26 }}>
              自选股
            </Title>
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
          </div>
          {watchlist.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Tag icon={<RiseOutlined />} color="error" style={{ borderRadius: 20, padding: '2px 12px', fontSize: 13, fontWeight: 600 }}>
                {gainers} 涨
              </Tag>
              <Tag icon={<FallOutlined />} color="success" style={{ borderRadius: 20, padding: '2px 12px', fontSize: 13, fontWeight: 600 }}>
                {losers} 跌
              </Tag>
              <Button
                icon={<ReloadOutlined spin={refreshing} />}
                onClick={() => fetchAllQuotes()}
                loading={refreshing}
                style={{ borderRadius: 20, fontWeight: 500 }}
              >
                刷新
              </Button>
            </div>
          )}
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
                  onClick={() => handleAddStock(result.symbol)}
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
