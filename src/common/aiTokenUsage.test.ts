import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiTokenUsageEvent, installAiTokenUsageRecorder, parseAiTokenUsage, readAiTokenUsageEvent, readAiTokenUsageState, RECORD_AI_TOKEN_USAGE_MESSAGE, reportAiTokenUsage } from './aiTokenUsage.ts'

test('OpenAI-compatible usage does not add cached or reasoning subsets twice', () => {
  assert.deepEqual(parseAiTokenUsage('openai', { usage: {
    prompt_tokens: 100, completion_tokens: 40, total_tokens: 140,
    prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 30 },
  } }), { inputTokens: 100, outputTokens: 40 })
  assert.deepEqual(parseAiTokenUsage('openai', { usage: { input_tokens: 7, output_tokens: 3 } }), { inputTokens: 7, outputTokens: 3 })
})

test('Anthropic total input includes cache creation and reads without adding TTL breakdowns', () => {
  assert.deepEqual(parseAiTokenUsage('anthropic', { usage: {
    input_tokens: 20, cache_creation_input_tokens: 100, cache_read_input_tokens: 200, output_tokens: 30,
    cache_creation: { ephemeral_5m_input_tokens: 100 },
  } }), { inputTokens: 320, outputTokens: 30 })
  assert.deepEqual(parseAiTokenUsage('anthropic', { usage: { input_tokens: 20, output_tokens: 0 } }), { inputTokens: 20, outputTokens: 0 })
})

test('Gemini output includes thoughts and input already includes its cache subset', () => {
  assert.deepEqual(parseAiTokenUsage('gemini', { usageMetadata: {
    promptTokenCount: 300, cachedContentTokenCount: 200, candidatesTokenCount: 15, thoughtsTokenCount: 85, totalTokenCount: 400,
  } }), { inputTokens: 300, outputTokens: 100 })
  assert.deepEqual(parseAiTokenUsage('gemini', { usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } }), { inputTokens: 0, outputTokens: 0 })
})

test('missing or invalid counts remain unknown instead of zero or inferred total splits', () => {
  for (const bad of [undefined, null, -1, 0.5, '10', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseAiTokenUsage('openai', { usage: { prompt_tokens: bad, completion_tokens: 2 } }).inputTokens, undefined)
    assert.equal(parseAiTokenUsage('anthropic', { usage: { input_tokens: 10, cache_read_input_tokens: bad, output_tokens: 2 } }).inputTokens, bad === undefined ? 10 : undefined)
  }
  assert.deepEqual(parseAiTokenUsage('openai', { usage: { total_tokens: 100 } }), { inputTokens: undefined, outputTokens: undefined })
  assert.deepEqual(parseAiTokenUsage('gemini', { usageMetadata: { totalTokenCount: 100, thoughtsTokenCount: 5 } }), { inputTokens: undefined, outputTokens: undefined })
  assert.equal(parseAiTokenUsage('anthropic', { usage: { input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1 } }).inputTokens, undefined)
  assert.equal(parseAiTokenUsage('gemini', { usageMetadata: { candidatesTokenCount: Number.MAX_SAFE_INTEGER, thoughtsTokenCount: 1 } }).outputTokens, undefined)
})

test('usage records whitelist fields and reject malformed events or storage rows', () => {
  const event = { ...createAiTokenUsageEvent('deepseek', ' model-a '), inputTokens: 0, apiKey: 'private', prompt: 'private' }
  const clean = readAiTokenUsageEvent(event)!
  assert.equal(clean.model, 'model-a')
  assert.equal(clean.inputTokens, 0)
  assert.equal('apiKey' in clean, false)
  assert.equal('prompt' in clean, false)
  assert.notEqual(createAiTokenUsageEvent('deepseek', 'model-a').requestId, event.requestId)
  assert.equal(readAiTokenUsageEvent({ ...event, inputTokens: -1 }), undefined)
  assert.equal(readAiTokenUsageEvent({ ...event, provider: 'unknown' }), undefined)
  assert.deepEqual(readAiTokenUsageState({ rows: [null, { provider: 'unknown' }], recentRequestIds: [null, 'valid'] }), { rows: [], recentRequestIds: ['valid'] })
})

test('popup usage reporting reaches the background and ignores unavailable runtime', async t => {
  const previous = (globalThis as any).chrome
  t.after(() => { (globalThis as any).chrome = previous; installAiTokenUsageRecorder(undefined) })
  const event = createAiTokenUsageEvent('openai', 'test-model')
  let received: any
  ;(globalThis as any).chrome = { runtime: { sendMessage: (message: any, callback: any) => { received = message; callback({ ok: true }) } } }
  await reportAiTokenUsage(event)
  assert.deepEqual(received, { type: RECORD_AI_TOKEN_USAGE_MESSAGE, event })
  ;(globalThis as any).chrome.runtime.sendMessage = () => { throw new Error('extension closed') }
  await assert.doesNotReject(reportAiTokenUsage(event))
  installAiTokenUsageRecorder(async () => { throw new Error('storage unavailable') })
  await assert.doesNotReject(reportAiTokenUsage(event))
})
