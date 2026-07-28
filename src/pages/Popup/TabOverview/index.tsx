import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  message,
  Spin,
  Tooltip,
} from 'antd';
import {
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  GlobalOutlined,
  MoreOutlined,
  PushpinOutlined,
  SearchOutlined,
  SoundOutlined,
  UpOutlined,
} from '@ant-design/icons';
import PageHeader from '../PageHeader';
import './style.less';
import { TranslationKey, useI18n } from '@/common/i18n';

type RowType = 'group' | 'tab';

interface TabTreeRow {
  key: string;
  rowType: RowType;
  title: string;
  url?: string;
  favIconUrl?: string;
  active?: boolean;
  pinned?: boolean;
  index?: number;
  audible?: boolean;
  color?: chrome.tabGroups.ColorEnum;
  groupId?: number;
  tabId?: number;
  windowId?: number;
  collapsed?: boolean;
  tabIds?: number[];
  count?: number;
  children?: TabTreeRow[];
}

interface ClosedTabSnapshot {
  title: string;
  url: string;
  pinned?: boolean;
  windowId?: number;
  index?: number;
}

const GROUP_NONE_ID = -1;
const DEFAULT_GROUP_COLOR = 'grey';
const INITIAL_RELOAD_DELAY = 120;
const EVENT_RELOAD_DELAY = 80;

const GROUP_COLORS: Record<string, string> = {
  grey: '#8a94a4',
  blue: '#2167f3',
  red: '#ef5b5b',
  yellow: '#f7a51c',
  green: '#16b886',
  pink: '#e54f9f',
  purple: '#8c45ed',
  cyan: '#16b8ca',
  orange: '#f58b27',
};

const canUseChromeTabs = () => (
  typeof chrome !== 'undefined'
  && Boolean(chrome.tabs?.query)
  && Boolean(chrome.tabGroups?.query)
);

const getTabTitle = (tab: chrome.tabs.Tab, t: (key: TranslationKey) => string) => (
  tab.title || tab.url || t('unnamedTab')
);

const getDomain = (url?: string) => {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return 'file://';
    return parsed.host || parsed.protocol.replace(':', '');
  } catch (error) {
    return '';
  }
};

const createDemoRows = (): TabTreeRow[] => [
  {
    key: 'group-demo-ai',
    rowType: 'group',
    title: 'AI 工作台',
    color: 'blue',
    groupId: 101,
    count: 3,
    tabIds: [1001, 1002, 1003],
    children: [
      {
        key: 'tab-demo-chatgpt',
        rowType: 'tab',
        title: 'ChatGPT',
        url: 'https://chatgpt.com/',
        favIconUrl: 'https://chatgpt.com/favicon.ico',
        tabId: 1001,
        groupId: 101,
        color: 'blue',
        active: true,
      },
      {
        key: 'tab-demo-platform',
        rowType: 'tab',
        title: 'OpenAI Platform',
        url: 'https://platform.openai.com/',
        favIconUrl: 'https://openai.com/favicon.ico',
        tabId: 1002,
        groupId: 101,
        color: 'blue',
      },
      {
        key: 'tab-demo-gpts',
        rowType: 'tab',
        title: 'ChatGPT - 探索 GPTs',
        url: 'https://chatgpt.com/gpts',
        favIconUrl: 'https://chatgpt.com/favicon.ico',
        tabId: 1003,
        groupId: 101,
        color: 'blue',
      },
    ],
  },
  {
    key: 'group-demo-dev',
    rowType: 'group',
    title: '开发',
    color: 'green',
    groupId: 102,
    count: 4,
    tabIds: [1004, 1005, 1006, 1007],
    children: [
      {
        key: 'tab-demo-github',
        rowType: 'tab',
        title: 'GitHub · tab-assistant',
        url: 'https://github.com/woolson/TabAssistant',
        favIconUrl: 'https://github.com/favicon.ico',
        tabId: 1004,
        groupId: 102,
        color: 'green',
      },
      {
        key: 'tab-demo-antd',
        rowType: 'tab',
        title: 'Ant Design',
        url: 'https://ant.design/',
        favIconUrl: 'https://gw.alipayobjects.com/zos/rmsportal/KDpgvguMpGfqaHPjicRK.svg',
        tabId: 1005,
        groupId: 102,
        color: 'green',
      },
      {
        key: 'tab-demo-mdn',
        rowType: 'tab',
        title: 'MDN Web Docs',
        url: 'https://developer.mozilla.org/',
        favIconUrl: 'https://developer.mozilla.org/favicon-48x48.png',
        tabId: 1006,
        groupId: 102,
        color: 'green',
      },
    ],
  },
  {
    key: 'group-demo-read',
    rowType: 'group',
    title: '阅读',
    color: 'yellow',
    groupId: 103,
    count: 5,
    tabIds: [1008, 1009, 1010, 1011, 1012],
    collapsed: true,
    children: [],
  },
  {
    key: 'group-demo-files',
    rowType: 'group',
    title: '本地文件',
    color: 'purple',
    groupId: 104,
    count: 4,
    tabIds: [1013, 1014, 1015, 1016],
    collapsed: true,
    children: [],
  },
];

