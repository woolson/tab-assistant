import assert from 'node:assert/strict'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { manageQuickSearchOverlay } from './quickSearchOverlay.ts'
import { quickSearchAppearance, quickSearchGlassVariables } from '../../common/quickSearchAppearance.ts'

function page(reducedMotion = false, withGlassRuntime = true) {
  const elements: Element[] = []
  const saved: Record<string, any> = {}
  const writes: any[] = []
  const glassControllers: Array<{ destroyed: boolean; appearance: any }> = []
  const focusMessages: Array<{ data: any; origin: string; ready: boolean; frameFocused: boolean }> = []
  const documentEvents = new Map<string, () => void>()
  const windowEvents = new Map<string, () => void>()
  const timers = new Map<number, { at: number; callback: () => void }>()
  const storageListeners = new Set<(changes: any, area: string) => void>()
  const themeListeners = new Set<() => void>()
  let systemDark = false
  let now = 0, nextTimer = 0
  const advance = (milliseconds: number) => {
    now += milliseconds
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback() }
  }
  class Element {
    children: Element[] = []
    attributes: Record<string, string> = {}
    events = new Map<string, (event: any) => void>()
    properties: Record<string, string> = {}
    style = { setProperty: (name: string, value: string) => { this.properties[name] = value }, width: '', height: '', cursor: '' }
    shadow?: { mode: string; children: Element[]; append: (...nodes: Element[]) => void }
    isConnected = false
    open = false
    focuses = 0
    captured?: number
    src = ''
    textContent = ''
    tag: string
    contentWindow = { postMessage: (data: any, origin: string) => {
      const dialog = elements.find(element => element.tag === 'dialog' && element.open)
      focusMessages.push({ data, origin, ready: dialog?.attributes['data-ready'] === 'true', frameFocused: this.focuses > 0 })
    } }
    constructor(tag: string) { this.tag = tag; elements.push(this) }
    attachShadow({ mode }: { mode: string }) {
      const children: Element[] = []
      this.shadow = { mode, children, append: (...nodes) => { children.push(...nodes) } }
      return this.shadow
    }
    append(...nodes: Element[]) { this.children.push(...nodes); nodes.forEach(node => { node.isConnected = true }) }
    remove() { this.isConnected = false }
    setAttribute(name: string, value: string) { this.attributes[name] = value }
    getAttribute(name: string) { return this.attributes[name] ?? null }
    removeAttribute(name: string) { delete this.attributes[name] }
    addEventListener(name: string, callback: (event: any) => void) { this.events.set(name, callback) }
    removeEventListener(name: string, callback: (event: any) => void) { if (this.events.get(name) === callback) this.events.delete(name) }
    setPointerCapture(id: number) { this.captured = id }
    releasePointerCapture(id: number) { if (this.captured === id) this.captured = undefined }
    showModal() { this.open = true }
    close() { this.open = false }
    focus() { this.focuses++ }
    getBoundingClientRect() {
      const width = parseFloat(this.style.width) || 760, height = parseFloat(this.style.height) || 560
      return { left: (window.innerWidth - width) / 2, top: (window.innerHeight - height) / 2,
        right: (window.innerWidth + width) / 2, bottom: (window.innerHeight + height) / 2, width, height }
    }
  }
  const focused = new Element('input')
  focused.isConnected = true
  const root = new Element('html')
  const document = {
    documentElement: root, activeElement: focused, hidden: false,
    createElement: (tag: string) => new Element(tag),
    addEventListener: (name: string, callback: () => void) => documentEvents.set(name, callback),
    removeEventListener: (name: string) => documentEvents.delete(name),
  }
  const window = {
    innerWidth: 960, innerHeight: 760,
    matchMedia: (query: string) => query === '(prefers-color-scheme: dark)' ? {
      get matches() { return systemDark },
      addEventListener: (_name: string, callback: () => void) => themeListeners.add(callback),
      removeEventListener: (_name: string, callback: () => void) => themeListeners.delete(callback),
    } : { matches: reducedMotion },
    addEventListener: (name: string, callback: () => void) => windowEvents.set(name, callback),
    removeEventListener: (name: string) => windowEvents.delete(name),
  }
  const chrome = { storage: {
    local: { set: async (value: any) => { writes.push(value); Object.assign(saved, value) } },
    onChanged: { addListener: (callback: (changes: any, area: string) => void) => storageListeners.add(callback), removeListener: (callback: (changes: any, area: string) => void) => storageListeners.delete(callback) },
  } }
  const context = createContext({ document, window, URL, chrome,
    __taCreateSearchGlass: withGlassRuntime ? (_container: any, appearance: any) => {
      const state = { destroyed: false, appearance };
      glassControllers.push(state);
      return { update: (next: any) => { state.appearance = next }, destroy: () => { state.destroyed = true } };
    } : undefined,
    setTimeout: (callback: () => void, delay: number) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id },
    clearTimeout: (id: number) => { timers.delete(id) },
  })
  // Match the ES5 build, then serialize only the function into a fresh world without compiler helpers.
  const compiled = ts.transpileModule(`const injected = ${manageQuickSearchOverlay.toString()}`, { compilerOptions: { target: ts.ScriptTarget.ES5 } }).outputText
  const serialized = runInContext(`${compiled}\ninjected.toString()`, createContext({})) as string
  const manage = runInContext(`(${serialized})`, context) as typeof manageQuickSearchOverlay
  const url = 'chrome-extension://fixture/quick-search.html?mode=overlay&session=private'
  return { manage, url, elements, root, focused, document, window, documentEvents, windowEvents, focusMessages, saved, writes, timers, advance, storageListeners, themeListeners, glassControllers,
    changeSettings: (setting: any, area = 'sync') => storageListeners.forEach(callback => callback({ TA_SETTING: { newValue: setting } }, area)),
    setSystemDark: (value: boolean) => { systemDark = value; themeListeners.forEach(callback => callback()) },
  }
}

