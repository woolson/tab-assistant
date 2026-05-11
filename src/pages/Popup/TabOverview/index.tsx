import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, message, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Key } from 'antd/es/table/interface';
import { CloseOutlined, LinkOutlined } from '@ant-design/icons';
import './style.less';
import { TranslationKey, useI18n } from '@/common/i18n';

type RowType = 'group' | 'tab';

interface TabTreeRow {
  key: string;
  rowType: RowType;
  title: string;
  typeName?: string;
  url?: string;
  favIconUrl?: string;
  status?: chrome.tabs.Tab['status'];
  active?: boolean;
  pinned?: boolean;
  index?: number;
  audible?: boolean;
  color?: chrome.tabGroups.ColorEnum;
  groupId?: number;
  tabId?: number;
  collapsed?: boolean;
  tabIds?: number[];
  count?: number;
  typeCounts?: Array<{ typeName: string; count: number }>;
  children?: TabTreeRow[];
}

interface ClosedTabSnapshot {
  title: string;
  url: string;
  pinned?: boolean;
  windowId?: number;
  index?: number;
}

const GROUP_NONE_ID = chrome.tabGroups.TAB_GROUP_ID_NONE;
const DEFAULT_GROUP_COLOR = 'grey';
const NAME_COLUMN_WIDTH = 360;
const COUNT_COLUMN_WIDTH = 35;
const ACTION_COLUMN_WIDTH = 30;
const ACTIONS_SLOT_ID = 'popup-tab-actions-slot';

interface TabOverviewProps {
  showActions?: boolean;
}

const runAfterPopupOpened = (callback: () => void) => {
  let timeoutId: number | undefined;
  let firstFrameId = 0;
  let secondFrameId = 0;

  firstFrameId = window.requestAnimationFrame(() => {
    secondFrameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(callback, 120);
    });
  });

  return () => {
    window.cancelAnimationFrame(firstFrameId);
    window.cancelAnimationFrame(secondFrameId);
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  };
};

const getTypeName = (tab: chrome.tabs.Tab, t: (key: TranslationKey) => string) => {
  if (tab.pinned) return t('pinnedTab');

  try {
    const protocol = new URL(tab.url || '').protocol;
    if (protocol === 'http:' || protocol === 'https:') return t('webPage');
    if (protocol === 'chrome:') return t('browserPage');
    if (protocol === 'chrome-extension:') return t('extensionPage');
    if (protocol === 'file:') return t('localFile');
  } catch (error) {
    return t('other');
  }

  return t('other');
};

const getTabTitle = (tab: chrome.tabs.Tab, t: (key: TranslationKey) => string) => tab.title || tab.url || t('unnamedTab');

const getRowCount = (row: TabTreeRow) => row.rowType === 'group' ? row.count || 0 : 1;

const collectSelectedTabIds = (rows: TabTreeRow[], selectedRowKeys: Key[]) => {
  const selectedKeySet = new Set(selectedRowKeys);
  const tabIds = new Set<number>();

  const collect = (row: TabTreeRow) => {
    if (selectedKeySet.has(row.key)) {
      if (row.tabId !== undefined) tabIds.add(row.tabId);
      else row.tabIds?.forEach(tabId => tabIds.add(tabId));
    }

    row.children?.forEach(collect);
  };

  rows.forEach(collect);

  return Array.from(tabIds);
};

const collectRowKeys = (rows: TabTreeRow[]) => {
  const keys: Key[] = [];

  const collect = (row: TabTreeRow) => {
    keys.push(row.key);
    row.children?.forEach(collect);
  };

  rows.forEach(collect);

  return keys;
};

