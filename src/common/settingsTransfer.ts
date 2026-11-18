import { EventNameEnum, StorageKeyEnum } from './const'
import type { RuleItem, TabAssistantConfig } from '../pages/Background/types'

type Settings = TabAssistantConfig['setting']
export interface SettingsBackup {
  TAB_ASSISTANT_RULES?: RuleItem[]
  TA_SETTING?: Partial<Settings>
}
export const MAX_SETTINGS_IMPORT_BYTES = 1024 * 1024
export type SettingsTransferErrorCode = 'json' | 'format' | 'regexp' | 'size' | 'read' | 'save' | 'apply'
export class SettingsTransferError extends Error {
  readonly code: SettingsTransferErrorCode
  readonly field: string
  constructor(code: SettingsTransferErrorCode, field = '') {
    super(code)
    Object.setPrototypeOf(this, SettingsTransferError.prototype)
    this.name = 'SettingsTransferError'
    this.code = code
    this.field = field
  }
}

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())
const invalid = (field: string): never => { throw new SettingsTransferError('format', field) }

/** Validate completely before storage or browser grouping can be changed. */
export function parseSettingsBackup(source: string): SettingsBackup {
  let data: unknown
  try { data = JSON.parse(source.replace(/^\ufeff/, '')) } catch { throw new SettingsTransferError('json') }
  if (!record(data) || !own(data, StorageKeyEnum.RULES) && !own(data, StorageKeyEnum.SETTING)) return invalid('JSON')
  const result: SettingsBackup = {}
  if (own(data, StorageKeyEnum.RULES)) {
    const rules = data[StorageKeyEnum.RULES]
    if (!Array.isArray(rules)) return invalid(StorageKeyEnum.RULES)
    const ids = new Set<string>()
    result.TAB_ASSISTANT_RULES = rules.map((rule, index): RuleItem => {
      const path = `${StorageKeyEnum.RULES}[${index}]`
      if (!record(rule)) return invalid(path)
      const name = text(rule.name) ? rule.name : rule.groupTitle
      const groupTitle = text(rule.groupTitle) ? rule.groupTitle : name
      if (!text(name)) return invalid(`${path}.name`)
      if (!text(groupTitle) || ['__proto__', 'constructor', 'prototype'].includes(groupTitle)) return invalid(`${path}.groupTitle`)
      if (!text(rule.matchContent)) return invalid(`${path}.matchContent`)
      if (rule.matchType !== 0 && rule.matchType !== 1) return invalid(`${path}.matchType`)
      if (rule.matchType === 1) {
        try { new RegExp(rule.matchContent) } catch { throw new SettingsTransferError('regexp', `${path}.matchContent`) }
      }
      if (rule.priority !== undefined && (typeof rule.priority !== 'number' || !Number.isFinite(rule.priority))) return invalid(`${path}.priority`)
      const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan']
      if (rule.groupColor !== undefined && (typeof rule.groupColor !== 'string' || !colors.includes(rule.groupColor))) return invalid(`${path}.groupColor`)
      let ruleId = text(rule.ruleId) && !ids.has(rule.ruleId) ? rule.ruleId : `imported-rule-${index}`
      while (ids.has(ruleId)) ruleId += '-import'
      ids.add(ruleId)
      return {
        ruleId, name, groupTitle, matchType: rule.matchType, matchContent: rule.matchContent,
        priority: typeof rule.priority === 'number' ? rule.priority : 0, sortIndex: index,
        ...(rule.groupColor !== undefined ? { groupColor: rule.groupColor as RuleItem['groupColor'] } : {}),
      }
    })
  }
  if (own(data, StorageKeyEnum.SETTING)) {
    const settings = data[StorageKeyEnum.SETTING]
    if (!record(settings)) return invalid(StorageKeyEnum.SETTING)
    const next: Partial<Settings> = {}
    const enums = { language: ['zh-CN', 'en-US'], theme: ['system', 'light', 'dark'], toolbarEntry: ['popup', 'sidepanel'], quickSearchMaterial: ['classic', 'frosted', 'liquid'] }
    for (const key of Object.keys(enums) as Array<keyof typeof enums>) {
      if (!own(settings, key)) continue
      if (typeof settings[key] !== 'string' || !enums[key].includes(settings[key] as string)) return invalid(`${StorageKeyEnum.SETTING}.${key}`)
      Object.assign(next, { [key]: settings[key] })
    }
    for (const key of ['remove3w', 'autoCloseEnabled', 'aiAutoGroupEnabled', 'decisionLogEnabled', 'rememberClickSource'] as const) {
      if (!own(settings, key)) continue
      if (typeof settings[key] !== 'boolean') return invalid(`${StorageKeyEnum.SETTING}.${key}`)
      next[key] = settings[key] as boolean
    }
    if (own(settings, 'removeKeywordList')) {
      if (!Array.isArray(settings.removeKeywordList) || settings.removeKeywordList.some(value => typeof value !== 'string')) return invalid(`${StorageKeyEnum.SETTING}.removeKeywordList`)
      next.removeKeywordList = [...settings.removeKeywordList]
    }
    if (own(settings, 'autoCloseMinutes')) {
      if (typeof settings.autoCloseMinutes !== 'number' || !Number.isFinite(settings.autoCloseMinutes) || settings.autoCloseMinutes < 1) return invalid(`${StorageKeyEnum.SETTING}.autoCloseMinutes`)
      next.autoCloseMinutes = settings.autoCloseMinutes
    }
    for (const [key, min, max] of [['quickSearchTransparency', 20, 80], ['quickSearchBlur', 8, 40]] as const) {
      if (!own(settings, key)) continue
      const value = settings[key]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return invalid(`${StorageKeyEnum.SETTING}.${key}`)
      next[key] = value
    }
    result.TA_SETTING = next
  }
  return result
}

