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

/**
 * 单只股票新闻列表 hook，内置 5 分钟缓存。
 *
 * @param symbol  股票代码
 * @param enabled 是否启用（默认 true）。设为 false 时不发请求，
 *                用于详情页等"切到对应 tab 才加载"的懒加载场景
 */
export const useStockNews = (symbol: string, enabled: boolean = true): UseStockNewsResult => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // ⚠️ 关键修复：symbol 变化时必须**立即**清空旧 symbol 的新闻列表，
    // 否则在新数据到达前，UI 会一直显示上一只股票的新闻（典型场景：从 Tesla 切到
    // 其他股票，「最新消息」面板仍渲染 Tesla 的新闻直到新请求返回）。
    // 同时清空 error，避免上一只股票的错误提示残留。
    setNews([]);
    setError(null);

    if (!symbol || !enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchNews = async () => {
      // 缓存命中：直接复用上次结果，不发请求
      const cached = newsCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        if (!cancelled) setNews(cached.data);
        return;
      }

      try {
        setLoading(true);
        const data = await getNews(symbol);
        if (cancelled) return; // 防止快速切换 symbol 导致旧请求覆盖新数据
        setNews(data);
        newsCache.set(symbol, { data, timestamp: Date.now() });
      } catch (err: any) {
        if (cancelled) return;
        setError(handleAPIError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchNews();

    // cleanup：symbol 切换或组件卸载时，让旧请求的 setState 失效
    // 防止旧 symbol 的慢响应在新 symbol 已经渲染后才到达，造成数据闪回
    return () => {
      cancelled = true;
    };
  }, [symbol, enabled]);

  return { news, loading, error };
};
