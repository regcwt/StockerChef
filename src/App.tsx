import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import appIcon from '../resources/icon.png';
import { ConfigProvider, Layout, Tooltip } from 'antd';
import {
  HomeOutlined,
  LineChartOutlined,
  MessageOutlined,
  SettingOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import Dashboard from '@/pages/Dashboard';
import Analysis from '@/pages/Analysis';
import Chat from '@/pages/Chat';
import Settings from '@/pages/Settings';
import { useStockStore } from '@/store/useStockStore';
import type { Conversation } from '@/types';
import { lightTheme, darkTheme } from '@/theme/config';
import '@/styles/global.css';

// 导航 Tab 类型（settings 不再是独立 tab，改为底部图标）
type NavTab = 'dashboard' | 'detail' | 'chat' | 'settings';

// 单个导航项配置（不含 settings）
interface NavItem {
  key: NavTab;
  icon: React.ReactNode;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', icon: <HomeOutlined />, label: '首页' },
  { key: 'detail', icon: <LineChartOutlined />, label: '详情' },
  { key: 'chat', icon: <MessageOutlined />, label: '分析' },
];

/** 自定义交通灯按钮组（关闭 / 最小化 / 最大化） */
const TrafficLights = () => {
  const [hovered, setHovered] = useState<'close' | 'minimize' | 'maximize' | null>(null);

  const buttons: Array<{
    key: 'close' | 'minimize' | 'maximize';
    color: string;
    hoverColor: string;
    icon: string;
    action: () => void;
  }> = [
    {
      key: 'close',
      color: '#ff5f57',
      hoverColor: '#ff3b30',
      icon: '✕',
      action: () => window.electronAPI.closeWindow(),
    },
    {
      key: 'minimize',
      color: '#febc2e',
      hoverColor: '#ff9500',
      icon: '−',
      action: () => window.electronAPI.minimizeWindow(),
    },
    {
      key: 'maximize',
      color: '#28c840',
      hoverColor: '#34c759',
      icon: '⤢',
      action: () => window.electronAPI.maximizeWindow(),
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      onMouseLeave={() => setHovered(null)}
    >
      {buttons.map(({ key, color, icon, action }) => (
        <button
          key={key}
          onClick={action}
          onMouseEnter={() => setHovered(key)}
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: color,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            fontSize: 9,
            fontWeight: 700,
            color: 'rgba(0,0,0,0.5)',
            lineHeight: 1,
            transition: 'transform 0.1s ease',
            transform: hovered === key ? 'scale(1.1)' : 'scale(1)',
            flexShrink: 0,
          }}
        >
          {hovered !== null ? icon : ''}
        </button>
      ))}
    </div>
  );
};

/** 侧边栏切换按钮 */
const SidebarToggleButton = ({
  isCollapsed,
  onToggle,
  isDarkMode,
}: {
  isCollapsed: boolean;
  onToggle: () => void;
  isDarkMode: boolean;
}) => (
  <button
    onClick={onToggle}
    title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
    style={{
      width: 28,
      height: 28,
      borderRadius: 8,
      border: `1px solid ${isDarkMode ? 'rgba(107,132,248,0.2)' : 'rgba(79,110,247,0.15)'}`,
      background: isDarkMode ? 'rgba(79,110,247,0.08)' : 'rgba(79,110,247,0.06)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: isDarkMode ? '#8a9cc8' : '#5a6a8a',
      fontSize: 14,
      transition: 'all 0.18s ease',
      WebkitAppRegion: 'no-drag',
      flexShrink: 0,
    } as React.CSSProperties}
  >
    {isCollapsed ? '▶' : '◀'}
  </button>
);

