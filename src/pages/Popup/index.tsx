import { ConfigProvider } from 'antd';
import React from 'react';
import { render } from 'react-dom';
import zhCN from 'antd/es/locale/zh_CN';

import Popup from './Popup';

render(
  <ConfigProvider locale={zhCN}>
    <Popup />
  </ConfigProvider>,
  window.document.querySelector('#app-container')
);

if (module.hot) module.hot.accept();
