import assert from 'node:assert/strict'
import test from 'node:test'
import { InvalidAiStreamError, readAiCompletionStream } from './aiStream.ts'
import { parseAiTokenUsage } from './aiTokenUsage.ts'

function streamResponse(text: string, step = 7) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let index = 0; index < bytes.length; index += step) controller.enqueue(bytes.slice(index, index + step))
    controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
}

test('SSE handles split UTF-8/CRLF frames and retains the usage chunk after finish_reason', async () => {
  const chunks = [
    { choices: [{ delta: { role: 'assistant' }, finish_reason: null }], usage: null },
    { choices: [{ delta: { content: '{"action":"create",' } }] },
    { choices: [{ delta: { content: '"title":"弹外抽数"}' }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 120, completion_tokens: 10 } },
  ]
  const response = streamResponse(': ping\r\n\r\n' + chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\r\n\r\n').join('') + 'data: [DONE]\r\n\r\n', 2)
  const reported: unknown[] = []
  const text = await readAiCompletionStream(response, new AbortController().signal, chunk => {
    const usage = parseAiTokenUsage('openai', chunk)
    if (usage.inputTokens !== undefined) reported.push(usage)
  })
  assert.equal(text, '{"action":"create","title":"弹外抽数"}')
  assert.deepEqual(reported, [{ inputTokens: 120, outputTokens: 10 }])
})

test('an interrupted SSE response cannot apply a partly received decision', async () => {
  for (const value of ['data: {bad json}\n\n', 'data: {"choices":[{"delta":{"content":"{\\"action\\":\\"leave\\"}"}}]}\n\n', 'data: {"error":{"message":"private provider error"}}\n\n']) {
    await assert.rejects(readAiCompletionStream(streamResponse(value), new AbortController().signal, () => {}), InvalidAiStreamError)
  }
})

test('aborting an idle stream cancels its reader instead of waiting forever', async () => {
  const controller = new AbortController()
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel() { cancelled = true } }))
  const result = readAiCompletionStream(response, controller.signal, () => {})
  controller.abort()
  await assert.rejects(result)
  assert.equal(cancelled, true)
})

test('oversized SSE bodies are rejected within a bounded memory budget', async () => {
  await assert.rejects(readAiCompletionStream(streamResponse('data: ' + 'x'.repeat(1024 * 1024 + 1), 64 * 1024), new AbortController().signal, () => {}), InvalidAiStreamError)
})

test('completed generation with final usage does not wait for a missing DONE or transport close', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{\\"action\\":\\"leave\\"}"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":15,"completion_tokens":3}}\n\n')) },
    cancel() { cancelled = true },
  }))
  const reported: unknown[] = []
  const text = await readAiCompletionStream(response, new AbortController().signal, chunk => {
    const usage = parseAiTokenUsage('openai', chunk)
    if (usage.inputTokens !== undefined) reported.push(usage)
  })
  assert.equal(text, '{"action":"leave"}')
  assert.deepEqual(reported, [{ inputTokens: 15, outputTokens: 3 }])
  assert.equal(cancelled, true)
})

test('a terminal generation without usage gets a bounded grace period instead of a full API timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let cancelled = false
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{\\"action\\":\\"leave\\"}"},"finish_reason":"stop"}]}\n\n')) },
    cancel() { cancelled = true },
  }))
  let settled = false
  const result = readAiCompletionStream(response, new AbortController().signal, () => {}).then(text => { settled = true; return text })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  t.mock.timers.tick(1000)
  assert.equal(await result, '{"action":"leave"}')
  assert.equal(cancelled, true)
})

test('usage arriving during the completion grace period is retained', async () => {
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"},"finish_reason":"stop"}]}\n\n'))
    setTimeout(() => controller.enqueue(new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tokens":21,"completion_tokens":4}}\n\n')), 10)
  } }))
  let tokens
  assert.equal(await readAiCompletionStream(response, new AbortController().signal, chunk => {
    const usage = parseAiTokenUsage('openai', chunk)
    if (usage.inputTokens !== undefined) tokens = usage
  }), '{"ok":true}')
  assert.deepEqual(tokens, { inputTokens: 21, outputTokens: 4 })
})
