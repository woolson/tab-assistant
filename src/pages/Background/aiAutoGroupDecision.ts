/** 未分组标签的 groupId，与 chrome.tabGroups.TAB_GROUP_ID_NONE 一致。 */
export const UNGROUPED_GROUP_ID = -1

export const AI_GROUP_TITLE_MAX = 24

const GROUP_SAMPLE_LIMIT = 6

/**
 * 常见的多段公共后缀。这里只覆盖回退分组要用的主域名判断，
 * 不是完整的 Public Suffix List。
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'net.uk', 'ltd.uk', 'plc.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.tw', 'org.tw', 'net.tw', 'com.hk', 'org.hk', 'com.sg', 'com.my',
  'co.kr', 'or.kr', 'ne.kr', 'com.br', 'com.mx', 'com.ar', 'com.tr',
  'co.nz', 'org.nz', 'co.za', 'co.in', 'net.in', 'org.in', 'co.id', 'co.th',
  'com.vn', 'co.il', 'com.ua', 'com.pl',
])

export type AiGroupAction = 'join' | 'create' | 'leave'

export interface AiGroupDecision {
  action: AiGroupAction
  groupId?: number
  title?: string
}

export interface GroupSnapshot {
  id: number
  title: string
  tabs: Array<{ url: string; title: string }>
}

export interface SnapshotGroup {
  id: number
  title?: string
}

export interface SnapshotTab {
  id?: number
  groupId?: number
  index?: number
  url?: string
  pendingUrl?: string
  title?: string
}

export type ModelAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported'

export interface LanguageModelSession {
  prompt(input: string, options?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>
  destroy?: () => void
}

export interface LanguageModelFactory {
  availability: (options?: object) => Promise<string>
  create: (options?: object) => Promise<LanguageModelSession>
  params?: () => Promise<{
    defaultTopK: number
    maxTopK: number
    defaultTemperature: number
    maxTemperature: number
  }>
}

interface DomainInfo {
  host: string
  registrable: string
}

export function getLanguageModelFactory(): LanguageModelFactory | undefined {
  const candidate = (globalThis as { LanguageModel?: LanguageModelFactory }).LanguageModel
  if (!candidate || typeof candidate.availability !== 'function' || typeof candidate.create !== 'function') {
    return undefined
  }
  return candidate
}

export async function queryLanguageModelAvailability(): Promise<ModelAvailability> {
  const model = getLanguageModelFactory()
  if (!model) return 'unsupported'

  const textOptions = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  }

  try {
    return normalizeAvailability(await model.availability(textOptions))
  } catch (error) {
    try {
      return normalizeAvailability(await model.availability())
    } catch (fallbackError) {
      return 'unsupported'
    }
  }
}

export function isGroupedId(groupId: number | undefined): boolean {
  return typeof groupId === 'number' && groupId !== UNGROUPED_GROUP_ID
}

/** 新标签页、空白页还没有可分组的地址。 */
export function isPlaceholderTabUrl(url: string | undefined): boolean {
  if (!url || !url.trim()) return true
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'about:' || parsed.protocol === 'chrome-untrusted:' || parsed.protocol === 'chrome-search:') {
      return true
    }
    const isNewTabHost = parsed.hostname === 'newtab' || parsed.hostname === 'new-tab-page'
    if ((parsed.protocol === 'chrome:' || parsed.protocol === 'edge:') && isNewTabHost) return true
    return false
  } catch (error) {
    return true
  }
}

/** 优先采用已经确定的跳转地址，忽略仍停在新标签页的 url。 */
export function readRealUrl(tab: { url?: string; pendingUrl?: string }): string | undefined {
  if (tab.pendingUrl && !isPlaceholderTabUrl(tab.pendingUrl)) return tab.pendingUrl
  if (tab.url && !isPlaceholderTabUrl(tab.url)) return tab.url
  return undefined
}

export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  if (!host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.')
  return lastTwo
}

export function normalizeGroupTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const collapsed = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!collapsed) return undefined
  const title = clipText(collapsed, AI_GROUP_TITLE_MAX).trim()
  if (!title || !/[0-9A-Za-z\u00C0-\uFFFF]/.test(title)) return undefined
  return title
}

export function parseAiGroupDecision(raw: unknown, validGroupIds: ReadonlySet<number>): AiGroupDecision | undefined {
  const record = typeof raw === 'string'
    ? parseJsonObject(raw)
    : isRecord(raw)
      ? raw
      : undefined
  if (!record) return undefined

  const action = typeof record.action === 'string' ? record.action.trim().toLowerCase() : ''
  if (action === 'leave') return { action: 'leave' }
  if (action === 'join') {
    const groupId = normalizeGroupId(record.groupId)
    if (groupId === undefined || !validGroupIds.has(groupId)) return undefined
    return { action: 'join', groupId }
  }
  if (action === 'create') {
    const title = normalizeGroupTitle(record.title)
    if (!title) return undefined
    return { action: 'create', title }
  }
  return undefined
}

