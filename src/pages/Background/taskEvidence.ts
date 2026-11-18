import type { PageContent } from '../../common/pageContent'
import type { GroupSnapshot } from './aiAutoGroupDecision'
import { cleanTaskText } from '../../common/taskText'

export interface TaskMatchEvidence {
  basis: 'same-task'
  targetEvidence: string
  groupEvidence: string
}

/** 平台、入口和加载状态本身不能证明任务相同。 */
const GENERIC_LABELS = new Set([
  '文档', '文档首页', '在线文档', '云文档', '钉钉', '钉钉文档', '飞书', '飞书文档', '飞书云文档', '语雀',
  '首页', '主页', '工作台', '研发平台', '发布平台', '搜索', '搜索结果', '新标签页', '正在加载', '加载中', '无标题',
  'docs', 'document', 'documents', 'documentation', 'dingtalk', 'lark', 'feishu', 'yuque',
  'notion', 'confluence', 'github', 'gitlab', 'wap', 'aone', 'google docs', 'google', 'bing', '百度',
  'home', 'homepage', 'dashboard', 'workspace', 'search', 'search results', 'new tab', 'loading', 'untitled',
  '日常', '预发', '线上', '生产环境', '测试环境', '开发环境', '代码构建', '产物部署', '部署流程', '发布流程', '待发布的迭代',
  'daily', 'staging', 'production', 'development', 'testing', 'pre-production', 'prod', 'test', 'uat',
])

function normalize(value: string): string {
  return cleanTaskText(value).normalize('NFKC').toLowerCase()
}

/** 只去掉通用入口和平台后缀；不按域名或业务关键词决定归组。 */
export function specificTaskText(value: string): string {
  return normalize(value).split(/\s*[·•|｜]\s*|\s+[-–—]\s+/)
    .filter(part => part && !GENERIC_LABELS.has(part)
      && !/^v?\d+(?:[._-]\d+)*$/i.test(part)
      && !/^(?:https?:\/\/|www\.)/i.test(part)
      && !/^(?:[a-z0-9-]+\.)+[a-z]{2,}\/?$/i.test(part))
    .join(' ')
}

export function parseTaskMatch(value: unknown): TaskMatchEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.basis !== 'same-task') return undefined
  const targetEvidence = quote(record.targetEvidence)
  const groupEvidence = quote(record.groupEvidence)
  return targetEvidence && groupEvidence ? { basis: 'same-task', targetEvidence, groupEvidence } : undefined
}

/** 双侧引文必须来自实际任务文本，网址、来源页和目标页自身不能充当组内证据。 */
export function hasGroundedTaskMatch(
  match: TaskMatchEvidence | undefined,
  target: { url: string; title: string; query?: string; content?: PageContent },
  group: GroupSnapshot,
): boolean {
  if (!match) return false
  const contentTexts = (content?: PageContent) => [content?.title || '', content?.description || '',
    ...(content?.headings || []), content?.excerpt || '', ...(content?.context || [])]
  const targetTexts = [target.title, target.query || '', ...contentTexts(target.content)]
  const groupTexts = [group.title, ...group.tabs.filter(tab => tab.url !== target.url)
    .flatMap(tab => [tab.title, ...contentTexts(tab.content)])]
  return grounded(match.targetEvidence, targetTexts) && grounded(match.groupEvidence, groupTexts)
}

function grounded(evidence: string, texts: string[]): boolean {
  const meaningful = specificTaskText(evidence)
  return Boolean(meaningful && texts.some(text => {
    // 先核对完整引文，再核对其中的任务文本，防止只凭平台后缀匹配。
    return normalize(text).includes(normalize(evidence)) && specificTaskText(text).includes(meaningful)
  }))
}

function quote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = cleanTaskText(value)
  if (Array.from(text).length > 160) return undefined
  return text || undefined
}
