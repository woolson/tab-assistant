import assert from 'node:assert/strict'
import test from 'node:test'
import { flattenBookmarks, loadQuickSearch, loadQuickSearchHistory, openQuickSearchItem, quickSearchBounds, rememberQuickSearchPopupSize, setupQuickSearch, toggleQuickSearch } from './quickSearch.ts'
import { QUICK_SEARCH_COMMAND, QUICK_SEARCH_LOAD, QUICK_SEARCH_HISTORY, QUICK_SEARCH_READY, QUICK_SEARCH_CLOSE, QUICK_SEARCH_OPEN, QUICK_SEARCH_SIZE_KEY } from '../../common/quickSearch.ts'

function event() {
  const listeners: Array<(...args: any[]) => any> = []
  return { listeners, addListener: (callback: (...args: any[]) => any) => listeners.push(callback), emit: (...args: any[]) => listeners.map(callback => callback(...args)) }
}

function fixture(t: any) {
  const original = (globalThis as any).chrome
  const windows = new Map<number, any>([[1, { id: 1, type: 'normal', focused: true, left: -1400, top: 50, width: 1200, height: 900 }], [2, { id: 2, type: 'normal', focused: false }]])
  const tabs = new Map<number, any>([[10, { id: 10, windowId: 1, title: '校园提报', url: 'https://campus.example/', groupId: 7, active: true }], [20, { id: 20, windowId: 2, title: '接口文档', url: 'https://docs.example/', groupId: 8 }]])
  const tree: any[] = [{ id: '0', title: '', children: [{ id: '1', title: '收藏夹栏', children: [{ id: '2', title: '开发', children: [{ id: 'saved', title: '接口说明', url: 'https://saved.example/docs' }] }] }] }]
  const actions: any[] = []
  const history = new Map<string, any>([['visited', { id: 'visited', title: '历史校园提报', url: 'https://archived.example/campus', lastVisitTime: 100 }]])
  const historyQueries: any[] = []
  const session: Record<string, any> = {}
  const local: Record<string, any> = {}
  const localWrites: any[] = []
  const setting: Record<string, any> = { language: 'zh-CN', theme: 'dark' }
  let nextWindow = 90, nextTab = 90
  const chrome = {
    runtime: { id: 'fixture', onMessage: event(), getURL: (path: string) => `chrome-extension://fixture/${path.replace(/^\//, '')}` },
    commands: { onCommand: event(), getAll: (callback: any) => callback([{ name: QUICK_SEARCH_COMMAND, shortcut: 'Command+Shift+K' }]) },
    storage: { local: {
      get: async (key: string) => ({ [key]: local[key] }),
      set: async (value: any) => { localWrites.push(value); Object.assign(local, value) },
    }, sync: { get: async () => ({ TA_SETTING: setting }) }, session: {
      get: async (key: string) => ({ [key]: session[key] }),
      set: async (value: any) => { Object.assign(session, value) },
      remove: async (key: string) => { delete session[key] },
    } },
    scripting: { executeScript: async (_options: any): Promise<any[]> => { throw new Error('injection unavailable') } },
    tabs: {
      onRemoved: event(),
      query: async ({ windowId }: any = {}) => [...tabs.values()].filter(tab => windowId === undefined || tab.windowId === windowId).map(tab => ({ ...tab })),
      get: async (id: number) => { if (!tabs.has(id)) throw new Error('closed'); return { ...tabs.get(id) } },
      remove: async (id: number) => { actions.push(['remove-tab', id]); tabs.delete(id) },
      update: async (id: number, value: any) => { actions.push(['tab', id, value]); Object.assign(tabs.get(id), value) },
      create: async (value: any) => { actions.push(['new-tab', value]); const tab = { id: ++nextTab, ...value }; tabs.set(tab.id, tab); return tab },
    },
    tabGroups: { query: async () => [{ id: 7, title: '校园销售' }, { id: 8, title: '开发文档' }], update: async (id: number, value: any) => { actions.push(['group', id, value]) } },
    bookmarks: {
      getTree: async () => structuredClone(tree),
      get: async (id: string) => { const found = flattenBookmarks(tree).find(item => item.id === id); if (!found) throw new Error('deleted'); return [{ id, title: found.title, url: found.url }] },
    },
    history: {
      search: (query: any, callback: any) => {
        historyQueries.push(query)
        callback([...history.values()].filter(item => `${item.title} ${item.url}`.toLowerCase().includes(query.text.toLowerCase()))
          .sort((a, b) => b.lastVisitTime - a.lastVisitTime).slice(0, query.maxResults))
      },
      getVisits: ({ url }: { url: string }, callback: any) => callback([...history.values()].filter(item => item.url === url).map(item => ({ id: item.id, visitId: `visit:${item.id}` }))),
    },
    windows: {
      onBoundsChanged: event(), onRemoved: event(),
      getLastFocused: async () => { const normal = [...windows.values()].find(window => window.type === 'normal'); if (!normal) throw new Error('closed'); return { ...normal } },
      get: async (id: number) => { if (!windows.has(id)) throw new Error('closed'); return { ...windows.get(id) } },
      update: async (id: number, value: any) => { actions.push(['window', id, value]); Object.assign(windows.get(id), value) },
      remove: async (id: number) => { actions.push(['remove-window', id]); windows.delete(id); for (const [key, tab] of tabs) if (tab.windowId === id) tabs.delete(key) },
      create: async (value: any) => { actions.push(['create-window', value]); const window = { id: ++nextWindow, ...value }; windows.set(window.id, window); tabs.set(++nextTab, { id: nextTab, windowId: window.id, url: value.url, title: '快捷搜索' }); return window },
    },
  }
  ;(globalThis as any).chrome = chrome
  t.after(() => { (globalThis as any).chrome = original })
  return { chrome, tabs, windows, tree, history, historyQueries, actions, session, local, localWrites, setting, sender: { id: 'fixture', url: 'chrome-extension://fixture/quick-search.html?sourceWindowId=1' } }
}

