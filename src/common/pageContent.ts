export interface PageContent {
  description: string
  headings: string[]
  excerpt: string
}

/** Self-contained: also serialized by chrome.scripting.executeScript. */
export function collectPageContent(expectedUrl?: string): PageContent | undefined {
  if (expectedUrl && location.href !== expectedUrl) return undefined
  const text = (value: string | null | undefined, max: number) => (value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  const description = text(document.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute('content'), 300)
  const root = document.querySelector('article, main, [role="main"]') || document.body
  if (!root) return undefined
  const headings = Array.from(root?.querySelectorAll('h1, h2') || []).slice(0, 5).map(node => text((node as HTMLElement).innerText, 100)).filter(Boolean)
  const paragraphs: string[] = []
  let length = 0
  for (const node of Array.from(root?.querySelectorAll('p') || []).slice(0, 100)) {
    if (node.closest('nav, aside, footer, form, [role="navigation"], [contenteditable], [hidden], [aria-hidden="true"], .comments, #comments')) continue
    const value = text((node as HTMLElement).innerText, Math.min(400, 1200 - length))
    if (!value) continue
    paragraphs.push(value)
    length += value.length
    if (length >= 1200) break
  }
  return { description, headings, excerpt: paragraphs.join('\n') }
}

/** A non-security digest for deduplication; never stores or sends page text. */
export function pageContentSignature(url: string, title: string, content?: PageContent): string {
  const value = JSON.stringify([url, title, content || null])
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16)
}
