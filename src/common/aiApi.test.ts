import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_API_PRESETS, AiApiError, aiApiEndpoint, aiApiOrigin, aiApiRequestTimeoutSeconds, defaultAiApiConfig,
  normalizeAiApiConfig, requestAiApiPermission, requestAiCompletion, testAiApiConnection,
} from './aiApi.ts'
import type { AiApiConfig } from './aiApi.ts'
import { installAiTokenUsageRecorder, type AiTokenUsageEvent } from './aiTokenUsage.ts'

function fixture(t: any, allowed = true) {
  const originalFetch = globalThis.fetch
  const originalChrome = (globalThis as any).chrome
  const calls: Array<{ url: string; init: any; body: any }> = []
  let respond = (_url: string, _init: any): Promise<Response> => Promise.resolve(Response.json({ choices: [{ message: { content: '{"action":"leave"}' } }] }))
  ;(globalThis as any).chrome = {
    runtime: {},
    permissions: {
      contains: (_permissions: any, callback: any) => callback(allowed),
      request: (_permissions: any, callback: any) => callback(allowed),
    },
  }
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return respond(url, init)
  }) as typeof fetch
  t.after(() => { globalThis.fetch = originalFetch; (globalThis as any).chrome = originalChrome })
  return { calls, respond: (handler: typeof respond) => { respond = handler } }
}

const configured = (provider: AiApiConfig['provider'] = 'deepseek') => ({ ...defaultAiApiConfig(provider), apiKey: 'test-secret-key' })

function shortStreamTimers(t: any) {
  const timeout = globalThis.setTimeout
  const interval = globalThis.setInterval
  ;(globalThis as any).setTimeout = (callback: any, ms: number, ...args: any[]) => timeout(callback, ms === 25_000 ? 10 : ms === 60_000 ? 120 : ms, ...args)
  ;(globalThis as any).setInterval = (callback: any, ms: number, ...args: any[]) => interval(callback, ms === 20_000 ? 10 : ms, ...args)
  t.after(() => { globalThis.setTimeout = timeout; globalThis.setInterval = interval })
  return { sleep: (ms: number) => new Promise(resolve => timeout(resolve, ms)), timeout }
}

test('presets require only a key and preserve explicit model/endpoint overrides', () => {
  for (const preset of AI_API_PRESETS) {
    const config = normalizeAiApiConfig({ provider: preset.provider, apiKey: ' key ' })
    assert.equal(config.apiKey, 'key')
    assert.equal(config.baseUrl, preset.baseUrl)
    assert.equal(config.model, preset.model)
    assert.ok(aiApiEndpoint(config).href.startsWith('https://'))
  }
  assert.equal(normalizeAiApiConfig({ timeoutSeconds: 1000 }).timeoutSeconds, 25)
  assert.equal(normalizeAiApiConfig({ timeoutSeconds: 1 }).timeoutSeconds, 5)
  assert.equal(defaultAiApiConfig('custom').baseUrl, '')
})

test('updated defaults preserve previously saved and custom model IDs', () => {
  assert.equal(defaultAiApiConfig('openai').model, 'gpt-6-luna')
  for (const model of ['gpt-4.1-mini', 'ft:organization:my-task-model']) {
    const saved = normalizeAiApiConfig({ provider: 'openai', model, apiKey: 'saved-key', baseUrl: 'https://gateway.example/v1' })
    assert.equal(saved.model, model)
    assert.equal(saved.baseUrl, 'https://gateway.example/v1')
    assert.equal(saved.apiKey, 'saved-key')
  }
})

test('current OpenAI models use compatible completion limits and supported reasoning levels', async t => {
  const f = fixture(t)
  f.respond(async (_url, init) => {
    const body = JSON.parse(init.body)
    if ('max_tokens' in body || !body.max_completion_tokens || body.messages[0].role !== 'developer') return Response.json({}, { status: 400 })
    const canDisable = ['gpt-6-luna', 'gpt-6.1-terra'].includes(body.model)
    if (body.reasoning_effort !== (canDisable ? 'none' : 'low')) return Response.json({}, { status: 400 })
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
  })
  for (const model of ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra']) {
    await testAiApiConnection({ ...configured('openai'), model })
  }
  assert.equal(f.calls.length, 4)
})

test('custom OpenAI gateways support known reasoning models and keep generic model parameters unchanged', async t => {
  const f = fixture(t)
  const config = { ...configured('custom'), baseUrl: 'https://gateway.example/v1', model: 'gpt-6-luna' }
  await requestAiCompletion(config, 'rules', 'evidence')
  assert.equal(f.calls[0].body.max_tokens, undefined)
  assert.equal(f.calls[0].body.reasoning_effort, 'none')
  await requestAiCompletion({ ...config, model: 'my-local-model' }, 'rules', 'evidence')
  assert.equal(f.calls[1].body.max_tokens, 512)
  assert.equal(f.calls[1].body.max_completion_tokens, undefined)
  assert.equal(f.calls[1].body.reasoning_effort, undefined)
})

