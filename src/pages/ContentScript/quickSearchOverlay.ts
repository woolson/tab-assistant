import type { QuickSearchSize } from '../../common/quickSearch'
import type { QuickSearchAppearance } from '../../common/quickSearchAppearance'
import type { SearchGlassController } from '../../common/glass'

/** Self-contained: Chrome serializes this function into the active tab's isolated world. */
export function manageQuickSearchOverlay(action: 'toggle' | 'close' | 'reveal', frameUrl: string, preferredSize?: QuickSearchSize | null, initialAppearance?: QuickSearchAppearance): { state: 'open' | 'closed' | 'unavailable' } {
  const scope = globalThis as typeof globalThis & {
    __taCreateSearchGlass?: (container: HTMLElement, appearance: QuickSearchAppearance) => SearchGlassController
    __taQuickSearchOverlay?: { host: HTMLElement; url: string; close: (immediate?: boolean) => void; reveal?: () => void; isClosing?: () => boolean; dispose?: () => void; applyAppearance?: (appearance: QuickSearchAppearance) => void }
  }
  const previous = scope.__taQuickSearchOverlay
  if (action === 'reveal') {
    if (!previous?.host.isConnected || previous.url !== frameUrl || previous.isClosing?.()) return { state: 'unavailable' }
    if (initialAppearance) previous.applyAppearance?.(initialAppearance)
    previous.reveal?.()
    return { state: 'open' }
  }
  if (previous) {
    if (action === 'close' && previous.url !== frameUrl) return { state: 'closed' }
    if (action === 'toggle' && previous.isClosing?.()) {
      previous.dispose?.()
    } else {
      const visible = previous.host.isConnected
      previous.close()
      if (visible || action === 'close') return { state: 'closed' }
    }
  }
  if (action === 'close') return { state: 'closed' }
  if (!document.documentElement) return { state: 'unavailable' }
  if (!scope.__taCreateSearchGlass) return { state: 'unavailable' }

  const focused = document.activeElement as HTMLElement | null
  const host = document.createElement('div')
  host.style.setProperty('all', 'initial', 'important')
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial !important; }
    dialog { all: initial; box-sizing: border-box; display: block; position: fixed; inset: 0; margin: auto;
      --qs-glass-rgb: 246,249,255;
      max-width: none; max-height: none; padding: 0; border: 0;
      border-radius: var(--qs-corner-radius, 38px); overflow: visible; background: transparent;
      box-shadow: 0 0 0 100vmax transparent, 0 24px 90px transparent; transition: box-shadow 100ms ease-out; color-scheme: normal; }
    dialog[data-ready='true'] { box-shadow: 0 0 0 100vmax rgba(8,12,22,.48), 0 24px 90px rgba(0,0,0,.22); }
    dialog::backdrop { background: transparent; opacity: 0; transition: opacity 100ms ease-out; }
    dialog[data-ready='true']::backdrop { opacity: 1; }
    dialog[data-closing='true'] { pointer-events: none; }
    dialog[data-closing='true']::backdrop { opacity: 0; transition: opacity 160ms ease-in; }
    iframe { position: relative; z-index: 3; display: block; width: 100%; height: 100%; border: 0; border-radius: inherit; background: transparent; opacity: 0; transition: opacity 100ms ease-out, transform 160ms ease-out; }
    dialog[data-ready='true'] iframe { opacity: 1; }
    dialog .ta-glass-layer { transition: opacity 100ms ease-out; }
    dialog:not([data-ready='true']) .ta-glass-layer { opacity: 0; }
    dialog[data-closing='true'] { box-shadow: 0 0 0 100vmax transparent, 0 24px 90px transparent; transition: box-shadow 160ms ease-in; }
    dialog[data-closing='true'] .ta-glass-layer { opacity: 0; transition: opacity 160ms ease-in; }
    dialog[data-closing='true'] iframe { opacity: 0; transform: translateY(4px) scale(.985); transition: opacity 160ms ease-in, transform 160ms ease-in; }
    dialog[data-resizing='true'] { user-select: none; }
    dialog[data-resizing='true'] iframe { pointer-events: none; }
    .resize-handle { all: initial; box-sizing: border-box; position: absolute; display: block; z-index: 4; touch-action: none; user-select: none; }
    .resize-handle[data-resize='n'], .resize-handle[data-resize='s'] { left: 16px; right: 16px; height: 7px; cursor: ns-resize; }
    .resize-handle[data-resize='n'] { top: 0; }
    .resize-handle[data-resize='s'] { bottom: 0; }
    .resize-handle[data-resize='e'], .resize-handle[data-resize='w'] { top: 16px; bottom: 16px; width: 7px; cursor: ew-resize; }
    .resize-handle[data-resize='e'] { right: 0; }
    .resize-handle[data-resize='w'] { left: 0; }
    .resize-handle[data-resize='ne'], .resize-handle[data-resize='nw'], .resize-handle[data-resize='se'], .resize-handle[data-resize='sw'] { width: 20px; height: 20px; }
    .resize-handle[data-resize='ne'], .resize-handle[data-resize='nw'] { top: 0; }
    .resize-handle[data-resize='se'], .resize-handle[data-resize='sw'] { bottom: 0; }
    .resize-handle[data-resize='ne'], .resize-handle[data-resize='se'] { right: 0; }
    .resize-handle[data-resize='nw'], .resize-handle[data-resize='sw'] { left: 0; }
    .resize-handle[data-resize='ne'], .resize-handle[data-resize='sw'] { cursor: nesw-resize; }
    .resize-handle[data-resize='nw'], .resize-handle[data-resize='se'] { cursor: nwse-resize; }
    .resize-handle[data-resize='se']::after { content: ''; position: absolute; right: calc(var(--qs-corner-radius, 38px) * .3 + 4px); bottom: calc(var(--qs-corner-radius, 38px) * .3 + 4px); width: 9px; height: 9px;
      background: repeating-linear-gradient(135deg, transparent 0 3px, rgba(135,145,170,.6) 3px 4px, transparent 4px 6px); clip-path: polygon(100% 0, 100% 100%, 0 100%); }
    @supports (corner-shape: squircle) {
      dialog { corner-shape: squircle; } iframe { corner-shape: inherit; }
      .resize-handle[data-resize='se']::after { right: calc(var(--qs-corner-radius, 38px) * .16 + 4px); bottom: calc(var(--qs-corner-radius, 38px) * .16 + 4px); }
    }
    @media (prefers-reduced-motion: reduce) { iframe, dialog::backdrop, dialog, dialog .ta-glass-layer { transition: none !important; } }
  `
  const dialog = document.createElement('dialog')
  if (typeof dialog.showModal !== 'function') return { state: 'unavailable' }
  dialog.setAttribute('aria-label', 'TabAssistant')
  const frame = document.createElement('iframe')
  frame.src = frameUrl
  frame.title = 'TabAssistant'
  frame.referrerPolicy = 'no-referrer'
  dialog.append(frame)
  shadow.append(style, dialog)

  // These constants stay inside the serialized function; persist only after an actual drag.
  const sizeKey = 'TA_QUICK_SEARCH_SIZE'
  let requestedSize = preferredSize && Number.isFinite(preferredSize.width) && Number.isFinite(preferredSize.height) && preferredSize.width > 0 && preferredSize.height > 0
    ? { width: preferredSize.width, height: preferredSize.height } : { width: 760, height: 560 }
  const applySize = (size: QuickSearchSize) => {
    const maxWidth = Math.max(1, window.innerWidth - 40), maxHeight = Math.max(1, window.innerHeight - 64)
    const fitted = { width: Math.min(maxWidth, Math.max(360, Math.round(size.width))), height: Math.min(maxHeight, Math.max(280, Math.round(size.height))) }
    dialog.style.width = `${fitted.width}px`
    dialog.style.height = `${fitted.height}px`
    return fitted
  }
  let currentSize = applySize(requestedSize)
  let closing = false, disposed = false
  let exitTimer: ReturnType<typeof setTimeout> | undefined
  let glass: SearchGlassController | undefined
  let preparedAppearance = initialAppearance
  let appearance: Partial<QuickSearchAppearance> = initialAppearance || {}
  const themeMedia = window.matchMedia?.('(prefers-color-scheme: dark)')
  const applyAppearance = (value?: Partial<QuickSearchAppearance>) => {
    if (disposed || closing) return
    appearance = value && typeof value === 'object' ? value : {}
    const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback
    const material = appearance.quickSearchMaterial === 'classic' ? 'classic' : 'frosted'
    const transparency = bounded(appearance.quickSearchTransparency, 45, 20, 80)
    const blur = bounded(appearance.quickSearchBlur, 24, 8, 40)
    const dark = appearance.theme === 'dark' || appearance.theme !== 'light' && !!themeMedia?.matches
    // Match quickSearchGlassVariables; this serialized function cannot import runtime helpers.
    const opacity = material === 'classic' ? 1 : dark ? .76 : .72
    const visualBlur = material === 'frosted' ? dark ? 28 : 24 : blur
    preparedAppearance = { quickSearchMaterial: material, quickSearchTransparency: transparency, quickSearchBlur: blur, theme: dark ? 'dark' : 'light' }
    dialog.setAttribute('data-material', material)
    dialog.setAttribute('data-theme', dark ? 'dark' : 'light')
    dialog.style.setProperty('--qs-glass-opacity', opacity.toFixed(2))
    dialog.style.setProperty('--qs-glass-blur', `${visualBlur}px`)
    dialog.style.setProperty('--qs-corner-radius', '38px')
    glass?.update(preparedAppearance)
  }
  const themeChanged = () => applyAppearance(appearance)
  const settingsChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
    if (area === 'sync' && changes.TA_SETTING) applyAppearance(changes.TA_SETTING.newValue)
  }
  const viewportChanged = () => { currentSize = applySize(requestedSize) }
  const focusInput = () => {
    frame.focus()
    const url = new URL(frameUrl)
    frame.contentWindow?.postMessage({ type: 'ta:quick-search-focus', session: url.searchParams.get('session') }, `${url.protocol}//${url.host}`)
  }
  let drag: { pointerId: number; handle: HTMLElement; direction: string; x: number; y: number; size: QuickSearchSize; requested: QuickSearchSize } | undefined
  const finishResize = (commit: boolean, restoreFocus = true) => {
    const previousDrag = drag
    if (!previousDrag) return
    drag = undefined
    dialog.removeAttribute('data-resizing')
    dialog.style.cursor = ''
    if (commit) {
      if (currentSize.width !== previousDrag.size.width || currentSize.height !== previousDrag.size.height) {
        requestedSize = { width: currentSize.width, height: currentSize.height }
        try { void chrome.storage.local.set({ [sizeKey]: requestedSize }).catch(() => {}) } catch { /* The extension may have been reloaded during the drag. */ }
      }
    } else {
      requestedSize = previousDrag.requested
      currentSize = applySize(requestedSize)
    }
    try { previousDrag.handle.releasePointerCapture(previousDrag.pointerId) } catch { /* Capture may already have been released. */ }
    if (restoreFocus) focusInput()
  }
  for (const direction of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const handle = document.createElement('button')
    handle.className = 'resize-handle'
    handle.tabIndex = -1
    handle.setAttribute('type', 'button')
    handle.setAttribute('data-resize', direction)
    handle.setAttribute('aria-label', '调整搜索窗口大小')
    handle.title = '拖动调整大小'
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false || drag || closing || dialog.getAttribute('data-ready') !== 'true') return
      event.preventDefault()
      drag = { pointerId: event.pointerId, handle, direction, x: event.clientX, y: event.clientY,
        size: { width: currentSize.width, height: currentSize.height }, requested: { width: requestedSize.width, height: requestedSize.height } }
      dialog.setAttribute('data-resizing', 'true')
      dialog.style.cursor = direction === 'e' || direction === 'w' ? 'ew-resize' : direction === 'n' || direction === 's' ? 'ns-resize' : direction === 'ne' || direction === 'sw' ? 'nesw-resize' : 'nwse-resize'
      try { handle.setPointerCapture(event.pointerId) } catch { finishResize(false) }
    })
    handle.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return
      event.preventDefault()
      // Both opposite edges move equally, keeping the dialog's center fixed throughout the drag.
      const horizontal = drag.direction.includes('e') ? 1 : drag.direction.includes('w') ? -1 : 0
      const vertical = drag.direction.includes('s') ? 1 : drag.direction.includes('n') ? -1 : 0
      currentSize = applySize({ width: drag.size.width + horizontal * (event.clientX - drag.x) * 2, height: drag.size.height + vertical * (event.clientY - drag.y) * 2 })
    })
    handle.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId) finishResize(true) })
    handle.addEventListener('pointercancel', event => { if (drag?.pointerId === event.pointerId) finishResize(false) })
    handle.addEventListener('lostpointercapture', event => { if (drag?.pointerId === event.pointerId) finishResize(true) })
    dialog.append(handle)
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    if (exitTimer !== undefined) clearTimeout(exitTimer)
    finishResize(false, false)
    document.removeEventListener('visibilitychange', hidden)
    window.removeEventListener('pagehide', leaving)
    window.removeEventListener('resize', viewportChanged)
    themeMedia?.removeEventListener?.('change', themeChanged)
    if (typeof chrome !== 'undefined') chrome.storage?.onChanged?.removeListener(settingsChanged)
    dialog.removeEventListener('transitionend', transitionEnded)
    glass?.destroy()
    if (dialog.open) dialog.close()
    host.remove()
    if (scope.__taQuickSearchOverlay?.host === host) {
      delete scope.__taQuickSearchOverlay
      if (focused?.isConnected && !document.hidden) focused.focus({ preventScroll: true })
    }
  }
  const close = (immediate = false) => {
    if (disposed) return
    if (immediate || document.hidden || !host.isConnected || dialog.getAttribute('data-ready') !== 'true' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      dispose()
      return
    }
    if (closing) return
    closing = true
    finishResize(false, false)
    frame.setAttribute('inert', '')
    dialog.setAttribute('data-closing', 'true')
    // Keep the dialog in the top layer until both its surface and backdrop have faded out.
    exitTimer = setTimeout(dispose, 180)
  }
  const transitionEnded = (event: TransitionEvent) => {
    if (closing && (event.target === dialog || event.target === frame) && event.propertyName === 'opacity') dispose()
  }
  const hidden = () => { if (document.hidden) close(true) }
  const leaving = () => close(true)
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return
    const bounds = dialog.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
  })
  dialog.addEventListener('transitionend', transitionEnded)
  document.documentElement.append(host)
  applyAppearance(appearance)
  const reveal = () => {
    dialog.setAttribute('data-ready', 'true')
    // Focus the input after the parent frame has become visible and received focus.
    focusInput()
  }
  scope.__taQuickSearchOverlay = { host, url: frameUrl, close, reveal, isClosing: () => closing, dispose, applyAppearance }
  document.addEventListener('visibilitychange', hidden)
  window.addEventListener('pagehide', leaving)
  window.addEventListener('resize', viewportChanged)
  themeMedia?.addEventListener?.('change', themeChanged)
  if (typeof chrome !== 'undefined') chrome.storage?.onChanged?.addListener(settingsChanged)
  try {
    // The top layer covers page headers and full-screen app shells without changing page styles.
    dialog.showModal()
    glass = scope.__taCreateSearchGlass(dialog, preparedAppearance as QuickSearchAppearance)
    return { state: 'open' }
  } catch {
    close(true)
    return { state: 'unavailable' }
  }
}
