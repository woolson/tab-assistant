import { ConfigProvider, Spin, Tabs, theme } from 'antd';
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { render } from 'react-dom';
import zhCN from 'antd/es/locale/zh_CN';
import TabOverview from './TabOverview';
// import Useful from './Usefal';
import Header from './Header';
import './index.less';
import '../../common/styles/font.less';

const Rules = lazy(() => import('./Rules'));
const Setting = lazy(() => import('./Setting'));
const About = lazy(() => import('./About'));

const LazyTabPane: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={<div className="popup-tab-loading"><Spin size="small" /></div>}>
    {children}
  </Suspense>
);

const App = () => {
  const [isDarkMode, setIsDarkMode] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);
  const mediaQuery = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);

  const items = useMemo(() => [
    {
      key: 'tabOverview',
      label: '当前标签',
      children: <TabOverview />,
    },
    {
      key: 'rules',
      label: '分组规则',
      children: <LazyTabPane><Rules /></LazyTabPane>,
    },
    // {
    //   key: 'useful',
    //   label: '常用分组',
    //   children: <Useful />,
    // },
    {
      key: 'setting',
      label: '其他设置',
      children: <LazyTabPane><Setting /></LazyTabPane>,
    },
    {
      key: 'about',
      label: '关于插件',
      children: <LazyTabPane><About /></LazyTabPane>,
    },
  ], []);

  // 检测当前是否为暗色模式
  const checkDarkMode = useCallback(() => {
    setIsDarkMode(mediaQuery.matches);
  }, [mediaQuery])

  useEffect(() => {
    // 初始化时检查一次
    checkDarkMode();
    // 监听系统主题变化
    mediaQuery.addEventListener('change', checkDarkMode);

    return () => {
      // 移除监听
      mediaQuery.removeEventListener('change', checkDarkMode);
    }
  }, [checkDarkMode, mediaQuery])

  return (
    <div className="popup-app" style={{ background: isDarkMode ? '#111' : 'white' }}>
      <ConfigProvider locale={zhCN} theme={{ algorithm: isDarkMode ? theme.darkAlgorithm : undefined }}>
        <Header />

        <Tabs
          type="card"
          style={{ marginTop: 20 }}
          tabBarStyle={{ paddingLeft: 20, paddingRight: 20 }}
          items={items}
        />
      </ConfigProvider>
    </div>
  )
}

render(<App />, window.document.querySelector('#app-container')
);

if (module.hot) module.hot.accept();
