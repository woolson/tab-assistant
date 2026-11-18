import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanTaskText, clipTaskText } from './taskText.ts'
import { pageContentSignature } from './pageContent.ts'

const watermark = '\u200b\u202c\ufeff\u200d\u200c\u2063\u2062'.repeat(10)

test('70-character invisible document watermarks do not consume the title budget', () => {
  const title = '家空间高校战役N5TE铺设指引 for淘闪 · 钉钉文档'
  assert.equal(watermark.length, 70)
  assert.equal(clipTaskText(watermark + title, 80), title)
  assert.equal(cleanTaskText(watermark), '')
  assert.equal(clipTaskText(watermark + '中'.repeat(100), 80), '中'.repeat(80))
})

test('cleaning retains meaningful emoji and language joiners', () => {
  for (const title of ['👩‍💻 开发指南', 'می‌خواهم', 'क्‍ष']) assert.equal(cleanTaskText(watermark + title), title)
  assert.equal(cleanTaskText('  销售\n过程\u200b管理\u2063  '), '销售 过程管理')
})

test('invisible title watermark changes do not change the page task signature', () => {
  assert.equal(pageContentSignature('https://docs.example/1', watermark + '抽数操作手册'), pageContentSignature('https://docs.example/1', '抽数操作手册'))
  assert.notEqual(pageContentSignature('https://docs.example/1', '抽数操作手册'), pageContentSignature('https://docs.example/1', '设备提报说明'))
})