test('Claude model choices respect per-model thinking restrictions and read the final text block', async t => {
  const f = fixture(t)
  f.respond(async (_url, init) => {
    const body = JSON.parse(init.body)
    const valid = body.model === 'claude-haiku-5-5' ? body.thinking?.type === 'disabled'
      : body.model === 'claude-sonnet-5-5' ? body.thinking?.type === 'between_tools'
        : body.thinking === undefined && body.max_tokens > 512
    if (!valid || body.output_config.effort !== 'low') return Response.json({}, { status: 400 })
    return Response.json({ content: [{ type: 'thinking', thinking: 'not a decision' }, { type: 'text', text: '{"ok":true}' }] })
  })
  for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
    await testAiApiConnection({ ...configured('anthropic'), model })
  }
})

test('Gemini model choices do not send unsupported minimal thinking to newer Flash models', async t => {
  const f = fixture(t)
  f.respond(async (_url, init) => {
    const body = JSON.parse(init.body)
    const level = body.generationConfig.thinkingConfig?.thinkingLevel
    const currentFlash = _url.includes('gemini-3.8-flash')
    if (level !== (currentFlash ? 'low' : 'minimal')) return Response.json({}, { status: 400 })
    return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'not a decision' }, { text: '{"ok":true}' }] } }] })
  })
  for (const model of ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash']) {
    await testAiApiConnection({ ...configured('gemini'), model })
  }
})

for (const preset of AI_API_PRESETS) {
  test(`${preset.label} uses its native endpoint, authentication and response format`, async t => {
    const f = fixture(t)
    const config = configured(preset.provider)
    f.respond(async () => {
      if (preset.protocol === 'anthropic') return Response.json({ content: [{ type: 'text', text: '{"action":"leave"}' }] })
      if (preset.protocol === 'gemini') return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'hidden thinking' }, { text: '{"action":"leave"}' }] } }] })
      return Response.json({ choices: [{ message: { content: '{"action":"leave"}' } }] })
    })
    const output = await requestAiCompletion(config, 'system task rules', 'page evidence')
    assert.equal(output, '{"action":"leave"}')
    assert.equal(f.calls.length, 1)
    const { url, body, init } = f.calls[0]
    assert.equal(url.includes(config.apiKey), false)
    assert.equal(init.redirect, 'error')
    assert.equal(init.credentials, 'omit')
    assert.ok(init.signal)
    if (preset.protocol === 'anthropic') {
      assert.ok(url.endsWith('/v1/messages'))
      assert.equal(init.headers['x-api-key'], config.apiKey)
      assert.equal(body.system, 'system task rules')
    } else if (preset.protocol === 'gemini') {
      assert.ok(url.endsWith(`/models/${config.model}:generateContent`))
      assert.equal(init.headers['x-goog-api-key'], config.apiKey)
      assert.equal(body.systemInstruction.parts[0].text, 'system task rules')
    } else {
      assert.ok(url.endsWith('/chat/completions'))
      assert.equal(init.headers.Authorization, `Bearer ${config.apiKey}`)
      assert.equal(body.messages.length, 2)
      assert.equal(body.messages[0].content, 'system task rules')
      assert.equal(body.messages[1].content, 'page evidence')
    }
  })
}

test('custom URLs accept base/full endpoints and loopback HTTP, and reject unsafe URLs', () => {
  const config = { ...configured('custom'), baseUrl: 'http://127.0.0.1:1234/v1/', model: 'local-model' }
  assert.equal(aiApiEndpoint(config).href, 'http://127.0.0.1:1234/v1/chat/completions')
  assert.equal(aiApiOrigin(config), 'http://127.0.0.1/*')
  config.baseUrl = 'https://gateway.example/custom/chat/completions'
  assert.equal(aiApiEndpoint(config).href, config.baseUrl)
  for (const baseUrl of ['http://remote.example/v1', 'https://key@example.com/v1', 'https://example.com/v1?key=secret', 'javascript:alert(1)', 'https://example.com/v1#key']) {
    assert.throws(() => aiApiEndpoint({ ...config, baseUrl }), (error: unknown) => error instanceof AiApiError && error.code === 'invalid-url')
  }
  assert.equal(aiApiEndpoint({ ...config, protocol: 'anthropic', baseUrl: 'https://gateway.example/v1/messages' }).pathname, '/v1/messages')
  assert.equal(aiApiEndpoint({ ...config, protocol: 'gemini', baseUrl: 'https://gateway.example/v1beta/models/model:generateContent' }).pathname, '/v1beta/models/model:generateContent')
})

