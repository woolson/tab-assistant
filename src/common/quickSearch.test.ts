import assert from 'node:assert/strict'
import test from 'node:test'
import { isQuickSearchUrl, prepareQuickSearch, quickSearchKey, searchQuickSearch, quickSearchFallbackReason, quickSearchFaviconUrl, quickSearchSize, recoverQuickSearchHistoryTitles, type QuickSearchItem } from './quickSearch.ts'

function tab(id: number, title: string, url = `https://example.com/${id}`, extra: Partial<QuickSearchItem> = {}): QuickSearchItem {
  return { key: `tab:${id}`, kind: 'tab', id: String(id), title, url, ...extra }
}
function bookmark(id: string, title: string, folder = ''): QuickSearchItem {
  return { key: `bookmark:${id}`, kind: 'bookmark', id, title, url: `https://saved.example/${id}`, folder }
}
function history(id: string, title: string, lastAccessed: number): QuickSearchItem {
  return { key: `history:${id}`, kind: 'history', id, title, url: `https://visited.example/${id}`, lastAccessed }
}

test('history recovers exact-page titles, preserves recorded titles and searches recovered text', () => {
  const missing = history('missing', 'https://visited.example/missing', 300)
  const recorded = history('recorded', '访问时的网页标题', 200)
  const unknown = history('unknown', '\u200b', 100)
  const entries = recoverQuickSearchHistoryTitles([missing, recorded, unknown], [
    { ...bookmark('missing', '自定义收藏名称'), url: missing.url },
    tab(1, '\u200b发布流水线 · 应用管理', missing.url),
    tab(2, '当前页面的新标题', recorded.url),
    tab(3, '另一任务的标题', `${unknown.url}?task=other`),
  ])
  assert.deepEqual(entries.map(item => item.title), ['发布流水线 · 应用管理', '访问时的网页标题', ''])
  assert.equal(searchQuickSearch(prepareQuickSearch(entries), '发布流水线', 'history')[0].id, 'missing')
  assert.equal(missing.title, missing.url, 'recovery must not mutate the browser snapshot')
})

test('a title already obtained in the recent index survives an incomplete query response', () => {
  const recent = history('page', '操作手册', 100)
  const query = { ...recent, title: '', lastAccessed: 200 }
  assert.equal(recoverQuickSearchHistoryTitles([query], [recent])[0].title, '操作手册')
})

test('saved search dimensions reject invalid data and normalize finite pixel sizes', () => {
  for (const value of [null, undefined, {}, '760x560', { width: '760', height: 560 }, { width: 760, height: NaN }, { width: Infinity, height: 560 }, { width: 0, height: 560 }, { width: 760, height: -1 }]) {
    assert.equal(quickSearchSize(value), undefined)
  }
  assert.deepEqual(quickSearchSize({ width: 900.4, height: 650.8, left: 200 }), { width: 900, height: 651 })
  assert.deepEqual(quickSearchSize({ width: 1e9, height: 1e9 }), { width: 10_000, height: 10_000 })
})

test('fallback explanations only accept known launch reasons', () => {
  assert.equal(quickSearchFallbackReason('permission-denied'), 'permission-denied')
  assert.equal(quickSearchFallbackReason('frame-timeout'), 'frame-timeout')
  assert.equal(quickSearchFallbackReason('toString'), undefined)
  assert.equal(quickSearchFallbackReason('arbitrary page text'), undefined)
  assert.equal(quickSearchFallbackReason(null), undefined)
})

test('search matches Chinese titles, URLs, bookmark folders and multiple keywords across fields', () => {
  const index = prepareQuickSearch([
    tab(1, '高校碰一碰意向提报', 'https://campus.example/report'),
    bookmark('2', '接口说明', '工作 / 高校 / 开发文档'),
    tab(3, 'WAP', 'https://wap.example/publish?appId=12364'),
  ])
  assert.equal(searchQuickSearch(index, '高校提报')[0].id, '1')
  assert.equal(searchQuickSearch(index, '高校 接口')[0].id, '2')
  assert.equal(searchQuickSearch(index, 'appid=12364')[0].id, '3')
  assert.equal(searchQuickSearch(index, '完全不存在的目标').length, 0)
})

