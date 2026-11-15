import { defaultAiApiConfig } from '../../common/aiApi.ts'
/**
 * 验证点击来源真的进入了提示词。
 * 用模拟 API 捕获 payload，断言 source.clicked 的内容与清洗结果。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeClickGesture, rememberClickGesture, resetClickGestures } from './clickGesture.ts'

const UNGROUPED = -1

const tabStore = new Map<number, any>()
const listeners = { updated: new Set<(id: number) => void>(), removed: new Set<(id: number) => void>() }
const prompts: string[] = []

;(globalThis as any).chrome = {
  tabGroups: { TAB_GROUP_ID_NONE: UNGROUPED, query: async () => [] },
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

let reply = '{"action":"leave"}'
let contentReads = 0
;(globalThis as any).chrome.scripting = { executeScript: async () => {
  contentReads += 1
  return [{ result: { description: '比较显示器的色彩与价格', headings: ['显示器评测'], excerpt: '适合设计工作的显示器' } }]
} }
const systems: string[] = []
;(globalThis as any).chrome.permissions = { contains: (_permissions: any, callback: any) => callback(true) }
;(globalThis as any).chrome.runtime = {}
;(globalThis as any).fetch = async (_url: string, init: any) => {
  const body = JSON.parse(init.body)
  prompts.push(body.messages[1].content)
  systems.push(body.messages[0].content)
  return { ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) }
}

const { watchNewTabForAiGrouping } = await import('./aiAutoGroup.ts')

function seedTab(tab: any) {
  tabStore.set(tab.id, { title: tab.url, groupId: UNGROUPED, windowId: 1, ...tab })
  return tabStore.get(tab.id)
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return false
}

function createHost() {
  const joined: number[] = []
  return {
    joined,
    getAiApiConfig: () => ({ ...defaultAiApiConfig(), apiKey: 'test-key' }),
    isDisposed: () => false,
    hasManualTabHold: () => false,
    shouldUseExistingGrouping: () => false,
    groupTabWithExistingRules: async () => {},
    joinTabToGroup: async (_tab: any, groupId: number) => { joined.push(groupId) },
    createGroupForTab: async () => {},
    releaseInitialDecision: () => {},
  }
}

test('the model sees which element the user clicked', async () => {
  tabStore.clear()
  resetClickGestures()
  prompts.length = 0
  seedTab({ id: 1, url: 'https://github.com/woolson/tab-assistant', title: 'woolson/tab-assistant' })
  const newTab = seedTab({
    id: 2,
    url: 'https://github.com/woolson/tab-assistant/issues',
    openerTabId: 1,
  })

  rememberClickGesture(
    1,
    normalizeClickGesture({
      tag: 'a',
      href: 'https://github.com/woolson/tab-assistant/issues',
      text: 'Issues',
      section: 'woolson/tab-assistant',
    }) as any,
  )

  watchNewTabForAiGrouping(createHost() as any, newTab)
  assert.equal(await waitFor(() => prompts.length > 0), true)

  const payload = JSON.parse(prompts[0])
  assert.equal(payload.source.url, 'https://github.com/woolson/tab-assistant')
  assert.equal(payload.source.clicked.text, 'Issues')
  assert.equal(payload.source.clicked.tag, 'a')
  assert.equal(payload.source.clicked.href, 'https://github.com/woolson/tab-assistant/issues')
  assert.equal(payload.source.clicked.section, 'woolson/tab-assistant')
  // 没有卡住的选项时走 leave
  assert.equal(prompts.length > 0, true)
})

test('without a gesture the source has no clicked field', async () => {
  tabStore.clear()
  resetClickGestures()
  prompts.length = 0
  seedTab({ id: 1, url: 'https://github.com/woolson/tab-assistant', title: 'woolson/tab-assistant' })
  const newTab = seedTab({
    id: 2,
    url: 'https://news.ycombinator.com/item?id=1',
    openerTabId: 1,
  })

  watchNewTabForAiGrouping(createHost() as any, newTab)
  assert.equal(await waitFor(() => prompts.length > 0), true)

  const payload = JSON.parse(prompts[0])
  assert.equal(payload.source.url, 'https://github.com/woolson/tab-assistant')
  assert.equal('clicked' in payload.source, false)
})


test('task naming uses page context and asks the model even for a grouped same-site opener', async () => {
  tabStore.clear()
  resetClickGestures()
  prompts.length = 0
  contentReads = 0
  seedTab({ id: 1, url: 'https://example.com/travel', groupId: 7 })
  const newTab = seedTab({ id: 2, url: 'https://example.com/monitors', openerTabId: 1 })
  reply = '{"action":"create","title":"挑选显示器"}'
  const titles: string[] = []
  const host = { ...createHost(), canReadPageContent: () => true, createGroupForTab: async (_tab: any, title: string) => { titles.push(title) } }
  watchNewTabForAiGrouping(host as any, newTab)
  assert.equal(await waitFor(() => titles.length > 0), true)
  assert.deepEqual(titles, ['挑选显示器'])
  assert.deepEqual(host.joined, [])
  const payload = JSON.parse(prompts[0])
  assert.equal(payload.target.content.description, '比较显示器的色彩与价格')
  assert.equal(payload.source.groupId, 7)
  assert.equal(contentReads, 1)
  assert.match(systems[systems.length - 1], /Never use a domain/)
  reply = '{"action":"leave"}'
})

test('content capture off does not read page text and leave never uses domain grouping', async () => {
  tabStore.clear()
  prompts.length = 0
  contentReads = 0
  const newTab = seedTab({ id: 2, url: 'https://example.com/unclear', openerTabId: 1 })
  let domainCalls = 0
  const host = { ...createHost(), groupTabWithExistingRules: async () => { domainCalls += 1 } }
  watchNewTabForAiGrouping(host as any, newTab)
  assert.equal(await waitFor(() => prompts.length > 0), true)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(contentReads, 0)
  assert.equal(domainCalls, 0)
  assert.equal(JSON.parse(prompts[0]).target.content, undefined)
})
