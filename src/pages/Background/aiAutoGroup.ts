import { Logger } from "./helpers"
import {
  AiGroupDecision,
  GroupSnapshot,
  buildGroupSnapshots,
  compactGroupsForPrompt,
  getLanguageModelFactory,
  LanguageModelFactory,
  LanguageModelSession,
  ModelAvailability,
  pickFallbackGroupId,
  parseAiGroupDecision,
  queryLanguageModelAvailability,
  readRealUrl,
  isGroupedId,
} from "./aiAutoGroupDecision"

/** 新建标签仍停在新标签页时，等待真实地址的最长时间。 */
const URL_WAIT_MS = 2500
/** 单次本地模型调用的上限。超时后走主域名回退，不挡住后续标签。 */
const MODEL_TIMEOUT_MS = 4000
/** 在队列里等待太久就不再调用模型，直接回退。 */
const QUEUE_GIVE_UP_MS = 8000
const AVAILABILITY_TTL_MS = 60_000

/** 用户刚手动移动标签或分组后，这段时间内不覆盖。 */
export const AI_MANUAL_EDIT_COOLDOWN_MS = 10_000

const TEXT_MODEL_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
}

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['join', 'create', 'leave'] },
    groupId: { type: 'number' },
    title: { type: 'string' },
  },
}

const SYSTEM_PROMPT = [
  'You place one newly opened browser tab into a tab group.',
  'Choose exactly one action:',
  'join: set groupId to an id from the input groups.',
  'create: set title to a short label of at most 24 characters. Use the language of the page title when it is obvious.',
  'leave: keep the tab ungrouped when the topic is unclear or no existing group fits.',
  'Prefer join when the pages belong together. Prefer leave over a vague new group.',
].join('\n')

export interface AiGroupingHost {
  isDisposed(): boolean
  hasManualTabHold(tabId: number): boolean
  shouldUseExistingGrouping(url: string): boolean
  groupTabWithExistingRules(tab: chrome.tabs.Tab): Promise<void>
  joinTabToGroup(tab: chrome.tabs.Tab, groupId: number): Promise<void>
  createGroupForTab(tab: chrome.tabs.Tab, title: string): Promise<void>
  /** 短等待结束时地址还没到，把决策权交回，等第一个真实地址再决定。 */
  releaseInitialDecision(tabId: number): void
}

let availabilityCache: { at: number; value: ModelAvailability } | undefined
let cachedSession: LanguageModelSession | undefined
let sessionPromise: Promise<LanguageModelSession | undefined> | undefined
let sessionGeneration = 0
let decisionQueue: Promise<void> = Promise.resolve()

/** 关闭功能或模型会话失效时释放本地模型。 */
export function suspendOnDeviceModel() {
  availabilityCache = undefined
  discardSession()
}

/**
 * 只处理刚创建的标签。地址还是新标签页时短暂等待，
 * 不在这里处理同一标签之后的普通跳转。
 */
export function watchNewTabForAiGrouping(host: AiGroupingHost, tab: chrome.tabs.Tab) {
  if (!tab.id || tab.pinned || isGroupedId(tab.groupId)) return
  void settleNewTab(host, tab.id, true)
}

/** 新标签页的第一个真实地址如果来得比短等待更晚，补上这一次决策。 */
export function continueNewTabForAiGrouping(host: AiGroupingHost, tabId: number) {
  void settleNewTab(host, tabId, false)
}

async function settleNewTab(host: AiGroupingHost, tabId: number, waitForUrl: boolean) {
  try {
    const ready = waitForUrl ? await waitForRealTab(tabId, URL_WAIT_MS) : await readTab(tabId)
    if (!ready || host.isDisposed() || !readRealUrl(ready)) {
      host.releaseInitialDecision(tabId)
      return
    }
  } catch (error) {
    host.releaseInitialDecision(tabId)
    Logger.log('等待新标签地址失败', tabId, error)
    return
  }

  const enqueuedAt = Date.now()
  await enqueue(async () => {
    try {
      if (host.isDisposed() || host.hasManualTabHold(tabId)) return
      const latest = await readTab(tabId)
      if (!latest || host.isDisposed() || host.hasManualTabHold(tabId) || isGroupedId(latest.groupId)) return
      const url = readRealUrl(latest)
      if (!url) {
        host.releaseInitialDecision(tabId)
        return
      }

      if (host.shouldUseExistingGrouping(url)) {
        await host.groupTabWithExistingRules(latest)
        return
      }

      await placeNewTab(host, latest, latest.openerTabId, url, enqueuedAt)
    } catch (error) {
      Logger.log('AI 自动分组失败', tabId, error)
    }
  })
}

