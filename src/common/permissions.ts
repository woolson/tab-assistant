/**
 * 点击来源采集所需的可选主机权限。
 *
 * `<all_urls>` 写在 manifest 的 `optional_host_permissions` 里，
 * 只有用户在规则页主动打开内容采集开关时才会申请，因此安装时不出现「读取所有网站数据」。
 */

/** 只有 https / http 页面需要采集，其余协议本来也拿不到点击。 */
export const CLICK_SOURCE_ORIGINS = ['<all_urls>']

function hasPermissionsApi() {
  return typeof chrome !== 'undefined' && Boolean(chrome.permissions)
}

/** `@types/chrome` 里这些 API 只有回调式签名，这里统一包成 Promise。 */
function callWithCallback(
  invoke: (callback: (value: boolean) => void) => void,
): Promise<boolean> {
  return new Promise(resolve => {
    try {
      invoke(value => resolve(Boolean(value)))
    } catch (error) {
      resolve(false)
    }
  })
}

export function queryClickSourcePermission(): Promise<boolean> {
  if (!hasPermissionsApi()) return Promise.resolve(false)
  return callWithCallback(callback => {
    chrome.permissions.contains({ origins: CLICK_SOURCE_ORIGINS }, callback)
  })
}

/**
 * 必须在用户手势（点击开关）的同一次调用里执行，否则 Chrome 会拒绝。
 */
export function requestClickSourcePermission(): Promise<boolean> {
  if (!hasPermissionsApi()) return Promise.resolve(false)
  return callWithCallback(callback => {
    chrome.permissions.request({ origins: CLICK_SOURCE_ORIGINS }, callback)
  })
}

export function removeClickSourcePermission(): Promise<boolean> {
  if (!hasPermissionsApi()) return Promise.resolve(false)
  return callWithCallback(callback => {
    chrome.permissions.remove({ origins: CLICK_SOURCE_ORIGINS }, callback)
  })
}
