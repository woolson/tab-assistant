import React, { useCallback } from 'react';
import Logo from '@/assets/img/icon.svg';
import { Button, Row, Space } from 'antd';

const headStyle = {
  fontSize: 24,
  marginLeft: 10,
  marginTop: 0,
  marginBottom: 0,
  color: '#2E75E5'
}

export const Header = () => {
  const updateGroupStatus = useCallback(async (collapsed: boolean) => {
    const currentWindow = await chrome.windows.getCurrent()
    const existGroups = await chrome.tabGroups.query({ windowId: currentWindow.id })
    existGroups.forEach(group => {
      chrome.tabGroups.update(group.id, { collapsed })
    })
  }, [])

  /** 展开全部分组 */
  const expandAll = useCallback(async () => {
    updateGroupStatus(false);
  }, [])

  /** 展开全部分组 */
  const collapseAll = useCallback(async () => {
    updateGroupStatus(true);
  }, [])

  return (
    <Row
      style={{ padding: '10px 20px 0px 20px' }}
      align="middle"
      justify="space-between">
      <Row align="middle">
        <img src={Logo} style={{ height: 40 }} />
        <h1 style={headStyle}>标签分组助手</h1>
      </Row>

      <Space>
        <Button onClick={expandAll}>全部展开</Button>
        <Button onClick={collapseAll}>全部折叠</Button>
      </Space>
    </Row>
  )
}

export default Header