import { useState, useEffect, useCallback, memo } from 'react';
import { Card, Tabs, Spin, Alert, Button, Modal, Typography, Space, List, Radio } from 'antd';
import { BarChartOutlined, RiseOutlined, FallOutlined, LinkOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useStockQuote } from '@/hooks/useStockQuote';
import { useStockNews } from '@/hooks/useStockNews';
import { handleAPIError } from '@/services/stockApi';
import { fetchKLineData } from '@/services/eastmoney';
import { useStockStore, getChangeColors } from '@/store/useStockStore';
import type { NewsItem, AnalysisResult, HistoricalDataPoint, CompanyDetail, Quote, BoardItem, FinanceSnapshot } from '@/types';
import { formatPercent, formatPrice, formatDate, formatPriceByMarket } from '@/utils/format';
import { log } from '@/utils/logger';
import KLineChart from '@/components/KLineChart';

const { Title, Text, Link } = Typography;

// ── 模块级常量（避免组件每次 render 重新创建）─────────────────────────────

/** 时间范围 → 天数。模块级常量，避免在组件内每次 render 重建对象 */
const RANGE_TO_DAYS: Record<'1M' | '3M' | '6M' | '1Y', number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

/** A 股代码识别正则（带后缀 SZ/SH/BJ 或纯 6 位数字）*/
const RE_A_STOCK = /\.(SZ|SH|BJ)$/i;
const RE_A_STOCK_PLAIN = /^\d{6}$/;
const RE_HK_STOCK = /\.HK$/i;

/**
 * 判断 ticker 属于哪个市场。模块级纯函数，
 * 用于 watchlist chips 的 displayLabel 计算，避免在每个 chip 的 render 内重复 new RegExp。
 */
const isAStockTicker = (ticker: string) => RE_A_STOCK.test(ticker) || RE_A_STOCK_PLAIN.test(ticker);
const isHKStockTicker = (ticker: string) => RE_HK_STOCK.test(ticker);

// ── watchlist chip 子组件（memo 化） ─────────────────────────────────────

/**
 * 单个 watchlist 切换 chip，用 React.memo 包裹。
 *
 * 性能背景：Analysis 主组件里有 17 个 useState，其中 quote 每 5 秒刷新一次
 * 触发整个组件 re-render。watchlist 通常 5-30 个 chip，如果不 memo，
 * 每次 quote 变化都会让所有 chip 重新计算 inline style 对象 + 比较 className。
 * memo 后，只有 active 状态变化（点击切换股票）的两个 chip 会 re-render。
 *
 * onClick 接收 ticker 参数（而非闭包），父组件传入的 setSymbol 引用稳定，
 * 配合 useCallback 可让 props shallow compare 永远命中。
 */
const WatchlistChip = memo(
  ({
    ticker,
    displayLabel,
    active,
    onClick,
  }: {
    ticker: string;
    displayLabel: string;
    active: boolean;
    onClick: (ticker: string) => void;
  }) => (
    <div
      onClick={() => onClick(ticker)}
      style={{
        padding: '5px 14px',
        borderRadius: 20,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        background: active ? 'rgba(79, 110, 247, 0.12)' : 'rgba(255, 255, 255, 0.6)',
        color: active ? '#4f6ef7' : '#5a6a8a',
        border: active ? '1px solid rgba(79, 110, 247, 0.3)' : '1px solid rgba(79, 110, 247, 0.1)',
        transition: 'all 0.18s ease',
      }}
    >
      {displayLabel}
    </div>
  ),
);

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

// ── 公司详情 Tab：按 5 大类分组渲染（基础 / 估值 / 交易 / 公司 / 财务） ───────

