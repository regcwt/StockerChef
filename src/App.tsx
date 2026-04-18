import { useState, useEffect } from 'react';
import appIcon from '../resources/icon.png';
import { ConfigProvider, Layout } from 'antd';
import {
  HomeOutlined,
  LineChartOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import Dashboard from '@/pages/Dashboard';
import Analysis from '@/pages/Analysis';
import Settings from '@/pages/Settings';
import { lightTheme, darkTheme } from '@/theme/config';
import '@/styles/global.css';

// 导航 Tab 类型
type NavTab = 'dashboard' | 'analysis' | 'settings';

// 单个导航项配置
interface NavItem {
  key: NavTab;
  icon: React.ReactNode;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', icon: <HomeOutlined />, label: '首页' },
  { key: 'analysis', icon: <LineChartOutlined />, label: '分析' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
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

/** 左侧 Sidebar 导航 */
const Sidebar = ({
  activeTab,
  onTabChange,
  isDarkMode,
  isCollapsed,
  onToggleCollapse,
}: {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  isDarkMode: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) => {
  const sidebarBg = isDarkMode
    ? 'rgba(13, 17, 32, 0.92)'
    : 'rgba(248, 250, 255, 0.95)';
  const borderColor = isDarkMode
    ? 'rgba(107, 132, 248, 0.12)'
    : 'rgba(79, 110, 247, 0.1)';

  const sidebarWidth = isCollapsed ? 80 : 220;

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
        transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        // 整个 Sidebar 可拖拽移动窗口
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* 顶部控制区：交通灯 + 收起按钮 */}
      <div
        style={{
          padding: isCollapsed ? '16px 0 12px' : '16px 14px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <TrafficLights />
        {!isCollapsed && (
          <SidebarToggleButton
            isCollapsed={isCollapsed}
            onToggle={onToggleCollapse}
            isDarkMode={isDarkMode}
          />
        )}
      </div>

      {/* Logo 区域 */}
      {!isCollapsed && (
        <div
          style={{
            padding: '0 20px 16px',
            borderBottom: `1px solid ${borderColor}`,
            flexShrink: 0,
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
      )}

      {/* 收起时的 Logo 图标 */}
      {isCollapsed && (
        <div
          style={{
            padding: '0 0 12px',
            borderBottom: `1px solid ${borderColor}`,
            display: 'flex',
            justifyContent: 'center',
            flexShrink: 0,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          <img
            src={appIcon}
            alt="StockerChef"
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              objectFit: 'contain',
            }}
          />
        </div>
      )}

      {/* 导航菜单 — 设为 no-drag 让点击正常响应 */}
      <nav
        style={{
          flex: 1,
          padding: isCollapsed ? '16px 8px' : '16px 12px',
          WebkitAppRegion: 'no-drag',
          overflowY: 'auto',
          overflowX: 'hidden',
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
                justifyContent: isCollapsed ? 'center' : 'flex-start',
                gap: 10,
                padding: isCollapsed ? '10px 0' : '10px 14px',
                borderRadius: 12,
                cursor: 'pointer',
                marginBottom: 4,
                background: isActive
                  ? 'rgba(79, 110, 247, 0.12)'
                  : 'transparent',
                color: isActive ? '#4f6ef7' : isDarkMode ? '#8a9cc8' : '#5a6a8a',
                fontWeight: isActive ? 600 : 500,
                fontSize: 14,
                transition: 'all 0.18s ease',
                border: isActive
                  ? '1px solid rgba(79, 110, 247, 0.2)'
                  : '1px solid transparent',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{item.icon}</span>
              {!isCollapsed && <span>{item.label}</span>}
              {!isCollapsed && isActive && (
                <div
                  style={{
                    marginLeft: 'auto',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#4f6ef7',
                    flexShrink: 0,
                  }}
                />
              )}
            </div>
          );
        })}
      </nav>

      {/* 底部：收起时显示展开按钮，展开时显示版本信息 */}
      <div
        style={{
          padding: isCollapsed ? '12px 8px' : '16px 20px',
          borderTop: `1px solid ${borderColor}`,
          WebkitAppRegion: 'no-drag',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'flex-start',
        } as React.CSSProperties}
      >
        {isCollapsed ? (
          <SidebarToggleButton
            isCollapsed={isCollapsed}
            onToggle={onToggleCollapse}
            isDarkMode={isDarkMode}
          />
        ) : (
          <div style={{ fontSize: 11, color: '#8a9cc8', lineHeight: 1.6 }}>
            <div>StockerChef v1.0</div>
            <div style={{ opacity: 0.7 }}>Powered by Finnhub</div>
          </div>
        )}
      </div>
    </div>
  );
};

function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // 分析页当前选中的股票 symbol（从 Dashboard 点击跳转时传入）
  const [analysisSymbol, setAnalysisSymbol] = useState<string | undefined>(undefined);

  useEffect(() => {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(darkModeMediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };

    darkModeMediaQuery.addEventListener('change', handleChange);
    return () => darkModeMediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Dashboard 点击股票卡片时，切换到分析 tab 并传入 symbol
  const handleNavigateToAnalysis = (symbol: string) => {
    setAnalysisSymbol(symbol);
    setActiveTab('analysis');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard onStockClick={handleNavigateToAnalysis} onNavigateToSettings={() => setActiveTab('settings')} />;
      case 'analysis':
        return <Analysis initialSymbol={analysisSymbol} />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard onStockClick={handleNavigateToAnalysis} onNavigateToSettings={() => setActiveTab('settings')} />;
    }
  };

  const sidebarWidth = isSidebarCollapsed ? 80 : 220;

  return (
    <ConfigProvider theme={isDarkMode ? darkTheme : lightTheme}>
      <Layout style={{ minHeight: '100vh', background: 'transparent', flexDirection: 'row' }}>
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          isDarkMode={isDarkMode}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        />
        {/* 右侧内容区，左边距跟随 Sidebar 宽度动态变化 */}
        <Layout.Content
          style={{
            marginLeft: sidebarWidth,
            minHeight: '100vh',
            padding: '32px 36px 48px',
            overflowY: 'auto',
            transition: 'margin-left 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {renderContent()}
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
