import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'

const compiled = new Map<string, string>()
const plain = (value: any) => JSON.parse(JSON.stringify(value))
const rule = (extra: object = {}) => ({ ruleId: 'rule-1', name: '项目资料', groupTitle: '项目资料', matchType: 0, matchContent: 'docs.example', priority: 1, sortIndex: 0, ...extra })

/** Load the production module and its existing enum constants without a browser. */
function fixture() {
  const sync: Record<string, any> = { TA_SETTING: { remove3w: false, removeKeywordList: ['www'], aiAutoGroupEnabled: true, decisionLogEnabled: true, rememberClickSource: true, toolbarEntry: 'popup', quickSearchMaterial: 'liquid', quickSearchTransparency: 45, quickSearchBlur: 24 } }
  const writes: any[] = []
  const opened: any[] = []
  let reload: (response: any) => void = () => {}
  const chrome = {
    storage: { sync: {
      get: async (key: string) => ({ [key]: structuredClone(sync[key]) }),
      set: async (value: object) => { writes.push(plain(value)); Object.assign(sync, plain(value)) },
    } },
    runtime: {
      lastError: undefined as any,
      getURL: (path: string) => `chrome-extension://fixture/${path}`,
      sendMessage: (_type: any, callback: any) => { reload = callback; callback('TA_RELOAD_SUCC') },
    },
    tabs: { create: async (options: any) => { opened.push(options) } },
  }
  const elements: any[] = []
  const document = {
    createElement: () => {
      const handlers: Record<string, () => void> = {}
      const input: any = { files: [], removed: false, addEventListener: (name: string, callback: () => void) => { handlers[name] = callback }, click: () => {}, remove: () => { input.removed = true }, emit: (name: string) => handlers[name]?.() }
      elements.push(input)
      return input
    },
    body: { appendChild: () => {} },
  }
  const context = createContext({ chrome, document, URLSearchParams,
    setTimeout: (...args: any[]) => (globalThis.setTimeout as any)(...args), clearTimeout: (timer: any) => globalThis.clearTimeout(timer),
  })
  function load(file: string): any {
    let code = compiled.get(file)
    if (!code) { code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; compiled.set(file, code) }
    const module = { exports: {} }
    const require = (name: string) => { assert.equal(name, './const'); return load('src/common/const.ts') }
    runInContext(`(function(require,module,exports){${code}\n})`, context)(require, module, module.exports)
    return module.exports
  }
  return { api: load('src/common/settingsTransfer.ts'), chrome, sync, writes, opened, elements, respond: (value: any) => reload(value) }
}

test('legacy backup fields merge with current settings instead of disabling AI or logging', async () => {
  const f = fixture()
  const backup = { TAB_ASSISTANT_RULES: [rule()], TA_SETTING: { language: 'zh-CN', theme: 'light', toolbarEntry: 'popup', removeKeywordList: ['www', 'app'] } }
  const applied = await f.api.importSettingsText(JSON.stringify(backup))
  assert.equal(applied.TA_SETTING.aiAutoGroupEnabled, true)
  assert.equal(applied.TA_SETTING.decisionLogEnabled, true)
  assert.equal(applied.TA_SETTING.rememberClickSource, true)
  assert.equal(applied.TA_SETTING.quickSearchMaterial, 'liquid')
  assert.equal(applied.TA_SETTING.quickSearchTransparency, 45)
  assert.equal(applied.TA_SETTING.quickSearchBlur, 24)
  assert.deepEqual(f.sync.TA_SETTING.removeKeywordList, ['www', 'app'])
  assert.equal(f.writes.length, 1)
  assert.equal(f.sync.TAB_ASSISTANT_RULES.length, 1)
})

test('glass appearance survives settings import and invalid material parameters are rejected before writing', async () => {
  const f = fixture()
  await f.api.importSettingsText(JSON.stringify({ TA_SETTING: { quickSearchMaterial: 'frosted', quickSearchTransparency: 55, quickSearchBlur: 32 } }))
  assert.equal(f.sync.TA_SETTING.quickSearchMaterial, 'frosted')
  assert.equal(f.sync.TA_SETTING.quickSearchTransparency, 55)
  assert.equal(f.sync.TA_SETTING.quickSearchBlur, 32)
  const writes = f.writes.length
  for (const setting of [{ quickSearchMaterial: 'unknown' }, { quickSearchTransparency: 10 }, { quickSearchTransparency: 90 }, { quickSearchBlur: 41 }, { quickSearchBlur: '24' }]) {
    await assert.rejects(f.api.importSettingsText(JSON.stringify({ TA_SETTING: setting })))
  }
  assert.equal(f.writes.length, writes)
})

test('rule-only, settings-only and BOM-prefixed backups keep unspecified data', async () => {
  const f = fixture()
  await f.api.importSettingsText('\ufeff' + JSON.stringify({ TAB_ASSISTANT_RULES: [rule()] }))
  assert.equal(f.sync.TA_SETTING.aiAutoGroupEnabled, true)
  await f.api.importSettingsText(JSON.stringify({ TA_SETTING: { aiAutoGroupEnabled: false } }))
  assert.equal(f.sync.TAB_ASSISTANT_RULES.length, 1)
  assert.equal(f.sync.TA_SETTING.aiAutoGroupEnabled, false)
  assert.equal(f.sync.TA_SETTING.decisionLogEnabled, true)
})

