import { create } from 'zustand';
import type { Quote } from '@/types';

interface StockState {
  watchlist: string[];
  quotes: Record<string, Quote>;
  loading: boolean;
  error: string | null;
  rateLimited: boolean;
  
  // Actions
  addToWatchlist: (symbol: string) => Promise<void>;
  removeFromWatchlist: (symbol: string) => Promise<void>;
  updateQuote: (symbol: string, quote: Quote) => void;
  updateQuotes: (quotes: Quote[]) => void;
  loadWatchlist: () => Promise<void>;
  saveWatchlist: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setRateLimited: (limited: boolean) => void;
}

export const useStockStore = create<StockState>((set, get) => ({
  watchlist: [],
  quotes: {},
  loading: false,
  error: null,
  rateLimited: false,
  
  addToWatchlist: async (symbol: string) => {
    const upperSymbol = symbol.toUpperCase().trim();
    const currentWatchlist = get().watchlist;
    
    if (currentWatchlist.includes(upperSymbol)) {
      return; // Already in watchlist
    }
    
    const newWatchlist = [...currentWatchlist, upperSymbol];
    set({ watchlist: newWatchlist });
    
    // Save to electron-store
    await get().saveWatchlist();
  },
  
  removeFromWatchlist: async (symbol: string) => {
    const newWatchlist = get().watchlist.filter(s => s !== symbol);
    set({ watchlist: newWatchlist });
    
    // Remove quote data
    const newQuotes = { ...get().quotes };
    delete newQuotes[symbol];
    set({ quotes: newQuotes });
    
    // Save to electron-store
    await get().saveWatchlist();
  },
  
  updateQuote: (symbol: string, quote: Quote) => {
    set((state) => ({
      quotes: {
        ...state.quotes,
        [symbol]: quote,
      },
    }));
  },
  
  updateQuotes: (quotes: Quote[]) => {
    const quotesMap = quotes.reduce((acc, quote) => {
      acc[quote.symbol] = quote;
      return acc;
    }, {} as Record<string, Quote>);
    
    set((state) => ({
      quotes: {
        ...state.quotes,
        ...quotesMap,
      },
    }));
  },
  
  loadWatchlist: async () => {
    try {
      const saved = await window.electronAPI.getStore('watchlist');
      if (Array.isArray(saved)) {
        set({ watchlist: saved });
      }
    } catch (error) {
      console.error('Failed to load watchlist:', error);
    }
  },
  
  saveWatchlist: async () => {
    try {
      await window.electronAPI.setStore('watchlist', get().watchlist);
    } catch (error) {
      console.error('Failed to save watchlist:', error);
    }
  },
  
  setLoading: (loading: boolean) => {
    set({ loading });
  },
  
  setError: (error: string | null) => {
    set({ error });
  },
  
  setRateLimited: (limited: boolean) => {
    set({ rateLimited: limited });
  },
}));
