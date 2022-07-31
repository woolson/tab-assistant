
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, Drawer, Popconfirm, Radio, Row, Select, Space, Table, Divider } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useForm } from 'antd/lib/form/Form';
import { v4 as uuid } from 'uuid';
import { reloadConfig } from '@/common';
import { StorageKeyEnum } from '@/common/const';
import { RuleItem } from '@/pages/Background/types';
import './style.less';

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

const data: RuleItem[] = [];

const Rules: React.FC = () => {
  const [dataSource, setDataSource] = useState(data);
  const [editData, setEditData] = useState<Partial<RuleItem>>()
  const [form] = useForm<RuleItem>()

  const columns: ColumnsType<RuleItem> = [
    {
      title: '分组标题',
      dataIndex: 'name',
      className: 'drag-visible',
    },
    {
      title: '模式',
      dataIndex: 'matchType',
      width: 60,
      render(value) {
        return ['域名', '正则'][value]
      },
    },
    {
      title: '优先级',
      width: 70,
      dataIndex: 'priority',
      render: value => <span className="u-mono">{value}</span>
    },
    {
      title: '匹配内容',
      dataIndex: 'matchContent',
      render: value => <span className="u-mono">{value}</span>
    },
    {
      title: '操作',
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
            <Button type="link">删除</Button>
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
    const currentTab = await chrome.tabs.getCurrent()
    form.setFieldsValue({
      matchContent: currentTab.url
    })
  }, [form])

  useEffect(() => {
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

  return (
    <div className="container">
      <Row style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setEditData({})}>添加规则</Button>
      </Row>
      <Table
        size="small"
        pagination={false}
        dataSource={dataSource}
        columns={columns}
        rowKey="index"
      />
      <Drawer
        title={editData?.ruleId ? '编辑规则' : '新建规则'}
        width={500}
        visible={!!editData}
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
            <Input placeholder='是分组名，请输入' allowClear />
          </Form.Item>
          {/* <Form.Item className="u-mb-15" label="分组标题" name="groupTitle">
            <Input placeholder='请输入' allowClear />
          </Form.Item> */}
          <Form.Item className="u-mb-15" label="优先级" name="priority">
            <Input type="number" step={1} min={0} defaultValue={0} />
          </Form.Item>
          <Form.Item className="u-mb-15" label="分组颜色" name="groupColor">
            <Select options={COLORS} />
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
            rules={[{ required: true, message: "匹配内容必填" }]}>
            <Input placeholder='请输入' allowClear />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
};

export default Rules;