test('remembered popup dimensions stay centered on negative screen coordinates and fit a smaller parent', () => {
  assert.deepEqual(quickSearchBounds({ left: -1400, top: 50, width: 1200, height: 900 }, { width: 900, height: 640 }), { width: 900, height: 640, left: -1250, top: 180 })
  assert.deepEqual(quickSearchBounds({ left: 0, top: 0, width: 600, height: 400 }, { width: 900, height: 640 }), { width: 552, height: 304, left: 24, top: 48 })
  assert.deepEqual(quickSearchBounds({ left: 0, top: 0, width: 300, height: 300 }, { width: 1, height: 1 }), { width: 252, height: 204, left: 24, top: 48 })
})

test('opening an overlay restores the local preference before the first injection', async t => {
  const f = fixture(t)
  const injections: any[] = []
  f.local[QUICK_SEARCH_SIZE_KEY] = { width: 900, height: 640 }
  readyOverlay(f, injections)
  await toggleQuickSearch(f.tabs.get(10))
  assert.deepEqual(injections[0].args[2], { width: 900, height: 640 })
  assert.equal(f.localWrites.length, 0)
})

test('the overlay and search snapshot receive the same sanitized appearance before showing', async t => {
  const f = fixture(t)
  Object.assign(f.setting, { quickSearchMaterial: 'frosted', quickSearchTransparency: 62, quickSearchBlur: 32, unrelated: 'not-for-injection' })
  const injections: any[] = []
  readyOverlay(f, injections)
  await toggleQuickSearch(f.tabs.get(10))
  const expected = { quickSearchMaterial: 'frosted', quickSearchTransparency: 62, quickSearchBlur: 32, theme: 'dark' }
  assert.deepEqual(injections[0].args[3], expected)
  assert.deepEqual((await loadQuickSearch(f.sender)).appearance, expected)
})

