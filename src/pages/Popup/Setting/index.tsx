import React, { memo, useCallback, useEffect, useState } from 'react';
import { Button, Form, message, Segmented, Select } from 'antd';
import { useForm } from 'antd/es/form/Form';
import PageHeader from '../PageHeader';
import { EventNameEnum, StorageKeyEnum } from '@/common/const';
import { TabAssistantConfig, ThemeMode } from '@/pages/Background/types';
import { languageOptions, TranslationKey, useI18n } from '@/common/i18n';
import './style.less';

const canUseStorage = () => typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);
const themeOptions: Array<{ value: ThemeMode; labelKey: TranslationKey }> = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
];

interface SettingProps {
  themeMode: ThemeMode;
  onThemeModeChange: (themeMode: ThemeMode) => void;
}

export const Setting = memo<SettingProps>(({ themeMode, onThemeModeChange }) => {
  const [form] = useForm<TabAssistantConfig['setting']>();
  const [defaultOptions, setDefaultOptions] = useState<Array<{ value: string; label: string }>>([]);
  const { language, setLanguage, t } = useI18n();

  useEffect(() => {
    const loadSettings = async () => {
      if (!canUseStorage()) {
        const previewSettings = {
          language,
          theme: themeMode,
          remove3w: false,
          removeKeywordList: ['www'],
        };
        form.setFieldsValue(previewSettings);
        setDefaultOptions([{ value: 'www', label: 'www' }]);
        return;
      }

      const response = await chrome.storage.sync.get([StorageKeyEnum.SETTING]);
      const settings = response?.[StorageKeyEnum.SETTING] || {};
      const removeKeywordList = settings.removeKeywordList || ['www'];
      setDefaultOptions(removeKeywordList.map((value: string) => ({ value, label: value })));
      form.setFieldsValue({ language, theme: themeMode, ...settings, removeKeywordList });
    };

    loadSettings();
  }, [form, language, themeMode]);

  const onFinish = useCallback(async (formValue: TabAssistantConfig['setting']) => {
    if (canUseStorage()) await chrome.storage.sync.set({ [StorageKeyEnum.SETTING]: formValue });
    if (formValue.language) setLanguage(formValue.language);
    onThemeModeChange(formValue.theme || 'system');

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(EventNameEnum.RELOAD_RULE, response => {
        if (response === EventNameEnum.RELOAD_SUCC) message.success(t('updateSuccess'));
      });
    } else {
      message.success(t('updateSuccess'));
    }
  }, [onThemeModeChange, setLanguage, t]);

  return (
    <section className="popup-screen tab-assistant-setting">
      <PageHeader title={t('tabSettings')} subtitle={t('settingsDescription')} />

      <Form form={form} layout="vertical" onFinish={onFinish} className="settings-form">
        <section className="settings-section">
          <h2><span />{t('languageSection')}</h2>

          <div className="settings-preferences-grid">
            <Form.Item
              label={t('themeSetting')}
              name="theme"
              extra={t('themeSettingExtra')}
            >
              <Segmented
                block
                options={themeOptions.map(option => ({
                  value: option.value,
                  label: t(option.labelKey),
                }))}
              />
            </Form.Item>

            <Form.Item
              label={t('languageSetting')}
              name="language"
              extra={t('languageSettingExtra')}
            >
              <Segmented
                block
                options={languageOptions.map(option => ({
                  value: option.value,
                  label: t(option.labelKey),
                }))}
              />
            </Form.Item>
          </div>
        </section>

        <section className="settings-section">
          <h2><span />{t('groupNamingSection')}</h2>

          <Form.Item
            label={t('groupNameIgnoreWords')}
            name="removeKeywordList"
            extra={t('groupNameIgnoreWordsExtra')}
          >
            <Select
              allowClear
              open={false}
              mode="tags"
              placeholder={t('ignoreWordsPlaceholder')}
              options={defaultOptions}
            />
          </Form.Item>
        </section>

        <div className="settings-footer">
          <span>{t('settingsSyncHint')}</span>
          <Button htmlType="submit" type="primary">{t('saveSettings')}</Button>
        </div>
      </Form>
    </section>
  );
});

export default Setting;