test('a missing optical runtime falls back without mounting an unusable dialog', () => {
  const p = page(false, false)
  assert.equal(p.manage('toggle', p.url).state, 'unavailable')
  assert.equal(p.root.children.length, 0)
  assert.equal(p.documentEvents.size + p.windowEvents.size, 0)
})

test('the serialized overlay mounts an extension iframe in a closed shadow root and uses the dialog top layer', () => {
  const p = page()
  assert.equal(p.manage('toggle', p.url).state, 'open')
  const host = p.root.children[0]
  assert.equal(host.shadow?.mode, 'closed')
  const dialog = p.elements.find(element => element.tag === 'dialog')!
  assert.equal(dialog.open, true)
  assert.equal(dialog.children[0].src, p.url)
  assert.equal(dialog.attributes['data-ready'], undefined)
  assert.equal(dialog.children[0].focuses, 0)
  assert.equal(p.focusMessages.length, 0)
  assert.match(p.elements.find(element => element.tag === 'style')!.textContent, /dialog::backdrop/)
  assert.equal(p.manage('reveal', p.url).state, 'open')
  assert.equal(dialog.attributes['data-ready'], 'true')
  assert.equal(dialog.children[0].focuses, 1)
  assert.deepEqual(p.focusMessages.map(message => ({ ...message, data: { ...message.data } })), [{
    data: { type: 'ta:quick-search-focus', session: 'private' }, origin: 'chrome-extension://fixture', ready: true, frameFocused: true,
  }])
  assert.equal(p.manage('close', p.url).state, 'closed')
  assert.equal(host.isConnected, true)
  assert.equal(dialog.open, true)
  assert.equal(dialog.attributes['data-closing'], 'true')
  assert.equal(dialog.children[0].attributes.inert, '')
  assert.equal(p.focused.focuses, 0)
  p.advance(179)
  assert.equal(host.isConnected, true)
  p.advance(1)
  assert.equal(host.isConnected, false)
  assert.equal(p.focused.focuses, 1)
  assert.equal(p.documentEvents.size + p.windowEvents.size, 0)
  assert.equal(p.glassControllers[0].destroyed, true)
})

