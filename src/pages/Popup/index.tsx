import { Button, ConfigProvider, Row, Tabs, theme } from 'antd';
import React, { useCallback, useEffect, useState } from 'react';
import { render } from 'react-dom';
import zhCN from 'antd/es/locale/zh_CN';
import Rules from './Rules';
import About from './About';
import Setting from './Setting';
// import Useful from './Usefal';
import Header from './Header';
import './index.less';
import '../../common/styles/font.less';

const items = [
  {
    key: 'rules',
    label: '分组规则',
    children: <Rules />,
  },
  // {
  //   key: 'useful',
  //   label: '常用分组',
  //   children: <Useful />,
  // },
  {
    key: 'setting',
    label: '其他设置',
    children: <Setting />,
  },
  {
    key: 'about',
    label: '关于插件',
    children: <About />,
  },
];

const App = () => {
  const [isDarkMode, setIsDarkMode] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);

  // 检测当前是否为暗色模式
  const checkDarkMode = useCallback(() => {
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDarkMode(isDarkMode);
  }, [])

  useEffect(() => {
    // 初始化时检查一次
    checkDarkMode();
    // 监听系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      checkDarkMode();
    });

    return () => {
      // 移除监听
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', checkDarkMode);
    }
  }, [])

  return (
    <div style={{ background: isDarkMode ? '#111' : 'white', height: '100%' }}>
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