test('a slow settings read cannot block opening and the ready frame supplies the final material before reveal', async t => {
  const f = fixture(t)
  setupQuickSearch()
  f.chrome.storage.sync.get = () => new Promise(() => {})
  const prepared = { quickSearchMaterial: 'classic', quickSearchTransparency: 30, quickSearchBlur: 16, theme: 'light' }
  const injections: any[] = []
  f.chrome.scripting.executeScript = async options => {
    if (options.files) return []
    injections.push(options)
    if (options.args[0] === 'toggle') {
      const sender = { id: 'fixture', tab: { id: 10, windowId: 1 }, frameId: 3, url: options.args[1] }
      queueMicrotask(() => { void message(f, QUICK_SEARCH_READY, sender, { appearance: prepared }) })
    }
    return [{ result: { state: 'open' } }]
  }
  await toggleQuickSearch(f.tabs.get(10))
  assert.equal(injections[0].args[3].quickSearchMaterial, 'frosted')
  assert.deepEqual(injections.find(options => options.args[0] === 'reveal').args[3], prepared)
  assert.equal(f.actions.some(action => action[0] === 'create-window'), false)
})

test('a standalone fallback also opens with the remembered size', async t => {
  const f = fixture(t)
  f.local[QUICK_SEARCH_SIZE_KEY] = { width: 900, height: 640 }
  await toggleQuickSearch(f.tabs.get(10))
  const created = f.actions.find(action => action[0] === 'create-window')[1]
  assert.equal(created.width, 900)
  assert.equal(created.height, 640)
  assert.equal(created.left, -1250)
  assert.equal(f.localWrites.length, 0)
})

test('resizing a native search popup remembers its size and recenters without an update loop', async t => {
  const f = fixture(t)
  f.windows.set(91, { id: 91, type: 'popup', state: 'normal', left: -1000, top: 200, width: 900, height: 640 })
  f.tabs.set(91, { id: 91, windowId: 91, url: f.sender.url })
  await rememberQuickSearchPopupSize(91)
  assert.deepEqual(f.local[QUICK_SEARCH_SIZE_KEY], { width: 900, height: 640 })
  assert.deepEqual(f.actions, [['window', 91, { left: -1250, width: 900, height: 640 }]])
  await rememberQuickSearchPopupSize(91)
  assert.equal(f.actions.length, 1)
  assert.equal(f.localWrites.length, 1)
})

test('automatic viewport clamping does not replace the remembered size and unrelated windows are untouched', async t => {
  const f = fixture(t)
  f.local[QUICK_SEARCH_SIZE_KEY] = { width: 1000, height: 800 }
  f.windows.set(91, { id: 91, type: 'popup', state: 'normal', ...quickSearchBounds(f.windows.get(1), f.local[QUICK_SEARCH_SIZE_KEY]) })
  f.tabs.set(91, { id: 91, windowId: 91, url: f.sender.url })
  await rememberQuickSearchPopupSize(91)
  await rememberQuickSearchPopupSize(1)
  f.windows.set(92, { id: 92, type: 'popup', left: 0, width: 400, height: 300 })
  f.tabs.set(92, { id: 92, windowId: 92, url: 'https://example.com/quick-search.html' })
  await rememberQuickSearchPopupSize(92)
  assert.deepEqual(f.local[QUICK_SEARCH_SIZE_KEY], { width: 1000, height: 800 })
  assert.equal(f.localWrites.length, 0)
  assert.equal(f.actions.length, 0)
})

test('bookmark traversal includes nested folders and excludes script/data or destructive browser URLs', () => {
  const items = flattenBookmarks([{ id: '0', title: '', children: [{ id: '1', title: '工作', children: [
    { id: 'safe', title: '文档', url: 'https://docs.example' }, { id: 'script', title: '脚本', url: 'javascript:alert(1)' },
    { id: 'crash', title: '退出', url: 'edge://quit' }, { id: 'settings', title: '设置', url: 'edge://settings/' },
  ] }] }])
  assert.deepEqual(items.map(item => item.id), ['safe', 'settings'])
  assert.equal(items[0].folder, '工作')
})