test('missing key or host permission never sends a request', async t => {
  const f = fixture(t, false)
  await assert.rejects(requestAiCompletion(defaultAiApiConfig(), '', ''), (error: unknown) => error instanceof AiApiError && error.code === 'not-configured')
  await assert.rejects(requestAiCompletion(configured(), '', ''), (error: unknown) => error instanceof AiApiError && error.code === 'permission')
  assert.equal(await requestAiApiPermission(configured()), false)
  assert.equal(f.calls.length, 0)
})

test('provider errors never expose key or echoed content and are not retried', async t => {
  const f = fixture(t)
  f.respond(async () => Response.json({ error: { message: 'test-secret-key private browsing title' } }, { status: 401 }))
  await assert.rejects(requestAiCompletion(configured(), '', 'private browsing title'), (error: unknown) => {
    assert.ok(error instanceof AiApiError)
    assert.equal(error.status, 401)
    assert.equal(error.message, 'http-401')
    return true
  })
  assert.equal(f.calls.length, 1)
})

test('malformed/empty API responses produce a safe response error', async t => {
  const f = fixture(t)
  for (const response of [new Response('not-json'), Response.json({}), Response.json({ choices: [{ message: { content: null } }] })]) {
    f.respond(async () => response)
    await assert.rejects(requestAiCompletion(configured(), '', ''), (error: unknown) => error instanceof AiApiError && error.code === 'invalid-response')
  }
})

test('aborting a request cancels fetch; raw network errors are sanitized', async t => {
  const f = fixture(t)
  const controller = new AbortController()
  f.respond((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('test-secret-key')), { once: true })
    controller.abort()
  }))
  await assert.rejects(requestAiCompletion(configured(), '', '', controller.signal), (error: unknown) => error instanceof AiApiError && error.code === 'timeout')
  f.respond(async () => { throw new Error('test-secret-key') })
  await assert.rejects(requestAiCompletion(configured(), '', ''), (error: unknown) => error instanceof AiApiError && error.message === 'network')
})

test('connection test validates a minimal response without browsing data', async t => {
  const f = fixture(t)
  f.respond(async () => Response.json({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }))
  await testAiApiConnection(configured())
  assert.equal(f.calls[0].body.messages[1].content, 'Test connection. Return {"ok":true}.')
  f.respond(async () => Response.json({ choices: [{ message: { content: 'hello' } }] }))
  await assert.rejects(testAiApiConnection(configured()), (error: unknown) => error instanceof AiApiError && error.code === 'invalid-response')
})

test('completion and connection test record reported usage against the request configuration', async t => {
  const f = fixture(t)
  const events: AiTokenUsageEvent[] = []
  installAiTokenUsageRecorder(async event => { events.push({ ...event }) })
  t.after(() => installAiTokenUsageRecorder(undefined))
  f.respond(async () => Response.json({ model: 'canonical-model-snapshot', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }))
  const config = configured('openai')
  await requestAiCompletion(config, 'private instructions', 'private page content')
  await testAiApiConnection(config)
  assert.equal(events.length, 2)
  assert.equal(events[0].provider, 'openai')
  assert.equal(events[0].model, config.model)
  assert.equal(events[0].inputTokens, 12)
  assert.equal(events[0].outputTokens, 3)
  assert.notEqual(events[0].requestId, events[1].requestId)
  assert.equal(JSON.stringify(events).includes('private'), false)
  assert.equal(JSON.stringify(events).includes(config.apiKey), false)
})

test('responses with unusable content still retain usage; network failures remain unknown', async t => {
  const f = fixture(t)
  const events: AiTokenUsageEvent[] = []
  installAiTokenUsageRecorder(async event => { events.push({ ...event }) })
  t.after(() => installAiTokenUsageRecorder(undefined))
  f.respond(async () => Response.json({ usage: { prompt_tokens: 20, completion_tokens: 0 } }))
  await assert.rejects(requestAiCompletion(configured(), '', ''))
  assert.equal(events[0].inputTokens, 20)
  assert.equal(events[0].outputTokens, 0)
  f.respond(async () => { throw new Error('offline') })
  await assert.rejects(requestAiCompletion(configured(), '', ''))
  assert.equal(events[1].inputTokens, undefined)
  assert.equal(events[1].outputTokens, undefined)
})

