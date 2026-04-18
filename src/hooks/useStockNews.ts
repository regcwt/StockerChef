import { useState, useEffect } from 'react';
import type { NewsItem } from '@/types';
import { getNews, handleAPIError } from '@/services/stockApi';

interface UseStockNewsResult {
  news: NewsItem[];
  loading: boolean;
  error: string | null;
}

// Cache to avoid excessive API calls
const newsCache = new Map<string, { data: NewsItem[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const useStockNews = (symbol: string): UseStockNewsResult => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;

    const fetchNews = async () => {
      // Check cache first
      const cached = newsCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        setNews(cached.data);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const data = await getNews(symbol);
        setNews(data);
        
        // Update cache
        newsCache.set(symbol, { data, timestamp: Date.now() });
      } catch (err: any) {
        setError(handleAPIError(err));
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
  }, [symbol]);

  return { news, loading, error };
};
