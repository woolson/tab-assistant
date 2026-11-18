import type { AiApiProtocol, AiApiProvider } from './aiApi'

export const AI_TOKEN_USAGE_KEY = 'TA_AI_TOKEN_USAGE'
export const RECORD_AI_TOKEN_USAGE_MESSAGE = 'ta:record-ai-token-usage'
const PROVIDERS: AiApiProvider[] = ['deepseek', 'openai', 'qwen', 'anthropic', 'gemini', 'custom']

export interface AiTokenCounts {
  inputTokens?: number
  outputTokens?: number
}
export interface AiTokenUsageEvent extends AiTokenCounts {
  requestId: string
  provider: AiApiProvider
  model: string
  timestamp: number
}
export interface AiTokenUsageRow {
  provider: AiApiProvider
  model: string
  inputTokens: number
  outputTokens: number
  inputReports: number
  outputReports: number
  requests: number
  unreportedRequests: number
  updatedAt: number
}
export interface AiTokenUsageState {
  rows: AiTokenUsageRow[]
  recentRequestIds: string[]
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function sum(required: unknown, ...optional: unknown[]): number | undefined {
  const first = count(required)
  if (first === undefined) return undefined
  let total = first
  for (const value of optional) {
    if (value === undefined) continue
    const next = count(value)
    if (next === undefined || !Number.isSafeInteger(total + next)) return undefined
    total += next
  }
  return total
}

/** Use reported counts only. Cached/reasoning subsets must not be counted twice. */
export function parseAiTokenUsage(protocol: AiApiProtocol, data: any): AiTokenCounts {
  if (protocol === 'anthropic') {
    return {
      inputTokens: sum(data?.usage?.input_tokens, data?.usage?.cache_creation_input_tokens, data?.usage?.cache_read_input_tokens),
      outputTokens: count(data?.usage?.output_tokens),
    }
  }
  if (protocol === 'gemini') {
    return {
      inputTokens: count(data?.usageMetadata?.promptTokenCount),
      outputTokens: sum(data?.usageMetadata?.candidatesTokenCount, data?.usageMetadata?.thoughtsTokenCount),
    }
  }
  return {
    inputTokens: count(data?.usage?.prompt_tokens ?? data?.usage?.input_tokens),
    outputTokens: count(data?.usage?.completion_tokens ?? data?.usage?.output_tokens),
  }
}

export function createAiTokenUsageEvent(provider: AiApiProvider, model: string): AiTokenUsageEvent {
  return {
    requestId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
    provider, model, timestamp: Date.now(),
  }
}

/** Whitelist fields so usage storage never receives prompts, endpoints or credentials. */
export function readAiTokenUsageEvent(value: unknown): AiTokenUsageEvent | undefined {
  if (!value || typeof value !== 'object') return undefined
  const event = value as AiTokenUsageEvent
  if (typeof event.requestId !== 'string' || !event.requestId || event.requestId.length > 160 ||
    !PROVIDERS.includes(event.provider) || typeof event.model !== 'string' || !event.model.trim() || count(event.timestamp) === undefined ||
    event.inputTokens !== undefined && count(event.inputTokens) === undefined ||
    event.outputTokens !== undefined && count(event.outputTokens) === undefined) return undefined
  return {
    requestId: event.requestId, provider: event.provider, model: event.model.trim(), timestamp: event.timestamp,
    ...(event.inputTokens !== undefined ? { inputTokens: event.inputTokens } : {}),
    ...(event.outputTokens !== undefined ? { outputTokens: event.outputTokens } : {}),
  }
}

export function readAiTokenUsageState(value: unknown): AiTokenUsageState {
  const state = value && typeof value === 'object' ? value as Partial<AiTokenUsageState> : {}
  const rows: AiTokenUsageRow[] = []
  for (const row of Array.isArray(state.rows) ? state.rows : []) {
    if (!row || !PROVIDERS.includes(row.provider) || typeof row.model !== 'string' || !row.model.trim() ||
      [row.inputTokens, row.outputTokens, row.inputReports, row.outputReports, row.requests, row.unreportedRequests, row.updatedAt].some(value => count(value) === undefined) ||
      row.inputReports > row.requests || row.outputReports > row.requests || row.unreportedRequests > row.requests ||
      rows.some(existing => existing.provider === row.provider && existing.model === row.model)) continue
    rows.push({
      provider: row.provider, model: row.model, inputTokens: row.inputTokens, outputTokens: row.outputTokens,
      inputReports: row.inputReports, outputReports: row.outputReports, requests: row.requests,
      unreportedRequests: row.unreportedRequests, updatedAt: row.updatedAt,
    })
  }
  return {
    rows,
    recentRequestIds: (Array.isArray(state.recentRequestIds) ? state.recentRequestIds : [])
      .filter((id): id is string => typeof id === 'string' && Boolean(id) && id.length <= 160).slice(-500),
  }
}

type UsageRecorder = (event: AiTokenUsageEvent) => Promise<void>
let recorder: UsageRecorder | undefined

/** The background owns all writes; its own API calls bypass runtime messaging. */
export function installAiTokenUsageRecorder(value: UsageRecorder | undefined) { recorder = value }

export async function reportAiTokenUsage(event: AiTokenUsageEvent): Promise<void> {
  try {
    if (recorder) { await recorder(event); return }
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1000)
      try {
        chrome.runtime.sendMessage({ type: RECORD_AI_TOKEN_USAGE_MESSAGE, event }, () => {
          void chrome.runtime.lastError
          clearTimeout(timer)
          resolve()
        })
      } catch { clearTimeout(timer); resolve() }
    })
  } catch { /* Accounting must not turn a completed AI request into a failure. */ }
}