/** 单条对话列表项 — 独立 memo，避免 hover 状态变化时重渲染整个列表 */
const ConversationItem = memo(({
  conv,
  isActive,
  symbolName,
  onSelect,
  onDelete,
}: {
  conv: Conversation;
  isActive: boolean;
  symbolName?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const userMessageCount = conv.messages.filter((m) => m.role === 'user').length;
  // 日期格式化只在 conv.createdAt 变化时重新计算
  const formattedDate = useMemo(
    () => new Date(conv.createdAt).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }),
    [conv.createdAt],
  );

  return (
    <div
      onClick={() => onSelect(conv.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        margin: '1px 0',
        borderRadius: 10,
        cursor: 'pointer',
        background: isActive
          ? 'rgba(79, 110, 247, 0.1)'
          : isHovered
            ? 'rgba(79, 110, 247, 0.05)'
            : 'transparent',
        transition: 'background 0.15s ease',
      }}
    >
      {/* 对话头像 */}
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: isActive ? 'rgba(79, 110, 247, 0.18)' : 'rgba(79, 110, 247, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: conv.symbol ? 9 : 14,
          fontWeight: 800,
          color: isActive ? '#4f6ef7' : '#8a9cc8',
          flexShrink: 0,
          letterSpacing: '-0.02em',
        }}
      >
        {conv.symbol ? conv.symbol.slice(0, 4) : '💬'}
      </div>

      {/* 文字区域 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: isActive ? 700 : 600,
              color: isActive ? '#4f6ef7' : '#2d3a52',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {conv.title}
          </span>
          {symbolName && (
            <span style={{ fontSize: 10, color: '#a0aec8', flexShrink: 0 }}>
              {symbolName}
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              color: isActive ? '#4f6ef7' : '#c0cce0',
              background: isActive ? 'rgba(79,110,247,0.1)' : 'rgba(160,174,200,0.12)',
              borderRadius: 8,
              padding: '1px 5px',
              flexShrink: 0,
              fontWeight: 600,
            }}
          >
            {userMessageCount}
          </span>
        </div>
        <div style={{ fontSize: 10, color: '#b0bcd4', marginTop: 2 }}>
          {formattedDate}
        </div>
      </div>

      {/* 悬停时显示删除按钮 */}
      <Tooltip title="删除对话">
        <div
          onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
          style={{
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            color: '#c0cce0',
            fontSize: 11,
            cursor: 'pointer',
            flexShrink: 0,
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 0.15s ease, color 0.15s ease, background 0.15s ease',
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLDivElement;
            el.style.color = '#dc2626';
            el.style.background = 'rgba(220,38,38,0.08)';
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLDivElement;
            el.style.color = '#c0cce0';
            el.style.background = 'transparent';
          }}
        >
          <DeleteOutlined />
        </div>
      </Tooltip>
    </div>
  );
});

