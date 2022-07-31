import React from "react"
import { Button, Result } from "antd"
import { GithubOutlined, SmileOutlined } from "@ant-design/icons"
import "./style.less"

export const About = () => {
  return (
    <Result
      className="tab-assistant-about"
      icon={<SmileOutlined />}
      title="标签页助手 TabAssistant"
      subTitle="规则自动化辅助用户管理浏览器标签页"
      extra={[
        <Button
          icon={<GithubOutlined />}
          onClick={() => chrome.tabs.create({ url: "https://github.com/woolson/TabAssistant" })}>
          关于
        </Button>,
      ]}
    />
  )
}

export default About