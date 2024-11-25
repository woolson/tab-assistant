import React, { memo, useEffect, useState } from "react"
import { Button, Form, message, Row, Select, Switch, Tooltip } from "antd"
import { EventNameEnum, StorageKeyEnum } from "../../../common/const"
import { useCallback } from "react"
import { useForm } from "antd/es/form/Form"
import { Logger } from "../../Background/helpers"
import "./style.less"
import { QuestionCircleOutlined } from "@ant-design/icons"
import { TabAssistantConfig } from "@/pages/Background/types"

export const Setting = memo(() => {
  const [form] = useForm<TabAssistantConfig['setting']>()
  const [defaultOptions, setDefaultOptions] = useState([])

  useEffect(() => {
    chrome.storage.sync.get([StorageKeyEnum.SETTING])
      .then(res => {
        Logger.log('setting', res?.[StorageKeyEnum.SETTING])
        if (res?.[StorageKeyEnum.SETTING]) {
          setDefaultOptions(res?.[StorageKeyEnum.SETTING]?.removeKeywordList?.map((o: string) => ({ value: o, label: o })))
        }
        form.setFieldsValue({ ...(res?.[StorageKeyEnum.SETTING] || {}) })
      })
  }, [])

  const onFinish = useCallback(async (formValue) => {
    Logger.log('modify setting', formValue);

    await chrome.storage.sync.set({ [StorageKeyEnum.SETTING]: formValue })
    chrome.runtime.sendMessage(EventNameEnum.RELOAD_RULE, response => {
      if (response === EventNameEnum.RELOAD_SUCC) {
        message.success('更新成功')
      }
    })
  }, [])

  return (
    <div className="tab-assistant-setting">
      <Form form={form} onFinish={onFinish}>
        <Form.Item
          label="分组名忽略词"
          name="removeKeywordList"
          extra="以域名命名分组时，会移除域名中对应的关键词，如：www.xxx.com 转换为 xxx.com。">
          <Select
            allowClear
            open={false}
            mode="tags"
            placeholder="输入自定义标签，按 Enter 确认"
            style={{ width: "100%" }}
            options={defaultOptions}
          />
        </Form.Item>

        <Row justify="end">
          <Button htmlType="submit" type="primary">保存</Button>
        </Row>
      </Form>
    </div>
  )
})

export default Setting