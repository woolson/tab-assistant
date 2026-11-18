import assert from 'node:assert/strict'
import test from 'node:test'
import { hasGroundedTaskMatch, parseTaskMatch, specificTaskText } from './taskEvidence.ts'

const target = { url: 'https://alidocs.dingtalk.com/i/sales', title: '碰一下销售过程管理 · 钉钉文档' }
const group = { id: 7, title: '了解源起 INIT', tabs: [
  { url: 'https://init.example/', title: '源起 INIT' },
  { url: 'https://alidocs.dingtalk.com/', title: '文档 · 钉钉文档' },
] }
const match = (targetEvidence: string, groupEvidence: string) => ({ basis: 'same-task' as const, targetEvidence, groupEvidence })

test('platform suffixes, generic portals and URLs do not supply task evidence', () => {
  for (const title of ['文档 · 钉钉文档', '首页 | 语雀', 'Google Docs', 'WAP', 'Loading', '搜索', 'https://example.com/doc', 'example.com']) {
    assert.equal(specificTaskText(title), '', title)
  }
  assert.equal(specificTaskText(target.title), '碰一下销售过程管理')
  assert.equal(specificTaskText('Plan a Japan trip - Notion'), 'plan a japan trip')
})

test('matches require bounded quotes and an explicit same-task basis', () => {
  assert.equal(parseTaskMatch({ ...match('销售', '销售'), basis: 'same-platform' }), undefined)
  assert.equal(parseTaskMatch({ ...match('销售', '销售'), targetEvidence: 42 }), undefined)
  assert.equal(parseTaskMatch(match('x'.repeat(161), '销售')), undefined)
  assert.deepEqual(parseTaskMatch(match('  销售\n管理 ', '销售管理')), match('销售 管理', '销售管理'))
})

test('same-platform and opener-only evidence cannot put sales management into the INIT group', () => {
  assert.equal(hasGroundedTaskMatch(undefined, target, group), false)
  assert.equal(hasGroundedTaskMatch(match('钉钉文档', '钉钉文档'), target, group), false)
  assert.equal(hasGroundedTaskMatch(match('碰一下销售过程管理', '文档 · 钉钉文档'), target, group), false)
  assert.equal(hasGroundedTaskMatch(match('源起 INIT', '源起 INIT'), target, group), false)
  assert.equal(hasGroundedTaskMatch(match('碰一下销售过程管理', '不存在的销售任务'), target, group), false)
})

test('specific task evidence can join related documents on the same platform', () => {
  const sales = { id: 9, title: '跟进碰一下销售', tabs: [{ url: 'https://alidocs.dingtalk.com/i/report', title: '碰一下销售周报 · 钉钉文档' }] }
  assert.equal(hasGroundedTaskMatch(match('碰一下销售过程管理', '碰一下销售周报'), target, sales), true)
})

test('invisible document prefixes are removed consistently from task text and quoted evidence', () => {
  const watermark = '\u200b\u202c\ufeff\u200d\u200c\u2063\u2062'.repeat(10)
  const sales = { id: 9, title: '跟进碰一下销售', tabs: [{ url: 'https://docs.example/report', title: watermark + '碰一下销售周报 · 钉钉文档' }] }
  assert.equal(specificTaskText(watermark + 'WAP'), '')
  assert.equal(specificTaskText(watermark + target.title), '碰一下销售过程管理')
  assert.equal(hasGroundedTaskMatch(match('碰一下销售过程管理', '碰一下销售周报'), { ...target, title: watermark + target.title }, sales), true)
  assert.equal(hasGroundedTaskMatch(match('钉钉文档', '钉钉文档'), { ...target, title: watermark + target.title }, sales), false)
})

test('task evidence supports cross-site and cross-language matches without a keyword-overlap rule', () => {
  const monitors = { id: 9, title: '挑选显示器', tabs: [{ url: 'https://shop.example/', title: '显示器价格' }] }
  const page = { url: 'https://reviews.example/', title: 'Best monitors for designers' }
  assert.equal(hasGroundedTaskMatch(match('monitors for designers', '显示器价格'), page, monitors), true)
  assert.equal(hasGroundedTaskMatch(match('4K 显示器评测', '显示器价格'), { ...page, title: 'Reviews', content: { description: '', headings: ['4K 显示器评测'], excerpt: '' } }, monitors), true)
  assert.equal(hasGroundedTaskMatch(match('4K 显示器', '显示器价格'), { ...page, title: 'Search', query: '4K 显示器' }, monitors), true)
})

test('the changed target cannot cite itself as another member of its current group', () => {
  const mixed = { ...group, tabs: [...group.tabs, { url: target.url, title: target.title }] }
  assert.equal(hasGroundedTaskMatch(match('碰一下销售过程管理', '碰一下销售过程管理'), target, mixed), false)
})

test('opaque platform titles can match actual app context on both sides instead of the platform name', () => {
  const page = { url: 'https://wap.example/?appId=1', title: 'WAP', content: { title: 'campus-console', description: '', headings: [], excerpt: '应用 campus-console', context: ['预发'] } }
  const appGroup = { id: 9, title: 'WAP', tabs: [{ url: 'https://wap.example/?appId=2', title: 'WAP', content: { description: '', headings: [], excerpt: '应用 campus-console 的集成发布' } }] }
  assert.equal(hasGroundedTaskMatch(match('campus-console', 'campus-console'), page, appGroup), true)
  assert.equal(hasGroundedTaskMatch(match('WAP', 'WAP'), page, appGroup), false)
  assert.equal(hasGroundedTaskMatch(match('campus-console', 'other-app'), page, appGroup), false)
})

test('an environment, version or numeric identifier alone is not shared task evidence', () => {
  const page = { url: 'https://wap.example/?appId=12364', title: 'WAP', content: { description: '', headings: [], excerpt: 'campus-console 预发 1.88.0 12364' } }
  const apps = { id: 7, title: 'WAP', tabs: [{ url: 'https://wap.example/?envId=12364', title: 'WAP', content: { description: '', headings: [], excerpt: 'warehouse-console 预发 1.88.0 12364' } }] }
  for (const evidence of ['预发', '1.88.0', '12364']) assert.equal(hasGroundedTaskMatch(match(evidence, evidence), page, apps), false)
})
