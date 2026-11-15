/** Provider credentials stay in local storage, separate from synced/exported preferences. */
export const AI_API_CONFIG_KEY = 'TA_AI_API_CONFIG'
export type AiApiProtocol = 'openai' | 'anthropic' | 'gemini'
export type AiApiProvider = 'deepseek' | 'openai' | 'qwen' | 'anthropic' | 'gemini' | 'custom'
export interface AiApiConfig {
  provider: AiApiProvider
  protocol: AiApiProtocol
  baseUrl: string
  model: string
  apiKey: string
  timeoutSeconds: number
}
export const AI_API_PRESETS = [
  { provider: 'deepseek', label: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' },
  { provider: 'openai', label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna' },
  { provider: 'qwen', label: '通义千问 / Qwen', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { provider: 'anthropic', label: 'Anthropic / Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5' },
  { provider: 'gemini', label: 'Google / Gemini', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.5-flash-lite' },
] as const

export interface AiModelPreset {
  value: string
  label: string
  purpose: 'fast' | 'balanced' | 'reasoning' | 'visual' | 'legacy'
  recommended?: boolean
}

/** Curated text models. Account access varies; custom IDs remain supported. */
export const AI_MODEL_PRESETS: Record<Exclude<AiApiProvider, 'custom'>, readonly AiModelPreset[]> = {
  deepseek: [
    { value: 'deepseek-flash', label: 'DeepSeek Flash', purpose: 'fast', recommended: true },
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', purpose: 'reasoning' },
  ],
  openai: [
    { value: 'gpt-6-luna', label: 'GPT-6 Luna', purpose: 'fast', recommended: true },
    { value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', purpose: 'balanced' },
    { value: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', purpose: 'visual' },
    { value: 'gpt-6-astra', label: 'GPT-6 Astra', purpose: 'reasoning' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini', purpose: 'legacy' },
  ],
  qwen: [
    { value: 'qwen-plus', label: 'Qwen Plus', purpose: 'balanced', recommended: true },
    { value: 'qwen-flash', label: 'Qwen Flash', purpose: 'fast', recommended: true },
  ],
  anthropic: [
    { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', purpose: 'fast', recommended: true },
    { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', purpose: 'balanced' },
    { value: 'claude-opus-5-5', label: 'Claude Opus 5.5', purpose: 'reasoning' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', purpose: 'legacy' },
  ],
  gemini: [
    { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', purpose: 'fast', recommended: true },
    { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', purpose: 'balanced' },
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', purpose: 'balanced' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', purpose: 'legacy' },
  ],
}

export type AiApiErrorCode = 'not-configured' | 'invalid-url' | 'permission' | 'timeout' | 'network' | 'invalid-response' | 'http'
export class AiApiError extends Error {
  readonly code: AiApiErrorCode
  readonly status?: number
  constructor(code: AiApiErrorCode, status?: number) {
    // Never include a provider error body, endpoint or credentials in logs/UI errors.
    super(status ? `${code}-${status}` : code)
    Object.setPrototypeOf(this, AiApiError.prototype)
    this.name = 'AiApiError'
    this.code = code
    this.status = status
  }
}

export function defaultAiApiConfig(provider: AiApiProvider = 'deepseek'): AiApiConfig {
  const preset = AI_API_PRESETS.find(item => item.provider === provider) || AI_API_PRESETS[0]
  return { ...preset, provider, ...(provider === 'custom' ? { baseUrl: '', model: '', protocol: 'openai' as const } : {}), apiKey: '', timeoutSeconds: 25 }
}

export function normalizeAiApiConfig(value: unknown): AiApiConfig {
  const record = value && typeof value === 'object' ? value as Partial<AiApiConfig> : {}
  const provider = record.provider === 'custom' || AI_API_PRESETS.some(item => item.provider === record.provider) ? record.provider as AiApiProvider : 'deepseek'
  const defaults = defaultAiApiConfig(provider)
  return {
    provider,
    protocol: ['openai', 'anthropic', 'gemini'].includes(record.protocol || '') ? record.protocol as AiApiProtocol : defaults.protocol,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl.trim() : defaults.baseUrl,
    model: typeof record.model === 'string' ? record.model.trim() : defaults.model,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey.trim() : '',
    timeoutSeconds: typeof record.timeoutSeconds === 'number' && Number.isFinite(record.timeoutSeconds) ? Math.max(5, Math.min(25, record.timeoutSeconds)) : 25,
  }
}

export function aiApiEndpoint(config: AiApiConfig): URL {
  let url: URL
  try { url = new URL(config.baseUrl) } catch { throw new AiApiError('invalid-url') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) throw new AiApiError('invalid-url')
  const path = url.pathname.replace(/\/+$/, '')
  if (config.protocol === 'openai') url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`
  else if (config.protocol === 'anthropic') url.pathname = path.endsWith('/messages') ? path : `${path}/messages`
  else if (!/\/models\/[^/]+:generateContent$/.test(path)) url.pathname = `${path}/models/${encodeURIComponent(config.model)}:generateContent`
  return url
}

export function aiApiOrigin(config: AiApiConfig): string {
  const url = aiApiEndpoint(config)
  return `${url.protocol}//${url.hostname}/*`
}

/** Start this directly in a click handler so Chromium retains the user gesture. */
export function requestAiApiPermission(config: AiApiConfig): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) return Promise.resolve(false)
  const origin = aiApiOrigin(config)
  return new Promise(resolve => {
    try { chrome.permissions.request({ origins: [origin] }, granted => { void chrome.runtime.lastError; resolve(Boolean(granted)) }) }
    catch { resolve(false) }
  })
}

async function hasApiPermission(config: AiApiConfig): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) return false
  return new Promise(resolve => {
    try { chrome.permissions.contains({ origins: [aiApiOrigin(config)] }, granted => { void chrome.runtime.lastError; resolve(Boolean(granted)) }) }
    catch { resolve(false) }
  })
}

export async function requestAiCompletion(configValue: AiApiConfig, system: string, input: string, signal?: AbortSignal): Promise<string> {
  const config = normalizeAiApiConfig(configValue)
  if (!config.apiKey || !config.model) throw new AiApiError('not-configured')
  const endpoint = aiApiEndpoint(config)
  if (signal?.aborted) throw new AiApiError('timeout')
  if (!await hasApiPermission(config)) throw new AiApiError('permission')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: object
  if (config.protocol === 'anthropic') {
    headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    const haiku = /^claude-haiku-5-5(?:$|-)/.test(config.model)
    const sonnet = /^claude-sonnet-5-5(?:$|-)/.test(config.model)
    const opus = /^claude-opus-5-5(?:$|-)/.test(config.model)
    body = { model: config.model, max_tokens: opus ? 2048 : 512, system, messages: [{ role: 'user', content: input }],
      ...(haiku || sonnet || opus ? { output_config: { effort: 'low' } } : {}),
      ...(haiku ? { thinking: { type: 'disabled' } } : sonnet ? { thinking: { type: 'between_tools' } } : {}),
    }
  } else if (config.protocol === 'gemini') {
    headers['x-goog-api-key'] = config.apiKey
    const minimalThinking = /^gemini-3\.5-flash(?:-lite)?(?:$|-)/.test(config.model)
    const flash = /^gemini-3\.[78]-flash(?:$|-)/.test(config.model)
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: input }] }], generationConfig: {
      maxOutputTokens: flash ? 2048 : 512, responseMimeType: 'application/json',
      ...(minimalThinking || flash ? { thinkingConfig: { thinkingLevel: minimalThinking ? 'minimal' : 'low' } } : {}),
    } }
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`
    const reasoning = /^(?:gpt-[56](?:[.-]|$)|o[134](?:-|$))/.test(config.model)
    const noThinking = /^gpt-(?:6-luna|6\.1-terra)(?:$|-)/.test(config.model)
    body = { model: config.model, stream: false,
      ...(config.provider === 'openai' || reasoning ? { max_completion_tokens: reasoning && !noThinking ? 2048 : 512 } : { max_tokens: 512 }),
      ...(reasoning ? { reasoning_effort: noThinking ? 'none' : 'low' } : {}),
      messages: [{ role: reasoning ? 'developer' : 'system', content: system }, { role: 'user', content: input }],
      ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
      ...(config.provider === 'qwen' ? { enable_thinking: false } : {}),
    }
  }
  // Stay below the MV3 background fetch response deadline.
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(abort, config.timeoutSeconds * 1000)
  try {
    const response = await fetch(endpoint.href, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    })
    if (!response.ok) throw new AiApiError('http', response.status)
    let data: any
    try { data = await response.json() } catch { throw new AiApiError('invalid-response') }
    if (!data || typeof data !== 'object') throw new AiApiError('invalid-response')
    let text: unknown
    if (config.protocol === 'anthropic') text = (Array.isArray(data.content) ? data.content : [])?.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('')
    else if (config.protocol === 'gemini') text = (Array.isArray(data.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [])?.filter((part: { thought?: boolean }) => !part.thought).map((part: { text?: string }) => part.text || '').join('')
    else text = data.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) throw new AiApiError('invalid-response')
    return text
  } catch (error) {
    if (controller.signal.aborted) throw new AiApiError('timeout')
    if (error instanceof AiApiError) throw error
    throw new AiApiError('network')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

export async function testAiApiConnection(config: AiApiConfig, signal?: AbortSignal): Promise<void> {
  const text = await requestAiCompletion(config, 'Return only the JSON object {"ok":true}.', 'Test connection. Return {"ok":true}.', signal)
  try {
    const json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    if (JSON.parse(json).ok !== true) throw new Error()
  } catch { throw new AiApiError('invalid-response') }
}