test('the serialized glass layer matches normalized settings, follows theme changes and releases its subscriptions', () => {
  const p = page()
  const appearance = quickSearchAppearance({ quickSearchMaterial: 'frosted', quickSearchTransparency: 62, quickSearchBlur: 32 })
  p.manage('toggle', p.url, undefined, appearance)
  const dialog = p.elements.find(element => element.tag === 'dialog')!
  assert.equal(dialog.attributes['data-material'], 'frosted')
  assert.equal(dialog.attributes['data-theme'], 'light')
  assert.deepEqual(dialog.properties, quickSearchGlassVariables(appearance))
  p.setSystemDark(true)
  assert.equal(dialog.attributes['data-theme'], 'dark')
  assert.deepEqual(dialog.properties, quickSearchGlassVariables({ ...appearance, theme: 'dark' }))
  p.changeSettings({ quickSearchMaterial: 'liquid', quickSearchTransparency: 30, quickSearchBlur: 20, theme: 'light' })
  assert.equal(dialog.attributes['data-material'], 'frosted')
  assert.equal(dialog.attributes['data-theme'], 'light')
  assert.deepEqual(dialog.properties, quickSearchGlassVariables(quickSearchAppearance({ quickSearchMaterial: 'liquid', quickSearchTransparency: 30, quickSearchBlur: 20 })))
  p.changeSettings({ quickSearchMaterial: 'classic' }, 'local')
  assert.equal(dialog.attributes['data-material'], 'frosted')
  p.changeSettings({ quickSearchMaterial: 'classic', theme: 'dark' })
  assert.equal(dialog.attributes['data-material'], 'classic')
  assert.equal(dialog.properties['--qs-glass-opacity'], '1.00')
  p.changeSettings({ quickSearchMaterial: 'unsupported', quickSearchTransparency: Infinity, quickSearchBlur: 'invalid' })
  assert.equal(dialog.attributes['data-theme'], 'dark')
  assert.deepEqual(dialog.properties, quickSearchGlassVariables({ ...quickSearchAppearance(), theme: 'dark' }))
  p.manage('reveal', p.url, null, quickSearchAppearance({ quickSearchMaterial: 'classic', theme: 'light' }))
  assert.equal(dialog.attributes['data-material'], 'classic')
  assert.equal(dialog.attributes['data-theme'], 'light')
  assert.equal(dialog.attributes['data-ready'], 'true')
  p.manage('close', p.url)
  p.advance(180)
  assert.equal(p.storageListeners.size, 0)
  assert.equal(p.themeListeners.size, 0)
})

function resize(p: ReturnType<typeof page>, direction: string, dx: number, dy: number, finish = 'pointerup') {
  const handle = p.elements.filter(element => element.attributes['data-resize'] === direction).at(-1)!
  const event = (x: number, y: number, id = 1) => ({ pointerId: id, button: 0, isPrimary: true, clientX: x, clientY: y, preventDefault() {} })
  handle.events.get('pointerdown')!(event(300, 300))
  handle.events.get('pointermove')!(event(300 + dx, 300 + dy))
  if (finish) handle.events.get(finish)!(event(300 + dx, 300 + dy))
  return handle
}

test('edge and corner drags keep the horizontal center fixed and persist the final size once per drag', () => {
  const p = page()
  p.manage('toggle', p.url)
  p.manage('reveal', p.url)
  const dialog = p.elements.find(element => element.tag === 'dialog')!
  const handle = resize(p, 'e', 60, 0, '')
  let bounds = dialog.getBoundingClientRect()
  assert.equal(bounds.width, 880)
  assert.equal((bounds.left + bounds.right) / 2, p.window.innerWidth / 2)
  assert.equal(p.writes.length, 0)
  assert.equal(dialog.attributes['data-resizing'], 'true')
  assert.equal(handle.captured, 1)
  handle.events.get('pointerup')!({ pointerId: 1 })
  assert.equal(p.saved.TA_QUICK_SEARCH_SIZE.width, 880)
  assert.equal(p.writes.length, 1)
  assert.equal(handle.captured, undefined)
  assert.equal(dialog.attributes['data-resizing'], undefined)
  resize(p, 'sw', 100, 30)
  bounds = dialog.getBoundingClientRect()
  assert.equal(bounds.width, 680)
  assert.equal(bounds.height, 620)
  assert.equal((bounds.left + bounds.right) / 2, p.window.innerWidth / 2)
  assert.deepEqual({ ...p.saved.TA_QUICK_SEARCH_SIZE }, { width: 680, height: 620 })
  assert.equal(p.writes.length, 2)
})

