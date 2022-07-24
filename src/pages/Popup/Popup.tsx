
import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Radio, Row, Select, Space, Table } from 'antd';
import { MenuOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { arrayMoveImmutable } from 'array-move';
import type { SortableContainerProps, SortEnd } from 'react-sortable-hoc';
import { SortableContainer, SortableElement, SortableHandle } from 'react-sortable-hoc';
import { useForm } from 'antd/lib/form/Form';
import 'antd/es/table/style/index';
import 'antd/es/modal/style/index';
import 'antd/es/form/style/index';
import 'antd/es/input/style/index';
import 'antd/es/radio/style/index';
import 'antd/es/popover/style/index';
import 'antd/es/row/style/index';
import 'antd/es/space/style/index';
import './Popup.less';

const TAB_ASSISTANT_RULES = 'TAB_ASSISTANT_RULES'
interface DataType {
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

const DragHandle = SortableHandle(() =>
  <MenuOutlined style={{ cursor: 'grab', color: '#999' }} />
);

const data: DataType[] = [];

const SortableItem = SortableElement((props: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr {...props} />
));
const SortableBody = SortableContainer((props: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody {...props} />
));

const Popup: React.FC = () => {
  const [dataSource, setDataSource] = useState(data);
  const [editData, setEditData] = useState<Partial<DataType>>()
  const [form] = useForm()

  const columns: ColumnsType<DataType> = [
    {
      title: '拖动排序',
      dataIndex: 'sortIndex',
      width: 100,
      className: 'drag-visible',
      render: () => <DragHandle />,
    },
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
      dataIndex: 'operation',
      render: (_, record) =>
        dataSource.length >= 1 ? (
          <Popconfirm title="确认删除这个规则吗?" onConfirm={() => handleDelete(record.sortIndex)}>
            <Button type="link">删除</Button>
          </Popconfirm>
        ) : null,
    },
  ];

  const handleDelete = (index: number) => {
    const newData = dataSource.filter(item => item.sortIndex !== index);
    chrome.storage.sync.set({ [TAB_ASSISTANT_RULES]: newData }).then(() => setDataSource(newData))
  };

  useEffect(() => {
    chrome.storage.sync.get(TAB_ASSISTANT_RULES).then(res => {
      setDataSource((res[TAB_ASSISTANT_RULES] || []).map((item: DataType, i: number) => ({ ...item, sortIndex: i })))
    })
  }, [])

  const onSortEnd = ({ oldIndex, newIndex }: SortEnd) => {
    if (oldIndex !== newIndex) {
      const newData = arrayMoveImmutable(dataSource.slice(), oldIndex, newIndex).filter(
        (el: DataType) => !!el,
      );
      console.log('Sorted items: ', newData);
      setDataSource(newData);
    }
  };

  const DraggableContainer = (props: SortableContainerProps) => (
    <SortableBody
      useDragHandle
      disableAutoscroll
      helperClass="row-dragging"
      onSortEnd={onSortEnd}
      {...props}
    />
  );

  const DraggableBodyRow: React.FC<any> = ({ className, style, ...restProps }) => {
    // function findIndex base on Table rowKey props and should always be a right array index
    const index = dataSource.findIndex(x => x.sortIndex === restProps['data-row-key']);
    return <SortableItem index={index} {...restProps} />;
  };

  const onFormOk = async () => {
    await form.validateFields()
    const data = form.getFieldsValue()
    chrome.storage.sync.set({ [TAB_ASSISTANT_RULES]: [...dataSource, { ...data, sortIndex: dataSource.length }] })
      .then(() => {
        setDataSource([...dataSource, data])
        setEditData(undefined)
        runRules()
      })
  }

  const runRules = () => {
    var background = chrome.extension.getBackgroundPage()
    console.log('background', background);

    if (background && background.main) background.main()
  }

  return (
    <div className="container">
      <Row style={{ marginBottom: 16 }}>
        <Space>
          <Button type="primary" onClick={() => setEditData({})}>添加规则</Button>
          <Button type="primary" onClick={() => runRules()}>应用规则</Button>
        </Space>
      </Row>
      <Table
        pagination={false}
        dataSource={dataSource}
        columns={columns}
        rowKey="index"
        components={{
          body: {
            wrapper: DraggableContainer,
            row: DraggableBodyRow,
          },
        }}
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