/** 左侧 Sidebar 导航 */
const Sidebar = memo(({
  activeTab,
  onTabChange,
  isDarkMode,
  isCollapsed,
  onToggleCollapse,
  conversations,
  symbolNames,
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
}: {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  isDarkMode: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  conversations: Conversation[];
  symbolNames: Record<string, string>;
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
}) => {

  const sidebarBg = isDarkMode
    ? 'rgba(13, 17, 32, 0.92)'
    : 'rgba(248, 250, 255, 0.95)';
  const borderColor = isDarkMode
    ? 'rgba(107, 132, 248, 0.12)'
    : 'rgba(79, 110, 247, 0.1)';

  const sidebarWidth = isCollapsed ? 80 : 220;
  // transition 时长与 Sidebar width 动画保持一致
  const TRANSITION = '0.22s cubic-bezier(0.4, 0, 0.2, 1)';

  return (
    <div
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        height: '100vh',
        background: sidebarBg,
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderRight: `1px solid ${borderColor}`,
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        left: 0,
        top: 0,
        zIndex: 200,
        overflow: 'hidden',
        transition: `width ${TRANSITION}`,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* 顶部控制区：交通灯 + 收起按钮
          padding/justifyContent 固定，避免瞬间跳变打断动画 */}
      <div
        style={{
          padding: '16px 14px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <TrafficLights />
        {/* 收起按钮：opacity 渐隐，不做条件渲染，避免 DOM 挂载/卸载打断动画 */}
        <div
          style={{
            opacity: isCollapsed ? 0 : 1,
            pointerEvents: isCollapsed ? 'none' : 'auto',
            transition: `opacity ${TRANSITION}`,
            flexShrink: 0,
          }}
        >
          <SidebarToggleButton
            isCollapsed={isCollapsed}
            onToggle={onToggleCollapse}
            isDarkMode={isDarkMode}
          />
        </div>
      </div>

      {/* Logo 区域：始终渲染，opacity + max-height 渐隐，避免 DOM 挂载/卸载打断动画 */}
      <div
        style={{
          padding: '0 20px 16px',
          borderBottom: `1px solid ${borderColor}`,
          flexShrink: 0,
          opacity: isCollapsed ? 0 : 1,
          maxHeight: isCollapsed ? 0 : 80,
          overflow: 'hidden',
          transition: `opacity ${TRANSITION}, max-height ${TRANSITION}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src={appIcon}
            alt="StockerChef"
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              flexShrink: 0,
              objectFit: 'contain',
            }}
          />
          <div>
            <div
              className="logo-text"
              style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}
            >
              StockerChef
            </div>
            <div style={{ fontSize: 11, color: '#8a9cc8', marginTop: 1 }}>
              Cook Your Own Stocks.
            </div>
          </div>
        </div>
      </div>

      {/* 导航菜单：padding 固定，文字标签用 opacity 渐隐，避免跳变打断动画 */}
      <nav
        style={{
          flexShrink: 0,
          padding: '16px 8px 8px',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.key;
          return (
            <div
              key={item.key}
              onClick={() => onTabChange(item.key)}
              title={isCollapsed ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 10,
                padding: '10px 8px',
                borderRadius: 12,
                cursor: 'pointer',
                marginBottom: 4,
                background: isActive ? 'rgba(79, 110, 247, 0.12)' : 'transparent',
                color: isActive ? '#4f6ef7' : isDarkMode ? '#8a9cc8' : '#5a6a8a',
                fontWeight: isActive ? 600 : 500,
                fontSize: 14,
                transition: `background ${TRANSITION}, border ${TRANSITION}, color ${TRANSITION}`,
                border: isActive ? '1px solid rgba(79, 110, 247, 0.2)' : '1px solid transparent',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{item.icon}</span>
              {/* 文字标签：opacity 渐隐，不做条件渲染 */}
              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  opacity: isCollapsed ? 0 : 1,
                  maxWidth: isCollapsed ? 0 : 120,
                  transition: `opacity ${TRANSITION}, max-width ${TRANSITION}`,
                }}
              >
                {item.label}
              </span>
              {/* 激活指示点：opacity 渐隐 */}
              <div
                style={{
                  marginLeft: 'auto',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#4f6ef7',
                  flexShrink: 0,
                  opacity: isCollapsed || !isActive ? 0 : 1,
                  transition: `opacity ${TRANSITION}`,
                }}
              />
            </div>
          );
        })}
      </nav>

      {/* 历史对话列表：始终渲染，opacity + pointer-events 控制显隐，避免 DOM 挂载/卸载打断动画 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          WebkitAppRegion: 'no-drag',
          borderTop: `1px solid ${borderColor}`,
          opacity: isCollapsed ? 0 : 1,
          pointerEvents: isCollapsed ? 'none' : 'auto',
          transition: `opacity ${TRANSITION}`,
        } as React.CSSProperties}
      >
        {/* 标题 */}
        <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#a0aec8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            历史对话
          </div>
        </div>

        {/* Conversation 列表滚动区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
          {conversations.length === 0 ? (
            <div
              style={{
                padding: '24px 10px',
                textAlign: 'center',
                color: '#a0aec8',
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 6 }}>💬</div>
              <div>还没有对话记录</div>
            </div>
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                isActive={activeConversationId === conv.id}
                symbolName={conv.symbol ? symbolNames[conv.symbol] : undefined}
                onSelect={onSelectConversation}
                onDelete={onDeleteConversation}
              />
            ))
          )}
        </div>
      </div>

      {/* 底部：设置图标，padding 固定，文字用 opacity 渐隐 */}
      <div
        style={{
          padding: '12px 8px',
          borderTop: `1px solid ${borderColor}`,
          WebkitAppRegion: 'no-drag',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 8,
        } as React.CSSProperties}
      >
        <Tooltip title={isCollapsed ? '设置' : ''} placement="right">
          <div
            onClick={() => onTabChange('settings')}
            style={{
              height: 32,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              padding: '0 8px',
              color: activeTab === 'settings' ? '#4f6ef7' : isDarkMode ? '#8a9cc8' : '#5a6a8a',
              background: activeTab === 'settings' ? 'rgba(79, 110, 247, 0.12)' : 'transparent',
              border: activeTab === 'settings' ? '1px solid rgba(79, 110, 247, 0.2)' : '1px solid transparent',
              fontSize: 16,
              transition: `background ${TRANSITION}, border ${TRANSITION}, color ${TRANSITION}`,
              flexShrink: 0,
            }}
          >
            <SettingOutlined />
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                opacity: isCollapsed ? 0 : 1,
                maxWidth: isCollapsed ? 0 : 60,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                transition: `opacity ${TRANSITION}, max-width ${TRANSITION}`,
              }}
            >
              设置
            </span>
          </div>
        </Tooltip>
      </div>
    </div>
  );
});


function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // 收起动画（220ms）结束后才显示展开按钮，避免按钮盖在动画中的 Sidebar 上
  const [showExpandButton, setShowExpandButton] = useState(false);
  // 详情/分析页当前选中的股票 symbol（从 Dashboard 点击跳转时传入）
  const [analysisSymbol, setAnalysisSymbol] = useState<string | undefined>(undefined);
  const { conversations, loadConversations, deleteConversation, setActiveConversationId, activeConversationId, symbolNames } = useStockStore();

  // 加载历史对话
  useEffect(() => {
    loadConversations();
  }, []);

  // 收起动画（220ms）结束后才显示展开按钮，展开时立即隐藏
  useEffect(() => {
    if (isSidebarCollapsed) {
      const timer = setTimeout(() => setShowExpandButton(true), 220);
      return () => clearTimeout(timer);
    } else {
      setShowExpandButton(false);
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(darkModeMediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };

    darkModeMediaQuery.addEventListener('change', handleChange);
    return () => darkModeMediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Dashboard 点击股票卡片时，切换到详情 tab 并传入 symbol
  // useCallback 避免每次 App 重渲染时创建新函数引用，导致 Dashboard memo 失效
  const handleNavigateToAnalysis = useCallback((symbol: string) => {
    setAnalysisSymbol(symbol);
    setActiveTab('detail');
  }, []);

  // 点击 Sidebar conversation 条目，切换到该对话并跳转到 chat tab
  const handleSelectConversation = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
    setActiveTab('chat');
  }, [setActiveConversationId]);

  // 删除指定对话
  const handleDeleteConversation = useCallback((conversationId: string) => {
    deleteConversation(conversationId);
  }, [deleteConversation]);

  // 导航到 Settings tab
  const handleNavigateToSettings = useCallback(() => setActiveTab('settings'), []);

  // 切换到 chat tab 时重置 activeConversationId
  const handleTabChange = useCallback((tab: NavTab) => {
    if (tab === 'chat') {
      setActiveConversationId(null);
    }
    setActiveTab(tab);
  }, [setActiveConversationId]);

  const handleToggleCollapse = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  const sidebarWidth = isSidebarCollapsed ? 80 : 220;

  return (
    <ConfigProvider theme={isDarkMode ? darkTheme : lightTheme}>
      <Layout style={{ minHeight: '100vh', background: 'transparent', flexDirection: 'row' }}>
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          isDarkMode={isDarkMode}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
          conversations={conversations}
          symbolNames={symbolNames}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
        />
        {/* 收起状态时，展开按钮显示在 Sidebar 右侧（延迟至收起动画结束后显示） */}
        {showExpandButton && (
          <div
            style={{
              position: 'fixed',
              left: sidebarWidth + 8,
              top: 16,
              zIndex: 300,
              WebkitAppRegion: 'no-drag',
              transition: 'left 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
            } as React.CSSProperties}
          >
            <SidebarToggleButton
              isCollapsed={isSidebarCollapsed}
              onToggle={() => setIsSidebarCollapsed((prev) => !prev)}
              isDarkMode={isDarkMode}
            />
          </div>
        )}

        {/* 右侧内容区，左边距跟随 Sidebar 宽度动态变化 */}
        <Layout.Content
          style={{
            marginLeft: sidebarWidth,
            minHeight: '100vh',
            padding: activeTab === 'chat' ? '0' : '32px 36px 48px',
            overflowY: activeTab === 'chat' ? 'hidden' : 'auto',
            transition: 'margin-left 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* 用 display:none 隐藏非活跃页面而非卸载，避免重复挂载开销 */}
          <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
            <Dashboard onStockClick={handleNavigateToAnalysis} onNavigateToSettings={handleNavigateToSettings} />
          </div>
          <div style={{ display: activeTab === 'detail' ? 'block' : 'none' }}>
            <Analysis initialSymbol={analysisSymbol} />
          </div>
          <div style={{ display: activeTab === 'chat' ? 'block' : 'none', height: '100%' }}>
            <Chat activeConversationId={activeConversationId} initialSymbol={analysisSymbol} />
          </div>
          <div style={{ display: activeTab === 'settings' ? 'block' : 'none', height: 'calc(100vh - 80px)', overflow: 'hidden' }}>
            <Settings />
          </div>
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
