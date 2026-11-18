import { AiApiError, aiApiEndpoint, hasAiApiPermission } from '../../common/aiApi'
import { AI_REGROUP_JOB_KEY, readAiRegroupJob, type AiRegroupJob } from '../../common/aiRegroup'
import { regroupTabWithAi, type AiGroupingHost } from './aiAutoGroup'
import { Logger } from './helpers'

export interface AiRegroupAllHost extends AiGroupingHost {
  isAiGroupingEnabled(): boolean
  prepareFullRegroup(tabIds: number[], startedAt: number): void
  finishFullRegroup(): void
}

let activeJob: AiRegroupJob | undefined
let starting: Promise<AiRegroupJob> | undefined

async function persist(job: AiRegroupJob) {
  await chrome.storage.local.set({ [AI_REGROUP_JOB_KEY]: { ...job } })
}

export async function getAiRegroupJob(): Promise<AiRegroupJob | undefined> {
  if (activeJob) return { ...activeJob }
  const stored = await chrome.storage.local.get(AI_REGROUP_JOB_KEY)
  return readAiRegroupJob(stored[AI_REGROUP_JOB_KEY])
}

/** Worker 重启后显式标记中断；不能在未再次确认 token 消耗时自动重跑。 */
export async function recoverAiRegroupJob() {
  const job = await getAiRegroupJob()
  if (job?.state === 'running' && !activeJob) {
    await persist({ ...job, state: 'interrupted', finishedAt: Date.now() })
  }
}

export async function startAiRegroupAll(host: AiRegroupAllHost): Promise<AiRegroupJob> {
  if (starting) return starting
  if (activeJob?.state === 'running') return { ...activeJob }
  const startedAt = Date.now()
  starting = begin(host, startedAt)
  try { return await starting }
  finally { starting = undefined }
}

async function begin(host: AiRegroupAllHost, startedAt: number): Promise<AiRegroupJob> {
  if (!host.isAiGroupingEnabled() || host.isDisposed()) throw new Error('disabled')
  const config = host.getAiApiConfig?.()
  if (!config?.apiKey || !config.model) throw new AiApiError('not-configured')
  aiApiEndpoint(config)
  if (!await hasAiApiPermission(config)) throw new AiApiError('permission')
  const tabs = (await chrome.tabs.query({})).filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined)
  const tabIds = tabs.map(tab => tab.id)
  if (host.isDisposed()) throw new Error('disabled')
  const job: AiRegroupJob = {
    id: `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    state: 'running', total: tabIds.length, completed: 0, skipped: 0, failed: 0, startedAt,
  }
  await persist(job)
  activeJob = job
  host.prepareFullRegroup(tabIds, startedAt)
  void run(host, tabs, job).catch(error => Logger.log('全量 AI 分组任务状态保存失败', error))
  return { ...job }
}

async function run(host: AiRegroupAllHost, tabs: Array<chrome.tabs.Tab & { id: number }>, job: AiRegroupJob) {
  let consecutiveFailures = 0
  try {
    for (const tab of tabs) {
      if (host.isDisposed()) { job.state = 'interrupted'; break }
      try {
        const outcome = await regroupTabWithAi(host, tab.id, tab)
        if (outcome === 'skipped') job.skipped++
        if (outcome === 'failed') job.failed++
        if (outcome === 'failed') consecutiveFailures++
        else if (outcome === 'processed') consecutiveFailures = 0
      } catch (error) {
        job.failed++
        consecutiveFailures++
        Logger.log('全量 AI 分组：处理标签失败', tab.id, error)
      }
      job.completed++
      await persist(job)
      if (consecutiveFailures >= 3) { job.state = 'failed'; job.stopReason = 'api-failures'; break }
    }
    if (job.state === 'running') job.state = host.isDisposed() ? 'interrupted' : 'completed'
  } catch (error) {
    job.state = 'failed'
    Logger.log('全量 AI 分组失败', error)
  } finally {
    host.finishFullRegroup()
    job.finishedAt = Date.now()
    await persist(job)
  }
}
