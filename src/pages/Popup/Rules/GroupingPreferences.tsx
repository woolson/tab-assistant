import React, { useEffect, useRef, useState } from 'react';
import { Button, Form, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { GROUPING_PREFERENCES_KEY, GROUPING_PREFERENCE_LIMIT, readGroupingPreferences, requestClearGroupingPreferences, type GroupingPreference } from '@/common/groupingPreferences';
import { useI18n } from '@/common/i18n';

const GroupingPreferences: React.FC = () => {
  const { t } = useI18n();
  const [preferences, setPreferences] = useState<GroupingPreference[]>([]);
  const [clearing, setClearing] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    let active = true;
    const update = (value: unknown) => { if (active) setPreferences(readGroupingPreferences(value)); };
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes[GROUPING_PREFERENCES_KEY]) { revision.current++; update(changes[GROUPING_PREFERENCES_KEY].newValue); }
    };
    chrome.storage.onChanged.addListener(changed);
    const initialRevision = revision.current;
    void chrome.storage.local.get(GROUPING_PREFERENCES_KEY).then(stored => { if (revision.current === initialRevision) update(stored[GROUPING_PREFERENCES_KEY]); }).catch(() => {});
    return () => { active = false; chrome.storage.onChanged.removeListener(changed); };
  }, []);
  const clear = async () => {
    setClearing(true);
    try { await requestClearGroupingPreferences(); revision.current++; setPreferences([]); message.success(t('groupingPreferencesCleared')); }
    catch { message.error(t('groupingPreferencesClearError')); }
    finally { setClearing(false); }
  };
  return (
    <Form.Item label={t('groupingPreferencesTitle')} extra={t('groupingPreferencesExtra', { limit: GROUPING_PREFERENCE_LIMIT })}>
      <div className="grouping-preferences-controls">
        <span>{t('groupingPreferencesCount', { count: preferences.length })}</span>
        <Button icon={<DeleteOutlined />} loading={clearing} onClick={() => void clear()}>{t('groupingPreferencesClear')}</Button>
      </div>
      {preferences.length > 0 && <details className="grouping-preferences-history">
        <summary>{t('groupingPreferencesRecent')}</summary>
        <ul>{preferences.slice(0, 5).map(preference => <li key={preference.id}>
          <span title={preference.url}>{preference.title || preference.url}</span>
          <small>{preference.choice === 'ungrouped' ? t('groupingPreferenceUngrouped') : t('groupingPreferenceGroup', { group: preference.groupTitle || '' })}</small>
        </li>)}</ul>
      </details>}
    </Form.Item>
  );
};

export default GroupingPreferences;
