import {
  QUICK_SEARCH_COMMAND, QUICK_SEARCH_LOAD, QUICK_SEARCH_HISTORY, QUICK_SEARCH_OPEN, QUICK_SEARCH_PAGE, QUICK_SEARCH_TOGGLE, QUICK_SEARCH_CLOSE, QUICK_SEARCH_READY, QUICK_SEARCH_SIZE_KEY,
  isQuickSearchUrl, readQuickSearchShortcut, quickSearchSize, quickSearchPageTitle,
  type QuickSearchItem, type QuickSearchHistory, type QuickSearchResponse, type QuickSearchSnapshot, type QuickSearchFallbackReason, type QuickSearchSize,
} from '../../common/quickSearch'
import { cleanTaskText } from '../../common/taskText'
import { quickSearchAppearance, type QuickSearchAppearance } from '../../common/quickSearchAppearance'
import { manageQuickSearchOverlay } from '../ContentScript/quickSearchOverlay'

let opening: Promise<void> | undefined
const overlayKey = (tabId: number) => `TA_QUICK_SEARCH_OVERLAY:${tabId}`
const pendingOverlays = new Map<string, (appearance?: QuickSearchAppearance) => void>()
interface OverlaySession { session: string; tabId: number; windowId: number; url: string }

type OverlayResult = { opened: true } | { opened: false; reason: QuickSearchFallbackReason }

async function showInPage(tab: chrome.tabs.Tab | undefined, size: QuickSearchSize | undefined, appearance: QuickSearchAppearance): Promise<OverlayResult> {
  if (tab?.id === undefined) return { opened: false, reason: 'no-active-tab' }
  if (!/^(https?|file):/.test(tab.url || tab.pendingUrl || '')) return { opened: false, reason: 'restricted-page' }
  const tabId = tab.id
  const session = crypto.randomUUID()
  const url = chrome.runtime.getURL(`${QUICK_SEARCH_PAGE}?mode=overlay&sourceWindowId=${tab.windowId}&session=${session}`)
  let timer: ReturnType<typeof setTimeout> | undefined
  const ready = new Promise<QuickSearchAppearance | true>(resolve => {
    pendingOverlays.set(session, prepared => resolve(prepared || true))
  })
  let stage: 'session' | 'injection' | 'ready' = 'session'
  try {
    // Session storage survives a service-worker restart. The web page cannot read this token or the iframe's results.
    await chrome.storage.session.set({ [overlayKey(tabId)]: { session, tabId, windowId: tab.windowId, url } })
    stage = 'injection'
    await chrome.scripting.executeScript({ target: { tabId }, files: ['glassRuntime.bundle.js'] })
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: manageQuickSearchOverlay, args: ['toggle', url, size || null, appearance] })
    const state = results[0]?.result?.state
    if (state === 'open') {
      stage = 'ready'
      // A busy renderer may delay executeScript. Start the iframe's budget only after it exists.
      const deadline = new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 2000) })
      const prepared = await Promise.race([ready, deadline])
      if (prepared) {
        if (timer) clearTimeout(timer)
        const shown = await chrome.scripting.executeScript({ target: { tabId }, func: manageQuickSearchOverlay, args: ['reveal', url, null, prepared === true ? appearance : prepared] })
        if (shown[0]?.result?.state === 'open') return { opened: true }
      }
    }
    if (state !== 'closed') await chrome.scripting.executeScript({ target: { tabId }, func: manageQuickSearchOverlay, args: ['close', url] }).catch(() => {})
    await chrome.storage.session.remove(overlayKey(tabId))
    return state === 'closed' ? { opened: true } : { opened: false, reason: stage === 'ready' ? 'frame-timeout' : 'injection-failed' }
  } catch (error) {
    await chrome.storage.session?.remove(overlayKey(tabId)).catch(() => {})
    const text = error instanceof Error ? error.message : ''
    return { opened: false, reason: stage === 'injection' && /cannot access|permission|not allowed|cannot be scripted/i.test(text) ? 'permission-denied' : 'injection-failed' }
  } finally {
    if (timer) clearTimeout(timer)
    pendingOverlays.delete(session)
  }
}

