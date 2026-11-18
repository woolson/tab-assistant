import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPageContextCache, enrichGroupPageContexts, readPageContext } from './pageContext.ts'
import { collectPageContent } from '../../common/pageContent.ts'

function page(t: any, options: { texts?: Array<string | { text: string; omitted?: boolean; hidden?: boolean }>; headings?: string[]; title?: string; description?: string; context?: string[]; shadowText?: string } = {}) {
  const globals = ['location', 'document', 'chrome', 'getComputedStyle']
  const originals = Object.fromEntries(globals.map(key => [key, (globalThis as any)[key]]))
  const element = (text: string, omitted = false, hidden = false) => ({ innerText: text, textContent: text, parentElement: null, hidden, closest: () => omitted ? {} : null })
  const nodes = (options.texts || []).map(value => {
    const info = typeof value === 'string' ? { text: value } : value
    return { nodeValue: info.text, parentElement: element(info.text, info.omitted, info.hidden) }
  })
  const shadow = { nodes: [{ nodeValue: options.shadowText, parentElement: element(options.shadowText || '') }], querySelectorAll: () => [] }
  const root = {
    nodes,
    querySelectorAll: (selector: string) => selector.startsWith('h1, h2') ? (options.headings || []).map(value => element(value))
      : selector === '*' && options.shadowText ? [{ ...element(''), shadowRoot: shadow }] : [],
  }
  const doc = {
    readyState: 'complete', body: root,
    querySelector: (selector: string) => {
      if (selector.startsWith('meta')) {
        const value = selector.includes('og:title') ? options.title : options.description
        return value ? { getAttribute: () => value } : null
      }
      return root
    },
    querySelectorAll: () => (options.context || []).map(value => element(value)),
    createTreeWalker: (scope: typeof root) => { let index = 0; return { nextNode: () => scope.nodes[index++] || null } },
  }
  ;(globalThis as any).location = { href: 'https://example.com/review' }
  ;(globalThis as any).document = doc
  ;(globalThis as any).getComputedStyle = (node: any) => ({ display: node.hidden ? 'none' : 'block', visibility: 'visible' })
  ;(globalThis as any).chrome = { scripting: { executeScript: async ({ func, args }: any) => [{ result: await func(...args) }] } }
  t.after(() => { for (const key of globals) (globalThis as any)[key] = originals[key] })
  return doc
}

test('page extraction bounds prose and excludes navigation, forms and comments', async t => {
  page(t, { description: '  显示器评测  ', headings: ['  挑选  显示器 '], texts: [
    { text: 'Private form text', omitted: true },
    ...Array.from({ length: 20 }, (_, index) => `${index} ${'测'.repeat(600)}`),
  ] })
  const result = await readPageContext(1, 'https://example.com/review', new AbortController().signal)
  assert.equal(result.description, '显示器评测')
  assert.deepEqual(result.headings, ['挑选 显示器'])
  assert.equal(result.excerpt.replace(/\n/g, '').length, 1200)
  assert.equal(result.excerpt.includes('Private'), false)
})

test('component workbenches expose app names, version, table cells and selected context without paragraph tags', t => {
  page(t, { texts: [
    { text: '无关的全站导航', omitted: true }, 'campus-console', '2.3.0', '代码构建', '产物部署',
    '暂无数据', '暂无描述', { text: '隐藏的其他应用', hidden: true }, { text: '未提交的输入内容', omitted: true },
  ], context: ['预发'], headings: ['待发布的迭代'] })
  const content = collectPageContent()
  assert.match(content.excerpt, /campus-console/)
  assert.match(content.excerpt, /代码构建\n产物部署/)
  assert.deepEqual(content.context, ['预发'])
  assert.equal(/导航|暂无|隐藏|输入/.test(content.excerpt), false)
})

test('metadata and open shadow-root text are available as bounded task context', t => {
  page(t, { title: '发布 campus-console', description: '应用部署', shadowText: 'campus-console 的预发集成任务' })
  const content = collectPageContent()
  assert.equal(content.title, '发布 campus-console')
  assert.match(content.excerpt, /预发集成任务/)
  assert.equal(collectPageContent('https://example.com/other'), undefined)
})

test('an empty summary or metadata-only shell is retried until useful dynamic content arrives', async t => {
  page(t)
  let calls = 0
  ;(globalThis as any).chrome.scripting.executeScript = async () => [{ result: ++calls === 1
    ? { description: '', headings: [], excerpt: '' }
    : calls === 2 ? { description: 'WAP', headings: [], excerpt: '' }
      : { description: 'WAP', headings: [], excerpt: '应用 campus-console，当前环境预发' } }]
  const content = await readPageContext(1, 'https://example.com/review', new AbortController().signal)
  assert.equal(calls, 3)
  assert.match(content.excerpt, /campus-console/)
})

