import type { ThemeConfig } from 'antd';

export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: '#4f6ef7',
    colorPrimaryHover: '#3d5ce6',
    colorPrimaryActive: '#2d4bd4',
    colorSuccess: '#16a34a',
    colorError: '#dc2626',
    colorWarning: '#d97706',
    colorInfo: '#4f6ef7',
    colorBgBase: '#f4f6fb',
    colorBgContainer: 'rgba(255, 255, 255, 0.85)',
    colorBgElevated: 'rgba(255, 255, 255, 0.95)',
    colorBorder: 'rgba(79, 110, 247, 0.15)',
    colorBorderSecondary: 'rgba(79, 110, 247, 0.08)',
    colorText: '#0f1a2e',
    colorTextSecondary: '#3d5070',
    colorTextTertiary: '#6b7fa8',
    colorTextQuaternary: '#a0aec8',
    borderRadius: 12,
    borderRadiusLG: 16,
    borderRadiusSM: 8,
    fontSize: 14,
    fontSizeLG: 16,
    fontSizeXL: 20,
    fontWeightStrong: 600,
    boxShadow: '0 2px 16px rgba(79, 110, 247, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04)',
    boxShadowSecondary: '0 8px 32px rgba(79, 110, 247, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06)',
    lineHeight: 1.6,
    controlHeight: 40,
    controlHeightLG: 48,
  },
  components: {
    Card: {
      borderRadiusLG: 16,
      paddingLG: 24,
    },
    Button: {
      borderRadius: 10,
      controlHeight: 40,
      controlHeightLG: 48,
      fontWeight: 500,
    },
    Input: {
      borderRadius: 10,
      controlHeight: 40,
      controlHeightLG: 48,
    },
    Tabs: {
      borderRadius: 10,
    },
    Tag: {
      borderRadius: 6,
    },
    Modal: {
      borderRadiusLG: 20,
    },
    Descriptions: {
      borderRadius: 12,
    },
    Alert: {
      borderRadius: 12,
    },
    List: {
      borderRadius: 12,
    },
  },
};

export const darkTheme: ThemeConfig = {
  token: {
    colorPrimary: '#6b84f8',
    colorPrimaryHover: '#8499fa',
    colorPrimaryActive: '#4f6ef7',
    colorSuccess: '#22c55e',
    colorError: '#ef4444',
    colorWarning: '#f59e0b',
    colorInfo: '#6b84f8',
    colorBgBase: '#0d1118',
    colorBgContainer: 'rgba(18, 24, 40, 0.85)',
    colorBgElevated: 'rgba(22, 30, 50, 0.95)',
    colorBorder: 'rgba(107, 132, 248, 0.15)',
    colorBorderSecondary: 'rgba(107, 132, 248, 0.08)',
    colorText: '#e8eaf6',
    colorTextSecondary: '#9ba8d0',
    colorTextTertiary: '#6b7aaa',
    colorTextQuaternary: '#4a5580',
    borderRadius: 12,
    borderRadiusLG: 16,
    borderRadiusSM: 8,
    fontSize: 14,
    fontSizeLG: 16,
    fontSizeXL: 20,
    fontWeightStrong: 600,
    boxShadow: '0 2px 16px rgba(0, 0, 0, 0.3), 0 1px 4px rgba(0, 0, 0, 0.2)',
    boxShadowSecondary: '0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3)',
    lineHeight: 1.6,
    controlHeight: 40,
    controlHeightLG: 48,
  },
  components: {
    Card: {
      borderRadiusLG: 16,
      paddingLG: 24,
    },
    Button: {
      borderRadius: 10,
      controlHeight: 40,
      controlHeightLG: 48,
      fontWeight: 500,
    },
    Input: {
      borderRadius: 10,
      controlHeight: 40,
      controlHeightLG: 48,
    },
    Tabs: {
      borderRadius: 10,
    },
    Tag: {
      borderRadius: 6,
    },
    Modal: {
      borderRadiusLG: 20,
    },
    Descriptions: {
      borderRadius: 12,
    },
    Alert: {
      borderRadius: 12,
    },
    List: {
      borderRadius: 12,
    },
  },
  algorithm: (theme: any) => theme.darkAlgorithm,
};
