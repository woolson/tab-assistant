import React, { useEffect, useRef, useState } from 'react';
import { Button, Form, message, Segmented } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { QUICK_SEARCH_TOGGLE, readQuickSearchShortcut, requestQuickSearch } from '@/common/quickSearch';
import { useI18n } from '@/common/i18n';
import { quickSearchAppearance, quickSearchGlassVariables } from '@/common/quickSearchAppearance';
import { createSearchGlass, type SearchGlassController } from '@/common/glass';

const QuickSearchSettings = () => {
  const { t } = useI18n();
  const form = Form.useFormInstance();
  const material = Form.useWatch('quickSearchMaterial', form);
  const theme = Form.useWatch('theme', form);
  const appearance = quickSearchAppearance({ quickSearchMaterial: material, theme });
  const previewSurface = useRef<HTMLDivElement>(null);
  const previewGlass = useRef<SearchGlassController>();
  useEffect(() => {
    if (!previewSurface.current) return;
    previewGlass.current = createSearchGlass(previewSurface.current, appearance);
    return () => { previewGlass.current?.destroy(); previewGlass.current = undefined; };
  }, []);
  useEffect(() => { previewGlass.current?.update(appearance); }, [material, theme]);
  const [shortcut, setShortcut] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => { void readQuickSearchShortcut().then(value => { if (active) setShortcut(value); }); };
    load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, []);
  const open = async () => {
    try { const response = await requestQuickSearch(QUICK_SEARCH_TOGGLE); if (!response.ok) throw new Error(); }
    catch { message.error(t('quickSearchUnavailable')); }
  };
  const configure = () => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.create) return;
    const url = navigator.userAgent.includes('Edg/') ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';
    void chrome.tabs.create({ url }).catch(() => message.error(t('quickSearchUnavailable')));
  };
  return <section className="settings-section quick-search-settings">
    <h2><span />{t('quickSearchTitle')}</h2>
    <p>{t('quickSearchSettingExtra')}</p>
    <div className="quick-search-material-preview" data-material={appearance.quickSearchMaterial} style={quickSearchGlassVariables(appearance) as React.CSSProperties} aria-hidden="true">
      <span className="quick-search-preview-orb is-blue" /><span className="quick-search-preview-orb is-pink" />
      <div className="quick-search-preview-glass">
        <div ref={previewSurface} className="quick-search-preview-surface" />
        <div className="quick-search-preview-input"><SearchOutlined /><span>{t('quickSearchTitle')}</span><kbd>esc</kbd></div>
        <div className="quick-search-preview-result"><span /><span /><span>↵</span></div>
      </div>
    </div>
    <Form.Item name="quickSearchMaterial" label={t('quickSearchAppearance')} extra={t('quickSearchAppearanceExtra')}
      getValueProps={value => ({ value: quickSearchAppearance({ quickSearchMaterial: value }).quickSearchMaterial })}>
      <Segmented block options={[
        { value: 'classic', label: t('quickSearchClassic') },
        { value: 'frosted', label: t('quickSearchFrosted') },
      ]} />
    </Form.Item>
    <div className="quick-search-setting-actions">
      <kbd>{shortcut || t('quickSearchUnassigned')}</kbd>
      <Button icon={<SearchOutlined />} onClick={() => void open()}>{t('quickSearchOpen')}</Button>
      <Button onClick={configure}>{t('quickSearchConfigure')}</Button>
    </div>
    <p className="quick-search-appearance-save-hint">{t('quickSearchAppearanceSaveHint')}</p>
  </section>;
};

export default QuickSearchSettings;
