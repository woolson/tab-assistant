import { AI_API_CONFIG_KEY, defaultAiApiConfig } from '../../common/aiApi.ts'
import { AI_REGROUP_JOB_KEY, AI_REGROUP_STATUS_MESSAGE, START_AI_REGROUP_MESSAGE } from '../../common/aiRegroup.ts'
import { CLEAR_GROUPING_PREFERENCES_MESSAGE, GROUPING_PREFERENCES_KEY } from '../../common/groupingPreferences.ts'
import { AI_TOKEN_USAGE_KEY, RECORD_AI_TOKEN_USAGE_MESSAGE, createAiTokenUsageEvent, readAiTokenUsageState } from '../../common/aiTokenUsage.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createContext, runInContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as lodash from 'lodash-es'

const LOG_KEY = 'TA_AI_DECISION_LOG'
const entryPath = path.resolve('src/pages/Background/index.ts')
const compiled = new Map<string, string>()

function event() {
  const listeners = new Set<(...args: any[]) => void>()
  return {
    listeners,
    addListener: (listener: (...args: any[]) => void) => { listeners.add(listener) },
    removeListener: (listener: (...args: any[]) => void) => { listeners.delete(listener) },
    emit: (...args: any[]) => { for (const listener of [...listeners]) listener(...args) },
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function browser() {
  const tabs = new Map<number, any>()
  const groups = new Map<number, any>()
  const local: Record<string, any> = {}
  const sync: Record<string, any> = { TA_SETTING: { aiAutoGroupEnabled: true, decisionLogEnabled: true }, TAB_ASSISTANT_RULES: [] }
  let configGate = Promise.resolve()
  let nextGroupId = 100
  const chrome = {
    permissions: { contains: (_permissions: any, callback: any) => callback(true) },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: structuredClone(local[key]) }),
        set: async (values: object) => { Object.assign(local, structuredClone(values)) },
      },
      sync: {
        get: async () => { await configGate; return structuredClone(sync) },
      },
    },
    tabs: {
      onCreated: event(), onUpdated: event(), onRemoved: event(), onMoved: event(),
      onActivated: event(), onHighlighted: event(),
      get: async (id: number) => {
        if (!tabs.has(id)) throw new Error(`No tab ${id}`)
        return { ...tabs.get(id) }
      },
      query: async ({ windowId, groupId }: any) => [...tabs.values()]
        .filter(tab => (windowId === undefined || tab.windowId === windowId) && (groupId === undefined || tab.groupId === groupId))
        .map(tab => ({ ...tab })),
      group: async ({ groupId, tabIds, createProperties }: any) => {
        const id = groupId ?? ++nextGroupId
        if (!groups.has(id)) groups.set(id, { id, title: '', windowId: createProperties.windowId, color: 'grey' })
        for (const tabId of [tabIds].flat()) {
          tabs.get(tabId).groupId = id
          chrome.tabs.onUpdated.emit(tabId, { groupId: id }, { ...tabs.get(tabId) })
        }
        return id
      },
    },
    tabGroups: {
      TAB_GROUP_ID_NONE: -1, onRemoved: event(), onUpdated: event(), onMoved: event(),
      query: async ({ windowId }: any) => [...groups.values()].filter(group => windowId === undefined || group.windowId === windowId),
      get: async (id: number) => {
        if (!groups.has(id)) throw new Error(`No group ${id}`)
        return { ...groups.get(id) }
      },
      update: async (id: number, props: object) => {
        Object.assign(groups.get(id), props)
        chrome.tabGroups.onUpdated.emit({ ...groups.get(id) })
      },
      move: async (id: number) => { chrome.tabGroups.onMoved.emit({ ...groups.get(id) }) },
    },
    windows: { getAll: async () => [...new Set([1, ...[...tabs.values(), ...groups.values()].map(item => item.windowId)])].map(id => ({ id })), onFocusChanged: event(), WINDOW_ID_NONE: -1 },
    webNavigation: { onCreatedNavigationTarget: event() },
    runtime: { onInstalled: event(), onMessage: event() },
    action: { setPopup: async () => {} },
    sidePanel: { setPanelBehavior: async () => {} },
    alarms: { clear: async () => {}, onAlarm: event() },
  }
  return {
    chrome, tabs, groups, local, sync,
    gateConfig: (gate: Promise<void>) => { configGate = gate },
    addTab(id: number, properties: object = {}) {
      const tab = { id, windowId: 1, groupId: -1, url: '', title: '', ...properties }
      tabs.set(id, tab)
      chrome.tabs.onCreated.emit({ ...tab })
    },
    logs: () => local[LOG_KEY] || [],
  }
}

/** Run the actual background entry and its TS imports in a fresh worker-like context. */
function startWorker(b: ReturnType<typeof browser>, model?: { respond: (payload: any, signal?: AbortSignal) => Promise<string>; usage?: object; stream?: boolean }, modelDeadlineMs?: number) {
  if (model && !b.local[AI_API_CONFIG_KEY]) b.local[AI_API_CONFIG_KEY] = { ...defaultAiApiConfig(), apiKey: 'fixture-key' }
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const intervals = new Set<ReturnType<typeof setInterval>>()
  const context = createContext({
    chrome: b.chrome, console, URL, URLSearchParams, AbortController, TextDecoder,
    fetch: async (_url: string, init: any) => {
      if (!model) throw new Error('unexpected API request')
      const body = JSON.parse(init.body)
      assert.equal(body.messages.length, 2)
      const text = await model.respond(JSON.parse(body.messages[1].content), init.signal)
      if (model.stream) {
        assert.equal(body.stream, true)
        const chunks = [{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }, { choices: [], usage: model.usage }]
        return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: text } }], ...(model.usage ? { usage: model.usage } : {}) }) }
    },
    process: { env: { NODE_ENV: 'production' } },
    setTimeout: (callback: () => void, ms: number) => {
      const timer = setTimeout(() => { timers.delete(timer); callback() }, ms === 25_000 && modelDeadlineMs !== undefined ? modelDeadlineMs : ms)
      timers.add(timer)
      return timer
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => { clearTimeout(timer); timers.delete(timer) },
    setInterval: (callback: () => void, ms: number) => {
      const timer = setInterval(callback, ms)
      intervals.add(timer)
      return timer
    },
    clearInterval: (timer: ReturnType<typeof setInterval>) => { clearInterval(timer); intervals.delete(timer) },
  })
  const modules = new Map<string, { exports: any }>()
  function load(filename: string): any {
    if (modules.has(filename)) return modules.get(filename)!.exports
    let code = compiled.get(filename)
    if (!code) {
      code = ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: filename,
      }).outputText
      compiled.set(filename, code)
    }
    const module = { exports: {} }
    modules.set(filename, module)
    const require = (name: string) => name === 'lodash-es' ? lodash : load(path.resolve(path.dirname(filename), `${name}.ts`))
    runInContext(`(function(require,module,exports){${code}\n})`, context, { filename })(require, module, module.exports)
    return module.exports
  }
  load(entryPath)
  return () => {
    for (const timer of timers) clearTimeout(timer)
    for (const timer of intervals) clearInterval(timer)
    for (const namespace of Object.values(b.chrome)) {
      for (const value of Object.values(namespace)) {
        if (value && typeof value === 'object' && 'listeners' in value) (value.listeners as Set<unknown>).clear()
      }
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs
  while (!predicate() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(predicate(), 'background did not finish processing the event')
}

function creatingModel() {
  const prompts: any[] = []
  return {
    prompts,
    respond: async (payload: any) => {
      prompts.push(payload)
      return JSON.stringify({ action: 'create', title: `Topic ${prompts.length}` })
    },
  }
}

test('the quick-search command is registered before a blocked assistant bootstrap and opens without waiting for AI', async t => {
  const b = browser()
  const gate = deferred()
  b.gateConfig(gate.promise)
  const onCommand = event()
  let created: any
  ;(b.chrome as any).commands = { onCommand }
  ;(b.chrome.runtime as any).getURL = (path: string) => `chrome-extension://fixture/${path}`
  ;(b.chrome.windows as any).getLastFocused = async () => ({ id: 1, type: 'normal', left: 100, top: 100, width: 1200, height: 800 })
  ;(b.chrome.windows as any).create = async (options: any) => { created = options; return { id: 9 } }
  t.after(startWorker(b))
  onCommand.emit('toggle-quick-search')
  await waitFor(() => Boolean(created))
  assert.equal(created.type, 'popup')
  const url = new URL(created.url)
  assert.equal(url.pathname, '/quick-search.html')
  assert.equal(url.searchParams.get('sourceWindowId'), '1')
  assert.ok(url.searchParams.get('fallback'))
  gate.resolve()
  await regroupMessage(b, AI_REGROUP_STATUS_MESSAGE)
})

test('the extension search window never becomes a domain group in custom grouping mode', async t => {
  const b = browser()
  b.sync.TA_SETTING.aiAutoGroupEnabled = false
  b.tabs.set(1, { id: 1, windowId: 1, groupId: -1, title: '快捷搜索', url: 'chrome-extension://fixture/quick-search.html?sourceWindowId=1' })
  t.after(startWorker(b))
  await regroupMessage(b, AI_REGROUP_STATUS_MESSAGE)
  b.addTab(2, { title: '快捷搜索', url: 'chrome-extension://fixture/quick-search.html?sourceWindowId=1' })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(b.groups.size, 0)
  assert.equal(b.tabs.get(1).groupId, -1)
  assert.equal(b.tabs.get(2).groupId, -1)
})

test('watermarked document titles reach the model intact and a grounded join is applied', async t => {
  const b = browser()
  b.local[AI_API_CONFIG_KEY] = { ...defaultAiApiConfig('openai'), apiKey: 'fixture-key' }
  const prefix = '\u200b\u202c\ufeff\u200d\u200c\u2063\u2062'.repeat(10)
  b.groups.set(7, { id: 7, windowId: 1, title: '弹外抽数任务', color: 'blue' })
  b.tabs.set(1, { id: 1, windowId: 1, groupId: 7, url: 'https://docs.example/manual', title: prefix + '弹外抽数操作手册 · 钉钉文档' })
  const prompts: any[] = []
  t.after(startWorker(b, { stream: true, usage: { prompt_tokens: 33, completion_tokens: 7 }, respond: async payload => {
    prompts.push(payload)
    assert.equal(payload.target.title, '弹外抽数任务监控与重跑 · 钉钉文档')
    assert.equal(payload.groups.find((group: any) => group.id === 7).tabs[0].title, '弹外抽数操作手册 · 钉钉文档')
    return JSON.stringify({ action: 'join', groupId: 7, taskMatch: { basis: 'same-task', targetEvidence: '弹外抽数任务监控与重跑', groupEvidence: '弹外抽数操作手册' } })
  } }))
  b.addTab(2, { url: 'https://docs.example/monitor', title: prefix + '弹外抽数任务监控与重跑 · 钉钉文档' })
  await waitFor(() => b.tabs.get(2).groupId === 7)
  assert.equal(prompts.length, 1)
  assert.equal(readAiTokenUsageState(b.local[AI_TOKEN_USAGE_KEY]).rows[0].inputTokens, 33)
  assert.equal(readAiTokenUsageState(b.local[AI_TOKEN_USAGE_KEY]).rows[0].outputTokens, 7)
})

test('logging defaults off without preventing AI grouping, and follows the switch across a worker restart', async t => {
  const b = browser()
  delete b.sync.TA_SETTING.decisionLogEnabled
  const model = creatingModel()
  const stop = startWorker(b, model)
  t.after(stop)
  b.addTab(1, { url: 'https://example.com/first' })
  await waitFor(() => b.tabs.get(1).groupId !== -1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(b.logs().length, 0)

  b.sync.TA_SETTING.decisionLogEnabled = true
  b.addTab(2, { url: 'https://example.com/second' })
  await waitFor(() => b.logs().length === 1)
  b.sync.TA_SETTING.decisionLogEnabled = false
  stop()
  t.after(startWorker(b, model))
  b.addTab(3, { pendingUrl: 'https://example.com/third' })
  await waitFor(() => b.tabs.get(3).groupId !== -1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(model.prompts.length, 3)
  assert.equal(b.groups.get(b.tabs.get(3).groupId).title, 'Topic 3')
  assert.equal(b.logs().length, 1)
})

test('disabling logs during an API request keeps grouping but records no result', async t => {
  const b = browser()
  const response = deferred()
  let asked = false
  t.after(startWorker(b, { respond: async () => { asked = true; await response.promise; return '{"action":"create","title":"学习 Rust"}' } }))
  b.addTab(1, { url: 'https://example.com/rust' })
  await waitFor(() => asked)
  b.sync.TA_SETTING.decisionLogEnabled = false
  response.resolve()
  await waitFor(() => b.tabs.get(1).groupId !== -1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '学习 Rust')
  assert.equal(b.logs().length, 0)
})

test('the runtime clear action clears existing logs and preserves the logging preference', async t => {
  const b = browser()
  t.after(startWorker(b, creatingModel()))
  b.addTab(1, { url: 'https://example.com/before-clear' })
  await waitFor(() => b.logs().length === 1)
  const response = await new Promise<any>(resolve => {
    b.chrome.runtime.onMessage.emit({ type: 'ta:clear-decision-logs' }, {}, resolve)
  })
  assert.equal(response.ok, true)
  assert.equal(b.logs().length, 0)
  assert.equal(b.sync.TA_SETTING.decisionLogEnabled, true)
  b.addTab(2, { url: 'https://example.com/after-clear' })
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.logs()[0].url, 'https://example.com/after-clear')
})

test('extension and browser-internal pages do not call the model or create decision logs', async t => {
  const b = browser()
  const model = creatingModel()
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'chrome-extension://fixture/popup.html', title: 'TabAssistant' })
  b.addTab(2, { url: 'edge://settings/', title: 'Settings' })
  b.addTab(3, { url: 'chrome://extensions/', title: 'Extensions' })
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(model.prompts.length, 0)
  assert.equal(b.logs().length, 0)
  assert.equal(b.groups.size, 0)
})

test('wake-up listeners register before config resolves, and the first tab reaches the model', async t => {
  const b = browser()
  const config = deferred()
  b.gateConfig(config.promise)
  const model = creatingModel()
  t.after(startWorker(b, model))

  assert.equal(b.chrome.tabs.onCreated.listeners.size, 2) // grouping + idle tracking
  assert.ok(b.chrome.tabs.onUpdated.listeners.size > 0)
  assert.equal(b.chrome.webNavigation.onCreatedNavigationTarget.listeners.size, 1)
  b.addTab(1, { pendingUrl: 'https://first.example/article' })
  config.resolve()
  await waitFor(() => b.logs().length === 1)

  assert.equal(model.prompts.length, 1)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, 'Topic 1')
  assert.equal(b.logs()[0].result, 'create')
})

