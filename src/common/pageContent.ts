export interface PageContent {
  title?: string
  description: string
  headings: string[]
  excerpt: string
  context?: string[]
}

/** Self-contained: also serialized by chrome.scripting.executeScript. */
export function collectPageContent(expectedUrl?: string): PageContent | undefined {
  if (expectedUrl && location.href !== expectedUrl) return undefined
  // Kept inline because this function is serialized into a page without imports.
  const text = (value: string | null | undefined, max: number) => (value || '')
    .replace(/^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+|[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+$/g, '')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, max)
  const omitted = 'script, style, noscript, template, nav, aside, footer, form, input, textarea, select, [role="navigation"], [role="menu"], [role="menubar"], [hidden], [inert], [aria-hidden="true"], [contenteditable]:not([contenteditable="false"]):not([aria-readonly="true"]), .comments, #comments, .ant-menu, .ant-layout-sider, .next-menu, .next-nav, .next-shell-navigation'
  const visibility = new WeakMap<Element, boolean>()
  const readable = (element: Element | null): boolean => {
    const visited: Element[] = []
    let current = element
    let visible = true
    for (let depth = 0; current && depth < 32; depth++) {
      const cached = visibility.get(current)
      if (cached !== undefined) { visible = cached; break }
      visited.push(current)
      if (current.closest?.(omitted)) { visible = false; break }
      if (typeof getComputedStyle === 'function') {
        const style = getComputedStyle(current)
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') { visible = false; break }
      }
      current = current.parentElement || (current.getRootNode?.() as ShadowRoot | undefined)?.host || null
    }
    visited.forEach(node => visibility.set(node, visible))
    return visible
  }
  const title = text(document.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.getAttribute('content'), 120)
  const description = text(document.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute('content'), 300)
  const root = document.querySelector('article, main, [role="main"], [role="document"], .ant-layout-content, .next-shell-main, .next-shell-content') || document.body
  if (!root) return undefined
  const headingSelector = 'h1, h2, h3, [role="heading"]'
  const headings: string[] = []
  const context: string[] = []
  const paragraphs: string[] = []
  const seen = new Set<string>()
  const placeholders = new Set(['暂无数据', '暂无描述', '加载中', '正在加载', 'no data', 'no description', 'loading', 'loading...'])
  const roots: Array<Element | ShadowRoot> = [root]
  let length = 0
  let visited = 0
  for (let index = 0; index < roots.length && index < 8; index++) {
    const scope = roots[index]
    Array.from(scope.querySelectorAll(headingSelector)).slice(0, 30).forEach(node => {
      if (!readable(node) || headings.length >= 5) return
      const value = text((node as HTMLElement).innerText || node.textContent, 100)
      if (value && !headings.includes(value)) headings.push(value)
    })
    // Web Components 的开放 Shadow DOM 也属于可见页面，不读取框架内部状态。
    Array.from(scope.querySelectorAll('*')).slice(0, 500).forEach(node => {
      if (roots.length < 8 && node.shadowRoot && readable(node)) roots.push(node.shadowRoot)
    })
    const walker = document.createTreeWalker(scope, 4 /* NodeFilter.SHOW_TEXT */)
    let node: Node | null
    while (length < 1200 && visited < 2500 && (node = walker.nextNode())) {
      visited++
      if (!readable(node.parentElement)) continue
      const value = text(node.nodeValue, Math.min(400, 1200 - length))
      if (!value || seen.has(value) || placeholders.has(value.toLowerCase())) continue
      seen.add(value)
      paragraphs.push(value)
      length += value.length
    }
  }
  Array.from(document.querySelectorAll('[aria-current="page"], [role="tab"][aria-selected="true"], .ant-tabs-tab-active, .next-tabs-tab.active, .ant-breadcrumb, .next-breadcrumb')).slice(0, 20).forEach(node => {
    if (!readable(node) || context.length >= 6) return
    const value = text((node as HTMLElement).innerText || node.textContent, 100)
    if (value && !context.includes(value)) context.push(value)
  })
  const content: PageContent = { description, headings, excerpt: paragraphs.join('\n') }
  if (title) content.title = title
  if (context.length) content.context = context
  return content
}

/** A non-security digest for deduplication; never stores or sends page text. */
export function pageContentSignature(url: string, title: string, content?: PageContent): string {
  // Keep this module self-contained for the serialized collector's isolated realm.
  const taskTitle = title.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+|[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+$/g, '')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim()
  const value = JSON.stringify([url, taskTitle, content || null])
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16)
}
