import { useState, useEffect, memo } from 'react';
import { Card, Tabs, Spin, Alert, Button, Modal, Typography, Space, List, Radio } from 'antd';
import { BarChartOutlined, RiseOutlined, FallOutlined, LinkOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useStockQuote } from '@/hooks/useStockQuote';
import { useStockNews } from '@/hooks/useStockNews';
import { getProfile, handleAPIError } from '@/services/stockApi';
import { fetchKLineData } from '@/services/eastmoney';
import { useStockStore, getChangeColors } from '@/store/useStockStore';
import type { Stock, NewsItem, AnalysisResult, HistoricalDataPoint } from '@/types';
import { formatPercent, formatMarketCap, formatDate, formatPriceByMarket } from '@/utils/format';
import KLineChart from '@/components/KLineChart';

const { Title, Text, Link } = Typography;

// ── 纯函数提取到组件外，避免每次渲染重新定义 ──────────────────────────────

/** 计算简单移动平均（SMA）。数据不足时返回 undefined */
const calculateSMA = (closes: number[], period: number): number | undefined => {
  if (closes.length < period) return undefined;
  const slice = closes.slice(closes.length - period);
  return slice.reduce((sum, price) => sum + price, 0) / period;
};

/**
 * 计算 RSI(14)，使用 Wilder 平滑法
 * 数据不足 15 根 K 线时返回 undefined
 */
const calculateRSI = (closes: number[], period: number = 14): number | undefined => {
  if (closes.length < period + 1) return undefined;

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index++) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let index = period + 1; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) return 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
};

/** 根据 RSI 和 SMA 生成交易建议 */
const deriveRecommendation = (
  rsi: number | undefined,
  currentPrice: number,
  sma20: number | undefined,
  sma50: number | undefined,
): { recommendation: 'Buy' | 'Sell' | 'Hold'; summary: string } => {
  let recommendation: 'Buy' | 'Sell' | 'Hold' = 'Hold';
  const summaryParts: string[] = [];

  if (rsi !== undefined) {
    if (rsi < 30) {
      recommendation = 'Buy';
      summaryParts.push('RSI indicates oversold conditions (< 30).');
    } else if (rsi > 70) {
      recommendation = 'Sell';
      summaryParts.push('RSI indicates overbought conditions (> 70).');
    } else {
      summaryParts.push(`RSI is neutral at ${rsi.toFixed(1)}.`);
    }
  }

  if (sma20 !== undefined && sma50 !== undefined) {
    if (currentPrice > sma20 && currentPrice > sma50) {
      summaryParts.push('Price is above SMA20 and SMA50 (bullish trend).');
      if (recommendation === 'Hold') recommendation = 'Buy';
    } else if (currentPrice < sma20 && currentPrice < sma50) {
      summaryParts.push('Price is below SMA20 and SMA50 (bearish trend).');
      if (recommendation === 'Hold') recommendation = 'Sell';
    } else {
      summaryParts.push('Price is between SMA20 and SMA50 (mixed signals).');
    }
  }

  if (summaryParts.length === 0) {
    summaryParts.push('Insufficient data for analysis.');
  }

  return { recommendation, summary: summaryParts.join(' ') };
};

/** Single stat cell used in the details grid */
const StatCell = memo(({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) => (
  <div
    style={{
      padding: '16px 20px',
      background: accent ? 'rgba(45, 158, 107, 0.04)' : 'rgba(255,255,255,0.5)',
      borderRadius: 12,
      border: '1px solid rgba(45, 158, 107, 0.1)',
    }}
  >
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: '#a8c4b4',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 6,
      }}
    >
      {label}
    </div>
    <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2e22', letterSpacing: '-0.01em' }}>
      {value}
    </div>
  </div>
));

/** RSI gauge bar */
const RsiGauge = ({ rsi }: { rsi: number }) => {
  const pct = Math.min(100, Math.max(0, rsi));
  const color = rsi < 30 ? '#16a34a' : rsi > 70 ? '#dc2626' : '#d97706';
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: '#a8c4b4',
          marginBottom: 6,
          fontWeight: 500,
        }}
      >
        <span>Oversold (30)</span>
        <span style={{ color, fontWeight: 700, fontSize: 14 }}>{rsi.toFixed(1)}</span>
        <span>Overbought (70)</span>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: 'rgba(45, 158, 107, 0.1)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${pct}%`,
            background: `linear-gradient(90deg, #16a34a, ${color})`,
            borderRadius: 4,
            transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>
    </div>
  );
};