test('third group and its log are created after a worker restart with two existing groups', async t => {
  const b = browser()
  const model = creatingModel()
  const stop = startWorker(b, model)
  t.after(stop)
  for (let id = 1; id <= 2; id++) {
    b.addTab(id, { url: `https://topic${id}.example/article` })
    await waitFor(() => b.logs().length === id)
  }
  stop()
  t.after(startWorker(b, model))
  // Dispatch immediately, before the restarted worker has read storage.
  b.addTab(3, { pendingUrl: 'https://topic3.example/article' })
  await waitFor(() => b.logs().length === 3)

  assert.equal(model.prompts.length, 3)
  assert.equal(b.groups.size, 3)
  assert.equal(b.groups.get(b.tabs.get(3).groupId).title, 'Topic 3')
  assert.equal(b.logs()[0].url, 'https://topic3.example/article')
  assert.equal(b.logs()[0].modelStatus, 'answered')

  // The new worker no longer has the earlier tabs' in-memory AI markers.
  // Their later load/navigation events must still preserve the AI groups.
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  b.tabs.get(2).url = 'https://topic2.example/next'
  b.chrome.tabs.onUpdated.emit(2, { url: 'https://topic2.example/next' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, 'Topic 1')
  assert.equal(b.groups.get(b.tabs.get(2).groupId).title, 'Topic 2')
  assert.equal(model.prompts.length, 3)
})

test('a pending URL stays ungrouped without a model', async t => {
  const b = browser()
  t.after(startWorker(b))
  b.addTab(1, { url: 'chrome://newtab/', pendingUrl: 'https://fallback.example/page' })
  await waitFor(() => b.logs().length === 1)

  assert.equal(b.tabs.get(1).groupId, -1)
  assert.equal(b.logs()[0].result, 'ungrouped')
  assert.equal(b.logs()[0].modelStatus, 'not-configured')
})

test('a pending navigation uses matching rules before the model', async t => {
  const b = browser()
  b.sync.TAB_ASSISTANT_RULES = [{ groupTitle: 'Work', matchType: 0, matchContent: 'work.example', priority: 1, sortIndex: -1 }]
  const model = creatingModel()
  t.after(startWorker(b, model))
  b.addTab(1, { pendingUrl: 'https://work.example/page' })
  await waitFor(() => b.logs().length === 1)

  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, 'Work')
  assert.equal(model.prompts.length, 0)
  assert.equal(b.logs()[0].result, 'rule')
})

test('grouping still works with AI disabled when a tab wakes the worker', async t => {
  const b = browser()
  b.sync.TA_SETTING.aiAutoGroupEnabled = false
  const model = creatingModel()
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'https://regular.example/page' })
  await waitFor(() => b.tabs.get(1).groupId !== -1)

  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, 'regular.example')
  assert.equal(model.prompts.length, 0)
  assert.equal(b.logs().length, 0)
})

test('saving settings buffers new tabs and keeps exactly one set of grouping listeners', async t => {
  const b = browser()
  const model = creatingModel()
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'https://first.example' })
  await waitFor(() => b.logs().length === 1)
  const config = deferred()
  b.gateConfig(config.promise)
  const reloaded = deferred()
  b.chrome.runtime.onMessage.emit('TA_RELOAD_RULE', {}, reloaded.resolve)
  b.addTab(2, { pendingUrl: 'https://second.example' })
  config.resolve()
  await reloaded.promise
  await waitFor(() => b.logs().length === 2)

  assert.equal(b.chrome.tabs.onCreated.listeners.size, 2)
  assert.equal(model.prompts.length, 2)
  assert.equal(b.groups.get(b.tabs.get(2).groupId).title, 'Topic 2')
})

test('an idle new tab logs that it is waiting, then groups its first real navigation once', async t => {
  const b = browser()
  const model = creatingModel()
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'chrome://newtab/' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'waiting'), 3500)
  assert.equal(b.tabs.get(1).groupId, -1)

  Object.assign(b.tabs.get(1), { url: 'https://late.example' })
  b.chrome.tabs.onUpdated.emit(1, { url: 'https://late.example' })
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => b.logs().length === 2)
  assert.equal(model.prompts.length, 1)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, 'Topic 1')
})

test('an Edge new tab still asks the model on its first search after worker suspension', async t => {
  const b = browser()
  const model = creatingModel()
  const stop = startWorker(b, model)
  t.after(stop)
  b.addTab(1, { url: 'edge://newtab/' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'waiting'), 3500)
  stop()
  t.after(startWorker(b, model))

  Object.assign(b.tabs.get(1), { pendingUrl: 'https://www.bing.com/search?q=learn+rust' })
  b.chrome.tabs.onUpdated.emit(1, { status: 'loading' })
  Object.assign(b.tabs.get(1), { url: 'https://www.bing.com/search?q=learn+rust', pendingUrl: undefined, title: 'learn rust - 搜索' })
  b.chrome.tabs.onUpdated.emit(1, { url: 'https://www.bing.com/search?q=learn+rust' })
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })

  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  assert.equal(model.prompts.length, 1)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, 'Topic 1')
  assert.equal(b.logs().filter((entry: any) => entry.result === 'create').length, 1)
  assert.equal([...b.groups.values()].some(group => group.title === 'www.bing.com'), false)
})

test('an already open Edge new tab reaches the model after enabling AI', async t => {
  const b = browser()
  b.tabs.set(1, { id: 1, windowId: 1, groupId: -1, url: 'edge://newtab/', title: '新建标签页' })
  const model = creatingModel()
  t.after(startWorker(b, model))

  Object.assign(b.tabs.get(1), { url: 'https://www.bing.com/search?q=compare+monitors', title: 'compare monitors - 搜索' })
  b.chrome.tabs.onUpdated.emit(1, { url: 'https://www.bing.com/search?q=compare+monitors' })
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })

  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  assert.equal(model.prompts.length, 1)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, 'Topic 1')
})

