import { message } from "antd"
import { EventNameEnum } from "./const"

/** 重载规则；传 null 时静默重载。 */
export function reloadConfig(successMessage: string | null = '规则更新成功') {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    if (successMessage) message.success(successMessage)
    return
  }

  chrome.runtime.sendMessage(EventNameEnum.RELOAD_RULE, res => {
    if (successMessage) message.success(successMessage)
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
