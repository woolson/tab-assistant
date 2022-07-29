/**
 * Features
 * 1. 分组排序 ✅
 * 2. 兜底使用按域名分组，支持配置域名别名 ✅
 * 3. 允许分组快照，并在启动时提醒是否恢复
 * 
 * 配置页面
 * 1. 规则管理
 *    1.1 增加规则
 *    1.2 规则排序
 */

import { EventNames } from "../../common/const"
import { Logger } from "./helpers"
import { MatchTypeEnum, NameMap, RuleItem } from "./types"

interface Groups {
  [key: string]: Partial<chrome.tabGroups.TabGroup> & { tabIds: Set<number>, index: number }
}

/** 标签助理类 */
class TabAssistant {
  /** 当前所有的分组 */
  groups: Groups = {}

  /** 域名名称映射 */
  domainMap: NameMap = {}

  /** 规则组 */
  rules: RuleItem[] = []

  constructor(rules: RuleItem[], domainMap: NameMap) {
    this.rules = rules
    this.domainMap = domainMap
    this.groups = rules.reduce((prev, rule) => {
      prev[rule.groupTitle] = {
        title: rule.groupTitle,
        color: rule.groupColor,
        index: rule.sortIndex,
        tabIds: new Set(),
      }
      return prev
    }, {} as Groups)

    Logger.log('rule groups', JSON.parse(JSON.stringify(this.groups)))

    this.bootstrap()

    /** 页面自动进入分组 */
    chrome.tabs.onRemoved.addListener(this.onTabRemoved.bind(this))
    chrome.tabs.onUpdated.addListener(this.onTabAdded.bind(this))
    chrome.tabGroups.onRemoved.addListener(this.onGroupRemoved.bind(this))
    chrome.tabGroups.onUpdated.addListener(this.onGroupUpdated.bind(this))
  }

  /** 主程序 */
  async bootstrap() {
    const currentWindow = await chrome.windows.getCurrent()
    /** 当前已存在的分组 */
    const existGroups = await chrome.tabGroups.query({ windowId: currentWindow.id })
    existGroups.forEach(group => {
      const ruleGroup = this.groups[group.title as string]
      if (ruleGroup) {
        this.groups[group.title as string] = Object.assign(this.groups[group.title as string], { id: group.id })
      } else {
        this.groups[group.title as string] = Object.assign({}, group, {
          tabIds: new Set<number>(),
          index: -1,
        })
      }
    })
    Logger.log('bootstrap groups', JSON.parse(JSON.stringify(this.groups)))

    /** 当前窗口所有的标签 */
    const tabs = await chrome.tabs.query({ currentWindow: true })
    Logger.log('tabs', tabs)

    /** 将标签页进行分组更新 */
    for (const tab of tabs) {
      const tabInfo = await chrome.tabs.get(tab.id as number)
      this.addTabToGroup(tabInfo.id as number, tabInfo.url as string)
    }

    /** 根据分组进行创建分组，并移到分组里面 */
    for (const { title = '', color, tabIds, index, id } of this.getSortedGroups()) {
      let groupId = id
      if (tabIds.size) {
        Logger.log('bootstrap insert', title, index)
        /**
         * 获取Tab所属group
         */

        if (groupId) {
          const tabs = (await Promise.all(Array.from(tabIds).map(tabId => chrome.tabs.get(tabId))))
            .filter(tabInfo => tabInfo.groupId !== id)
          if (tabs.length) {
            chrome.tabs.group({ groupId, tabIds: Array.from(tabIds) })
          }
        } else {
          groupId = await chrome.tabs.group({ tabIds: Array.from(tabIds) })
          this.groups[title].id = groupId
        }
        await chrome.tabGroups.update(groupId, { title, color })
        Logger.log('bootstrap index', title, this.getGroupIndex(index, title))
        await chrome.tabGroups.move(groupId, { index: this.getGroupIndex(index, title) })
      }
    }

    Logger.log('last groups', JSON.parse(JSON.stringify(this.groups)))
  }

  /**
   * 获取Group要移动的位置
   * @param sortIndex group所在位置索引或分组的名称
   */
  getGroupIndex(sortIndex: number, groupTitle: string) {
    Logger.log('getGroupIndex one', groupTitle, sortIndex)
    /** 排序后的分组列表 */
    const sortedGroups = this.getSortedGroups()
    /** 有固定排序分组 */
    const topGroups = sortedGroups.filter(o => o.id && o.index >= 0)

    if (sortIndex === -1) {
      const randomGroupIndex = sortedGroups.findIndex(o => {
        if (o.index >= 0) return false
        else return (o.title as string) > groupTitle
      })
      if (randomGroupIndex === -1) return -1
      Logger.log('getGroupIndex two', groupTitle, randomGroupIndex)
      return sortedGroups
        .slice(0, randomGroupIndex - 1)
        .reduce((prev, next) => prev + next.tabIds.size, 0)
    } else {
      const prevGroups = topGroups
        .filter(o => o.index < sortIndex)
      Logger.log('getGroupIndex three', groupTitle, prevGroups)
      return prevGroups.reduce((prev, next) => prev + next.tabIds.size, 0)
    }
  }

  /**
   * 获取所在的排序
   */
  getSortedGroups() {
    const groupList = Object.values(this.groups)
    groupList.sort((prev, next) => {
      if (prev.index === -1 && next.index === -1) {
        return (prev.title as string) > (next.title as string) ? 1 : -1
      } else if (prev.index === -1) {
        return 1
      } else if (next.index === -1) {
        return -1
      } else {
        return prev.index - next.index
      }
    })
    Logger.log('sorted group', groupList)

    return groupList
  }