test('saved dimensions survive closing/reopening and viewport clamping does not overwrite the preference', () => {
  const p = page()
  p.manage('toggle', p.url, { width: 860, height: 630 })
  p.manage('reveal', p.url)
  resize(p, 'se', -50, -40)
  assert.deepEqual({ ...p.saved.TA_QUICK_SEARCH_SIZE }, { width: 760, height: 550 })
  p.manage('close', p.url)
  p.manage('toggle', p.url, p.saved.TA_QUICK_SEARCH_SIZE)
  const dialog = p.elements.filter(element => element.tag === 'dialog').at(-1)!
  assert.equal(dialog.getBoundingClientRect().width, 760)
  assert.equal(dialog.getBoundingClientRect().height, 550)
  p.window.innerWidth = 600
  p.window.innerHeight = 400
  p.windowEvents.get('resize')!()
  let bounds = dialog.getBoundingClientRect()
  assert.equal(bounds.width, 560)
  assert.equal(bounds.height, 336)
  assert.equal((bounds.left + bounds.right) / 2, 300)
  assert.equal(p.writes.length, 1)
  p.window.innerWidth = 1200
  p.window.innerHeight = 900
  p.windowEvents.get('resize')!()
  bounds = dialog.getBoundingClientRect()
  assert.equal(bounds.width, 760)
  assert.equal(bounds.height, 550)
  assert.equal(p.writes.length, 1)
})

test('resizing obeys minimum and maximum dimensions and pointer cancellation restores the previous size', () => {
  const p = page()
  p.manage('toggle', p.url)
  p.manage('reveal', p.url)
  const dialog = p.elements.find(element => element.tag === 'dialog')!
  resize(p, 'nw', 5000, 5000)
  assert.deepEqual({ ...p.saved.TA_QUICK_SEARCH_SIZE }, { width: 360, height: 280 })
  resize(p, 'se', 5000, 5000)
  assert.deepEqual({ ...p.saved.TA_QUICK_SEARCH_SIZE }, { width: 920, height: 696 })
  resize(p, 'se', -50, -50, 'pointercancel')
  assert.equal(dialog.getBoundingClientRect().width, 920)
  assert.equal(dialog.getBoundingClientRect().height, 696)
  assert.equal(p.writes.length, 2)
  assert.equal(dialog.attributes['data-resizing'], undefined)
})

test('closing during a drag releases pointer capture, removes listeners and does not persist a partial size', () => {
  const p = page()
  p.manage('toggle', p.url)
  p.manage('reveal', p.url)
  const handle = resize(p, 'se', 30, 20, '')
  assert.equal(handle.captured, 1)
  p.manage('close', p.url)
  assert.equal(handle.captured, undefined)
  assert.equal(p.writes.length, 0)
  p.advance(180)
  assert.equal(p.documentEvents.size + p.windowEvents.size, 0)
  handle.events.get('pointermove')!({ pointerId: 1, clientX: 900, clientY: 900 })
  assert.equal(p.writes.length, 0)
})

test('a late ready notification cannot reveal a different session or recreate a dismissed overlay', () => {
  const p = page()
  p.manage('toggle', p.url)
  const dialog = p.elements.find(element => element.tag === 'dialog')!
  assert.equal(p.manage('reveal', 'old-session').state, 'unavailable')
  assert.equal(dialog.attributes['data-ready'], undefined)
  p.manage('close', p.url)
  assert.equal(p.manage('reveal', p.url).state, 'unavailable')
  assert.equal(p.root.children[0].isConnected, false)
  assert.equal(p.focusMessages.length, 0)
})

test('repeating the shortcut closes the overlay and an old close request cannot remove a new session', () => {
  const p = page()
  p.manage('toggle', p.url)
  assert.equal(p.manage('toggle', 'another-session').state, 'closed')
  assert.equal(p.elements.filter(element => element.tag === 'dialog').length, 1)
  p.manage('toggle', 'new-session')
  p.manage('close', p.url)
  assert.equal(p.root.children.at(-1)!.isConnected, true)
  p.manage('close', 'new-session')
  assert.equal(p.root.children.at(-1)!.isConnected, false)
})