test('snapshot includes all windows, real bookmarks and group names without including the search window', async t => {
  const f = fixture(t)
  f.tabs.set(11, { id: 11, windowId: 1, title: '本窗口其他标签一', url: 'https://campus.example/first', active: false })
  f.tabs.set(12, { id: 12, windowId: 1, title: '本窗口其他标签二', url: 'https://campus.example/second', active: false })
  f.tabs.get(20).active = true
  f.tabs.set(99, { id: 99, windowId: 99, title: 'Search', url: f.sender.url })
  const snapshot = await loadQuickSearch(f.sender)
  assert.equal(snapshot.items.filter(item => item.kind === 'tab').length, 4)
  assert.equal(snapshot.items.filter(item => item.kind === 'bookmark').length, 1)
  assert.equal(snapshot.sourceWindowId, 1)
  assert.deepEqual(snapshot.items.filter(item => item.currentWindow).map(item => item.id), ['10', '11', '12'])
  assert.deepEqual([...new Set(snapshot.items.filter(item => item.currentWindow).map(item => item.windowId))], [1])
  assert.deepEqual(snapshot.items.filter(item => item.currentWindow && item.active).map(item => item.id), ['10'])
  assert.equal(snapshot.items.find(item => item.id === '10')?.group, '校园销售')
  assert.equal(snapshot.items.find(item => item.id === '20')?.currentWindow, false)
  assert.equal(snapshot.items.find(item => item.id === 'saved')?.folder, '收藏夹栏 / 开发')
  assert.equal(snapshot.language, 'zh-CN')
  assert.equal(snapshot.shortcut, 'Command+Shift+K')
})

test('bookmark API errors leave tabs searchable and report the missing data', async t => {
  const f = fixture(t)
  f.chrome.bookmarks.getTree = async () => { throw new Error('permission') }
  const snapshot = await loadQuickSearch(f.sender)
  assert.equal(snapshot.bookmarksAvailable, false)
  assert.equal(snapshot.items.length, 2)
})

test('history loads independently, searches beyond the last day and removes unsafe or duplicate URLs', async t => {
  const f = fixture(t)
  f.history.set('invisible', { id: 'invisible', title: '\u200b操作手册', url: 'https://manual.example/', lastVisitTime: 300 })
  f.history.set('duplicate', { id: 'duplicate', title: '旧标题', url: 'https://manual.example/', lastVisitTime: 200 })
  f.history.set('script', { id: 'script', title: '脚本', url: 'javascript:alert(1)' })
  f.history.set('crash', { id: 'crash', title: '退出', url: 'edge://quit' })
  f.history.set('empty', { id: 'empty', title: '无地址' })
  const result = await loadQuickSearchHistory()
  assert.equal(result.available, true)
  assert.deepEqual(result.items.map(item => item.id), ['invisible', 'visited'])
  assert.deepEqual(result.items[0], { key: 'history:invisible', kind: 'history', id: 'invisible', title: '操作手册', url: 'https://manual.example/', lastAccessed: 300 })
  assert.deepEqual(f.historyQueries, [{ text: '', startTime: 0, maxResults: 10_000 }])
  assert.equal((await loadQuickSearch(f.sender)).items.some(item => item.kind === 'history'), false)
})

test('typed history lookup finds an older page outside the recent fuzzy index and bounds query length', async t => {
  const f = fixture(t)
  for (let i = 0; i < 10_000; i++) f.history.set(String(i), { id: String(i), title: `Recent ${i}`, url: `https://recent.example/${i}`, lastVisitTime: 1000 + i })
  assert.equal((await loadQuickSearchHistory()).items.some(item => item.id === 'visited'), false)
  const result = await loadQuickSearchHistory('  校园提报  ')
  assert.deepEqual(result.items.map(item => item.id), ['visited'])
  assert.deepEqual(f.historyQueries.at(-1), { text: '校园提报', startTime: 0, maxResults: 1000 })
  await loadQuickSearchHistory('a'.repeat(200))
  assert.equal(f.historyQueries.at(-1).text.length, 160)
})

