/** Optional click and page-change capture; active only with AI + capture enabled. */
import { watchPageContentChanges } from './pageChanges'

const MAX_TEXT = 120
const MAX_HREF = 300
const MAX_SECTION = 80
const MAX_SELECTION = 200

const INTERACTIVE_SELECTOR = 'a[href], [role="link"], button, [role="button"]'
const SECTION_SELECTOR = 'main, article, section, aside, nav, [role="main"], [role="navigation"]'
const HEADING_SELECTOR = 'h1, h2, h3, [role="heading"]'

function clip(value: string | null | undefined, max: number): string | undefined {
  if (!value) return undefined
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (!collapsed) return undefined
  const chars = Array.from(collapsed)
  return chars.length <= max ? collapsed : chars.slice(0, max).join('')
}

function findInteractive(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null
  return target.closest(INTERACTIVE_SELECTOR)
}

function readSection(element: Element): string | undefined {
  const container = element.closest(SECTION_SELECTOR)
  if (!container) return undefined
  return clip(container.querySelector(HEADING_SELECTOR)?.textContent, MAX_SECTION)
}

function readGesture(event: MouseEvent) {
  // 左键与中键；中键在 auxclick 里触发
  if (event.button !== 0 && event.button !== 1) return

  const element = findInteractive(event.target)
  if (!element) return

  const anchor = element.closest('a[href]') as HTMLAnchorElement | null
  const href = clip(anchor?.href || element.getAttribute('data-href'), MAX_HREF)

  const gesture = {
    tag: element.tagName.toLowerCase(),
    href,
    text: clip(element.getAttribute('aria-label') || element.textContent, MAX_TEXT),
    section: readSection(element),
    selection: clip(window.getSelection()?.toString(), MAX_SELECTION),
  }

  if (!gesture.href && !gesture.text && !gesture.section && !gesture.selection) return

  try {
    // 扩展重载或后台尚未就绪时会失败，忽略即可
    chrome.runtime.sendMessage({ type: 'ta:click-gesture', gesture }, () => void chrome.runtime.lastError)
  } catch (error) {
    // 无需处理
  }
}

const scope = globalThis as typeof globalThis & {
  __taCaptureVersion?: string
  __taCaptureDispose?: () => void
}
try { scope.__taCaptureDispose?.() } catch { /* An old extension context may have been invalidated. */ }
let disposed = false
let captureEnabled = false
let stopWatching: (() => void) | undefined

function setCapture(enabled: boolean) {
  if (enabled === captureEnabled || disposed) return
  captureEnabled = enabled
  window.removeEventListener('click', readGesture, true)
  window.removeEventListener('auxclick', readGesture, true)
  stopWatching?.()
  stopWatching = undefined
  if (!enabled || disposed) return
  window.addEventListener('click', readGesture, true)
  window.addEventListener('auxclick', readGesture, true)
  if (window.top === window && /^https?:$/.test(location.protocol)) {
    stopWatching = watchPageContentChanges((url, signature) => {
      try {
        chrome.runtime.sendMessage({ type: 'ta:page-content-changed', url, signature }, () => void chrome.runtime.lastError)
      } catch { setCapture(false) }
    })
  }
}

const applySettings = (settings: { aiAutoGroupEnabled?: boolean; rememberClickSource?: boolean } | undefined) => {
  setCapture(settings?.aiAutoGroupEnabled === true && settings?.rememberClickSource === true)
}
const settingsChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
  if (area === 'sync' && changes.TA_SETTING) applySettings(changes.TA_SETTING.newValue)
}
chrome.storage.onChanged.addListener(settingsChanged)
scope.__taCaptureVersion = 'page-changes-v3'
scope.__taCaptureDispose = () => {
  setCapture(false)
  disposed = true
  chrome.storage.onChanged.removeListener(settingsChanged)
  delete scope.__taCaptureVersion
}
void chrome.storage.sync.get('TA_SETTING').then(result => {
  if (!disposed) applySettings(result.TA_SETTING)
}).catch(() => setCapture(false))
