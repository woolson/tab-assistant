import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLICK_GESTURE_TTL_MS,
  buildClickPayload,
  forgetAllClickGestures,
  normalizeClickGesture,
  readClickGesture,
  rememberClickGesture,
  resetClickGestures,
} from './clickGesture.ts'

test('gesture fields are trimmed and clipped before they are stored', () => {
  const gesture = normalizeClickGesture({
    tag: 'a',
    href: 'https://github.com/woolson/tab-assistant/issues',
    text: `  Issues\n\n  ${'长'.repeat(500)}  `,
    section: 'woolson/tab-assistant',
    selection: 'auto close',
  }, 1_000)

  assert.ok(gesture)
  assert.equal(gesture.tag, 'a')
  assert.equal(gesture.at, 1_000)
  assert.equal(Array.from(gesture.text as string).length, 120)
  assert.equal(gesture.text?.startsWith('Issues 长'), true)
  assert.equal(gesture.selection, 'auto close')
})

test('content-script input is treated as untrusted', () => {
  assert.equal(normalizeClickGesture(null), undefined)
  assert.equal(normalizeClickGesture('https://example.com'), undefined)
  assert.equal(normalizeClickGesture(['a']), undefined)
  assert.equal(normalizeClickGesture({}), undefined)
  assert.equal(normalizeClickGesture({ text: '   ' }), undefined)
  assert.equal(normalizeClickGesture({ text: 42 }), undefined)
  // 控制字符被压成空格
  assert.equal(normalizeClickGesture({ text: 'a\u0000b\u001fc' })?.text, 'a b c')
  // 发送方给的时间戳不被采信
  assert.equal(normalizeClickGesture({ text: 'x', at: 1 }, 999)?.at, 999)
})

test('the prompt payload only carries non-empty fields', () => {
  const payload = buildClickPayload({
    tag: 'a',
    href: 'https://github.com/a',
    text: 'Issues',
    section: undefined,
    selection: '',
    at: 0,
  })
  assert.deepEqual(payload, { tag: 'a', href: 'https://github.com/a', text: 'Issues' })
  assert.equal(buildClickPayload(undefined), undefined)
  assert.equal(buildClickPayload({ at: 0 }), undefined)
})

test('gestures expire quickly', () => {
  resetClickGestures()
  const at = 1_000_000
  rememberClickGesture(7, normalizeClickGesture({ text: 'Issues' }, at) as any)

  assert.equal(readClickGesture(7, at + 50)?.text, 'Issues')
  assert.equal(readClickGesture(7, at + CLICK_GESTURE_TTL_MS)?.text, 'Issues')
  assert.equal(readClickGesture(7, at + CLICK_GESTURE_TTL_MS + 1), undefined)
  assert.equal(readClickGesture(undefined), undefined)
})

test('forgetAllClickGestures clears everything', () => {
  resetClickGestures()
  rememberClickGesture(1, normalizeClickGesture({ text: 'a' }) as any)
  rememberClickGesture(2, normalizeClickGesture({ text: 'b' }) as any)
  forgetAllClickGestures()
  assert.equal(readClickGesture(1), undefined)
  assert.equal(readClickGesture(2), undefined)
})
