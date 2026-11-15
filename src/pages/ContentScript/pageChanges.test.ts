import assert from 'node:assert/strict'
import test from 'node:test'
import { watchPageContentChanges } from './pageChanges.ts'

function page(t: any) {
  const originals = Object.fromEntries(['window', 'document', 'location', 'Element', 'MutationObserver'].map(name => [name, (globalThis as any)[name]]))
  let prose = '显示器价格与色彩'
  let change!: (records: any[]) => void
  let disconnected = false
  const listeners = new Map<string, () => void>()
  class Element {
    parentElement = null
    ignored: boolean
    constructor(ignored = false) { this.ignored = ignored }
    closest() { return this.ignored ? {} : null }
  }
  const paragraph = { get innerText() { return prose }, closest: () => null }
  const root = { querySelectorAll: (selector: string) => selector === 'h1, h2' ? [] : [paragraph] }
  ;(globalThis as any).Element = Element
  ;(globalThis as any).window = { addEventListener: (event: string, callback: () => void) => listeners.set(event, callback), removeEventListener: (event: string) => listeners.delete(event) }
  ;(globalThis as any).document = { title: '商品', body: root, querySelector: (selector: string) => selector.startsWith('meta') ? null : root }
  ;(globalThis as any).location = { href: 'https://example.com/page' }
  ;(globalThis as any).MutationObserver = class {
    constructor(callback: (records: any[]) => void) { change = callback }
    observe() {}
    disconnect() { disconnected = true }
  }
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 })
  const messages: Array<{ url: string; signature: string }> = []
  const stop = watchPageContentChanges((url, signature) => messages.push({ url, signature }))
  t.after(() => { stop(); for (const [name, value] of Object.entries(originals)) (globalThis as any)[name] = value })
  return { messages, stop, listeners, disconnected: () => disconnected, setProse: (value: string) => { prose = value }, mutate: (ignored = false) => change([{ target: new Element(ignored) }]) }
}

test('stable body changes at a constant URL emit only a digest, not page text', t => {
  const p = page(t)
  p.setProse('日本旅行计划')
  p.mutate()
  t.mock.timers.tick(1000)
  assert.equal(p.messages.length, 0)
  t.mock.timers.tick(1000)
  assert.equal(p.messages.length, 1)
  assert.deepEqual(Object.keys(p.messages[0]), ['url', 'signature'])
  assert.match(p.messages[0].signature, /^[0-9a-f]{1,8}$/)
  assert.equal(JSON.stringify(p.messages).includes('日本旅行'), false)
  p.mutate()
  t.mock.timers.tick(5000)
  assert.equal(p.messages.length, 1)
})

test('streaming text settles before a notification and unchanged DOM does not trigger another', t => {
  const p = page(t)
  for (let i = 0; i < 5; i += 1) {
    p.setProse(`旅行计划 ${i}`)
    p.mutate()
    t.mock.timers.tick(1000)
    assert.equal(p.messages.length, 0)
  }
  t.mock.timers.tick(1000)
  assert.equal(p.messages.length, 1)
  p.mutate()
  t.mock.timers.tick(10_000)
  assert.equal(p.messages.length, 1)
})

test('form/navigation changes are ignored and disabling capture cancels pending work', t => {
  const p = page(t)
  p.setProse('Private form text')
  p.mutate(true)
  t.mock.timers.tick(10_000)
  assert.equal(p.messages.length, 0)
  p.mutate()
  p.stop()
  t.mock.timers.tick(10_000)
  assert.equal(p.messages.length, 0)
  assert.equal(p.disconnected(), true)
  assert.equal(p.listeners.size, 0)
})
