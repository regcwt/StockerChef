import { useState, useEffect, useRef, useCallback } from 'react';
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

  // 用 ref 存储最新 symbol，避免 setInterval 回调捕获旧闭包
  const symbolRef = useRef(symbol);
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);

  // useCallback 确保 fetchQuote 引用稳定，不因 symbol 变化而重建 interval
  const fetchQuote = useCallback(async () => {
    const currentSymbol = symbolRef.current;
    if (!currentSymbol) return;

    try {
      setLoading(true);
      setError(null);

      if (isCNStock(currentSymbol)) {
        // A 股：走 AKShare，不需要 Finnhub Key
        const data = await getCNQuote(currentSymbol);
        if (data) setQuote(data);
      } else if (isHKStock(currentSymbol)) {
        // 港股：走 AKShare，Finnhub 不支持港股（会返回 403）
        const rawJson = await window.electronAPI.getHKQuote(currentSymbol);
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
        const data = await getQuote(currentSymbol);
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
  }, []); // 依赖为空：通过 symbolRef 读取最新值，无需将 symbol 加入依赖

  // symbol 变化时立即重置状态并重新拉取
  useEffect(() => {
    setQuote(null);
    setError(null);
    fetchQuote();
  }, [symbol, fetchQuote]);

  // interval 变化时重建定时器，fetchQuote 引用稳定不会导致额外重建
  useEffect(() => {
    const intervalId = setInterval(fetchQuote, interval);
    return () => clearInterval(intervalId);
  }, [fetchQuote, interval]);

  return { quote, loading, error };
};
