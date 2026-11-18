import { cleanTaskText } from './taskText'
import type { QuickSearchAppearance } from './quickSearchAppearance'

export const QUICK_SEARCH_COMMAND = 'toggle-quick-search'
export const QUICK_SEARCH_PAGE = 'quick-search.html'
export const QUICK_SEARCH_LOAD = 'ta:quick-search-load'
export const QUICK_SEARCH_HISTORY = 'ta:quick-search-history'
export const QUICK_SEARCH_OPEN = 'ta:quick-search-open'
export const QUICK_SEARCH_TOGGLE = 'ta:quick-search-toggle'
export const QUICK_SEARCH_CLOSE = 'ta:quick-search-close'
export const QUICK_SEARCH_READY = 'ta:quick-search-ready'
export const QUICK_SEARCH_FOCUS = 'ta:quick-search-focus'
export const QUICK_SEARCH_SIZE_KEY = 'TA_QUICK_SEARCH_SIZE'
export interface QuickSearchSize { width: number; height: number }

export function quickSearchSize(value: unknown): QuickSearchSize | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { width, height } = value as Partial<QuickSearchSize>
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined
  return { width: Math.max(1, Math.round(Math.min(10_000, width))), height: Math.max(1, Math.round(Math.min(10_000, height))) }
}

export type QuickSearchFallbackReason = 'restricted-page' | 'no-active-tab' | 'permission-denied' | 'injection-failed' | 'frame-timeout'

export function quickSearchFallbackReason(value: string | null): QuickSearchFallbackReason | undefined {
  return ['restricted-page', 'no-active-tab', 'permission-denied', 'injection-failed', 'frame-timeout'].includes(value || '') ? value as QuickSearchFallbackReason : undefined
}

export interface QuickSearchItem {
  key: string
  kind: 'tab' | 'bookmark' | 'history'
  id: string
  title: string
  url: string
  folder?: string
  group?: string
  windowId?: number
  currentWindow?: boolean
  active?: boolean
  lastAccessed?: number
}
export interface QuickSearchSnapshot {
  items: QuickSearchItem[]
  sourceWindowId?: number
  language: 'zh-CN' | 'en-US'
  theme: 'system' | 'light' | 'dark'
  appearance: QuickSearchAppearance
  shortcut: string
  bookmarksAvailable: boolean
}
export interface QuickSearchHistory { items: QuickSearchItem[]; available: boolean }
export type QuickSearchFilter = 'all' | QuickSearchItem['kind']
export const QUICK_SEARCH_FILTERS: readonly QuickSearchFilter[] = ['all', 'tab', 'bookmark', 'history']
export type QuickSearchResponse = { ok: true; snapshot?: QuickSearchSnapshot; history?: QuickSearchHistory } | { ok: false; error: 'unavailable' | 'not-found' | 'unsupported-url' }
export interface PreparedQuickSearchItem { item: QuickSearchItem; fields: string[] }

/** URL placeholders are not page titles. Keep recovery scoped to the exact page. */
export function quickSearchPageTitle(item: Pick<QuickSearchItem, 'title' | 'url'>): string {
  const title = cleanTaskText(item.title || '')
  if (!title || title === item.url) return ''
  if (/^(https?|file|edge|chrome):/i.test(title)) {
    try { if (new URL(title).href === new URL(item.url).href) return '' } catch { /* A title can contain URL-like text. */ }
  }
  return title
}

/** Fill missing history titles from existing local search data without fetching old pages. */
export function recoverQuickSearchHistoryTitles(history: QuickSearchItem[], known: QuickSearchItem[]): QuickSearchItem[] {
  const titles = new Map<string, string>()
  for (const kind of ['tab', 'history', 'bookmark']) for (const item of known) {
    if (item.kind !== kind || titles.has(item.url)) continue
    const title = quickSearchPageTitle(item)
    if (title) titles.set(item.url, title)
  }
  return history.map(item => ({ ...item, title: quickSearchPageTitle(item) || titles.get(item.url) || '' }))
}

function fold(value: string) {
  return cleanTaskText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function prepareQuickSearch(items: QuickSearchItem[]): PreparedQuickSearchItem[] {
  return items.map(item => {
    let url = item.url
    try { url = decodeURIComponent(url) } catch { /* Keep malformed escapes searchable. */ }
    return { item, fields: [item.title, url, item.folder || '', item.group || ''].map(fold) }
  })
}

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let left = 0, right = 0, edits = 0
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) { left++; right++; continue }
    if (++edits > 1) return false
    if (a[left] === b[right + 1] && a[left + 1] === b[right]) { left += 2; right += 2 }
    else if (a.length > b.length) left++
    else if (b.length > a.length) right++
    else { left++; right++ }
  }
  return edits + (left < a.length || right < b.length ? 1 : 0) <= 1
}