test('saving API settings while an Edge new tab is open does not lose the search decision', async t => {
  const b = browser()
  const model = creatingModel()
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'edge://newtab/' })
  const reloaded = deferred()
  b.chrome.runtime.onMessage.emit('TA_RELOAD_RULE', {}, reloaded.resolve)
  await reloaded.promise

  Object.assign(b.tabs.get(1), { url: 'https://www.bing.com/search?q=learn+rust', title: 'learn rust - 搜索' })
  b.chrome.tabs.onUpdated.emit(1, { url: 'https://www.bing.com/search?q=learn+rust' })
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })

  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  assert.equal(model.prompts.length, 1)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, 'Topic 1')
})

test('a later search can group a tab previously left ungrouped without repeating unchanged updates', async t => {
  const b = browser()
  const prompts: any[] = []
  t.after(startWorker(b, {
    respond: async payload => {
      prompts.push(payload)
      return JSON.stringify(prompts.length === 1 ? { action: 'leave' } : { action: 'create', title: '学习 Rust' })
    },
  }))
  b.addTab(1, { url: 'https://www.bing.com/search' })
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.tabs.get(1).groupId, -1)
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  b.tabs.get(1).title = '搜索'
  b.chrome.tabs.onUpdated.emit(1, { title: '搜索' })
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(prompts.length, 1)

  Object.assign(b.tabs.get(1), { url: 'https://www.bing.com/search?q=learn+rust', title: 'learn rust - 搜索' })
  b.chrome.tabs.onUpdated.emit(1, { url: 'https://www.bing.com/search?q=learn+rust' })
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => b.logs().length === 2)
  assert.equal(prompts.length, 2)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '学习 Rust')
})

test('a search made while the previous API request is pending is decided after the stale response', async t => {
  const b = browser()
  const model = creatingModel()
  const response = deferred()
  t.after(startWorker(b, {
    respond: async payload => {
      const text = await model.respond(payload)
      if (model.prompts.length === 1) await response.promise
      return text
    },
  }))
  b.addTab(1, { url: 'https://www.bing.com/search?q=first' })
  await waitFor(() => model.prompts.length === 1)
  Object.assign(b.tabs.get(1), { url: 'https://www.bing.com/search?q=second', title: 'second - 搜索' })
  b.chrome.tabs.onUpdated.emit(1, { url: 'https://www.bing.com/search?q=second' })
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  response.resolve()

  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  assert.equal(model.prompts.length, 2)
  assert.equal(model.prompts[1].target.url, 'https://www.bing.com/search?q=second')
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, 'Topic 2')
  assert.equal(b.logs().length, 1)
  assert.equal(b.logs()[0].url, 'https://www.bing.com/search?q=second')
})

test('an ungrouped navigation after restart logs missing API configuration and never falls back to a domain', async t => {
  const b = browser()
  b.tabs.set(1, { id: 1, windowId: 1, groupId: -1, url: 'edge://newtab/', title: '新建标签页' })
  t.after(startWorker(b))
  Object.assign(b.tabs.get(1), { url: 'https://www.bing.com/search?q=learn+rust' })
  b.chrome.tabs.onUpdated.emit(1, { url: 'https://www.bing.com/search?q=learn+rust' })
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })

  await waitFor(() => b.logs().length === 1)
  assert.equal(b.logs()[0].modelStatus, 'not-configured')
  assert.equal(b.tabs.get(1).groupId, -1)
  assert.equal(b.groups.size, 0)
})

test('a clear Baidu search creates a task group when the model declines to choose one', async t => {
  const b = browser()
  const prompts: any[] = []
  t.after(startWorker(b, { respond: async payload => { prompts.push(payload); return '{"action":"leave"}' } }))
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent('S16 总决赛')}`
  b.addTab(1, { url, title: 'S16 总决赛_百度搜索' })
  await waitFor(() => b.logs().length === 1)

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].target.search.query, 'S16 总决赛')
  const groupId = b.tabs.get(1).groupId
  assert.notEqual(groupId, -1)
  assert.equal(b.groups.get(groupId).title, '了解 S16 总决赛')
  assert.equal(b.logs()[0].result, 'create')
  assert.equal(b.logs()[0].via, 'search')
  assert.equal(b.logs()[0].modelAction, 'leave')
  assert.equal(b.logs()[0].groupId, groupId)
  assert.equal(b.logs()[0].groupTitle, '了解 S16 总决赛')
})

test('a pending search preserves keywords after long tracking parameters even before the page title is ready', async t => {
  const b = browser()
  const prompts: any[] = []
  t.after(startWorker(b, { respond: async payload => { prompts.push(payload); return '{"action":"leave"}' } }))
  const url = `https://www.baidu.com/s?tn=${'tracking'.repeat(50)}&wd=${encodeURIComponent('S16 总决赛')}`
  b.addTab(1, { url: 'edge://newtab/', pendingUrl: url })
  await waitFor(() => b.logs().length === 1)

  assert.equal(prompts[0].target.url.includes('wd='), false)
  assert.equal(prompts[0].target.search.query, 'S16 总决赛')
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '了解 S16 总决赛')
})

test('the loaded Baidu search title supplies intent when the address has no keyword', async t => {
  const b = browser()
  t.after(startWorker(b, { respond: async () => '{"action":"leave"}' }))
  b.addTab(1, { url: 'https://www.baidu.com/s?tn=fixture', title: 'S16 总决赛_百度搜索' })
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '了解 S16 总决赛')
})

test('a late search title gets one new decision after an evidence-free initial answer', async t => {
  const b = browser()
  let calls = 0
  t.after(startWorker(b, { respond: async () => { calls++; return '{"action":"leave"}' } }))
  b.addTab(1, { url: 'https://www.baidu.com/s?tn=fixture', title: '百度搜索' })
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.tabs.get(1).groupId, -1)

  b.tabs.get(1).title = 'S16 总决赛_百度搜索'
  b.chrome.tabs.onUpdated.emit(1, { title: 'S16 总决赛_百度搜索' })
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => b.logs().some((entry: any) => entry.via === 'search'))
  assert.equal(calls, 2)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '了解 S16 总决赛')
})

test('a search task reuses an existing task title and logs the actual join', async t => {
  const b = browser()
  b.groups.set(7, { id: 7, title: '了解 S16 总决赛', windowId: 1, color: 'blue' })
  b.tabs.set(2, { id: 2, windowId: 1, groupId: 7, url: 'https://sports.example/final', title: 'S16 总决赛资料' })
  t.after(startWorker(b, { respond: async () => '{"action":"leave"}' }))
  b.addTab(1, { url: 'https://www.baidu.com/s?wd=S16+%E6%80%BB%E5%86%B3%E8%B5%9B', title: 'S16 总决赛_百度搜索' })
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.groups.size, 1)
  assert.equal(b.tabs.get(1).groupId, 7)
  assert.equal(b.logs()[0].via, 'search')
  assert.equal(b.logs()[0].result, 'join')
  assert.equal(b.logs()[0].groupId, 7)
})

test('an API error does not create a search task or conceal the error', async t => {
  const b = browser()
  t.after(startWorker(b, { respond: async () => { throw new Error('fixture outage') } }))
  b.addTab(1, { url: 'https://www.baidu.com/s?wd=S16+%E6%80%BB%E5%86%B3%E8%B5%9B', title: 'S16 总决赛_百度搜索' })
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.tabs.get(1).groupId, -1)
  assert.equal(b.groups.size, 0)
  assert.equal(b.logs()[0].modelStatus, 'error')
  assert.equal(b.logs()[0].result, 'ungrouped')
})

test('a manual move while the model declines a search is preserved', async t => {
  const b = browser()
  const response = deferred()
  let asked = false
  t.after(startWorker(b, { respond: async () => { asked = true; await response.promise; return '{"action":"leave"}' } }))
  b.addTab(1, { url: 'https://www.baidu.com/s?wd=S16+%E6%80%BB%E5%86%B3%E8%B5%9B', title: 'S16 总决赛_百度搜索' })
  await waitFor(() => asked)
  b.groups.set(7, { id: 7, title: '我的资料', windowId: 1, color: 'blue' })
  b.tabs.get(1).groupId = 7
  b.chrome.tabs.onUpdated.emit(1, { groupId: 7 })
  response.resolve()
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.tabs.get(1).groupId, 7)
  assert.equal(b.groups.size, 1)
  assert.equal(b.logs()[0].result, 'skipped')
})

function existingTaskGroup(b: ReturnType<typeof browser>) {
  b.groups.set(7, { id: 7, title: 'example.com', windowId: 1, color: 'blue' })
  b.tabs.set(1, { id: 1, windowId: 1, groupId: 7, url: 'https://example.com/review', title: '显示器评测' })
  b.tabs.set(2, { id: 2, windowId: 1, groupId: 7, url: 'https://shop.example/product', title: '显示器价格' })
}

function renamingModel(handler?: (payload: any) => Promise<string>) {
  const prompts: any[] = []
  return {
    prompts,
    respond: async (payload: any) => {
      prompts.push(payload)
      return handler ? handler(payload) : JSON.stringify({ action: payload.currentGroup ? 'rename' : 'create', title: '挑选显示器' })
    },
  }
}

test('existing grouped navigation updates the shared task title without moving any tabs', async t => {
  const b = browser()
  existingTaskGroup(b)
  const model = renamingModel()
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  b.chrome.tabs.onUpdated.emit(1, { title: '显示器评测' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'rename'), 3000)
  assert.equal(model.prompts.length, 1)
  assert.equal(model.prompts[0].groups[0].tabs.length, 2)
  assert.match(model.prompts[0].instruction, /Reassess this already grouped tab/)
  assert.equal(b.groups.get(7).title, '挑选显示器')
  assert.equal(b.tabs.get(1).groupId, 7)
  assert.equal(b.tabs.get(2).groupId, 7)
  assert.equal(b.groups.size, 1)
})

