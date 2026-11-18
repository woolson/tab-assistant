import React, { useEffect, useRef, useState } from 'react';
import { AI_API_PRESETS } from '@/common/aiApi';
import { AI_TOKEN_USAGE_KEY, readAiTokenUsageState, type AiTokenUsageRow } from '@/common/aiTokenUsage';
import { useI18n } from '@/common/i18n';

const AiTokenUsage: React.FC = () => {
  const { t, language } = useI18n();
  const [rows, setRows] = useState<AiTokenUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) { setLoading(false); return; }
    let active = true;
    const update = (value: unknown) => {
      if (!active) return;
      setRows(readAiTokenUsageState(value).rows);
      setLoadError(false);
      setLoading(false);
    };
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes[AI_TOKEN_USAGE_KEY]) {
        revision.current++;
        update(changes[AI_TOKEN_USAGE_KEY].newValue);
      }
    };
    chrome.storage.onChanged.addListener(changed);
    const initialRevision = revision.current;
    void chrome.storage.local.get(AI_TOKEN_USAGE_KEY)
      .then(stored => { if (revision.current === initialRevision) update(stored[AI_TOKEN_USAGE_KEY]); })
      .catch(() => { if (active && revision.current === initialRevision) { setLoadError(true); setLoading(false); } });
    return () => { active = false; chrome.storage.onChanged.removeListener(changed); };
  }, []);

  const providers = [...AI_API_PRESETS.map(({ provider, label }) => ({ provider: provider as string, label })), { provider: 'custom', label: t('aiApiCustom') }];
  const unreported = rows.reduce((total, row) => total + row.unreportedRequests, 0);
  return (
    <section className="ai-token-usage" aria-label={t('aiTokenUsageTitle')} aria-busy={loading}>
      <h3>{t('aiTokenUsageTitle')}</h3>
      <p className="ai-token-usage-hint">{t('aiTokenUsageExtra')}</p>
      {loading ? <p className="ai-token-usage-hint">{t('aiTokenUsageLoading')}</p>
        : loadError ? <p className="ai-token-usage-hint">{t('aiTokenUsageLoadError')}</p>
          : rows.length === 0 ? <p className="ai-token-usage-empty">{t('aiTokenUsageEmpty')}</p>
            : providers.map(provider => {
              const models = rows.filter(row => row.provider === provider.provider).sort((a, b) => a.model.localeCompare(b.model));
              if (!models.length) return null;
              return <div className="ai-token-usage-provider" key={provider.provider}>
                <h4>{provider.label}</h4>
                <table aria-label={provider.label}>
                  <thead><tr><th scope="col">{t('aiTokenUsageModel')}</th><th scope="col">{t('aiTokenUsageInput')}</th><th scope="col">{t('aiTokenUsageOutput')}</th></tr></thead>
                  <tbody>{models.map(row => <tr key={row.model}>
                    <th scope="row" title={row.model}><span>{row.model}</span></th>
                    <td>{row.inputReports ? row.inputTokens.toLocaleString(language) : '—'}</td>
                    <td>{row.outputReports ? row.outputTokens.toLocaleString(language) : '—'}</td>
                  </tr>)}</tbody>
                </table>
              </div>;
            })}
      {unreported > 0 && <p className="ai-token-usage-hint">{t('aiTokenUsageUnreported', { count: unreported.toLocaleString(language) })}</p>}
    </section>
  );
};

export default AiTokenUsage;
