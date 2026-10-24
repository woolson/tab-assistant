import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGroupSnapshots,
  compactGroupsForPrompt,
  isPlaceholderTabUrl,
  normalizeGroupTitle,
  parseAiGroupDecision,
  pickFallbackGroupId,
  queryLanguageModelAvailability,
  readRealUrl,
  registrableDomain,
} from './aiAutoGroupDecision.ts'

test('registrable domain keeps the site, not only the public suffix', () => {
  assert.equal(registrableDomain('github.com'), 'github.com')
  assert.equal(registrableDomain('www.github.com'), 'github.com')
  assert.equal(registrableDomain('mail.google.com'), 'google.com')
  assert.equal(registrableDomain('www.example.co.uk'), 'example.co.uk')
  assert.equal(registrableDomain('a.b.example.co.jp'), 'example.co.jp')
  assert.equal(registrableDomain('localhost'), 'localhost')
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1')
})

test('placeholder urls are only new-tab and blank pages', () => {
  assert.equal(isPlaceholderTabUrl(undefined), true)
  assert.equal(isPlaceholderTabUrl(''), true)
  assert.equal(isPlaceholderTabUrl('about:blank'), true)
  assert.equal(isPlaceholderTabUrl('chrome://newtab/'), true)
  assert.equal(isPlaceholderTabUrl('chrome://new-tab-page/'), true)
  assert.equal(isPlaceholderTabUrl('edge://newtab/'), true)
  assert.equal(isPlaceholderTabUrl('chrome://settings/'), false)
  assert.equal(isPlaceholderTabUrl('https://example.com/docs'), false)
  assert.equal(isPlaceholderTabUrl('file:///tmp/a.txt'), false)
})

test('readRealUrl prefers a concrete pending navigation over the new tab page', () => {
  assert.equal(readRealUrl({ url: 'chrome://newtab/', pendingUrl: 'https://example.com/a' }), 'https://example.com/a')
  assert.equal(readRealUrl({ url: 'https://example.com/a', pendingUrl: 'chrome://newtab/' }), 'https://example.com/a')
  assert.equal(readRealUrl({ url: 'about:blank' }), undefined)
})

test('parse accepts the three actions and rejects garbage', () => {
  const ids = new Set([4, 9])
  assert.deepEqual(parseAiGroupDecision('{"action":"leave","groupId":4}', ids), { action: 'leave' })
  assert.deepEqual(parseAiGroupDecision('{"action":"JOIN","groupId":"9"}', ids), { action: 'join', groupId: 9 })
  assert.equal(parseAiGroupDecision('{"action":"join","groupId":3}', ids), undefined)
  assert.deepEqual(
    parseAiGroupDecision('```json\n{"action":"create","title":"  Design   docs  "}\n```', ids),
    { action: 'create', title: 'Design docs' },
  )
  assert.equal(parseAiGroupDecision('{"action":"create","title":"   "}', ids), undefined)
  assert.equal(parseAiGroupDecision('Sure, leave it.', ids), undefined)
  assert.deepEqual(parseAiGroupDecision('note {"action":"leave"} thanks', ids), { action: 'leave' })
})

test('group titles stay short', () => {
  assert.equal(normalizeGroupTitle('设计'), '设计')
  assert.equal(normalizeGroupTitle('中'.repeat(30))?.length, 24)
  assert.equal(normalizeGroupTitle('---'), undefined)
  assert.equal(normalizeGroupTitle(12), undefined)
})

test('fallback joins the closest existing registrable domain and otherwise does nothing', () => {
  const groups = [
    {
      id: 2,
      title: 'Mail',
      tabs: [{ url: 'https://mail.google.com/mail', title: 'Inbox' }],
    },
    {
      id: 7,
      title: 'github.com',
      tabs: [{ url: 'https://docs.github.com/en', title: 'Docs' }],
    },
    {
      id: 3,
      title: 'Example',
      tabs: [{ url: 'https://example.com/', title: 'Example' }],
    },
  ]

  assert.equal(pickFallbackGroupId(groups, 'https://www.github.com/pulls'), 7)
  assert.equal(pickFallbackGroupId(groups, 'https://calendar.google.com/'), 2)
  assert.equal(pickFallbackGroupId(groups, 'https://news.ycombinator.com/'), undefined)
  assert.equal(pickFallbackGroupId(groups, 'file:///tmp/a.txt'), undefined)
  assert.equal(pickFallbackGroupId([
    { id: 8, title: 'github.com', tabs: [] },
    { id: 4, title: 'Other', tabs: [{ url: 'https://github.com/repo', title: 'Repo' }] },
  ], 'https://github.com/new'), 4)
})

test('snapshots omit the new tab and ungrouped tabs, and the prompt keeps the closest groups', () => {
  const snapshots = buildGroupSnapshots(
    [{ id: 1, title: 'News' }, { id: 2, title: '' }],
    [
      { id: 10, groupId: -1, url: 'https://example.com/new', title: 'New', index: 0 },
      { id: 11, groupId: 1, url: 'https://news.ycombinator.com/', title: 'HN', index: 2 },
      { id: 12, groupId: 2, url: 'chrome://extensions/', title: 'Extensions', index: 1 },
      { id: 13, groupId: 2, url: 'https://github.com/', title: 'GitHub', index: 3 },
    ],
    10,
  )

  assert.deepEqual(snapshots, [
    { id: 1, title: 'News', tabs: [{ url: 'https://news.ycombinator.com/', title: 'HN' }] },
    { id: 2, title: '', tabs: [{ url: 'https://github.com/', title: 'GitHub' }, { url: 'chrome://extensions/', title: 'Extensions' }] },
  ])

  const compact = compactGroupsForPrompt(snapshots, 'https://github.com/features', 1)
  assert.equal(compact.length, 1)
  assert.equal(compact[0].id, 2)
  assert.equal(compact[0].tabs[0].url, 'https://github.com/')
})

test('missing LanguageModel is unsupported and does not throw', async () => {
  const scope = globalThis as { LanguageModel?: unknown }
  const previous = scope.LanguageModel
  delete scope.LanguageModel
  try {
    assert.equal(await queryLanguageModelAvailability(), 'unsupported')
  } finally {
    if (previous) scope.LanguageModel = previous
  }
})
