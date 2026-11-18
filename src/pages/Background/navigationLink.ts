/**
 * 记录「新标签页是被哪个标签页打开的」这一层关系。
 *
 * `chrome.tabs.Tab.openerTabId` 在 `rel="noopener"`、部分 `window.open`
 * 以及跨进程打开的场景下是空的，而 `chrome.webNavigation.onCreatedNavigationTarget`
 * 仍然能给出 `sourceTabId`。这里只保存最近的关联，过期即丢弃，
 * 不落盘、不上报。
 */

import { UNGROUPED_GROUP_ID, readRealUrl, registrableDomain } from "./aiAutoGroupDecision"

/** 关联记录只在很短的时间内有效，超时说明不是同一次点击。 */
export const NAVIGATION_LINK_TTL_MS = 5_000

export interface NavigationLink {
  /** 触发这次导航的标签页；缺失表示来源未知（如手动粘贴地址、书签打开） */
  sourceTabId?: number
  /** 触发导航的 frame，0 为主框架 */
  sourceFrameId?: number
  /** 被打开的地址 */
  url: string
  at: number
}

/** tabId -> 打开它的来源信息。Service Worker 挂起后自然丢失，符合预期。 */
const links = new Map<number, NavigationLink>()

export function rememberNavigationLink(tabId: number, link: NavigationLink) {
  if (!Number.isInteger(tabId) || tabId < 0) return
  links.set(tabId, link)
}

/**
 * 读取关联记录，顺带清理过期项。
 * `now` 可注入，方便单测在不等待的情况下验证过期行为。
 */
export function readNavigationLink(tabId: number, now = Date.now()): NavigationLink | undefined {
  const link = links.get(tabId)
  if (!link) return undefined
  if (now - link.at > NAVIGATION_LINK_TTL_MS) {
    links.delete(tabId)
    return undefined
  }
  return link
}

export function forgetNavigationLink(tabId: number) {
  links.delete(tabId)
}

/** 仅供测试与配置重载时清空。 */
export function resetNavigationLinks() {
  links.clear()
}

/** 只比较 http/https 的主域名，浏览器内置页面和 file:// 不参与关联。 */
export function registrableSite(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
    if (!host) return undefined
    return registrableDomain(host) || undefined
  } catch (error) {
    return undefined
  }
}

export interface OpenerTabLike {
  url?: string
  pendingUrl?: string
  groupId?: number
}

/**
 * 覆盖率最高、误判率最低的一条先验：
 * 来源标签已经在某个分组里，且新页面与来源页同属一个主域名，
 * 那么用户几乎必然希望新页面留在这个分组里，不必再问模型。
 *
 * 主域名不同时不作判断，交回模型或后续回退逻辑，
 * 避免把「从分组里点出去的站外链接」误塞回原分组。
 */
export function pickOpenerGroupId(
  opener: OpenerTabLike | undefined,
  targetUrl: string | undefined,
): number | undefined {
  if (!opener || !targetUrl) return undefined

  const groupId = opener.groupId
  if (typeof groupId !== 'number' || !Number.isInteger(groupId) || groupId === UNGROUPED_GROUP_ID) {
    return undefined
  }

  const openerUrl = readRealUrl(opener)
  if (!openerUrl) return undefined

  const openerSite = registrableSite(openerUrl)
  const targetSite = registrableSite(targetUrl)
  if (!openerSite || openerSite !== targetSite) return undefined

  return groupId
}
