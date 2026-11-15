/**
 * 记录「用户刚刚点了什么」，用来把新标签页和来源页面关联起来。
 *
 * 内容脚本只在被授予网站访问权限、且用户显式开启时才注册，
 * 数据只存在于 Service Worker 内存中，几秒后过期，不落盘；启用 AI API 后会作为分组上下文发送给所选服务商。
 * 内容是页面可控的，所以进入存储前一律做长度与类型清洗。
 */

/** 点击记录的有效期：超过这个时间的记录不可能是同一个新标签页的来源。 */
export const CLICK_GESTURE_TTL_MS = 5_000

const MAX_TAG = 24
const MAX_HREF = 300
const MAX_TEXT = 120
const MAX_SECTION = 80
const MAX_SELECTION = 200

export interface ClickGesture {
  /** 被点元素的标签名，如 a / button */
  tag?: string
  /** 链接地址 */
  href?: string
  /** 元素文字或 aria-label */
  text?: string
  /** 元素所在区块的标题 */
  section?: string
  /** 点击时页面上被选中的文字 */
  selection?: string
  at: number
}

/** 拼进提示词的精简版本，去掉空字段。 */
export interface ClickPromptPayload {
  tag?: string
  href?: string
  text?: string
  section?: string
  selection?: string
}

/** tabId -> 最近一次点击。Service Worker 挂起后自然丢失，符合预期。 */
const gestures = new Map<number, ClickGesture>()

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const collapsed = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!collapsed) return undefined
  const chars = Array.from(collapsed)
  return chars.length <= max ? collapsed : chars.slice(0, max).join('')
}

/**
 * 内容脚本的消息是页面可控的输入，这里重新校验一遍：
 * 丢弃非字符串、限制长度、忽略发送方自带的时间戳。
 */
export function normalizeClickGesture(raw: unknown, now = Date.now()): ClickGesture | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>

  const gesture: ClickGesture = {
    tag: clip(record.tag, MAX_TAG),
    href: clip(record.href, MAX_HREF),
    text: clip(record.text, MAX_TEXT),
    section: clip(record.section, MAX_SECTION),
    selection: clip(record.selection, MAX_SELECTION),
    at: now,
  }

  if (!gesture.href && !gesture.text && !gesture.section && !gesture.selection) return undefined
  return gesture
}

/** 去掉空字段，避免提示词里出现一堆 null。 */
export function buildClickPayload(gesture: ClickGesture | undefined): ClickPromptPayload | undefined {
  if (!gesture) return undefined
  const payload: ClickPromptPayload = {}
  if (gesture.tag) payload.tag = gesture.tag
  if (gesture.href) payload.href = gesture.href
  if (gesture.text) payload.text = gesture.text
  if (gesture.section) payload.section = gesture.section
  if (gesture.selection) payload.selection = gesture.selection
  return Object.keys(payload).length ? payload : undefined
}

export function rememberClickGesture(sourceTabId: number, gesture: ClickGesture) {
  if (!Number.isInteger(sourceTabId) || sourceTabId < 0) return
  gestures.set(sourceTabId, gesture)
}

/** 读取并顺带清理过期记录，避免 Service Worker 长时间驻留时 map 膨胀。 */
export function readClickGesture(sourceTabId: number | undefined, now = Date.now()): ClickGesture | undefined {
  if (sourceTabId === undefined) return undefined
  const gesture = gestures.get(sourceTabId)
  if (!gesture) return undefined
  if (now - gesture.at > CLICK_GESTURE_TTL_MS) {
    gestures.delete(sourceTabId)
    return undefined
  }
  return gesture
}

export function forgetClickGesture(tabId: number) {
  gestures.delete(tabId)
}

/** 关闭功能或撤销权限时清空，避免残留旧数据。 */
export function forgetAllClickGestures() {
  gestures.clear()
}

/** 仅供测试。 */
export function resetClickGestures() {
  gestures.clear()
}
