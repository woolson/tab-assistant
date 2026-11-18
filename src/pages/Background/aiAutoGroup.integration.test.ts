/**
 * 用假的 chrome API 跑通新标签页的放置流程，
 * 验证没有 API 配置时，同站和跨站标签都保持未分组。
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
// 未配置 API：保持未分组，不走域名兜底。

const { watchNewTabForAiGrouping } = await import('./aiAutoGroup.ts')

function seedTab(tab: Partial<FakeTab> & { id: number; url: string }): FakeTab {
  const full: FakeTab = { title: tab.url, groupId: UNGROUPED, windowId: 1, ...tab } as FakeTab
  tabStore.set(full.id, full)
  return full
}

interface Recorder extends AiGroupingHost {
  joined: number[]
  created: string[]
  domainGrouped: number
}

function createHost(): Recorder {
  const joined: number[] = []
  const created: string[] = []
  const host: Recorder = {
    joined,
    created,
    domainGrouped: 0,
    isDisposed: () => false,
    hasManualTabHold: () => false,
    shouldUseExistingGrouping: () => false,
    groupTabWithExistingRules: async () => { host.domainGrouped += 1 },
    joinTabToGroup: async (_tab, groupId) => { joined.push(groupId) },
    createGroupForTab: async (_tab, title) => { created.push(title) },
    releaseInitialDecision: () => {},
  }
  return host
}

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('a tab opened from a grouped same-site page remains ungrouped without a model', async () => {
  tabStore.clear()
  resetNavigationLinks()
  seedTab({ id: 1, url: 'https://github.com/woolson/tab-assistant', groupId: 7 })
  const newTab = seedTab({ id: 2, url: 'https://github.com/woolson/tab-assistant/issues' })

  // 模拟 rel="noopener"：openerTabId 缺失，只能靠 webNavigation 记录
  rememberNavigationLink(2, { sourceTabId: 1, sourceFrameId: 0, url: newTab.url, at: Date.now() })

  const host = createHost()
  watchNewTabForAiGrouping(host, newTab as unknown as chrome.tabs.Tab)
  await tick(50)

  assert.deepEqual(host.joined, [])
  assert.deepEqual(host.created, [])
  assert.equal(host.domainGrouped, 0)
})

test('a cross-site link is not forced into the opener group, and stays ungrouped without a model', async () => {
  tabStore.clear()
  resetNavigationLinks()
  seedTab({ id: 1, url: 'https://github.com/woolson/tab-assistant', groupId: 7 })
  const newTab = seedTab({ id: 2, url: 'https://news.ycombinator.com/item?id=1' })
  rememberNavigationLink(2, { sourceTabId: 1, sourceFrameId: 0, url: newTab.url, at: Date.now() })

  const host = createHost()
  watchNewTabForAiGrouping(host, newTab as unknown as chrome.tabs.Tab)
  await tick(300)

  assert.deepEqual(host.joined, [])
  assert.deepEqual(host.created, [])
  assert.equal(host.domainGrouped, 0)
})

test('an ungrouped opener does not invent a model group, and the new tab remains ungrouped', async () => {
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
  assert.equal(host.domainGrouped, 0)
})