export function buildGroupSnapshots(
  groups: SnapshotGroup[],
  tabs: SnapshotTab[],
  ignoreTabId?: number,
): GroupSnapshot[] {
  const tabsByGroup = new Map<number, SnapshotTab[]>()
  tabs.forEach(tab => {
    if (ignoreTabId !== undefined && tab.id === ignoreTabId) return
    if (!isGroupedId(tab.groupId)) return
    const list = tabsByGroup.get(tab.groupId as number) || []
    list.push(tab)
    tabsByGroup.set(tab.groupId as number, list)
  })

  return groups
    .filter(group => Number.isInteger(group.id) && group.id !== UNGROUPED_GROUP_ID)
    .map(group => {
      const samples = (tabsByGroup.get(group.id) || [])
        .slice()
        .sort((prev, next) => (prev.index || 0) - (next.index || 0))
      const withDomain: SnapshotTab[] = []
      const withoutDomain: SnapshotTab[] = []
      samples.forEach(tab => {
        const url = readRealUrl(tab)
        if (url && domainInfo(url)) withDomain.push(tab)
        else withoutDomain.push(tab)
      })

      return {
        id: group.id,
        title: group.title || '',
        tabs: withDomain.concat(withoutDomain).slice(0, GROUP_SAMPLE_LIMIT).map(tab => ({
          url: readRealUrl(tab) || '',
          title: (tab.title || '').trim(),
        })).filter(tab => tab.url),
      }
    })
}

export function compactGroupsForPrompt(groups: GroupSnapshot[], targetUrl: string, limit = 12): GroupSnapshot[] {
  return rankGroups(groups, targetUrl).slice(0, limit).map(group => ({
    id: group.id,
    title: clipText(group.title, 80),
    tabs: group.tabs.slice(0, 2).map(tab => ({
      url: clipText(tab.url, 180),
      title: clipText(tab.title, 80),
    })),
  }))
}

/**
 * 模型不可用时的回退：优先加入已有相同主机名的分组，否则加入相同主域名的分组。
 * 没有任何可对齐的分组时保持不动。
 */
export function pickFallbackGroupId(groups: GroupSnapshot[], targetUrl: string): number | undefined {
  const target = domainInfo(targetUrl)
  if (!target) return undefined

  let best: { id: number; score: number } | undefined
  groups.forEach(group => {
    const score = scoreGroup(group, target)
    if (score <= 0) return
    if (!best || score > best.score || (score === best.score && group.id < best.id)) {
      best = { id: group.id, score }
    }
  })
  return best?.id
}

export function clipText(value: string, max: number): string {
  const chars = Array.from(value)
  if (chars.length <= max) return value
  return chars.slice(0, max).join('')
}

function rankGroups(groups: GroupSnapshot[], targetUrl: string): GroupSnapshot[] {
  const target = domainInfo(targetUrl)
  return groups
    .map(group => ({ group, score: target ? scoreGroup(group, target) : 0 }))
    .sort((prev, next) => next.score - prev.score || prev.group.id - next.group.id)
    .map(item => item.group)
}

function scoreGroup(group: GroupSnapshot, target: DomainInfo): number {
  let score = 0
  group.tabs.forEach(tab => {
    const info = domainInfo(tab.url)
    if (!info) return
    if (info.host === target.host) score += 100
    else if (info.registrable === target.registrable) score += 10
  })

  const title = titleDomain(group.title)
  if (title) {
    if (title.host === target.host) score += 40
    else if (title.registrable === target.registrable) score += 4
  }
  return score
}

function domainInfo(url: string): DomainInfo | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
    if (!host) return undefined
    return { host, registrable: registrableDomain(host) }
  } catch (error) {
    return undefined
  }
}

function titleDomain(title: string): DomainInfo | undefined {
  const host = title.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  if (!host || /\s/.test(host) || !host.includes('.') || !/^[a-z0-9.-]+$/.test(host)) return undefined
  return { host, registrable: registrableDomain(host) }
}

function normalizeGroupId(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isInteger(numeric)) return undefined
  return numeric
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim()
  const direct = tryParseObject(trimmed)
  if (direct) return direct

  const unfenced = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const unfencedObject = tryParseObject(unfenced)
  if (unfencedObject) return unfencedObject

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  return tryParseObject(raw.slice(start, end + 1))
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : undefined
  } catch (error) {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAvailability(value: unknown): ModelAvailability {
  if (value === 'available' || value === 'downloadable' || value === 'downloading' || value === 'unavailable') {
    return value
  }
  return 'unavailable'
}