test('duplicate history records recover a real title without changing the most recent visit identity', async t => {
  const f = fixture(t)
  f.history.clear()
  f.history.set('new', { id: 'new', title: 'https://manual.example/', url: 'https://manual.example/', lastVisitTime: 300 })
  f.history.set('old', { id: 'old', title: '\u200b发布操作手册', url: 'https://manual.example/', lastVisitTime: 200 })
  f.history.set('empty', { id: 'empty', url: 'https://unknown.example/', lastVisitTime: 100 })
  const result = await loadQuickSearchHistory()
  assert.equal(result.items.length, 2)
  assert.deepEqual(result.items[0], { key: 'history:new', kind: 'history', id: 'new', title: '发布操作手册', url: 'https://manual.example/', lastAccessed: 300 })
  assert.equal(result.items[1].title, '')
})

test('history permission errors and missing APIs do not affect tab or bookmark loading', async t => {
  const f = fixture(t)
  f.chrome.history.search = (_query, callback) => {
    ;(f.chrome.runtime as any).lastError = { message: 'permission denied' }
    callback([])
    delete (f.chrome.runtime as any).lastError
  }
  assert.deepEqual(await loadQuickSearchHistory(), { items: [], available: false })
  ;(f.chrome as any).history = undefined
  assert.deepEqual(await loadQuickSearchHistory(), { items: [], available: false })
  assert.equal((await loadQuickSearch(f.sender)).items.length, 3)
})

test('selecting a tab expands its group, activates it and focuses its actual window', async t => {
  const f = fixture(t)
  assert.deepEqual(await openQuickSearchItem({ kind: 'tab', id: '20' }, f.sender), { ok: true })
  assert.deepEqual(f.actions, [['group', 8, { collapsed: false }], ['tab', 20, { active: true }], ['window', 2, { focused: true }]])
  assert.deepEqual(await openQuickSearchItem({ kind: 'tab', id: '999' }, f.sender), { ok: false, error: 'not-found' })
})

test('bookmark activation rereads its saved URL and opens a new tab in the originating normal window', async t => {
  const f = fixture(t)
  await openQuickSearchItem({ kind: 'bookmark', id: 'saved', url: 'https://untrusted.example/' }, f.sender)
  assert.deepEqual(f.actions[0], ['new-tab', { windowId: 1, url: 'https://saved.example/docs', active: true }])
  assert.equal(f.actions[1][0], 'window')
})

test('unsafe or deleted bookmarks cannot execute and a closed source window falls back to another normal window', async t => {
  const f = fixture(t)
  f.chrome.bookmarks.get = async () => [{ id: 'bad', title: 'bad', url: 'javascript:alert(1)' }]
  assert.deepEqual(await openQuickSearchItem({ kind: 'bookmark', id: 'bad' }, f.sender), { ok: false, error: 'unsupported-url' })
  assert.equal(f.actions.length, 0)
  f.chrome.bookmarks.get = async () => [{ id: 'saved', title: 'saved', url: 'https://saved.example/' }]
  f.windows.delete(1)
  await openQuickSearchItem({ kind: 'bookmark', id: 'saved' }, f.sender)
  assert.equal(f.actions[0][1].windowId, 2)
})

test('history opens in a new tab in the originating window after checking the real history ID', async t => {
  const f = fixture(t)
  assert.deepEqual(await openQuickSearchItem({ kind: 'history', id: 'visited', url: 'https://archived.example/campus' }, f.sender), { ok: true })
  assert.deepEqual(f.actions, [['new-tab', { windowId: 1, url: 'https://archived.example/campus', active: true }], ['window', 1, { focused: true }]])
})

test('deleted, substituted and unsafe history results never open a new tab', async t => {
  const f = fixture(t)
  assert.deepEqual(await openQuickSearchItem({ kind: 'history', id: 'visited', url: 'https://untrusted.example/' }, f.sender), { ok: false, error: 'not-found' })
  assert.deepEqual(await openQuickSearchItem({ kind: 'history', id: 'another-id', url: 'https://archived.example/campus' }, f.sender), { ok: false, error: 'not-found' })
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'edge://quit']) {
    assert.deepEqual(await openQuickSearchItem({ kind: 'history', id: 'visited', url }, f.sender), { ok: false, error: 'unsupported-url' })
  }
  f.history.clear()
  assert.deepEqual(await openQuickSearchItem({ kind: 'history', id: 'visited', url: 'https://archived.example/campus' }, f.sender), { ok: false, error: 'not-found' })
  assert.equal(f.actions.length, 0)
})

