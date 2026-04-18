import { useState, useEffect, useRef } from 'react';
import type { Quote } from '@/types';
import { getQuote, handleAPIError } from '@/services/stockApi';

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
      const data = await getQuote(symbol);
      setQuote(data);
    } catch (err: any) {
      setError(handleAPIError(err));
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