test('tabs created during this worker session can later update their existing group title', async t => {
  const b = browser()
  const model = renamingModel(async payload => JSON.stringify({ action: payload.currentGroup ? 'rename' : 'create', title: payload.currentGroup ? '比较显示器价格' : '挑选显示器' }))
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'https://example.com/review', title: '显示器评测' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  const groupId = b.tabs.get(1).groupId
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => b.groups.get(groupId).title === '比较显示器价格', 3000)
  assert.equal(b.tabs.get(1).groupId, groupId)
})

test('rule groups and persisted manually named groups are not renamed', async t => {
  const b = browser()
  existingTaskGroup(b)
  b.local.TA_AI_MANUAL_TITLE_7 = 'example.com'
  const model = renamingModel()
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await new Promise(resolve => setTimeout(resolve, 1200))
  assert.equal(model.prompts.length, 1)
  delete b.local.TA_AI_MANUAL_TITLE_7
  b.sync.TAB_ASSISTANT_RULES = [{ groupTitle: 'example.com', matchType: 0, matchContent: 'example.com', priority: 1, sortIndex: -1 }]
  const reloaded = deferred()
  b.chrome.runtime.onMessage.emit('TA_RELOAD_RULE', {}, reloaded.resolve)
  await reloaded.promise
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await new Promise(resolve => setTimeout(resolve, 1200))
  assert.equal(model.prompts.length, 1)
  assert.equal(b.groups.get(7).title, 'example.com')
})

test('a rename response is discarded if another member navigates during inference', async t => {
  const b = browser()
  existingTaskGroup(b)
  const gate = deferred()
  const model = renamingModel(async () => { await gate.promise; return JSON.stringify({ action: 'rename', title: '挑选显示器' }) })
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => model.prompts.length === 1, 3000)
  b.tabs.get(2).url = 'https://shop.example/travel'
  gate.resolve()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(b.groups.get(7).title, 'example.com')
  assert.equal(b.logs().filter((entry: any) => entry.result === 'rename').length, 0)
})

test('a manual rename while the model is thinking wins and is preserved across worker restarts', async t => {
  const b = browser()
  existingTaskGroup(b)
  const gate = deferred()
  const model = renamingModel(async () => { await gate.promise; return JSON.stringify({ action: 'rename', title: '挑选显示器' }) })
  const stop = startWorker(b, model)
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => model.prompts.length === 1, 3000)
  await b.chrome.tabGroups.update(7, { title: '我的任务' })
  gate.resolve()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(b.groups.get(7).title, '我的任务')
  assert.equal(b.local.TA_AI_MANUAL_TITLE_7, '我的任务')
  stop()
  const nextModel = renamingModel()
  t.after(startWorker(b, nextModel))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await new Promise(resolve => setTimeout(resolve, 1200))
  assert.equal(nextModel.prompts.length, 1)
})

test('a user rename immediately after an AI group creation is still recognized as manual', async t => {
  const b = browser()
  const model = renamingModel()
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'https://example.com/review' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  const id = b.tabs.get(1).groupId
  await b.chrome.tabGroups.update(id, { title: '我的显示器' })
  assert.equal(b.local[`TA_AI_MANUAL_TITLE_${id}`], '我的显示器')
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await new Promise(resolve => setTimeout(resolve, 1200))
  assert.equal(model.prompts.length, 2)
  assert.equal(b.groups.get(id).title, '我的显示器')
})


test('a model response slower than the former four-second deadline can still group the tab', async t => {
  const b = browser()
  const model = renamingModel(async () => {
    await new Promise(resolve => setTimeout(resolve, 4200))
    return JSON.stringify({ action: 'create', title: '挑选显示器' })
  })
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'https://example.com/review' })
  await waitFor(() => b.logs().length > 0, 6000)
  assert.equal(b.logs()[0].result, 'create')
  assert.equal(b.logs()[0].modelStatus, 'answered')
})

test('API timeout aborts the request and the next tab can still be grouped', async t => {
  const b = browser()
  let calls = 0
  let cancelled = false
  const model = {
    respond: async (_payload: any, signal?: AbortSignal) => {
      if (++calls > 1) return '{"action":"create","title":"挑选显示器"}'
      return new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { cancelled = true; reject(new Error('aborted')) }, { once: true })
      })
    },
  }
  t.after(startWorker(b, model, 80))
  b.addTab(1, { url: 'https://example.com/one' })
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.logs()[0].modelStatus, 'timeout')
  assert.equal(cancelled, true)
  b.addTab(2, { url: 'https://example.com/two' })
  await waitFor(() => b.logs().length === 2)
  assert.equal(b.logs()[0].result, 'create')
  assert.equal(calls, 2)
})

test('queued new tabs take priority over queued background renames', async t => {
  const b = browser()
  existingTaskGroup(b)
  const gate = deferred()
  const order: string[] = []
  const model = renamingModel(async payload => {
    const kind = payload.currentGroup ? 'rename' : payload.target.url
    order.push(kind)
    if (order.length === 1) await gate.promise
    return JSON.stringify({ action: payload.currentGroup ? 'rename' : 'create', title: kind === 'rename' ? '挑选显示器' : `任务 ${order.length}` })
  })
  t.after(startWorker(b, model))
  b.addTab(3, { url: 'https://example.com/first' })
  await waitFor(() => order.length === 1)
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await new Promise(resolve => setTimeout(resolve, 1100))
  b.addTab(4, { url: 'https://example.com/second' })
  await new Promise(resolve => setTimeout(resolve, 350))
  gate.resolve()
  await waitFor(() => order.length === 3)
  assert.deepEqual(order, ['https://example.com/first', 'https://example.com/second', 'rename'])
})

function taskRoutingModel(decide: (payload: any, signal?: AbortSignal) => Promise<object> | object) {
  const prompts: any[] = []
  return {
    prompts,
    respond: async (payload: any, signal?: AbortSignal) => {
      prompts.push(payload)
      return JSON.stringify(await decide(payload, signal))
    },
  }
}

function regroupMessage(b: ReturnType<typeof browser>, type = START_AI_REGROUP_MESSAGE): Promise<any> {
  return new Promise(resolve => b.chrome.runtime.onMessage.emit({ type }, {}, (response: any) => resolve(JSON.parse(JSON.stringify(response)))))
}

test('a failed configuration reload replies explicitly so settings import cannot report a false success', async t => {
  const b = browser()
  t.after(startWorker(b))
  await regroupMessage(b, AI_REGROUP_STATUS_MESSAGE)
  b.sync.TAB_ASSISTANT_RULES = { invalid: true }
  const response = await new Promise<any>(resolve => b.chrome.runtime.onMessage.emit('TA_RELOAD_RULE', {}, resolve))
  assert.equal(response.ok, false)
  assert.equal(response.error, 'reload-failed')
})

test('background and popup usage share persistent totals across a worker restart without duplicate reports', async t => {
  const b = browser()
  existingTaskGroup(b)
  const gate = deferred()
  const model = { respond: async () => { await gate.promise; return '{"action":"leave"}' }, usage: { prompt_tokens: 100, completion_tokens: 10 } }
  const stop = startWorker(b, model)
  t.after(stop)
  await regroupMessage(b)
  const popupEvent = { ...createAiTokenUsageEvent('deepseek', defaultAiApiConfig().model), inputTokens: 7, outputTokens: 3 }
  const popupReport = () => new Promise<any>(resolve => b.chrome.runtime.onMessage.emit({ type: RECORD_AI_TOKEN_USAGE_MESSAGE, event: popupEvent }, {}, resolve))
  assert.equal((await popupReport()).ok, true)
  gate.resolve()
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
  const firstRow = readAiTokenUsageState(b.local[AI_TOKEN_USAGE_KEY]).rows[0]
  assert.equal(firstRow.inputTokens, 207)
  assert.equal(firstRow.outputTokens, 23)
  assert.equal(firstRow.requests, 3)
  stop()
  t.after(startWorker(b, model))
  assert.equal((await popupReport()).ok, true)
  assert.equal(readAiTokenUsageState(b.local[AI_TOKEN_USAGE_KEY]).rows[0].requests, 3)
  await regroupMessage(b)
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
  const nextRow = readAiTokenUsageState(b.local[AI_TOKEN_USAGE_KEY]).rows[0]
  assert.equal(nextRow.inputTokens, 407)
  assert.equal(nextRow.outputTokens, 43)
  assert.equal(nextRow.requests, 5)
})

test('usage message handler rejects page senders and malformed counts', async t => {
  const b = browser()
  t.after(startWorker(b))
  const event = { ...createAiTokenUsageEvent('deepseek', 'test-model'), inputTokens: 10, outputTokens: 3 }
  let replied = false
  b.chrome.runtime.onMessage.emit({ type: RECORD_AI_TOKEN_USAGE_MESSAGE, event }, { tab: { id: 1 } }, () => { replied = true })
  assert.equal(replied, false)
  const result = await new Promise<any>(resolve => b.chrome.runtime.onMessage.emit({ type: RECORD_AI_TOKEN_USAGE_MESSAGE, event: { ...event, outputTokens: -1 } }, {}, resolve))
  assert.equal(result.ok, false)
  assert.equal(b.local[AI_TOKEN_USAGE_KEY], undefined)
})

test('full regrouping covers grouped and ungrouped tabs in every window and reports progress', async t => {
  const b = browser()
  existingTaskGroup(b)
  b.tabs.set(3, { id: 3, windowId: 1, groupId: -1, url: 'https://alidocs.dingtalk.com/i/sales', title: '碰一下销售过程管理 · 钉钉文档' })
  b.tabs.set(4, { id: 4, windowId: 2, groupId: -1, url: 'https://alidocs.dingtalk.com/i/report', title: '碰一下销售周报 · 钉钉文档' })
  b.tabs.set(5, { id: 5, windowId: 2, groupId: -1, url: 'https://example.com/pinned', title: '固定页面', pinned: true })
  b.tabs.set(6, { id: 6, windowId: 1, groupId: -1, url: 'edge://settings/', title: '设置' })
  const model = taskRoutingModel(payload => payload.currentGroup ? { action: 'leave' } : { action: 'create', title: '跟进碰一下销售' })
  t.after(startWorker(b, model))
  const response = await regroupMessage(b)
  assert.equal(response.ok, true)
  assert.equal(response.job.total, 6)
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
  const job = b.local[AI_REGROUP_JOB_KEY]
  assert.equal(job.completed, 6)
  assert.equal(job.skipped, 2)
  assert.equal(job.failed, 0)
  assert.equal(model.prompts.length, 4)
  assert.equal(model.prompts.filter(payload => payload.currentGroup).length, 2)
  assert.equal(b.groups.get(b.tabs.get(3).groupId).title, '跟进碰一下销售')
  assert.equal(b.groups.get(b.tabs.get(4).groupId).windowId, 2)
  assert.notEqual(b.tabs.get(3).groupId, b.tabs.get(4).groupId)
  assert.equal(b.tabs.get(5).pinned, true)
  assert.equal(b.tabs.get(6).groupId, -1)
  assert.ok(b.logs().some((entry: any) => entry.trigger === 'full-regroup'))
  assert.equal((await regroupMessage(b, AI_REGROUP_STATUS_MESSAGE)).job.id, job.id)
})

