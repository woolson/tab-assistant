import { Logger } from "./helpers"
import { cleanTaskText } from '../../common/taskText'
import type { AiApiDiagnostics } from '../../common/aiApi'

export const AI_DECISION_LOG_KEY = 'TA_AI_DECISION_LOG'
export const CLEAR_AI_DECISION_LOG_MESSAGE = 'ta:clear-decision-logs'
const AI_DECISION_LOG_LIMIT = 150
const SETTINGS_STORAGE_KEY = 'TA_SETTING'

export type AiDecisionResult = 'join' | 'create' | 'rename' | 'ungrouped' | 'domain' | 'rule' | 'kept' | 'skipped' | 'waiting' | 'failed'

export type AiDecisionVia = 'opener' | 'model' | 'preference' | 'search' | 'fallback' | 'domain' | 'rule' | 'none'

export type AiModelStatus =
  | 'not-configured'
  | 'permission'
  | 'answered'
  | 'unverified'
  | 'preferences-changed'
  | 'timeout'
  | 'queue-timeout'
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'unsupported'
  | 'error'
  | 'not-asked'

export interface AiDecisionLogEntry {
  id: string
  at: number
  url: string
  title: string
  result: AiDecisionResult
  via: AiDecisionVia
  trigger?: 'page-update' | 'full-regroup'
  modelAction?: 'join' | 'create' | 'leave' | 'rename'
  modelStatus?: AiModelStatus
  groupId?: number
  groupTitle?: string
  reason?: string
  error?: string
  request?: AiApiDiagnostics
}

export type NewAiDecisionLogEntry = Omit<AiDecisionLogEntry, 'id' | 'at'>

export type AiDecisionDisplayResult = AiDecisionResult | 'timeout' | 'unverified' | 'model-kept'

/** Preserve the actual placement result, but make failed/declined decisions visible. */
export function aiDecisionDisplayResult(entry: Pick<AiDecisionLogEntry, 'result' | 'modelStatus' | 'modelAction'>): AiDecisionDisplayResult {
  if (entry.result === 'kept' || entry.result === 'ungrouped' || entry.result === 'failed') {
    if (entry.modelStatus === 'timeout') return 'timeout'
    if (entry.modelStatus === 'unverified') return 'unverified'
    if (['error', 'permission', 'not-configured', 'queue-timeout'].includes(entry.modelStatus || '')) return 'failed'
    if (entry.modelStatus === 'answered' && entry.modelAction === 'leave') return 'model-kept'
  }
  return entry.result
}

let writeQueue: Promise<void> = Promise.resolve()

export function recordAiDecision(entry: NewAiDecisionLogEntry): Promise<void> {
  const enabledWhenRecorded = isLoggingEnabled()
  writeQueue = writeQueue.then(async () => {
    if (await enabledWhenRecorded) await persistAiDecision(entry)
  }).catch(error => {
    Logger.log('写入 AI 决策日志失败', error)
  })
  return writeQueue
}

export function clearAiDecisionLog(): Promise<void> {
  const clearing = writeQueue.then(async () => {
    const local = localStorageArea()
    if (local) await local.set({ [AI_DECISION_LOG_KEY]: [] })
  })
  writeQueue = clearing.catch(() => {})
  return clearing
}

/** Clear through the worker so pending writes in other extension pages cannot restore old entries. */
export function requestClearAiDecisionLog(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return clearAiDecisionLog()
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: CLEAR_AI_DECISION_LOG_MESSAGE }, response => {
      if (chrome.runtime.lastError || response?.ok !== true) reject(new Error('clear-failed'))
      else resolve()
    })
  })
}

export function readAiDecisionLog(value: unknown): AiDecisionLogEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter(isAiDecisionLogEntry)
}

async function persistAiDecision(entry: NewAiDecisionLogEntry): Promise<void> {
  const local = localStorageArea()
  if (!local) return
  const stored = await local.get(AI_DECISION_LOG_KEY)
  // Check again after queued/storage work: turning logging off also drops
  // pending writes, including decisions from an API request already in flight.
  if (!await isLoggingEnabled()) return
  const previous = readAiDecisionLog(stored[AI_DECISION_LOG_KEY])
  const next = [createEntry(entry), ...previous].slice(0, AI_DECISION_LOG_LIMIT)
  await local.set({ [AI_DECISION_LOG_KEY]: next })
}

async function isLoggingEnabled(): Promise<boolean> {
  const sync = (globalThis as { chrome?: typeof chrome }).chrome?.storage?.sync
  if (!sync?.get) return false
  try {
    const stored = await sync.get(SETTINGS_STORAGE_KEY)
    return stored[SETTINGS_STORAGE_KEY]?.decisionLogEnabled === true
  } catch { return false }
}

function createEntry(entry: NewAiDecisionLogEntry): AiDecisionLogEntry {
  return {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    url: entry.url || '',
    title: cleanTaskText(entry.title || ''),
    error: clip(entry.error),
    groupTitle: clip(entry.groupTitle),
    reason: clip(entry.reason),
  }
}

const DECISION_RESULTS = new Set<AiDecisionResult>(['rename', 'ungrouped', 'join', 'create', 'domain', 'rule', 'kept', 'skipped', 'waiting', 'failed'])
const DECISION_VIAS = new Set<AiDecisionVia>(['opener', 'model', 'preference', 'search', 'fallback', 'domain', 'rule', 'none'])

function isAiDecisionLogEntry(value: unknown): value is AiDecisionLogEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<AiDecisionLogEntry>
  return typeof entry.id === 'string'
    && typeof entry.at === 'number'
    && typeof entry.url === 'string'
    && typeof entry.title === 'string'
    && DECISION_RESULTS.has(entry.result as AiDecisionResult)
    && DECISION_VIAS.has(entry.via as AiDecisionVia)
}

function localStorageArea(): chrome.storage.LocalStorageArea | undefined {
  const local = (globalThis as { chrome?: typeof chrome }).chrome?.storage?.local
  if (!local || typeof local.get !== 'function' || typeof local.set !== 'function') return undefined
  return local
}

function clip(value: string | undefined): string | undefined {
  if (!value) return undefined
  const chars = Array.from(value)
  if (chars.length <= 180) return value
  return chars.slice(0, 180).join('')
}
