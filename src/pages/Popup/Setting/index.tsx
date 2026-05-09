import React, { memo, useEffect, useState } from "react"
import { Button, Form, message, Row, Segmented, Select } from "antd"
import { EventNameEnum, StorageKeyEnum } from "../../../common/const"
import { useCallback } from "react"
import { useForm } from "antd/es/form/Form"
import { Logger } from "../../Background/helpers"
import "./style.less"
import { TabAssistantConfig } from "@/pages/Background/types"
import { languageOptions, useI18n } from "@/common/i18n"

export const Setting = memo(() => {
  const [form] = useForm<TabAssistantConfig['setting']>()
  const [defaultOptions, setDefaultOptions] = useState([])
  const { language, setLanguage, t } = useI18n();

  useEffect(() => {
    chrome.storage.sync.get([StorageKeyEnum.SETTING])
      .then(res => {
        Logger.log('setting', res?.[StorageKeyEnum.SETTING])
        if (res?.[StorageKeyEnum.SETTING]) {
          setDefaultOptions(res?.[StorageKeyEnum.SETTING]?.removeKeywordList?.map((o: string) => ({ value: o, label: o })))
        }
        form.setFieldsValue({ language, ...(res?.[StorageKeyEnum.SETTING] || {}) })
      })
  }, [form, language])

  const onFinish = useCallback(async (formValue) => {
    Logger.log('modify setting', formValue);

    await chrome.storage.sync.set({ [StorageKeyEnum.SETTING]: formValue })
    if (formValue.language) setLanguage(formValue.language)
    chrome.runtime.sendMessage(EventNameEnum.RELOAD_RULE, response => {
      if (response === EventNameEnum.RELOAD_SUCC) {
        message.success(t('updateSuccess'))
      }
    })
  }, [setLanguage, t])

  return (
    <div className="tab-assistant-setting">
      <Form
        form={form}
        onFinish={onFinish}
        labelAlign="right"
        labelCol={{ flex: '180px' }}
      >
        <Form.Item
          label={t('languageSetting')}
          name="language"
          extra={t('languageSettingExtra')}>
          <Segmented
            options={languageOptions.map(option => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </Form.Item>

        <Form.Item
          label={t('groupNameIgnoreWords')}
          name="removeKeywordList"
          extra={t('groupNameIgnoreWordsExtra')}>
          <Select
            allowClear
            open={false}
            mode="tags"
            placeholder={t('ignoreWordsPlaceholder')}
            style={{ width: "100%" }}
            options={defaultOptions}
          />
        </Form.Item>

        <Row justify="end">
          <Button htmlType="submit" type="primary">{t('save')}</Button>
        </Row>
      </Form>
    </div>
  )
})

export default Setting
