import {
  GROUPING_PREFERENCES_KEY, mergeGroupingPreference, preferencePageUrl, readGroupingPreferences,
  isCredentialPreferenceUrl,
  type GroupingPreference,
} from '../../common/groupingPreferences'
import { readRealUrl } from './aiAutoGroupDecision'
import { Logger } from './helpers'

interface AutomaticChange {
  expected?: number
  pending: boolean
  matched: Set<number>
  expiresAt: number
  observed: Array<{ tabId: number; groupId: number; manual: () => void }>
}

const automaticChanges = new Map<number, AutomaticChange>()

/** 标记具体标签的预期变化，不能用“最近自动操作过”屏蔽其他标签的手动修改。 */
export async function groupTabsAutomatically(options: { tabIds: number | number[]; groupId?: number; createProperties?: { windowId: number } }): Promise<number> {
  const ids = Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds]
  const marker: AutomaticChange = { expected: options.groupId, pending: true, matched: new Set(), expiresAt: Date.now() + 10_000, observed: [] }
  ids.forEach(id => automaticChanges.set(id, marker))
  try {
    const groupId = await chrome.tabs.group(options)
    marker.expected = groupId
    marker.pending = false
    for (const event of marker.observed) {
      if (event.groupId !== groupId) event.manual()
      else marker.matched.add(event.tabId)
    }
    ids.forEach(id => { if (marker.matched.has(id) && automaticChanges.get(id) === marker) automaticChanges.delete(id) })
    return groupId
  } catch (error) {
    ids.forEach(id => { if (automaticChanges.get(id) === marker) automaticChanges.delete(id) })
    throw error
  }
}

export function consumeAutomaticGroupChange(tabId: number, groupId: number, manual: () => void): boolean {
  const marker = automaticChanges.get(tabId)
  if (!marker) return false
  if (Date.now() > marker.expiresAt) { automaticChanges.delete(tabId); return false }
  if (marker.expected === undefined && marker.pending) {
    marker.observed.push({ tabId, groupId, manual })
    // API 回包给出新组 ID 后，再区分自己的事件和期间发生的手动事件。
    return true
  }
  if (marker.expected === groupId) {
    marker.matched.add(tabId)
    if (!marker.pending) automaticChanges.delete(tabId)
    return true
  }
  if (!marker.pending) automaticChanges.delete(tabId)
  return false
}

interface PendingChoice {
  timer: ReturnType<typeof setTimeout>
  done: Promise<void>
  resolve: () => void
  fromTitle?: string
}
const pendingChoices = new Map<number, PendingChoice>()
let writeQueue: Promise<void> = Promise.resolve()
let version = 0

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const run = writeQueue.then(task)
  writeQueue = run.catch(error => Logger.log('保存手动分组偏好失败', error))
  return run
}

async function learningEnabled() {
  const stored = await chrome.storage.sync.get('TA_SETTING')
  return stored.TA_SETTING?.aiAutoGroupEnabled === true
}

export function recordManualGroupingChoice(tabId: number, groupId: number, fromTitle?: string, tabAtEvent?: chrome.tabs.Tab) {
  const previous = pendingChoices.get(tabId)
  if (previous) { clearTimeout(previous.timer); previous.resolve() }
  const generation = version
  const initial = tabAtEvent ? Promise.resolve(tabAtEvent) : chrome.tabs.get(tabId).catch(() => undefined)
  let resolve!: () => void
  const done = new Promise<void>(finish => { resolve = finish })
  const choice: PendingChoice = { timer: undefined as unknown as ReturnType<typeof setTimeout>, done, resolve, fromTitle: previous?.fromTitle || fromTitle }
  pendingChoices.set(tabId, choice)
  choice.timer = setTimeout(() => {
    void (async () => {
      try {
        const before = await initial
        const tab = await chrome.tabs.get(tabId)
        const rawUrl = readRealUrl(tab) || ''
        const url = isCredentialPreferenceUrl(rawUrl) ? undefined : preferencePageUrl(rawUrl)
        const beforeUrl = before && preferencePageUrl(readRealUrl(before) || '')
        if (!url || tab.pinned || tab.groupId !== groupId || beforeUrl && beforeUrl !== url || before && before.windowId !== tab.windowId || pendingChoices.get(tabId) !== choice || generation !== version) return
        const group = groupId === -1 ? undefined : await chrome.tabGroups.get(groupId)
        const title = group?.title?.trim()
        if (groupId !== -1 && !title) return
        await enqueueWrite(async () => {
          if (generation !== version || pendingChoices.get(tabId) !== choice || !await learningEnabled()) return
          const stored = await chrome.storage.local.get(GROUPING_PREFERENCES_KEY)
          if (generation !== version || pendingChoices.get(tabId) !== choice) return
          const next = mergeGroupingPreference(readGroupingPreferences(stored[GROUPING_PREFERENCES_KEY]), {
            url, title: tab.title || '', choice: groupId === -1 ? 'ungrouped' : 'group',
            ...(title ? { groupTitle: title } : {}),
            ...(choice.fromTitle && choice.fromTitle !== title ? { avoidedGroupTitle: choice.fromTitle } : {}), updatedAt: Date.now(),
          })
          await chrome.storage.local.set({ [GROUPING_PREFERENCES_KEY]: next })
        })
      } catch { /* 页面或分组可能已关闭，不从已消失的对象推导习惯。 */ }
      finally { if (pendingChoices.get(tabId) === choice) pendingChoices.delete(tabId); resolve() }
    })()
  }, 250)
}

export function cancelPendingGroupingChoice(tabId: number) {
  const pending = pendingChoices.get(tabId)
  if (pending) { clearTimeout(pending.timer); pending.resolve(); pendingChoices.delete(tabId) }
}

export function forgetGroupingPreferenceTab(tabId: number) {
  cancelPendingGroupingChoice(tabId)
  automaticChanges.delete(tabId)
}

export async function loadGroupingPreferences(): Promise<GroupingPreference[]> {
  while (pendingChoices.size) await Promise.all(Array.from(pendingChoices.values()).map(choice => choice.done))
  await writeQueue
  try {
    const stored = await chrome.storage.local.get(GROUPING_PREFERENCES_KEY)
    return readGroupingPreferences(stored[GROUPING_PREFERENCES_KEY])
  } catch { return [] }
}

export function groupingPreferenceVersion() { return version }

export async function clearGroupingPreferences() {
  version++
  Array.from(pendingChoices.keys()).forEach(cancelPendingGroupingChoice)
  await enqueueWrite(() => chrome.storage.local.set({ [GROUPING_PREFERENCES_KEY]: [] }))
}
