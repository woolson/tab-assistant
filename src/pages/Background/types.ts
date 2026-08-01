export type GroupColorEnum = chrome.tabGroups.ColorEnum
export type Language = 'zh-CN' | 'en-US'
export type ThemeMode = 'system' | 'light' | 'dark'
export type ToolbarEntryMode = 'popup' | 'sidepanel'

/** 规则信息 */
export interface RuleItem {
  key?: string | number;
  /** 规则Id */
  ruleId: string
  /** 规则名称 */
  name: string
  /** 分组名称，默认和规则保持一致 */
  groupTitle: string
  /** 分组优先级 */
  priority: number
  /** 分组颜色 */
  groupColor?: GroupColorEnum
  /** 匹配模式 */
  matchType: MatchTypeEnum
  /** 匹配规则内容 */
  matchContent: string
  /** 分组所在排序 */
  sortIndex: number
}

export interface NameMap {
  [key: string]: string
}

/** 匹配模式 */
export enum MatchTypeEnum {
  /** 域名匹配 */
  Domain,
  /** 正则匹配 */
  RegExp,
}

/** 标签分组 */
export interface Groups {
  [key: string]: Partial<chrome.tabGroups.TabGroup> & { tabIds: Set<number>, index: number, windowId?: number }
}

/** 配置项 */
export interface TabAssistantConfig {
  /** 分组规则 */
  rules: RuleItem[]
  /** 给域名设置别名 */
  domainMap?: NameMap
  /** 设置 */
  setting: {
    /**
     * 移除www.次级域名
     * @deprecated
     */
    remove3w: boolean
    /**
     * 移除域名中的关键字
     */
    removeKeywordList: string[]
    /**
     * 弹窗界面语言
     */
    language?: Language
    /**
     * 弹窗界面主题
     */
    theme?: ThemeMode
    /**
     * 点击浏览器工具栏图标时打开的界面
     */
    toolbarEntry?: ToolbarEntryMode
  }
}
