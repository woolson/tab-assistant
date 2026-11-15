import { collectPageContent } from '../../common/pageContent'

/** Read a bounded page summary only on demand and with existing site permission. */
export async function readPageContext(tabId: number, url: string, signal: AbortSignal) {
  if (signal.aborted || !chrome.scripting?.executeScript) return undefined
  try {
    const deadline = Date.now() + 1200
    while (!signal.aborted) {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: collectPageContent, args: [url] })
      if (signal.aborted) return undefined
      const content = results[0]?.result
      if (content || Date.now() >= deadline) return content
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return undefined
  } catch {
    return undefined
  }
}
