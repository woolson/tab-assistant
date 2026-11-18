import { AI_TOKEN_USAGE_KEY, readAiTokenUsageEvent, readAiTokenUsageState, type AiTokenUsageEvent } from '../../common/aiTokenUsage'

let writeQueue: Promise<void> = Promise.resolve()

function add(left: number, right: number) {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw new Error('Token usage counter overflow')
  return result
}

/** One writer for background grouping and connection tests in every popup/panel. */
export function recordAiTokenUsage(value: AiTokenUsageEvent): Promise<void> {
  const event = readAiTokenUsageEvent(value)
  if (!event) return Promise.reject(new Error('Invalid token usage event'))
  const run = writeQueue.then(async () => {
    const stored = await chrome.storage.local.get(AI_TOKEN_USAGE_KEY)
    const state = readAiTokenUsageState(stored[AI_TOKEN_USAGE_KEY])
    if (state.recentRequestIds.includes(event.requestId)) return
    let row = state.rows.find(row => row.provider === event.provider && row.model === event.model)
    if (!row) {
      row = { provider: event.provider, model: event.model, inputTokens: 0, outputTokens: 0, inputReports: 0, outputReports: 0, requests: 0, unreportedRequests: 0, updatedAt: 0 }
      state.rows.push(row)
    }
    row.requests = add(row.requests, 1)
    if (event.inputTokens !== undefined) { row.inputTokens = add(row.inputTokens, event.inputTokens); row.inputReports = add(row.inputReports, 1) }
    if (event.outputTokens !== undefined) { row.outputTokens = add(row.outputTokens, event.outputTokens); row.outputReports = add(row.outputReports, 1) }
    if (event.inputTokens === undefined || event.outputTokens === undefined) row.unreportedRequests = add(row.unreportedRequests, 1)
    row.updatedAt = Math.max(row.updatedAt, event.timestamp)
    state.recentRequestIds = [...state.recentRequestIds, event.requestId].slice(-500)
    await chrome.storage.local.set({ [AI_TOKEN_USAGE_KEY]: state })
  })
  writeQueue = run.catch(() => {})
  return run
}
