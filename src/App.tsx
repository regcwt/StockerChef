import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { ConfigProvider, Layout, theme } from 'antd';
import Dashboard from '@/pages/Dashboard';
import Analysis from '@/pages/Analysis';
import { lightTheme, darkTheme } from '@/theme/config';
import '@/styles/global.css';

const { Header } = Layout;

const AppHeader = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        background: 'transparent',
      }}
    >
      <div
        style={{
          fontSize: '20px',
          fontWeight: 'bold',
          cursor: 'pointer',
          color: '#1890ff',
        }}
        onClick={() => navigate('/')}
      >
        📈 StockerChef
      </div>
      {location.pathname !== '/' && (
        <div
          style={{
            cursor: 'pointer',
            color: '#1890ff',
          }}
          onClick={() => navigate('/')}
        >
          ← Back to Dashboard
        </div>
      )}
    </Header>
  );
};

function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    // Check system preference
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(darkModeMediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };

    darkModeMediaQuery.addEventListener('change', handleChange);

    return () => {
      darkModeMediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return (
    <ConfigProvider theme={isDarkMode ? darkTheme : lightTheme}>
      <BrowserRouter>
        <Layout style={{ minHeight: '100vh' }}>
          <AppHeader />
          <Layout.Content style={{ padding: '24px' }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/analysis/:symbol" element={<Analysis />} />
            </Routes>
          </Layout.Content>
        </Layout>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