test('preflight failures do not report usage and recording failures cannot break completion', async t => {
  fixture(t, false)
  const events: AiTokenUsageEvent[] = []
  installAiTokenUsageRecorder(async event => { events.push(event) })
  t.after(() => installAiTokenUsageRecorder(undefined))
  await assert.rejects(requestAiCompletion(defaultAiApiConfig(), '', ''))
  await assert.rejects(requestAiCompletion(configured(), '', ''))
  assert.equal(events.length, 0)
  ;(globalThis as any).chrome.permissions.contains = (_permissions: any, callback: any) => callback(true)
  installAiTokenUsageRecorder(async () => { throw new Error('disk unavailable') })
  assert.equal(await requestAiCompletion(configured(), '', ''), '{"action":"leave"}')
})

test('OpenAI separates first response and completion deadlines without changing existing credentials or models', () => {
  const config = normalizeAiApiConfig({ ...configured('openai'), timeoutSeconds: 25, completionTimeoutSeconds: undefined, model: 'my-saved-model', baseUrl: 'https://gateway.example/v1' })
  assert.equal(config.timeoutSeconds, 25)
  assert.equal(config.completionTimeoutSeconds, 60)
  assert.equal(aiApiRequestTimeoutSeconds(config), 60)
  assert.equal(config.model, 'my-saved-model')
  assert.equal(config.baseUrl, 'https://gateway.example/v1')
  assert.equal(normalizeAiApiConfig({ ...config, completionTimeoutSeconds: 1000 }).completionTimeoutSeconds, 120)
  assert.equal(normalizeAiApiConfig({ ...config, completionTimeoutSeconds: 5 }).completionTimeoutSeconds, 25)
  assert.equal(aiApiRequestTimeoutSeconds(configured('deepseek')), 25)
})

test('OpenAI accepts a complete streamed decision after the first response deadline and records final usage once', async t => {
  const f = fixture(t)
  const timers = shortStreamTimers(t)
  let heartbeats = 0
  ;(globalThis as any).chrome.runtime.getPlatformInfo = (callback: any) => { heartbeats++; callback({}) }
  const events: AiTokenUsageEvent[] = []
  installAiTokenUsageRecorder(async event => { events.push({ ...event }) })
  t.after(() => installAiTokenUsageRecorder(undefined))
  f.respond(async () => new Response(new ReadableStream({ start(controller) {
    timers.timeout(() => {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{\\"action\\":\\"leave\\"}"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":33,"completion_tokens":7}}\n\ndata: [DONE]\n\n'))
      controller.close()
    }, 40)
  } }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }))
  assert.equal(await requestAiCompletion(configured('openai'), '', ''), '{"action":"leave"}')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].body.stream, true)
  assert.equal(f.calls[0].body.stream_options.include_usage, true)
  assert.equal(events.length, 1)
  assert.equal(events[0].inputTokens, 33)
  assert.equal(events[0].outputTokens, 7)
  assert.ok(heartbeats > 0)
  const after = heartbeats
  await timers.sleep(25)
  assert.equal(heartbeats, after)
})

test('OpenAI still cancels when no response headers arrive and does not retry', async t => {
  const f = fixture(t)
  shortStreamTimers(t)
  f.respond((_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }) }))
  await assert.rejects(requestAiCompletion(configured('openai'), '', ''), (error: unknown) => {
    assert.ok(error instanceof AiApiError)
    assert.equal(error.code, 'timeout')
    assert.equal(error.diagnostics?.phase, 'first-response')
    assert.equal(error.diagnostics?.firstResponseMs, undefined)
    return true
  })
  assert.equal(f.calls.length, 1)
})

test('OpenAI cancels an idle completion stream at its full-result deadline', async t => {
  const f = fixture(t)
  shortStreamTimers(t)
  let cancelled = false
  f.respond(async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'Content-Type': 'text/event-stream' } }))
  await assert.rejects(requestAiCompletion(configured('openai'), '', ''), (error: unknown) => {
    assert.ok(error instanceof AiApiError)
    assert.equal(error.code, 'timeout')
    assert.equal(error.diagnostics?.phase, 'completion')
    assert.equal(typeof error.diagnostics?.firstResponseMs, 'number')
    return true
  })
  assert.equal(cancelled, true)
  assert.equal(f.calls.length, 1)
})

test('request diagnostics report actual model, input size and elapsed phases without prompt/key data', async t => {
  fixture(t)
  const observed: any[] = []
  await requestAiCompletion(configured('openai'), 'secret-system', 'secret-page', undefined, value => observed.push(value))
  assert.equal(observed[0].phase, 'first-response')
  assert.equal(observed[1].phase, 'completion')
  assert.equal(observed[observed.length - 1].phase, 'complete')
  assert.equal(observed[0].inputChars, 'secret-system'.length + 'secret-page'.length)
  assert.equal(observed[0].model, configured('openai').model)
  assert.equal(observed[0].provider, 'openai')
  assert.equal(JSON.stringify(observed).includes('secret-system'), false)
  assert.equal(JSON.stringify(observed).includes(configured('openai').apiKey), false)
})
