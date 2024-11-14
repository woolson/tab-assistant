import React from "react"
import { Button, Result } from "antd"
import { GithubOutlined, SmileOutlined } from "@ant-design/icons"
import Icon from '@/assets/img/icon.svg';
import "./style.less"

export const About = () => {
  return (
    <Result
      className="tab-assistant-about"
      icon={<img src={Icon} width={130} />}
      title={<h3 style={{ margin: '0' }}>标签分组助手</h3>}
      subTitle="规则自动化分组浏览器标签页"
      extra={[
        <Button
          key="about"
          icon={<GithubOutlined />}
          onClick={() => chrome.tabs.create({ url: "https://github.com/woolson/TabAssistant" })}>
          关于
        </Button>,
      ]}
    />
  )
}

export default About