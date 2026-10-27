import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NAVIGATION_LINK_TTL_MS,
  forgetNavigationLink,
  pickOpenerGroupId,
  readNavigationLink,
  registrableSite,
  rememberNavigationLink,
  resetNavigationLinks,
} from './navigationLink.ts'

test('registrableSite only compares ordinary web pages', () => {
  assert.equal(registrableSite('https://github.com/woolson/tab-assistant'), 'github.com')
  assert.equal(registrableSite('https://www.github.com/woolson'), 'github.com')
  assert.equal(registrableSite('https://gist.github.com/abc'), 'github.com')
  assert.equal(registrableSite('https://www.example.co.uk/a'), 'example.co.uk')
  assert.equal(registrableSite('file:///tmp/a.txt'), undefined)
  assert.equal(registrableSite('chrome://settings/'), undefined)
  assert.equal(registrableSite('about:blank'), undefined)
  assert.equal(registrableSite(undefined), undefined)
})

test('a grouped opener keeps same-site navigation in its own group', () => {
  const opener = { url: 'https://github.com/woolson/tab-assistant', groupId: 12 }
  assert.equal(pickOpenerGroupId(opener, 'https://github.com/woolson/tab-assistant/issues'), 12)
  // 子域名与 www 都算同一个主域名
  assert.equal(pickOpenerGroupId({ url: 'https://docs.google.com/a', groupId: 7 }, 'https://drive.google.com/b'), 7)
  assert.equal(pickOpenerGroupId({ url: 'https://www.github.com/a', groupId: 3 }, 'https://gist.github.com/x'), 3)
})

test('cross-site navigation is left to the model', () => {
  const opener = { url: 'https://github.com/woolson/tab-assistant', groupId: 12 }
  assert.equal(pickOpenerGroupId(opener, 'https://news.ycombinator.com/item?id=1'), undefined)
  assert.equal(pickOpenerGroupId({ url: 'https://foo.co.uk/a', groupId: 1 }, 'https://bar.co.uk/b'), undefined)
})

test('an ungrouped or missing opener yields no decision', () => {
  assert.equal(pickOpenerGroupId({ url: 'https://github.com/a', groupId: -1 }, 'https://github.com/b'), undefined)
  assert.equal(pickOpenerGroupId({ url: 'https://github.com/a' }, 'https://github.com/b'), undefined)
  assert.equal(pickOpenerGroupId(undefined, 'https://github.com/b'), undefined)
  assert.equal(pickOpenerGroupId({ url: 'https://github.com/a', groupId: 1 }, undefined), undefined)
  // 大小写与末尾点不影响判断
  assert.equal(pickOpenerGroupId({ url: 'https://GitHub.com./a', groupId: 2 }, 'https://github.com/b'), 2)
})

test('the opener url falls back to pendingUrl and rejects placeholder pages', () => {
  assert.equal(
    pickOpenerGroupId({ url: 'chrome://newtab/', pendingUrl: 'https://example.com/a', groupId: 5 }, 'https://example.com/b'),
    5,
  )
  assert.equal(pickOpenerGroupId({ url: 'chrome://newtab/', groupId: 5 }, 'https://example.com/b'), undefined)
})

test('navigation links survive briefly and then expire', () => {
  resetNavigationLinks()
  const at = 1_000_000
  rememberNavigationLink(42, { sourceTabId: 7, sourceFrameId: 0, url: 'https://github.com/a', at })

  assert.equal(readNavigationLink(42, at + 10)?.sourceTabId, 7)
  // 恰好等于 TTL 仍然有效，超过 1ms 才失效
  assert.equal(readNavigationLink(42, at + NAVIGATION_LINK_TTL_MS)?.sourceTabId, 7)
  assert.equal(readNavigationLink(42, at + NAVIGATION_LINK_TTL_MS + 1), undefined)
  // 过期后已清理，再读仍然为空
  assert.equal(readNavigationLink(42, at + 10), undefined)
})

test('forgetting a tab drops its link', () => {
  resetNavigationLinks()
  rememberNavigationLink(9, { sourceTabId: 1, url: 'https://a.com', at: Date.now() })
  forgetNavigationLink(9)
  assert.equal(readNavigationLink(9), undefined)
})