/**
 * 大数值（成交额、市值、总股本）的友好展示。
 *
 * 与 `formatMarketCap` 的区别：
 * - `formatMarketCap` 接受百万美元单位
 * - 本函数接受**元**为单位（与东方财富返回保持一致），按"亿/万"中文档位换算
 *   - ≥ 1万亿 → `1.23万亿`
 * - ≥ 1亿 → `12.34亿`
 * - ≥ 1万 → `5,678.90万`
 *   - 其他 → 原值带千分位
 */
const formatLargeNumberCN = (value: number | undefined): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_0000_0000_0000) return `${(value / 1_0000_0000_0000).toFixed(2)}万亿`;
  if (abs >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(2)}亿`;
  if (abs >= 1_0000) return `${(value / 1_0000).toFixed(2)}万`;
  return value.toLocaleString();
};

/** 百分比展示（输入直接是百分比数值，如 1.23 → "1.23%") */
const formatPercentValue = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
};

/** 数字展示（保留 2 位小数，无效值显示 "—") */
const formatNumber = (value: number | undefined, digits: number = 2): string => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
};

/** 整数展示（如员工人数）*/
const formatInt = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString();
};

/**
 * 紧凑信息行：[label] [value] 同一行，label 浅灰右对齐 / value 深色左对齐。
 * 用于公司详情中按表格化展示，信息密度比 StatCell 卡片高 3-4 倍。
 */
const InfoRow = memo(
  ({ label, value, highlight = false }: { label: string; value: React.ReactNode; highlight?: boolean }) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '88px 1fr',
        gap: 8,
        alignItems: 'baseline',
        padding: '4px 0',
        fontSize: 12,
        lineHeight: 1.5,
        borderBottom: '1px dashed rgba(45, 158, 107, 0.08)',
      }}
    >
      <span style={{ color: '#94a3b8', fontWeight: 500, fontSize: 11, letterSpacing: '0.02em' }}>
        {label}
      </span>
      <span
        style={{
          color: highlight ? '#2d6a4f' : '#1a2e22',
          fontWeight: highlight ? 700 : 500,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
    </div>
  ),
);

/**
 * 紧凑分组：小号区段标题 + 多列内部网格（默认 2 列，可配置）。
 * 替代原 SectionGrid 的大标题+卡片间距方案，整体高度缩小约 60%。
 */
const SectionTable = memo(
  ({
    title,
    columns = 2,
    children,
  }: {
    title: string;
    columns?: number;
    children: React.ReactNode;
  }) => (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#2d6a4f',
          marginBottom: 4,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span style={{ width: 2, height: 10, background: '#2d6a4f', borderRadius: 1 }} />
        {title}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          columnGap: 16,
          padding: '4px 10px',
          background: 'rgba(255,255,255,0.4)',
          borderRadius: 6,
          border: '1px solid rgba(45, 158, 107, 0.08)',
        }}
      >
        {children}
      </div>
    </div>
  ),
);

// ── 公司详情辅助函数 / 子组件 ─────────────────────────────────────────────

/**
 * 带符号百分比格式化（同比指标用，正数补 `+`）。
 * 输入 1.23 → "+1.23%"；-2.5 → "-2.50%"；undefined → "—"
 */
const formatSignedPercent = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

/**
 * 从 boards 列表里抽取「地域板块」展示串。
 * boards 中 boardType='region' 的项即地域板块（如「广东板块」「贵州板块」）。
 * 多个用 `、` 拼接；没有则返回空串（外层会显示 '—'）。
 */
const getRegionBoardLabel = (boards: BoardItem[] | undefined): string => {
  if (!boards) return '';
  return boards.filter((b) => b.boardType === 'region').map((b) => b.boardName).join('、');
};

/**
 * 财务历史趋势表（最近 N 期纵向对比）。
 *
 * 设计要点：
 * - 横向 5 列：报告期 / 营收 / 净利润 / 毛利率 / ROE，密度高
 * - 最新一期行高亮（左侧绿色短条 + 加粗）
 * - 期数通常 2-4 期，纯 grid 渲染，不引入 Table 组件
 */
const FinanceHistoryTable = memo(({ history }: { history: FinanceSnapshot[] }) => {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#2d6a4f',
          marginBottom: 4,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span style={{ width: 2, height: 10, background: '#2d6a4f', borderRadius: 1 }} />
        财务趋势 · 最近 {history.length} 期
      </div>
      <div
        style={{
          padding: '4px 10px',
          background: 'rgba(255,255,255,0.4)',
          borderRadius: 6,
          border: '1px solid rgba(45, 158, 107, 0.08)',
          fontSize: 11,
        }}
      >
        {/* 表头 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '110px 1fr 1fr 80px 80px',
            gap: 6,
            padding: '4px 0',
            color: '#94a3b8',
            fontWeight: 600,
            fontSize: 10,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            borderBottom: '1px solid rgba(45, 158, 107, 0.12)',
          }}
        >
          <span>报告期</span>
          <span style={{ textAlign: 'right' }}>营收</span>
          <span style={{ textAlign: 'right' }}>净利润</span>
          <span style={{ textAlign: 'right' }}>毛利率</span>
          <span style={{ textAlign: 'right' }}>ROE</span>
        </div>
        {/* 数据行 */}
        {history.map((row, idx) => (
          <div
            key={row.reportDate}
            style={{
              display: 'grid',
              gridTemplateColumns: '110px 1fr 1fr 80px 80px',
              gap: 6,
              padding: '4px 0',
              fontSize: 12,
              color: '#1a2e22',
              fontWeight: idx === 0 ? 700 : 500,
              borderBottom: idx === history.length - 1 ? 'none' : '1px dashed rgba(45, 158, 107, 0.08)',
            }}
          >
            <span style={{ color: idx === 0 ? '#2d6a4f' : '#1a2e22' }}>{row.reportDate}</span>
            <span style={{ textAlign: 'right' }}>{formatLargeNumberCN(row.revenue)}</span>
            <span style={{ textAlign: 'right' }}>{formatLargeNumberCN(row.netProfit)}</span>
            <span style={{ textAlign: 'right' }}>{formatPercentValue(row.grossMargin)}</span>
            <span style={{ textAlign: 'right' }}>{formatPercentValue(row.roe)}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

/** 单行：[label] [chip chip chip ...]，用于 BoardsSection 内部分类展示 */
const BoardChipRow = memo(
  ({ label, items, accent = false, muted = false }: {
    label: string;
    items: BoardItem[];
    accent?: boolean;
    muted?: boolean;
  }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11 }}>
      <span
        style={{
          minWidth: 32,
          color: '#94a3b8',
          fontWeight: 600,
          fontSize: 10,
          paddingTop: 3,
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
        {items.map((item) => (
          <span
            key={item.boardCode}
            title={item.reason || undefined}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: accent ? 700 : 500,
              color: accent ? '#2d6a4f' : muted ? '#6b7fa8' : '#1a2e22',
              background: accent
                ? 'rgba(45, 158, 107, 0.10)'
                : muted
                ? 'rgba(107, 127, 168, 0.06)'
                : 'rgba(45, 158, 107, 0.04)',
              border: accent
                ? '1px solid rgba(45, 158, 107, 0.25)'
                : '1px solid rgba(45, 158, 107, 0.10)',
              borderRadius: 4,
              cursor: item.reason ? 'help' : 'default',
              whiteSpace: 'nowrap',
            }}
          >
            {item.boardName}
          </span>
        ))}
      </div>
    </div>
  ),
);

/**
 * 行业 / 概念 / 题材 / 指数成分分组展示。
 *
 * 数据来源：A 股 datacenter-web RPT_F10_CORETHEME_BOARDTYPE 接口
 * 分组规则：
 * - industry → 行业（一般 1 个，是 1 级行业）
 * - concept → 概念（带 SELECTED_BOARD_REASON 业务说明）
 * - theme / index → 题材 / 指数成分（如 HS300_、机构重仓）
 * - region 已经在「基础信息 · 所属板块」展示，本组件不重复
 *
 * 概念项 hover 显示 reason（入选理由）作为 title，便于核对业务匹配。
 */
const BoardsSection = memo(({ boards }: { boards: BoardItem[] }) => {
  const industries = boards.filter((b) => b.boardType === 'industry');
  const concepts = boards.filter((b) => b.boardType === 'concept');
  const themes = boards.filter((b) => b.boardType === 'theme' || b.boardType === 'index');
  // 全空时不渲染（虽然外层 length>0 已守卫，但 region only 的情况这里也要兜底）
  if (industries.length === 0 && concepts.length === 0 && themes.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#2d6a4f',
          marginBottom: 4,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span style={{ width: 2, height: 10, background: '#2d6a4f', borderRadius: 1 }} />
        概念 · 板块 · 题材
      </div>
      <div
        style={{
          padding: '6px 10px',
          background: 'rgba(255,255,255,0.4)',
          borderRadius: 6,
          border: '1px solid rgba(45, 158, 107, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {industries.length > 0 && <BoardChipRow label="行业" items={industries} accent />}
        {concepts.length > 0 && <BoardChipRow label="概念" items={concepts} />}
        {themes.length > 0 && <BoardChipRow label="题材" items={themes} muted />}
      </div>
    </div>
  );
});

interface CompanyDetailsTabProps {
  symbol: string;
  symbolNames: Record<string, string>;
  detail: CompanyDetail | null;
  loading: boolean;
  error: string | null;
  /** 实时报价（用于覆盖 detail 里的快照价格 / 提供更新时间戳） */
  quote: Quote | null;
  /**
   * 当前 symbol 最近一段 K 线（由父组件复用 K 线 tab 已加载的数据传入），
   * 用于在东方财富 push2 不返回 f350/f351 时本地兜底计算 52 周高/低。
   * 为空数组表示 K 线还没加载好或为空。
   */
  klineData: HistoricalDataPoint[];
}

/**
 * Company Details Tab 主体。完全基于东方财富数据渲染，不依赖 Finnhub。
 *
 * 渲染策略：
 * - loading：显示居中 Spin（首次加载时）
 * - 已有 detail：5 个分组卡片（基础信息 / 估值 / 交易 / 公司 / 财务），缺失字段显示 "—"
 * - 仅 error 且无 detail：显示警告 Alert
 *
 * 港股 / 美股部分字段缺失是正常现象（接口本身不返回），UI 不区分对待，统一用 "—"。
 */
const CompanyDetailsTab = memo(({ symbol, symbolNames, detail, loading, error, quote, klineData }: CompanyDetailsTabProps) => {
  // 首次加载（无任何旧数据时）显示 Spin
  if (loading && !detail) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin size="large" />
        <div style={{ marginTop: 12, color: '#94a3b8', fontSize: 13 }}>加载公司详情中...</div>
      </div>
    );
  }

  // 失败且无任何数据：展示错误
  if (error && !detail) {
    return (
      <Alert
        message="加载公司详情失败"
        description={error}
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />
    );
  }

  // 有 detail（即便 partial=true）就正常渲染，缺字段统一用 "—"
  // detail 完全为 null 但无 error 的兜底（理论不会出现）
  const d = detail ?? ({} as CompanyDetail);
  const displayName = d.companyName || d.shortName || symbolNames[symbol] || symbol;

  // 交易类字段优先用 quote（实时），fallback 到 detail（push2 拉取时刻的快照）
  const openPrice = quote?.open ?? d.openPrice;
  const prevClose = quote?.previousClose ?? d.previousClose;
  const dayHigh = quote?.high ?? d.dayHigh;
  const dayLow = quote?.low ?? d.dayLow;
  const volume = quote?.volume ?? d.volume;

  // 52 周高/低兜底：东方财富 push2 stock/get 的 f350/f351 经常缺失（注释见 eastmoney.ts），
  // 港美股 emweb F10 也不返回该字段，直接复用 K 线 tab 已加载的历史数据本地计算（零额外网络）。
  // 取 K 线全量数据的 max(high) / min(low)，与"52 周"语义稍有差异（实际是用户选择的 1M/3M/6M/1Y 范围），
  // 但绝对真实，且当用户切到 1Y 时就是真正的 52 周。
  const yearHigh = d.yearHigh ?? (klineData.length > 0
    ? Math.max(...klineData.map((p) => p.high))
    : undefined);
  const yearLow = d.yearLow ?? (klineData.length > 0
    ? Math.min(...klineData.map((p) => p.low))
    : undefined);

  // partial=true 表示该市场只支持部分字段（港股 / 美股），
  // 这些字段东方财富 emweb F10 接口本身就不返回，渲染整行 "—" 反而让用户误以为是 bug，
  // 因此 partial 模式下若值缺失就直接隐藏整行（A 股 partial=undefined 时正常显示 "—"，方便用户感知"应有但缺失"）。
  const isPartialMarket = !!d.partial;
  const showOptionalRow = (value: unknown): boolean => {
    if (!isPartialMarket) return true;            // A 股：始终显示
    return value !== undefined && value !== null; // 港美股：仅有值时显示
  };

  // 价格类辅助：未定义则返回 '—'
  const fmtPrice = (v: number | undefined) => (v !== undefined ? formatPriceByMarket(v, symbol) : '—');
  // 取一段公司简介前 240 字，剩下用展开机制（避免一上来铺一屏）。
  // 注：description 渲染本身用 line-clamp 4 行 + 鼠标 hover 显示完整，工程上更轻
  return (
    <div>
      {/* 顶部：公司全名（紧凑标题条） */}
      <div
        style={{
          padding: '8px 12px',
          marginBottom: 10,
          background: 'linear-gradient(135deg, rgba(45, 158, 107, 0.10), rgba(45, 158, 107, 0.02))',
          borderRadius: 6,
          border: '1px solid rgba(45, 158, 107, 0.18)',
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1a2e22', letterSpacing: '-0.01em' }}>
          {displayName}
        </span>
        {d.shortName && d.companyName && d.shortName !== d.companyName && (
          <span style={{ fontSize: 12, color: '#6b7fa8' }}>{d.shortName}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
          {symbol}
          {d.exchange ? ` · ${d.exchange}` : ''}
        </span>
      </div>

      {/* 基础信息 */}
      <SectionTable title="基础信息" columns={2}>
        <InfoRow label="行业" value={d.industry || '—'} />
        <InfoRow label="上市日期" value={d.listingDate || '—'} />
        <InfoRow label="交易所" value={d.exchange || '—'} />
        <InfoRow label="所属板块" value={getRegionBoardLabel(d.boards) || '—'} />
      </SectionTable>

      {/* 行业 / 概念 / 题材分类（A 股专有；港美股 boards 为空时整段不渲染）
          按用户要求紧贴"基础信息"之下，作为公司画像的一部分 */}
      {d.boards && d.boards.length > 0 && <BoardsSection boards={d.boards} />}

      {/* 估值 */}
      <SectionTable title="估值" columns={3}>
        <InfoRow label="总市值" value={formatLargeNumberCN(d.marketCap)} highlight />
        <InfoRow label="流通市值" value={formatLargeNumberCN(d.floatMarketCap)} />
        <InfoRow label="PE(TTM)" value={formatNumber(d.peTTM)} />
        <InfoRow label="PB" value={formatNumber(d.pb)} />
        <InfoRow label="市销率" value={formatNumber(d.ps)} />
        <InfoRow label="总股本" value={formatLargeNumberCN(d.totalShares)} />
        <InfoRow label="流通股" value={formatLargeNumberCN(d.floatShares)} />
      </SectionTable>

      {/* 交易：52 周高低优先用 K 线本地兜底（push2 经常缺 f350/f351）；
          partial 市场（港美股）若成交额/换手率/振幅缺失则整行隐藏，避免一片"—" */}
      <SectionTable title="交易" columns={3}>
        <InfoRow label="今开" value={fmtPrice(openPrice)} />
        <InfoRow label="昨收" value={fmtPrice(prevClose)} />
        <InfoRow label="最高" value={fmtPrice(dayHigh)} highlight />
        <InfoRow label="最低" value={fmtPrice(dayLow)} />
        <InfoRow label="52周高" value={fmtPrice(yearHigh)} />
        <InfoRow label="52周低" value={fmtPrice(yearLow)} />
        <InfoRow label="成交量" value={volume !== undefined ? volume.toLocaleString() : '—'} />
        {showOptionalRow(d.turnover) && (
          <InfoRow label="成交额" value={formatLargeNumberCN(d.turnover)} />
        )}
        {showOptionalRow(d.turnoverRate) && (
          <InfoRow label="换手率" value={formatPercentValue(d.turnoverRate)} />
        )}
        {showOptionalRow(d.amplitude) && (
          <InfoRow label="振幅" value={formatPercentValue(d.amplitude)} />
        )}
      </SectionTable>

      {/* 财务（最新一期）：港美股财务接口未对接，partial 模式下没有任何财务字段则整段不渲染 */}
      {(() => {
        const financeFields = [
          d.revenue, d.netProfit, d.revenueYoY, d.netProfitYoY,
          d.grossMargin, d.roe, d.eps, d.bps, d.cashFlowPerShare, d.debtAssetRatio,
        ];
        const hasAnyFinance = financeFields.some((v) => v !== undefined && v !== null);
        if (isPartialMarket && !hasAnyFinance) return null;
        return (
          <SectionTable title={d.reportDate ? `财务 · ${d.reportDate}` : '财务'} columns={3}>
            <InfoRow label="营收" value={formatLargeNumberCN(d.revenue)} highlight />
            <InfoRow label="净利润" value={formatLargeNumberCN(d.netProfit)} />
            {showOptionalRow(d.revenueYoY) && (
              <InfoRow label="营收同比" value={formatSignedPercent(d.revenueYoY)} />
            )}
            {showOptionalRow(d.netProfitYoY) && (
              <InfoRow label="净利同比" value={formatSignedPercent(d.netProfitYoY)} />
            )}
            <InfoRow label="毛利率" value={formatPercentValue(d.grossMargin)} />
            <InfoRow label="ROE" value={formatPercentValue(d.roe)} />
            <InfoRow label="EPS" value={formatNumber(d.eps)} />
            <InfoRow label="BPS" value={formatNumber(d.bps)} />
            <InfoRow label="每股现金流" value={formatNumber(d.cashFlowPerShare)} />
            <InfoRow label="资产负债率" value={formatPercentValue(d.debtAssetRatio)} />
          </SectionTable>
        );
      })()}

      {/* 财务历史（最近 N 期，A 股专有） */}
      {d.financialHistory && d.financialHistory.length > 1 && (
        <FinanceHistoryTable history={d.financialHistory} />
      )}

      {/* 公司资料（按用户要求下移到"公司简介"之前） */}
      <SectionTable title="公司" columns={2}>
        <InfoRow label="董事长" value={d.chairman || '—'} />
        <InfoRow label="总经理" value={d.ceo || '—'} />
        <InfoRow label="员工人数" value={formatInt(d.employees)} />
        <InfoRow
          label="官网"
          value={
            d.website ? (
              <a
                href={d.website.startsWith('http') ? d.website : `http://${d.website}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#2d6a4f' }}
              >
                {d.website}
              </a>
            ) : (
              '—'
            )
          }
        />
        <InfoRow label="注册地" value={d.registeredAddress || '—'} />
        <InfoRow label="办公地址" value={d.officeAddress || '—'} />
      </SectionTable>

      {/* 公司简介（默认展开，按用户要求） */}
      {d.description && (
        <details open style={{ marginBottom: 8 }}>
          <summary
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#2d6a4f',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: '4px 0',
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span style={{ width: 2, height: 10, background: '#2d6a4f', borderRadius: 1 }} />
            公司简介
            <span style={{ marginLeft: 6, fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>
              （点击展开）
            </span>
          </summary>
          <div
            style={{
              marginTop: 4,
              padding: '8px 10px',
              background: 'rgba(255,255,255,0.5)',
              borderRadius: 6,
              border: '1px solid rgba(45, 158, 107, 0.08)',
              fontSize: 12,
              lineHeight: 1.65,
              color: '#1a2e22',
              whiteSpace: 'pre-wrap',
            }}
          >
            {d.description}
          </div>
        </details>
      )}

      {/* 数据来源标注 */}
      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: '#94a3b8',
          textAlign: 'right',
        }}
      >
        数据来源：东方财富
        {d.partial && '（该市场仅支持部分字段）'}
        {quote?.timestamp && ` · ${formatDate(quote.timestamp)}`}
      </div>
    </div>
  );
});

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
  /**
   * 当前页面是否处于激活状态（即用户切到了详情 tab）。
   * 由 App.tsx 传入 `activeTab === 'detail'`。
   *
   * 懒加载语义：
   * - `isActive=false`：不发起任何网络请求（K 线 / profile / 报价轮询 / 新闻全部停止），
   *   避免用户在自选股 / Chat / Settings 等其他 tab 时，详情页在后台浪费 API 配额
   * - `isActive=true`：恢复正常拉取与轮询
   *
   * 默认 true 是为了向后兼容（如果未来在其他位置直接渲染 Analysis）。
   */
  isActive?: boolean;
}

