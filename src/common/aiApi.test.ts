import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_API_PRESETS, AiApiError, aiApiEndpoint, aiApiOrigin, defaultAiApiConfig,
  normalizeAiApiConfig, requestAiApiPermission, requestAiCompletion, testAiApiConnection,
} from './aiApi.ts'
import type { AiApiConfig } from './aiApi.ts'

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
