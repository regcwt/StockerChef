import axios from 'axios';
import type { Quote, NewsItem, StockProfile, SearchResult, Stock } from '@/types';

const API_KEY = import.meta.env.VITE_STOCK_API_KEY;
const BASE_URL = 'https://finnhub.io/api/v1';

// Rate limiting configuration
const MAX_REQUESTS_PER_MINUTE = 30; // 50% of Finnhub free tier limit (60/min)
const REQUEST_INTERVAL = 60000 / MAX_REQUESTS_PER_MINUTE; // ~2000ms between requests

let requestQueue: Array<() => void> = [];
let isProcessing = false;
let lastRequestTime = 0;

// Request queue processor
const processQueue = async () => {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  const waitTime = Math.max(0, REQUEST_INTERVAL - timeSinceLastRequest);
  
  if (waitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  const request = requestQueue.shift();
  if (request) {
    request();
    lastRequestTime = Date.now();
  }
  
  isProcessing = false;
  
  // Process next request
  setTimeout(() => processQueue(), 100);
};

// Wrapper for API requests with rate limiting
const apiRequest = async <T>(fn: () => Promise<T>): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    
    processQueue();
  });
};

export const getQuote = async (symbol: string): Promise<Quote> => {
  return apiRequest(async () => {
    const response = await axios.get(`${BASE_URL}/quote`, {
      params: {
        symbol,
        token: API_KEY,
      },
    });
    
    const data = response.data;
    
    return {
      symbol,
      price: data.c || 0,
      change: data.d || 0,
      changePercent: data.dp || 0,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc,
      timestamp: new Date().toISOString(),
    };
  });
};

export const getProfile = async (symbol: string): Promise<Partial<Stock>> => {
  return apiRequest(async () => {
    const response = await axios.get(`${BASE_URL}/stock/profile2`, {
      params: {
        symbol,
        token: API_KEY,
      },
    });
    
    const data: StockProfile = response.data;
    
    return {
      symbol,
      name: data.name || symbol,
      marketCap: data.marketCapitalization,
      description: `${data.country} - ${data.industry}`,
    };
  });
};

export const getNews = async (symbol: string): Promise<NewsItem[]> => {
  return apiRequest(async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 7); // Last 7 days
    
    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    
    const response = await axios.get(`${BASE_URL}/company-news`, {
      params: {
        symbol,
        from: formatDate(yesterday),
        to: formatDate(today),
        token: API_KEY,
      },
    });
    
    return response.data.slice(0, 20).map((item: any) => ({
      title: item.headline,
      source: item.source,
      publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : '',
      url: item.url,
      summary: item.summary,
    }));
  });
};

export const searchSymbol = async (query: string): Promise<SearchResult[]> => {
  if (!query || query.length < 1) return [];
  
  return apiRequest(async () => {
    const response = await axios.get(`${BASE_URL}/search`, {
      params: {
        q: query,
        token: API_KEY,
      },
    });
    
    return response.data.result || [];
  });
};

// Error handler for API calls
export const handleAPIError = (error: any): string => {
  if (error.response) {
    if (error.response.status === 429) {
      return 'API rate limit exceeded. Please wait a moment.';
    }
    if (error.response.status === 401) {
      return 'Invalid API key. Please check your configuration.';
    }
    return `API Error: ${error.response.status}`;
  }
  if (error.request) {
    return 'Network error. Please check your connection.';
  }
  return error.message || 'Unknown error occurred';
};
