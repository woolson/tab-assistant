import { collectPageContent, type PageContent } from '../../common/pageContent'
import type { GroupSnapshot } from './aiAutoGroupDecision'
import { specificTaskText } from './taskEvidence'

export type PageContextReader = typeof readPageContext

/** A full-regroup session cache; mutations/navigation invalidate individual tabs. */
export function createPageContextCache() {
  const entries = new Map<number, { url: string; content?: PageContent }>()
  const read: PageContextReader = async (tabId, url, signal) => {
    if (signal.aborted) return undefined
    const previous = entries.get(tabId)
    if (previous?.url === url && previous.content) return copy(previous.content)
    const entry = { url, content: undefined as PageContent | undefined }
    entries.set(tabId, entry)
    const content = await readPageContext(tabId, url, signal)
    if (signal.aborted || entries.get(tabId) !== entry) return undefined
    // A loading shell must not mask the subsequently loaded application.
    if (content && (content.headings.length || content.excerpt)) entry.content = copy(content)
    else entries.delete(tabId)
    return content
  }
  const copy = (content: PageContent): PageContent => ({ ...content, headings: [...content.headings], ...(content.context ? { context: [...content.context] } : {}) })
  return { read, invalidate: (tabId: number) => { entries.delete(tabId) }, clear: () => entries.clear() }
}

/** Read a bounded page summary only on demand and with existing site permission. */
export async function readPageContext(tabId: number, url: string, signal: AbortSignal) {
  if (signal.aborted || !chrome.scripting?.executeScript) return undefined
  return new Promise<PageContent | undefined>(resolve => {
    const deadline = Date.now() + 1200
    let latest: PageContent | undefined
    let active = true
    const finish = (content?: PageContent) => {
      if (!active) return
      active = false
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolve(content)
    }
    const abort = () => finish()
    // A suspended renderer can leave executeScript pending indefinitely. The
    // deadline must race the API call itself, not merely the next polling pass.
    const timer = setTimeout(() => finish(latest), 1200)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { finish(); return }
    void (async () => {
      while (active && !signal.aborted) {
        const results = await chrome.scripting.executeScript({ target: { tabId }, func: collectPageContent, args: [url] })
        if (!active || signal.aborted) return
        const content = results[0]?.result
        if (content && (content.title || content.description || content.headings.length || content.excerpt || content.context?.length)) latest = content
        if (content && (content.headings.length || content.excerpt) || Date.now() >= deadline) { finish(latest); return }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    })().catch(() => finish())
  })
}

/** 标题模糊或重复的组内页面最多补充三个短摘要，正文只停留在本次请求内存里。 */
export async function enrichGroupPageContexts(groups: GroupSnapshot[], target: { id?: number; url: string; title: string }, signal: AbortSignal, read: PageContextReader = readPageContext) {
  const candidates = groups.map(group => group.tabs.filter(tab => tab.id !== undefined && tab.id !== target.id && tab.url !== target.url
    && (!specificTaskText(tab.title) || !specificTaskText(group.title) || tab.title === target.title
      || group.tabs.some(other => other !== tab && other.title === tab.title))))
  const selected = candidates.map(tabs => tabs[0]).filter(Boolean).slice(0, 3)
  for (const tabs of candidates) for (const tab of tabs) {
    if (selected.length >= 3) break
    if (!selected.includes(tab)) selected.push(tab)
  }
  await Promise.all(selected.map(async tab => {
    const content = await read(tab.id as number, tab.url, signal)
    if (!content || signal.aborted) return
    tab.content = {
      ...(content.title ? { title: content.title.slice(0, 120) } : {}),
      description: content.description.slice(0, 150),
      headings: content.headings.slice(0, 3).map(value => value.slice(0, 80)),
      excerpt: content.excerpt.slice(0, 400),
      ...(content.context?.length ? { context: content.context.slice(0, 4).map(value => value.slice(0, 80)) } : {}),
    }
  }))
}