export function quickSearchBounds(window: Pick<chrome.windows.Window, 'left' | 'top' | 'width' | 'height'>, preferred?: QuickSearchSize) {
  const parentWidth = window.width || 1200, parentHeight = window.height || 800
  const size = quickSearchSize(preferred) || { width: 760, height: 560 }
  const width = Math.min(Math.max(360, size.width), Math.max(1, parentWidth - 48))
  const height = Math.min(Math.max(280, size.height), Math.max(1, parentHeight - 96))
  return { width, height, left: Math.round((window.left || 0) + (parentWidth - width) / 2), top: Math.round((window.top || 0) + (parentHeight - height) / 2) }
}

async function readQuickSearchSize(): Promise<QuickSearchSize | undefined> {
  try { return quickSearchSize((await chrome.storage.local.get(QUICK_SEARCH_SIZE_KEY))[QUICK_SEARCH_SIZE_KEY]) }
  catch { return undefined }
}

async function readQuickSearchAppearance(): Promise<QuickSearchAppearance> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      chrome.storage.sync.get('TA_SETTING').then(stored => quickSearchAppearance(stored.TA_SETTING)),
      new Promise<QuickSearchAppearance>(resolve => { timer = setTimeout(() => resolve(quickSearchAppearance()), 120) }),
    ])
  } catch { return quickSearchAppearance() }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

/** Native fallback windows report committed bounds; only this extension's search popup is adjusted. */
export async function rememberQuickSearchPopupSize(windowId: number): Promise<void> {
  const window = await chrome.windows.get(windowId).catch(() => undefined)
  if (!window || window.type !== 'popup' || window.state && window.state !== 'normal') return
  const tabs = await chrome.tabs.query({ windowId })
  const palette = tabs.find(tab => tab.url?.startsWith(chrome.runtime.getURL(QUICK_SEARCH_PAGE)) && isQuickSearchUrl(tab.url))
  if (!palette) return
  const source = sourceWindowId({ url: palette.url })
  const parent = source === undefined ? undefined : await chrome.windows.get(source).catch(() => undefined)
  if (!parent || parent.type !== 'normal') return
  const preferred = await readQuickSearchSize()
  const size = quickSearchSize(window)
  if (!size) return
  const expected = quickSearchBounds(parent, preferred)
  const next = quickSearchBounds(parent, size)
  if (size.width !== expected.width || size.height !== expected.height) {
    await chrome.storage.local.set({ [QUICK_SEARCH_SIZE_KEY]: { width: next.width, height: next.height } })
  }
  if (window.left !== next.left || window.width !== next.width || window.height !== next.height) {
    await chrome.windows.update(windowId, { left: next.left, width: next.width, height: next.height })
  }
}

export function toggleQuickSearch(invokingTab?: chrome.tabs.Tab): Promise<void> {
  if (opening) return opening
  opening = (async () => {
    const [tabs, lastNormal, size, appearance] = await Promise.all([
      chrome.tabs.query({}), chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined),
      readQuickSearchSize(),
      readQuickSearchAppearance(),
    ])
    // commands.onCommand supplies the exact tab for which activeTab permission was granted.
    const current = invokingTab?.id === undefined ? undefined : await chrome.tabs.get(invokingTab.id).catch(() => undefined)
    const source = current ? await chrome.windows.get(current.windowId).catch(() => lastNormal) : lastNormal
    const previous = tabs.find(tab => isQuickSearchUrl(tab.url) && tab.url?.startsWith(chrome.runtime.getURL(QUICK_SEARCH_PAGE)))
    if (previous) {
      try {
        const window = await chrome.windows.get(previous.windowId)
        if (current?.id === previous.id || !current && window.focused && (window.type === 'popup' || previous.active)) {
          if (window.type === 'popup') await chrome.windows.remove(previous.windowId)
          else if (previous.id !== undefined) await chrome.tabs.remove(previous.id)
          return
        }
      } catch { /* A just-closed palette should not affect the current page. */ }
    }
    const active = current || tabs.find(tab => tab.active && tab.windowId === source?.id && !isQuickSearchUrl(tab.url))
    const result = await showInPage(active, size, appearance)
    if (result.opened) {
      if (previous) {
        const window = await chrome.windows.get(previous.windowId).catch(() => undefined)
        if (window?.type === 'popup') await chrome.windows.remove(previous.windowId).catch(() => {})
      }
      return
    }
    const params = new URLSearchParams({ sourceWindowId: String(source?.id ?? ''), fallback: result.reason })
    const url = chrome.runtime.getURL(`${QUICK_SEARCH_PAGE}?${params}`)
    // Reuse a surviving fallback only after trying the invoking page, and refresh its explanation.
    if (previous?.id !== undefined) {
      try {
        await chrome.tabs.update(previous.id, { url, active: true })
        const window = await chrome.windows.get(previous.windowId)
        await chrome.windows.update(previous.windowId, { focused: true, ...(window.type === 'popup' ? quickSearchBounds(source || {}, size) : {}) })
        return
      } catch { /* It may have closed on losing focus. */ }
    }
    await chrome.windows.create({
      type: 'popup', focused: true, ...quickSearchBounds(source || {}, size),
      ...(source?.incognito ? { incognito: true } : {}),
      url,
    })
  })().finally(() => { opening = undefined })
  return opening
}

