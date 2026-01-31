import React, { memo, useEffect, useState, useCallback } from 'react';
import {
  Button,
  List,
  Modal,
  Select,
  Space,
  Statistic,
  Row,
  Col,
  message,
  Empty,
  Tag,
} from 'antd';
import {
  CloseOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
} from '@ant-design/icons';
import './style.less';

interface GroupItem {
  id: number;
  title: string;
  color: string;
  windowId: number;
  tabCount: number;
  collapsed: boolean;
}

interface GroupManagementStats {
  totalGroups: number;
  totalTabs: number;
  ungroupedTabs: number;
}

interface GroupListProps {
  group: GroupItem;
  onClose: (groupId: number) => void;
  onToggleSelect: (groupId: number) => void;
  selected: boolean;
}

const GroupList: React.FC<GroupListProps> = ({
  group,
  onClose,
  onToggleSelect,
  selected,
}) => {
  const colorMap: Record<string, string> = {
    grey: '#8e8e93',
    blue: '#5e5ce6',
    red: '#ff3b30',
    yellow: '#ffcc00',
    green: '#30d158',
    pink: '#ff2d55',
    purple: '#bf5af2',
    cyan: '#32ade6',
    orange: '#ff9500',
  };

  const handleClose = () => {
    Modal.confirm({
      title: '确认关闭分组',
      content: `确定关闭「${group.title}」分组吗？关闭将删除分组内的 ${group.tabCount} 个标签页。`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => onClose(group.id),
    });
  };

  return (
    <div className={`group-item ${selected ? 'selected' : ''}`}>
      <div className="group-item-left" onClick={() => onToggleSelect(group.id)}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(group.id)}
        />
        <div
          className="group-color-indicator"
          style={{ backgroundColor: colorMap[group.color] || group.color }}
        />
        <div className="group-info">
          <div className="group-title">{group.title}</div>
          <div className="group-meta">
            <Tag color="default">窗口 {group.windowId}</Tag>
            <Tag color={group.tabCount > 10 ? 'red' : 'blue'}>
              {group.tabCount} 个标签
            </Tag>
          </div>
        </div>
      </div>
      <Button
        type="text"
        danger
        icon={<CloseOutlined />}
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
        className="group-close-btn"
      >
        关闭
      </Button>
    </div>
  );
};