test('exact titles rank before broad substring matches and matching open tabs precede equal bookmarks', () => {
  const index = prepareQuickSearch([bookmark('saved', 'React'), tab(1, 'React examples'), tab(2, 'React'), tab(3, 'Related guide', 'https://react.example/')])
  assert.deepEqual(searchQuickSearch(index, 'react').slice(0, 3).map(item => item.key), ['tab:2', 'bookmark:saved', 'tab:1'])
})

test('fuzzy matching handles subsequences, one-letter mistakes, transpositions and accents', () => {
  const index = prepareQuickSearch([tab(1, 'Monitor reviews'), tab(2, 'Café Handbook'), tab(3, 'Project Navigation')])
  for (const query of ['mntr', 'monitr', 'monitro', 'monitar']) assert.equal(searchQuickSearch(index, query)[0].id, '1', query)
  assert.equal(searchQuickSearch(index, 'cafe')[0].id, '2')
  assert.equal(searchQuickSearch(index, 'pjnav')[0].id, '3')
})

test('invisible title watermarks and encoded Chinese URLs remain searchable', () => {
  const prefix = '\u200b\u202c\ufeff\u200d\u200c\u2063\u2062'.repeat(10)
  const index = prepareQuickSearch([tab(1, prefix + '弹外抽数操作手册'), tab(2, '文档', 'https://docs.example/%E9%AB%98%E6%A0%A1')])
  assert.equal(searchQuickSearch(index, '抽数手册')[0].id, '1')
  assert.equal(searchQuickSearch(index, '高校')[0].id, '2')
})

test('all items are searched before applying the result limit and source filters', () => {
  const items = Array.from({ length: 200 }, (_, index) => tab(index, `Page ${index}`))
  items.push(bookmark('target', '非常具体的收藏目标'))
  const index = prepareQuickSearch(items)
  assert.equal(searchQuickSearch(index, '非常具体的收藏目标', 'all', 10)[0].id, 'target')
  assert.equal(searchQuickSearch(index, '', 'bookmark').length, 1)
  assert.equal(searchQuickSearch(index, '', 'tab', 10).length, 10)
})

test('empty search favors the current window and recent tabs', () => {
  const index = prepareQuickSearch([tab(1, 'Old tab', undefined, { lastAccessed: 1 }), tab(2, 'Current tab', undefined, { currentWindow: true, lastAccessed: 2 }), bookmark('3', 'Saved page')])
  assert.equal(searchQuickSearch(index, '')[0].id, '2')
  assert.equal(searchQuickSearch(index, '').at(-1)?.kind, 'bookmark')
})

test('empty and whitespace queries sort tabs by last visit across windows before applying a limit', () => {
  const index = prepareQuickSearch([
    tab(1, 'Current active tab', undefined, { currentWindow: true, active: true, lastAccessed: 100 }),
    tab(2, 'Other-window recent tab', undefined, { currentWindow: false, lastAccessed: 300 }),
    tab(3, 'Latest visited tab', undefined, { currentWindow: false, lastAccessed: 400 }),
    tab(4, 'Older current-window tab', undefined, { currentWindow: true, lastAccessed: 50 }),
    bookmark('saved', 'Saved page'),
  ])
  assert.deepEqual(searchQuickSearch(index, '').map(item => item.id), ['3', '2', '1', '4', 'saved'])
  assert.deepEqual(searchQuickSearch(index, '   ', 'tab', 2).map(item => item.id), ['3', '2'])
  assert.deepEqual(searchQuickSearch(index, '', 'bookmark').map(item => item.id), ['saved'])
})

test('entering a search term keeps an exact title above a more recently visited loose match', () => {
  const index = prepareQuickSearch([
    tab(1, 'Campus', undefined, { lastAccessed: 100 }),
    tab(2, 'Campus examples', undefined, { currentWindow: true, lastAccessed: 500 }),
  ])
  assert.deepEqual(searchQuickSearch(index, '').map(item => item.id), ['2', '1'])
  assert.deepEqual(searchQuickSearch(index, 'campus').map(item => item.id), ['1', '2'])
})