function sourceWindowId(sender: chrome.runtime.MessageSender): number | undefined {
  if (sender.tab && (sender.frameId || 0) > 0) return sender.tab.windowId
  try {
    const raw = new URL(sender.url || '').searchParams.get('sourceWindowId')
    return raw !== null && raw !== '' && Number.isSafeInteger(Number(raw)) && Number(raw) >= 0 ? Number(raw) : undefined
  } catch { return undefined }
}

export function flattenBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[]): QuickSearchItem[] {
  const items: QuickSearchItem[] = []
  const pending = nodes.slice().reverse().map(node => ({ node, path: [] as string[] }))
  while (pending.length) {
    const { node, path } = pending.pop() as typeof pending[number]
    if (node.url) {
      if (!openableSavedUrl(node.url)) continue
      items.push({ key: `bookmark:${node.id}`, kind: 'bookmark', id: node.id, title: cleanTaskText(node.title) || node.url, url: node.url, folder: path.join(' / ') })
    } else {
      const next = node.title ? [...path, cleanTaskText(node.title)] : path
      for (let index = (node.children?.length || 0) - 1; index >= 0; index--) pending.push({ node: (node.children as chrome.bookmarks.BookmarkTreeNode[])[index], path: next })
    }
  }
  return items
}

function openableSavedUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (['http:', 'https:', 'file:'].includes(url.protocol)) return true
    if (url.protocol === 'about:') return url.pathname === 'blank'
    return ['edge:', 'chrome:'].includes(url.protocol) && ['settings', 'bookmarks', 'favorites', 'history', 'downloads', 'extensions', 'newtab', 'new-tab-page', 'help', 'flags', 'version', 'apps', 'inspect'].includes(url.hostname)
  } catch { return false }
}

/** Keep a bounded recent fuzzy index; typed queries also search the browser's full retained time range. */
export function loadQuickSearchHistory(query: unknown = ''): Promise<QuickSearchHistory> {
  const text = typeof query === 'string' ? cleanTaskText(query.slice(0, 160)).trim() : ''
  return new Promise(resolve => {
    if (!chrome.history?.search) { resolve({ items: [], available: false }); return }
    try {
      chrome.history.search({ text, startTime: 0, maxResults: text ? 1000 : 10_000 }, entries => {
        if (chrome.runtime.lastError) { resolve({ items: [], available: false }); return }
        const items: QuickSearchItem[] = []
        const seen = new Map<string, QuickSearchItem>()
        for (const entry of entries) {
          if (!entry.url || !openableSavedUrl(entry.url)) continue
          const title = quickSearchPageTitle({ title: entry.title || '', url: entry.url })
          const previous = seen.get(entry.url)
          if (previous) { if (!previous.title && title) previous.title = title; continue }
          const item: QuickSearchItem = { key: `history:${entry.id}`, kind: 'history', id: entry.id,
            title, url: entry.url, lastAccessed: entry.lastVisitTime }
          seen.set(entry.url, item)
          items.push(item)
        }
        resolve({ items, available: true })
      })
    } catch { resolve({ items: [], available: false }) }
  })
}

async function openSavedUrl(url: string, sender: chrome.runtime.MessageSender): Promise<QuickSearchResponse> {
  const source = sourceWindowId(sender)
  let target = source === undefined ? undefined : await chrome.windows.get(source).catch(() => undefined)
  if (!target || target.type !== 'normal') target = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined)
  if (target?.id !== undefined && target.type === 'normal') {
    await chrome.tabs.create({ windowId: target.id, url, active: true })
    await chrome.windows.update(target.id, { focused: true })
  } else await chrome.windows.create({ type: 'normal', url, focused: true })
  return { ok: true }
}

