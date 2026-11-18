import assert from 'node:assert/strict'
import test from 'node:test'
import { readSearchIntent } from './searchIntent.ts'

test('Baidu query survives tracking parameters beyond the model URL limit', () => {
  const url = `https://www.baidu.com/s?tn=${'x'.repeat(300)}&wd=${encodeURIComponent('S16 总决赛')}`
  assert.equal(url.slice(0, 180).includes('wd='), false)
  assert.deepEqual(readSearchIntent(url), { query: 'S16 总决赛', taskTitle: '了解 S16 总决赛' })
  assert.deepEqual(readSearchIntent('https://m.baidu.com/s?word=S16+%E6%80%BB%E5%86%B3%E8%B5%9B'), { query: 'S16 总决赛', taskTitle: '了解 S16 总决赛' })
})

test('a search title can supply the topic when the keyword is absent from the URL', () => {
  assert.equal(readSearchIntent('https://www.baidu.com/s?tn=fixture', 'S16 总决赛_百度搜索')?.query, 'S16 总决赛')
  assert.equal(readSearchIntent('https://www.google.com/search', 'Rust ownership - Google Search')?.query, 'Rust ownership')
  assert.equal(readSearchIntent('https://cn.bing.com/search', '选购显示器 - 搜索')?.taskTitle, '了解 选购显示器')
  assert.equal(readSearchIntent('https://duckduckgo.com/', 'Rust at DuckDuckGo')?.query, 'Rust')
})

test('common search engines decode their keyword without guessing a task from arbitrary query parameters', () => {
  for (const url of [
    'https://www.google.com.hk/search?q=Rust+ownership',
    'https://cn.bing.com/search?q=Rust+ownership',
    'https://duckduckgo.com/?q=Rust+ownership',
    'https://search.yahoo.com/search?p=Rust+ownership',
    'https://www.sogou.com/web?query=Rust+ownership',
    'https://www.so.com/s?q=Rust+ownership',
    'https://search.brave.com/search?q=Rust+ownership',
  ]) assert.equal(readSearchIntent(url)?.query, 'Rust ownership')
  assert.equal(readSearchIntent('https://example.com/search?q=S16', 'S16_百度搜索'), undefined)
  assert.equal(readSearchIntent('https://baidu.com.example.com/s?wd=S16'), undefined)
  assert.equal(readSearchIntent('https://www.baidu.com/link?wd=S16'), undefined)
  assert.equal(readSearchIntent('https://www.google.com/'), undefined)
})

test('empty, broken, generic and address-only searches do not invent a task', () => {
  for (const value of ['', '   ', '---', '。。。', '🏆', '搜索', 'Search', 'https://example.com', 'example.com', '\ufffd']) {
    assert.equal(readSearchIntent(`https://www.baidu.com/s?wd=${encodeURIComponent(value)}`), undefined)
  }
  assert.equal(readSearchIntent('https://www.baidu.com/s', '百度搜索'), undefined)
})

test('query tasks keep the topic as data and use bounded titles without engine names', () => {
  const intent = readSearchIntent(`https://www.baidu.com/s?wd=${encodeURIComponent('学习 Rust 所有权和借用规则以及异步编程的详细教程'.repeat(15))}`)!
  assert.equal(Array.from(intent.query).length, 200)
  assert.ok(Array.from(intent.taskTitle).length <= 24)
  assert.equal(intent.taskTitle.includes('baidu'), false)
  assert.equal(readSearchIntent('https://www.baidu.com/s?wd=S16%20%E2%80%AE%E6%80%BB%E5%86%B3%E8%B5%9B')?.query, 'S16 总决赛')
})
