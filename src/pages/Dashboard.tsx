import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Input, Button, Spin, Alert, Empty, Typography, Space } from 'antd';
import { DeleteOutlined, SearchOutlined, LoadingOutlined } from '@ant-design/icons';
import { useStockStore } from '@/store/useStockStore';
import { getQuote, searchSymbol, handleAPIError } from '@/services/stockApi';
import type { SearchResult, Quote } from '@/types';
import { formatPrice, formatPercent } from '@/utils/format';

const { Title } = Typography;

const Dashboard = () => {
  const navigate = useNavigate();
  const { watchlist, quotes, updateQuote, loading, error, rateLimited, setRateLimited, setError } =
    useStockStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Load watchlist on mount
  useEffect(() => {
    useStockStore.getState().loadWatchlist();
  }, []);

  // Fetch quotes for all watchlist items
  const fetchAllQuotes = async () => {
    if (watchlist.length === 0) return;

    setRefreshing(true);
    setError(null);

    try {
      const quotePromises = watchlist.map(async (symbol) => {
        try {
          const quote = await getQuote(symbol);
          return quote;
        } catch (err: any) {
          if (err.response?.status === 429) {
            setRateLimited(true);
            setTimeout(() => setRateLimited(false), 60000);
          }
          return null;
        }
      });

      const results = await Promise.all(quotePromises);
      const validQuotes = results.filter((q): q is Quote => q !== null);
      useStockStore.getState().updateQuotes(validQuotes);
    } catch (err: any) {
      setError(handleAPIError(err));
    } finally {
      setRefreshing(false);
    }
  };

  // Auto-refresh quotes every 10 seconds
  useEffect(() => {
    fetchAllQuotes();
    const interval = setInterval(fetchAllQuotes, 10000);
    return () => clearInterval(interval);
  }, [watchlist]);

  // Search for stocks
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query || query.length < 1) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const results = await searchSymbol(query);
      setSearchResults(results.slice(0, 5));
    } catch (err: any) {
      setError(handleAPIError(err));
    } finally {
      setSearching(false);
    }
  };

  // Add stock to watchlist
  const handleAddStock = async (symbol: string) => {
    await useStockStore.getState().addToWatchlist(symbol);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Remove stock from watchlist
  const handleRemoveStock = async (symbol: string) => {
    await useStockStore.getState().removeFromWatchlist(symbol);
  };

  // Navigate to analysis page
  const handleStockClick = (symbol: string) => {
    navigate(`/analysis/${symbol}`);
  };

  return (
    <div>
      <Title level={2} style={{ marginBottom: 24 }}>
        My Watchlist
      </Title>

      {/* Search and Add */}
      <Card style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Input.Search
            placeholder="Search stocks (e.g., AAPL, TSLA, MSFT)"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onSearch={() => {}}
            prefix={<SearchOutlined />}
            enterButton="Add"
            size="large"
            loading={searching}
          />
          {searchResults.length > 0 && (
            <div>
              {searchResults.map((result) => (
                <Button
                  key={result.symbol}
                  type="text"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => handleAddStock(result.symbol)}
                >
                  <strong>{result.displaySymbol || result.symbol}</strong> -{' '}
                  {result.description}
                </Button>
              ))}
            </div>
          )}
        </Space>
      </Card>

      {/* Error and Rate Limit Alerts */}
      {error && (
        <Alert
          message="Error"
          description={error}
          type="error"
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}
      {rateLimited && (
        <Alert
          message="Rate Limited"
          description="API rate limit exceeded. Please wait a moment before refreshing."
          type="warning"
          closable
          onClose={() => setRateLimited(false)}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Watchlist */}
      {watchlist.length === 0 ? (
        <Empty description="No stocks in watchlist. Search and add stocks above." />
      ) : (
        <Row gutter={[16, 16]}>
          {watchlist.map((symbol) => {
            const quote = quotes[symbol];
            const isPositive = quote ? quote.change >= 0 : true;

            return (
              <Col xs={24} sm={12} md={8} lg={6} key={symbol}>
                <Card
                  hoverable
                  onClick={() => handleStockClick(symbol)}
                  style={{
                    borderLeft: `4px solid ${isPositive ? '#52c41a' : '#ff4d4f'}`,
                  }}
                  extra={
                    <DeleteOutlined
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveStock(symbol);
                      }}
                      style={{ cursor: 'pointer', color: '#999' }}
                    />
                  }
                >
                  {quote ? (
                    <div>
                      <Title level={4} style={{ margin: '0 0 8px 0' }}>
                        {symbol}
                      </Title>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', margin: '8px 0' }}>
                        {formatPrice(quote.price)}
                      </div>
                      <div
                        className={isPositive ? 'stock-up' : 'stock-down'}
                        style={{ fontSize: '16px', fontWeight: 'bold' }}
                      >
                        {formatPercent(quote.changePercent)} ({formatPrice(quote.change)})
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                      <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                      <div style={{ marginTop: 8, color: '#999' }}>Loading...</div>
                    </div>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* Refresh Button */}
      {watchlist.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Button onClick={fetchAllQuotes} loading={refreshing} size="large">
            Refresh All Quotes
          </Button>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
