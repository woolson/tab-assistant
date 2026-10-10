import { DEFAULT_AUTO_CLOSE_MINUTES, StorageKeyEnum } from "../../common/const"
import { Logger } from "./helpers"
import { TabAssistantConfig } from "./types"

/** 周期检查闲置标签页的 alarm 名称 */
const ALARM_NAME = 'TA_AUTO_CLOSE_IDLE_TABS'
/** 检查周期（分钟），MV3 下 alarm 周期最小为 1 分钟 */
const CHECK_PERIOD_MINUTES = 1
/** 仅自动关闭普通网页，浏览器内置页面（新标签页、设置页等）和扩展页面永不关闭 */
const CLOSABLE_URL_PATTERN = /^(https?|file):/i

/** tabId -> 最近一次被访问的时间戳（毫秒） */
type LastActiveMap = Record<string, number>

/**
 * 所有对访问记录的读改写都经由该队列串行执行。
 * 事件回调（激活、聚焦、关闭）与周期检查、Worker 唤醒时的记录对齐会并发触发，
 * 不串行化会出现"丢失更新"：旧快照把刚刷新的访问时间写回覆盖，
 * 导致活动标签失去保护或闲置标签的倒计时被反复清零。
 */
let recordTaskQueue: Promise<unknown> = Promise.resolve()
function enqueueRecordTask<T>(task: () => Promise<T>): Promise<T> {
  const run = recordTaskQueue.then(task)
  recordTaskQueue = run.catch(error => Logger.log('自动关闭后台任务失败', error))
  return run
}

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

/** 刷新标签页的最近访问时间，重置其关闭倒计时 */
function touchTabs(tabIds: number[]) {
  if (!tabIds.length) return Promise.resolve()
  return enqueueRecordTask(async () => {
    const map = await getLastActiveMap()
    const now = Date.now()
    tabIds.forEach(tabId => { map[tabId] = now })
    await setLastActiveMap(map)
  })
}

function removeTabRecord(tabId: number) {
  return enqueueRecordTask(async () => {
    const map = await getLastActiveMap()
    if (!(tabId in map)) return
    delete map[tabId]
    await setLastActiveMap(map)
  })
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

/**
 * 安全排除项：
 * 1. 任意窗口中正在查看（active）或被选中（highlighted）的标签页；
 * 2. 固定的标签页；
 * 3. 正在播放声音的标签页；
 * 4. 窗口中最后一个标签页；
 * 5. 非普通网页（非 http/https/file，如新标签页、设置页、扩展页面）。
 */
function shouldSkipTab(tab: chrome.tabs.Tab, windowTabCount: number) {
  if (tab.active || tab.highlighted) return true
  if (tab.pinned) return true
  if (tab.audible) return true
  if (windowTabCount <= 1) return true
  if (!CLOSABLE_URL_PATTERN.test(tab.url || '')) return true
  return false
}

/**
 * 关闭前重新读取标签状态做最终复核，
 * 避免检查与关闭之间状态变化（如用户刚切换过去）导致误关正在查看的标签页。
 */
async function closeTabIfStillInactive(tabId: number) {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab.active || tab.highlighted || tab.pinned || tab.audible) return
    await chrome.tabs.remove(tabId)
  } catch (error) {
    Logger.log('自动关闭标签页失败', tabId, error)
  }
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

    // Chrome 121+ 提供 lastAccessed（最近一次被选中的时间），作为扩展自身记录的补充依据
    const lastAccessed = (tab as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed || 0
    const lastActive = Math.max(map[tab.id] || 0, lastAccessed) || now
    if (now - lastActive >= timeoutMs) {
      idleTabIds.push(tab.id)
    } else {
      next[tab.id] = lastActive
    }
  })

  await setLastActiveMap(next)

  if (!idleTabIds.length) return
  Logger.log('自动关闭闲置标签页', idleTabIds)
  await Promise.all(idleTabIds.map(tabId => closeTabIfStillInactive(tabId)))
}

/** 根据设置开启或停止周期检查，设置变更（保存设置后重载）时会再次调用 */
export async function reloadAutoClose() {
  const setting = await getSetting()

  if (!setting?.autoCloseEnabled) {
    await chrome.alarms.clear(ALARM_NAME)
    Logger.log('自动关闭闲置标签页已停用')
    return
  }

  await enqueueRecordTask(syncTabRecords)

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
    void touchTabs([activeInfo.tabId])
  })

  chrome.tabs.onHighlighted.addListener(highlightInfo => {
    void touchTabs(highlightInfo.tabIds)
  })

  chrome.windows.onFocusChanged.addListener(windowId => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return
    chrome.tabs.query({ active: true, windowId }).then(([tab]) => {
      if (typeof tab?.id === 'number') return touchTabs([tab.id])
    }).catch(error => Logger.log('记录窗口聚焦标签失败', error))
  })

  chrome.tabs.onCreated.addListener(tab => {
    if (typeof tab.id === 'number') void touchTabs([tab.id])
  })

  chrome.tabs.onRemoved.addListener(tabId => {
    void removeTabRecord(tabId)
  })

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== ALARM_NAME) return
    void enqueueRecordTask(sweepIdleTabs)
  })
}
