import assert from 'node:assert/strict'
import test from 'node:test'
import { AI_TOKEN_USAGE_KEY, createAiTokenUsageEvent, readAiTokenUsageState } from '../../common/aiTokenUsage.ts'
import { recordAiTokenUsage } from './aiTokenUsage.ts'

function fixture(t: any) {
  const previous = (globalThis as any).chrome
  const local: Record<string, any> = {}
  let writes = 0
  let failWrite = false
  ;(globalThis as any).chrome = { storage: { local: {
    get: async (key: string) => { await new Promise(resolve => setTimeout(resolve, 1)); return { [key]: structuredClone(local[key]) } },
    set: async (value: object) => { if (failWrite) { failWrite = false; throw new Error('storage unavailable') } writes++; Object.assign(local, structuredClone(value)) },
  } } }
  t.after(() => { (globalThis as any).chrome = previous })
  return { local, rows: () => readAiTokenUsageState(local[AI_TOKEN_USAGE_KEY]).rows, writes: () => writes, failNextWrite: () => { failWrite = true } }
}

test('concurrent reports accumulate by provider/model through one writer', async t => {
  const f = fixture(t)
  const events = Array.from({ length: 24 }, () => ({ ...createAiTokenUsageEvent('deepseek', 'shared-model'), inputTokens: 10, outputTokens: 2 }))
  await Promise.all(events.map(recordAiTokenUsage))
  await recordAiTokenUsage({ ...createAiTokenUsageEvent('openai', 'shared-model'), inputTokens: 7, outputTokens: 3 })
  await recordAiTokenUsage({ ...createAiTokenUsageEvent('deepseek', 'other-model'), inputTokens: 8, outputTokens: 4 })
  assert.equal(f.rows().length, 3)
  assert.deepEqual(f.rows().map(({ provider, model, inputTokens, outputTokens, requests }) => ({ provider, model, inputTokens, outputTokens, requests })), [
    { provider: 'deepseek', model: 'shared-model', inputTokens: 240, outputTokens: 48, requests: 24 },
    { provider: 'openai', model: 'shared-model', inputTokens: 7, outputTokens: 3, requests: 1 },
    { provider: 'deepseek', model: 'other-model', inputTokens: 8, outputTokens: 4, requests: 1 },
  ])
})

test('replayed request IDs are deduplicated using persisted IDs', async t => {
  const f = fixture(t)
  const event = { ...createAiTokenUsageEvent('qwen', 'qwen-test'), inputTokens: 100, outputTokens: 20 }
  await Promise.all([recordAiTokenUsage(event), recordAiTokenUsage(event)])
  f.local[AI_TOKEN_USAGE_KEY] = JSON.parse(JSON.stringify(f.local[AI_TOKEN_USAGE_KEY]))
  await recordAiTokenUsage(event)
  assert.equal(f.writes(), 1)
  assert.equal(f.rows()[0].requests, 1)
  assert.equal(f.rows()[0].inputTokens, 100)
})

test('partial and missing reports do not erase reported counts or turn unknown into reported zero', async t => {
  const f = fixture(t)
  await recordAiTokenUsage(createAiTokenUsageEvent('custom', 'unreported'))
  assert.equal(f.rows()[0].inputReports, 0)
  assert.equal(f.rows()[0].outputReports, 0)
  await recordAiTokenUsage({ ...createAiTokenUsageEvent('custom', 'unreported'), inputTokens: 5 })
  await recordAiTokenUsage({ ...createAiTokenUsageEvent('custom', 'unreported'), inputTokens: 0, outputTokens: 0 })
  const row = f.rows()[0]
  assert.equal(row.requests, 3)
  assert.equal(row.inputTokens, 5)
  assert.equal(row.outputTokens, 0)
  assert.equal(row.inputReports, 2)
  assert.equal(row.outputReports, 1)
  assert.equal(row.unreportedRequests, 2)
})

test('a failed persistence does not poison the writer queue and can be safely retried', async t => {
  const f = fixture(t)
  const event = { ...createAiTokenUsageEvent('anthropic', 'claude-test'), inputTokens: 9, outputTokens: 2 }
  f.failNextWrite()
  await assert.rejects(recordAiTokenUsage(event))
  await recordAiTokenUsage(event)
  assert.equal(f.rows()[0].inputTokens, 9)
  assert.equal(f.rows()[0].requests, 1)
  await assert.rejects(recordAiTokenUsage({ ...event, inputTokens: -1 }))
  assert.equal(f.writes(), 1)
})
