
import React, { useEffect, useState } from 'react';
import { Button, Form, Input, message, Drawer, Popconfirm, Radio, Row, Select, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useForm } from 'antd/lib/form/Form';
import { v4 as uuid } from 'uuid';
import { EventNames } from '../../common/const';
import 'antd/es/table/style/index';
import 'antd/es/drawer/style/index';
import 'antd/es/form/style/index';
import 'antd/es/input/style/index';
import 'antd/es/radio/style/index';
import 'antd/es/popover/style/index';
import 'antd/es/row/style/index';
import 'antd/es/space/style/index';
import 'antd/es/message/style/index';
import './Popup.less';
import { RuleItem } from '../Background/types';

const TAB_ASSISTANT_RULES = 'TAB_ASSISTANT_RULES'

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

const Popup: React.FC = () => {
  const [dataSource, setDataSource] = useState(data);
  const [editData, setEditData] = useState<Partial<RuleItem>>()
  const [form] = useForm()

  const columns: ColumnsType<RuleItem> = [
    // {
    //   title: '排序',
    //   dataIndex: 'sortIndex',
    //   width: 50,
    //   className: 'drag-visible',
    //   render: () => <DragHandle />,
    // },
    {
      title: '规则名称',
      dataIndex: 'name',
      className: 'drag-visible',
    },
    {
      title: '分组标题',
      dataIndex: 'groupTitle',
    },
    {
      title: '匹配模式',
      dataIndex: 'matchType',
      render(value) {
        return ['域名匹配', '正则匹配'][value]
      },
    },
    {
      title: '匹配内容',
      dataIndex: 'matchContent',
    },
    {
      title: '操作',
      width: 100,
      render: (_, record) =>
        <Space>
          <Button type="link" onClick={() => {
            setEditData(record)
            form.setFieldsValue(record)
          }}>编辑</Button>

          <Popconfirm title="确认删除这个规则吗?" onConfirm={() => handleDelete(record.sortIndex)}>
            <Button type="link">删除</Button>
          </Popconfirm>
        </Space>
    },
  ];

  const handleDelete = (index: number) => {
    const newData = dataSource.filter(item => item.sortIndex !== index);
    chrome.storage.sync.set({ [TAB_ASSISTANT_RULES]: newData })
      .then(() => setDataSource(newData))
      .then(() => reloadRules())
  };

  useEffect(() => {
    chrome.storage.sync.get(TAB_ASSISTANT_RULES).then(res => {
      const rules: RuleItem[] = res[TAB_ASSISTANT_RULES] || []

      const dataSource = rules.map((item: RuleItem, i: number) =>
        ({ ...item, ruleId: item.ruleId || uuid(), priority: item.priority ?? 0, sortIndex: i }))

      setDataSource(dataSource)

      if (rules.some((o: RuleItem) => !o.ruleId || o.priority === void 0)) {
        chrome.storage.sync.set({
          [TAB_ASSISTANT_RULES]: dataSource
        })
      }
    })
  }, [])

  const onFormOk = async () => {
    await form.validateFields()
    const newDataSource = [...dataSource]
    const data = Object.assign({
      sortIndex: editData?.sortIndex ?? Math.max(...dataSource.map(o => o.sortIndex)) + 1,
      ruleId: editData?.ruleId ?? uuid(),
    }, form.getFieldsValue())

    if (editData?.ruleId) {
      const index = newDataSource.findIndex(o => o.ruleId === editData.ruleId)
      newDataSource[index] = data
    } else {
      newDataSource.push(data)
    }

    chrome.storage.sync.set({ [TAB_ASSISTANT_RULES]: newDataSource })
      .then(() => {
        setDataSource(newDataSource)
        setEditData(undefined)
        form.resetFields()
        reloadRules()
      })
  }

  const reloadRules = () => {
    chrome.runtime.sendMessage(EventNames.ReloadRule, res => {
      message.success('规则更新成功')
    })
  }

  return (
    <div className="container">
      <Row style={{ marginBottom: 16 }}>
        <Space>
          <Button type="primary" onClick={() => setEditData({})}>添加规则</Button>
          <Button type="primary" onClick={() => reloadRules()}>应用规则</Button>
        </Space>
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
        onClose={() => setEditData(undefined)}
        footer={
          <Row justify="end">
            <Space>
              <Button onClick={() => setEditData(undefined)}>取消</Button>
              <Button type="primary" onClick={() => onFormOk()}>确认</Button>
            </Space>
          </Row>
        }
      >
        <Form form={form} labelCol={{ span: 5 }}>
          <Form.Item className="u-mb-15" label="规则名称" name="name" required rules={[{ required: true, message: "规则名称必填" }]}>
            <Input placeholder='请输入' allowClear />
          </Form.Item>
          <Form.Item className="u-mb-15" label="分组标题" name="groupTitle">
            <Input placeholder='请输入' allowClear />
          </Form.Item>
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

export default Popup;
