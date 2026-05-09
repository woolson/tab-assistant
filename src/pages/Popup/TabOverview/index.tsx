import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, message, Popconfirm, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Key } from 'antd/es/table/interface';
import { LinkOutlined } from '@ant-design/icons';
import './style.less';

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

const GROUP_NONE_ID = chrome.tabGroups.TAB_GROUP_ID_NONE;
const DEFAULT_GROUP_COLOR = 'grey';
const NAME_COLUMN_WIDTH = 360;
const COUNT_COLUMN_WIDTH = 56;

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

const getTypeName = (tab: chrome.tabs.Tab) => {
  if (tab.pinned) return '固定标签';

  try {
    const protocol = new URL(tab.url || '').protocol;
    if (protocol === 'http:' || protocol === 'https:') return '网页';
    if (protocol === 'chrome:') return '浏览器页面';
    if (protocol === 'chrome-extension:') return '扩展页面';
    if (protocol === 'file:') return '本地文件';
  } catch (error) {
    return '其他';
  }

  return '其他';
};

const getTabTitle = (tab: chrome.tabs.Tab) => tab.title || tab.url || '未命名标签页';

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

const TabOverview: React.FC = () => {
  const [dataSource, setDataSource] = useState<TabTreeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [tableScrollY, setTableScrollY] = useState(340);
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

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
          const sortedTabs = groupTabs.sort((prev, next) => prev.index - next.index);
          const tabIds = sortedTabs.map(tab => tab.id).filter((id): id is number => typeof id === 'number');
          const groupKey = `group-${groupId}`;
          const typeCountMap = new Map<string, number>();
          const children = sortedTabs.map(tab => ({
            key: `tab-${tab.id}`,
            rowType: 'tab' as RowType,
            title: getTabTitle(tab),
            typeName: getTypeName(tab),
            tabId: tab.id,
            url: tab.url,
            favIconUrl: tab.favIconUrl,
            status: tab.status,
            active: tab.active,
            pinned: tab.pinned,
            audible: tab.audible,
          }));
          children.forEach(tab => {
            typeCountMap.set(tab.typeName, (typeCountMap.get(tab.typeName) || 0) + 1);
          });

          return {
            key: groupKey,
            rowType: 'group' as RowType,
            title: group?.title || '未分组',
            color: group?.color,
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
  }, []);

  const handleCloseRecord = useCallback(async (record: TabTreeRow) => {
    const tabIds = record.rowType === 'group'
      ? record.tabIds || []
      : record.tabId !== undefined ? [record.tabId] : [];
    if (!tabIds.length) return;

    await chrome.tabs.remove(tabIds);
    message.success(record.rowType === 'group' ? '分组标签页已关闭' : '网页已关闭');
    reloadTabs();
  }, [reloadTabs]);

  const handleDeleteSelected = useCallback(async () => {
    const tabIds = collectSelectedTabIds(dataSource, selectedRowKeys);
    if (!tabIds.length) return;

    await chrome.tabs.remove(tabIds);
    setSelectedRowKeys([]);
    setBatchMode(false);
    message.success('选中的标签页已关闭');
    reloadTabs();
  }, [dataSource, selectedRowKeys, reloadTabs]);

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
      title: '名称',
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
                  {record.active && <Tag color="green">当前</Tag>}
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
      title: '数量',
      width: COUNT_COLUMN_WIDTH,
      fixed: 'left',
      className: 'tab-overview-count-cell',
      sorter: (prev, next) => getRowCount(prev) - getRowCount(next),
      render: (_, record) => record.rowType === 'group'
        ? getRowCount(record)
        : null,
    },
    {
      title: '操作',
      fixed: 'right',
      width: 58,
      align: 'center',
      className: 'tab-overview-action-cell',
      render: (_, record) => {
        const confirmTitle = record.rowType === 'group'
          ? '确认关闭这个分组下所有标签页吗?'
          : '确认关闭这个网页吗?';

        return (
          <Space className="operations" onClick={event => event.stopPropagation()}>
            <Popconfirm
              placement="left"
              title={confirmTitle}
              onConfirm={() => handleCloseRecord(record)}
            >
              <Button type="link" danger>关闭</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ], [handleCloseRecord]);

  const selectedTabCount = useMemo(
    () => collectSelectedTabIds(dataSource, selectedRowKeys).length,
    [dataSource, selectedRowKeys],
  );
  const allGroupsExpanded = useMemo(
    () => dataSource.length > 0 && dataSource.every(row => expandedRowKeys.includes(row.key)),
    [dataSource, expandedRowKeys],
  );

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

  return (
    <div className="container tab-overview" ref={containerRef}>
      <Space style={{ position: 'absolute', right: 20, top: -55 }}>
        <Button onClick={() => updateAllGroupsCollapsed(allGroupsExpanded)}>
          {allGroupsExpanded ? '全部折叠' : '全部展开'}
        </Button>
        <Popconfirm
          placement="left"
          title={`确认关闭选中的 ${selectedTabCount} 个标签页吗?`}
          disabled={!batchMode || !selectedTabCount}
          onConfirm={handleDeleteSelected}
        >
          <Button
            danger={batchMode && !!selectedTabCount}
            onClick={event => {
              if (batchMode && selectedTabCount) return;
              event.preventDefault();
              handleBatchButtonClick();
            }}
          >
            {batchMode && selectedTabCount ? '关闭选中' : '批量操作'}
          </Button>
        </Popconfirm>
      </Space>
      <Table
        size="small"
        pagination={false}
        loading={loading}
        dataSource={dataSource}
        columns={columns}
        rowKey="key"
        rowClassName={record => record.rowType === 'group' ? 'tab-overview-group-row' : ''}
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
          emptyText: '暂无标签页'
        }}
        tableLayout="fixed"
        scroll={{ x: NAME_COLUMN_WIDTH + COUNT_COLUMN_WIDTH + 120, y: tableScrollY }}
      />
    </div>
  );
};

export default TabOverview;
