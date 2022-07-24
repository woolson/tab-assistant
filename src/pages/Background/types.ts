export type GroupColorEnum = chrome.tabGroups.ColorEnum

/** 规则信息 */
export interface RuleItem {
  /** 规则名称 */
  name: string
  /** 分组名称，默认和规则保持一致 */
  groupTitle: string
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