test('concurrent full-regroup requests share one job, and a later explicit run reassesses unchanged pages', async t => {
  const b = browser()
  existingTaskGroup(b)
  const gate = deferred()
  const model = taskRoutingModel(async () => { await gate.promise; return { action: 'leave' } })
  t.after(startWorker(b, model))
  const [first, second] = await Promise.all([regroupMessage(b), regroupMessage(b)])
  assert.equal(first.job.id, second.job.id)
  await waitFor(() => model.prompts.length === 1)
  const reopened = await regroupMessage(b, AI_REGROUP_STATUS_MESSAGE)
  assert.equal(reopened.job.state, 'running')
  assert.equal((await regroupMessage(b)).job.id, first.job.id)
  gate.resolve()
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
  assert.equal(model.prompts.length, 2)
  const next = await regroupMessage(b)
  assert.notEqual(next.job.id, first.job.id)
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
  assert.equal(model.prompts.length, 4)
})

test('full regrouping retains explicit rules and local-file grouping without calling the model for them', async t => {
  const b = browser()
  b.sync.TAB_ASSISTANT_RULES = [{ ruleId: 'docs', name: '项目文档', groupTitle: '项目文档', priority: 1, sortIndex: 0, matchType: 0, matchContent: 'docs.example' }]
  b.tabs.set(1, { id: 1, windowId: 1, groupId: -1, url: 'https://docs.example/guide', title: '项目指南' })
  b.tabs.set(2, { id: 2, windowId: 1, groupId: -1, url: 'file:///tmp/readme.html', title: '本地文件' })
  const model = taskRoutingModel(() => { throw new Error('rules must not call the model') })
  t.after(startWorker(b, model))
  assert.equal((await regroupMessage(b)).ok, true)
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
  assert.equal(model.prompts.length, 0)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '项目文档')
  assert.equal(b.groups.get(b.tabs.get(2).groupId).title, 'Local file')
  assert.equal(b.local[AI_REGROUP_JOB_KEY].failed, 0)
})

test('full regrouping checks mode, saved API settings and permission before creating a job', async t => {
  for (const error of ['disabled', 'not-configured', 'permission']) await t.test(error, async st => {
    const b = browser()
    if (error === 'disabled') b.sync.TA_SETTING.aiAutoGroupEnabled = false
    if (error !== 'not-configured') b.local[AI_API_CONFIG_KEY] = { ...defaultAiApiConfig(), apiKey: 'fixture-key' }
    if (error === 'permission') b.chrome.permissions.contains = (_permissions, callback) => callback(false)
    st.after(startWorker(b))
    const response = await regroupMessage(b)
    assert.equal(response.ok, false)
    assert.equal(response.error, error)
    assert.equal(b.local[AI_REGROUP_JOB_KEY], undefined)
  })
})

test('API errors during full regrouping preserve every original group and are counted', async t => {
  const b = browser()
  existingTaskGroup(b)
  const model = taskRoutingModel(() => { throw new Error('offline') })
  t.after(startWorker(b, model))
  await regroupMessage(b)
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
  assert.equal(b.local[AI_REGROUP_JOB_KEY].failed, 2)
  assert.equal(b.tabs.get(1).groupId, 7)
  assert.equal(b.tabs.get(2).groupId, 7)
  assert.equal(b.groups.size, 1)
  assert.equal(model.prompts.length, 2)
})

test('three consecutive failed regroup attempts stop the run before calling every remaining tab', async t => {
  const b = browser()
  existingTaskGroup(b)
  for (let id = 3; id <= 10; id++) b.tabs.set(id, { id, windowId: 1, groupId: -1, url: `https://example.com/task-${id}`, title: `Task ${id}` })
  const model = taskRoutingModel(() => { throw new Error('offline') })
  t.after(startWorker(b, model))
  await regroupMessage(b)
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'failed')
  const job = b.local[AI_REGROUP_JOB_KEY]
  assert.equal(job.completed, 3)
  assert.equal(job.failed, 3)
  assert.equal(job.stopReason, 'api-failures')
  assert.equal(model.prompts.length, 3)
  assert.equal(b.tabs.get(1).groupId, 7)
  assert.equal(b.tabs.get(10).groupId, -1)
  assert.equal(b.logs()[0].request.model, defaultAiApiConfig().model)
  assert.ok(b.logs()[0].request.inputChars > 1000)
})

test('full regrouping reuses unchanged candidate summaries across targets without caching the targets themselves', async t => {
  const b = browser()
  b.sync.TA_SETTING.rememberClickSource = true
  b.groups.set(7, { id: 7, title: 'WAP', windowId: 1, color: 'blue' })
  b.tabs.set(1, { id: 1, windowId: 1, groupId: 7, url: 'https://wap.example/1', title: 'WAP' })
  for (const id of [2, 3]) b.tabs.set(id, { id, windowId: 1, groupId: -1, url: `https://wap.example/${id}`, title: 'WAP' })
  const calls = new Map<number, number>()
  ;(b.chrome as any).scripting = { executeScript: async ({ target, args }: any) => {
    if (!args) return [{ result: true }]
    calls.set(target.tabId, (calls.get(target.tabId) || 0) + 1)
    return [{ result: { description: '', headings: [], excerpt: 'campus-console 的发布任务' } }]
  } }
  const model = taskRoutingModel(() => ({ action: 'leave' }))
  t.after(startWorker(b, model))
  await regroupMessage(b)
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
  assert.equal(model.prompts.length, 3)
  assert.equal(calls.get(1), 3, 'one target read, one fresh validation, then one reused candidate capture')
  assert.equal(calls.get(2), 1)
  assert.equal(calls.get(3), 1)
})

test('a cached candidate is freshly read when it becomes the target and cannot leak its previous task into later prompts', async t => {
  const b = browser()
  b.sync.TA_SETTING.rememberClickSource = true
  b.groups.set(7, { id: 7, title: 'WAP', windowId: 1, color: 'blue' })
  for (const id of [2, 1, 3]) b.tabs.set(id, { id, windowId: 1, groupId: id === 1 ? 7 : -1, url: `https://wap.example/${id}`, title: 'WAP' })
  let current = 'campus-console 的旧任务'
  ;(b.chrome as any).scripting = { executeScript: async ({ target, args }: any) => !args ? [{ result: true }]
    : [{ result: { description: '', headings: [], excerpt: target.tabId === 1 ? current : '另一个应用的发布任务' } }] }
  const model = taskRoutingModel(payload => {
    if (payload.target.url.endsWith('/2')) current = 'campus-console 的新任务'
    if (payload.target.url.endsWith('/1')) assert.equal(payload.target.content.excerpt, 'campus-console 的新任务')
    if (payload.target.url.endsWith('/3')) assert.equal(payload.groups[0].tabs[0].content.excerpt, 'campus-console 的新任务')
    return { action: 'leave' }
  })
  t.after(startWorker(b, model))
  await regroupMessage(b)
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
  assert.equal(model.prompts.length, 3)
  assert.equal(b.local[AI_REGROUP_JOB_KEY].failed, 0)
})

test('a worker restart marks an unfinished full regroup as interrupted without making API calls', async t => {
  const b = browser()
  b.local[AI_REGROUP_JOB_KEY] = { id: 'previous-run', state: 'running', total: 8, completed: 3, skipped: 1, failed: 1, startedAt: 1 }
  const model = taskRoutingModel(() => { throw new Error('must not resume without confirmation') })
  t.after(startWorker(b, model))
  const response = await regroupMessage(b, AI_REGROUP_STATUS_MESSAGE)
  assert.equal(response.job.state, 'interrupted')
  assert.equal(response.job.completed, 3)
  assert.equal(model.prompts.length, 0)
})

test('reloading configuration interrupts full regrouping and discards its in-flight decision', async t => {
  const b = browser()
  existingTaskGroup(b)
  const gate = deferred()
  const model = taskRoutingModel(async () => { await gate.promise; return { action: 'create', title: '跟进碰一下销售' } })
  t.after(startWorker(b, model))
  await regroupMessage(b)
  await waitFor(() => model.prompts.length === 1)
  const reloaded = deferred()
  b.chrome.runtime.onMessage.emit('TA_RELOAD_RULE', {}, reloaded.resolve)
  await reloaded.promise
  gate.resolve()
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'interrupted')
  assert.equal(model.prompts.length, 1)
  assert.equal(b.tabs.get(1).groupId, 7)
  assert.equal(b.tabs.get(2).groupId, 7)
})

test('tabs moved to another group or window while waiting for full regrouping are skipped even without an event', async t => {
  for (const destination of ['group', 'window']) await t.test(destination, async st => {
    const b = browser()
    b.groups.set(7, { id: 7, title: '挑选显示器', windowId: 1, color: 'blue' })
    b.groups.set(9, { id: 9, title: '跟进碰一下销售', windowId: 1, color: 'green' })
    b.groups.set(12, { id: 12, title: '我的任务', windowId: 1, color: 'red' })
    b.tabs.set(1, { id: 1, windowId: 1, groupId: 7, url: 'https://example.com/review', title: '显示器评测' })
    b.tabs.set(2, { id: 2, windowId: 1, groupId: 9, url: 'https://example.com/sales', title: '销售过程管理' })
    const gate = deferred()
    const model = taskRoutingModel(async () => { await gate.promise; return { action: 'leave' } })
    st.after(startWorker(b, model))
    await regroupMessage(b)
    await waitFor(() => model.prompts.length === 1)
    Object.assign(b.tabs.get(2), destination === 'group' ? { groupId: 12 } : { windowId: 2, groupId: -1 })
    gate.resolve()
    await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
    assert.equal(model.prompts.length, 1)
    assert.equal(b.local[AI_REGROUP_JOB_KEY].skipped, 1)
    assert.equal(b.tabs.get(2).groupId, destination === 'group' ? 12 : -1)
  })
})

