import React, { useCallback, useState } from 'react';
import { Button, Drawer, message } from 'antd';
import {
  ArrowRightOutlined,
  ExportOutlined,
  ImportOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import FileSaver from 'file-saver';
import Logo from '@/assets/img/icon.svg';
import PageHeader from '../PageHeader';
import { StorageKeyEnum } from '@/common/const';
import { openLink, reloadConfig } from '@/common';
import { Language, useI18n } from '@/common/i18n';
import type { ThemeMode } from '@/pages/Background/types';
import PackageJson from '../../../../package.json';
import './style.less';

const WEB_STORE_URL = 'https://chromewebstore.google.com/detail/obdaljfdjocbdmpofhncldmfppjeemda';
const REPOSITORY_URL = 'https://github.com/woolson/tab-assistant';
const FEEDBACK_URL = `${REPOSITORY_URL}/issues`;

const canUseStorage = () => typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);
const isThemeMode = (value: unknown): value is ThemeMode => (
  value === 'system' || value === 'light' || value === 'dark'
);

export const About: React.FC<{
  onThemeModeChange: (themeMode: ThemeMode) => void;
}> = ({ onThemeModeChange }) => {
  const { setLanguage, t } = useI18n();
  const [showChangeLog, setShowChangeLog] = useState(false);

  const exportSetting = useCallback(async () => {
    const storage = canUseStorage()
      ? await chrome.storage.sync.get([StorageKeyEnum.RULES, StorageKeyEnum.SETTING])
      : {};
    const blob = new Blob([JSON.stringify(storage, null, 2)], { type: 'application/json' });
    FileSaver.saveAs(blob, 'tab-assistant-setting.json');
    message.success(t('settingsSaved'));
  }, [t]);

  const importSetting = useCallback(async () => {
    const file = await new Promise<File | undefined>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = event => {
        const files = (event.target as HTMLInputElement).files;
        resolve(files?.[0]);
      };
      input.click();
    });
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async event => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (canUseStorage()) await chrome.storage.sync.set(data);
        const importedLanguage = data?.[StorageKeyEnum.SETTING]?.language as Language | undefined;
        if (importedLanguage === 'zh-CN' || importedLanguage === 'en-US') {
          setLanguage(importedLanguage);
        }
        const importedTheme = data?.[StorageKeyEnum.SETTING]?.theme;
        if (isThemeMode(importedTheme)) {
          onThemeModeChange(importedTheme);
        }
        reloadConfig(t('ruleUpdateSuccess'));
      } catch (error) {
        message.error(t('settingsImportFailed'));
      }
    };
    reader.readAsText(file);
  }, [onThemeModeChange, setLanguage, t]);

  return (
    <section className="popup-screen about-screen">
      <PageHeader title={t('aboutPageTitle')} subtitle={t('aboutPageDescription')} />

      <div className="about-layout">
        <div className="about-brand-panel">
          <img src={Logo} alt="" className="about-logo" />
          <h2>{t('appTitle')}</h2>
          <p>{t('appDescription')}</p>

          <div className="about-privacy">
            <SafetyCertificateOutlined />
            <span>{t('privacyLocal')}</span>
          </div>

          <div className="about-transfer-actions">
            <Button icon={<ExportOutlined />} onClick={exportSetting}>
              {t('exportRulesSettings')}
            </Button>
            <Button icon={<ImportOutlined />} onClick={importSetting}>
              {t('importRulesSettings')}
            </Button>
          </div>
        </div>

        <aside className="about-release-panel">
          <span className="about-release-label">{t('currentVersion')}</span>
          <strong>v{PackageJson.version}</strong>
          <time dateTime="2026-07-30">2026-07-30</time>

          <Button
            type="link"
            className="about-changelog-link"
            onClick={() => setShowChangeLog(true)}
          >
            {t('viewChangelog')} <ArrowRightOutlined />
          </Button>

          <div className="about-link-list">
            <button type="button" onClick={() => openLink(REPOSITORY_URL)}>
              <span>{t('author').replace('：', '').replace(': ', '')}</span>
              <span>Woolson Lee</span>
              <LinkOutlined />
            </button>
            <button type="button" onClick={() => openLink(FEEDBACK_URL)}>
              <span>{t('feedback')}</span>
              <span />
              <LinkOutlined />
            </button>
            <button type="button" onClick={() => openLink(WEB_STORE_URL)}>
              <span>{t('chromeWebStore')}</span>
              <span />
              <LinkOutlined />
            </button>
          </div>
        </aside>
      </div>

      <footer className="about-footer">{t('focusedBrowsing')}</footer>

      <Drawer
        rootClassName="changelog-drawer"
        title={t('changelog')}
        open={showChangeLog}
        width={318}
        onClose={() => setShowChangeLog(false)}
      >
        <div className="release-timeline">
          <section className="release-entry is-current">
            <span className="release-node" />
            <div className="release-heading">
              <div>
                <h3>v1.4.3</h3>
                <time>2026-07-30</time>
              </div>
              <span className="release-badge release-badge-current">{t('currentVersionBadge')}</span>
            </div>
            <h4>{t('etc').replace('：', '').replace(':', '')}</h4>
            <ul>
              <li>{t('changelog1431')}</li>
            </ul>
          </section>

          <section className="release-entry">
            <span className="release-node" />
            <div className="release-heading">
              <div>
                <h3>v1.4.2</h3>
                <time>2026-07-29</time>
              </div>
              <span className="release-badge">{t('etc').replace('：', '').replace(':', '')}</span>
            </div>
            <h4>{t('newFeature').replace('：', '').replace(':', '')}</h4>
            <ul>
              <li>{t('changelog1411')}</li>
              <li>{t('changelog1412')}</li>
            </ul>
            <h4>{t('etc').replace('：', '').replace(':', '')}</h4>
            <ul>
              <li>{t('changelog1413')}</li>
            </ul>
          </section>

          <section className="release-entry">
            <span className="release-node" />
            <div className="release-heading">
              <div>
                <h3>v1.3.3</h3>
                <time>2026-07-26</time>
              </div>
              <span className="release-badge">{t('bugFixes').replace('：', '').replace(':', '')}</span>
            </div>
            <h4>{t('bugFixes').replace('：', '').replace(':', '')}</h4>
            <ul>
              <li>{t('changelog1331')}</li>
              <li>{t('changelog1332')}</li>
            </ul>
          </section>

          <section className="release-entry">
            <span className="release-node" />
            <div className="release-heading">
              <div>
                <h3>v1.3.2</h3>
                <time>2026-07-25</time>
              </div>
              <span className="release-badge">{t('newFeature').replace('：', '')}</span>
            </div>
            <ul>
              <li>{t('changelog1321')}</li>
            </ul>
          </section>

          <section className="release-entry">
            <span className="release-node" />
            <div className="release-heading">
              <div>
                <h3>v1.3.1</h3>
                <time>2026-05-11</time>
              </div>
              <span className="release-badge">{t('newFeature').replace('：', '')}</span>
            </div>
            <ul>
              <li>{t('changelog1301')}</li>
              <li>{t('changelog1302')}</li>
              <li>{t('changelog1303')}</li>
            </ul>
          </section>

          <section className="release-entry release-entry-compact">
            <span className="release-node" />
            <div className="release-heading">
              <div>
                <h3>v1.2.0</h3>
                <time>2024-11-25</time>
              </div>
            </div>
          </section>
        </div>

        <Button
          type="link"
          className="full-changelog-link"
          onClick={() => openLink(WEB_STORE_URL)}
        >
          {t('fullChangelog')} <ArrowRightOutlined />
        </Button>
      </Drawer>
    </section>
  );
};

export default About;
