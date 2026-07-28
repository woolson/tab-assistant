import { message } from "antd"
import { EventNameEnum } from "./const"

/** 重载规则 */
export function reloadConfig(successMessage = '规则更新成功') {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    message.success(successMessage)
    return
  }

  chrome.runtime.sendMessage(EventNameEnum.RELOAD_RULE, res => {
    message.success(successMessage)
  })
}

/** 打开链接 */
export const openLink = (url: string) => {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url })
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}