test('command opens a centered single window and a repeated invocation toggles it closed', async t => {
  const f = fixture(t)
  await Promise.all([toggleQuickSearch(), toggleQuickSearch()])
  const created = f.actions.filter(action => action[0] === 'create-window')
  assert.equal(created.length, 1)
  assert.deepEqual(quickSearchBounds(f.windows.get(1)), { width: 760, height: 560, left: -1180, top: 220 })
  assert.equal(created[0][1].left, -1180)
  const url = new URL(created[0][1].url)
  assert.equal(url.searchParams.get('sourceWindowId'), '1')
  assert.equal(url.searchParams.get('fallback'), 'injection-failed')
  await toggleQuickSearch()
  assert.equal(f.actions.filter(action => action[0] === 'remove-window').length, 1)
})

test('background registers the shortcut directly and rejects search messages from web content', async t => {
  const f = fixture(t)
  setupQuickSearch()
  assert.equal(f.chrome.commands.onCommand.listeners.length, 1)
  let replied = false
  f.chrome.runtime.onMessage.emit({ type: QUICK_SEARCH_LOAD }, { id: 'fixture', url: 'https://page.example/' }, () => { replied = true })
  assert.equal(replied, false)
  const response = await new Promise<any>(resolve => f.chrome.runtime.onMessage.emit({ type: QUICK_SEARCH_LOAD }, f.sender, resolve))
  assert.equal(response.ok, true)
  assert.equal(response.snapshot.items.length, 3)
})

test('history lookup uses the same authenticated extension-only message path and forwards the query', async t => {
  const f = fixture(t)
  setupQuickSearch()
  let replied = false
  f.chrome.runtime.onMessage.emit({ type: QUICK_SEARCH_HISTORY }, { id: 'fixture', url: 'https://page.example/' }, () => { replied = true })
  assert.equal(replied, false)
  const embedded = { ...f.sender, tab: { id: 10, windowId: 1 }, frameId: 2 }
  assert.equal((await message(f, QUICK_SEARCH_HISTORY, embedded)).ok, false)
  assert.equal(f.historyQueries.length, 0)
  const response = await message(f, QUICK_SEARCH_HISTORY, f.sender, { query: '校园' })
  assert.equal(response.ok, true)
  assert.equal(response.history.items[0].kind, 'history')
  assert.deepEqual(f.historyQueries, [{ text: '校园', startTime: 0, maxResults: 1000 }])
})

function message(f: ReturnType<typeof fixture>, type: string, sender: any, value: object = {}) {
  return new Promise<any>(resolve => f.chrome.runtime.onMessage.emit({ type, ...value }, sender, resolve))
}

test('normal pages get an authorized in-page overlay and repeating the shortcut removes it without creating a window', async t => {
  const f = fixture(t)
  setupQuickSearch()
  let visible = false
  let sender: any
  let runtimeLoaded = false
  f.chrome.scripting.executeScript = async options => {
    if (options.files) {
      assert.deepEqual(options.files, ['glassRuntime.bundle.js'])
      await Promise.resolve()
      runtimeLoaded = true
      return []
    }
    assert.equal(runtimeLoaded, true, 'the optical runtime must be ready before mounting the overlay')
    assert.equal(options.target.tabId, 10)
    const [action, url] = options.args
    if (action === 'reveal') return [{ result: { state: 'open' } }]
    if (action === 'close' || visible) { visible = false; return [{ result: { state: 'closed' } }] }
    visible = true
    sender = { id: 'fixture', tab: { id: 10, windowId: 1 }, frameId: 3, url }
    queueMicrotask(() => { void message(f, QUICK_SEARCH_READY, sender) })
    return [{ result: { state: 'open' } }]
  }
  await Promise.all([toggleQuickSearch(), toggleQuickSearch()])
  assert.equal(visible, true)
  assert.equal(f.actions.length, 0)
  assert.equal((await message(f, QUICK_SEARCH_LOAD, sender)).snapshot.sourceWindowId, 1)
  assert.equal(Object.keys(f.session).length, 1)
  await toggleQuickSearch()
  assert.equal(visible, false)
  assert.equal(f.actions.length, 0)
  assert.equal(Object.keys(f.session).length, 0)
})

