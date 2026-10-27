/**
 * `@types/chrome` 0.0.177 早于 `chrome.scripting.registerContentScripts`
 * （Chrome 96 引入），这里只补齐本项目用到的这几个成员。
 * 不影响运行时，仅用于类型检查。
 */
declare namespace chrome.scripting {
  export interface RegisteredContentScript {
    id: string
    matches?: string[]
    excludeMatches?: string[]
    js?: string[]
    css?: string[]
    allFrames?: boolean
    runAt?: 'document_start' | 'document_end' | 'document_idle'
    world?: 'ISOLATED' | 'MAIN'
    persistAcrossSessions?: boolean
  }

  export interface ContentScriptFilter {
    ids?: string[]
  }

  export function registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>
  export function getRegisteredContentScripts(filter?: ContentScriptFilter): Promise<RegisteredContentScript[]>
  export function updateContentScripts(scripts: RegisteredContentScript[]): Promise<void>
  export function unregisterContentScripts(filter?: ContentScriptFilter): Promise<void>
}