  /** 将标签添加到group */
  async addTabToGroup(tabId: number, url: string, syncToBrowser = false) {
    const { groupTitle, groupColor, sortIndex } = this.getGroupTitleByUrl(url)

    Logger.log('匹配到的存在的组1', url, groupTitle, JSON.parse(JSON.stringify(this.groups)))

    const groupInfo = this.groups[groupTitle]

    if (groupInfo) {
      Logger.log('匹配到的存在的组1', groupInfo.id)
      this.groups[groupTitle].tabIds.add(tabId)

      if (syncToBrowser) {
        const groupId = await chrome.tabs.group({
          groupId: groupInfo.id,
          tabIds: tabId
        })
        Logger.log('匹配到的存在的组2', groupId)
        if (!groupInfo.id) {
          this.groups[groupTitle].id = groupId
          Logger.log('匹配到的存在的组3')
          await chrome.tabGroups.update(groupId, {
            title: groupInfo.title,
            collapsed: groupInfo.collapsed,
            color: groupInfo.color
          })
          Logger.log('匹配到的存在的组4')
          await chrome.tabGroups.move(groupId, {
            index: this.getGroupIndex(groupInfo.index, groupTitle)
          })
        }
      }
    } else {
      Logger.log('匹配到不存在的组')
      this.groups[groupTitle] = {
        collapsed: false,
        title: groupTitle,
        color: groupColor,
        tabIds: new Set([tabId]),
        index: sortIndex ?? -1
      }

      if (syncToBrowser) {
        const groupId = await chrome.tabs.group({ tabIds: tabId })
        this.groups[groupTitle].id = groupId

        const { title, color, index, collapsed } = this.groups[groupTitle]
        Logger.log('匹配到的组2', this.groups[groupTitle])
        await chrome.tabGroups.update(groupId, { title, collapsed, color })

        chrome.tabGroups.move(groupId, { index: this.getGroupIndex(index, groupTitle) })
      }
    }
    return this.groups[groupTitle]
  }

  /**
   * 根据URL获取所在分组名称，默认使用域名
   */
  getGroupTitleByUrl(url: string) {
    const { host } = new URL(url)

    const rules = this.rules.slice(0).sort((a, b) => b.priority - a.priority)

    Logger.log('sorted rules', rules);

    /** 匹配规则 */
    for (const rule of rules) {
      // 使用域名全匹配
      if (rule.matchType === MatchTypeEnum.Domain && host === rule.matchContent) {
        return rule
        // 使用正则进行页面匹配
      } else if (rule.matchType === MatchTypeEnum.RegExp) {
        const reg = new RegExp(rule.matchContent)
        if (reg.test(url)) return rule
      }
    }
    /** 按domain获取名称 */
    return {
      groupTitle: this.domainMap[host] || host,
      groupColor: undefined,
      sortIndex: -1
    }
  }

  /**
   * 标签添加时进行移动
   */
  onTabAdded(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
    if (changeInfo.url) {
      Logger.log('对标签添加到分组', changeInfo.url)
      this.addTabToGroup(tabId, changeInfo.url as string, true)
    }
  }

  /** 标签移除时更新数据 */
  onTabRemoved(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) {
    for (const group of this.getSortedGroups()) {
      if (group.tabIds.has(tabId)) {
        Logger.log('onTabRemove', group.title, tabId)
        const tabIds = new Set(group.tabIds)
        tabIds.delete(tabId)
        this.groups[group.title ?? ''].tabIds = tabIds
      }
    }
  }

  /** 分组移除时更新数据 */
  onGroupRemoved(group: chrome.tabGroups.TabGroup) {
    const groupTitle = this.getSortedGroups().find(o => o.title === group.title)?.title
    Logger.log('onGroupRemove', group, groupTitle, JSON.parse(JSON.stringify(this.groups)))
    if (groupTitle) this.groups[groupTitle].id = undefined
  }

  /** 分组更新时更新分组数据 */
  onGroupUpdated(group: chrome.tabGroups.TabGroup) {
    const groupTitle = this.getSortedGroups().find(o => o.title === group.title)?.title
    Logger.log('onGroupUpdated', group, groupTitle, JSON.parse(JSON.stringify(this.groups)))
    if (groupTitle) {
      this.groups[groupTitle] = {
        ...this.groups[groupTitle],
        title: group.title,
        color: group.color,
        id: group.id,
        collapsed: group.collapsed
      }
    }
  }
}

/** 规则组 */
// const Rules: RuleItem[] = [
//   {
//     name: '谷歌Chrome开发者',
//     groupTitle: '谷歌开发者',
//     matchType: MatchTypeEnum.Domain,
//     matchContent: 'https://developer.chrome.com',
//     sortIndex: 1,
//   },
//   {
//     name: '知乎',
//     groupTitle: '知乎',
//     matchType: MatchTypeEnum.RegExp,
//     matchContent: 'zhihu.com',
//     sortIndex: 2,
//   },
//   {
//     name: 'GitHub',
//     groupTitle: 'GitHub',
//     groupColor: 'cyan',
//     matchType: MatchTypeEnum.RegExp,
//     matchContent: 'github.com',
//     sortIndex: 3,
//   }
// ]

async function main() {
  const rules = await chrome.storage.sync
    .get('TAB_ASSISTANT_RULES')

  /** 启动 */
  const assistant = new TabAssistant(rules['TAB_ASSISTANT_RULES'] || [], {})
  Logger.log('assistant ins', assistant)
};

main();

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  await main();
  sendResponse(EventNames.ReloadSucc)
})