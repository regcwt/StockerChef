/**
 * 默认按美元格式化价格（保留兼容，部分场景仍直接使用，如 Analysis 美股价）。
 */
export const formatPrice = (price: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
};

/**
 * 根据股票代码推断币种符号。
 * - A 股（6 位纯数字）→ ¥（人民币）
 * - 港股（XXXXX.HK）   → HK$（港币）
 * - 其他（默认美股）   → $（美元）
 */
export const getCurrencySymbol = (symbol: string): string => {
  if (/^\d{6}$/.test(symbol)) return '¥';
  if (/\.HK$/i.test(symbol)) return 'HK$';
  return '$';
};

/**
 * 按股票所属市场格式化价格，自动选择币种符号（¥ / HK$ / $）。
 *
 * 注意：不使用 Intl.NumberFormat 的 currency 模式，
 * 因为 HKD 在不同 locale 下渲染格式不一致（en-US 下带空格，zh-CN 下又是另一种）；
 * 直接拼接币种符号 + 千分位数字最稳定可控。
 */
export const formatPriceByMarket = (price: number, symbol: string): string => {
  const currencySign = getCurrencySymbol(symbol);
  const sign = price < 0 ? '-' : '';
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(price));
  return `${sign}${currencySign}${formatted}`;
};

export const formatPercent = (percent: number): string => {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
};

// Finnhub getProfile() 返回的 marketCapitalization 单位是百万美元，
// 此函数接受百万美元单位的输入，内部转换为实际美元后再做 T/B/M/K 换算。
export const formatMarketCap = (capInMillions: number): string => {
  const cap = capInMillions * 1_000_000;
  if (cap >= 1e12) {
    return `${(cap / 1e12).toFixed(2)}T`;
  }
  if (cap >= 1e9) {
    return `${(cap / 1e9).toFixed(2)}B`;
  }
  if (cap >= 1e6) {
    return `${(cap / 1e6).toFixed(2)}M`;
  }
  if (cap >= 1e3) {
    return `${(cap / 1e3).toFixed(2)}K`;
  }
  return `${cap.toFixed(2)}`;
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
