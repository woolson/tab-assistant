
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Drawer, Popconfirm, Radio, Row, Select, Space, Table, Divider, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useForm } from 'antd/lib/form/Form';
import { v4 as uuid } from 'uuid';
import { reloadConfig } from '@/common';
import { StorageKeyEnum } from '@/common/const';
import { RuleItem } from '@/pages/Background/types';
import { DndContext } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import './style.less';
import { HolderOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';

const COLORS = [
  { value: 'grey', label: '灰色' },
  { value: 'blue', label: '蓝色' },
  { value: 'red', label: '红色' },
  { value: 'yellow', label: '黄色' },
  { value: 'green', label: '绿色' },
  { value: 'pink', label: '粉色' },
  { value: 'purple', label: '紫色' },
  { value: 'cyan', label: '青色' }
]

interface RowContextProps {
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  listeners?: SyntheticListenerMap;
}

interface RowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  'data-row-key': string;
}

const RowContext = React.createContext<RowContextProps>({});

const DragHandle: React.FC = () => {
  const { setActivatorNodeRef, listeners } = useContext(RowContext);
  return (
    <Button
      type="text"
      size="small"
      icon={<HolderOutlined />}
      style={{ cursor: 'move' }}
      ref={setActivatorNodeRef}
      {...listeners}
    />
  );
};

const TableRow: React.FC<RowProps> = (props) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props['data-row-key'] });

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 9999 } : {}),
  };

  const contextValue = useMemo<RowContextProps>(
    () => ({ setActivatorNodeRef, listeners }),
    [setActivatorNodeRef, listeners],
  );

  return (
    <RowContext.Provider value={contextValue}>
      <tr {...props} ref={setNodeRef} style={style} {...attributes} />
    </RowContext.Provider>
  );
};

const data: RuleItem[] = [];