export const GroupManagement = memo(() => {
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(
    new Set()
  );
  const [stats, setStats] = useState<GroupManagementStats>({
    totalGroups: 0,
    totalTabs: 0,
    ungroupedTabs: 0,
  });
  const [windowFilter, setWindowFilter] = useState<number | undefined>();
  const [windowOptions, setWindowOptions] = useState<
    { label: string; value: number }[]
  >([]);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>();
  const [loading, setLoading] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      // 获取所有窗口
      const windows = await chrome.windows.getAll();

      // 获取所有分组
      const allGroups = await chrome.tabGroups.query({});

      // 获取分组内的标签数
      const groupsWithTabs = await Promise.all(
        allGroups.map(async (group) => {
          const tabs = await chrome.tabs.query({ groupId: group.id });
          return {
            id: group.id as number,
            title: group.title || '未命名分组',
            color: group.color || 'grey',
            windowId: group.windowId,
            tabCount: tabs.length,
            collapsed: group.collapsed,
          };
        })
      );

      // 获取未分组标签数
      let totalUngroupedTabs = 0;
      for (const window of windows) {
        if (window.id) {
          const ungroupedTabs = await chrome.tabs.query({
            windowId: window.id,
            groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
          });
          totalUngroupedTabs += ungroupedTabs.length;
        }
      }

      // 统计
      const totalTabs = groupsWithTabs.reduce(
        (sum, group) => sum + group.tabCount,
        0
      );
      setStats({
        totalGroups: groupsWithTabs.length,
        totalTabs: totalTabs + totalUngroupedTabs,
        ungroupedTabs: totalUngroupedTabs,
      });

      // 窗口筛选选项
      const windowOpts = windows
        .filter((w) => w.id)
        .map((w) => ({ label: `窗口 ${w.id}`, value: w.id! }));
      setWindowOptions(windowOpts);

      // 应用筛选和排序
      let filteredGroups = groupsWithTabs;
      if (windowFilter) {
        filteredGroups = filteredGroups.filter(
          (g) => g.windowId === windowFilter
        );
      }

      if (sortOrder) {
        filteredGroups = [...filteredGroups].sort((a, b) =>
          sortOrder === 'asc'
            ? a.tabCount - b.tabCount
            : b.tabCount - a.tabCount
        );
      }

      setGroups(filteredGroups);
      setSelectedGroupIds(new Set());
    } catch (error) {
      console.error('加载分组失败:', error);
      message.error('加载分组失败');
    } finally {
      setLoading(false);
    }
  }, [windowFilter, sortOrder]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const handleCloseGroup = async (groupId: number) => {
    try {
      const tabs = await chrome.tabs.query({ groupId });
      if (tabs.length === 0) {
        message.warning('该分组没有标签页');
        return;
      }
      const tabIds = tabs.map((tab) => tab.id!);
      await chrome.tabs.remove(tabIds);
      message.success(`已关闭 ${tabs.length} 个标签页`);
      loadGroups();
    } catch (error) {
      console.error('关闭分组失败:', error);
      message.error('关闭分组失败');
    }
  };

  const handleCloseSelectedGroups = async () => {
    if (selectedGroupIds.size === 0) {
      message.warning('请先选择要关闭的分组');
      return;
    }

    Modal.confirm({
      title: '确认批量关闭',
      content: `确定关闭选中的 ${selectedGroupIds.size} 个分组吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          for (const groupId of selectedGroupIds) {
            const tabs = await chrome.tabs.query({ groupId });
            const tabIds = tabs.map((tab) => tab.id!);
            await chrome.tabs.remove(tabIds);
          }
          message.success(`已关闭 ${selectedGroupIds.size} 个分组`);
          loadGroups();
        } catch (error) {
          console.error('批量关闭失败:', error);
          message.error('批量关闭失败');
        }
      },
    });
  };

  const handleToggleSelect = (groupId: number) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedGroupIds.size === groups.length && groups.length > 0) {
      setSelectedGroupIds(new Set());
    } else {
      setSelectedGroupIds(new Set(groups.map((g) => g.id)));
    }
  };

  const handleSort = () => {
    if (sortOrder === 'asc') {
      setSortOrder('desc');
    } else if (sortOrder === 'desc') {
      setSortOrder(undefined);
    } else {
      setSortOrder('asc');
    }
  };

  const allSelected =
    groups.length > 0 && selectedGroupIds.size === groups.length;
  const someSelected = selectedGroupIds.size > 0;

  return (
    <div className="group-management">
      {/* 统计信息 */}
      <Row gutter={16} className="stats-row">
        <Col span={8}>
          <Statistic title="分组数" value={stats.totalGroups} />
        </Col>
        <Col span={8}>
          <Statistic title="总标签数" value={stats.totalTabs} />
        </Col>
        <Col span={8}>
          <Statistic
            title="未分组"
            value={stats.ungroupedTabs}
            valueStyle={{ color: '#ff4d4f' }}
          />
        </Col>
      </Row>

      {/* 操作栏 */}
      <div className="action-bar">
        <Space>
          <Button
            type="primary"
            danger
            icon={<DeleteOutlined />}
            disabled={selectedGroupIds.size === 0}
            onClick={handleCloseSelectedGroups}
          >
            批量关闭 ({selectedGroupIds.size})
          </Button>
          <Button
            icon={allSelected ? undefined : <CloseOutlined />}
            onClick={handleToggleSelectAll}
          >
            {allSelected ? '取消全选' : '全选'}
          </Button>
          <Select
            placeholder="按窗口筛选"
            style={{ width: 150 }}
            allowClear
            value={windowFilter}
            onChange={setWindowFilter}
            options={windowOptions}
          />
          <Button
            icon={
              sortOrder === 'asc' ? (
                <ArrowUpOutlined />
              ) : sortOrder === 'desc' ? (
                <ArrowDownOutlined />
              ) : undefined
            }
            onClick={handleSort}
          >
            标签数 {sortOrder === 'asc' ? '↑' : sortOrder === 'desc' ? '↓' : ''}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={loadGroups}
          >
            刷新
          </Button>
        </Space>
      </div>

      {/* 分组列表 */}
      <div className="group-list">
        {groups.length === 0 ? (
          <Empty description="暂无分组" />
        ) : (
          groups.map((group) => (
            <GroupList
              key={group.id}
              group={group}
              onClose={handleCloseGroup}
              onToggleSelect={handleToggleSelect}
              selected={selectedGroupIds.has(group.id)}
            />
          ))
        )}
      </div>
    </div>
  );
});

export default GroupManagement;
