
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Drawer, Popconfirm, Radio, Row, Select, Space, Table, Tag } from 'antd';
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
import { DeleteOutlined, EditOutlined, HolderOutlined } from '@ant-design/icons';
import { useI18n } from '@/common/i18n';

const COLOR_KEYS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'] as const;

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
  const { t } = useI18n();
  const [dataSource, setDataSource] = useState(data);
  const [editData, setEditData] = useState<Partial<RuleItem>>()
  const [form] = useForm<RuleItem>()
  const colorOptions = useMemo(() => COLOR_KEYS.map(value => ({ value, label: t(value) })), [t]);

  const columns: ColumnsType<RuleItem> = [
    {
      key: 'sort',
      fixed: 'left',
      align: 'center',
      width: 40,
      render: () => <DragHandle />
    },
    {
      title: t('groupTitle'),
      fixed: 'left',
      dataIndex: 'name',
      className: 'drag-visible',
    },
    {
      title: t('matchMode'),
      dataIndex: 'matchType',
      width: 80,
      render(value) {
        const data = [t('domain'), t('regExp')][value]
        return <Tag color={['blue', 'green'][value]}>{data}</Tag>
      },
    },
    {
      title: t('matchContent'),
      dataIndex: 'matchContent',
      render: value => <span className="u-mono">{value}</span>
    },
    {
      title: t('actions'),
      fixed: 'right',
      width: 58,
      align: 'center',
      className: 'rules-action-cell',
      render: (_, record) =>
        <Space className="operations">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label={t('edit')}
            title={t('edit')}
            onClick={() => {
              setEditData(record)
              form.setFieldsValue(record)
            }}
          />

          <Popconfirm
            placement="left"
            title={t('deleteRuleConfirm')}
            onConfirm={() => handleDelete(record.sortIndex)}>
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              aria-label={t('delete')}
              title={t('delete')}
            />
          </Popconfirm>
        </Space>
    },
  ];

  /** 删除规则 */
  const handleDelete = useCallback((index: number) => {
    const newData = dataSource.filter(item => item.sortIndex !== index);
    chrome.storage.sync.set({ [StorageKeyEnum.RULES]: newData })
      .then(() => setDataSource(newData))
      .then(() => reloadConfig(t('ruleUpdateSuccess')))
  }, [dataSource, t]);

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
          .then(() => reloadConfig(t('ruleUpdateSuccess')))

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
        reloadConfig(t('ruleUpdateSuccess'))
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
    <div className="container rules">
      <Space style={{ position: 'absolute', right: 20, top: -55 }}>
        <Button
          onClick={() => {
            form.setFieldsValue({
              matchType: 0,
              groupColor: 'blue',
            })
            setEditData({})
          }}>
          {t('addRule')}</Button>
        <Button
          onClick={() => {
            reloadRules()
            reloadConfig(t('ruleUpdateSuccess'))
          }}>{t('refreshRules')}</Button>
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
            locale={{
              emptyText: t('noRules')
            }}
            scroll={{ x: 'max-content', y: 410 }}
          />
        </SortableContext>
      </DndContext>
      <Drawer
        title={editData?.ruleId ? t('editRule') : t('newRule')}
        width={500}
        zIndex={99999}
        open={!!editData}
        onClose={closeModal}
        footer={
          <Row justify="end">
            <Space>
              <Button onClick={closeModal}>{t('cancel')}</Button>
              <Button type="primary" onClick={() => onFormOk()}>{t('confirm')}</Button>
            </Space>
          </Row>
        }
      >
        <Form form={form} labelCol={{ span: 5 }}>
          <Form.Item
            required
            className="u-mb-15"
            label={t('groupTitle')}
            name="name"
            rules={[{ required: true, message: t('ruleNameRequired') }]}>
            <Input placeholder={t('groupTitlePlaceholder')} allowClear />
          </Form.Item>
          {/* <Form.Item className="u-mb-15" label="分组标题" name="groupTitle">
            <Input placeholder='请输入' allowClear />
          </Form.Item> */}
          <Form.Item className="u-mb-15" label={t('priority')} name="priority" hidden>
            <Input type="number" step={1} min={0} defaultValue={0} />
          </Form.Item>
          <Form.Item className="u-mb-15" label={t('groupColor')} name="groupColor">
            <Select options={colorOptions} placeholder={t('groupColorPlaceholder')} />
          </Form.Item>
          <Form.Item className="u-mb-15" label={t('matchMode')} name="matchType" required rules={[{ required: true, message: t('matchModeRequired') }]}>
            <Radio.Group>
              <Radio value={0}>{t('matchByDomain')}</Radio>
              <Radio value={1}>{t('matchByRegExp')}</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            className="u-mb-15"
            required
            label={t('matchContent')}
            name="matchContent"
            style={{ marginBottom: 0 }}
            rules={[{ required: true, message: t('matchContentRequired') }]}
            extra={
              <>
                <Button type="link" style={{ padding: 0 }} onClick={getCurrentTabUrl}>{t('insertCurrentDomain')}</Button>
                <span> {t('regExpMatchTip')}</span>
              </>
            }>
            <Input.TextArea
              autoSize={{ minRows: 2 }}
              placeholder={t('inputPlaceholder')}
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
