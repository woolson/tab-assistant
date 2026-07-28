import React from 'react';
import {
  AppstoreOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import Logo from '@/assets/img/icon.svg';
import SidebarTexture from '@/assets/img/ui/sidebar-aurora.png';
import { useI18n } from '@/common/i18n';

export type PopupPageKey = 'tabOverview' | 'rules' | 'setting' | 'about';

interface HeaderProps {
  activeKey: PopupPageKey;
  onChange: (key: PopupPageKey) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeKey, onChange }) => {
  const { t } = useI18n();
  const items = [
    { key: 'tabOverview' as const, label: t('navTabs'), icon: <FolderOpenOutlined /> },
    { key: 'rules' as const, label: t('navRules'), icon: <AppstoreOutlined /> },
    { key: 'setting' as const, label: t('navSettings'), icon: <SettingOutlined /> },
    { key: 'about' as const, label: t('navAbout'), icon: <InfoCircleOutlined /> },
  ];

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

      <nav className="popup-navigation">
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
    </aside>
  );
}

export default Header
