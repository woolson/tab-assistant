import { collectPageContent, pageContentSignature } from '../../common/pageContent'

/** Observe only a bounded summary; messages contain a digest, never page text. */
export function watchPageContentChanges(notify: (url: string, signature: string) => void): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSent = 0
  let candidate: string | undefined
  let previous = pageContentSignature(location.href, document.title, collectPageContent())
  const schedule = () => {
    if (stopped || timer) return
    timer = setTimeout(() => {
      timer = undefined
      if (stopped) return
      const url = location.href
      const signature = pageContentSignature(url, document.title, collectPageContent())
      if (signature === previous) { candidate = undefined; return }
      // Require two stable samples; a streaming answer should finish changing
      // before it triggers a paid decision request. Unrelated DOM noise cannot
      // indefinitely postpone this check.
      if (signature !== candidate) { candidate = signature; schedule(); return }
      candidate = undefined
      previous = signature
      lastSent = Date.now()
      notify(url, signature)
    }, Math.max(1000, 5000 - (Date.now() - lastSent)))
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement
      return !element?.closest('nav, aside, footer, form, input, textarea, [contenteditable], [role="navigation"], .comments, #comments')
    })) schedule()
  })
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['content', 'hidden', 'aria-hidden'] })
  window.addEventListener('popstate', schedule)
  window.addEventListener('hashchange', schedule)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    observer.disconnect()
    window.removeEventListener('popstate', schedule)
    window.removeEventListener('hashchange', schedule)
  }
}
