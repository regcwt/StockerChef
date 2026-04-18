export const formatPrice = (price: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
};

export const formatPercent = (percent: number): string => {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
};

export const formatMarketCap = (cap: number): string => {
  if (cap >= 1e12) {
    return `$${(cap / 1e12).toFixed(2)}T`;
  }
  if (cap >= 1e9) {
    return `$${(cap / 1e9).toFixed(2)}B`;
  }
  if (cap >= 1e6) {
    return `$${(cap / 1e6).toFixed(2)}M`;
  }
  if (cap >= 1e3) {
    return `$${(cap / 1e3).toFixed(2)}K`;
  }
  return `$${cap.toFixed(2)}`;
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
