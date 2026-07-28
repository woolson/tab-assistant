import { ConfigProvider, Spin, theme } from 'antd';
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { render } from 'react-dom';
import Header, { PopupPageKey } from './Header';
import './index.less';
import '../../common/styles/font.less';
import { StorageKeyEnum } from '@/common/const';
import { antdLocales, getBrowserLanguage, I18nProvider, Language, useI18n } from '@/common/i18n';
import type { ThemeMode } from '@/pages/Background/types';

const TabOverview = lazy(() => import('./TabOverview'));
const Rules = lazy(() => import('./Rules'));
const Setting = lazy(() => import('./Setting'));
const About = lazy(() => import('./About'));
const previewTheme = new URLSearchParams(window.location.search).get('theme');
const previewThemeOverride = previewTheme === 'light' || previewTheme === 'dark'
  ? previewTheme
  : undefined;

const isThemeMode = (value: unknown): value is ThemeMode => (
  value === 'system' || value === 'light' || value === 'dark'
);

const LazyTabPane: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={<div className="popup-tab-loading"><Spin size="small" /></div>}>
    {children}
  </Suspense>
);

const App = () => {
  const mediaQuery = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [systemIsDark, setSystemIsDark] = useState(() => mediaQuery.matches);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [language, setLanguage] = useState<Language>(() => getBrowserLanguage());
  const isDarkMode = previewThemeOverride
    ? previewThemeOverride === 'dark'
    : themeMode === 'system'
      ? systemIsDark
      : themeMode === 'dark';

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync) return;

    chrome.storage.sync.get([StorageKeyEnum.SETTING]).then(res => {
      const storedSettings = res?.[StorageKeyEnum.SETTING];
      const storedLanguage = storedSettings?.language;
      if (storedLanguage === 'zh-CN' || storedLanguage === 'en-US') {
        setLanguage(storedLanguage);
      }
      if (isThemeMode(storedSettings?.theme)) {
        setThemeMode(storedSettings.theme);
      }
    });
  }, []);

  useEffect(() => {
    const updateSystemTheme = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    mediaQuery.addEventListener('change', updateSystemTheme);
    return () => mediaQuery.removeEventListener('change', updateSystemTheme);
  }, [mediaQuery]);

  return (
    <I18nProvider language={language} setLanguage={setLanguage}>
      <PopupApp
        isDarkMode={isDarkMode}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
      />
    </I18nProvider>
  )
}

const PopupApp: React.FC<{
  isDarkMode: boolean;
  themeMode: ThemeMode;
  setThemeMode: (themeMode: ThemeMode) => void;
}> = ({ isDarkMode, themeMode, setThemeMode }) => {
  const { language } = useI18n();
  const [activeKey, setActiveKey] = useState<PopupPageKey>('tabOverview');

  return (
    <div className={`popup-app${isDarkMode ? ' is-dark' : ''}`}>
      <ConfigProvider
        locale={antdLocales[language]}
        theme={{
          algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: '#2167f3',
            colorInfo: '#2167f3',
            borderRadius: 10,
            controlHeight: 38,
            fontSize: 14,
          },
        }}
      >
        <Header activeKey={activeKey} onChange={setActiveKey} />

        <main className="popup-content">
          {activeKey === 'tabOverview' && <LazyTabPane><TabOverview /></LazyTabPane>}
          {activeKey === 'rules' && <LazyTabPane><Rules /></LazyTabPane>}
          {activeKey === 'setting' && (
            <LazyTabPane>
              <Setting themeMode={themeMode} onThemeModeChange={setThemeMode} />
            </LazyTabPane>
          )}
          {activeKey === 'about' && (
            <LazyTabPane>
              <About onThemeModeChange={setThemeMode} />
            </LazyTabPane>
          )}
        </main>
      </ConfigProvider>
    </div>
  )
}

render(<App />, window.document.querySelector('#app-container')
);

if (module.hot) module.hot.accept();