test('history has its own fuzzy source filter and defaults to most recently visited first', () => {
  const index = prepareQuickSearch([
    history('old', '高校碰一碰操作手册', 100), history('recent', '发布流水线', 300),
    history('middle', 'Campus Handbook', 200), tab(1, '高校碰一碰'), bookmark('saved', '高校碰一碰'),
  ])
  assert.deepEqual(searchQuickSearch(index, '  ', 'history').map(item => item.id), ['recent', 'middle', 'old'])
  assert.deepEqual(searchQuickSearch(index, '高校手册', 'history').map(item => item.id), ['old'])
  assert.deepEqual(searchQuickSearch(index, 'camups', 'history').map(item => item.id), ['middle'])
  assert.deepEqual(searchQuickSearch(index, 'visited.example/old', 'history').map(item => item.id), ['old'])
  assert.equal(searchQuickSearch(index, '高校手册')[0].kind, 'history')
  assert.deepEqual(searchQuickSearch(index, '').map(item => item.kind), ['tab', 'bookmark', 'history', 'history', 'history'])
})

test('keyboard selection wraps, handles empty lists and leaves IME composition untouched', () => {
  assert.deepEqual(quickSearchKey('ArrowDown', false, 2, 3), { select: 0 })
  assert.deepEqual(quickSearchKey('ArrowUp', false, 0, 3), { select: 2 })
  assert.deepEqual(quickSearchKey('Enter', false, 0, 3), { open: true })
  assert.deepEqual(quickSearchKey('Enter', false, 0, 0), {})
  assert.deepEqual(quickSearchKey('Escape', false, 0, 0), { close: true })
  for (const key of ['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape']) assert.deepEqual(quickSearchKey(key, true, 1, 3), {})
})

test('left and right cycle through source types in both directions, even when results are empty', () => {
  assert.deepEqual(quickSearchKey('ArrowRight', false, 0, 0, 'all'), { filter: 'tab' })
  assert.deepEqual(quickSearchKey('ArrowRight', false, 0, 3, 'tab'), { filter: 'bookmark' })
  assert.deepEqual(quickSearchKey('ArrowRight', false, 0, 1, 'bookmark'), { filter: 'history' })
  assert.deepEqual(quickSearchKey('ArrowRight', false, 0, 0, 'history'), { filter: 'all' })
  assert.deepEqual(quickSearchKey('ArrowLeft', false, 0, 0, 'all'), { filter: 'history' })
  assert.deepEqual(quickSearchKey('ArrowLeft', false, 0, 0, 'history'), { filter: 'bookmark' })
  assert.deepEqual(quickSearchKey('ArrowLeft', false, 0, 3, 'bookmark'), { filter: 'tab' })
  assert.deepEqual(quickSearchKey('ArrowLeft', false, 0, 1, 'tab'), { filter: 'all' })
})

test('favicon requests use the browser extension endpoint with safely encoded page URLs', t => {
  const original = (globalThis as any).chrome
  ;(globalThis as any).chrome = { runtime: { getURL: (path: string) => `chrome-extension://fixture${path}` } }
  t.after(() => { (globalThis as any).chrome = original })
  const page = 'https://docs.example/path?q=校园&size=99#section'
  const icon = new URL(quickSearchFaviconUrl(page)!)
  assert.equal(icon.protocol, 'chrome-extension:')
  assert.equal(icon.hostname, 'fixture')
  assert.equal(icon.pathname, '/_favicon/')
  assert.equal(icon.searchParams.get('pageUrl'), new URL(page).href)
  assert.equal(icon.searchParams.get('size'), '32')
  assert.equal(quickSearchFaviconUrl('javascript:alert(1)'), undefined)
  assert.equal(quickSearchFaviconUrl('data:text/html,hello'), undefined)
  assert.equal(quickSearchFaviconUrl('not a URL'), undefined)
})

test('palette identity excludes HTTP lookalikes and accepts extension query parameters', () => {
  assert.equal(isQuickSearchUrl('chrome-extension://fixture/quick-search.html?sourceWindowId=1'), true)
  assert.equal(isQuickSearchUrl('https://example.com/quick-search.html'), false)
  assert.equal(isQuickSearchUrl('chrome-extension://fixture/popup.html'), false)
})