test('an explicit full regroup clears earlier holds but respects later manual moves and closed tabs', async t => {
  const b = browser()
  b.groups.set(7, { id: 7, title: '挑选显示器', windowId: 1, color: 'blue' })
  b.groups.set(9, { id: 9, title: '跟进碰一下销售', windowId: 1, color: 'green' })
  b.groups.set(12, { id: 12, title: '我的任务', windowId: 1, color: 'red' })
  b.tabs.set(1, { id: 1, windowId: 1, groupId: 7, url: 'https://example.com/review', title: '显示器评测' })
  b.tabs.set(2, { id: 2, windowId: 1, groupId: 9, url: 'https://alidocs.dingtalk.com/i/sales', title: '碰一下销售过程管理' })
  b.tabs.set(3, { id: 3, windowId: 1, groupId: -1, url: 'https://example.com/close', title: '即将关闭的页面' })
  const gate = deferred()
  const model = taskRoutingModel(async () => { await gate.promise; return { action: 'leave' } })
  t.after(startWorker(b, model))
  await regroupMessage(b, AI_REGROUP_STATUS_MESSAGE)
  // 等启动整理的自动操作保护结束，确保下面建立的是实际的手动移动保护。
  await new Promise(resolve => setTimeout(resolve, 1100))
  b.chrome.tabs.onMoved.emit(1)
  await regroupMessage(b)
  await waitFor(() => model.prompts.length === 1)
  b.tabs.get(2).groupId = 12
  b.chrome.tabs.onUpdated.emit(2, { groupId: 12 })
  b.tabs.delete(3)
  gate.resolve()
  await waitFor(() => b.local[AI_REGROUP_JOB_KEY]?.state === 'completed')
  assert.equal(model.prompts.length, 1)
  assert.equal(b.tabs.get(2).groupId, 12)
  assert.equal(b.local[AI_REGROUP_JOB_KEY].skipped, 2)
})

function seedTravelGroup(b: ReturnType<typeof browser>) {
  b.groups.set(9, { id: 9, title: '规划旅行', windowId: 1, color: 'green' })
  b.tabs.set(3, { id: 3, windowId: 1, groupId: 9, url: 'https://travel.example/guide', title: '旅行攻略' })
}

test('manual regrouping is remembered across worker restarts and resolves the preferred current group ID', async t => {
  const b = browser()
  existingTaskGroup(b)
  b.groups.set(9, { id: 9, title: '文档', windowId: 1, color: 'green' })
  const firstModel = taskRoutingModel(() => ({ action: 'leave' }))
  const stop = startWorker(b, firstModel)
  await regroupMessage(b, AI_REGROUP_STATUS_MESSAGE)
  b.tabs.get(1).groupId = -1
  b.chrome.tabs.onUpdated.emit(1, { groupId: -1 }, { ...b.tabs.get(1) })
  b.tabs.get(1).groupId = 9
  b.chrome.tabs.onUpdated.emit(1, { groupId: 9 }, { ...b.tabs.get(1) })
  await waitFor(() => b.local[GROUPING_PREFERENCES_KEY]?.length === 1)
  const saved = b.local[GROUPING_PREFERENCES_KEY][0]
  assert.equal(saved.groupTitle, '文档')
  assert.equal(saved.avoidedGroupTitle, 'example.com')
  assert.equal(saved.count, 1)
  assert.equal(firstModel.prompts.length, 0)
  stop()
  b.groups.delete(9)
  b.groups.set(19, { id: 19, title: '文档', windowId: 1, color: 'green' })
  b.tabs.get(1).groupId = 19
  const nextModel = taskRoutingModel(payload => {
    assert.equal(payload.manualPreferences[0].match, 'same-page')
    assert.deepEqual(payload.manualPreferences[0].availableGroupIds, [19])
    return { action: 'join', groupId: 19, manualPreferenceId: payload.manualPreferences[0].id, reason: '沿用你手动选择的分组' }
  })
  t.after(startWorker(b, nextModel))
  b.addTab(3, { url: 'https://example.com/review?utm_source=test', title: '显示器评测' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'join'))
  assert.equal(b.tabs.get(3).groupId, 19)
  assert.equal(b.logs()[0].via, 'preference')
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(b.local[GROUPING_PREFERENCES_KEY].length, 1)
  assert.equal(b.local[GROUPING_PREFERENCES_KEY][0].count, 1, 'automatic joins must not reinforce manual preferences')
})

test('a manual choice to ungroup a search is remembered and disables the search-topic fallback', async t => {
  const b = browser()
  b.groups.set(7, { id: 7, title: '研究 Rust', windowId: 1, color: 'blue' })
  b.tabs.set(1, { id: 1, groupId: 7, windowId: 1, url: 'https://www.bing.com/search?q=rust', title: 'Rust - 搜索' })
  // 即使模型没有重复引用偏好 ID，本地搜索兜底也不能推翻明确的“保持未分组”。
  const model = taskRoutingModel(() => ({ action: 'leave' }))
  t.after(startWorker(b, model))
  await regroupMessage(b, AI_REGROUP_STATUS_MESSAGE)
  b.tabs.get(1).groupId = -1
  b.chrome.tabs.onUpdated.emit(1, { groupId: -1 }, { ...b.tabs.get(1) })
  await waitFor(() => b.local[GROUPING_PREFERENCES_KEY]?.length === 1)
  assert.equal(b.local[GROUPING_PREFERENCES_KEY][0].choice, 'ungrouped')
  b.addTab(2, { url: b.tabs.get(1).url, title: 'Rust - 搜索' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'ungrouped'))
  assert.equal(b.tabs.get(2).groupId, -1)
  assert.equal(b.logs()[0].via, 'preference')
  assert.equal(b.groups.size, 1)
})

test('AI grouping and same-group ordering or collapse changes never become manual preferences', async t => {
  const b = browser()
  const model = creatingModel()
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'https://example.com/topic', title: '学习 React' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  b.chrome.tabs.onMoved.emit(1)
  await b.chrome.tabGroups.update(b.tabs.get(1).groupId, { collapsed: true })
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(b.local[GROUPING_PREFERENCES_KEY]?.length || 0, 0)
})

test('a manual correction during another tab automatic grouping is learned instead of suppressed globally', async t => {
  const b = browser()
  existingTaskGroup(b)
  b.groups.set(9, { id: 9, title: '采购资料', windowId: 1, color: 'green' })
  const model = creatingModel()
  t.after(startWorker(b, model))
  b.addTab(3, { url: 'https://new.example/react', title: 'React 开发' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  b.tabs.get(1).groupId = 9
  b.chrome.tabs.onUpdated.emit(1, { groupId: 9 }, { ...b.tabs.get(1) })
  await waitFor(() => b.local[GROUPING_PREFERENCES_KEY]?.length === 1)
  assert.equal(b.local[GROUPING_PREFERENCES_KEY][0].groupTitle, '采购资料')
  assert.equal(b.local[GROUPING_PREFERENCES_KEY][0].url, 'https://example.com/review')
})

test('manual group renames update member preferences without teaching unrelated groups or automatic renames', async t => {
  const b = browser()
  existingTaskGroup(b)
  const model = renamingModel()
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'rename'), 3000)
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(b.local[GROUPING_PREFERENCES_KEY]?.length || 0, 0)
  await b.chrome.tabGroups.update(7, { title: '显示器采购资料' })
  await waitFor(() => b.local[GROUPING_PREFERENCES_KEY]?.length === 2)
  assert.ok(b.local[GROUPING_PREFERENCES_KEY].every((item: any) => item.groupTitle === '显示器采购资料'))
})

test('clearing preferences during inference discards old preference-based decisions and future requests have no history', async t => {
  const b = browser()
  existingTaskGroup(b)
  b.groups.set(9, { id: 9, title: '文档', windowId: 1, color: 'green' })
  b.local[GROUPING_PREFERENCES_KEY] = [{ id: 'pref-saved', url: 'https://example.com/review', title: '显示器评测', choice: 'group', groupTitle: '文档', count: 1, updatedAt: 1 }]
  const gate = deferred()
  const model = taskRoutingModel(async payload => {
    if (payload.manualPreferences.length) { await gate.promise; return { action: 'join', groupId: 9, manualPreferenceId: 'pref-saved' } }
    return { action: 'create', title: '挑选显示器' }
  })
  t.after(startWorker(b, model))
  b.addTab(3, { url: 'https://example.com/review', title: '显示器评测' })
  await waitFor(() => model.prompts.length === 1)
  const cleared = deferred()
  b.chrome.runtime.onMessage.emit({ type: CLEAR_GROUPING_PREFERENCES_MESSAGE }, {}, cleared.resolve)
  await cleared.promise
  gate.resolve()
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.tabs.get(3).groupId, -1)
  assert.equal(b.logs()[0].modelStatus, 'preferences-changed')
  assert.deepEqual(b.local[GROUPING_PREFERENCES_KEY], [])
  b.addTab(4, { url: 'https://example.com/review', title: '显示器评测' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  assert.equal(model.prompts[1].manualPreferences.length, 0)
})

test('a grouping event that wakes a fresh worker still records the explicit user choice', async t => {
  const b = browser()
  b.groups.set(9, { id: 9, title: '采购资料', windowId: 1, color: 'green' })
  b.tabs.set(1, { id: 1, groupId: 9, windowId: 1, url: 'https://example.com/monitor', title: '显示器' })
  const model = creatingModel()
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { groupId: 9 }, { ...b.tabs.get(1) })
  await waitFor(() => b.local[GROUPING_PREFERENCES_KEY]?.length === 1)
  assert.equal(b.local[GROUPING_PREFERENCES_KEY][0].groupTitle, '采购资料')
  assert.equal(model.prompts.length, 0)
})

