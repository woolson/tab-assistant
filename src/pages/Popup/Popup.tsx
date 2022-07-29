
import React, { useEffect, useState } from 'react';
import { Button, Form, Input, message, Modal, Popconfirm, Radio, Row, Select, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useForm } from 'antd/lib/form/Form';
import { v4 as uuid } from 'uuid';
import { EventNames } from '../../common/const';
import 'antd/es/table/style/index';
import 'antd/es/modal/style/index';
import 'antd/es/form/style/index';
import 'antd/es/input/style/index';
import 'antd/es/radio/style/index';
import 'antd/es/popover/style/index';
import 'antd/es/row/style/index';
import 'antd/es/space/style/index';
import 'antd/es/message/style/index';
import './Popup.less';

const TAB_ASSISTANT_RULES = 'TAB_ASSISTANT_RULES'
interface DataType {
  ruleId: string
  name: string
  sortIndex: number
  groupTitle: string
  groupColor: string
  matchType: string
  matchContent: string
}

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

const data: DataType[] = [];

const Popup: React.FC = () => {
  const [dataSource, setDataSource] = useState(data);
  const [editData, setEditData] = useState<Partial<DataType>>()
  const [form] = useForm()

  const columns: ColumnsType<DataType> = [
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
      const rules: DataType[] = res[TAB_ASSISTANT_RULES] || []

      const dataSource = rules.map((item: DataType, i: number) =>
        ({ ...item, ruleId: item.ruleId || uuid(), sortIndex: i }))

      setDataSource(dataSource)

      if (rules.some((o: DataType) => !o.ruleId)) {
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
          <Button type="primary" size="middle" onClick={() => setEditData({})}>添加规则</Button>
          <Button type="primary" size="middle" onClick={() => reloadRules()}>应用规则</Button>
        </Space>
      </Row>
      <Table
        size="small"
        pagination={false}
        dataSource={dataSource}
        columns={columns}
        rowKey="index"
      />
      <Modal
        title="规则"
        visible={!!editData}
        onCancel={() => setEditData(undefined)}
        onOk={() => onFormOk()}
      >
        <Form form={form} labelCol={{ span: 5 }}>
          <Form.Item label="规则名称" name="name" required rules={[{ required: true, message: "规则名称必填" }]}>
            <Input placeholder='请输入' allowClear />
          </Form.Item>
          <Form.Item label="分组标题" name="groupTitle">
            <Input placeholder='请输入' allowClear />
          </Form.Item>
          <Form.Item label="分组颜色" name="groupColor">
            <Select options={COLORS} />
          </Form.Item>
          <Form.Item label="匹配模式" name="matchType" required rules={[{ required: true, message: "匹配模式必选" }]}>
            <Radio.Group>
              <Radio value={0}>按域名分组</Radio>
              <Radio value={1}>按正则匹配</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="匹配内容" name="matchContent" required rules={[{ required: true, message: "匹配内容必填" }]}>
            <Input placeholder='请输入' allowClear />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Popup;
