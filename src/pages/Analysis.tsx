import { useState, useEffect, useRef } from 'react';
import { Card, Tabs, Spin, Alert, Button, Modal, Typography, Space, List, Input, Tooltip, Radio } from 'antd';
import { BarChartOutlined, RiseOutlined, FallOutlined, LinkOutlined, ClockCircleOutlined, DeleteOutlined, SendOutlined, MessageOutlined } from '@ant-design/icons';
import { useStockQuote } from '@/hooks/useStockQuote';
import { useStockNews } from '@/hooks/useStockNews';
import { getProfile, getHistoricalData, handleAPIError } from '@/services/stockApi';
import { useStockStore, getChangeColors } from '@/store/useStockStore';
import type { Stock, NewsItem, AnalysisResult, StockQuestion, HistoricalDataPoint } from '@/types';
import { formatPrice, formatPercent, formatMarketCap, formatDate } from '@/utils/format';
import KLineChart from '@/components/KLineChart';

const { Title, Text, Link } = Typography;
/** Single stat cell used in the details grid */
const StatCell = ({
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
);

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
  const { watchlist, refreshInterval, questions, loadQuestions, addQuestion, deleteQuestion, symbolNames } = useStockStore();
  // 当前选中的股票 symbol，优先使用从 Dashboard 传入的 initialSymbol
  const [symbol, setSymbol] = useState<string | undefined>(initialSymbol || watchlist[0]);

  // 当 initialSymbol 从外部变化时（Dashboard 点击新股票），同步更新
  useEffect(() => {
    if (initialSymbol) {
      setSymbol(initialSymbol);
    }
  }, [initialSymbol]);

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

  // ── 问答区域状态 ──────────────────────────────────────────────────────
  const [questionInput, setQuestionInput] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState<StockQuestion | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);

  // ── K 线图数据加载 ────────────────────────────────────────────────────
  const rangeTodays: Record<string, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };

  const loadKlineData = async (targetSymbol: string, range: '1M' | '3M' | '6M' | '1Y') => {
    setKlineLoading(true);
    setKlineError(null);
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - rangeTodays[range] * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
      const result = await getHistoricalData(targetSymbol, startDate, endDate);
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

  // 加载历史问题
  useEffect(() => {
    loadQuestions();
  }, []);

  // 当前 symbol 的历史问题（最新在前）
  const currentSymbolQuestions = questions.filter((q) => q.symbol === symbol);

  const handleSubmitQuestion = async () => {
    const trimmed = questionInput.trim();
    if (!trimmed || !symbol) return;
    await addQuestion(symbol, trimmed);
    setQuestionInput('');
  };

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

  // ── 技术指标计算工具函数 ──────────────────────────────────────────────

  /** 计算简单移动平均（SMA）。数据不足时返回 undefined */
  const calculateSMA = (closes: number[], period: number): number | undefined => {
    if (closes.length < period) return undefined;
    const slice = closes.slice(closes.length - period);
    return slice.reduce((sum, price) => sum + price, 0) / period;
  };

  /**
   * 计算 RSI(14)
   * 参考 TradingAgents-CN 的技术分析逻辑，使用 Wilder 平滑法
   * 数据不足 15 根 K 线时返回 undefined
   */
  const calculateRSI = (closes: number[], period: number = 14): number | undefined => {
    if (closes.length < period + 1) return undefined;

    let gains = 0;
    let losses = 0;

    // 计算初始平均涨跌幅（第一个 period 段）
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

    // Wilder 平滑法：对剩余数据进行指数平滑
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

  // ── 技术分析入口 ──────────────────────────────────────────────────────

  /**
   * 生成技术分析
   * 优先使用 yfinance 真实历史数据计算 RSI/SMA
   * yfinance 不可用时（限流/网络问题）降级为随机模拟，并在 UI 明确标注
   */
  const generateAnalysis = async () => {
    if (!quote || !symbol) return;

    setAnalysisLoading(true);

    try {
      // 获取最近 250 天历史数据（SMA200 需要至少 200 根 K 线）
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 250 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const histResult = await getHistoricalData(symbol, startDate, endDate);
      const closes = histResult.data.map((point) => point.close);

      let rsi: number | undefined;
      let sma20: number | undefined;
      let sma50: number | undefined;
      let sma200: number | undefined;

      const useRealData = histResult.source !== 'simulated' && closes.length >= 15;

      if (useRealData) {
        // ✅ 真实历史数据（AKShare 或 yfinance）：计算真实指标
        rsi = calculateRSI(closes, 14);
        sma20 = calculateSMA(closes, 20);
        sma50 = calculateSMA(closes, 50);
        sma200 = calculateSMA(closes, 200);
      } else {
        // ⚠️ 所有数据源均不可用（限流/网络问题）：降级为随机模拟
        const currentPrice = quote.price;
        rsi = 30 + Math.random() * 40;
        sma20 = currentPrice * (0.95 + Math.random() * 0.1);
        sma50 = currentPrice * (0.9 + Math.random() * 0.2);
        sma200 = currentPrice * (0.8 + Math.random() * 0.4);
      }

      const { recommendation, summary } = deriveRecommendation(rsi, quote.price, sma20, sma50);

      // 标注数据来源：真实数据标注数据源，模拟数据加免责声明
      const sourceLabel = histResult.source === 'akshare'
        ? '[AKShare] '
        : histResult.source === 'yfinance'
          ? '[yfinance] '
          : '[SIMULATED DATA] ';

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

  // 没有选中股票时，显示空状态引导用户选择
  if (!symbol) {
    return (
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 56 }}>📊</div>
        <div style={{ fontWeight: 700, fontSize: 22, color: '#0f1a2e', letterSpacing: '-0.02em' }}>
          选择一只股票开始分析
        </div>
        <div style={{ fontSize: 14, color: '#6b7fa8' }}>
          请先在首页添加自选股，然后点击股票卡片进入分析
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 80px)', overflow: 'hidden' }}>

      {/* ── 左侧：历史问题列表 ── */}
      <div
        style={{
          width: 220,
          minWidth: 220,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(248, 250, 255, 0.7)',
          backdropFilter: 'blur(12px)',
          borderRight: '1px solid rgba(79, 110, 247, 0.1)',
          overflow: 'hidden',
        }}
      >
        {/* 左侧标题 */}
        <div
          style={{
            padding: '18px 16px 12px',
            borderBottom: '1px solid rgba(79, 110, 247, 0.08)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageOutlined style={{ color: '#4f6ef7', fontSize: 14 }} />
            <span style={{ fontWeight: 700, fontSize: 13, color: '#0f1a2e' }}>历史问题</span>
          </div>
          {symbol && (
            <div style={{ fontSize: 11, color: '#8a9cc8', marginTop: 4 }}>
              {symbol} · {currentSymbolQuestions.length} 条
            </div>
          )}
        </div>

        {/* 问题列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {currentSymbolQuestions.length === 0 ? (
            <div
              style={{
                padding: '32px 16px',
                textAlign: 'center',
                color: '#a0aec8',
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 8 }}>💬</div>
              <div>还没有问题记录</div>
              <div>在下方输入框提问</div>
            </div>
          ) : (
            currentSymbolQuestions.map((q) => (
              <div
                key={q.id}
                onClick={() => setSelectedQuestion(selectedQuestion?.id === q.id ? null : q)}
                style={{
                  padding: '10px 14px',
                  margin: '2px 6px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: selectedQuestion?.id === q.id
                    ? 'rgba(79, 110, 247, 0.1)'
                    : 'transparent',
                  border: selectedQuestion?.id === q.id
                    ? '1px solid rgba(79, 110, 247, 0.2)'
                    : '1px solid transparent',
                  transition: 'all 0.15s ease',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: selectedQuestion?.id === q.id ? '#4f6ef7' : '#2d3a52',
                    fontWeight: 500,
                    lineHeight: 1.4,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    marginBottom: 4,
                    paddingRight: 20,
                  }}
                >
                  {q.question}
                </div>
                <div style={{ fontSize: 10, color: '#a0aec8' }}>
                  {new Date(q.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
                <Tooltip title="删除">
                  <div
                    onClick={(e) => { e.stopPropagation(); deleteQuestion(q.id); }}
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 20,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 6,
                      color: '#c0cce0',
                      fontSize: 11,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.color = '#dc2626'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(220,38,38,0.08)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.color = '#c0cce0'; (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <DeleteOutlined />
                  </div>
                </Tooltip>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 右侧：主内容区 + 底部输入框 ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* 主内容滚动区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px' }}>
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
          {watchlist.map((ticker) => (
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
              {ticker}
            </div>
          ))}
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
                    {formatPrice(quote.price)}
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
                      ({formatPrice(quote.change)})
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
              <StatCell label="Open" value={formatPrice(quote.open || 0)} />
              <StatCell label="Prev Close" value={formatPrice(quote.previousClose || 0)} />
              <StatCell label="Day High" value={formatPrice(quote.high || 0)} accent />
              <StatCell label="Day Low" value={formatPrice(quote.low || 0)} />
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
                  {profileLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}>
                      <Spin size="large" />
                    </div>
                  ) : profile ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: 12,
                      }}
                    >
                      <StatCell label="Company Name" value={profile.name || 'N/A'} accent />
                      <StatCell label="Symbol" value={symbol} />
                      <StatCell
                        label="Market Cap ⚠️"
                        value={profile.marketCap ? formatMarketCap(profile.marketCap) : 'N/A'}
                      />
                      <StatCell label="Industry" value={profile.description || 'N/A'} />
                      <StatCell label="Open" value={quote ? formatPrice(quote.open || 0) : 'N/A'} />
                      <StatCell
                        label="Prev Close"
                        value={quote ? formatPrice(quote.previousClose || 0) : 'N/A'}
                      />
                      <StatCell
                        label="Day High"
                        value={quote ? formatPrice(quote.high || 0) : 'N/A'}
                        accent
                      />
                      <StatCell
                        label="Day Low"
                        value={quote ? formatPrice(quote.low || 0) : 'N/A'}
                      />
                      <StatCell
                        label="Volume"
                        value={quote?.volume ? quote.volume.toLocaleString() : 'N/A'}
                      />
                      <StatCell
                        label="Last Updated"
                        value={quote ? formatDate(quote.timestamp) : 'N/A'}
                      />
                    </div>
                  ) : (
                    <Alert message="Failed to load company profile" type="error" />
                  )}
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

          </div>{/* end maxWidth wrapper */}
        </div>{/* end 主内容滚动区 */}

        {/* ── 底部：问题输入框 ── */}
        <div
          style={{
            flexShrink: 0,
            padding: '12px 24px 16px',
            borderTop: '1px solid rgba(79, 110, 247, 0.1)',
            background: 'rgba(248, 250, 255, 0.8)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {selectedQuestion && (
            <div
              style={{
                marginBottom: 10,
                padding: '10px 14px',
                background: 'rgba(79, 110, 247, 0.06)',
                borderRadius: 10,
                border: '1px solid rgba(79, 110, 247, 0.15)',
                fontSize: 12,
                color: '#4f6ef7',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <MessageOutlined style={{ marginTop: 1, flexShrink: 0 }} />
              <span style={{ flex: 1, lineHeight: 1.5 }}>{selectedQuestion.question}</span>
              <span
                onClick={() => setSelectedQuestion(null)}
                style={{ cursor: 'pointer', color: '#a0aec8', flexShrink: 0 }}
              >
                ✕
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <Input.TextArea
              ref={questionInputRef}
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              placeholder={symbol ? `关于 ${symbol} 的问题，记录下来稍后分析…` : '请先选择一只股票'}
              disabled={!symbol}
              autoSize={{ minRows: 1, maxRows: 4 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitQuestion();
                }
              }}
              style={{
                flex: 1,
                borderRadius: 12,
                fontSize: 13,
                border: '1px solid rgba(79, 110, 247, 0.2)',
                background: 'rgba(255,255,255,0.9)',
                resize: 'none',
              }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSubmitQuestion}
              disabled={!symbol || !questionInput.trim()}
              style={{
                borderRadius: 12,
                height: 38,
                width: 38,
                padding: 0,
                background: 'linear-gradient(135deg, #4f6ef7, #6b84f8)',
                border: 'none',
                boxShadow: '0 4px 12px rgba(79, 110, 247, 0.3)',
                flexShrink: 0,
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: '#a0aec8', marginTop: 6, textAlign: 'right' }}>
            Enter 发送 · Shift+Enter 换行
          </div>
        </div>

      </div>{/* end 右侧主内容区 */}
    </div>
  );
};

export default Analysis;
