import { useState, useEffect } from 'react';
import { Card, Typography, Space, Switch, Tag, Input, Button, message } from 'antd';
import { CheckCircleFilled, CheckCircleOutlined, KeyOutlined, ApiOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useStockStore, REFRESH_INTERVAL_OPTIONS, COLUMN_DEFINITIONS, DEFAULT_VISIBLE_COLUMNS } from '@/store/useStockStore';
import type { ColorMode, RefreshInterval, ColumnKey } from '@/store/useStockStore';

const { Title, Text } = Typography;


/** 涨跌色风格选项卡 */
const ColorModeCard = ({
  mode,
  label,
  description,
  upColor,
  downColor,
  selected,
  onClick,
}: {
  mode: ColorMode;
  label: string;
  description: string;
  upColor: string;
  downColor: string;
  selected: boolean;
  onClick: () => void;
}) => (
  <div
    onClick={onClick}
    style={{
      flex: 1,
      minWidth: 200,
      padding: '20px 24px',
      borderRadius: 16,
      border: selected
        ? '2px solid #4f6ef7'
        : '2px solid rgba(79, 110, 247, 0.12)',
      background: selected
        ? 'rgba(79, 110, 247, 0.06)'
        : 'rgba(255, 255, 255, 0.5)',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      position: 'relative',
    }}
  >
    {selected && (
      <CheckCircleFilled
        style={{
          position: 'absolute',
          top: 14,
          right: 14,
          color: '#4f6ef7',
          fontSize: 18,
        }}
      />
    )}

    {/* 模拟涨跌色展示 */}
    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: `${upColor}14`,
          color: upColor,
          borderRadius: 8,
          padding: '6px 12px',
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        <span style={{ fontSize: 12 }}>▲</span>
        +2.34%
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: `${downColor}14`,
          color: downColor,
          borderRadius: 8,
          padding: '6px 12px',
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        <span style={{ fontSize: 12 }}>▼</span>
        -1.56%
      </div>
    </div>

    <div style={{ fontWeight: 700, fontSize: 15, color: '#0f1a2e', marginBottom: 4 }}>
      {label}
    </div>
    <div style={{ fontSize: 13, color: '#6b7fa8', lineHeight: 1.5 }}>
      {description}
    </div>

    {mode === 'cn' && (
      <Tag
        color="blue"
        style={{ marginTop: 10, borderRadius: 6, fontSize: 11 }}
      >
        默认
      </Tag>
    )}
  </div>
);