test('one app example remains a clue but consistent distinct-page choices can establish an app grouping habit', async t => {
  for (const count of [1, 2]) await t.test(`${count} examples`, async st => {
    const b = browser()
    b.groups.set(9, { id: 9, title: '文档', windowId: 1, color: 'green' })
    b.local[GROUPING_PREFERENCES_KEY] = Array.from({ length: count }, (_, index) => ({ id: `pref-${index}`, url: `https://wap.example/route-${index}?appId=123&envId=7`, title: 'WAP', choice: 'group', groupTitle: '文档', count: 1, updatedAt: index + 1 }))
    const model = taskRoutingModel(payload => ({ action: 'join', groupId: 9, manualPreferenceId: payload.manualPreferences[0].id }))
    st.after(startWorker(b, model))
    b.addTab(1, { url: 'https://wap.example/new-route?appId=123&envId=7', title: 'WAP' })
    await waitFor(() => b.logs().length === 1)
    assert.equal(b.tabs.get(1).groupId, count === 2 ? 9 : -1)
    assert.equal(b.logs()[0].via, count === 2 ? 'preference' : 'none')
  })
})

test('restoring a generic user-chosen group name requires a real applicable manual preference', async t => {
  for (const known of [true, false]) await t.test(known ? 'known user label' : 'invented preference ID', async st => {
    const b = browser()
    if (known) b.local[GROUPING_PREFERENCES_KEY] = [{ id: 'pref-docs', url: 'https://example.com/review', title: '显示器评测', choice: 'group', groupTitle: '文档', count: 1, updatedAt: 1 }]
    const model = taskRoutingModel(() => ({ action: 'create', title: '文档', manualPreferenceId: 'pref-docs' }))
    st.after(startWorker(b, model))
    b.addTab(1, { url: 'https://example.com/review', title: '显示器评测' })
    await waitFor(() => b.logs().length === 1)
    assert.equal(b.groups.size, known ? 1 : 0)
    assert.equal(b.logs()[0].via, known ? 'preference' : 'none')
    if (known) assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '文档')
  })
})

function joinTravelTask(payload: any) {
  return { action: 'join', groupId: 9, taskMatch: {
    basis: 'same-task', targetEvidence: payload.target.content?.excerpt || payload.target.title, groupEvidence: '旅行攻略',
  } }
}

function seedInitGroup(b: ReturnType<typeof browser>) {
  b.groups.set(7, { id: 7, title: '了解源起 INIT', windowId: 1, color: 'blue' })
  b.tabs.set(1, { id: 1, windowId: 1, groupId: 7, url: 'https://init.example/', title: '源起 INIT' })
  b.tabs.set(2, { id: 2, windowId: 1, groupId: 7, url: 'https://alidocs.dingtalk.com/', title: '文档 · 钉钉文档' })
}

test('sales documents cannot join INIT using platform, source-only or missing evidence, including a same-title create', async t => {
  const scenarios = [
    { name: 'platform-only', answer: { action: 'join', groupId: 7, taskMatch: { basis: 'same-task', targetEvidence: '钉钉文档', groupEvidence: '钉钉文档' } } },
    { name: 'source-only', answer: { action: 'join', groupId: 7, taskMatch: { basis: 'same-task', targetEvidence: '源起 INIT', groupEvidence: '源起 INIT' } } },
    { name: 'different-task', answer: { action: 'join', groupId: 7, taskMatch: { basis: 'same-platform', targetEvidence: '碰一下销售过程管理', groupEvidence: '源起 INIT' } } },
    { name: 'missing evidence', answer: { action: 'join', groupId: 7 } },
    { name: 'create with the existing title', answer: { action: 'create', title: '了解源起 INIT' } },
  ]
  for (const scenario of scenarios) await t.test(scenario.name, async st => {
    const b = browser()
    seedInitGroup(b)
    const model = taskRoutingModel(() => ({ ...scenario.answer, reason: '两个页面使用同一文档平台' }))
    st.after(startWorker(b, model))
    b.addTab(3, { url: 'https://alidocs.dingtalk.com/i/sales', title: '碰一下销售过程管理 · 钉钉文档', openerTabId: 2 })
    await waitFor(() => b.logs().length === 1)
    assert.equal(b.tabs.get(3).groupId, -1)
    assert.equal(b.groups.size, 1)
    assert.equal(b.groups.get(7).title, '了解源起 INIT')
    assert.equal(b.logs()[0].result, 'ungrouped')
    assert.equal(b.logs()[0].modelAction, scenario.answer.action)
    assert.equal(b.logs()[0].modelStatus, 'unverified')
    assert.equal(b.logs()[0].reason, '两个页面使用同一文档平台')
    assert.equal(model.prompts[0].source.groupId, 7)
  })
})

test('related sales documents can still join on the same platform with grounded task evidence', async t => {
  const b = browser()
  b.groups.set(7, { id: 7, title: '跟进碰一下销售', windowId: 1, color: 'blue' })
  b.tabs.set(1, { id: 1, windowId: 1, groupId: 7, url: 'https://alidocs.dingtalk.com/i/plan', title: '碰一下销售过程管理 · 钉钉文档' })
  const model = taskRoutingModel(() => ({ action: 'join', groupId: 7,
    taskMatch: { basis: 'same-task', targetEvidence: '碰一下销售周报', groupEvidence: '碰一下销售过程管理' },
    reason: '周报和过程管理都用于跟进碰一下销售',
  }))
  t.after(startWorker(b, model))
  b.addTab(2, { url: 'https://alidocs.dingtalk.com/i/report', title: '碰一下销售周报 · 钉钉文档', openerTabId: 1 })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'join'))
  assert.equal(b.tabs.get(2).groupId, 7)
  assert.equal(b.logs()[0].reason, '周报和过程管理都用于跟进碰一下销售')
  assert.equal(model.prompts.length, 1)
})

test('a generic document portal stays ungrouped and is reconsidered when its real task title loads', async t => {
  const b = browser()
  seedInitGroup(b)
  const model = taskRoutingModel(payload => payload.target.title === '文档 · 钉钉文档'
    ? { action: 'join', groupId: 7, taskMatch: { basis: 'same-task', targetEvidence: '文档', groupEvidence: '文档' } }
    : { action: 'create', title: '跟进碰一下销售' })
  t.after(startWorker(b, model))
  b.addTab(3, { url: 'https://alidocs.dingtalk.com/i/sales', title: '文档 · 钉钉文档', openerTabId: 2 })
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.tabs.get(3).groupId, -1)
  b.chrome.tabs.onUpdated.emit(3, { status: 'complete' })
  b.tabs.get(3).title = '碰一下销售过程管理 · 钉钉文档'
  b.chrome.tabs.onUpdated.emit(3, { title: b.tabs.get(3).title })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  assert.equal(b.groups.get(b.tabs.get(3).groupId).title, '跟进碰一下销售')
  assert.equal(b.tabs.get(1).groupId, 7)
  assert.equal(model.prompts.length, 2)
  b.chrome.tabs.onUpdated.emit(3, { groupId: b.tabs.get(3).groupId })
  assert.equal(model.prompts.length, 2)
})

test('a real title arriving during inference discards a stale provisional task', async t => {
  const b = browser()
  const gate = deferred()
  const model = taskRoutingModel(async payload => {
    if (payload.target.title === '文档 · 钉钉文档') { await gate.promise; return { action: 'create', title: '浏览文档任务' } }
    return { action: 'create', title: '跟进碰一下销售' }
  })
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'https://alidocs.dingtalk.com/i/sales', title: '文档 · 钉钉文档' })
  await waitFor(() => model.prompts.length === 1)
  b.tabs.get(1).title = '碰一下销售过程管理 · 钉钉文档'
  b.chrome.tabs.onUpdated.emit(1, { title: b.tabs.get(1).title })
  gate.resolve()
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  assert.equal(b.groups.size, 1)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '跟进碰一下销售')
  assert.equal(model.prompts.length, 2)
})

test('changed grouped content joins a better task group across sites without renaming the source', async t => {
  const b = browser()
  existingTaskGroup(b)
  seedTravelGroup(b)
  const model = taskRoutingModel(payload => {
    assert.equal(payload.currentGroup.id, 7)
    assert.ok(payload.groups.some((group: any) => group.id === 9))
    return joinTravelTask(payload)
  })
  t.after(startWorker(b, model))
  Object.assign(b.tabs.get(1), { url: 'https://example.com/travel', title: '日本旅行计划' })
  b.chrome.tabs.onUpdated.emit(1, { url: 'https://example.com/travel' })
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => b.tabs.get(1).groupId === 9, 3000)
  assert.equal(b.tabs.get(2).groupId, 7)
  assert.equal(b.groups.get(7).title, 'example.com')
  await waitFor(() => b.logs().some((entry: any) => entry.trigger === 'page-update' && entry.result === 'join'))
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal(model.prompts.length, 1, 'automatic moves must not cause another reassignment loop')
})

test('changed grouped content creates a specifically named task group when no group fits', async t => {
  const b = browser()
  existingTaskGroup(b)
  const model = taskRoutingModel(() => ({ action: 'create', title: '规划日本旅行' }))
  t.after(startWorker(b, model))
  b.tabs.get(1).title = '日本旅行安排'
  b.chrome.tabs.onUpdated.emit(1, { title: '日本旅行安排' })
  await waitFor(() => b.tabs.get(1).groupId !== 7, 3000)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '规划日本旅行')
  assert.equal(b.tabs.get(2).groupId, 7)
  assert.equal(b.groups.get(7).title, 'example.com')
})

test('leave and API errors preserve the current group with no domain fallback', async t => {
  const b = browser()
  existingTaskGroup(b)
  const model = taskRoutingModel(() => ({ action: 'leave' }))
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => b.logs().some((entry: any) => entry.trigger === 'page-update'), 3000)
  assert.equal(b.tabs.get(1).groupId, 7)
  assert.equal(b.groups.size, 1)
  assert.equal(b.logs()[0].result, 'kept')
  assert.equal(b.logs()[0].modelAction, 'leave')
})

test('two changed members are both evaluated instead of one group debounce losing a tab', async t => {
  const b = browser()
  existingTaskGroup(b)
  seedTravelGroup(b)
  const model = taskRoutingModel(joinTravelTask)
  t.after(startWorker(b, model))
  b.tabs.get(1).title = '旅行路线'
  b.tabs.get(2).title = '旅行住宿'
  b.chrome.tabs.onUpdated.emit(1, { title: '旅行路线' })
  b.chrome.tabs.onUpdated.emit(2, { title: '旅行住宿' })
  await waitFor(() => b.tabs.get(1).groupId === 9 && b.tabs.get(2).groupId === 9, 3500)
  assert.equal(model.prompts.length, 2)
})

