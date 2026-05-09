import React from 'react';
import Logo from '@/assets/img/icon.svg';
import { Row, theme } from 'antd';

const headStyle = {
  fontSize: 24,
  marginLeft: 10,
  marginTop: 0,
  marginBottom: 0,
  color: '#2E75E5'
}

export const Header = () => {
  const { token } = theme.useToken();

  return (
    <Row
      style={{ padding: '10px 20px 0px 20px' }}
      align="middle"
      justify="space-between">
      <Row align="middle">
        <img src={Logo} style={{ height: 40 }} />
        <h1 style={headStyle}>TabAssistant 标签分组助手</h1>
      </Row>
    </Row>
  )
}

export default Header
