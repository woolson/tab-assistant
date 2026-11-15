import { clipText, normalizeGroupTitle } from './aiAutoGroupDecision'

export interface SearchIntent {
  query: string
  taskTitle: string
}

const GOOGLE_DOMAINS = ['google.com', 'google.com.hk', 'google.com.tw', 'google.co.jp', 'google.co.uk', 'google.de', 'google.fr', 'google.ca', 'google.com.au', 'google.co.in']
const TOPIC_CHARACTER = new RegExp('[\\p{L}\\p{N}]', 'u')

/** Search metadata is already in the tab URL/title; no page access is needed. */
export function readSearchIntent(url: string, title = ''): SearchIntent | undefined {
  let parsed: URL
  try { parsed = new URL(url) } catch { return undefined }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.replace(/\/+$/, '')
  const at = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  let keys: string[]
  if (at('baidu.com') && /(?:^|\/)s$/.test(path)) keys = ['wd', 'word']
  else if (at('bing.com') && path === '/search') keys = ['q']
  else if (GOOGLE_DOMAINS.some(at) && path === '/search') keys = ['q']
  else if (at('duckduckgo.com') && ['', '/html', '/lite'].includes(path)) keys = ['q']
  else if (at('search.yahoo.com') && path === '/search') keys = ['p']
  else if (at('sogou.com') && path === '/web') keys = ['query', 'keyword']
  else if (at('so.com') && path === '/s') keys = ['q']
  else if (at('search.brave.com') && path === '/search') keys = ['q']
  else return undefined

  // Extract before the URL is shortened for the model: tracking parameters can
  // otherwise push the actual query past the prompt's URL character limit.
  const raw = keys.map(key => parsed.searchParams.get(key)).find(value => value?.trim())
  const fromTitle = title.replace(/\s*[_\-–—|]\s*(?:百度搜索|百度一下|搜狗搜索|360搜索|Google(?:\s+(?:搜索|Search))?|Bing|搜索|Search|DuckDuckGo|Yahoo(?:\s+Search)?|Brave Search)\s*$/i, '')
    .replace(/\s+at DuckDuckGo\s*$/i, '')
  const query = cleanQuery(raw || (fromTitle !== title ? fromTitle : ''))
  if (!query) return undefined
  const prefix = /[\u3400-\u9fff]/.test(query) ? '了解 ' : 'Research '
  const taskTitle = normalizeGroupTitle(`${prefix}${query}`)
  return taskTitle ? { query, taskTitle } : undefined
}

function cleanQuery(value: string): string | undefined {
  const query = value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!query || query.includes('\ufffd') || !TOPIC_CHARACTER.test(query)) return undefined
  if (/^(?:搜索|百度(?:一下|搜索)?|搜狗搜索|360搜索|search(?: results)?|google|bing|duckduckgo|yahoo|brave search)$/i.test(query)) return undefined
  if (/^(?:https?:\/\/|www\.)/i.test(query) || /^(?:[a-z0-9-]+\.)+[a-z]{2,}\/?$/i.test(query)) return undefined
  return clipText(query, 200)
}