test('a second navigation while inference is pending discards the old move', async t => {
  const b = browser()
  existingTaskGroup(b)
  seedTravelGroup(b)
  const gate = deferred()
  const model = taskRoutingModel(async payload => { await gate.promise; return joinTravelTask(payload) })
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => model.prompts.length === 1, 3000)
  b.tabs.get(1).url = 'https://example.com/work'
  gate.resolve()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(b.tabs.get(1).groupId, 7)
})

test('a manual move while inference is pending wins over a model reassignment', async t => {
  const b = browser()
  existingTaskGroup(b)
  seedTravelGroup(b)
  b.groups.set(12, { id: 12, title: '我的任务', windowId: 1, color: 'red' })
  const gate = deferred()
  const model = taskRoutingModel(async payload => { await gate.promise; return joinTravelTask(payload) })
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => model.prompts.length === 1, 3000)
  b.tabs.get(1).groupId = 12
  b.chrome.tabs.onUpdated.emit(1, { groupId: 12 })
  gate.resolve()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(b.tabs.get(1).groupId, 12)
})

test('an ungrouped workbench is reconsidered when useful body content loads at an unchanged URL and title', async t => {
  const b = browser()
  b.sync.TA_SETTING.rememberClickSource = true
  let excerpt = '研发平台'
  ;(b.chrome as any).scripting = { executeScript: async () => [{ result: { description: '', headings: [], excerpt } }] }
  const model = taskRoutingModel(payload => payload.target.content?.excerpt.includes('campus-console')
    ? { action: 'create', title: '发布校园应用' } : { action: 'leave' })
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'https://wap.example/publish?appId=123', title: 'WAP' })
  await waitFor(() => b.logs().length === 1)
  assert.equal(b.tabs.get(1).groupId, -1)
  excerpt = '应用 campus-console，当前预发环境，集成发布'
  const changed = { type: 'ta:page-content-changed', url: b.tabs.get(1).url, signature: 'abc123' }
  b.chrome.runtime.onMessage.emit(changed, { tab: { id: 1 }, frameId: 0 })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '发布校园应用')
  b.chrome.runtime.onMessage.emit(changed, { tab: { id: 1 }, frameId: 0 })
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal(model.prompts.length, 2)
})

test('body changes during an initial request are evaluated after it finishes even when the title remains generic', async t => {
  const b = browser()
  b.sync.TA_SETTING.rememberClickSource = true
  let excerpt = '研发平台'
  ;(b.chrome as any).scripting = { executeScript: async () => [{ result: { description: '', headings: [], excerpt } }] }
  const gate = deferred()
  const model = taskRoutingModel(async payload => {
    if (payload.target.content?.excerpt === '研发平台') { await gate.promise; return { action: 'leave' } }
    return { action: 'create', title: '发布校园应用' }
  })
  t.after(startWorker(b, model))
  b.addTab(1, { url: 'https://wap.example/publish?appId=123', title: 'WAP' })
  await waitFor(() => model.prompts.length === 1)
  excerpt = 'campus-console 应用的预发发布'
  b.chrome.runtime.onMessage.emit({ type: 'ta:page-content-changed', url: b.tabs.get(1).url, signature: 'abc234' }, { tab: { id: 1 }, frameId: 0 })
  await new Promise(resolve => setTimeout(resolve, 30))
  gate.resolve()
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'create'))
  assert.equal(model.prompts.length, 2)
  assert.equal(b.groups.get(b.tabs.get(1).groupId).title, '发布校园应用')
})

test('generic platform titles use group page content as matching evidence when content capture is enabled', async t => {
  const b = browser()
  b.sync.TA_SETTING.rememberClickSource = true
  b.groups.set(7, { id: 7, title: 'WAP', windowId: 1, color: 'blue' })
  b.tabs.set(1, { id: 1, windowId: 1, groupId: 7, url: 'https://wap.example/publish?appId=123', title: 'WAP' })
  ;(b.chrome as any).scripting = { executeScript: async () => [{ result: { description: '', headings: [], excerpt: 'campus-console 应用的预发集成发布' } }] }
  const model = taskRoutingModel(payload => {
    assert.match(payload.groups[0].tabs[0].content.excerpt, /campus-console/)
    return { action: 'join', groupId: 7, taskMatch: { basis: 'same-task', targetEvidence: 'campus-console', groupEvidence: 'campus-console' } }
  })
  t.after(startWorker(b, model))
  b.addTab(2, { url: 'https://wap.example/iterations?appId=123', title: 'WAP' })
  await waitFor(() => b.logs().some((entry: any) => entry.result === 'join'))
  assert.equal(b.tabs.get(2).groupId, 7)
  assert.equal(model.prompts.length, 1)
})

test('a partly unknown group of opaque pages cannot be renamed from just one app summary', async t => {
  const b = browser()
  b.sync.TA_SETTING.rememberClickSource = true
  b.groups.set(7, { id: 7, title: 'WAP', windowId: 1, color: 'blue' })
  for (let id = 1; id <= 5; id++) b.tabs.set(id, { id, windowId: 1, groupId: 7, url: `https://wap.example/publish?appId=${id}`, title: 'WAP' })
  ;(b.chrome as any).scripting = { executeScript: async ({ target }: any) => [{ result: { description: '', headings: [], excerpt: `应用 app-${target.tabId} 的发布` } }] }
  const model = taskRoutingModel(payload => {
    assert.equal(payload.currentGroup.allowRename, false)
    return { action: 'rename', title: '发布某个应用' }
  })
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => b.logs().some((entry: any) => entry.trigger === 'page-update'), 3000)
  assert.equal(b.groups.get(7).title, 'WAP')
  assert.equal(b.logs()[0].result, 'kept')
})

test('body-only changes at a constant URL use fresh text and ignore duplicate notifications', async t => {
  const b = browser()
  existingTaskGroup(b)
  seedTravelGroup(b)
  b.sync.TA_SETTING.rememberClickSource = true
  let excerpt = '日本旅行计划与住宿'
  ;(b.chrome as any).scripting = { executeScript: async () => [{ result: { description: '', headings: [], excerpt } }] }
  const model = taskRoutingModel(payload => {
    assert.equal(payload.target.content.excerpt, excerpt)
    return joinTravelTask(payload)
  })
  t.after(startWorker(b, model))
  const message = { type: 'ta:page-content-changed', url: b.tabs.get(1).url, signature: 'abc123' }
  b.chrome.runtime.onMessage.emit(message, { tab: { id: 1 }, frameId: 0 })
  await waitFor(() => b.tabs.get(1).groupId === 9, 3000)
  b.chrome.runtime.onMessage.emit(message, { tab: { id: 1 }, frameId: 0 })
  await new Promise(resolve => setTimeout(resolve, 1200))
  assert.equal(model.prompts.length, 1)
})

test('body notifications are ignored without capture opt-in or from a child frame', async t => {
  const b = browser()
  existingTaskGroup(b)
  const model = taskRoutingModel(() => ({ action: 'create', title: '不应创建' }))
  t.after(startWorker(b, model))
  const message = { type: 'ta:page-content-changed', url: b.tabs.get(1).url, signature: 'abc123' }
  b.chrome.runtime.onMessage.emit(message, { tab: { id: 1 }, frameId: 0 })
  b.chrome.runtime.onMessage.emit(message, { tab: { id: 1 }, frameId: 5 })
  await new Promise(resolve => setTimeout(resolve, 1200))
  assert.equal(model.prompts.length, 0)
  assert.equal(b.tabs.get(1).groupId, 7)
})

test('content that changes again during inference cannot be moved by the stale response', async t => {
  const b = browser()
  existingTaskGroup(b)
  seedTravelGroup(b)
  b.sync.TA_SETTING.rememberClickSource = true
  let excerpt = '日本旅行'
  ;(b.chrome as any).scripting = { executeScript: async () => [{ result: { description: '', headings: [], excerpt } }] }
  const gate = deferred()
  const model = taskRoutingModel(async payload => { await gate.promise; return joinTravelTask(payload) })
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => model.prompts.length === 1, 3000)
  excerpt = '回到显示器评测'
  gate.resolve()
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(b.tabs.get(1).groupId, 7)
})

test('API failure while rechecking an existing tab keeps its current group', async t => {
  const b = browser()
  existingTaskGroup(b)
  const model = { respond: async () => { throw new Error('offline') } }
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => b.logs().some((entry: any) => entry.trigger === 'page-update'), 3000)
  assert.equal(b.tabs.get(1).groupId, 7)
  assert.equal(b.groups.size, 1)
  assert.equal(b.logs()[0].result, 'kept')
  assert.equal(b.logs()[0].modelStatus, 'error')
})

test('a pinned tab is never reassigned and a destination moved to another window is rejected', async t => {
  const b = browser()
  existingTaskGroup(b)
  seedTravelGroup(b)
  const gate = deferred()
  const model = taskRoutingModel(async payload => { await gate.promise; return joinTravelTask(payload) })
  t.after(startWorker(b, model))
  b.tabs.get(1).pinned = true
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal(model.prompts.length, 0)
  b.tabs.get(1).pinned = false
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => model.prompts.length === 1, 3000)
  b.groups.get(9).windowId = 2
  gate.resolve()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(b.tabs.get(1).groupId, 7)
})

test('another member changing during inference retries the unchanged target once with a fresh snapshot', async t => {
  const b = browser()
  existingTaskGroup(b)
  seedTravelGroup(b)
  const gate = deferred()
  let calls = 0
  const model = taskRoutingModel(async payload => {
    if (++calls === 1) await gate.promise
    return joinTravelTask(payload)
  })
  t.after(startWorker(b, model))
  b.chrome.tabs.onUpdated.emit(1, { status: 'complete' })
  await waitFor(() => model.prompts.length === 1, 3000)
  b.tabs.get(2).title = '另一个页面的任务发生变化'
  gate.resolve()
  await waitFor(() => b.tabs.get(1).groupId === 9, 3000)
  assert.equal(model.prompts.length, 2)
})
