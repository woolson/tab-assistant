/**
 * 点击来源记录器。
 *
 * 只在用户开启「记住点击来源」并授予网站访问权限后才会被注册，
 * 目标是回答一个问题：这个新标签页是从哪个页面上的哪个元素点开的。
 *
 * 只读取被点元素的标签、文字、链接、所在区块标题和选中文字，
 * 不读取页面正文，不写存储，不在本地缓存，直接发给后台并很快过期。
 */

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

// capture 阶段监听，避免页面自己 stopPropagation 把记录吞掉
window.addEventListener('click', readGesture, true)
window.addEventListener('auxclick', readGesture, true)
