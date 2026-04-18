import { useState, useEffect } from 'react';
import { Card, Typography, Space, Switch, Tag, Input, Button, message, Tooltip } from 'antd';
import { CheckCircleFilled, CheckCircleOutlined, KeyOutlined, ApiOutlined, ThunderboltOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
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

// ── Provider 元数据定义 ──────────────────────────────────────────────────────

/** 所有可用 provider 的静态元数据 */
const PROVIDER_META: Record<string, {
  icon: string;
  name: string;
  description: string;
  requiresToken: boolean;
  tokenKey?: string;
  tokenPlaceholder?: string;
  tokenLink?: string;
  tokenLinkLabel?: string;
  tokenHint?: string;
}> = {
  tushare: {
    icon: '🐂',
    name: 'Tushare Pro',
    description: 'A股实时行情 · 历史 K 线 · 数据质量高',
    requiresToken: true,
    tokenKey: 'tushareToken',
    tokenPlaceholder: 'Enter your Tushare Pro Token (free at tushare.pro)',
    tokenLink: 'https://tushare.pro/register?reg=7',
    tokenLinkLabel: 'tushare.pro',
    tokenHint: '免费注册即可获得基础权限，数据稳定性优于 AKShare 免费接口',
  },
  akshare: {
    icon: '🇨🇳',
    name: 'AKShare',
    description: '免费无需 Token · 覆盖 A股 / 港股',
    requiresToken: false,
  },
  akshare_hk: {
    icon: '🇭🇰',
    name: 'AKShare（港股）',
    description: '新浪财经实时行情 · 10min 缓存 · 免费无需 Token',
    requiresToken: false,
  },
  finnhub: {
    icon: '🦅',
    name: 'Finnhub',
    description: '美股实时报价 · 股票搜索 · 新闻',
    requiresToken: true,
    tokenKey: 'finnhubApiKey',
    tokenPlaceholder: 'Enter your Finnhub API Key (free at finnhub.io)',
    tokenLink: 'https://finnhub.io',
    tokenLinkLabel: 'finnhub.io',
    tokenHint: '免费层限额 60次/分钟，支持实时报价、股票搜索、公司新闻',
  },
  yfinance: {
    icon: '📈',
    name: 'yfinance',
    description: '美股历史 K 线 · 免费无需 Token',
    requiresToken: false,
  },
};

/** 各市场默认 provider 优先级 */
const DEFAULT_CN_PROVIDERS = ['tushare', 'akshare'];
const DEFAULT_HK_PROVIDERS = ['akshare_hk'];
const DEFAULT_US_PROVIDERS = ['finnhub', 'yfinance'];

// ── 单个 Provider 行组件 ──────────────────────────────────────────────────────

const ProviderRow = ({
  providerId,
  index,
  total,
  tokenValues,
  savedTokenValues,
  savingKeys,
  onMoveUp,
  onMoveDown,
  onSaveToken,
  onClearToken,
  onTokenChange,
}: {
  providerId: string;
  index: number;
  total: number;
  tokenValues: Record<string, string>;
  savedTokenValues: Record<string, string>;
  savingKeys: Set<string>;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSaveToken: (tokenKey: string) => void;
  onClearToken: (tokenKey: string) => void;
  onTokenChange: (tokenKey: string, value: string) => void;
}) => {
  const meta = PROVIDER_META[providerId];
  if (!meta) return null;

  const tokenKey = meta.tokenKey ?? '';
  const currentToken = tokenValues[tokenKey] ?? '';
  const savedToken = savedTokenValues[tokenKey] ?? '';
  const isConfigured = !meta.requiresToken || savedToken.length > 0;
  const isSaving = savingKeys.has(tokenKey);

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        border: isConfigured
          ? '1px solid rgba(22, 163, 74, 0.2)'
          : '1px solid rgba(245, 158, 11, 0.25)',
        background: isConfigured
          ? 'rgba(22, 163, 74, 0.03)'
          : 'rgba(245, 158, 11, 0.03)',
        transition: 'all 0.18s ease',
      }}
    >
      {/* 行头：优先级序号 + 图标 + 名称 + 状态 + 上下移动按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* 优先级序号 */}
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: index === 0
              ? 'rgba(79, 110, 247, 0.12)'
              : 'rgba(107, 127, 168, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            color: index === 0 ? '#4f6ef7' : '#8a9cc8',
            flexShrink: 0,
          }}
        >
          {index + 1}
        </div>

        {/* 图标 + 名称 + 描述 */}
        <div style={{ fontSize: 18, flexShrink: 0 }}>{meta.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#0f1a2e' }}>{meta.name}</div>
          <div style={{ fontSize: 11, color: '#8a9cc8', marginTop: 1 }}>{meta.description}</div>
        </div>

        {/* 状态 Tag */}
        {isConfigured ? (
          <Tag
            icon={<CheckCircleOutlined />}
            color="success"
            style={{ borderRadius: 6, fontSize: 11, padding: '1px 8px', margin: 0 }}
          >
            {meta.requiresToken ? 'Configured' : 'Ready'}
          </Tag>
        ) : (
          <Tag
            color="warning"
            style={{ borderRadius: 6, fontSize: 11, padding: '1px 8px', margin: 0 }}
          >
            Not Set
          </Tag>
        )}

        {/* 上下移动按钮 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
          <Tooltip title="提高优先级">
            <Button
              size="small"
              icon={<ArrowUpOutlined />}
              disabled={index === 0}
              onClick={onMoveUp}
              style={{
                width: 24,
                height: 20,
                padding: 0,
                fontSize: 10,
                borderRadius: 4,
                border: '1px solid rgba(79,110,247,0.2)',
                color: index === 0 ? '#c8d0e8' : '#4f6ef7',
              }}
            />
          </Tooltip>
          <Tooltip title="降低优先级">
            <Button
              size="small"
              icon={<ArrowDownOutlined />}
              disabled={index === total - 1}
              onClick={onMoveDown}
              style={{
                width: 24,
                height: 20,
                padding: 0,
                fontSize: 10,
                borderRadius: 4,
                border: '1px solid rgba(79,110,247,0.2)',
                color: index === total - 1 ? '#c8d0e8' : '#4f6ef7',
              }}
            />
          </Tooltip>
        </div>
      </div>

      {/* Token 输入区（仅需要 Token 的 provider 展示） */}
      {meta.requiresToken && (
        <div style={{ marginTop: 12, paddingLeft: 32 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input.Password
              prefix={<KeyOutlined style={{ color: '#6b7fa8', fontSize: 12 }} />}
              placeholder={meta.tokenPlaceholder}
              value={currentToken}
              onChange={(e) => onTokenChange(tokenKey, e.target.value)}
              onPressEnter={() => onSaveToken(tokenKey)}
              size="small"
              style={{ borderRadius: 8, flex: 1, fontSize: 12 }}
            />
            <Button
              type="primary"
              size="small"
              onClick={() => onSaveToken(tokenKey)}
              loading={isSaving}
              disabled={currentToken.trim() === savedToken}
              style={{ borderRadius: 8, minWidth: 56, fontSize: 12 }}
            >
              Save
            </Button>
            {savedToken.length > 0 && (
              <Button
                size="small"
                danger
                onClick={() => onClearToken(tokenKey)}
                style={{ borderRadius: 8, fontSize: 12 }}
              >
                Clear
              </Button>
            )}
          </div>
          {meta.tokenHint && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#8a9cc8' }}>
              {meta.tokenHint}
              {meta.tokenLink && (
                <>
                  {' · '}
                  <a
                    href={meta.tokenLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#4f6ef7' }}
                  >
                    {meta.tokenLinkLabel}
                  </a>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── 市场分组组件 ──────────────────────────────────────────────────────────────

const MarketProviderGroup = ({
  marketFlag,
  marketName,
  marketSubtitle,
  providers,
  tokenValues,
  savedTokenValues,
  savingKeys,
  onReorder,
  onSaveToken,
  onClearToken,
  onTokenChange,
}: {
  marketFlag: string;
  marketName: string;
  marketSubtitle: string;
  providers: string[];
  tokenValues: Record<string, string>;
  savedTokenValues: Record<string, string>;
  savingKeys: Set<string>;
  onReorder: (newOrder: string[]) => void;
  onSaveToken: (tokenKey: string) => void;
  onClearToken: (tokenKey: string) => void;
  onTokenChange: (tokenKey: string, value: string) => void;
}) => {
  const moveProvider = (fromIndex: number, toIndex: number) => {
    const updated = [...providers];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    onReorder(updated);
  };

  return (
    <div
      style={{
        borderRadius: 14,
        border: '1px solid rgba(79, 110, 247, 0.1)',
        background: 'rgba(255, 255, 255, 0.4)',
        overflow: 'hidden',
      }}
    >
      {/* 市场标题栏 */}
      <div
        style={{
          padding: '12px 16px',
          background: 'rgba(79, 110, 247, 0.05)',
          borderBottom: '1px solid rgba(79, 110, 247, 0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 18 }}>{marketFlag}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f1a2e' }}>{marketName}</div>
          <div style={{ fontSize: 11, color: '#8a9cc8' }}>{marketSubtitle}</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Tag
            style={{
              borderRadius: 6,
              fontSize: 11,
              padding: '1px 8px',
              background: 'rgba(79,110,247,0.08)',
              border: '1px solid rgba(79,110,247,0.15)',
              color: '#4f6ef7',
            }}
          >
            {providers.length} 个数据源 · 按优先级排列
          </Tag>
        </div>
      </div>

      {/* Provider 列表 */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {providers.map((providerId, index) => (
          <ProviderRow
            key={providerId}
            providerId={providerId}
            index={index}
            total={providers.length}
            tokenValues={tokenValues}
            savedTokenValues={savedTokenValues}
            savingKeys={savingKeys}
            onMoveUp={() => moveProvider(index, index - 1)}
            onMoveDown={() => moveProvider(index, index + 1)}
            onSaveToken={onSaveToken}
            onClearToken={onClearToken}
            onTokenChange={onTokenChange}
          />
        ))}
      </div>
    </div>
  );
};

// ── DataSourceCard 主组件 ─────────────────────────────────────────────────────

/** 数据源配置 Card — 按市场分组，支持优先级排序 */
const DataSourceCard = () => {
  const [messageApi, contextHolder] = message.useMessage();

  // 各市场 provider 优先级顺序
  const [cnProviders, setCnProviders] = useState<string[]>(DEFAULT_CN_PROVIDERS);
  const [hkProviders, setHkProviders] = useState<string[]>(DEFAULT_HK_PROVIDERS);
  const [usProviders, setUsProviders] = useState<string[]>(DEFAULT_US_PROVIDERS);

  // Token / Key 输入值（key = tokenKey，如 'finnhubApiKey' / 'tushareToken'）
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});
  const [savedTokenValues, setSavedTokenValues] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());

  // 组件挂载时从 electron-store 加载优先级和 Token
  useEffect(() => {
    // 加载优先级
    window.electronAPI.getSettings('cnProviderPriority').then((stored) => {
      if (Array.isArray(stored) && stored.length > 0) setCnProviders(stored as string[]);
    });
    window.electronAPI.getSettings('hkProviderPriority').then((stored) => {
      if (Array.isArray(stored) && stored.length > 0) setHkProviders(stored as string[]);
    });
    window.electronAPI.getSettings('usProviderPriority').then((stored) => {
      if (Array.isArray(stored) && stored.length > 0) setUsProviders(stored as string[]);
    });

    // 加载所有需要 Token 的 provider 的已保存值
    const tokenKeys = Object.values(PROVIDER_META)
      .filter((m) => m.requiresToken && m.tokenKey)
      .map((m) => m.tokenKey as string);

    tokenKeys.forEach((key) => {
      window.electronAPI.getSettings(key).then((stored) => {
        if (stored && typeof stored === 'string') {
          setTokenValues((prev) => ({ ...prev, [key]: stored }));
          setSavedTokenValues((prev) => ({ ...prev, [key]: stored }));
        }
      });
    });
  }, []);

  // 保存优先级到 electron-store
  const savePriority = async (
    settingsKey: string,
    newOrder: string[],
    setter: (order: string[]) => void,
  ) => {
    setter(newOrder);
    try {
      await window.electronAPI.setSettings(settingsKey, newOrder);
    } catch {
      messageApi.error('Failed to save provider priority');
    }
  };

  const handleTokenChange = (tokenKey: string, value: string) => {
    setTokenValues((prev) => ({ ...prev, [tokenKey]: value }));
  };

  const handleSaveToken = async (tokenKey: string) => {
    const value = (tokenValues[tokenKey] ?? '').trim();
    setSavingKeys((prev) => new Set(prev).add(tokenKey));
    try {
      await window.electronAPI.setSettings(tokenKey, value);
      setSavedTokenValues((prev) => ({ ...prev, [tokenKey]: value }));
      messageApi.success('Token saved successfully');
    } catch {
      messageApi.error('Failed to save token');
    } finally {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(tokenKey);
        return next;
      });
    }
  };

  const handleClearToken = async (tokenKey: string) => {
    await window.electronAPI.setSettings(tokenKey, '');
    setTokenValues((prev) => ({ ...prev, [tokenKey]: '' }));
    setSavedTokenValues((prev) => ({ ...prev, [tokenKey]: '' }));
    messageApi.info('Token cleared');
  };

  return (
    <>
      {contextHolder}
      <Card
        className="glass-card"
        style={{ border: 'none', borderRadius: 20, marginBottom: 20 }}
        styles={{ body: { padding: '24px 28px' } }}
      >
        {/* 卡片标题 */}
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
            <ApiOutlined style={{ color: '#4f6ef7' }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#0f1a2e' }}>Data Sources</div>
            <div style={{ fontSize: 12, color: '#6b7fa8' }}>按市场分组 · 点击 ↑↓ 调整优先级 · 优先级高的数据源优先使用</div>
          </div>
        </div>

        <Space direction="vertical" size={14} style={{ width: '100%', marginTop: 16 }}>
          {/* A 股 */}
          <MarketProviderGroup
            marketFlag="🇨🇳"
            marketName="A 股"
            marketSubtitle="沪深两市 · 6位数字代码"
            providers={cnProviders}
            tokenValues={tokenValues}
            savedTokenValues={savedTokenValues}
            savingKeys={savingKeys}
            onReorder={(order) => savePriority('cnProviderPriority', order, setCnProviders)}
            onSaveToken={handleSaveToken}
            onClearToken={handleClearToken}
            onTokenChange={handleTokenChange}
          />

          {/* 港 股 */}
          <MarketProviderGroup
            marketFlag="🇭🇰"
            marketName="港 股"
            marketSubtitle="香港交易所 · XXXXX.HK 格式"
            providers={hkProviders}
            tokenValues={tokenValues}
            savedTokenValues={savedTokenValues}
            savingKeys={savingKeys}
            onReorder={(order) => savePriority('hkProviderPriority', order, setHkProviders)}
            onSaveToken={handleSaveToken}
            onClearToken={handleClearToken}
            onTokenChange={handleTokenChange}
          />

          {/* 美 股 */}
          <MarketProviderGroup
            marketFlag="🇺🇸"
            marketName="美 股"
            marketSubtitle="纳斯达克 / 纽交所 · 字母代码"
            providers={usProviders}
            tokenValues={tokenValues}
            savedTokenValues={savedTokenValues}
            savingKeys={savingKeys}
            onReorder={(order) => savePriority('usProviderPriority', order, setUsProviders)}
            onSaveToken={handleSaveToken}
            onClearToken={handleClearToken}
            onTokenChange={handleTokenChange}
          />
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
