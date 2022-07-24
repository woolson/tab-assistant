import { ConfigProvider } from 'antd';
import React from 'react';
import { render } from 'react-dom';
import Options from './Options';
import zhCN from 'antd/es/locale/zh_CN';

render(
  <ConfigProvider locale={zhCN}>
    <Options />
  </ConfigProvider>,
  window.document.querySelector('#app-container')
);

if (module.hot) module.hot.accept();