const TabOverview: React.FC<TabOverviewProps> = ({ showActions = true }) => {
  const { t } = useI18n();
  const [dataSource, setDataSource] = useState<TabTreeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [tableScrollY, setTableScrollY] = useState(340);
  const [recentlyClosedTab, setRecentlyClosedTab] = useState<ClosedTabSnapshot>();
  const [actionsContainer, setActionsContainer] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const restoreTimerRef = useRef<number>();

  const reloadTabs = useCallback(async () => {
    setLoading(true);

    try {
      const currentWindow = await chrome.windows.getCurrent();
      const [groups, tabs] = await Promise.all([
        chrome.tabGroups.query({ windowId: currentWindow.id }),
        chrome.tabs.query({ windowId: currentWindow.id }),
      ]);

      const groupMap = new Map<number, chrome.tabGroups.TabGroup>();
      groups.forEach(group => groupMap.set(group.id, group));

      const groupedTabs = tabs.reduce((prev, tab) => {
        const groupId = tab.groupId ?? GROUP_NONE_ID;
        const current = prev.get(groupId) || [];
        current.push(tab);
        prev.set(groupId, current);
        return prev;
      }, new Map<number, chrome.tabs.Tab[]>());

      const rows = Array.from(groupedTabs.entries())
        .sort(([, prevTabs], [, nextTabs]) => Math.min(...prevTabs.map(tab => tab.index)) - Math.min(...nextTabs.map(tab => tab.index)))
        .map(([groupId, groupTabs]) => {
          const group = groupMap.get(groupId);
          const color = group?.color || DEFAULT_GROUP_COLOR;
          const sortedTabs = groupTabs.sort((prev, next) => prev.index - next.index);
          const tabIds = sortedTabs.map(tab => tab.id).filter((id): id is number => typeof id === 'number');
          const groupKey = `group-${groupId}`;
          const typeCountMap = new Map<string, number>();
          const children = sortedTabs.map(tab => ({
            key: `tab-${tab.id}`,
            rowType: 'tab' as RowType,
            title: getTabTitle(tab, t),
            typeName: getTypeName(tab, t),
            tabId: tab.id,
            url: tab.url,
            favIconUrl: tab.favIconUrl,
            color,
            status: tab.status,
            active: tab.active,
            pinned: tab.pinned,
            index: tab.index,
            audible: tab.audible,
          }));
          children.forEach(tab => {
            typeCountMap.set(tab.typeName, (typeCountMap.get(tab.typeName) || 0) + 1);
          });

          return {
            key: groupKey,
            rowType: 'group' as RowType,
            title: group?.title || t('ungrouped'),
            color,
            groupId,
            collapsed: group?.collapsed,
            tabIds,
            count: tabIds.length,
            typeCounts: Array.from(typeCountMap.entries()).map(([typeName, count]) => ({ typeName, count })),
            children,
          };
        });

      const expandableKeys: Key[] = rows.flatMap(row => [
        ...(row.collapsed ? [] : [row.key]),
      ]);

      setDataSource(rows);
      setExpandedRowKeys(prevKeys => {
        if (!initializedRef.current) {
          initializedRef.current = true;
          return expandableKeys;
        }

        const keySet = new Set(expandableKeys);
        return prevKeys.filter(key => keySet.has(key));
      });
      setSelectedRowKeys(prevKeys => {
        const keySet = new Set(collectRowKeys(rows));
        return prevKeys.filter(key => keySet.has(key));
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  const showRestoreButton = useCallback((tab: ClosedTabSnapshot) => {
    if (restoreTimerRef.current !== undefined) {
      window.clearTimeout(restoreTimerRef.current);
    }

    setRecentlyClosedTab(tab);
    restoreTimerRef.current = window.setTimeout(() => {
      setRecentlyClosedTab(undefined);
      restoreTimerRef.current = undefined;
    }, 3000);
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
        index: record.index,
      }
      : undefined;

    await chrome.tabs.remove(tabIds);
    if (closedTab) {
      showRestoreButton(closedTab);
    } else {
      message.success(t('groupedTabsClosed'));
    }
    reloadTabs();
  }, [reloadTabs, showRestoreButton, t]);

  const handleRestoreClosedTab = useCallback(async () => {
    if (!recentlyClosedTab) return;

    if (restoreTimerRef.current !== undefined) {
      window.clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = undefined;
    }

    setRecentlyClosedTab(undefined);

    try {
      await chrome.tabs.create({
        url: recentlyClosedTab.url,
        active: true,
        pinned: recentlyClosedTab.pinned,
        index: recentlyClosedTab.index,
      });
    } catch (error) {
      await chrome.tabs.create({
        url: recentlyClosedTab.url,
        active: true,
        pinned: recentlyClosedTab.pinned,
      });
    }

    reloadTabs();
  }, [recentlyClosedTab, reloadTabs]);

  const handleDeleteSelected = useCallback(async () => {
    const tabIds = collectSelectedTabIds(dataSource, selectedRowKeys);
    if (!tabIds.length) return;

    await chrome.tabs.remove(tabIds);
    setSelectedRowKeys([]);
    setBatchMode(false);
    message.success(t('selectedTabsClosed'));
    reloadTabs();
  }, [dataSource, selectedRowKeys, reloadTabs, t]);

  const handleBatchButtonClick = useCallback(() => {
    if (!batchMode) {
      setBatchMode(true);
      return;
    }

    if (selectedRowKeys.length) {
      handleDeleteSelected();
      return;
    }

    setSelectedRowKeys([]);
    setBatchMode(false);
  }, [batchMode, handleDeleteSelected, selectedRowKeys.length]);

  const updateAllGroupsCollapsed = useCallback(async (collapsed: boolean) => {
    const currentWindow = await chrome.windows.getCurrent();
    const groups = await chrome.tabGroups.query({ windowId: currentWindow.id });

    await Promise.all(groups.map(group => chrome.tabGroups.update(group.id, { collapsed })));
    setExpandedRowKeys(collapsed ? [] : dataSource.map(row => row.key));
    reloadTabs();
  }, [dataSource, reloadTabs]);

  const handleToggleGroup = useCallback(async (record: TabTreeRow) => {
    const groupKey = record.key;
    const isExpanded = expandedRowKeys.includes(groupKey);
    const nextExpandedRowKeys = isExpanded
      ? expandedRowKeys.filter(key => key !== groupKey)
      : [...expandedRowKeys, groupKey];

    if (record.groupId !== undefined && record.groupId !== GROUP_NONE_ID) {
      await chrome.tabGroups.update(record.groupId, { collapsed: isExpanded });
    }

    setExpandedRowKeys(nextExpandedRowKeys);
    reloadTabs();
  }, [expandedRowKeys, reloadTabs]);

  const columns = useMemo<ColumnsType<TabTreeRow>>(() => [
    {
      title: t('name'),
      dataIndex: 'title',
      fixed: 'left',
      width: NAME_COLUMN_WIDTH,
      className: 'tab-overview-name-cell',
      render: (value, record) => {
        const children = (
          <div className={`tab-overview-title tab-overview-title-${record.rowType}`}>
            {record.rowType === 'group' && (
              <>
                <Tag className={`tab-overview-group-tag tab-overview-group-tag-${record.color || DEFAULT_GROUP_COLOR}`}>
                  {value}
                </Tag>
              </>
            )}
            {record.rowType === 'tab' && (
              <>
                <span className="tab-overview-tab-meta">
                  <span className={`tab-overview-tab-favicon${record.favIconUrl ? '' : ' tab-overview-tab-favicon-empty'}`}>
                    {record.favIconUrl && <img src={record.favIconUrl} alt="" />}
                  </span>
                  {record.active && <Tag color="green">{t('current')}</Tag>}
                  <span className="tab-overview-tab-title" title={value}>{value}</span>
                </span>
                {record.url && (
                  <Tooltip
                    title={record.url}
                    mouseEnterDelay={0}
                    overlayClassName="tab-overview-url-tooltip"
                    placement="topLeft"
                  >
                    <LinkOutlined className="tab-overview-url-icon" />
                  </Tooltip>
                )}
              </>
            )}
          </div>
        );

        return children;
      },
    },
    {
      title: t('count'),
      width: COUNT_COLUMN_WIDTH,
      fixed: 'left',
      className: 'tab-overview-count-cell',
      sorter: (prev, next) => getRowCount(prev) - getRowCount(next),
      render: (_, record) => record.rowType === 'group'
        ? getRowCount(record)
        : null,
    },
    {
      title: t('actions'),
      fixed: 'right',
      width: ACTION_COLUMN_WIDTH,
      align: 'center',
      className: 'tab-overview-action-cell',
      render: (_, record) => {
        return (
          <Space className="operations" onClick={event => event.stopPropagation()}>
            <Button
              type="text"
              danger
              size="small"
              icon={<CloseOutlined />}
              aria-label={t('close')}
              onClick={() => handleCloseRecord(record)}
            />
          </Space>
        );
      },
    },
  ], [handleCloseRecord, t]);

  const selectedTabCount = useMemo(
    () => collectSelectedTabIds(dataSource, selectedRowKeys).length,
    [dataSource, selectedRowKeys],
  );
  const allGroupsExpanded = useMemo(
    () => dataSource.length > 0 && dataSource.every(row => expandedRowKeys.includes(row.key)),
    [dataSource, expandedRowKeys],
  );
  const lastTabRowKeys = useMemo(() => {
    const keys = new Set<string>();

    dataSource.forEach(row => {
      const lastTab = row.children?.[row.children.length - 1];
      if (lastTab) keys.add(lastTab.key);
    });

    return keys;
  }, [dataSource]);

  useEffect(() => {
    const cancelInitialReload = runAfterPopupOpened(reloadTabs);

    chrome.tabs.onCreated.addListener(reloadTabs);
    chrome.tabs.onRemoved.addListener(reloadTabs);
    chrome.tabs.onUpdated.addListener(reloadTabs);
    chrome.tabs.onMoved.addListener(reloadTabs);
    chrome.tabs.onAttached.addListener(reloadTabs);
    chrome.tabs.onDetached.addListener(reloadTabs);
    chrome.tabGroups.onCreated.addListener(reloadTabs);
    chrome.tabGroups.onRemoved.addListener(reloadTabs);
    chrome.tabGroups.onUpdated.addListener(reloadTabs);
    chrome.tabGroups.onMoved.addListener(reloadTabs);

    return () => {
      cancelInitialReload();
      chrome.tabs.onCreated.removeListener(reloadTabs);
      chrome.tabs.onRemoved.removeListener(reloadTabs);
      chrome.tabs.onUpdated.removeListener(reloadTabs);
      chrome.tabs.onMoved.removeListener(reloadTabs);
      chrome.tabs.onAttached.removeListener(reloadTabs);
      chrome.tabs.onDetached.removeListener(reloadTabs);
      chrome.tabGroups.onCreated.removeListener(reloadTabs);
      chrome.tabGroups.onRemoved.removeListener(reloadTabs);
      chrome.tabGroups.onUpdated.removeListener(reloadTabs);
      chrome.tabGroups.onMoved.removeListener(reloadTabs);
    };
  }, [reloadTabs]);

  useEffect(() => () => {
    if (restoreTimerRef.current !== undefined) {
      window.clearTimeout(restoreTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!showActions) {
      setActionsContainer(null);
      return;
    }

    setActionsContainer(document.getElementById(ACTIONS_SLOT_ID));
  }, [showActions]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateTableHeight = () => {
      const tableHeader = container.querySelector<HTMLElement>('.ant-table-header');
      const containerStyle = window.getComputedStyle(container);
      const paddingBottom = Number.parseFloat(containerStyle.paddingBottom) || 0;
      const headerHeight = tableHeader?.offsetHeight || 39;
      const nextScrollY = Math.max(220, container.clientHeight - paddingBottom - headerHeight - 2);

      setTableScrollY(Math.floor(nextScrollY));
    };

    updateTableHeight();

    const resizeObserver = new ResizeObserver(updateTableHeight);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  const actions = (
    <Space className="tab-overview-toolbar">
      <Button onClick={() => updateAllGroupsCollapsed(allGroupsExpanded)}>
        {allGroupsExpanded ? t('collapseAll') : t('expandAll')}
      </Button>
      <Button
        danger={batchMode && !!selectedTabCount}
        onClick={handleBatchButtonClick}
      >
        {batchMode && selectedTabCount ? t('closeSelected') : t('batchActions')}
      </Button>
    </Space>
  );

  return (
    <>
      {showActions && actionsContainer && createPortal(actions, actionsContainer)}
      <div className="container tab-overview" ref={containerRef}>
        <Table
          pagination={false}
          loading={loading}
          dataSource={dataSource}
          columns={columns}
          rowKey="key"
          rowClassName={record => [
            `tab-overview-${record.rowType}-row`,
            lastTabRowKeys.has(record.key) ? 'tab-overview-last-tab-row' : '',
            'tab-overview-themed-row',
            `tab-overview-row-${record.color || DEFAULT_GROUP_COLOR}`,
          ].filter(Boolean).join(' ')}
          onRow={record => ({
            onClick: event => {
              const target = event.target as HTMLElement;
              if (record.rowType !== 'group') return;
              if (target.closest('button,input,.ant-checkbox-wrapper,.operations')) return;
              handleToggleGroup(record);
            },
          })}
          rowSelection={batchMode ? {
            selectedRowKeys,
            checkStrictly: false,
            onChange: keys => setSelectedRowKeys(keys),
          } : undefined}
          expandable={{
            expandedRowKeys,
            onExpandedRowsChange: keys => setExpandedRowKeys([...keys]),
            rowExpandable: record => record.rowType === 'group',
            showExpandColumn: false,
          }}
          locale={{
            emptyText: t('noTabs')
          }}
          tableLayout="fixed"
          scroll={{ x: NAME_COLUMN_WIDTH + COUNT_COLUMN_WIDTH + ACTION_COLUMN_WIDTH, y: tableScrollY }}
        />
        {recentlyClosedTab && (
          <div className="tab-overview-restore">
            <Button type="primary" size="small" onClick={handleRestoreClosedTab}>
              {t('restoreClosedTab')}
            </Button>
          </div>
        )}
      </div>
    </>
  );
};

export default TabOverview;
