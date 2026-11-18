import type { PageContent } from './pageContent'

export const GROUPING_PREFERENCES_KEY = 'TA_GROUPING_PREFERENCES'
export const CLEAR_GROUPING_PREFERENCES_MESSAGE = 'ta:clear-grouping-preferences'
export const GROUPING_PREFERENCE_LIMIT = 100

export interface GroupingPreference {
  id: string
  url: string
  title: string
  choice: 'group' | 'ungrouped'
  groupTitle?: string
  avoidedGroupTitle?: string
  count: number
  updatedAt: number
}

export interface PromptGroupingPreference extends GroupingPreference {
  match: 'same-page' | 'same-resource' | 'similar-topic'
  availableGroupIds: number[]
  resourceHabit: boolean
  supportingPages: number
}

const cleanText = (value: unknown, max: number) => typeof value === 'string'
  ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('') : ''
const credentialKey = /token|secret|password|credential|authorization|session|signature|(?:api|private|access|auth)[_-]?key|^(?:auth|sign|code|ticket|state|nonce|pwd)$/i

/** 凭据可能同时充当不透明资源标识，跳过此类记忆，避免脱敏后误合并不同页面。 */
export function isCredentialPreferenceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const hash = url.hash.replace(/^#!/, '').replace(/^#/, '')
    const hashParams = hash.startsWith('/') ? new URL(hash, url.origin).searchParams : new URLSearchParams(hash)
    return Boolean(url.username || url.password || Array.from(url.searchParams.keys()).concat(Array.from(hashParams.keys())).some(key => credentialKey.test(key)))
  } catch { return true }
}

/** 保留业务定位参数，移除凭据和追踪参数；不会从一个页面推导全站规则。 */
export function preferencePageUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (!/^https?:$/.test(url.protocol)) return undefined
    url.username = ''; url.password = ''
    const sanitize = (params: URLSearchParams) => {
      for (const key of Array.from(params.keys())) {
        if (credentialKey.test(key) || /^(?:spm|scm|ref|from|timestamp|utm_.+)$/i.test(key)) params.delete(key)
      }
      params.sort()
    }
    sanitize(url.searchParams)
    if (/^#!?\//.test(url.hash)) {
      const route = new URL(url.hash.replace(/^#!/, '').replace(/^#/, ''), url.origin)
      sanitize(route.searchParams)
      url.hash = route.pathname + route.search
    } else url.hash = ''
    const result = url.toString()
    return result.length <= 1200 ? result : undefined
  } catch { return undefined }
}

export function readGroupingPreferences(value: unknown): GroupingPreference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.url !== 'string') return []
    const url = isCredentialPreferenceUrl(item.url) ? undefined : preferencePageUrl(item.url)
    const groupTitle = cleanText(item.groupTitle, 80)
    if (!/^pref-[a-z0-9_-]{1,74}$/i.test(item.id) || !url || !['group', 'ungrouped'].includes(item.choice) || item.choice === 'group' && !groupTitle
      || !Number.isInteger(item.count) || item.count < 1 || !Number.isFinite(item.updatedAt)) return []
    return [{ id: cleanText(item.id, 80), url, title: cleanText(item.title, 160), choice: item.choice,
      ...(item.choice === 'group' ? { groupTitle } : {}),
      ...(cleanText(item.avoidedGroupTitle, 80) ? { avoidedGroupTitle: cleanText(item.avoidedGroupTitle, 80) } : {}),
      count: Math.min(item.count, 999), updatedAt: item.updatedAt } as GroupingPreference]
  }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, GROUPING_PREFERENCE_LIMIT)
}

