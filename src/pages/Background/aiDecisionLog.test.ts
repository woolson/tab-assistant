import assert from 'node:assert/strict'
import test from 'node:test'
import { AI_DECISION_LOG_KEY, clearAiDecisionLog, readAiDecisionLog, recordAiDecision } from './aiDecisionLog.ts'

test('decision log ignores a missing storage area and rejects corrupt entries', () => {
  recordAiDecision({
    url: 'https://example.com',
    title: 'Example',
    result: 'domain',
    via: 'domain',
  })
  assert.deepEqual(readAiDecisionLog(undefined), [])
  assert.deepEqual(readAiDecisionLog([{ id: 1 }]), [])
  assert.equal(readAiDecisionLog([{
    id: 'a',
    at: 1,
    url: 'https://example.com',
    title: 'Example',
    result: 'domain',
    via: 'domain',
  }]).length, 1)
  assert.equal(AI_DECISION_LOG_KEY, 'TA_AI_DECISION_LOG')
})

test('search-topic decisions remain visible without changing the recorded model choice', () => {
  const entry = {
    id: 'search-topic', at: 1, url: 'https://www.baidu.com/s?wd=S16', title: 'S16_百度搜索',
    result: 'create', via: 'search', modelStatus: 'answered', modelAction: 'leave',
    groupId: 7, groupTitle: 'Research S16',
  }
  assert.deepEqual(readAiDecisionLog([entry]), [entry])
})

function loggingFixture(t: any, enabled?: boolean) {
  const previous = (globalThis as any).chrome
  const settings: { decisionLogEnabled?: boolean } = {}
  if (enabled !== undefined) settings.decisionLogEnabled = enabled
  let entries: unknown[] = []
  let writes = 0
  const local = {
    get: async (_key: string) => ({ [AI_DECISION_LOG_KEY]: structuredClone(entries) }),
    set: async (values: any) => { entries = values[AI_DECISION_LOG_KEY]; writes++ },
  }
  ;(globalThis as any).chrome = {
    storage: {
      sync: { get: async () => ({ TA_SETTING: { ...settings } }) },
      local,
    },
  }
  t.after(() => { (globalThis as any).chrome = previous })
  return { settings, local, entries: () => entries as any[], writes: () => writes }
}

const decision = (url = 'https://example.com/task') => ({ url, title: 'Task', result: 'create' as const, via: 'model' as const })

test('logging defaults off and only an explicit enable records decisions', async t => {
  const f = loggingFixture(t)
  await recordAiDecision(decision())
  assert.equal(f.writes(), 0)
  f.settings.decisionLogEnabled = true
  await recordAiDecision(decision())
  assert.equal(f.entries().length, 1)
  f.settings.decisionLogEnabled = false
  await recordAiDecision(decision('https://example.com/disabled'))
  assert.equal(f.entries().length, 1)
  assert.equal(f.writes(), 1)
})

test('turning logging off while a write is waiting drops the pending entry', async t => {
  const f = loggingFixture(t, true)
  let unlock!: () => void
  let entered!: () => void
  const blocked = new Promise<void>(resolve => { unlock = resolve })
  const reading = new Promise<void>(resolve => { entered = resolve })
  const read = f.local.get
  f.local.get = async key => { entered(); await blocked; return read(key) }
  const pending = recordAiDecision(decision())
  await reading
  f.settings.decisionLogEnabled = false
  unlock()
  await pending
  assert.equal(f.writes(), 0)
})

test('enabling later does not record decisions captured while logging was disabled', async t => {
  const f = loggingFixture(t, true)
  let unlock!: () => void
  let entered!: () => void
  const blocked = new Promise<void>(resolve => { unlock = resolve })
  const reading = new Promise<void>(resolve => { entered = resolve })
  const read = f.local.get
  f.local.get = async key => { entered(); await blocked; return read(key) }
  const first = recordAiDecision(decision('https://example.com/enabled'))
  await reading
  f.settings.decisionLogEnabled = false
  const disabled = recordAiDecision(decision('https://example.com/disabled'))
  f.settings.decisionLogEnabled = true
  unlock()
  await Promise.all([first, disabled])
  assert.deepEqual(f.entries().map(entry => entry.url), ['https://example.com/enabled'])
})

test('clearing also removes queued old entries and only later decisions remain', async t => {
  const f = loggingFixture(t, true)
  let unlock!: () => void
  let entered!: () => void
  const blocked = new Promise<void>(resolve => { unlock = resolve })
  const reading = new Promise<void>(resolve => { entered = resolve })
  const read = f.local.get
  f.local.get = async key => { entered(); await blocked; return read(key) }
  const old = recordAiDecision(decision('https://example.com/old'))
  await reading
  const clear = clearAiDecisionLog()
  const fresh = recordAiDecision(decision('https://example.com/fresh'))
  unlock()
  await Promise.all([old, clear, fresh])
  assert.deepEqual(f.entries().map(entry => entry.url), ['https://example.com/fresh'])
  assert.equal(f.settings.decisionLogEnabled, true)
})

test('existing logs can be cleared while logging is off without enabling it', async t => {
  const f = loggingFixture(t, false)
  await f.local.set({ [AI_DECISION_LOG_KEY]: [{ id: 'old', ...decision() }] })
  await clearAiDecisionLog()
  assert.equal(f.entries().length, 0)
  assert.equal(f.settings.decisionLogEnabled, false)
})
