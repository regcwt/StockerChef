import { useState, useEffect, useRef } from 'react';
import type { Quote } from '@/types';
import { getQuote, handleAPIError, isCNStock, isHKStock, getCNQuote } from '@/services/stockApi';

interface UseStockQuoteResult {
  quote: Quote | null;
  loading: boolean;
  error: string | null;
}

export const useStockQuote = (symbol: string, interval: number = 10000): UseStockQuoteResult => {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchQuote = async () => {
    if (!symbol) return;

    try {
      setLoading(true);
      setError(null);

      if (isCNStock(symbol)) {
        // A 股：走 AKShare，不需要 Finnhub Key
        const data = await getCNQuote(symbol);
        if (data) setQuote(data);
      } else if (isHKStock(symbol)) {
        // 港股：走 yfinance，Finnhub 不支持港股（会返回 403）
        const rawJson = await window.electronAPI.getHKQuote(symbol);
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const item = parsed[0];
          setQuote({
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
          });
        }
      } else {
        // 美股：走 Finnhub（需要 API Key）
        const data = await getQuote(symbol);
        setQuote(data);
      }
    } catch (err: any) {
      const errorMessage = handleAPIError(err);
      // Finnhub Key 缺失时静默处理，不显示错误
      if (!errorMessage.includes('API Key not configured')) {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuote();
    
    // Set up polling
    intervalRef.current = setInterval(fetchQuote, interval);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [symbol, interval]);

  return { quote, loading, error };
};
