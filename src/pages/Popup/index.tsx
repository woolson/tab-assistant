import { Button, ConfigProvider, Row, Tabs } from 'antd';
import React from 'react';
import { render } from 'react-dom';
import zhCN from 'antd/es/locale/zh_CN';
import Logo from '@/assets/img/icon.svg';
import Rules from './Rules';
import About from './About';
import Setting from './Setting';
import './index.less';

const items = [
  {
    key: '1',
    label: '分组规则',
    children: <Rules />,
  },
  {
    key: '2',
    label: '设置',
    children: <Setting />,
  },
  {
    key: '3',
    label: '关于',
    children: <About />,
  },
];

render(
  <ConfigProvider locale={zhCN}>
    <Row style={{ paddingLeft: 20, paddingTop: 10 }}>
      <img src={Logo} style={{ height: 40 }} />
      <h1 style={{ marginLeft: 10, marginTop: 0, marginBottom: 0, color: '#2E75E5' }}>标签分组助手</h1>
    </Row>

    <Tabs
      type="card"
      style={{ marginTop: 20 }}
      defaultActiveKey="1"
      // size="large"
      tabBarStyle={{ paddingLeft: 20, paddingRight: 20 }}
      // tabBarExtraContent={
      //   <Button icon={<SyncOutlined />} onClick={reloadConfig}>
      //     应用规则和设置
      //   </Button>
      // }
      items={items}
    />
  </ConfigProvider>,
  window.document.querySelector('#app-container')
);

if (module.hot) module.hot.accept();