export async function loadQuickSearch(sender: chrome.runtime.MessageSender): Promise<QuickSearchSnapshot> {
  const [tabs, groups, stored, shortcut, bookmarks] = await Promise.all([
    chrome.tabs.query({}), chrome.tabGroups.query({}).catch(() => []), chrome.storage.sync.get('TA_SETTING'), readQuickSearchShortcut(),
    chrome.bookmarks?.getTree ? Promise.resolve().then(() => chrome.bookmarks.getTree()).then(nodes => ({ nodes, available: true })).catch(() => ({ nodes: [], available: false })) : Promise.resolve({ nodes: [], available: false }),
  ])
  const source = sourceWindowId(sender)
  const names = new Map(groups.map(group => [group.id, group.title || '']))
  const items: QuickSearchItem[] = tabs.filter(tab => tab.id !== undefined && !isQuickSearchUrl(tab.url)).map(tab => ({
    key: `tab:${tab.id}`, kind: 'tab', id: String(tab.id), title: cleanTaskText(tab.title || '') || tab.url || '', url: tab.url || tab.pendingUrl || '',
    windowId: tab.windowId, currentWindow: tab.windowId === source, active: tab.active,
    group: names.get(tab.groupId ?? -1), lastAccessed: (tab as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed,
  }))
  const setting = stored.TA_SETTING
  const fallback = chrome.i18n?.getUILanguage?.() || 'zh-CN'
  return {
    items: items.concat(flattenBookmarks(bookmarks.nodes)), sourceWindowId: source, shortcut, bookmarksAvailable: bookmarks.available,
    language: setting?.language === 'en-US' || setting?.language === 'zh-CN' ? setting.language : fallback.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US',
    theme: setting?.theme === 'dark' || setting?.theme === 'light' ? setting.theme : 'system',
    appearance: quickSearchAppearance(setting),
  }
}

export async function openQuickSearchItem(value: unknown, sender: chrome.runtime.MessageSender): Promise<QuickSearchResponse> {
  if (!value || typeof value !== 'object') return { ok: false, error: 'not-found' }
  const item = value as { kind?: unknown; id?: unknown; url?: unknown }
  if (item.kind === 'tab' && typeof item.id === 'string' && /^\d+$/.test(item.id)) {
    const tab = await chrome.tabs.get(Number(item.id)).catch(() => undefined)
    if (!tab || tab.id === undefined || isQuickSearchUrl(tab.url)) return { ok: false, error: 'not-found' }
    if (tab.groupId !== undefined && tab.groupId !== -1) await chrome.tabGroups.update(tab.groupId, { collapsed: false }).catch(() => {})
    await chrome.tabs.update(tab.id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
    return { ok: true }
  }
  if (item.kind === 'bookmark' && typeof item.id === 'string') {
    const bookmark = await chrome.bookmarks.get(item.id).then(nodes => nodes[0]).catch(() => undefined)
    if (!bookmark?.url) return { ok: false, error: 'not-found' }
    if (!openableSavedUrl(bookmark.url)) return { ok: false, error: 'unsupported-url' }
    return openSavedUrl(bookmark.url, sender)
  }
  if (item.kind === 'history' && typeof item.id === 'string' && typeof item.url === 'string') {
    if (!openableSavedUrl(item.url)) return { ok: false, error: 'unsupported-url' }
    // Recheck the actual history record, including deletions, rather than trusting a stale UI URL.
    const exists = await new Promise<boolean>(resolve => {
      if (!chrome.history?.getVisits) { resolve(false); return }
      try { chrome.history.getVisits({ url: item.url as string }, visits => resolve(!chrome.runtime.lastError && visits.some(visit => visit.id === item.id))) }
      catch { resolve(false) }
    })
    return exists ? openSavedUrl(item.url, sender) : { ok: false, error: 'not-found' }
  }
  return { ok: false, error: 'not-found' }
}

function trustedSender(sender: chrome.runtime.MessageSender, paletteOnly: boolean): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false
  try {
    const url = new URL(sender.url)
    const root = new URL(chrome.runtime.getURL('/'))
    if (url.protocol !== root.protocol || url.host !== root.host) return false
    return paletteOnly ? url.pathname === `/${QUICK_SEARCH_PAGE}` : ['/popup.html', '/sidepanel.html', `/${QUICK_SEARCH_PAGE}`].includes(url.pathname)
  } catch { return false }
}

async function overlaySession(sender: chrome.runtime.MessageSender): Promise<OverlaySession | undefined> {
  if (sender.tab?.id === undefined || !sender.frameId) return undefined
  const url = new URL(sender.url || '')
  if (url.searchParams.get('mode') !== 'overlay') return undefined
  const stored = await chrome.storage.session.get(overlayKey(sender.tab.id))
  const current = stored[overlayKey(sender.tab.id)] as OverlaySession | undefined
  return current && current.session === url.searchParams.get('session') && current.tabId === sender.tab.id && current.windowId === sender.tab.windowId ? current : undefined
}

async function handleSearchMessage(message: { type: string; item?: unknown; query?: unknown; appearance?: unknown }, sender: chrome.runtime.MessageSender): Promise<QuickSearchResponse> {
  const embedded = (sender.frameId || 0) > 0 || new URL(sender.url || '').searchParams.get('mode') === 'overlay'
  const overlay = embedded ? await overlaySession(sender) : undefined
  // quick-search.html is embeddable, but only the iframe created by this shortcut may read private search data.
  if (embedded && !overlay) return { ok: false, error: 'unavailable' }
  if (message.type === QUICK_SEARCH_READY) {
    if (!overlay) return { ok: false, error: 'unavailable' }
    pendingOverlays.get(overlay.session)?.(message.appearance === undefined ? undefined : quickSearchAppearance(message.appearance))
    return { ok: true }
  }
  if (message.type === QUICK_SEARCH_CLOSE) {
    if (!overlay) return { ok: false, error: 'unavailable' }
    await chrome.scripting.executeScript({ target: { tabId: overlay.tabId }, func: manageQuickSearchOverlay, args: ['close', overlay.url] })
    const stored = await chrome.storage.session.get(overlayKey(overlay.tabId))
    if (stored[overlayKey(overlay.tabId)]?.session === overlay.session) await chrome.storage.session.remove(overlayKey(overlay.tabId))
    return { ok: true }
  }
  if (message.type === QUICK_SEARCH_LOAD) return { ok: true, snapshot: await loadQuickSearch(sender) }
  if (message.type === QUICK_SEARCH_HISTORY) return { ok: true, history: await loadQuickSearchHistory(message.query) }
  if (message.type === QUICK_SEARCH_OPEN) return openQuickSearchItem(message.item, sender)
  await toggleQuickSearch()
  return { ok: true }
}

/** Register outside assistant bootstrap so a slow AI queue cannot delay the shortcut. */
export function setupQuickSearch() {
  const boundsTimers = new Map<number, ReturnType<typeof setTimeout>>()
  chrome.windows.onBoundsChanged?.addListener(window => {
    if (window.id === undefined || window.type !== 'popup') return
    const id = window.id
    const previous = boundsTimers.get(id)
    if (previous) clearTimeout(previous)
    boundsTimers.set(id, setTimeout(() => {
      boundsTimers.delete(id)
      void rememberQuickSearchPopupSize(id).catch(() => {})
    }, 100))
  })
  chrome.windows.onRemoved?.addListener(id => {
    const timer = boundsTimers.get(id)
    if (timer) clearTimeout(timer)
    boundsTimers.delete(id)
  })
  chrome.commands?.onCommand?.addListener((command: string, tab?: chrome.tabs.Tab) => {
    if (command === QUICK_SEARCH_COMMAND) void toggleQuickSearch(tab).catch(() => {})
  })
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (![QUICK_SEARCH_LOAD, QUICK_SEARCH_HISTORY, QUICK_SEARCH_OPEN, QUICK_SEARCH_TOGGLE, QUICK_SEARCH_CLOSE, QUICK_SEARCH_READY].includes(message?.type)) return false
    if (!trustedSender(sender, message.type !== QUICK_SEARCH_TOGGLE)) return false
    const reply = (value: QuickSearchResponse) => { try { respond(value) } catch { /* The search window may have closed. */ } }
    void handleSearchMessage(message, sender).then(reply, () => reply({ ok: false, error: 'unavailable' }))
    return true
  })
  chrome.tabs.onRemoved?.addListener(tabId => { void chrome.storage.session?.remove(overlayKey(tabId)).catch(() => {}) })
}