export function mergeGroupingPreference(previous: GroupingPreference[], choice: Omit<GroupingPreference, 'id' | 'count'>): GroupingPreference[] {
  const old = previous.find(item => item.url === choice.url)
  const count = old?.choice === choice.choice && old.groupTitle === choice.groupTitle ? Math.min(old.count + 1, 999) : 1
  const next = { ...choice, id: old?.id || `pref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, count }
  return readGroupingPreferences([next, ...previous.filter(item => item.url !== choice.url)])
}

function entity(value: string) {
  const url = new URL(value)
  const params = new URLSearchParams(url.search)
  if (/^#\//.test(url.hash)) new URL(url.hash.slice(1), url.origin).searchParams.forEach((v, k) => params.set(k, v))
  const values = new Map(Array.from(params.entries()).map(([key, value]) => [key.toLowerCase(), value]))
  for (const key of ['appid', 'projectid', 'repositoryid', 'repoid', 'documentid', 'docid', 'issueid', 'taskid']) {
    if (values.has(key)) return { origin: url.origin, key, value: values.get(key), environment: values.get('envid') }
  }
  return undefined
}

function topicTokens(value: string): Set<string> {
  const generic = new Set(['文档', '页面', '平台', '应用', '环境', '流程', '管理', '工作', '项目', '系统', '发布', '代码', '任务', '数据', '开发', '预发', 'wap', 'docs', 'dingtalk', 'notion', 'github'])
  const tokens = value.toLowerCase().replace(/钉钉文档|飞书云文档|飞书文档|语雀|研发平台|代码构建|产物部署/g, ' ')
    .match(/[a-z][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || []
  return new Set(tokens.flatMap(token => /^[\u4e00-\u9fff]+$/.test(token)
    ? Array.from({ length: token.length - 1 }, (_, index) => token.slice(index, index + 2)) : [token]).filter(token => !generic.has(token)))
}

export function selectGroupingPreferences(
  preferences: GroupingPreference[], target: { url: string; title: string; content?: PageContent },
  groups: Array<{ id: number; title: string }>, limit = 8,
): PromptGroupingPreference[] {
  const url = preferencePageUrl(target.url)
  if (!url || isCredentialPreferenceUrl(target.url)) return []
  const targetEntity = entity(url)
  const tokens = topicTokens([target.title, target.content?.title, target.content?.description,
    target.content?.excerpt, ...(target.content?.headings || [])].filter(Boolean).join(' '))
  return preferences.map(item => {
    let match: PromptGroupingPreference['match'] | undefined
    let score = 0
    if (item.url === url) { match = 'same-page'; score = 100 }
    else {
      const source = entity(item.url)
      if (source && targetEntity && source.origin === targetEntity.origin && source.key === targetEntity.key && source.value === targetEntity.value
        && !(source.environment && targetEntity.environment && source.environment !== targetEntity.environment)) {
        match = 'same-resource'; score = 80
      } else if (Array.from(topicTokens(item.title + ' ' + (item.groupTitle || ''))).some(token => tokens.has(token))) {
        match = 'similar-topic'; score = 20
      }
    }
    return { item, match, score }
  }).filter((entry): entry is { item: GroupingPreference; match: PromptGroupingPreference['match']; score: number } => Boolean(entry.match))
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt || b.item.count - a.item.count).slice(0, limit)
    .map(({ item, match }) => {
      const related = targetEntity ? preferences.filter(candidate => {
        const source = entity(candidate.url)
        return source && source.origin === targetEntity.origin && source.key === targetEntity.key && source.value === targetEntity.value
          && source.environment === targetEntity.environment
      }) : []
      const supportingPages = new Set(related.filter(candidate => candidate.choice === item.choice && candidate.groupTitle === item.groupTitle).map(candidate => candidate.url)).size
      const conflict = related.some(candidate => candidate.choice !== item.choice || candidate.groupTitle !== item.groupTitle)
      return { ...item, url: item.url.slice(0, 400), match, supportingPages,
        resourceHabit: match === 'same-resource' && supportingPages >= 2 && !conflict,
        availableGroupIds: groups.filter(group => group.title.trim().toLowerCase() === item.groupTitle?.toLowerCase()).map(group => group.id),
      }
    })
}

export function requestClearGroupingPreferences(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) { reject(new Error('unavailable')); return }
    chrome.runtime.sendMessage({ type: CLEAR_GROUPING_PREFERENCES_MESSAGE }, response => {
      if (chrome.runtime.lastError || response?.ok !== true) reject(new Error('clear-failed'))
      else resolve()
    })
  })
}