/** 数据源配置 Card — Finnhub API Key 输入与保存 */
const DataSourceCard = () => {
  const [finnhubKey, setFinnhubKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  // 组件挂载时从 electron-store 加载已保存的 Key
  useEffect(() => {
    window.electronAPI.getSettings('finnhubApiKey').then((stored) => {
      if (stored && typeof stored === 'string') {
        setSavedKey(stored);
        setFinnhubKey(stored);
      }
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.electronAPI.setSettings('finnhubApiKey', finnhubKey.trim());
      setSavedKey(finnhubKey.trim());
      messageApi.success('Finnhub API Key saved successfully');
    } catch {
      messageApi.error('Failed to save API Key');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    await window.electronAPI.setSettings('finnhubApiKey', '');
    setSavedKey('');
    setFinnhubKey('');
    messageApi.info('Finnhub API Key cleared');
  };

  const isFinnhubConfigured = savedKey.length > 0;

  return (
    <>
      {contextHolder}
      <Card
        className="glass-card"
        style={{ border: 'none', borderRadius: 20, marginBottom: 20 }}
        styles={{ body: { padding: '24px 28px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(79,110,247,0.15), rgba(79,110,247,0.06))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            <ApiOutlined style={{ color: '#4f6ef7' }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#0f1a2e' }}>Data Sources</div>
            <div style={{ fontSize: 12, color: '#6b7fa8' }}>数据源配置</div>
          </div>
        </div>

        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* AKShare — 免费无需配置 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              background: 'rgba(22, 163, 74, 0.04)',
              borderRadius: 12,
              border: '1px solid rgba(22, 163, 74, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 20 }}>🇨🇳</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0f1a2e' }}>AKShare</div>
                <div style={{ fontSize: 12, color: '#6b7fa8', marginTop: 2 }}>
                  历史 K 线数据 · 优先使用 · 免费无需 Key
                </div>
              </div>
            </div>
            <Tag
              icon={<CheckCircleOutlined />}
              color="success"
              style={{ borderRadius: 8, fontSize: 12, padding: '2px 10px' }}
            >
              Ready
            </Tag>
          </div>

          {/* yfinance — 免费无需配置 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              background: 'rgba(22, 163, 74, 0.04)',
              borderRadius: 12,
              border: '1px solid rgba(22, 163, 74, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 20 }}>📈</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0f1a2e' }}>yfinance</div>
                <div style={{ fontSize: 12, color: '#6b7fa8', marginTop: 2 }}>
                  历史 K 线数据 · AKShare 降级备选 · 免费无需 Key
                </div>
              </div>
            </div>
            <Tag
              icon={<CheckCircleOutlined />}
              color="success"
              style={{ borderRadius: 8, fontSize: 12, padding: '2px 10px' }}
            >
              Ready
            </Tag>
          </div>

          {/* Finnhub — 需要 Key */}
          <div
            style={{
              padding: '18px 18px',
              background: isFinnhubConfigured
                ? 'rgba(22, 163, 74, 0.04)'
                : 'rgba(245, 158, 11, 0.04)',
              borderRadius: 12,
              border: isFinnhubConfigured
                ? '1px solid rgba(22, 163, 74, 0.15)'
                : '1px solid rgba(245, 158, 11, 0.2)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 20 }}>🦅</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#0f1a2e' }}>Finnhub</div>
                  <div style={{ fontSize: 12, color: '#6b7fa8', marginTop: 2 }}>
                    实时报价 · 股票搜索 · 新闻 · 需要免费 API Key
                  </div>
                </div>
              </div>
              {isFinnhubConfigured ? (
                <Tag
                  icon={<CheckCircleOutlined />}
                  color="success"
                  style={{ borderRadius: 8, fontSize: 12, padding: '2px 10px' }}
                >
                  Configured
                </Tag>
              ) : (
                <Tag
                  color="warning"
                  style={{ borderRadius: 8, fontSize: 12, padding: '2px 10px' }}
                >
                  Not Set
                </Tag>
              )}
            </div>

            {/* Key 输入区 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <Input.Password
                prefix={<KeyOutlined style={{ color: '#6b7fa8', fontSize: 13 }} />}
                placeholder="Enter your Finnhub API Key (free at finnhub.io)"
                value={finnhubKey}
                onChange={(e) => setFinnhubKey(e.target.value)}
                onPressEnter={handleSave}
                style={{ borderRadius: 10, flex: 1 }}
              />
              <Button
                type="primary"
                onClick={handleSave}
                loading={saving}
                disabled={finnhubKey.trim() === savedKey}
                style={{ borderRadius: 10, minWidth: 72 }}
              >
                Save
              </Button>
              {isFinnhubConfigured && (
                <Button
                  onClick={handleClear}
                  style={{ borderRadius: 10 }}
                  danger
                >
                  Clear
                </Button>
              )}
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: '#6b7fa8' }}>
              免费注册获取 Key：
              <a
                href="https://finnhub.io"
                target="_blank"
                rel="noreferrer"
                style={{ color: '#4f6ef7', marginLeft: 4 }}
              >
                finnhub.io
              </a>
              <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>
              免费层限额 60次/分钟，支持实时报价、股票搜索、公司新闻
            </div>
          </div>
        </Space>
      </Card>
    </>
  );
};

const Settings = () => {
  const { colorMode, setColorMode, refreshInterval, setRefreshInterval, visibleColumns, setVisibleColumns } = useStockStore();

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 32 }}>
        <Title
          level={2}
          style={{ margin: 0, fontWeight: 700, letterSpacing: '-0.03em', fontSize: 28 }}
        >
          Settings
        </Title>
        <Text style={{ color: '#6b7fa8', fontSize: 14, marginTop: 4, display: 'block' }}>
          Customize your StockerChef experience
        </Text>
      </div>

      {/* 数据源配置 */}
      <DataSourceCard />

      {/* 数据刷新频率配置 */}
      <Card
        className="glass-card"
        style={{ border: 'none', borderRadius: 20, marginBottom: 20 }}
        styles={{ body: { padding: '24px 28px' } }}
      >
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(79,110,247,0.15), rgba(79,110,247,0.06))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ThunderboltOutlined style={{ color: '#4f6ef7', fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#0f1a2e' }}>数据刷新频率</div>
              <div style={{ fontSize: 12, color: '#6b7fa8' }}>Quote Refresh Interval</div>
            </div>
          </div>

          {/* 频率选项卡 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {REFRESH_INTERVAL_OPTIONS.map((option) => {
              const isSelected = refreshInterval === option.value;
              return (
                <div
                  key={option.value}
                  onClick={() => setRefreshInterval(option.value as RefreshInterval)}
                  style={{
                    padding: '14px 12px',
                    borderRadius: 14,
                    border: isSelected
                      ? '2px solid #4f6ef7'
                      : '2px solid rgba(79, 110, 247, 0.12)',
                    background: isSelected
                      ? 'rgba(79, 110, 247, 0.08)'
                      : 'rgba(255, 255, 255, 0.5)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.18s ease',
                    position: 'relative',
                  }}
                >
                  {isSelected && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: '#4f6ef7',
                      }}
                    />
                  )}
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      color: isSelected ? '#4f6ef7' : '#0f1a2e',
                      letterSpacing: '-0.02em',
                      marginBottom: 4,
                    }}
                  >
                    {option.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#8a9cc8', lineHeight: 1.4 }}>
                    {option.description}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 当前状态提示 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 16px',
              background: 'rgba(79, 110, 247, 0.04)',
              borderRadius: 12,
              border: '1px solid rgba(79, 110, 247, 0.1)',
            }}
          >
            <ThunderboltOutlined style={{ color: '#4f6ef7', fontSize: 14 }} />
            <Text style={{ fontSize: 13, color: '#3d5070' }}>
              当前每{' '}
              <strong style={{ color: '#4f6ef7' }}>
                {REFRESH_INTERVAL_OPTIONS.find((o) => o.value === refreshInterval)?.label ?? `${refreshInterval} 秒`}
              </strong>{' '}
              自动刷新一次首页报价数据
              {refreshInterval === 10 && (
                <span style={{ color: '#d97706', marginLeft: 8, fontSize: 12 }}>
                  ⚠️ 高频刷新会消耗更多 Finnhub API 配额
                </span>
              )}
            </Text>
          </div>
        </Space>
      </Card>

      {/* 涨跌色风格设置 */}
      <Card
        className="glass-card"
        style={{ border: 'none', borderRadius: 20, marginBottom: 20 }}
        styles={{ body: { padding: '24px 28px' } }}
      >
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, rgba(79,110,247,0.15), rgba(79,110,247,0.06))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                }}
              >
                🎨
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#0f1a2e' }}>
                  涨跌色风格
                </div>
                <div style={{ fontSize: 12, color: '#6b7fa8' }}>
                  Price Change Color Style
                </div>
              </div>
            </div>
            <Text style={{ fontSize: 13, color: '#6b7fa8', lineHeight: 1.6 }}>
              选择涨跌颜色的显示风格。中国市场惯例为红涨绿跌，美股市场惯例为绿涨红跌。
            </Text>
          </div>

          {/* 选项卡 */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <ColorModeCard
              mode="cn"
              label="🇨🇳 中国风格"
              description="红涨绿跌，A股、港股市场惯例"
              upColor="#dc2626"
              downColor="#16a34a"
              selected={colorMode === 'cn'}
              onClick={() => setColorMode('cn')}
            />
            <ColorModeCard
              mode="us"
              label="🇺🇸 美股风格"
              description="绿涨红跌，美股、欧股市场惯例"
              upColor="#16a34a"
              downColor="#dc2626"
              selected={colorMode === 'us'}
              onClick={() => setColorMode('us')}
            />
          </div>

          {/* 快速切换开关 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              background: 'rgba(79, 110, 247, 0.04)',
              borderRadius: 12,
              border: '1px solid rgba(79, 110, 247, 0.1)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#0f1a2e' }}>
                当前：{colorMode === 'cn' ? '🇨🇳 红涨绿跌（中国风格）' : '🇺🇸 绿涨红跌（美股风格）'}
              </div>
              <div style={{ fontSize: 12, color: '#6b7fa8', marginTop: 2 }}>
                点击切换为{colorMode === 'cn' ? '美股风格' : '中国风格'}
              </div>
            </div>
            <Switch
              checked={colorMode === 'us'}
              onChange={(checked) => setColorMode(checked ? 'us' : 'cn')}
              checkedChildren="🇺🇸"
              unCheckedChildren="🇨🇳"
              style={{ background: colorMode === 'us' ? '#4f6ef7' : '#dc2626' }}
            />
          </div>
        </Space>
      </Card>

      {/* 首页列显示配置 */}
      <Card
        className="glass-card"
        style={{ border: 'none', borderRadius: 20, marginBottom: 20 }}
        styles={{ body: { padding: '24px 28px' } }}
      >
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(79,110,247,0.15), rgba(79,110,247,0.06))',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
              }}
            >
              📋
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#0f1a2e' }}>首页列显示配置</div>
              <div style={{ fontSize: 12, color: '#6b7fa8' }}>选择在自选股列表中展示的数据列</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {COLUMN_DEFINITIONS.map((col) => {
              const isSelected = visibleColumns.includes(col.key);
              const isAlwaysVisible = col.alwaysVisible;
              return (
                <div
                  key={col.key}
                  onClick={() => {
                    if (isAlwaysVisible) return;
                    const next: ColumnKey[] = isSelected
                      ? visibleColumns.filter((k) => k !== col.key)
                      : [...visibleColumns, col.key];
                    setVisibleColumns(next);
                  }}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: isSelected
                      ? '2px solid #4f6ef7'
                      : '2px solid rgba(79, 110, 247, 0.12)',
                    background: isSelected
                      ? 'rgba(79, 110, 247, 0.07)'
                      : 'rgba(255, 255, 255, 0.5)',
                    cursor: isAlwaysVisible ? 'not-allowed' : 'pointer',
                    transition: 'all 0.18s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    opacity: isAlwaysVisible ? 0.7 : 1,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: isSelected ? '#4f6ef7' : '#3d5070' }}>
                      {col.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#8a9cc8', marginTop: 2 }}>{col.description}</div>
                  </div>
                  {isSelected && (
                    <div
                      style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: '#4f6ef7', flexShrink: 0, marginLeft: 8,
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* 重置按钮 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="small"
              onClick={() => setVisibleColumns(DEFAULT_VISIBLE_COLUMNS)}
              style={{ borderRadius: 8, fontSize: 12, color: '#6b7fa8', borderColor: 'rgba(79,110,247,0.2)' }}
            >
              恢复默认
            </Button>
          </div>
        </Space>
      </Card>

      {/* 关于 */}
      <Card
        className="glass-card"
        style={{ border: 'none', borderRadius: 20 }}
        styles={{ body: { padding: '24px 28px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(79,110,247,0.15), rgba(79,110,247,0.06))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            ℹ️
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#0f1a2e' }}>About</div>
        </div>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text style={{ color: '#6b7fa8', fontSize: 13 }}>App</Text>
            <Text style={{ fontWeight: 600, fontSize: 13, color: '#0f1a2e' }}>StockerChef</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text style={{ color: '#6b7fa8', fontSize: 13 }}>Real-time Quote</Text>
            <Text style={{ fontWeight: 600, fontSize: 13, color: '#0f1a2e' }}>Finnhub (Free Tier)</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text style={{ color: '#6b7fa8', fontSize: 13 }}>Historical Data</Text>
            <Text style={{ fontWeight: 600, fontSize: 13, color: '#0f1a2e' }}>AKShare → yfinance</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text style={{ color: '#6b7fa8', fontSize: 13 }}>Market Coverage</Text>
            <Text style={{ fontWeight: 600, fontSize: 13, color: '#0f1a2e' }}>US Stocks + A-Shares</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text style={{ color: '#6b7fa8', fontSize: 13 }}>Technical Analysis</Text>
            <Tag color="blue" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>
              Real RSI/SMA via AKShare
            </Tag>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default Settings;
