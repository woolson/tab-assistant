import { message } from "antd"
import { EventNameEnum } from "./const"

/** 重载规则 */
export function reloadConfig(successMessage = '规则更新成功') {
  chrome.runtime.sendMessage(EventNameEnum.RELOAD_RULE, res => {
    message.success(successMessage)
  })
}

/** 打开链接 */
export const openLink = (url: string) => {
  chrome.tabs.create({ url })
}
