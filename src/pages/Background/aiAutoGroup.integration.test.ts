/**
 * 用假的 chrome API 跑通新标签页的放置流程，
 * 重点验证「来源标签已分组 + 同站」时完全不碰设备端模型。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { AiGroupingHost } from './aiAutoGroup.ts'
import { rememberNavigationLink, resetNavigationLinks } from './navigationLink.ts'

const UNGROUPED = -1

interface FakeTab {
  id: number
  url: string
  title: string
  groupId: number
  windowId: number
  pinned?: boolean
  openerTabId?: number
}

const tabStore = new Map<number, FakeTab>()
const listeners = { updated: new Set<(id: number) => void>(), removed: new Set<(id: number) => void>() }

;(globalThis as any).chrome = {
  tabGroups: {
    TAB_GROUP_ID_NONE: UNGROUPED,
    query: async () => [],
  },
  tabs: {
    get: async (id: number) => {
      const tab = tabStore.get(id)
      if (!tab) throw new Error(`no tab ${id}`)
      return { ...tab }
    },
    query: async () => [...tabStore.values()].map(tab => ({ ...tab })),
    onUpdated: {
      addListener: (fn: any) => listeners.updated.add(fn),
      removeListener: (fn: any) => listeners.updated.delete(fn),
    },
    onRemoved: {
      addListener: (fn: any) => listeners.removed.add(fn),
      removeListener: (fn: any) => listeners.removed.delete(fn),
    },
  },
}
// 明确没有设备端模型
delete (globalThis as any).LanguageModel

const { watchNewTabForAiGrouping } = await import('./aiAutoGroup.ts')

function seedTab(tab: Partial<FakeTab> & { id: number; url: string }): FakeTab {
  const full: FakeTab = { title: tab.url, groupId: UNGROUPED, windowId: 1, ...tab } as FakeTab
  tabStore.set(full.id, full)
  return full
}

interface Recorder extends AiGroupingHost {
  joined: number[]
  created: string[]
}

function createHost(): Recorder {
  const joined: number[] = []
  const created: string[] = []
  return {
    joined,
    created,
    isDisposed: () => false,
    hasManualTabHold: () => false,
    shouldUseExistingGrouping: () => false,
    groupTabWithExistingRules: async () => {},
    joinTabToGroup: async (_tab, groupId) => { joined.push(groupId) },
    createGroupForTab: async (_tab, title) => { created.push(title) },
    releaseInitialDecision: () => {},
  }
}

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('a tab opened from a grouped same-site page joins that group without the model', async () => {
  tabStore.clear()
  resetNavigationLinks()
  seedTab({ id: 1, url: 'https://github.com/woolson/tab-assistant', groupId: 7 })
  const newTab = seedTab({ id: 2, url: 'https://github.com/woolson/tab-assistant/issues' })

  // 模拟 rel="noopener"：openerTabId 缺失，只能靠 webNavigation 记录
  rememberNavigationLink(2, { sourceTabId: 1, sourceFrameId: 0, url: newTab.url, at: Date.now() })

  const host = createHost()
  watchNewTabForAiGrouping(host, newTab as unknown as chrome.tabs.Tab)
  await tick(50)

  assert.deepEqual(host.joined, [7])
  assert.deepEqual(host.created, [])
})

test('a cross-site link is left to the model instead of being forced into the opener group', async () => {
  tabStore.clear()
  resetNavigationLinks()
  seedTab({ id: 1, url: 'https://github.com/woolson/tab-assistant', groupId: 7 })
  const newTab = seedTab({ id: 2, url: 'https://news.ycombinator.com/item?id=1' })
  rememberNavigationLink(2, { sourceTabId: 1, sourceFrameId: 0, url: newTab.url, at: Date.now() })

  const host = createHost()
  watchNewTabForAiGrouping(host, newTab as unknown as chrome.tabs.Tab)
  await tick(300)

  // 没有设备端模型可用，跨站时既不归组也不新建
  assert.deepEqual(host.joined, [])
  assert.deepEqual(host.created, [])
})

test('an ungrouped opener keeps the previous behaviour', async () => {
  tabStore.clear()
  resetNavigationLinks()
  seedTab({ id: 1, url: 'https://github.com/woolson/tab-assistant' })
  const newTab = seedTab({ id: 2, url: 'https://github.com/woolson/tab-assistant/issues' })
  rememberNavigationLink(2, { sourceTabId: 1, sourceFrameId: 0, url: newTab.url, at: Date.now() })

  const host = createHost()
  watchNewTabForAiGrouping(host, newTab as unknown as chrome.tabs.Tab)
  await tick(300)

  assert.equal(host.joined.includes(UNGROUPED), false)
  assert.deepEqual(host.created, [])
})