const TabOverview: React.FC = () => {
  const { t } = useI18n();
  const [dataSource, setDataSource] = useState<TabTreeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);
  const [selectedTabIds, setSelectedTabIds] = useState<number[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [query, setQuery] = useState('');
  const [recentlyClosedTab, setRecentlyClosedTab] = useState<ClosedTabSnapshot>();
  const initializedRef = useRef(false);
  const restoreTimerRef = useRef<number>();

  const reloadTabs = useCallback(async () => {
    setLoading(true);

    try {
      if (!canUseChromeTabs()) {
        const rows = createDemoRows();
        setDataSource(rows);
        if (!initializedRef.current) {
          setExpandedRowKeys(rows.filter(row => !row.collapsed).map(row => row.key));
          initializedRef.current = true;
        }
        return;
      }

      const currentWindow = await chrome.windows.getCurrent();
      const [groups, tabs] = await Promise.all([
        chrome.tabGroups.query({ windowId: currentWindow.id }),
        chrome.tabs.query({ windowId: currentWindow.id }),
      ]);

      const groupMap = new Map<number, chrome.tabGroups.TabGroup>();
      groups.forEach(group => groupMap.set(group.id, group));

      const groupedTabs = tabs.reduce((result, tab) => {
        const groupId = tab.groupId ?? GROUP_NONE_ID;
        const current = result.get(groupId) || [];
        current.push(tab);
        result.set(groupId, current);
        return result;
      }, new Map<number, chrome.tabs.Tab[]>());

      const rows = Array.from(groupedTabs.entries())
        .sort(([, previousTabs], [, nextTabs]) => (
          Math.min(...previousTabs.map(tab => tab.index))
          - Math.min(...nextTabs.map(tab => tab.index))
        ))
        .map(([groupId, groupTabs]) => {
          const group = groupMap.get(groupId);
          const color = group?.color || DEFAULT_GROUP_COLOR;
          const sortedTabs = [...groupTabs].sort((previous, next) => previous.index - next.index);
          const tabIds = sortedTabs
            .map(tab => tab.id)
            .filter((id): id is number => typeof id === 'number');

          const children = sortedTabs.map(tab => ({
            key: `tab-${tab.id}`,
            rowType: 'tab' as RowType,
            title: getTabTitle(tab, t),
            tabId: tab.id,
            windowId: tab.windowId,
            groupId,
            url: tab.url,
            favIconUrl: tab.favIconUrl,
            color,
            active: tab.active,
            pinned: tab.pinned,
            index: tab.index,
            audible: tab.audible,
          }));

          return {
            key: `group-${groupId}`,
            rowType: 'group' as RowType,
            title: group?.title || t('ungrouped'),
            color,
            groupId,
            collapsed: group?.collapsed,
            tabIds,
            count: tabIds.length,
            children,
          };
        });

      setDataSource(rows);
      setExpandedRowKeys(previousKeys => {
        if (!initializedRef.current) {
          initializedRef.current = true;
          return rows.filter(row => !row.collapsed).map(row => row.key);
        }

        const validKeys = new Set(rows.map(row => row.key));
        return previousKeys.filter(key => validKeys.has(String(key)));
      });
      setSelectedTabIds(previousIds => {
        const validIds = new Set(rows.flatMap(row => row.tabIds || []));
        return previousIds.filter(id => validIds.has(id));
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return dataSource;

    return dataSource
      .map(group => {
        if (group.title.toLowerCase().includes(normalizedQuery)) return group;

        const children = group.children?.filter(tab => (
          tab.title.toLowerCase().includes(normalizedQuery)
          || getDomain(tab.url).toLowerCase().includes(normalizedQuery)
        ));

        if (!children?.length) return null;
        return { ...group, children, count: children.length };
      })
      .filter((row): row is TabTreeRow => Boolean(row));
  }, [dataSource, query]);

  const totalTabs = useMemo(
    () => dataSource.reduce((total, row) => total + (row.count || 0), 0),
    [dataSource],
  );

  const allGroupsExpanded = useMemo(
    () => dataSource.length > 0 && dataSource.every(row => expandedRowKeys.includes(row.key)),
    [dataSource, expandedRowKeys],
  );

  const showRestoreButton = useCallback((tab: ClosedTabSnapshot) => {
    if (restoreTimerRef.current !== undefined) window.clearTimeout(restoreTimerRef.current);
    setRecentlyClosedTab(tab);
    restoreTimerRef.current = window.setTimeout(() => {
      setRecentlyClosedTab(undefined);
      restoreTimerRef.current = undefined;
    }, 3000);
  }, []);

  const removeTabIdsFromPreview = useCallback((tabIds: number[]) => {
    const idSet = new Set(tabIds);
    setDataSource(previousRows => previousRows
      .map(group => {
        const children = group.children?.filter(tab => !tab.tabId || !idSet.has(tab.tabId));
        const nextTabIds = group.tabIds?.filter(id => !idSet.has(id)) || [];
        return {
          ...group,
          children,
          tabIds: nextTabIds,
          count: Math.max(0, (group.count || 0) - tabIds.filter(id => group.tabIds?.includes(id)).length),
        };
      })
      .filter(group => (group.count || 0) > 0));
  }, []);

  const handleCloseRecord = useCallback(async (record: TabTreeRow) => {
    const tabIds = record.rowType === 'group'
      ? record.tabIds || []
      : record.tabId !== undefined ? [record.tabId] : [];
    if (!tabIds.length) return;

    const closedTab = record.rowType === 'tab' && record.url
      ? {
        title: record.title,
        url: record.url,
        pinned: record.pinned,
        windowId: record.windowId,
        index: record.index,
      }
      : undefined;

    if (canUseChromeTabs()) {
      await chrome.tabs.remove(tabIds);
      await reloadTabs();
    } else {
      removeTabIdsFromPreview(tabIds);
    }

    if (closedTab) showRestoreButton(closedTab);
    else message.success(t('groupedTabsClosed'));
  }, [reloadTabs, removeTabIdsFromPreview, showRestoreButton, t]);

  const handleRestoreClosedTab = useCallback(async () => {
    if (!recentlyClosedTab) return;
    if (restoreTimerRef.current !== undefined) window.clearTimeout(restoreTimerRef.current);
    setRecentlyClosedTab(undefined);

    if (!canUseChromeTabs()) {
      message.success(t('restoreClosedTab'));
      return;
    }

    try {
      await chrome.tabs.create({
        url: recentlyClosedTab.url,
        active: true,
        pinned: recentlyClosedTab.pinned,
        windowId: recentlyClosedTab.windowId,
        index: recentlyClosedTab.index,
      });
    } catch (error) {
      await chrome.tabs.create({
        url: recentlyClosedTab.url,
        active: true,
        pinned: recentlyClosedTab.pinned,
      });
    }

    await reloadTabs();
  }, [recentlyClosedTab, reloadTabs, t]);

  const handleDeleteSelected = useCallback(async () => {
    if (!selectedTabIds.length) return;

    if (canUseChromeTabs()) {
      await chrome.tabs.remove(selectedTabIds);
      await reloadTabs();
    } else {
      removeTabIdsFromPreview(selectedTabIds);
    }

    setSelectedTabIds([]);
    setBatchMode(false);
    message.success(t('selectedTabsClosed'));
  }, [reloadTabs, removeTabIdsFromPreview, selectedTabIds, t]);

  const handleToggleGroup = useCallback(async (record: TabTreeRow) => {
    const isExpanded = expandedRowKeys.includes(record.key);
    setExpandedRowKeys(previous => (
      isExpanded
        ? previous.filter(key => key !== record.key)
        : [...previous, record.key]
    ));

    if (
      canUseChromeTabs()
      && record.groupId !== undefined
      && record.groupId !== GROUP_NONE_ID
    ) {
      await chrome.tabGroups.update(record.groupId, { collapsed: isExpanded });
    }
  }, [expandedRowKeys]);

  const updateAllGroupsCollapsed = useCallback(async () => {
    const shouldCollapse = allGroupsExpanded;
    setExpandedRowKeys(shouldCollapse ? [] : dataSource.map(row => row.key));

    if (canUseChromeTabs()) {
      const currentWindow = await chrome.windows.getCurrent();
      const groups = await chrome.tabGroups.query({ windowId: currentWindow.id });
      await Promise.all(groups.map(group => chrome.tabGroups.update(group.id, { collapsed: shouldCollapse })));
    }
  }, [allGroupsExpanded, dataSource]);

  const handleOpenTab = useCallback(async (tab: TabTreeRow) => {
    if (!canUseChromeTabs() || tab.tabId === undefined) return;
    await chrome.tabs.update(tab.tabId, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  }, []);

  const toggleTabSelection = useCallback((tabId?: number) => {
    if (tabId === undefined) return;
    setSelectedTabIds(previous => (
      previous.includes(tabId)
        ? previous.filter(id => id !== tabId)
        : [...previous, tabId]
    ));
  }, []);

  const toggleGroupSelection = useCallback((group: TabTreeRow) => {
    const tabIds = group.tabIds || [];
    const allSelected = tabIds.length > 0 && tabIds.every(id => selectedTabIds.includes(id));
    setSelectedTabIds(previous => {
      if (allSelected) return previous.filter(id => !tabIds.includes(id));
      return Array.from(new Set([...previous, ...tabIds]));
    });
  }, [selectedTabIds]);

  useEffect(() => {
    let disposed = false;
    let reloadTimer: number | undefined;
    let firstFrame = 0;
    let secondFrame = 0;
    let initialPaintReady = false;
    let reloadInProgress = false;
    let reloadRequested = false;

    const runReload = async () => {
      if (disposed) return;
      if (reloadInProgress) {
        reloadRequested = true;
        return;
      }

      reloadInProgress = true;
      reloadRequested = false;

      try {
        await reloadTabs();
      } catch (error) {
        console.error('Failed to reload popup tabs', error);
      } finally {
        reloadInProgress = false;

        if (reloadRequested && !disposed) {
          reloadRequested = false;
          scheduleReload();
        }
      }
    };

    const scheduleReload = () => {
      if (disposed) return;
      if (!initialPaintReady || reloadInProgress) {
        reloadRequested = true;
        return;
      }

      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = undefined;
        runReload();
      }, EVENT_RELOAD_DELAY);
    };

    // 先让弹窗壳层完成两帧绘制，再读取标签数据，避免首次打开时阻塞弹窗展示。
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        initialPaintReady = true;
        reloadTimer = window.setTimeout(() => {
          reloadTimer = undefined;
          runReload();
        }, INITIAL_RELOAD_DELAY);
      });
    });

    if (!canUseChromeTabs()) {
      return () => {
        disposed = true;
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
        if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
      };
    }

    const events = [
      chrome.tabs.onCreated,
      chrome.tabs.onRemoved,
      chrome.tabs.onUpdated,
      chrome.tabs.onMoved,
      chrome.tabs.onAttached,
      chrome.tabs.onDetached,
      chrome.tabGroups.onCreated,
      chrome.tabGroups.onRemoved,
      chrome.tabGroups.onUpdated,
      chrome.tabGroups.onMoved,
    ];
    events.forEach(event => event.addListener(scheduleReload));

    return () => {
      disposed = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
      events.forEach(event => event.removeListener(scheduleReload));
    };
  }, [reloadTabs]);

  useEffect(() => () => {
    if (restoreTimerRef.current !== undefined) window.clearTimeout(restoreTimerRef.current);
  }, []);

  const actions = (
    <>
      <Input
        className="tab-search"
        prefix={<SearchOutlined />}
        placeholder={t('searchTabs')}
        value={query}
        onChange={event => setQuery(event.target.value)}
        allowClear
      />
      <Button onClick={updateAllGroupsCollapsed}>
        {allGroupsExpanded ? t('collapseAll') : t('expandAll')}
      </Button>
      <Button
        type="primary"
        onClick={() => {
          setBatchMode(previous => !previous);
          if (batchMode) setSelectedTabIds([]);
        }}
      >
        {batchMode ? t('cancel') : t('batchManage')}
      </Button>
    </>
  );

  return (
    <section className="popup-screen tab-overview">
      <PageHeader
        title={t('currentWindow')}
        subtitle={t('windowSummary', { groups: dataSource.length, tabs: totalTabs })}
        actions={actions}
      />

      <div className={`tab-overview-list screen-scroll${batchMode ? ' has-batch-bar' : ''}`} aria-busy={loading}>
        {loading && !dataSource.length && (
          <div className="tab-overview-loading">
            <Spin size="small" />
          </div>
        )}
        {!visibleRows.length && !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noTabs')} />}

        {visibleRows.map(group => {
          const isExpanded = expandedRowKeys.includes(group.key) || Boolean(query.trim());
          const groupTabIds = group.tabIds || [];
          const selectedInGroup = groupTabIds.filter(id => selectedTabIds.includes(id)).length;
          const allSelected = groupTabIds.length > 0 && selectedInGroup === groupTabIds.length;

          return (
            <article
              key={group.key}
              className={`tab-group${isExpanded ? ' is-expanded' : ''}${group.key === 'group-demo-ai' ? ' is-demo-primary' : ''}`}
              style={{ '--group-color': GROUP_COLORS[group.color || DEFAULT_GROUP_COLOR] } as React.CSSProperties}
            >
              <div
                className="tab-group-header"
                role="button"
                tabIndex={0}
                onClick={() => handleToggleGroup(group)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') handleToggleGroup(group);
                }}
              >
                <span className="tab-group-dot" aria-hidden="true" />
                <strong>{group.title}</strong>
                <span className="tab-group-count">{group.count || 0}</span>
                <span className="tab-group-spacer" />

                {batchMode && (
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selectedInGroup > 0 && !allSelected}
                    onClick={event => event.stopPropagation()}
                    onChange={() => toggleGroupSelection(group)}
                    aria-label={`${group.title} ${t('selectAll') || ''}`}
                  />
                )}

                <span className="tab-group-expand" aria-hidden="true">
                  {isExpanded ? <UpOutlined /> : <DownOutlined />}
                </span>

                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [{
                      key: 'close',
                      danger: true,
                      icon: <DeleteOutlined />,
                      label: t('closeGroup'),
                      onClick: () => handleCloseRecord(group),
                    }],
                  }}
                >
                  <Button
                    type="text"
                    className="tab-group-more"
                    icon={<MoreOutlined />}
                    onClick={event => event.stopPropagation()}
                    aria-label={t('actions')}
                  />
                </Dropdown>
              </div>

              {isExpanded && Boolean(group.children?.length) && (
                <div className="tab-group-rows">
                  {group.children?.map(tab => (
                    <div
                      key={tab.key}
                      className={`tab-row${tab.active ? ' is-current' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => batchMode ? toggleTabSelection(tab.tabId) : handleOpenTab(tab)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          batchMode ? toggleTabSelection(tab.tabId) : handleOpenTab(tab);
                        }
                      }}
                    >
                      {batchMode && (
                        <Checkbox
                          checked={tab.tabId !== undefined && selectedTabIds.includes(tab.tabId)}
                          onClick={event => event.stopPropagation()}
                          onChange={() => toggleTabSelection(tab.tabId)}
                          aria-label={tab.title}
                        />
                      )}

                      <span className="tab-favicon">
                        {tab.favIconUrl
                          ? <img src={tab.favIconUrl} alt="" loading="lazy" decoding="async" />
                          : <GlobalOutlined />}
                      </span>

                      <span className="tab-title" title={tab.title}>{tab.title}</span>
                      <span className="tab-domain" title={tab.url}>{getDomain(tab.url)}</span>
                      <span className="tab-row-spacer" />

                      {tab.active && <span className="tab-current-badge">{t('current')}</span>}
                      {tab.pinned && <Tooltip title={t('pinnedTab')}><PushpinOutlined className="tab-status-icon" /></Tooltip>}
                      {tab.audible && <SoundOutlined className="tab-status-icon" />}

                      <Button
                        type="text"
                        className="tab-close-button"
                        icon={<CloseOutlined />}
                        onClick={event => {
                          event.stopPropagation();
                          handleCloseRecord(tab);
                        }}
                        aria-label={t('close')}
                      />
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {batchMode && (
        <div className="tab-batch-bar">
          <div className="tab-batch-copy">
            <Checkbox checked={selectedTabIds.length > 0} indeterminate={!selectedTabIds.length} />
            <strong>{t('selectedTabCount', { count: selectedTabIds.length })}</strong>
            <Button type="link" onClick={() => setSelectedTabIds([])}>{t('cancelSelection')}</Button>
          </div>
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={!selectedTabIds.length}
            onClick={handleDeleteSelected}
          >
            {t('closeSelected')}
          </Button>
        </div>
      )}

      {recentlyClosedTab && (
        <div className="tab-overview-restore">
          <Button type="primary" size="small" onClick={handleRestoreClosedTab}>
            {t('restoreClosedTab')}
          </Button>
        </div>
      )}
    </section>
  );
};

export default TabOverview;