test('closing the embedded palette removes only its overlay and bookmarks still open in the host window', async t => {
  const f = fixture(t)
  setupQuickSearch()
  let sender: any
  const injections: any[] = []
  f.chrome.scripting.executeScript = async options => {
    if (options.files) return []
    injections.push(options)
    if (options.args[0] === 'toggle') {
      sender = { id: 'fixture', tab: { id: 10, windowId: 1 }, frameId: 5, url: options.args[1] }
      queueMicrotask(() => { void message(f, QUICK_SEARCH_READY, sender) })
      return [{ result: { state: 'open' } }]
    }
    return [{ result: { state: options.args[0] === 'reveal' ? 'open' : 'closed' } }]
  }
  await toggleQuickSearch()
  assert.equal((await message(f, QUICK_SEARCH_OPEN, sender, { item: { kind: 'bookmark', id: 'saved' } })).ok, true)
  assert.deepEqual(f.actions[0], ['new-tab', { windowId: 1, url: 'https://saved.example/docs', active: true }])
  assert.equal((await message(f, QUICK_SEARCH_CLOSE, sender)).ok, true)
  assert.equal(injections.at(-1).args[0], 'close')
  assert.equal(injections.at(-1).target.tabId, 10)
  assert.equal(f.actions.some(action => action[0] === 'remove-window'), false)
  assert.equal((await message(f, QUICK_SEARCH_LOAD, sender)).ok, false)
})

test('web-embedded extension pages need the correct per-tab token, including after a worker restart', async t => {
  const f = fixture(t)
  setupQuickSearch()
  const sender = { id: 'fixture', tab: { id: 10, windowId: 1 }, frameId: 2, url: 'chrome-extension://fixture/quick-search.html?mode=overlay&session=secret&sourceWindowId=999' }
  assert.equal((await message(f, QUICK_SEARCH_LOAD, sender)).ok, false)
  f.session['TA_QUICK_SEARCH_OVERLAY:10'] = { session: 'secret', tabId: 10, windowId: 1, url: sender.url }
  const response = await message(f, QUICK_SEARCH_LOAD, sender)
  assert.equal(response.ok, true)
  assert.equal(response.snapshot.sourceWindowId, 1)
  assert.equal((await message(f, QUICK_SEARCH_LOAD, { ...sender, url: sender.url.replace('secret', 'wrong') })).ok, false)
  assert.equal((await message(f, QUICK_SEARCH_LOAD, { ...sender, tab: { id: 20, windowId: 2 } })).ok, false)
  assert.equal((await message(f, QUICK_SEARCH_OPEN, { ...sender, url: 'chrome-extension://fixture/quick-search.html' }, { item: { kind: 'tab', id: '20' } })).ok, false)
  assert.equal(f.actions.length, 0)
  f.chrome.tabs.onRemoved.emit(10)
  assert.equal(Object.keys(f.session).length, 0)
})

test('restricted browser pages use the standalone fallback without trying page injection', async t => {
  const f = fixture(t)
  f.tabs.get(10).url = 'edge://newtab/'
  f.chrome.scripting.executeScript = async () => { assert.fail('a browser page cannot be injected') }
  await toggleQuickSearch()
  assert.equal(f.actions.filter(action => action[0] === 'create-window').length, 1)
  assert.equal(new URL(f.actions[0][1].url).searchParams.get('fallback'), 'restricted-page')
})

