import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Form, Input, InputNumber, message, Select, Switch } from 'antd';
import { useForm } from 'antd/es/form/Form';
import { AI_API_CONFIG_KEY, AI_API_PRESETS, AiApiError, aiApiEndpoint, defaultAiApiConfig, normalizeAiApiConfig, requestAiApiPermission, testAiApiConnection, type AiApiConfig, type AiApiProvider } from '@/common/aiApi';
import { EventNameEnum, StorageKeyEnum } from '@/common/const';
import { queryClickSourcePermission, requestClickSourcePermission } from '@/common/permissions';
import { type TranslationKey, useI18n } from '@/common/i18n';
import AiModelSelect from './AiModelSelect';
import GroupingPreferences from './GroupingPreferences';
import AiTokenUsage from './AiTokenUsage';
import './AiSettings.less';

type AiSettingsForm = { aiApi: AiApiConfig; rememberClickSource: boolean };

function apiErrorMessage(error: unknown, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  if (!(error instanceof AiApiError)) return t('aiApiNetworkError');
  if (error.code === 'http') {
    if (error.status === 401 || error.status === 403) return t('aiApiAuthError');
    if (error.status === 404) return t('aiApiModelError');
    if (error.status === 429) return t('aiApiRateError');
    return t('aiApiHttpError', { status: error.status || 0 });
  }
  const labels: Partial<Record<typeof error.code, TranslationKey>> = {
    'not-configured': 'aiApiRequired', 'invalid-url': 'aiApiInvalidUrl', permission: 'aiApiPermissionDenied',
    timeout: 'aiApiTimeoutError', network: 'aiApiNetworkError', 'invalid-response': 'aiApiResponseError',
  };
  return t(labels[error.code] || 'aiApiNetworkError');
}

