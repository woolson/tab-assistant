export const START_AI_REGROUP_MESSAGE = 'ta:start-ai-regroup-all'
export const AI_REGROUP_STATUS_MESSAGE = 'ta:ai-regroup-status'
export const AI_REGROUP_JOB_KEY = 'TA_AI_REGROUP_JOB'

export interface AiRegroupJob {
  id: string
  state: 'running' | 'completed' | 'interrupted' | 'failed'
  total: number
  completed: number
  skipped: number
  failed: number
  startedAt: number
  finishedAt?: number
  stopReason?: 'api-failures'
}

export type AiRegroupError = 'disabled' | 'not-configured' | 'permission' | 'invalid-url' | 'unexpected'
export type AiRegroupResponse = { ok: true; job?: AiRegroupJob } | { ok: false; error: AiRegroupError }

export function readAiRegroupJob(value: unknown): AiRegroupJob | undefined {
  if (!value || typeof value !== 'object') return undefined
  const job = value as AiRegroupJob
  if (typeof job.id !== 'string' || !['running', 'completed', 'interrupted', 'failed'].includes(job.state)) return undefined
  if (![job.total, job.completed, job.skipped, job.failed].every(count => Number.isInteger(count) && count >= 0)) return undefined
  if (job.completed > job.total || job.skipped + job.failed > job.completed || !Number.isFinite(job.startedAt)) return undefined
  return job
}

/** 启动消息只等待任务建立，逐页处理由后台继续执行。 */
export function requestAiRegroup(type: typeof START_AI_REGROUP_MESSAGE | typeof AI_REGROUP_STATUS_MESSAGE): Promise<AiRegroupResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) { reject(new Error('unavailable')); return }
    chrome.runtime.sendMessage({ type }, (response: AiRegroupResponse | undefined) => {
      if (chrome.runtime.lastError || !response || typeof response.ok !== 'boolean') reject(new Error('unavailable'))
      else resolve(response)
    })
  })
}