interface AnalysisProps {
  initialSymbol?: string;
}

const Analysis = ({ initialSymbol }: AnalysisProps) => {
  const { watchlist, refreshInterval, symbolNames } = useStockStore();
  // 当前选中的股票 symbol，优先使用从 Dashboard 传入的 initialSymbol
  const [symbol, setSymbol] = useState<string | undefined>(initialSymbol || watchlist[0]);

  // 当 initialSymbol 从外部变化时（Dashboard 点击新股票），同步更新
  useEffect(() => {
    if (initialSymbol) {
      setSymbol(initialSymbol);
    }
  }, [initialSymbol]);

  // watchlist 异步加载完成后的兜底：若 symbol 仍为空，自动选中第一个
  useEffect(() => {
    if (!symbol && watchlist.length > 0) {
      setSymbol(watchlist[0]);
    }
  }, [symbol, watchlist]);

  const { quote, loading: quoteLoading, error: quoteError } = useStockQuote(symbol || '', refreshInterval * 1000);
  const { news, loading: newsLoading, error: newsError } = useStockNews(symbol || '');
  const [profile, setProfile] = useState<Partial<Stock> | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [analysisModalVisible, setAnalysisModalVisible] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // ── K 线图状态 ────────────────────────────────────────────────────────
  const [klineData, setKlineData] = useState<HistoricalDataPoint[]>([]);
  const [klineLoading, setKlineLoading] = useState(false);
  const [klineError, setKlineError] = useState<string | null>(null);
  const [klineSource, setKlineSource] = useState<string>('');
  /** 时间范围：1M / 3M / 6M / 1Y */
  const [klineRange, setKlineRange] = useState<'1M' | '3M' | '6M' | '1Y'>('3M');

  // ── K 线图数据加载 ────────────────────────────────────────────────────
  // rangeTodays 提取为模块级常量，避免每次渲染重新创建
  const RANGE_TO_DAYS: Record<string, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };

  const loadKlineData = async (targetSymbol: string, range: '1M' | '3M' | '6M' | '1Y') => {
    setKlineLoading(true);
    setKlineError(null);
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - RANGE_TO_DAYS[range] * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
      // 渲染进程直接调用东方财富 K 线接口，无需走 IPC
      const result = await fetchKLineData(targetSymbol, startDate, endDate);
      setKlineData(result.data);
      setKlineSource(result.source);
    } catch (err: any) {
      setKlineError(handleAPIError(err));
    } finally {
      setKlineLoading(false);
    }
  };

  // symbol 或时间范围变化时重新加载 K 线数据
  useEffect(() => {
    if (!symbol) return;
    loadKlineData(symbol, klineRange);
  }, [symbol, klineRange]);

  useEffect(() => {
    if (!symbol) return;
    const fetchProfile = async () => {
      setProfileLoading(true);
      try {
        const data = await getProfile(symbol);
        setProfile(data);
      } catch (err: any) {
        console.error('Failed to fetch profile:', handleAPIError(err));
      } finally {
        setProfileLoading(false);
      }
    };
    fetchProfile();
  }, [symbol]);
  // ── 技术分析入口 ──────────────────────────────────────────────────────

  const generateAnalysis = async () => {
    if (!quote || !symbol) return;

    setAnalysisLoading(true);

    try {
      // 获取最近 250 天历史数据（SMA200 需要至少 200 根 K 线）
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 250 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      // 渲染进程直接调用东方财富 K 线接口，无需走 IPC
      const histResult = await fetchKLineData(symbol, startDate, endDate);
      const closes = histResult.data.map((point) => point.close);

      let rsi: number | undefined;
      let sma20: number | undefined;
      let sma50: number | undefined;
      let sma200: number | undefined;

      const useRealData = closes.length >= 15;

      if (useRealData) {
        // ✅ 真实历史数据（东方财富 K 线接口）：计算真实指标
        rsi = calculateRSI(closes, 14);
        sma20 = calculateSMA(closes, 20);
        sma50 = calculateSMA(closes, 50);
        sma200 = calculateSMA(closes, 200);
      } else {
        // ⚠️ 数据不足（网络问题/新股）：降级为随机模拟
        const currentPrice = quote.price;
        rsi = 30 + Math.random() * 40;
        sma20 = currentPrice * (0.95 + Math.random() * 0.1);
        sma50 = currentPrice * (0.9 + Math.random() * 0.2);
        sma200 = currentPrice * (0.8 + Math.random() * 0.4);
      }

      const { recommendation, summary } = deriveRecommendation(rsi, quote.price, sma20, sma50);

      // 标注数据来源
      const sourceLabel = useRealData ? '[EastMoney] ' : '[SIMULATED DATA] ';

      setAnalysis({
        symbol,
        rsi,
        sma20,
        sma50,
        sma200,
        recommendation,
        summary: `${sourceLabel}${summary}`,
      });
      setAnalysisModalVisible(true);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const { colorMode } = useStockStore();
  const { up: upColor, down: downColor } = getChangeColors(colorMode);
  const isPositive = quote ? quote.change >= 0 : true;
  const accentColor = isPositive ? upColor : downColor;

  // 没有自选股时，显示引导页面
  if (!symbol) {
    const hasWatchlist = watchlist.length > 0;
    return (
      <div
        style={{
          maxWidth: 800,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          gap: 32,
          padding: '40px 24px',
        }}
      >
        {/* 主图标 */}
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 28,
            background: 'linear-gradient(135deg, rgba(79,110,247,0.12), rgba(79,110,247,0.06))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 48,
            border: '1px solid rgba(79,110,247,0.15)',
          }}
        >
          📊
        </div>

        {/* 标题 + 副标题 */}
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ fontWeight: 800, fontSize: 24, color: '#0f1a2e', letterSpacing: '-0.03em', marginBottom: 10 }}>
            {hasWatchlist ? '点击股票卡片开始分析' : '添加自选股开始分析'}
          </div>
          <div style={{ fontSize: 14, color: '#6b7fa8', lineHeight: 1.7 }}>
            {hasWatchlist
              ? '在「自选股」页面点击任意股票卡片，即可在此查看 K 线图、实时报价和技术分析'
              : '在「自选股」页面搜索并添加股票，然后点击卡片进入详情分析'}
          </div>
        </div>

        {/* 功能介绍卡片 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
            width: '100%',
            maxWidth: 600,
          }}
        >
          {[
            { icon: '📈', title: 'K 线图', desc: '1月/3月/6月/1年历史走势' },
            { icon: '⚡', title: '实时报价', desc: '自动轮询最新价格和涨跌' },
            { icon: '🔬', title: '技术分析', desc: 'RSI、SMA20/50/200 指标' },
          ].map(({ icon, title, desc }) => (
            <div
              key={title}
              style={{
                padding: '20px 16px',
                borderRadius: 16,
                background: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(79,110,247,0.1)',
                textAlign: 'center',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1a2e22', marginBottom: 4 }}>{title}</div>
              <div style={{ fontSize: 11, color: '#8a9cc8', lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>

      {/* ── 股票切换选择器 ── */}
      {watchlist.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: '#8a9cc8', fontWeight: 500, marginRight: 4 }}>
            切换股票：
          </span>
          {watchlist.map((ticker) => {
            const isAStock = /\.(SZ|SH|BJ)$/i.test(ticker) || /^\d{6}$/.test(ticker);
            const isHKStock = /\.HK$/i.test(ticker);
            const displayLabel =
              (isAStock || isHKStock) && symbolNames[ticker]
                ? symbolNames[ticker]
                : ticker;
            return (
              <div
                key={ticker}
                onClick={() => setSymbol(ticker)}
                style={{
                  padding: '5px 14px',
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: ticker === symbol ? 700 : 500,
                  cursor: 'pointer',
                  background: ticker === symbol
                    ? 'rgba(79, 110, 247, 0.12)'
                    : 'rgba(255, 255, 255, 0.6)',
                  color: ticker === symbol ? '#4f6ef7' : '#5a6a8a',
                  border: ticker === symbol
                    ? '1px solid rgba(79, 110, 247, 0.3)'
                    : '1px solid rgba(79, 110, 247, 0.1)',
                  transition: 'all 0.18s ease',
                }}
              >
                {displayLabel}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Hero header card ── */}
      <Card
        className="glass-card fade-in-up"
        style={{ marginBottom: 24, border: 'none', borderRadius: 24, overflow: 'hidden' }}
        styles={{ body: { padding: 0 } }}
      >
        {/* Top accent stripe */}
        <div
          style={{
            height: 5,
            background: `linear-gradient(90deg, ${accentColor}, ${accentColor}55)`,
          }}
        />
        <div style={{ padding: '28px 32px 24px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            {/* Left: symbol + name + price */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    background: `linear-gradient(135deg, ${accentColor}22, ${accentColor}0d)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 13,
                    color: accentColor,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {symbol.slice(0, 4)}
                </div>
                <div>
                  <Title level={2} style={{ margin: 0, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
                    {symbol}
                  </Title>
                  {(profile?.name || symbolNames[symbol]) && (
                    <Text style={{ color: '#6b7fa8', fontSize: 13 }}>
                      {profile?.name || symbolNames[symbol]}
                    </Text>
                  )}
                </div>
              </div>

              {quoteLoading ? (
                <div style={{ marginTop: 20 }}>
                  <Spin indicator={<RiseOutlined spin style={{ color: '#4f6ef7', fontSize: 20 }} />} />
                </div>
              ) : quote ? (
                <div style={{ marginTop: 16 }}>
                  <div
                    className="price-display"
                    style={{
                      fontSize: 44,
                      fontWeight: 800,
                      color: '#1a2e22',
                      letterSpacing: '-0.04em',
                      lineHeight: 1,
                      marginBottom: 10,
                    }}
                  >
                    {formatPriceByMarket(quote.price, symbol)}
                  </div>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: isPositive ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
                      color: accentColor,
                      borderRadius: 10,
                      padding: '6px 14px',
                      fontSize: 15,
                      fontWeight: 700,
                    }}
                  >
                    {isPositive
                      ? <RiseOutlined style={{ fontSize: 13 }} />
                      : <FallOutlined style={{ fontSize: 13 }} />
                    }
                    {formatPercent(quote.changePercent)}
                    <span style={{ opacity: 0.7, fontWeight: 500 }}>
                      ({formatPriceByMarket(quote.change, symbol)})
                    </span>
                  </div>
                </div>
              ) : (
                quoteError && <Alert message={quoteError} type="error" style={{ marginTop: 12 }} />
              )}
            </div>

            {/* Right: action button */}
            <Button
              type="primary"
              icon={<BarChartOutlined />}
              onClick={generateAnalysis}
              loading={analysisLoading}
              disabled={!quote}
              size="large"
              style={{
                borderRadius: 12,
                fontWeight: 600,
                height: 46,
                paddingInline: 24,
                background: 'linear-gradient(135deg, #4f6ef7, #6b84f8)',
                border: 'none',
                boxShadow: '0 4px 16px rgba(79, 110, 247, 0.3)',
              }}
            >
              Technical Analysis
            </Button>
          </div>

          {/* Quick stats row */}
          {quote && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 12,
                marginTop: 24,
              }}
            >
              <StatCell label="Open" value={formatPriceByMarket(quote.open || 0, symbol)} />
              <StatCell label="Prev Close" value={formatPriceByMarket(quote.previousClose || 0, symbol)} />
              <StatCell label="Day High" value={formatPriceByMarket(quote.high || 0, symbol)} accent />
              <StatCell label="Day Low" value={formatPriceByMarket(quote.low || 0, symbol)} />
            </div>
          )}
        </div>
      </Card>

      {/* ── Tabs card ── */}
      <Card
        className="glass-card"
        style={{ border: 'none', borderRadius: 20 }}
        styles={{ body: { padding: '8px 24px 24px' } }}
      >
        <Tabs
          defaultActiveKey="kline"
          size="large"
          items={[
            {
              key: 'kline',
              label: (
                <span style={{ fontWeight: 600, fontSize: 14 }}>📈 K 线图</span>
              ),
              children: (
                <div>
                  {/* 时间范围切换 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      {klineSource && !klineLoading && (
                        <span>
                          数据来源：
                          <span style={{
                            color: klineSource === 'simulated' ? '#f59e0b' : '#22c55e',
                            fontWeight: 600,
                          }}>
                            {klineSource === 'akshare' ? 'AKShare' : klineSource === 'yfinance' ? 'yfinance' : '⚠️ 模拟数据'}
                          </span>
                        </span>
                      )}
                    </div>
                    <Radio.Group
                      value={klineRange}
                      onChange={(e) => setKlineRange(e.target.value)}
                      size="small"
                      optionType="button"
                      buttonStyle="solid"
                      options={[
                        { label: '1月', value: '1M' },
                        { label: '3月', value: '3M' },
                        { label: '6月', value: '6M' },
                        { label: '1年', value: '1Y' },
                      ]}
                    />
                  </div>

                  {/* K 线图主体 */}
                  {klineLoading ? (
                    <div style={{ textAlign: 'center', padding: '60px 0' }}>
                      <Spin size="large" />
                      <div style={{ marginTop: 12, color: '#94a3b8', fontSize: 13 }}>
                        加载 K 线数据中...
                      </div>
                    </div>
                  ) : klineError ? (
                    <Alert message={klineError} type="error" />
                  ) : (
                    <KLineChart data={klineData} height={400} />
                  )}
                </div>
              ),
            },
            {
              key: 'details',
              label: (
                <span style={{ fontWeight: 600, fontSize: 14 }}>📊 Company Details</span>
              ),
              children: (
                <div>
                  {profileLoading && (
                    <div style={{ textAlign: 'center', padding: 20 }}>
                      <Spin size="small" />
                    </div>
                  )}
                  {/* quote 数据始终展示，不依赖 Finnhub Key */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: 12,
                    }}
                  >
                    {/* profile 字段：仅美股且配置了 Finnhub Key 时有值 */}
                    <StatCell
                      label="Company Name"
                      value={profile?.name || symbolNames[symbol] || symbol}
                      accent
                    />
                    <StatCell label="Symbol" value={symbol} />
                    {profile?.marketCap && (
                      <StatCell
                        label="Market Cap"
                        value={formatMarketCap(profile.marketCap)}
                      />
                    )}
                    {profile?.description && (
                      <StatCell label="Industry" value={profile.description} />
                    )}
                    {/* quote 字段：A股/港股/美股均有 */}
                    <StatCell label="Price" value={quote ? formatPriceByMarket(quote.price, symbol) : '—'} accent />
                    <StatCell label="Open" value={quote ? formatPriceByMarket(quote.open || 0, symbol) : '—'} />
                    <StatCell
                      label="Prev Close"
                      value={quote ? formatPriceByMarket(quote.previousClose || 0, symbol) : '—'}
                    />
                    <StatCell
                      label="Day High"
                      value={quote ? formatPriceByMarket(quote.high || 0, symbol) : '—'}
                      accent
                    />
                    <StatCell
                      label="Day Low"
                      value={quote ? formatPriceByMarket(quote.low || 0, symbol) : '—'}
                    />
                    <StatCell
                      label="Volume"
                      value={quote?.volume ? quote.volume.toLocaleString() : '—'}
                    />
                    <StatCell
                      label="Last Updated"
                      value={quote ? formatDate(quote.timestamp) : '—'}
                    />
                  </div>
                </div>
              ),
            },
            {
              key: 'news',
              label: (
                <span style={{ fontWeight: 600, fontSize: 14 }}>📰 Latest News</span>
              ),
              children: (
                <div>
                  {newsLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}>
                      <Spin size="large" />
                    </div>
                  ) : newsError ? (
                    <Alert message={newsError} type="error" />
                  ) : news.length === 0 ? (
                    <Alert message="No recent news found for this stock" type="info" />
                  ) : (
                    <List
                      dataSource={news}
                      split={false}
                      renderItem={(item: NewsItem) => (
                        <List.Item style={{ padding: '6px 0' }}>
                          <div className="news-item" style={{ width: '100%' }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 12,
                              }}
                            >
                              {/* Source badge */}
                              <div
                                style={{
                                  flexShrink: 0,
                                  width: 40,
                                  height: 40,
                                  borderRadius: 10,
                                  background: 'linear-gradient(135deg, rgba(79,110,247,0.12), rgba(79,110,247,0.06))',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 18,
                                }}
                              >
                                📄
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Link
                                  href={item.url}
                                  target="_blank"
                                  style={{
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: '#0f1a2e',
                                    lineHeight: 1.4,
                                    display: 'block',
                                    marginBottom: 4,
                                  }}
                                >
                                  {item.title}
                                  <LinkOutlined style={{ marginLeft: 6, fontSize: 11, color: '#4f6ef7' }} />
                                </Link>
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    fontSize: 12,
                                    color: '#6b7fa8',
                                    marginBottom: item.summary ? 8 : 0,
                                  }}
                                >
                                  <ClockCircleOutlined style={{ fontSize: 11 }} />
                                  <span>{item.source}</span>
                                  <span>·</span>
                                  <span>{formatDate(item.publishedAt)}</span>
                                </div>
                                {item.summary && (
                                  <Text
                                    style={{
                                      fontSize: 13,
                                      color: '#3d5070',
                                      lineHeight: 1.5,
                                      display: '-webkit-box',
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                    }}
                                  >
                                    {item.summary}
                                  </Text>
                                )}
                              </div>
                            </div>
                          </div>
                        </List.Item>
                      )}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Technical Analysis Modal ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChartOutlined style={{ color: '#4f6ef7', fontSize: 18 }} />
            <span style={{ fontWeight: 700, fontSize: 16 }}>
              Technical Analysis · {symbol}
            </span>
          </div>
        }
        open={analysisModalVisible}
        onCancel={() => setAnalysisModalVisible(false)}
        footer={
          <Button
            onClick={() => setAnalysisModalVisible(false)}
            style={{ borderRadius: 10, fontWeight: 500 }}
          >
            Close
          </Button>
        }
        width={560}
        styles={{ body: { padding: '20px 24px' } }}
      >
        {analysis && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* Recommendation */}
            <div
              style={{
                textAlign: 'center',
                padding: '24px 0 20px',
                background: 'rgba(79, 110, 247, 0.03)',
                borderRadius: 16,
                border: '1px solid rgba(79, 110, 247, 0.1)',
              }}
            >
              <div style={{ fontSize: 12, color: '#a8c4b4', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                Signal
              </div>
              <span
                className={
                  analysis.recommendation === 'Buy'
                    ? 'recommendation-buy'
                    : analysis.recommendation === 'Sell'
                    ? 'recommendation-sell'
                    : 'recommendation-hold'
                }
              >
                {analysis.recommendation}
              </span>
              <div style={{ marginTop: 12, fontSize: 13, color: '#3d5070', padding: '0 24px', lineHeight: 1.6 }}>
                {analysis.summary}
              </div>
            </div>

            {/* RSI gauge */}
            <div
              style={{
                padding: '16px 20px',
                background: 'rgba(255,255,255,0.6)',
                borderRadius: 14,
                border: '1px solid rgba(79, 110, 247, 0.1)',
              }}
            >
              <div style={{ fontSize: 12, color: '#a0aec8', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
                RSI (14)
              </div>
              <RsiGauge rsi={analysis.rsi || 50} />
            </div>

            {/* SMA grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <StatCell label="SMA 20" value={formatPrice(analysis.sma20 || 0)} accent />
              <StatCell label="SMA 50" value={formatPrice(analysis.sma50 || 0)} />
              <StatCell label="SMA 200" value={formatPrice(analysis.sma200 || 0)} />
            </div>

            {/* Disclaimer */}
            <Alert
              message="Simulated Data — Not for Investment Decisions"
              description="Technical indicators are randomly generated for demonstration. Real analysis requires historical OHLCV data from a paid data provider."
              type="info"
              showIcon
              style={{ borderRadius: 12, fontSize: 12 }}
            />
          </Space>
        )}
      </Modal>

    </div>
  );
};

export default Analysis;
