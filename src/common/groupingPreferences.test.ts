import assert from 'node:assert/strict'
import test from 'node:test'
import { GROUPING_PREFERENCE_LIMIT, mergeGroupingPreference, preferencePageUrl, readGroupingPreferences, selectGroupingPreferences, type GroupingPreference } from './groupingPreferences.ts'

const preference = (overrides: Partial<GroupingPreference> = {}): GroupingPreference => ({
  id: 'pref-sales', url: 'https://wap.example/publish?appId=123&envId=7', title: 'WAP', choice: 'group', groupTitle: '校园售卖', count: 1, updatedAt: 10, ...overrides,
})

test('page identity preserves business IDs and hash routes while dropping credentials and tracking parameters', () => {
  assert.equal(preferencePageUrl('https://u:p@wap.example/publish?envId=7&appId=123&spm=test&utm_source=x&access_token=secret'), 'https://wap.example/publish?appId=123&envId=7')
  assert.equal(preferencePageUrl('https://wap.example/#!/publish?envId=7&appId=123&token=secret'), 'https://wap.example/#/publish?appId=123&envId=7')
  assert.equal(preferencePageUrl('file:///tmp/private.html'), undefined)
})

test('preference storage accepts only bounded structured choices and caps history', () => {
  const records = Array.from({ length: 110 }, (_, index) => preference({ id: `pref-${index}`, url: `https://example.com/${index}`, updatedAt: index }))
  assert.equal(readGroupingPreferences(records).length, GROUPING_PREFERENCE_LIMIT)
  assert.equal(readGroupingPreferences([{ ...preference(), count: -1 }, { ...preference(), id: '' }, { ...preference(), choice: 'group', groupTitle: '' }]).length, 0)
  const sanitized = readGroupingPreferences([{ ...preference(), title: 'x'.repeat(300), body: 'not a stored field' }])[0]
  assert.equal(sanitized.title.length, 160)
  assert.equal('body' in sanitized, false)
})

test('repeated choices strengthen one page preference and a later correction replaces it', () => {
  let records = [preference()]
  records = mergeGroupingPreference(records, { ...preference(), updatedAt: 20 })
  assert.equal(records.length, 1)
  assert.equal(records[0].count, 2)
  records = mergeGroupingPreference(records, { url: preference().url, title: 'WAP', choice: 'ungrouped', avoidedGroupTitle: '校园售卖', updatedAt: 30 })
  assert.equal(records.length, 1)
  assert.equal(records[0].choice, 'ungrouped')
  assert.equal(records[0].count, 1)
  assert.equal(records[0].groupTitle, undefined)
})

test('an exact page matches despite tracking noise and resolves current group IDs by title', () => {
  const result = selectGroupingPreferences([preference()], { url: preference().url + '&utm_source=test', title: 'WAP' }, [{ id: 99, title: '校园售卖' }])
  assert.equal(result[0].match, 'same-page')
  assert.deepEqual(result[0].availableGroupIds, [99])
})

test('an app choice can apply across routes but never becomes a platform-wide or cross-environment rule', () => {
  const groups = [{ id: 7, title: '校园售卖' }]
  assert.equal(selectGroupingPreferences([preference()], { url: 'https://wap.example/iterations?appId=123&envId=7', title: 'WAP' }, groups)[0].match, 'same-resource')
  assert.deepEqual(selectGroupingPreferences([preference()], { url: 'https://wap.example/publish?appId=456&envId=7', title: 'WAP' }, groups), [])
  assert.deepEqual(selectGroupingPreferences([preference()], { url: 'https://wap.example/publish?appId=123&envId=8', title: 'WAP' }, groups), [])
})

test('related task titles supply soft examples across sites but generic platform labels do not', () => {
  const saved = preference({ url: 'https://docs.example/abc', title: 'React hooks 文档', groupTitle: '前端开发' })
  assert.equal(selectGroupingPreferences([saved], { url: 'https://github.com/react/hooks', title: 'React hooks examples' }, [])[0].match, 'similar-topic')
  const generic = preference({ url: 'https://docs.example/abc', title: '文档 · 钉钉文档', groupTitle: '我的任务' })
  assert.deepEqual(selectGroupingPreferences([generic], { url: 'https://docs.example/xyz', title: '文档 · 钉钉文档' }, []), [])
})

test('an application habit requires consistent choices on distinct pages and is withdrawn when examples conflict', () => {
  const target = { url: 'https://wap.example/review?appId=123&envId=7', title: 'WAP' }
  const first = preference()
  const second = preference({ id: 'pref-iterations', url: 'https://wap.example/iterations?appId=123&envId=7' })
  assert.equal(selectGroupingPreferences([first], target, [])[0].resourceHabit, false)
  assert.equal(selectGroupingPreferences([first, first], target, [])[0].resourceHabit, false)
  const confirmed = selectGroupingPreferences([first, second], target, [])[0]
  assert.equal(confirmed.resourceHabit, true)
  assert.equal(confirmed.supportingPages, 2)
  const conflict = preference({ id: 'pref-monitoring', url: 'https://wap.example/monitoring?appId=123&envId=7', groupTitle: '应用监控' })
  assert.ok(selectGroupingPreferences([first, second, conflict], target, []).every(item => !item.resourceHabit))
})
