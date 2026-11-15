import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import PageHeader from '../PageHeader';
import { useI18n, type TranslationKey } from '@/common/i18n';
import {
  AI_DECISION_LOG_KEY,
  requestClearAiDecisionLog,
  readAiDecisionLog,
  type AiDecisionLogEntry,
  type AiDecisionResult,
  type AiModelStatus,
} from '@/pages/Background/aiDecisionLog';
import './style.less';

const RESULT_LABEL: Record<AiDecisionResult, TranslationKey> = {
  rename: 'aiLogResultRename',
  ungrouped: 'aiLogResultUngrouped',
  join: 'aiLogResultJoin',
  create: 'aiLogResultCreate',
  domain: 'aiLogResultDomain',
  rule: 'aiLogResultRule',
  kept: 'aiLogResultKept',
  skipped: 'aiLogResultSkipped',
  waiting: 'aiLogResultWaiting',
  failed: 'aiLogResultFailed',
};

const STATUS_LABEL: Partial<Record<AiModelStatus, TranslationKey>> = {
  'not-configured': 'aiLogStatus_notConfigured',
  permission: 'aiLogStatus_permission',
  timeout: 'aiLogStatus_timeout',
  'queue-timeout': 'aiLogStatus_queueTimeout',
  unavailable: 'aiLogStatus_unavailable',
  downloadable: 'aiLogStatus_downloadable',
  downloading: 'aiLogStatus_downloading',
  unsupported: 'aiLogStatus_unsupported',
  error: 'aiLogStatus_error',
  'not-asked': 'aiLogStatus_notAsked',
};

const MODEL_ACTION_LABEL: Record<'join' | 'create' | 'leave' | 'rename', TranslationKey> = {
  join: 'aiLogModel_join',
  create: 'aiLogModel_create',
  leave: 'aiLogModel_leave',
  rename: 'aiLogModel_rename',
};

const DecisionLog: React.FC = () => {
  const { language, t } = useI18n();
  const [entries, setEntries] = useState<AiDecisionLogEntry[]>([]);
  const [clearing, setClearing] = useState(false);

  const clear = async () => {
    setClearing(true);
    try { await requestClearAiDecisionLog(); message.success(t('decisionLogCleared')); }
    catch { message.error(t('decisionLogClearError')); }
    finally { setClearing(false); }
  };

  const load = useCallback(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      setEntries([]);
      return;
    }
    chrome.storage.local.get(AI_DECISION_LOG_KEY)
      .then(stored => setEntries(readAiDecisionLog(stored[AI_DECISION_LOG_KEY])))
      .catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    load();
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return undefined;
    const handleChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local' || !changes[AI_DECISION_LOG_KEY]) return;
      setEntries(readAiDecisionLog(changes[AI_DECISION_LOG_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  }, [load]);

  return (
    <section className="popup-screen decision-log">
      <PageHeader
        title={t('aiLogPageTitle')}
        subtitle={t('aiLogPageDescription')}
        actions={(
          <Button
            icon={<DeleteOutlined />}
            disabled={!entries.length}
            loading={clearing}
            onClick={() => { void clear(); }}
          >
            {t('aiLogClear')}
          </Button>
        )}
      />

      <div className="decision-log-list">
        {!entries.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('aiLogEmpty')} />}
        {entries.map(entry => (
          <article key={entry.id} className={`decision-log-item is-${entry.result}`}>
            <div className="decision-log-item-top">
              <time dateTime={new Date(entry.at).toISOString()}>
                {formatTime(entry.at, language)}
              </time>
              <span className="decision-log-badge">{t(RESULT_LABEL[entry.result])}</span>
            </div>
            <strong>{entry.title || entry.url || t('aiLogUnnamed')}</strong>
            {entry.url && <p className="decision-log-url" title={entry.url}>{entry.url}</p>}
            <p className="decision-log-detail">{describeDecision(entry, t)}</p>
          </article>
        ))}
      </div>
    </section>
  );
};

function describeDecision(
  entry: AiDecisionLogEntry,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const label = entry.groupTitle || (typeof entry.groupId === 'number' ? `#${entry.groupId}` : '');
  const group = label ? t('aiLogNamed', { group: label }) : t('aiLogUnnamed');
  const result = (() => {
    if (entry.via === 'search' && entry.result === 'join') return t('aiLogJoinSearch', { group });
    if (entry.via === 'search' && entry.result === 'create') return t('aiLogCreateSearch', { group });
    if (entry.result === 'join' && entry.via === 'opener') return t('aiLogJoinOpener', { group });
    if (entry.result === 'join' && entry.via === 'fallback') return t('aiLogJoinFallback', { group });
    if (entry.result === 'join') return t('aiLogJoinModel', { group });
    if (entry.result === 'rename') return t('aiLogRename', { group });
    if (entry.result === 'create') return t('aiLogCreate', { group });
    if (entry.result === 'domain') return t('aiLogDomain', { group });
    if (entry.result === 'ungrouped') return t('aiLogUngrouped');
    if (entry.result === 'rule') return t('aiLogRule');
    if (entry.result === 'kept') return t('aiLogKept', { group });
    if (entry.result === 'skipped') return t('aiLogSkipped');
    if (entry.result === 'waiting') return t('aiLogWaiting');
    return t('aiLogFailed', { error: entry.error || '' });
  })();

  const extra: string[] = [];
  if (entry.via !== 'search' && (entry.modelAction === 'leave' || (entry.modelAction && entry.result !== 'join' && entry.result !== 'create'))) {
    extra.push(t('aiLogModelSaid', { action: t(MODEL_ACTION_LABEL[entry.modelAction]) }));
  }
  const statusKey = entry.modelStatus ? STATUS_LABEL[entry.modelStatus] : undefined;
  if (statusKey && entry.modelStatus !== 'answered' && entry.modelStatus !== 'not-asked') {
    extra.push(t(statusKey, { error: entry.error || '' }));
  }
  return [entry.trigger === 'page-update' ? t('aiLogPageUpdated') : '', result, ...extra].filter(Boolean).join(' ');
}

function formatTime(timestamp: number, language: string): string {
  return new Date(timestamp).toLocaleString(language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default DecisionLog;