test('ambiguous group pages receive at most three short summaries and never reread the target', async t => {
  page(t)
  const calls: number[] = []
  ;(globalThis as any).chrome.scripting.executeScript = async ({ target }: any) => {
    calls.push(target.tabId)
    return [{ result: { title: 'campus-console', description: '描述'.repeat(200), headings: ['部署流程'], excerpt: '发布'.repeat(600), context: ['预发'] } }]
  }
  const groups = Array.from({ length: 4 }, (_, index) => ({ id: index, title: 'WAP', tabs: [
    { id: index + 1, url: `https://wap.example/app/${index}`, title: 'WAP', content: undefined as any },
  ] }))
  await enrichGroupPageContexts(groups, { id: 1, url: 'https://wap.example/app/0', title: 'WAP' }, new AbortController().signal)
  assert.equal(calls.length, 3)
  assert.equal(calls.includes(1), false)
  assert.equal(groups[1].tabs[0].content.excerpt.length, 400)
  assert.equal(groups[1].tabs[0].content.description.length, 150)
})

test('missing permission and cancelled extraction omit page context', async () => {
  ;(globalThis as any).chrome = { scripting: { executeScript: async () => { throw new Error('Cannot access contents') } } }
  assert.equal(await readPageContext(1, 'https://example.com', new AbortController().signal), undefined)
  const controller = new AbortController()
  controller.abort()
  assert.equal(await readPageContext(1, 'https://example.com', controller.signal), undefined)
})

test('the 1200ms extraction deadline also bounds a renderer that never completes executeScript', async t => {
  page(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  ;(globalThis as any).chrome.scripting.executeScript = () => new Promise(() => {})
  const result = readPageContext(1, 'https://example.com/review', new AbortController().signal)
  t.mock.timers.tick(1200)
  assert.equal(await result, undefined)
})

test('an aborted extraction stops waiting for a suspended renderer immediately', async t => {
  page(t)
  ;(globalThis as any).chrome.scripting.executeScript = () => new Promise(() => {})
  const controller = new AbortController()
  const result = readPageContext(1, 'https://example.com/review', controller.signal)
  controller.abort()
  assert.equal(await result, undefined)
})

test('full-run content cache reuses summaries and refreshes after mutations, navigation and disposal', async t => {
  page(t)
  let calls = 0
  const summary = { description: '', headings: ['抽数任务'], excerpt: 'campus-console' }
  ;(globalThis as any).chrome.scripting.executeScript = async () => { calls++; return [{ result: { ...summary, headings: [...summary.headings] } }] }
  const cache = createPageContextCache()
  const signal = new AbortController().signal
  const first = await cache.read(1, 'https://example.com/review', signal)
  first.headings.push('caller change')
  const second = await cache.read(1, 'https://example.com/review', signal)
  assert.deepEqual(second.headings, ['抽数任务'])
  assert.equal(calls, 1)
  cache.invalidate(1)
  await cache.read(1, 'https://example.com/review', signal)
  assert.equal(calls, 2)
  await cache.read(1, 'https://example.com/other', signal)
  assert.equal(calls, 3)
  cache.clear()
  await cache.read(1, 'https://example.com/other', signal)
  assert.equal(calls, 4)
})

test('invalidating an in-flight summary prevents stale content from repopulating the cache', async t => {
  page(t)
  let resolveOld!: (value: any) => void
  let calls = 0
  ;(globalThis as any).chrome.scripting.executeScript = () => {
    calls++
    if (calls === 1) return new Promise(resolve => { resolveOld = resolve })
    return Promise.resolve([{ result: { description: '', headings: [], excerpt: 'new task' } }])
  }
  const cache = createPageContextCache()
  const signal = new AbortController().signal
  const old = cache.read(1, 'https://example.com/review', signal)
  cache.invalidate(1)
  assert.equal((await cache.read(1, 'https://example.com/review', signal)).excerpt, 'new task')
  resolveOld([{ result: { description: '', headings: [], excerpt: 'old task' } }])
  assert.equal(await old, undefined)
  assert.equal((await cache.read(1, 'https://example.com/review', signal)).excerpt, 'new task')
  assert.equal(calls, 2)
})


test('the ES5-built collector can run as a serialized injected function without module helpers', t => {
  const compiled = ts.transpileModule(readFileSync('src/common/pageContent.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 },
  }).outputText
  const module = createContext({ exports: {} as any })
  runInContext(compiled, module)
  const watermark = '\u200b\u202c\ufeff\u200d\u200c\u2063\u2062'.repeat(10)
  const doc = page(t, { title: watermark + '发布 campus-console', description: '旅行计划', texts: [watermark + '应用预发任务'] })
  const isolated = createContext({ document: doc, location: { href: 'https://example.com/page' } })
  const result = runInContext(`(${module.exports.collectPageContent.toString()})('https://example.com/page')`, isolated)
  assert.equal(result.description, '旅行计划')
  assert.equal(result.title, '发布 campus-console')
  assert.equal(result.excerpt, '应用预发任务')
})