const Rules: React.FC = () => {
  const [dataSource, setDataSource] = useState(data);
  const [editData, setEditData] = useState<Partial<RuleItem>>()
  const [form] = useForm<RuleItem>()

  const columns: ColumnsType<RuleItem> = [
    { key: 'sort', fixed: 'left', align: 'center', width: 40, render: () => <DragHandle /> },
    {
      title: '分组标题',
      fixed: 'left',
      dataIndex: 'name',
      className: 'drag-visible',
    },
    {
      title: '匹配模式',
      dataIndex: 'matchType',
      width: 80,
      render(value) {
        const data = ['域名', '正则'][value]
        return <Tag color={['red', 'green'][value]}>{data}</Tag>
      },
    },
    // {
    //   title: '优先级',
    //   width: 70,
    //   dataIndex: 'priority',
    //   render: value => <span className="u-mono">{value}</span>
    // },
    {
      title: '匹配内容',
      dataIndex: 'matchContent',
      render: value => <span className="u-mono">{value}</span>
    },
    {
      title: '操作',
      fixed: 'right',
      width: 100,
      render: (_, record) =>
        <Space className="operations" split={<Divider type="vertical" />}>
          <Button type="link" onClick={() => {
            setEditData(record)
            form.setFieldsValue(record)
          }}>编辑</Button>

          <Popconfirm
            placement="left"
            title="确认删除这个规则吗?"
            onConfirm={() => handleDelete(record.sortIndex)}>
            <Button type="link" danger>删除</Button>
          </Popconfirm>
        </Space>
    },
  ];

  /** 删除规则 */
  const handleDelete = useCallback((index: number) => {
    const newData = dataSource.filter(item => item.sortIndex !== index);
    chrome.storage.sync.set({ [StorageKeyEnum.RULES]: newData })
      .then(() => setDataSource(newData))
      .then(() => reloadConfig())
  }, [dataSource]);

  /** 获取当前tab链接 */
  const getCurrentTabUrl = useCallback(async () => {
    const currentTab = await chrome.tabs.query({ active: true })
    if (currentTab.length) {
      const url = new URL(currentTab[0].url as string);
      form.setFieldsValue({
        matchContent: (form.getFieldValue('matchContent') || '') + url.host
      })
    }
  }, [form])

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (active.id !== over?.id) {
      setDataSource((prevState) => {
        const activeIndex = prevState.findIndex((record) => record.ruleId === active?.id);
        const overIndex = prevState.findIndex((record) => record.ruleId === over?.id);
        const newDataSource = arrayMove(prevState, activeIndex, overIndex).map((item, index) => ({ ...item, sortIndex: index }));

        chrome.storage.sync.set({ [StorageKeyEnum.RULES]: newDataSource })
          .then(reloadConfig)

        return newDataSource;
      });
    }
  };

  useEffect(() => {
    reloadRules()
  }, [])

  const onFormOk = async () => {
    await form.validateFields()
    const newDataSource = [...dataSource]
    const formData: RuleItem = form.getFieldsValue()
    const data = Object.assign<Partial<RuleItem>, RuleItem>({
      sortIndex: editData?.sortIndex ?? Math.max(...dataSource.map(o => o.sortIndex)) + 1,
      ruleId: editData?.ruleId ?? uuid(),
      groupTitle: formData.name,
    }, formData)

    if (editData?.ruleId) {
      const index = newDataSource.findIndex(o => o.ruleId === editData.ruleId)
      newDataSource[index] = data
    } else {
      newDataSource.push(data)
    }

    chrome.storage.sync.set({ [StorageKeyEnum.RULES]: newDataSource })
      .then(() => {
        setDataSource(newDataSource)
        setEditData(undefined)
        form.resetFields()
        reloadConfig()
      })
  }

  const closeModal = useCallback(() => {
    setEditData(undefined)
    form.resetFields()
  }, [form])

  const reloadRules = useCallback(() => {
    chrome.storage.sync.get(StorageKeyEnum.RULES).then(res => {
      const rules: RuleItem[] = res[StorageKeyEnum.RULES] || []

      const dataSource = rules.map((item: RuleItem, i: number) =>
        ({ ...item, ruleId: item.ruleId || uuid(), priority: item.priority ?? 0, sortIndex: i }))

      setDataSource(dataSource)

      if (rules.some((o: RuleItem) => !o.ruleId || o.priority === void 0)) {
        chrome.storage.sync.set({
          [StorageKeyEnum.RULES]: dataSource
        })
      }
    })
  }, [])

  return (
    <div className="container">
      <Space style={{ position: 'absolute', right: 20, top: -55 }}>
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            form.setFieldsValue({
              matchType: 0,
              groupColor: 'blue',
            })
            setEditData({})
          }}>
          添加规则</Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            reloadRules()
            reloadConfig()
          }}>刷新规则</Button>
      </Space>
      <DndContext
        onDragEnd={onDragEnd}
        modifiers={[restrictToVerticalAxis]}
      >
        <SortableContext items={dataSource.map((item) => item.ruleId)} strategy={verticalListSortingStrategy}>
          <Table
            size="small"
            pagination={false}
            dataSource={dataSource}
            columns={columns}
            rowKey="ruleId"
            components={{
              body: { row: TableRow },
            }}
            scroll={{ x: 'max-content' }}
          />
        </SortableContext>
      </DndContext>
      <Drawer
        title={editData?.ruleId ? '编辑规则' : '新建规则'}
        width={500}
        zIndex={99999}
        open={!!editData}
        onClose={closeModal}
        footer={
          <Row justify="end">
            <Space>
              <Button onClick={closeModal}>取消</Button>
              <Button type="primary" onClick={() => onFormOk()}>确认</Button>
            </Space>
          </Row>
        }
      >
        <Form form={form} labelCol={{ span: 5 }}>
          <Form.Item
            required
            className="u-mb-15"
            label="分组标题"
            name="name"
            rules={[{ required: true, message: "规则名称必填" }]}>
            <Input placeholder='请输入分组标题' allowClear />
          </Form.Item>
          {/* <Form.Item className="u-mb-15" label="分组标题" name="groupTitle">
            <Input placeholder='请输入' allowClear />
          </Form.Item> */}
          <Form.Item className="u-mb-15" label="优先级" name="priority" hidden>
            <Input type="number" step={1} min={0} defaultValue={0} />
          </Form.Item>
          <Form.Item className="u-mb-15" label="分组颜色" name="groupColor">
            <Select options={COLORS} placeholder="请选择分组颜色" />
          </Form.Item>
          <Form.Item className="u-mb-15" label="匹配模式" name="matchType" required rules={[{ required: true, message: "匹配模式必选" }]}>
            <Radio.Group>
              <Radio value={0}>按域名分组</Radio>
              <Radio value={1}>按正则匹配</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            className="u-mb-15"
            required
            label="匹配内容"
            name="matchContent"
            style={{ marginBottom: 0 }}
            rules={[{ required: true, message: "匹配内容必填" }]}
            extra={
              <>
                <Button type="link" style={{ padding: 0 }} onClick={getCurrentTabUrl}>点击插入当前标签域名</Button>
                ，匹配模式为按正则时支持填写正则表达式，如：(developer.chrome.com|chrome.google.com)
              </>
            }>
            <Input.TextArea
              autoSize={{ minRows: 2 }}
              placeholder='请输入'
              allowClear
              styles={{ textarea: { fontFamily: 'PuHuiTi' } }}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
};

export default Rules;