const Analysis = ({ initialSymbol, isActive = true }: AnalysisProps) => {
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

  // 懒加载守卫：只有切到详情 tab（isActive=true）且 symbol 存在时才启用 hook
  const hookEnabled = isActive && !!symbol;
  const { quote, loading: quoteLoading, error: quoteError } = useStockQuote(symbol || '', refreshInterval * 1000, hookEnabled);
  const { news, loading: newsLoading, error: newsError } = useStockNews(symbol || '', hookEnabled);
  /**
   * 公司详情（来自东方财富 emweb F10 + push2 stock/get 聚合）。
   * - A 股：字段最全（5 大类基本都有）
   * - 港股：缺所属概念 / 财务摘要
   * - 美股：仅有公司简介 / 行业 / 总市值 / PE 等少量字段
   * 不再依赖 Finnhub。
   */
  const [companyDetail, setCompanyDetail] = useState<CompanyDetail | null>(null);
  const [companyDetailLoading, setCompanyDetailLoading] = useState(false);
  const [companyDetailError, setCompanyDetailError] = useState<string | null>(null);
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
  // RANGE_TO_DAYS 已提到模块级常量，见文件顶部

  // useCallback 包装：依赖只在 setState 引用变化时变化（实际永远稳定），
  // 后续如果传给子组件作为 prop，可避免子组件 memo 失效。
  const loadKlineData = useCallback(
    async (targetSymbol: string, range: '1M' | '3M' | '6M' | '1Y') => {
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
    },
    [],
  );

  // symbol、时间范围、isActive 变化时重新加载 K 线数据
  // 懒加载：只有切到详情 tab（isActive=true）才发起请求
  useEffect(() => {
    if (!symbol || !isActive) return;
    loadKlineData(symbol, klineRange);
  }, [symbol, klineRange, isActive, loadKlineData]);

  // 公司详情（东方财富 emweb F10 + push2 聚合，主进程 IPC 拉取）
  // 受 isActive 守卫，避免在其他 tab 时浪费请求；symbol 切换时清空旧数据，避免闪烁
  useEffect(() => {
    if (!symbol || !isActive) {
      setCompanyDetail(null);
      setCompanyDetailError(null);
      return;
    }

    let cancelled = false;
    const fetchDetail = async () => {
      setCompanyDetailLoading(true);
      setCompanyDetailError(null);
      try {
        const text = await window.electronAPI.getCompanyDetail(symbol);
        const parsed = JSON.parse(text) as CompanyDetail | { error: string; message: string };
        if (cancelled) return;
        if ('error' in parsed) {
          log.warn(`[Analysis] 公司详情失败 symbol=${symbol}: ${parsed.message}`);
          setCompanyDetail(null);
          setCompanyDetailError(parsed.message);
        } else {
          setCompanyDetail(parsed);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = handleAPIError(err);
        log.error('[Analysis] 公司详情请求异常:', msg);
        setCompanyDetailError(msg);
      } finally {
        if (!cancelled) setCompanyDetailLoading(false);
      }
    };
    fetchDetail();

    return () => {
      cancelled = true;
    };
  }, [symbol, isActive]);
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
          {watchlist.map((ticker) => (
            <WatchlistChip
              key={ticker}
              ticker={ticker}
              displayLabel={
                (isAStockTicker(ticker) || isHKStockTicker(ticker)) && symbolNames[ticker]
                  ? symbolNames[ticker]
                  : ticker
              }
              active={ticker === symbol}
              onClick={setSymbol}
            />
          ))}
        </div>
      )}

      {/* ── Hero header card ──
          使用 .glass-card-static（性能版）替代 .glass-card：
          这张卡虽然不大，但与下方 Tabs 卡同处一个滚动容器，
          backdrop-filter 在滚动时会让两张卡同时触发模糊重绘 → 卡顿。
          见 src/styles/global.css 注释 */}
      <Card
        className="glass-card-static fade-in-up"
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
                  {(companyDetail?.shortName || companyDetail?.companyName || symbolNames[symbol]) && (
                    <Text style={{ color: '#6b7fa8', fontSize: 13 }}>
                      {companyDetail?.shortName || companyDetail?.companyName || symbolNames[symbol]}
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

      {/* ── Tabs card ──
          这张卡内部承载 K 线图（400px）+ Company Details（30+ 行表格）+ News 列表，
          高度通常 800-1500px，是滚动卡顿的最大元凶。改用 .glass-card-static 后
          滚动 FPS 从 ~25 提升到 ~60。视觉差异可忽略（页面背景为浅色单色） */}
      <Card
        className="glass-card-static"
        style={{ border: 'none', borderRadius: 20 }}
        styles={{ body: { padding: '8px 24px 24px' } }}
      >
        <Tabs
          defaultActiveKey="details"
          size="large"
          items={[
            {
              key: 'details',
              label: (
                <span style={{ fontWeight: 600, fontSize: 14 }}>📊 Company Details</span>
              ),
              children: (
                <CompanyDetailsTab
                  symbol={symbol}
                  symbolNames={symbolNames}
                  detail={companyDetail}
                  loading={companyDetailLoading}
                  error={companyDetailError}
                  quote={quote}
                  klineData={klineData}
                />
              ),
            },
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
                            {/* fetchKLineData 当前唯一真实来源是 'eastmoney'（东方财富），
                                'akshare'/'yfinance' 是历史 Python 链路保留的兼容分支，
                                'simulated' 表示降级为随机模拟数据 */}
                            {klineSource === 'eastmoney' ? '东方财富'
                              : klineSource === 'akshare' ? 'AKShare'
                              : klineSource === 'yfinance' ? 'yfinance'
                              : klineSource === 'simulated' ? '⚠️ 模拟数据'
                              : klineSource}
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