test('a blocked embedded frame is removed before falling back to the standalone search window', async t => {
  const f = fixture(t)
  const injections: string[] = []
  f.chrome.scripting.executeScript = async options => {
    if (options.files) return []
    injections.push(options.args[0])
    return [{ result: { state: options.args[0] === 'toggle' ? 'open' : 'closed' } }]
  }
  await toggleQuickSearch()
  assert.deepEqual(injections, ['toggle', 'close'])
  assert.equal(f.actions.filter(action => action[0] === 'create-window').length, 1)
  assert.equal(new URL(f.actions[0][1].url).searchParams.get('fallback'), 'frame-timeout')
  assert.equal(Object.keys(f.session).length, 0)
})

test('a search page opened as a normal tab can never make the shortcut close the whole browser window', async t => {
  const f = fixture(t)
  f.tabs.set(11, { id: 11, windowId: 1, active: true, url: f.sender.url })
  await toggleQuickSearch()
  assert.deepEqual(f.actions, [['remove-tab', 11]])
  assert.equal(f.windows.has(1), true)
  assert.equal(f.tabs.has(10), true)
})

function readyOverlay(f: ReturnType<typeof fixture>, injections: any[], beforeMount?: () => void) {
  setupQuickSearch()
  f.chrome.scripting.executeScript = async options => {
    if (options.files) return []
    injections.push(options)
    if (options.args[0] === 'reveal') return [{ result: { state: 'open' } }]
    if (options.args[0] !== 'toggle') return [{ result: { state: 'closed' } }]
    beforeMount?.()
    const tab = f.tabs.get(options.target.tabId)
    const sender = { id: 'fixture', tab: { id: tab.id, windowId: tab.windowId }, frameId: 3, url: options.args[1] }
    queueMicrotask(() => { void message(f, QUICK_SEARCH_READY, sender) })
    return [{ result: { state: 'open' } }]
  }
}

test('a busy page must receive its full ready deadline after injection actually finishes', async t => {
  const f = fixture(t)
  const injections: any[] = []
  t.mock.timers.enable({ apis: ['setTimeout'] })
  readyOverlay(f, injections, () => t.mock.timers.tick(2500))
  await toggleQuickSearch()
  assert.equal(f.actions.some(action => action[0] === 'create-window'), false)
  assert.deepEqual(injections.map(options => options.args[0]), ['toggle', 'reveal'])
})

test('the invoking tab wins over a stale last-focused window when opening the overlay', async t => {
  const f = fixture(t)
  const injections: any[] = []
  readyOverlay(f, injections)
  f.tabs.get(20).active = true
  await toggleQuickSearch(f.tabs.get(20))
  assert.equal(injections[0]?.target.tabId, 20)
  assert.equal(f.actions.length, 0)
})

test('the browser command listener forwards the exact invoking tab to the overlay', async t => {
  const f = fixture(t)
  const injections: any[] = []
  readyOverlay(f, injections)
  f.tabs.get(20).active = true
  f.chrome.commands.onCommand.emit(QUICK_SEARCH_COMMAND, f.tabs.get(20))
  await toggleQuickSearch() // Join the already-started command without starting a second operation.
  assert.equal(injections[0]?.target.tabId, 20)
  assert.equal(f.actions.length, 0)
})

test('a leftover standalone window must not intercept the shortcut from a normal web page', async t => {
  const f = fixture(t)
  const injections: any[] = []
  readyOverlay(f, injections)
  f.windows.set(90, { id: 90, type: 'popup', focused: false })
  f.tabs.set(90, { id: 90, windowId: 90, active: true, url: f.sender.url })
  await toggleQuickSearch(f.tabs.get(10))
  assert.equal(injections[0]?.target.tabId, 10)
  assert.equal(f.actions.some(action => action[0] === 'window' && action[1] === 90), false)
  assert.equal(f.actions.some(action => action[0] === 'create-window'), false)
})

test('a denied page permission is explained by the fallback instead of being silently treated as a protected page', async t => {
  const f = fixture(t)
  f.chrome.scripting.executeScript = async () => { throw new Error('Cannot access contents of url. Extension manifest must request permission.') }
  await toggleQuickSearch(f.tabs.get(10))
  const created = f.actions.find(action => action[0] === 'create-window')
  assert.equal(new URL(created[1].url).searchParams.get('fallback'), 'permission-denied')
})
