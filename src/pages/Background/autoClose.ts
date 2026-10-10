import { DEFAULT_AUTO_CLOSE_MINUTES, StorageKeyEnum } from "../../common/const"
import { Logger } from "./helpers"
import { TabAssistantConfig } from "./types"

/** 周期检查闲置标签页的 alarm 名称 */
const ALARM_NAME = 'TA_AUTO_CLOSE_IDLE_TABS'
/** 检查周期（分钟），MV3 下 alarm 周期最小为 1 分钟 */
const CHECK_PERIOD_MINUTES = 1

/** tabId -> 最近一次被访问的时间戳（毫秒） */
type LastActiveMap = Record<string, number>

async function getSetting(): Promise<TabAssistantConfig['setting'] | undefined> {
  const storage = await chrome.storage.sync.get(StorageKeyEnum.SETTING)
  return storage[StorageKeyEnum.SETTING]
}

/**
 * 最近访问时间持久化在 chrome.storage.local 中，
 * 这样 Service Worker 被挂起后恢复时计时不会丢失。
 */
async function getLastActiveMap(): Promise<LastActiveMap> {
  const storage = await chrome.storage.local.get(StorageKeyEnum.TAB_LAST_ACTIVE)
  return storage[StorageKeyEnum.TAB_LAST_ACTIVE] || {}
}

async function setLastActiveMap(map: LastActiveMap) {
  await chrome.storage.local.set({ [StorageKeyEnum.TAB_LAST_ACTIVE]: map })
}

/** 刷新某个标签页的最近访问时间，重置其关闭倒计时 */
async function touchTab(tabId: number) {
  const map = await getLastActiveMap()
  map[tabId] = Date.now()
  await setLastActiveMap(map)
}

async function removeTabRecord(tabId: number) {
  const map = await getLastActiveMap()
  if (!(tabId in map)) return
  delete map[tabId]
  await setLastActiveMap(map)
}

/**
 * 与当前打开的标签页对齐访问记录：
 * 1. 清理已关闭标签页的残留记录；
 * 2. 为没有记录的标签页（扩展安装前已打开、浏览器重启等）以当前时间起算，
 *    避免启动后立即被误关。
 */
async function syncTabRecords() {
  const tabs = await chrome.tabs.query({})
  const map = await getLastActiveMap()
  const now = Date.now()
  const next: LastActiveMap = {}
  tabs.forEach(tab => {
    if (typeof tab.id !== 'number') return
    next[tab.id] = tab.active ? now : (map[tab.id] ?? now)
  })
  await setLastActiveMap(next)
}

/** 安全排除项：正在查看、固定、播放声音以及窗口中最后一个标签页不自动关闭 */
function shouldSkipTab(tab: chrome.tabs.Tab, windowTabCount: number) {
  if (tab.active) return true
  if (tab.pinned) return true
  if (tab.audible) return true
  if (windowTabCount <= 1) return true
  return false
}

/** 检查并关闭超过闲置时长的标签页 */
async function sweepIdleTabs() {
  const setting = await getSetting()
  if (!setting?.autoCloseEnabled) return

  const minutes = setting.autoCloseMinutes || DEFAULT_AUTO_CLOSE_MINUTES
  const timeoutMs = minutes * 60 * 1000
  const tabs = await chrome.tabs.query({})
  const map = await getLastActiveMap()
  const now = Date.now()

  const windowTabCount: Record<number, number> = {}
  tabs.forEach(tab => {
    windowTabCount[tab.windowId] = (windowTabCount[tab.windowId] || 0) + 1
  })

  const next: LastActiveMap = {}
  const idleTabIds: number[] = []

  tabs.forEach(tab => {
    if (typeof tab.id !== 'number') return

    // 被排除的标签页视为刚被访问，排除状态解除后重新获得完整倒计时
    if (shouldSkipTab(tab, windowTabCount[tab.windowId] || 0)) {
      next[tab.id] = now
      return
    }

    const lastActive = map[tab.id] ?? now
    if (now - lastActive >= timeoutMs) {
      idleTabIds.push(tab.id)
    } else {
      next[tab.id] = lastActive
    }
  })

  await setLastActiveMap(next)

  if (!idleTabIds.length) return
  Logger.log('自动关闭闲置标签页', idleTabIds)
  await Promise.allSettled(idleTabIds.map(tabId =>
    chrome.tabs.remove(tabId).catch(error => Logger.log('自动关闭标签页失败', tabId, error))
  ))
}

/** 根据设置开启或停止周期检查，设置变更（保存设置后重载）时会再次调用 */
export async function reloadAutoClose() {
  const setting = await getSetting()

  if (!setting?.autoCloseEnabled) {
    await chrome.alarms.clear(ALARM_NAME)
    Logger.log('自动关闭闲置标签页已停用')
    return
  }

  await syncTabRecords()

  const existing = await chrome.alarms.get(ALARM_NAME)
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: CHECK_PERIOD_MINUTES,
      periodInMinutes: CHECK_PERIOD_MINUTES
    })
  }
  Logger.log('自动关闭闲置标签页已启用', setting.autoCloseMinutes || DEFAULT_AUTO_CLOSE_MINUTES, '分钟')
}

/**
 * 在 Service Worker 顶层同步注册监听，
 * 确保 Worker 被挂起后仍能被事件唤醒继续计时和检查。
 */
export function setupAutoClose() {
  chrome.tabs.onActivated.addListener(activeInfo => {
    void touchTab(activeInfo.tabId)
  })

  chrome.windows.onFocusChanged.addListener(windowId => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return
    chrome.tabs.query({ active: true, windowId }).then(([tab]) => {
      if (typeof tab?.id === 'number') return touchTab(tab.id)
    }).catch(error => Logger.log('记录窗口聚焦标签失败', error))
  })

  chrome.tabs.onCreated.addListener(tab => {
    if (typeof tab.id === 'number') void touchTab(tab.id)
  })

  chrome.tabs.onRemoved.addListener(tabId => {
    void removeTabRecord(tabId)
  })

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== ALARM_NAME) return
    void sweepIdleTabs()
  })
}
