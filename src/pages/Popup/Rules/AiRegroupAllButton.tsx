import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  AI_REGROUP_JOB_KEY, AI_REGROUP_STATUS_MESSAGE, START_AI_REGROUP_MESSAGE,
  readAiRegroupJob, requestAiRegroup, type AiRegroupJob,
} from '@/common/aiRegroup';
import { type TranslationKey, useI18n } from '@/common/i18n';

const AiRegroupAllButton: React.FC<{ active: boolean }> = ({ active }) => {
  const { t } = useI18n();
  const [job, setJob] = useState<AiRegroupJob>();
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const mounted = useRef(true);
  const applyJob = useCallback((value: unknown) => {
    const next = readAiRegroupJob(value);
    if (!mounted.current || !next) return;
    setJob(previous => {
      if (previous && previous.startedAt > next.startedAt) return previous;
      if (previous?.id === next.id && (previous.completed > next.completed || previous.state !== 'running' && next.state === 'running')) return previous;
      return next;
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (typeof chrome === 'undefined') { setLoadingStatus(false); return () => { mounted.current = false; }; }
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && changes[AI_REGROUP_JOB_KEY]) applyJob(changes[AI_REGROUP_JOB_KEY].newValue);
    };
    chrome.storage?.onChanged.addListener(changed);
    // 唤醒 Worker，恢复时可以区分仍在执行的任务和已中断的任务。
    void requestAiRegroup(AI_REGROUP_STATUS_MESSAGE).then(response => {
      if (response.ok) applyJob(response.job);
    }).catch(() => {}).finally(() => { if (mounted.current) setLoadingStatus(false); });
    return () => { mounted.current = false; chrome.storage?.onChanged.removeListener(changed); };
  }, [applyJob]);

  const running = starting || job?.state === 'running';
  const start = async () => {
    if (!active || running) return;
    setStarting(true);
    try {
      const response = await requestAiRegroup(START_AI_REGROUP_MESSAGE);
      if (!mounted.current) return;
      if (!response.ok) {
        const labels: Partial<Record<typeof response.error, TranslationKey>> = {
          disabled: 'aiRegroupDisabled', 'not-configured': 'aiRegroupNotConfigured',
          permission: 'aiApiPermissionDenied', 'invalid-url': 'aiApiInvalidUrl',
        };
        message.error(t(labels[response.error] || 'aiRegroupStartError'));
        return;
      }
      applyJob(response.job);
      setConfirming(false);
    } catch { if (mounted.current) message.error(t('aiRegroupStartError')); }
    finally { if (mounted.current) setStarting(false); }
  };

  const statusKey: TranslationKey = job?.stopReason === 'api-failures' ? 'aiRegroupStoppedOnErrors' : job?.state === 'running' ? 'aiRegroupProgress'
    : job?.state === 'completed' ? 'aiRegroupCompleted'
      : job?.state === 'interrupted' ? 'aiRegroupInterrupted' : 'aiRegroupFailed';

  return (
    <div className="ai-regroup-action">
      <Button icon={<ReloadOutlined />} loading={running} disabled={!active || loadingStatus}
        onClick={() => setConfirming(true)}>{t('aiRegroupAll')}</Button>
      {job && <span className="ai-regroup-status" role="status" aria-live="polite">
        {t(statusKey, { completed: job.completed, total: job.total, skipped: job.skipped, failed: job.failed })}
      </span>}
      <Modal title={t('aiRegroupConfirmTitle')} open={confirming} confirmLoading={starting}
        okText={t('aiRegroupConfirm')} cancelText={t('cancel')} onOk={() => void start()}
        cancelButtonProps={{ disabled: starting }} okButtonProps={{ disabled: !active || job?.state === 'running' }}
        onCancel={() => { if (!starting) setConfirming(false); }} closable={!starting} maskClosable={!starting}>
        <p>{t('aiRegroupTokenWarning')}</p>
        <p>{t('aiRegroupScopeHint')}</p>
      </Modal>
    </div>
  );
};

export default AiRegroupAllButton;