function matchScore(value: string, needle: string): number {
  if (!value) return -1
  if (value === needle) return 420
  if (value.startsWith(needle)) return 320
  const index = value.indexOf(needle)
  if (index >= 0) return 260 - Math.min(index, 100)
  let cursor = 0, first = -1, last = -1
  for (const char of needle) {
    const found = value.indexOf(char, cursor)
    if (found < 0) { first = -1; break }
    if (first < 0) first = found
    last = found
    cursor = found + char.length
  }
  const gaps = last - first + 1 - needle.length
  if (first >= 0 && gaps <= Math.max(12, needle.length * 4)) return 140 - Math.min(110, gaps * 3 + first)
  if (/^[a-z0-9_-]{4,32}$/.test(needle) && value.split(/[\s./:?&=#]+/).slice(0, 80).some(word => oneEditApart(word, needle))) return 60
  return -1
}

/** Search the complete local index; limit only after ranking, never before matching. */
export function searchQuickSearch(index: PreparedQuickSearchItem[], query: string, filter: QuickSearchFilter = 'all', limit = 80): QuickSearchItem[] {
  const text = fold(query.slice(0, 160)).trim()
  const words = text.split(/\s+/).filter(Boolean)
  if (!text) {
    return index.filter(entry => filter === 'all' || entry.item.kind === filter).map(entry => entry.item).sort((a, b) =>
      (b.kind === 'tab' ? 2 : b.kind === 'bookmark' ? 1 : 0) - (a.kind === 'tab' ? 2 : a.kind === 'bookmark' ? 1 : 0)
      || (b.lastAccessed || 0) - (a.lastAccessed || 0)
      || Number(!!b.currentWindow && !!b.active) - Number(!!a.currentWindow && !!a.active)
      || Number(!!b.currentWindow) - Number(!!a.currentWindow)
      || a.title.localeCompare(b.title)
    ).slice(0, Math.max(0, limit))
  }
  return index.filter(entry => filter === 'all' || entry.item.kind === filter).map(entry => {
    let score = entry.item.kind === 'tab' ? 16 : 0
    if (entry.item.currentWindow) score += 4
    for (const word of words) {
      const scores = entry.fields.map((field, i) => { const value = matchScore(field, word); return value < 0 ? -1 : value * [1, 0.65, 0.55, 0.6][i] })
      const best = Math.max(...scores)
      if (best < 0) return { ...entry, score: -1 }
      score += best
    }
    if (entry.fields[0] === text) score += 300
    return { ...entry, score }
  }).filter(entry => entry.score >= 0).sort((a, b) => b.score - a.score
    || (b.item.lastAccessed || 0) - (a.item.lastAccessed || 0)
    || a.item.title.localeCompare(b.item.title)).slice(0, Math.max(0, limit)).map(entry => entry.item)
}

export function quickSearchKey(key: string, composing: boolean, index: number, count: number, filter: QuickSearchFilter = 'all'): { select?: number; open?: boolean; close?: boolean; filter?: QuickSearchFilter } {
  if (composing) return {}
  if (key === 'Escape') return { close: true }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const next = (QUICK_SEARCH_FILTERS.indexOf(filter) + (key === 'ArrowRight' ? 1 : -1) + QUICK_SEARCH_FILTERS.length) % QUICK_SEARCH_FILTERS.length
    return { filter: QUICK_SEARCH_FILTERS[next] }
  }
  if (!count) return {}
  if (key === 'ArrowDown') return { select: (index + 1 + count) % count }
  if (key === 'ArrowUp') return { select: (index - 1 + count) % count }
  if (key === 'Enter') return { open: true }
  return {}
}

/** Resolve icons through the browser's own favicon endpoint for every result type. */
export function quickSearchFaviconUrl(value: string): string | undefined {
  try {
    const page = new URL(value)
    if (!['http:', 'https:', 'file:', 'edge:', 'chrome:', 'about:'].includes(page.protocol)) return undefined
    const url = new URL(chrome.runtime.getURL('/_favicon/'))
    url.searchParams.set('pageUrl', page.href)
    url.searchParams.set('size', '32')
    return url.href
  } catch { return undefined }
}

export function isQuickSearchUrl(value?: string): boolean {
  try { const url = new URL(value || ''); return url.protocol === 'chrome-extension:' && url.pathname === `/${QUICK_SEARCH_PAGE}` } catch { return false }
}

export function requestQuickSearch(type: string, value: object = {}): Promise<QuickSearchResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('unavailable')), 15_000)
    try {
      chrome.runtime.sendMessage({ type, ...value }, (response: QuickSearchResponse) => {
        clearTimeout(timer)
        if (chrome.runtime.lastError || !response || typeof response.ok !== 'boolean') reject(new Error('unavailable'))
        else resolve(response)
      })
    } catch { clearTimeout(timer); reject(new Error('unavailable')) }
  })
}

export function readQuickSearchShortcut(): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.commands?.getAll) return Promise.resolve('')
  return new Promise(resolve => {
    try { chrome.commands.getAll(commands => { void chrome.runtime.lastError; resolve(commands.find(command => command.name === QUICK_SEARCH_COMMAND)?.shortcut || '') }) }
    catch { resolve('') }
  })
}
