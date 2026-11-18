export class InvalidAiStreamError extends Error {
  constructor() { super('invalid-stream'); Object.setPrototypeOf(this, InvalidAiStreamError.prototype) }
}

/** OpenAI Chat Completions SSE. Consume the trailing usage chunk before [DONE]. */
export async function readAiCompletionStream(response: Response, signal: AbortSignal, onUsage: (chunk: unknown) => void): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new InvalidAiStreamError()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  let text = ''
  let bytes = 0
  let finished = false
  let finishAt = 0
  let usageReceived = false
  let done = false
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const event = () => {
    if (!dataLines.length) return
    const value = dataLines.join('\n')
    dataLines = []
    if (value.trim() === '[DONE]') { done = true; return }
    let chunk: any
    try { chunk = JSON.parse(value) } catch { throw new InvalidAiStreamError() }
    if (!chunk || typeof chunk !== 'object' || chunk.error) throw new InvalidAiStreamError()
    onUsage(chunk)
    if (chunk.usage && typeof chunk.usage === 'object') usageReceived = true
    const choice = chunk.choices?.[0]
    if (typeof choice?.delta?.content === 'string') text += choice.delta.content
    if (choice?.finish_reason != null) { finished = true; if (!finishAt) finishAt = Date.now() }
    if (text.length > 64 * 1024) throw new InvalidAiStreamError()
  }
  const line = (value: string) => {
    if (!value) event()
    else if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /, ''))
  }
  try {
    if (signal.aborted) throw new InvalidAiStreamError()
    while (!done) {
      // finish_reason is an authoritative end of generation. A gateway may
      // leave the transport open or omit [DONE]; allow a short bounded window
      // for the final usage chunk instead of discarding a completed answer.
      if (finished && usageReceived) { done = true; break }
      let grace: ReturnType<typeof setTimeout> | undefined
      let result: Awaited<ReturnType<typeof reader.read>> | undefined
      try {
        result = finished ? await Promise.race([
          reader.read(),
          new Promise<undefined>(resolve => { grace = setTimeout(() => resolve(undefined), Math.max(0, finishAt + 1000 - Date.now())) }),
        ]) : await reader.read()
      } finally { if (grace) clearTimeout(grace) }
      if (signal.aborted) throw new InvalidAiStreamError()
      if (!result || result.done) { if (finished) done = true; break }
      bytes += result.value.byteLength
      if (bytes > 1024 * 1024) throw new InvalidAiStreamError()
      buffer += decoder.decode(result.value, { stream: true })
      let newline: number
      while (!done && (newline = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, newline).replace(/\r$/, ''))
        buffer = buffer.slice(newline + 1)
      }
    }
    if (!done) { buffer += decoder.decode(); if (buffer) line(buffer.replace(/\r$/, '')); event() }
    if (signal.aborted || !done && !finished) throw new InvalidAiStreamError()
    return text
  } finally {
    signal.removeEventListener('abort', abort)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