async function placeNewTab(
  host: AiGroupingHost,
  tab: chrome.tabs.Tab,
  openerTabId: number | undefined,
  url: string,
  enqueuedAt: number,
) {
  const snapshots = await loadSnapshots(tab.windowId, tab.id as number)
  const waitedTooLong = Date.now() - enqueuedAt > QUEUE_GIVE_UP_MS
  const decision = waitedTooLong
    ? undefined
    : await withTimeout(signal => askModel(tab, openerTabId, url, snapshots, signal), MODEL_TIMEOUT_MS)

  if (host.isDisposed() || !tab.id || host.hasManualTabHold(tab.id)) return
  Logger.log('AI 分组决策', decision || (waitedTooLong ? 'queue-fallback' : 'fallback'), url)

  if (decision?.action === 'leave') return
  if (decision?.action === 'join' && decision.groupId !== undefined) {
    await host.joinTabToGroup(tab, decision.groupId)
    return
  }
  if (decision?.action === 'create' && decision.title) {
    await host.createGroupForTab(tab, decision.title)
    return
  }

  const fallbackGroupId = pickFallbackGroupId(snapshots, url)
  if (fallbackGroupId !== undefined) await host.joinTabToGroup(tab, fallbackGroupId)
}

async function askModel(
  tab: chrome.tabs.Tab,
  openerTabId: number | undefined,
  url: string,
  snapshots: GroupSnapshot[],
  signal: AbortSignal,
): Promise<AiGroupDecision | undefined> {
  if (signal.aborted) return undefined
  const session = await obtainSession()
  if (!session || signal.aborted) return undefined

  const groups = compactGroupsForPrompt(snapshots, url)
  const validGroupIds = new Set(groups.map(group => group.id))
  const payload = JSON.stringify({
    instruction: 'Choose join, create, or leave for the target tab.',
    source: await readOpener(openerTabId),
    target: {
      url: clip(url, 180),
      title: clip(tab.title || '', 80),
    },
    groups,
  })

  try {
    const raw = await session.prompt(payload, { responseConstraint: DECISION_SCHEMA })
    if (signal.aborted) return undefined
    return parseAiGroupDecision(raw, validGroupIds)
  } catch (error) {
    if (signal.aborted) return undefined
    Logger.log('结构化输出失败，改为普通提示', error)
  }

  try {
    const raw = await session.prompt(`${payload}\nReply with one JSON object: {"action":"join"|"create"|"leave","groupId"?:number,"title"?:string}`)
    if (signal.aborted) return undefined
    return parseAiGroupDecision(raw, validGroupIds)
  } catch (error) {
    if (!signal.aborted) {
      Logger.log('本地模型提示失败', error)
      discardSession()
    }
    return undefined
  }
}

async function obtainSession(): Promise<LanguageModelSession | undefined> {
  if (cachedSession) return cachedSession
  const availability = await getCachedAvailability()
  if (availability === 'downloadable') {
    ensureModelDownload()
    return undefined
  }
  if (availability !== 'available') return undefined
  return getSession()
}

async function getCachedAvailability(): Promise<ModelAvailability> {
  if (availabilityCache && Date.now() - availabilityCache.at < AVAILABILITY_TTL_MS) {
    return availabilityCache.value
  }
  const pending = queryLanguageModelAvailability().catch(error => {
    Logger.log('检查设备端模型失败', error)
    return 'unsupported' as const
  })
  const value = await Promise.race([
    pending,
    new Promise<ModelAvailability>(resolve => {
      setTimeout(() => resolve('unavailable'), 1500)
    }),
  ])
  availabilityCache = { at: Date.now(), value }
  void pending.then(actual => {
    availabilityCache = { at: Date.now(), value: actual }
  })
  return value
}

function ensureModelDownload() {
  if (cachedSession || sessionPromise) return
  const generation = sessionGeneration
  sessionPromise = createSession()
    .then(session => {
      if (generation !== sessionGeneration) {
        destroySession(session)
        return undefined
      }
      cachedSession = session
      availabilityCache = { at: Date.now(), value: 'available' }
      return session
    })
    .catch(error => {
      Logger.log('准备设备端模型失败', error)
      return undefined
    })
    .finally(() => {
      if (sessionPromise && generation === sessionGeneration && !cachedSession) sessionPromise = undefined
    })
}

