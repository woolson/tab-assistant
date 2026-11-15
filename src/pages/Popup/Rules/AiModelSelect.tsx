import React, { useState } from 'react';
import { Input, Select } from 'antd';
import { AI_MODEL_PRESETS, type AiApiProvider, type AiModelPreset } from '@/common/aiApi';
import { type TranslationKey, useI18n } from '@/common/i18n';

const CUSTOM_MODEL = '__ta_custom_model__';

const PURPOSE_LABEL: Record<AiModelPreset['purpose'], TranslationKey> = {
  fast: 'aiApiModelPurposeFast',
  balanced: 'aiApiModelPurposeBalanced',
  reasoning: 'aiApiModelPurposeReasoning',
  visual: 'aiApiModelPurposeVisual',
  legacy: 'aiApiModelPurposeLegacy',
};

const AiModelSelect: React.FC<{
  provider: AiApiProvider;
  value?: string;
  onChange?: (value: string) => void;
  id?: string;
}> = ({ provider, value = '', onChange, id }) => {
  const { t } = useI18n();
  const [custom, setCustom] = useState(false);
  const presets = provider === 'custom' ? [] : AI_MODEL_PRESETS[provider];
  const selected = presets.find(item => item.value === value);
  const customInput = custom || provider === 'custom' || Boolean(value && !selected);

  return (
    <div className="ai-model-select">
      <Select
        id={id}
        className="ai-model-choice"
        value={customInput ? CUSTOM_MODEL : value || undefined}
        placeholder={t('aiApiModelPlaceholder')}
        showSearch
        optionFilterProp="label"
        options={[
          ...presets.map(item => ({ value: item.value, label: item.label + (item.recommended ? ` · ${t('aiApiModelRecommendedShort')}` : '') })),
          { value: CUSTOM_MODEL, label: t('aiApiModelCustom') },
        ]}
        onChange={next => {
          setCustom(next === CUSTOM_MODEL);
          onChange?.(next === CUSTOM_MODEL ? '' : next);
        }}
      />
      {customInput && (
        <Input
          className="ai-model-custom-input"
          aria-label={t('aiApiModelCustom')}
          value={value}
          onChange={event => onChange?.(event.target.value)}
          placeholder={t('aiApiModelCustomPlaceholder')}
          autoComplete="off"
        />
      )}
      <p className="ai-model-note" aria-live="polite">
        {customInput ? t('aiApiModelPurposeCustom') : selected ? (
          <><span className={selected.recommended ? 'is-recommended' : undefined}>{t(selected.recommended ? 'aiApiModelRecommended' : 'aiApiModelOptional')}</span>{' '}{t(PURPOSE_LABEL[selected.purpose])}</>
        ) : t('aiApiModelPlaceholder')}
      </p>
    </div>
  );
};

export default AiModelSelect;
