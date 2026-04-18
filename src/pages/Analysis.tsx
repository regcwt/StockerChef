import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Tabs, Spin, Alert, Button, Modal, Typography, Space, Descriptions, List } from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
import { useStockQuote } from '@/hooks/useStockQuote';
import { useStockNews } from '@/hooks/useStockNews';
import { getProfile, handleAPIError } from '@/services/stockApi';
import type { Stock, NewsItem, AnalysisResult } from '@/types';
import { formatPrice, formatPercent, formatMarketCap, formatDate } from '@/utils/format';

const { Title, Text, Link } = Typography;

const Analysis = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const { quote, loading: quoteLoading, error: quoteError } = useStockQuote(symbol || '', 10000);
  const { news, loading: newsLoading, error: newsError } = useStockNews(symbol || '');
  const [profile, setProfile] = useState<Partial<Stock> | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [analysisModalVisible, setAnalysisModalVisible] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // Fetch profile on mount
  useEffect(() => {
    if (!symbol) return;

    const fetchProfile = async () => {
      setProfileLoading(true);
      try {
        const data = await getProfile(symbol);
        setProfile(data);
      } catch (err: any) {
        console.error('Failed to fetch profile:', handleAPIError(err));
      } finally {
        setProfileLoading(false);
      }
    };

    fetchProfile();
  }, [symbol]);

  // Generate technical analysis (simulated)
  const generateAnalysis = () => {
    if (!quote) return;

    setAnalysisLoading(true);
    
    // Simulate technical analysis calculation
    // In production, you would fetch historical data and calculate real indicators
    setTimeout(() => {
      const simulatedRSI = 30 + Math.random() * 40; // Random RSI between 30-70
      const currentPrice = quote.price;
      const simulatedSMA20 = currentPrice * (0.95 + Math.random() * 0.1);
      const simulatedSMA50 = currentPrice * (0.9 + Math.random() * 0.2);
      const simulatedSMA200 = currentPrice * (0.8 + Math.random() * 0.4);

      let recommendation: 'Buy' | 'Sell' | 'Hold' = 'Hold';
      let summary = '';

      if (simulatedRSI < 30) {
        recommendation = 'Buy';
        summary += 'RSI indicates oversold conditions. ';
      } else if (simulatedRSI > 70) {
        recommendation = 'Sell';
        summary += 'RSI indicates overbought conditions. ';
      }

      if (currentPrice > simulatedSMA20 && currentPrice > simulatedSMA50) {
        summary += 'Price is above short-term moving averages (bullish). ';
      } else if (currentPrice < simulatedSMA20 && currentPrice < simulatedSMA50) {
        summary += 'Price is below short-term moving averages (bearish). ';
      }

      if (!summary) {
        summary = 'Mixed signals detected. Consider waiting for clearer trends.';
      }

      setAnalysis({
        symbol: symbol || '',
        rsi: simulatedRSI,
        sma20: simulatedSMA20,
        sma50: simulatedSMA50,
        sma200: simulatedSMA200,
        recommendation,
        summary,
      });
      setAnalysisLoading(false);
      setAnalysisModalVisible(true);
    }, 1000);
  };

  if (!symbol) {
    return <Alert message="No stock symbol provided" type="error" />;
  }

  return (
    <div>
      {/* Header */}
      <Card style={{ marginBottom: 24 }}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title level={2} style={{ margin: 0 }}>
              {symbol}
            </Title>
            <Button
              type="primary"
              icon={<BarChartOutlined />}
              onClick={generateAnalysis}
              loading={analysisLoading}
              disabled={!quote}
            >
              Technical Analysis
            </Button>
          </div>
          {profile && <Title level={5} style={{ margin: 0, color: '#666' }}>{profile.name}</Title>}
          {quoteLoading ? (
            <Spin />
          ) : quote ? (
            <div>
              <Title level={1} style={{ margin: '16px 0 8px 0' }}>
                {formatPrice(quote.price)}
              </Title>
              <Text
                className={quote.change >= 0 ? 'stock-up' : 'stock-down'}
                style={{ fontSize: '20px', fontWeight: 'bold' }}
              >
                {formatPercent(quote.changePercent)} ({formatPrice(quote.change)})
              </Text>
            </div>
          ) : (
            quoteError && <Alert message={quoteError} type="error" />
          )}
        </Space>
      </Card>

      {/* Tabs */}
      <Card>
        <Tabs
          defaultActiveKey="details"
          items={[
            {
              key: 'details',
              label: 'Details',
              children: (
                <div>
                  {profileLoading ? (
                    <Spin />
                  ) : profile ? (
                    <Descriptions bordered column={2}>
                      <Descriptions.Item label="Company Name">{profile.name}</Descriptions.Item>
                      <Descriptions.Item label="Symbol">{symbol}</Descriptions.Item>
                      <Descriptions.Item label="Market Cap">
                        {profile.marketCap ? formatMarketCap(profile.marketCap) : 'N/A'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Industry">
                        {profile.description || 'N/A'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Open">
                        {quote ? formatPrice(quote.open || 0) : 'N/A'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Previous Close">
                        {quote ? formatPrice(quote.previousClose || 0) : 'N/A'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Day High">
                        {quote ? formatPrice(quote.high || 0) : 'N/A'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Day Low">
                        {quote ? formatPrice(quote.low || 0) : 'N/A'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Volume">
                        {quote?.volume ? quote.volume.toLocaleString() : 'N/A'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Last Updated">
                        {quote ? formatDate(quote.timestamp) : 'N/A'}
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert message="Failed to load profile" type="error" />
                  )}
                </div>
              ),
            },
            {
              key: 'news',
              label: 'News',
              children: (
                <div>
                  {newsLoading ? (
                    <Spin />
                  ) : newsError ? (
                    <Alert message={newsError} type="error" />
                  ) : news.length === 0 ? (
                    <Alert message="No recent news found for this stock" type="info" />
                  ) : (
                    <List
                      itemLayout="vertical"
                      dataSource={news}
                      renderItem={(item: NewsItem) => (
                        <List.Item>
                          <List.Item.Meta
                            title={
                              <Link href={item.url} target="_blank">
                                {item.title}
                              </Link>
                            }
                            description={`${item.source} • ${formatDate(item.publishedAt)}`}
                          />
                          {item.summary && (
                            <Text ellipsis={{ rows: 2 }}>{item.summary}</Text>
                          )}
                        </List.Item>
                      )}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Technical Analysis Modal */}
      <Modal
        title={`Technical Analysis - ${symbol}`}
        open={analysisModalVisible}
        onCancel={() => setAnalysisModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setAnalysisModalVisible(false)}>
            Close
          </Button>,
        ]}
        width={600}
      >
        {analysis && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Card>
              <Title level={4}>Recommendation</Title>
              <Text
                style={{
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color:
                    analysis.recommendation === 'Buy'
                      ? '#52c41a'
                      : analysis.recommendation === 'Sell'
                      ? '#ff4d4f'
                      : '#faad14',
                }}
              >
                {analysis.recommendation}
              </Text>
            </Card>

            <Descriptions bordered column={1}>
              <Descriptions.Item label="RSI (14)">
                {analysis.rsi?.toFixed(2)}
                {analysis.rsi && analysis.rsi < 30 && ' (Oversold)'}
                {analysis.rsi && analysis.rsi > 70 && ' (Overbought)'}
              </Descriptions.Item>
              <Descriptions.Item label="SMA 20">{formatPrice(analysis.sma20 || 0)}</Descriptions.Item>
              <Descriptions.Item label="SMA 50">{formatPrice(analysis.sma50 || 0)}</Descriptions.Item>
              <Descriptions.Item label="SMA 200">
                {formatPrice(analysis.sma200 || 0)}
              </Descriptions.Item>
            </Descriptions>

            <Card>
              <Title level={5}>Analysis Summary</Title>
              <Text>{analysis.summary}</Text>
            </Card>

            <Alert
              message="Note"
              description="This is a simulated technical analysis for demonstration purposes. In production, real historical data and proper indicator calculations should be used."
              type="info"
              showIcon
            />
          </Space>
        )}
      </Modal>
    </div>
  );
};

export default Analysis;
