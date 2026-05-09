import React from "react"
import { Result } from "antd"
import { useI18n } from "@/common/i18n";

export const Useful = () => {
  const { t } = useI18n();

  return (
    <Result
      className="tab-assistant-about"
      subTitle={t('appDescription')}
    />
  )
}

export default Useful