const AiSettings: React.FC<{ active: boolean }> = ({ active }) => {
  const { t } = useI18n();
  const loadError = useRef(t('aiApiLoadError'));
  const [form] = useForm<AiSettingsForm>();
  const provider = Form.useWatch(['aiApi', 'provider'], form) || 'deepseek';
  const protocol = Form.useWatch(['aiApi', 'protocol'], form) || 'openai';
  const responseTimeout = Form.useWatch(['aiApi', 'timeoutSeconds'], form) || 25;
  const streaming = provider === 'openai' && protocol === 'openai';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const savePermission = useRef<Promise<boolean> | null>(null);
  const testController = useRef<AbortController | null>(null);
  useEffect(() => () => testController.current?.abort(), []);
  useEffect(() => { if (!active) testController.current?.abort(); }, [active]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        form.setFieldsValue({ aiApi: defaultAiApiConfig(), rememberClickSource: false });
        return;
      }
      const [local, sync, granted] = await Promise.all([
        chrome.storage.local.get(AI_API_CONFIG_KEY),
        chrome.storage.sync.get(StorageKeyEnum.SETTING),
        queryClickSourcePermission(),
      ]);
      if (cancelled) return;
      form.setFieldsValue({
        aiApi: normalizeAiApiConfig(local[AI_API_CONFIG_KEY]),
        rememberClickSource: Boolean(sync[StorageKeyEnum.SETTING]?.rememberClickSource) && granted,
      });
    };
    void load().catch(() => { if (!cancelled) message.error(loadError.current); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [form]);

  const startSavePermission = () => {
    savePermission.current = null;
    try {
      const config = normalizeAiApiConfig(form.getFieldValue('aiApi'));
      if (!config.apiKey || !config.model) return;
      savePermission.current = requestAiApiPermission(config);
    } catch (error) { message.error(apiErrorMessage(error, t)); }
  };

  const onFinish = useCallback(async (value: AiSettingsForm) => {
    const config = normalizeAiApiConfig(value.aiApi);
    if (!config.apiKey || !config.model) { message.error(t('aiApiRequired')); return; }
    if (!savePermission.current || !await savePermission.current) { message.error(t('aiApiPermissionDenied')); return; }
    setSaving(true);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [AI_API_CONFIG_KEY]: config });
        // Only patch AI-owned preferences: general settings and the mode may
        // have changed in the popup or Side Panel while this form was open.
        const current = await chrome.storage.sync.get(StorageKeyEnum.SETTING);
        await chrome.storage.sync.set({ [StorageKeyEnum.SETTING]: {
          ...current[StorageKeyEnum.SETTING], rememberClickSource: value.rememberClickSource,
        } });
      }
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(EventNameEnum.RELOAD_RULE, () => void chrome.runtime.lastError);
      }
      message.success(t('aiApiSaved'));
    } catch { message.error(t('aiApiSaveError')); }
    finally { setSaving(false); }
  }, [t]);

  const testConnection = async () => {
    if (testingApi) return;
    const config = normalizeAiApiConfig(form.getFieldValue('aiApi'));
    let permission: Promise<boolean>;
    try {
      if (!config.apiKey || !config.model) throw new AiApiError('not-configured');
      // Request synchronously, before validation or network awaits.
      permission = requestAiApiPermission(config);
    } catch (error) { message.error(apiErrorMessage(error, t)); return; }
    setTestingApi(true);
    const controller = new AbortController();
    testController.current = controller;
    try {
      if (!await permission) throw new AiApiError('permission');
      await testAiApiConnection(config, controller.signal);
      message.success(t('aiApiTestSuccess'));
    } catch (error) {
      if (!controller.signal.aborted) message.error(apiErrorMessage(error, t));
    } finally { testController.current = null; setTestingApi(false); }
  };


  return (
    <Form form={form} layout="vertical" className="ai-config-form" onFinish={onFinish} disabled={loading || saving}
      onValuesChange={changed => { if (changed.aiApi) testController.current?.abort(); }}>
      <div className="ai-config-scroll">
        <p className="ai-config-description">{t('aiAutoGroupEnableSettingExtra')}</p>
        {active && <GroupingPreferences />}
        <Form.Item label={t('aiApiProvider')} name={['aiApi', 'provider']}>
          <Select options={[...AI_API_PRESETS.map(item => ({ value: item.provider, label: item.label })), { value: 'custom', label: t('aiApiCustom') }]}
            onChange={(value: AiApiProvider) => { testController.current?.abort(); form.setFieldValue('aiApi', defaultAiApiConfig(value)); }} />
        </Form.Item>
        <Form.Item label={t('aiApiModel')} name={['aiApi', 'model']} rules={[{ required: true, whitespace: true, message: t('aiApiRequired') }]}>
          <AiModelSelect key={provider} provider={provider} />
        </Form.Item>
        <Form.Item label="API Key" name={['aiApi', 'apiKey']} extra={t('aiApiKeyExtra')} rules={[{ required: true, whitespace: true, message: t('aiApiRequired') }]}>
          <Input.Password autoComplete="off" placeholder={t('aiApiKeyPlaceholder')} />
        </Form.Item>
        <details className="ai-api-advanced" key={provider} open={provider === 'custom' ? true : undefined}>
          <summary>{t('aiApiAdvanced')}</summary>
          <Form.Item label={t('aiApiProtocol')} name={['aiApi', 'protocol']}>
            <Select options={[{ value: 'openai', label: 'OpenAI Chat Completions' }, { value: 'anthropic', label: 'Anthropic Messages' }, { value: 'gemini', label: 'Google Gemini' }]} />
          </Form.Item>
          <Form.Item label={t('aiApiBaseUrl')} name={['aiApi', 'baseUrl']} extra={t('aiApiBaseUrlExtra')}
            rules={[{ validator: async (_, value) => {
              if (!value) throw new Error(t('aiApiInvalidUrl'));
              try { aiApiEndpoint(normalizeAiApiConfig(form.getFieldValue('aiApi'))); }
              catch { throw new Error(t('aiApiInvalidUrl')); }
            } }]}>
            <Input placeholder="https://api.example.com/v1" autoComplete="off" />
          </Form.Item>
          <Form.Item label={t(streaming ? 'aiApiFirstResponseTimeout' : 'aiApiTimeout')} name={['aiApi', 'timeoutSeconds']}>
            <InputNumber min={5} max={25} precision={0} addonAfter={t('aiApiSeconds')} />
          </Form.Item>
          {streaming && <Form.Item label={t('aiApiCompletionTimeout')} name={['aiApi', 'completionTimeoutSeconds']} extra={t('aiApiCompletionTimeoutExtra')}>
            <InputNumber min={responseTimeout} max={120} precision={0} addonAfter={t('aiApiSeconds')} />
          </Form.Item>}
        </details>
        <div className="ai-api-test"><Button loading={testingApi} onClick={() => void testConnection()}>{t('aiApiTest')}</Button></div>

        <Form.Item
          className="click-source-setting"
          label={t('clickSourceEnableSetting')}
          name="rememberClickSource"
          valuePropName="checked"
          extra={t('clickSourceEnableSettingExtra')}
        >
          <Switch
            disabled={!active}
            onChange={checked => {
              if (!checked) return;
              /** 权限申请必须落在这次点击的手势里，否则 Chrome 会拒绝。 */
              void requestClickSourcePermission().then(granted => {
                if (granted) return;
                form.setFieldValue('rememberClickSource', false);
                message.warning(t('clickSourcePermissionDenied'));
              });
            }}
          />
        </Form.Item>

        {active && <AiTokenUsage />}
      </div>
      <div className="ai-config-footer">
        <span>{t('aiApiLocalHint')}</span>
        <Button htmlType="submit" type="primary" loading={saving} onClick={startSavePermission}>{t('aiApiSave')}</Button>
      </div>
    </Form>
  );
};

export default AiSettings;