test('backdrop clicks, native cancellation and hidden tabs dismiss the overlay and restore the page focus', () => {
  const p = page()
  p.manage('toggle', p.url)
  let dialog = p.elements.filter(element => element.tag === 'dialog').at(-1)!
  dialog.events.get('click')!({ target: dialog, clientX: 200, clientY: 200 })
  assert.equal(dialog.open, true)
  dialog.events.get('click')!({ target: dialog, clientX: 20, clientY: 20 })
  assert.equal(dialog.open, false)
  p.manage('toggle', p.url)
  dialog = p.elements.filter(element => element.tag === 'dialog').at(-1)!
  let prevented = false
  dialog.events.get('cancel')!({ preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(dialog.open, false)
  p.manage('toggle', p.url)
  p.document.hidden = true
  p.documentEvents.get('visibilitychange')!()
  assert.equal(p.root.children.at(-1)!.isConnected, false)
  assert.equal(p.focused.focuses, 2)
})

test('opacity completion removes the overlay and cancels the fallback timer without duplicate focus restoration', () => {
  const p = page()
  p.manage('toggle', p.url)
  p.manage('reveal', p.url)
  p.manage('close', p.url)
  const host = p.root.children[0]
  const dialog = p.elements.find(element => element.tag === 'dialog')!
  const ended = dialog.events.get('transitionend')!
  ended({ target: dialog.children[1], propertyName: 'opacity' })
  ended({ target: dialog, propertyName: 'transform' })
  assert.equal(host.isConnected, true)
  ended({ target: dialog.children[0], propertyName: 'opacity' })
  assert.equal(host.isConnected, false)
  assert.equal(dialog.open, false)
  assert.equal(p.timers.size, 0)
  assert.equal(p.focused.focuses, 1)
  p.advance(1000)
  ended({ target: dialog, propertyName: 'opacity' })
  assert.equal(p.focused.focuses, 1)
})

test('rapid reopening replaces the exiting overlay and stale completion cannot close or refocus the new one', () => {
  const p = page()
  p.manage('toggle', p.url)
  p.manage('reveal', p.url)
  const oldHost = p.root.children[0]
  const oldDialog = p.elements.find(element => element.tag === 'dialog')!
  const staleEnd = oldDialog.events.get('transitionend')!
  p.manage('close', p.url)
  assert.equal(p.manage('reveal', p.url).state, 'unavailable')
  assert.equal(p.manage('toggle', 'chrome-extension://fixture/quick-search.html?session=new').state, 'open')
  const newHost = p.root.children.at(-1)!
  assert.equal(oldHost.isConnected, false)
  assert.equal(newHost.isConnected, true)
  assert.equal(p.timers.size, 0)
  const focuses = p.focused.focuses
  staleEnd({ target: oldDialog, propertyName: 'opacity' })
  p.advance(1000)
  p.manage('close', p.url)
  assert.equal(newHost.isConnected, true)
  assert.equal(p.focused.focuses, focuses)
})

test('repeated close requests do not extend the exit animation', () => {
  const p = page()
  p.manage('toggle', p.url)
  p.manage('reveal', p.url)
  p.manage('close', p.url)
  p.advance(100)
  p.manage('close', p.url)
  p.advance(80)
  assert.equal(p.root.children[0].isConnected, false)
  assert.equal(p.timers.size, 0)
  assert.equal(p.focused.focuses, 1)
})

test('reduced motion, hidden pages and navigation skip exit animation and leave no pending cleanup', () => {
  const reduced = page(true)
  reduced.manage('toggle', reduced.url)
  reduced.manage('reveal', reduced.url)
  reduced.manage('close', reduced.url)
  assert.equal(reduced.root.children[0].isConnected, false)
  assert.equal(reduced.timers.size, 0)
  const p = page()
  p.manage('toggle', p.url)
  p.manage('reveal', p.url)
  p.manage('close', p.url)
  p.document.hidden = true
  p.documentEvents.get('visibilitychange')!()
  assert.equal(p.root.children[0].isConnected, false)
  assert.equal(p.timers.size, 0)
  assert.equal(p.focused.focuses, 0)
  p.document.hidden = false
  p.manage('toggle', p.url)
  p.manage('reveal', p.url)
  p.manage('close', p.url)
  p.windowEvents.get('pagehide')!()
  assert.equal(p.root.children.at(-1)!.isConnected, false)
  assert.equal(p.timers.size, 0)
})
