import { Button, ConfigProvider, Tabs } from 'antd';
import React from 'react';
import { render } from 'react-dom';
import zhCN from 'antd/es/locale/zh_CN';
import { reloadConfig } from '@/common';
import { SyncOutlined } from '@ant-design/icons';
import Rules from './Rules';
import About from './About';
import Setting from './Setting';
import './index.less';

render(
  <ConfigProvider locale={zhCN}>
    <Tabs
      size="large"
      tabBarStyle={{ paddingLeft: 20, paddingRight: 20 }}
      tabBarExtraContent={
        <Button icon={<SyncOutlined />} onClick={reloadConfig}>应用规则和设置</Button>
      }>
      <Tabs.TabPane tab="分组规则" key="1">
        <Rules />
      </Tabs.TabPane>

      <Tabs.TabPane tab="设置" key="2">
        <Setting />
      </Tabs.TabPane>

      <Tabs.TabPane tab="关于" key="3">
        <About />
      </Tabs.TabPane>
    </Tabs>
  </ConfigProvider>,
  window.document.querySelector('#app-container')
);

if (module.hot) module.hot.accept();