/** The picker and File.text() run in a persistent extension tab or side panel. */
export function chooseSettingsFile(): Promise<File | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.hidden = true
    const done = (file?: File) => { input.remove(); resolve(file) }
    input.addEventListener('change', () => done(input.files?.[0]), { once: true })
    input.addEventListener('cancel', () => done(), { once: true })
    document.body.appendChild(input)
    try { input.click() } catch { input.remove(); reject(new SettingsTransferError('read')) }
  })
}

export async function openSettingsImportPage(surface: 'popup' | 'sidepanel', search: string): Promise<boolean> {
  if (surface !== 'popup' || new URLSearchParams(search).get('transfer') === 'import') return false
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL || !chrome.tabs?.create) return false
  await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?page=about&transfer=import'), active: true })
  return true
}

function waitForSettingsReload(): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = () => reject(new SettingsTransferError('apply'))
    const timer = setTimeout(failed, 30_000)
    try {
      chrome.runtime.sendMessage(EventNameEnum.RELOAD_RULE, response => {
        clearTimeout(timer)
        if (chrome.runtime.lastError || response !== EventNameEnum.RELOAD_SUCC) failed()
        else resolve()
      })
    } catch { clearTimeout(timer); failed() }
  })
}

export async function importSettingsText(source: string): Promise<SettingsBackup> {
  const imported = parseSettingsBackup(source)
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) throw new SettingsTransferError('save')
  const changes: SettingsBackup = { ...imported }
  try {
    if (imported.TA_SETTING) {
      const stored = await chrome.storage.sync.get(StorageKeyEnum.SETTING)
      changes.TA_SETTING = { ...(record(stored.TA_SETTING) ? stored.TA_SETTING : {}), ...imported.TA_SETTING }
    }
    await chrome.storage.sync.set(changes)
  } catch { throw new SettingsTransferError('save') }
  await waitForSettingsReload()
  return changes
}

export async function importSettingsFile(file: Pick<File, 'size' | 'text'>): Promise<SettingsBackup> {
  if (file.size > MAX_SETTINGS_IMPORT_BYTES) throw new SettingsTransferError('size')
  let source: string
  try { source = await file.text() } catch { throw new SettingsTransferError('read') }
  return importSettingsText(source)
}
