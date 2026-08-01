import { Button, ConfigProvider, Modal, Spin, theme } from 'antd';
import { InsertRowRightOutlined, SettingOutlined } from '@ant-design/icons';
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { render } from 'react-dom';
import Header, { PopupPageKey } from './Header';
import './index.less';
import '../../common/styles/font.less';
import { StorageKeyEnum } from '@/common/const';
import { antdLocales, getBrowserLanguage, I18nProvider, Language, useI18n } from '@/common/i18n';
import type { ThemeMode } from '@/pages/Background/types';

export type ExtensionSurface = 'popup' | 'sidepanel';

const TabOverview = lazy(() => import('./TabOverview'));
const Rules = lazy(() => import('./Rules'));
const Setting = lazy(() => import('./Setting'));
const About = lazy(() => import('./About'));
const previewTheme = new URLSearchParams(window.location.search).get('theme');
const previewThemeOverride = previewTheme === 'light' || previewTheme === 'dark'
  ? previewTheme
  : undefined;
const previewLanguage = new URLSearchParams(window.location.search).get('lang');
const previewLanguageOverride = previewLanguage === 'zh-CN' || previewLanguage === 'en-US'
  ? previewLanguage
  : undefined;
const previewPage = new URLSearchParams(window.location.search).get('page');
const previewSidePanelGuide = new URLSearchParams(window.location.search).get('guide') === 'sidepanel';
const previewPageOverride: PopupPageKey | undefined = (
  previewPage === 'tabOverview'
  || previewPage === 'rules'
  || previewPage === 'setting'
  || previewPage === 'about'
) ? previewPage : undefined;

const isThemeMode = (value: unknown): value is ThemeMode => (
  value === 'system' || value === 'light' || value === 'dark'
);

const LazyTabPane: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={<div className="popup-tab-loading"><Spin size="small" /></div>}>
    {children}
  </Suspense>
);

const App: React.FC<{ surface: ExtensionSurface }> = ({ surface }) => {
  const mediaQuery = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [systemIsDark, setSystemIsDark] = useState(() => mediaQuery.matches);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [language, setLanguage] = useState<Language>(() => previewLanguageOverride || getBrowserLanguage());
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
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'sync') return;
      const nextSettings = changes[StorageKeyEnum.SETTING]?.newValue;
      if (!nextSettings) return;

      if (nextSettings.language === 'zh-CN' || nextSettings.language === 'en-US') {
        setLanguage(nextSettings.language);
      }
      if (isThemeMode(nextSettings.theme)) setThemeMode(nextSettings.theme);
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    const updateSystemTheme = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    mediaQuery.addEventListener('change', updateSystemTheme);
    return () => mediaQuery.removeEventListener('change', updateSystemTheme);
  }, [mediaQuery]);

  return (
    <I18nProvider language={language} setLanguage={setLanguage}>
      <PopupApp
        surface={surface}
        isDarkMode={isDarkMode}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
      />
    </I18nProvider>
  )
}

const PopupApp: React.FC<{
  surface: ExtensionSurface;
  isDarkMode: boolean;
  themeMode: ThemeMode;
  setThemeMode: (themeMode: ThemeMode) => void;
}> = ({ surface, isDarkMode, themeMode, setThemeMode }) => {
  const { language, t } = useI18n();
  const [activeKey, setActiveKey] = useState<PopupPageKey>(previewPageOverride || 'tabOverview');
  const [showSidePanelGuide, setShowSidePanelGuide] = useState(previewSidePanelGuide);
  const [highlightToolbarEntry, setHighlightToolbarEntry] = useState(false);

  useEffect(() => {
    if (previewSidePanelGuide) return;
    if (surface !== 'popup' || typeof chrome === 'undefined' || !chrome.storage?.local) return;

    chrome.storage.local.get(StorageKeyEnum.SIDE_PANEL_GUIDE_PENDING)
      .then(storage => {
        if (storage[StorageKeyEnum.SIDE_PANEL_GUIDE_PENDING] !== true) return;

        setShowSidePanelGuide(true);
        return chrome.storage.local.set({ [StorageKeyEnum.SIDE_PANEL_GUIDE_PENDING]: false });
      })
      .catch(error => console.error('Failed to load side panel guide state', error));
  }, [surface]);

  const goToToolbarEntrySetting = () => {
    setShowSidePanelGuide(false);
    setHighlightToolbarEntry(true);
    setActiveKey('setting');
  };

  return (
    <div className={`popup-app surface-${surface}${isDarkMode ? ' is-dark' : ''}`}>
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
        <Header
          activeKey={activeKey}
          onChange={setActiveKey}
          surface={surface}
        />

        <main className="popup-content">
          {activeKey === 'tabOverview' && (
            <LazyTabPane><TabOverview surface={surface} /></LazyTabPane>
          )}
          {activeKey === 'rules' && <LazyTabPane><Rules /></LazyTabPane>}
          {activeKey === 'setting' && (
            <LazyTabPane>
              <Setting
                themeMode={themeMode}
                onThemeModeChange={setThemeMode}
                highlightToolbarEntry={highlightToolbarEntry}
              />
            </LazyTabPane>
          )}
          {activeKey === 'about' && (
            <LazyTabPane>
              <About onThemeModeChange={setThemeMode} />
            </LazyTabPane>
          )}
        </main>

        <Modal
          className="sidepanel-guide-modal"
          rootClassName={`sidepanel-guide-root${isDarkMode ? ' is-dark' : ''}`}
          open={showSidePanelGuide}
          centered
          width={430}
          title={null}
          footer={null}
          closable={false}
          maskClosable={false}
          onCancel={() => setShowSidePanelGuide(false)}
        >
          <div className="sidepanel-guide-icon"><InsertRowRightOutlined /></div>
          <h2>{t('sidePanelGuideTitle')}</h2>
          <p>{t('sidePanelGuideDescription')}</p>
          <div className="sidepanel-guide-location">
            <SettingOutlined />
            <span>{t('sidePanelGuideLocation')}</span>
          </div>
          <div className="sidepanel-guide-actions">
            <Button onClick={() => setShowSidePanelGuide(false)}>{t('sidePanelGuideLater')}</Button>
            <Button type="primary" onClick={goToToolbarEntrySetting}>{t('sidePanelGuideGoSettings')}</Button>
          </div>
        </Modal>
      </ConfigProvider>
    </div>
  )
}

export const mountExtensionApp = (surface: ExtensionSurface) => {
  render(<App surface={surface} />, window.document.querySelector('#app-container'));
};

if (module.hot) module.hot.accept();
