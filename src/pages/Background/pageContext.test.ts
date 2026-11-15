import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readPageContext } from './pageContext.ts'

test('page extraction bounds prose and excludes navigation, forms and comments', async () => {
  const root = {
    querySelectorAll: (selector: string) => selector === 'h1, h2'
      ? [{ innerText: '  挑选  显示器 ' }]
      : [
        { innerText: 'Private form text', closest: () => ({}) },
        ...Array.from({ length: 20 }, () => ({ innerText: '测'.repeat(600), closest: () => null })),
      ],
  }
  ;(globalThis as any).location = { href: 'https://example.com/review' }
  ;(globalThis as any).document = {
    readyState: 'complete',
    querySelector: (selector: string) => selector.startsWith('meta') ? { getAttribute: () => '  显示器评测  ' } : root,
  }
  ;(globalThis as any).chrome = { scripting: { executeScript: async ({ func, args }: any) => [{ result: await func(...args) }] } }
  const result = await readPageContext(1, 'https://example.com/review', new AbortController().signal)
  assert.equal(result.description, '显示器评测')
  assert.deepEqual(result.headings, ['挑选 显示器'])
  assert.equal(result.excerpt.replace(/\n/g, '').length, 1200)
  assert.equal(result.excerpt.includes('Private'), false)
})

test('missing permission and cancelled extraction omit page context', async () => {
  ;(globalThis as any).chrome = { scripting: { executeScript: async () => { throw new Error('Cannot access contents') } } }
  assert.equal(await readPageContext(1, 'https://example.com', new AbortController().signal), undefined)
  const controller = new AbortController()
  controller.abort()
  assert.equal(await readPageContext(1, 'https://example.com', controller.signal), undefined)
})


test('the ES5-built collector can run as a serialized injected function without module helpers', () => {
  const compiled = ts.transpileModule(readFileSync('src/common/pageContent.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
  }).outputText
  const module = createContext({ exports: {} as any })
  runInContext(compiled, module)
  const doc = {
    querySelector: (selector: string) => selector.startsWith('meta') ? { getAttribute: () => '旅行计划' } : { querySelectorAll: () => [] },
  }
  const isolated = createContext({ document: doc, location: { href: 'https://example.com/page' } })
  const result = runInContext(`(${module.exports.collectPageContent.toString()})('https://example.com/page')`, isolated)
  assert.equal(result.description, '旅行计划')
})
