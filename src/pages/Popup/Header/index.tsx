import React from 'react';
import {
  AppstoreOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  InsertRowRightOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import Logo from '@/assets/img/icon.svg';
import SidebarTexture from '@/assets/img/ui/sidebar-aurora.png';
import SidePanelTexture from '@/assets/img/ui/sidepanel-aurora.jpg';
import { useI18n } from '@/common/i18n';

export type PopupPageKey = 'tabOverview' | 'rules' | 'setting' | 'about';

interface HeaderProps {
  activeKey: PopupPageKey;
  onChange: (key: PopupPageKey) => void;
  surface?: 'popup' | 'sidepanel';
}

export const Header: React.FC<HeaderProps> = ({
  activeKey,
  onChange,
  surface = 'popup',
}) => {
  const { t } = useI18n();
  const openSidePanel = () => {
    void chrome.sidePanel
      .open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
      .catch(error => console.error('Failed to open side panel', error));
  };
  const items = [
    { key: 'tabOverview' as const, label: t('navTabs'), icon: <FolderOpenOutlined /> },
    { key: 'rules' as const, label: t('navRules'), icon: <AppstoreOutlined /> },
    { key: 'setting' as const, label: t('navSettings'), icon: <SettingOutlined /> },
    { key: 'about' as const, label: t('navAbout'), icon: <InfoCircleOutlined /> },
  ];

  const navigation = (
    <nav className="popup-navigation" aria-label={t('appTitle')}>
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          className={`popup-navigation-item${activeKey === item.key ? ' is-active' : ''}`}
          onClick={() => onChange(item.key)}
          aria-current={activeKey === item.key ? 'page' : undefined}
        >
          <span className="popup-navigation-icon">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );

  if (surface === 'sidepanel') {
    return (
      <header
        className="sidepanel-header"
        style={{ backgroundImage: `url(${SidePanelTexture})` }}
      >
        <div className="sidepanel-header-main">
          <div className="sidepanel-brand">
            <img src={Logo} alt="" className="sidepanel-brand-logo" />
            <span>TabAssistant</span>
          </div>
        </div>

        {navigation}
      </header>
    );
  }

  return (
    <aside
      className="popup-sidebar"
      style={{ backgroundImage: `url(${SidebarTexture})` }}
      aria-label={t('appTitle')}
    >
      <div className="popup-brand">
        <img src={Logo} alt="" className="popup-brand-logo" />
        <span className="popup-brand-name">TabAssistant</span>
      </div>

      {navigation}

      <button
        type="button"
        className="popup-sidepanel-trigger"
        onClick={openSidePanel}
        title={t('openSidePanel')}
      >
        <InsertRowRightOutlined />
        <span>{t('openSidePanel')}</span>
      </button>
    </aside>
  );
}

export default Header