test('invalid JSON, shapes, regexes and setting types are rejected before writing anything', async () => {
  const f = fixture()
  for (const source of ['bad JSON', 'null', '[]', '{}', '{"TAB_ASSISTANT_RULES":{}}',
    JSON.stringify({ TAB_ASSISTANT_RULES: [null] }), JSON.stringify({ TAB_ASSISTANT_RULES: [rule({ matchType: 99 })] }),
    JSON.stringify({ TAB_ASSISTANT_RULES: [rule({ matchType: 1, matchContent: '[' })] }),
    JSON.stringify({ TA_SETTING: { removeKeywordList: 'www' } }), JSON.stringify({ TA_SETTING: { aiAutoGroupEnabled: 'false' } }),
    JSON.stringify({ TA_SETTING: { theme: 'unknown' } }), JSON.stringify({ TA_SETTING: { autoCloseMinutes: 0 } }),
  ]) await assert.rejects(f.api.importSettingsText(source))
  assert.equal(f.writes.length, 0)
  assert.equal(f.sync.TA_SETTING.aiAutoGroupEnabled, true)
})

test('imports whitelist supported keys and do not write credentials or arbitrary browser state', async () => {
  const f = fixture()
  await f.api.importSettingsText(JSON.stringify({ TAB_ASSISTANT_RULES: [rule({ apiKey: 'private-rule-key' })], TA_SETTING: { theme: 'dark', apiKey: 'private-setting-key' }, TA_AI_API_CONFIG: { apiKey: 'private-provider-key' } }))
  assert.deepEqual(Object.keys(f.writes[0]).sort(), ['TAB_ASSISTANT_RULES', 'TA_SETTING'])
  assert.equal(JSON.stringify(f.writes).includes('private'), false)
})

test('legacy rule IDs/priorities normalize into a sortable array and preserve valid regex semantics', () => {
  const f = fixture()
  const backup = f.api.parseSettingsBackup(JSON.stringify({ TAB_ASSISTANT_RULES: [rule({ ruleId: undefined, priority: undefined, matchType: 1, matchContent: '^https://docs\\.example/.*$' }), rule({ ruleId: undefined })] }))
  assert.notEqual(backup.TAB_ASSISTANT_RULES[0].ruleId, backup.TAB_ASSISTANT_RULES[1].ruleId)
  assert.equal(backup.TAB_ASSISTANT_RULES[0].priority, 0)
  assert.deepEqual(plain(backup.TAB_ASSISTANT_RULES.map((item: any) => item.sortIndex)), [0, 1])
  assert.ok(new RegExp(backup.TAB_ASSISTANT_RULES[0].matchContent).test('https://docs.example/project'))
})

test('success waits for a positive background acknowledgement, while reload errors report saved-but-not-applied', async () => {
  const f = fixture()
  f.chrome.runtime.sendMessage = (_type: any, callback: any) => { f.respond = callback }
  let complete = false
  const pending = f.api.importSettingsText('{"TA_SETTING":{"theme":"dark"}}').then(() => { complete = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.writes.length, 1)
  assert.equal(complete, false)
  f.respond('TA_RELOAD_SUCC')
  await pending
  const failed = f.api.importSettingsText('{"TA_SETTING":{"theme":"light"}}')
  await new Promise(resolve => setImmediate(resolve))
  f.respond({ ok: false, error: 'reload-failed' })
  await assert.rejects(failed, { code: 'apply' })
  assert.equal(f.sync.TA_SETTING.theme, 'light')
})

test('storage errors and unreadable/oversized files produce safe errors', async () => {
  const f = fixture()
  f.chrome.storage.sync.set = async () => { throw new Error('private storage detail') }
  await assert.rejects(f.api.importSettingsText('{"TA_SETTING":{}}'), { code: 'save' })
  await assert.rejects(f.api.importSettingsFile({ size: 4, text: async () => { throw new Error('private file content') } }), { code: 'read' })
  let read = false
  await assert.rejects(f.api.importSettingsFile({ size: f.api.MAX_SETTINGS_IMPORT_BYTES + 1, text: async () => { read = true; return '{}' } }), { code: 'size' })
  assert.equal(read, false)
})

test('popup import opens one persistent extension page; that page and the side panel use their own picker', async () => {
  const f = fixture()
  assert.equal(await f.api.openSettingsImportPage('popup', ''), true)
  assert.equal(f.opened.length, 1)
  assert.equal(f.opened[0].url, 'chrome-extension://fixture/popup.html?page=about&transfer=import')
  assert.equal(await f.api.openSettingsImportPage('popup', '?page=about&transfer=import'), false)
  assert.equal(await f.api.openSettingsImportPage('sidepanel', ''), false)
  assert.equal(f.opened.length, 1)
})

test('file selection and cancellation clean up their temporary inputs', async () => {
  const f = fixture()
  const selected = f.api.chooseSettingsFile()
  const input = f.elements[0]
  const file = { size: 2, text: async () => '{}' }
  input.files = [file]
  input.emit('change')
  assert.equal(await selected, file)
  assert.equal(input.removed, true)
  const cancelled = f.api.chooseSettingsFile()
  f.elements[1].emit('cancel')
  assert.equal(await cancelled, undefined)
  assert.equal(f.elements[1].removed, true)
})
