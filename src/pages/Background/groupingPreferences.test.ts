import assert from 'node:assert/strict'
import test from 'node:test'
import { GROUPING_PREFERENCES_KEY } from '../../common/groupingPreferences.ts'
import { clearGroupingPreferences, consumeAutomaticGroupChange, groupTabsAutomatically, loadGroupingPreferences, recordManualGroupingChoice } from './groupingPreferences.ts'

function fixture(t: any) {
  const previous = (globalThis as any).chrome
  const tabs = new Map<number, any>([[1, { id: 1, windowId: 1, groupId: 9, url: 'https://wap.example/publish?appId=123&envId=7', title: 'WAP' }]])
  const local: Record<string, any> = {}
  const setting = { aiAutoGroupEnabled: true }
  ;(globalThis as any).chrome = {
    tabs: { get: async (id: number) => { if (!tabs.has(id)) throw new Error('closed'); return { ...tabs.get(id) } } },
    tabGroups: { get: async (id: number) => ({ id, title: '校园售卖' }) },
    storage: {
      local: { get: async (key: string) => ({ [key]: structuredClone(local[key]) }), set: async (values: object) => { Object.assign(local, structuredClone(values)) } },
      sync: { get: async () => ({ TA_SETTING: { ...setting } }) },
    },
  }
  t.after(async () => { await clearGroupingPreferences(); (globalThis as any).chrome = previous })
  return { tabs, local, setting, chrome: (globalThis as any).chrome }
}

test('a manual move records the selected group and rejected source without a model call', async t => {
  const f = fixture(t)
  recordManualGroupingChoice(1, 9, '了解其他任务')
  const preferences = await loadGroupingPreferences()
  assert.equal(preferences.length, 1)
  assert.equal(preferences[0].groupTitle, '校园售卖')
  assert.equal(preferences[0].avoidedGroupTitle, '了解其他任务')
  assert.equal(f.local[GROUPING_PREFERENCES_KEY].length, 1)
})

test('an ungroup-then-group gesture is coalesced into the final choice, not two training examples', async t => {
  const f = fixture(t)
  f.tabs.get(1).groupId = -1
  recordManualGroupingChoice(1, -1, '原任务')
  f.tabs.get(1).groupId = 9
  recordManualGroupingChoice(1, 9)
  const preferences = await loadGroupingPreferences()
  assert.equal(preferences.length, 1)
  assert.equal(preferences[0].choice, 'group')
  assert.equal(preferences[0].avoidedGroupTitle, '原任务')
  assert.equal(preferences[0].count, 1)
})

test('clearing cancels pending learning so old choices cannot reappear', async t => {
  const f = fixture(t)
  recordManualGroupingChoice(1, 9)
  await clearGroupingPreferences()
  await new Promise(resolve => setTimeout(resolve, 280))
  assert.deepEqual(await loadGroupingPreferences(), [])
  assert.deepEqual(f.local[GROUPING_PREFERENCES_KEY], [])
})

test('closed, pinned or navigated pages are not learned as manual grouping choices', async t => {
  const f = fixture(t)
  const original = { ...f.tabs.get(1) }
  recordManualGroupingChoice(1, 9, undefined, original)
  f.tabs.delete(1)
  assert.deepEqual(await loadGroupingPreferences(), [])
  f.tabs.set(1, { ...original, pinned: true })
  recordManualGroupingChoice(1, 9)
  assert.deepEqual(await loadGroupingPreferences(), [])
  f.tabs.set(1, { ...original, url: 'https://wap.example/publish?appId=456' })
  recordManualGroupingChoice(1, 9, undefined, original)
  assert.deepEqual(await loadGroupingPreferences(), [])
})

test('own automatic assignments are ignored while a concurrent manual assignment remains visible', async t => {
  const f = fixture(t)
  const manual: number[] = []
  const event = (id: number, groupId: number) => { if (!consumeAutomaticGroupChange(id, groupId, () => manual.push(id))) manual.push(id) }
  f.chrome.tabs.group = async () => { event(11, 20); event(12, 9); return 20 }
  await groupTabsAutomatically({ tabIds: 11, groupId: 20 })
  assert.deepEqual(manual, [12])
})

test('new-group events are classified after the API returns its ID and do not hide a later manual correction', async t => {
  const f = fixture(t)
  const manual: number[] = []
  const event = (groupId: number) => { if (!consumeAutomaticGroupChange(13, groupId, () => manual.push(groupId))) manual.push(groupId) }
  f.chrome.tabs.group = async () => { event(30); event(9); return 30 }
  await groupTabsAutomatically({ tabIds: 13, createProperties: { windowId: 1 } })
  assert.deepEqual(manual, [9])
})

test('manual choices in custom mode are not used as AI training feedback', async t => {
  const f = fixture(t)
  f.setting.aiAutoGroupEnabled = false
  recordManualGroupingChoice(1, 9)
  assert.deepEqual(await loadGroupingPreferences(), [])
})
