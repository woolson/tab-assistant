import { ConfigProvider, Spin, Tabs, theme } from 'antd';
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { render } from 'react-dom';
import TabOverview from './TabOverview';
// import Useful from './Usefal';
import Header from './Header';
import './index.less';
import '../../common/styles/font.less';
import { StorageKeyEnum } from '@/common/const';
import { antdLocales, getBrowserLanguage, I18nProvider, Language, useI18n } from '@/common/i18n';

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
  const [language, setLanguage] = useState<Language>(() => getBrowserLanguage());
  const mediaQuery = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);

  useEffect(() => {
    chrome.storage.sync.get([StorageKeyEnum.SETTING]).then(res => {
      const storedLanguage = res?.[StorageKeyEnum.SETTING]?.language;
      if (storedLanguage === 'zh-CN' || storedLanguage === 'en-US') {
        setLanguage(storedLanguage);
      }
    });
  }, []);

  return (
    <I18nProvider language={language} setLanguage={setLanguage}>
      <PopupApp isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} mediaQuery={mediaQuery} />
    </I18nProvider>
  )
}

const PopupApp: React.FC<{
  isDarkMode: boolean;
  setIsDarkMode: (isDarkMode: boolean) => void;
  mediaQuery: MediaQueryList;
}> = ({ isDarkMode, setIsDarkMode, mediaQuery }) => {
  const { language, t } = useI18n();

  const items = useMemo(() => [
    {
      key: 'tabOverview',
      label: t('tabCurrent'),
      children: <TabOverview />,
    },
    {
      key: 'rules',
      label: t('tabRules'),
      children: <LazyTabPane><Rules /></LazyTabPane>,
    },
    // {
    //   key: 'useful',
    //   label: '常用分组',
    //   children: <Useful />,
    // },
    {
      key: 'setting',
      label: t('tabSettings'),
      children: <LazyTabPane><Setting /></LazyTabPane>,
    },
    {
      key: 'about',
      label: t('tabAbout'),
      children: <LazyTabPane><About /></LazyTabPane>,
    },
  ], [t]);

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
      <ConfigProvider locale={antdLocales[language]} theme={{ algorithm: isDarkMode ? theme.darkAlgorithm : undefined }}>
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