function getSession(): Promise<LanguageModelSession | undefined> {
  if (cachedSession) return Promise.resolve(cachedSession)
  if (sessionPromise) return sessionPromise
  const generation = sessionGeneration
  sessionPromise = createSession()
    .then(session => {
      if (generation !== sessionGeneration) {
        destroySession(session)
        return undefined
      }
      cachedSession = session
      return session
    })
    .catch(error => {
      Logger.log('创建本地模型会话失败', error)
      return undefined
    })
    .finally(() => {
      if (!cachedSession) sessionPromise = undefined
    })
  return sessionPromise
}

async function createSession(): Promise<LanguageModelSession> {
  const model = getLanguageModelFactory()
  if (!model) throw new Error('LanguageModel missing')

  const sampling = await readSampling(model)
  try {
    return await model.create({
      ...TEXT_MODEL_OPTIONS,
      ...sampling,
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    })
  } catch (error) {
    Logger.log('使用完整参数创建会话失败，改为最小参数', error)
    return model.create(TEXT_MODEL_OPTIONS)
  }
}

async function readSampling(model: LanguageModelFactory): Promise<{ temperature?: number; topK?: number }> {
  if (typeof model.params !== 'function') return {}
  try {
    const params = await model.params()
    const temperature = Math.min(0.2, params.maxTemperature)
    const topK = Math.min(Math.max(1, params.defaultTopK), params.maxTopK)
    if (!Number.isFinite(temperature) || !Number.isFinite(topK) || topK < 1 || temperature < 0) return {}
    return { temperature, topK }
  } catch (error) {
    Logger.log('读取本地模型参数失败，使用默认采样', error)
    return {}
  }
}

function discardSession() {
  sessionGeneration += 1
  const session = cachedSession
  cachedSession = undefined
  sessionPromise = undefined
  destroySession(session)
}

function destroySession(session: LanguageModelSession | undefined) {
  if (!session || typeof session.destroy !== 'function') return
  try {
    session.destroy()
  } catch (error) {
    Logger.log('释放本地模型会话失败', error)
  }
}

async function loadSnapshots(windowId: number, ignoreTabId: number): Promise<GroupSnapshot[]> {
  const [groups, tabs] = await Promise.all([
    chrome.tabGroups.query({ windowId }),
    chrome.tabs.query({ windowId }),
  ])
  return buildGroupSnapshots(groups, tabs, ignoreTabId)
}

async function readOpener(openerTabId: number | undefined): Promise<{ url: string; title: string } | null> {
  if (!openerTabId) return null
  try {
    const opener = await chrome.tabs.get(openerTabId)
    const url = readRealUrl(opener)
    if (!url) return null
    return { url: clip(url, 180), title: clip(opener.title || '', 80) }
  } catch (error) {
    Logger.log('读取来源标签失败', openerTabId, error)
    return null
  }
}

function readTab(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  return chrome.tabs.get(tabId).catch(error => {
    Logger.log('读取新标签失败', tabId, error)
    return undefined
  })
}

function waitForRealTab(tabId: number, timeoutMs: number): Promise<chrome.tabs.Tab | undefined> {
  return new Promise(resolve => {
    let settled = false
    const finish = (tab?: chrome.tabs.Tab) => {
      if (settled) return
      settled = true
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.tabs.onRemoved.removeListener(onRemoved)
      clearTimeout(timer)
      resolve(tab)
    }

    const consider = (tab: chrome.tabs.Tab) => {
      if (readRealUrl(tab)) finish(tab)
    }

    const onUpdated = (updatedId: number) => {
      if (updatedId !== tabId) return
      chrome.tabs.get(tabId).then(consider).catch(() => finish(undefined))
    }

    const onRemoved = (removedId: number) => {
      if (removedId === tabId) finish(undefined)
    }

    const timer = setTimeout(() => {
      chrome.tabs.get(tabId).then(tab => {
        finish(readRealUrl(tab) ? tab : undefined)
      }).catch(() => finish(undefined))
    }, timeoutMs)

    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.onRemoved.addListener(onRemoved)
    chrome.tabs.get(tabId).then(consider).catch(() => finish(undefined))
  })
}

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = decisionQueue.then(task, task)
  decisionQueue = run.then(() => undefined, () => undefined)
  return run
}

async function withTimeout<T>(task: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | undefined> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let result: T | undefined
  try {
    result = await Promise.race([
      task(controller.signal),
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => {
          timedOut = true
          controller.abort()
          resolve(undefined)
        }, ms)
      }),
    ])
    return result
  } catch (error) {
    Logger.log('模型调用失败', error)
    return undefined
  } finally {
    if (timer) clearTimeout(timer)
    if (timedOut && result === undefined) discardSession()
  }
}

function clip(value: string, max: number): string {
  const chars = Array.from(value)
  if (chars.length <= max) return value
  return chars.slice(0, max).join('')
}
