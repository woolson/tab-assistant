import { message } from "antd"
import { EventNameEnum } from "./const"

/** 重载规则 */
export function reloadConfig() {
  chrome.runtime.sendMessage(EventNameEnum.RELOAD_RULE, res => {
    message.success('规则更新成功')
  })
}