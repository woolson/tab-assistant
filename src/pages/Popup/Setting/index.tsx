import React, { memo, useEffect } from "react"
import { Button, Form, message, Switch } from "antd"
import { EventNameEnum, StorageKeyEnum } from "../../../common/const"
import { useCallback } from "react"
import { useForm } from "antd/es/form/Form"
import { Logger } from "../../Background/helpers"
import "./style.less"

export const Setting = memo(() => {
  const [form] = useForm()

  useEffect(() => {
    chrome.storage.sync.get([StorageKeyEnum.SETTING])
      .then(res => {
        Logger.log('setting', res?.[StorageKeyEnum.SETTING])
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
        <Form.Item label="移除www." name="remove3w" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Form.Item>
          <Button htmlType="submit" type="primary">保存</Button>
        </Form.Item>
      </Form>
    </div>
  )
})

export default Setting