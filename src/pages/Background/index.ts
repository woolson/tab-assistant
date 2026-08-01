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

import { EventNameEnum, StorageKeyEnum } from "../../common/const"
import { Logger } from "./helpers"
import { MatchTypeEnum, NameMap, RuleItem, Groups, TabAssistantConfig } from "./types"
import { cloneDeep, remove } from 'lodash-es'

const LOCAL_FILE_GROUP_TITLES: Record<NonNullable<TabAssistantConfig['setting']['language']>, string> = {
  'zh-CN': '本地文件',
  'en-US': 'Local file',
}

/** 标签助理类 */
class TabAssistant {
  /** 当前所有的分组 */
  groups: {
    [windowId: number]: Groups
  } = {}

  /** 域名名称映射 */
  domainMap: NameMap = {}

  /** 规则组 */
  rules: RuleItem[] = []

  /** 设置 */
  setting: TabAssistantConfig['setting'] = {
    remove3w: false,
    removeKeywordList: []
  }

  private readonly tabCreatedListener = this.onTabCreated.bind(this)
  private readonly tabRemovedListener = this.onTabRemoved.bind(this)
  private readonly tabUpdatedListener = this.onTabAdded.bind(this)
  private readonly groupRemovedListener = this.onGroupRemoved.bind(this)
  private readonly groupUpdatedListener = this.onGroupUpdated.bind(this)

  constructor(config: TabAssistantConfig) {
    Logger.log('初始化_扩展配置', config)

    this.rules = config.rules || []
    if (config.domainMap) this.domainMap = config.domainMap
    this.setting = Object.assign(this.setting, config.setting || {})

    Logger.log('初始化_分组信息', cloneDeep(this.groups))

    /** 页面自动进入分组 */
    chrome.tabs.onCreated.addListener(this.tabCreatedListener)
    chrome.tabs.onRemoved.addListener(this.tabRemovedListener)
    chrome.tabs.onUpdated.addListener(this.tabUpdatedListener)
    chrome.tabGroups.onRemoved.addListener(this.groupRemovedListener)
    chrome.tabGroups.onUpdated.addListener(this.groupUpdatedListener)
  }

  /** 配置重载时移除旧实例监听，避免同一个事件被重复处理。 */
  dispose() {
    chrome.tabs.onCreated.removeListener(this.tabCreatedListener)
    chrome.tabs.onRemoved.removeListener(this.tabRemovedListener)
    chrome.tabs.onUpdated.removeListener(this.tabUpdatedListener)
    chrome.tabGroups.onRemoved.removeListener(this.groupRemovedListener)
    chrome.tabGroups.onUpdated.removeListener(this.groupUpdatedListener)
  }

  /** 主程序 */
  async bootstrap() {
    const windows = await chrome.windows.getAll()
    if (!windows.length) return

    await Promise.all(windows.map(async window => {
      if (!window.id) return
      this.groups[window.id] = this.rules.reduce((prev, rule) => {
        prev[rule.groupTitle] = {
          title: rule.groupTitle,
          color: rule.groupColor,
          index: rule.sortIndex,
          tabIds: new Set(),
          windowId: window.id
        }
        return prev
      }, {} as Groups)

      /** 当前已存在的分组 */
      const existGroups = await chrome.tabGroups.query({ windowId: window.id })
      /** 当前窗口的分组 */
      const currentWindowGroups = this.getGroupsByWindowId({ windowId: window.id })
      existGroups.forEach(group => {
        if (!group.title) return;
        // 如果已经有同名的分组，直接复用该分组
        const ruleGroup = currentWindowGroups[group.title]
        if (ruleGroup) {
          currentWindowGroups[group.title] = {
            ...ruleGroup,
            id: group.id,
            windowId: window.id
          }
        } else {
          currentWindowGroups[group.title] = {
            ...group,
            tabIds: new Set<number>(),
            index: -1,
            windowId: window.id
          }
        }
      })
      Logger.log('bootstrap groups', cloneDeep(this.groups))

      /** 当前窗口所有的标签 */
      const tabs = await chrome.tabs.query({ windowId: window.id })
      const tabsById = new Map(tabs
        .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === 'number')
        .map(tab => [tab.id, tab]))
      Logger.log('tabs', tabs)

      /** query 已返回完整标签信息，直接复用，避免冷启动时逐个再次读取。 */
      tabs.forEach(tab => this.addTabToGroup(tab, false))

      /** 当前窗口排序后的分组 */
      const currentWindowSortedGroups = this.getSortedGroups(window.id)
      /** 根据分组进行创建分组，并移到分组里面 */
      for (const groupInfo of currentWindowSortedGroups) {
        let groupId = groupInfo.id
        if (groupInfo.tabIds?.size) {
          Logger.log('初始化标签分组', groupInfo.title, groupInfo.index)
          // 获取Tab所属group
          if (groupId !== undefined) {
            const hasUngroupedTab = Array.from(groupInfo.tabIds)
              .some(tabId => tabsById.get(tabId)?.groupId !== groupId)
            if (hasUngroupedTab) {
              groupId = await this.groupTabsInWindow({
                groupId,
                tabIds: Array.from(groupInfo.tabIds),
                windowId: window.id
              })
            }
          } else {
            groupId = await this.groupTabsInWindow({
              tabIds: Array.from(groupInfo.tabIds),
              windowId: window.id
            })
          }
          currentWindowGroups[groupInfo.title as string].id = groupId
          chrome.tabGroups.update(groupId, { title: groupInfo.title, color: groupInfo.color })
          chrome.tabGroups.move(groupId, {
            index: this.getGroupIndex({
              sortIndex: groupInfo.index,
              groupTitle: groupInfo.title || '',
              windowId: window.id
            })
          })
        }
      }
    }))
  }

  /**
   * 获取Group要移动的位置
   * @param sortIndex group所在位置索引或分组的名称
   */
  getGroupIndex(params: { sortIndex: number, groupTitle: string; windowId: number }) {
    Logger.log('getGroupIndex one', params.groupTitle, params.sortIndex)
    /** 排序后的分组列表 */
    const sortedGroups = this.getSortedGroups(params.windowId)
    /** 有固定排序分组 */
    const topGroups = sortedGroups.filter(o => o.id !== undefined && o.index >= 0)

    if (params.sortIndex === -1) {
      const randomGroupIndex = sortedGroups.findIndex(o => {
        if (o.index >= 0) return false
        else return (o.title as string) > params.groupTitle
      })
      Logger.log('getGroupIndex two', randomGroupIndex)
      if (randomGroupIndex === -1) return -1
      return sortedGroups
        .slice(0, randomGroupIndex - 1)
        .reduce((prev, next) => prev + (next.tabIds?.size || 0), 0)
    } else {
      const prevGroups = topGroups
        .filter(o => o.index < params.sortIndex)
      Logger.log('getGroupIndex three', prevGroups)
      return prevGroups.reduce((prev, next) => prev + (next.tabIds?.size || 0), 0)
    }
  }

  /**
   * 获取所在的排序
   */
  getSortedGroups(windowId: number) {
    const groupList = Object.values(this.getGroupsByWindowId({ windowId }))
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
    Logger.log('排序后的分组', groupList)

    return groupList
  }

  /**
   * 将标签加入指定窗口内的分组。
   * 新建分组时必须显式传入 windowId，否则 Chrome 会默认在当前窗口创建分组，
   * 并将来自其他窗口的标签移动到当前窗口。
   */
  async groupTabsInWindow(params: {
    tabIds: number | number[];
    windowId: number;
    groupId?: number;
  }) {
    let groupId = params.groupId

    if (groupId !== undefined) {
      try {
        const browserGroup = await chrome.tabGroups.get(groupId)
        if (browserGroup.windowId === params.windowId) {
          return chrome.tabs.group({
            groupId,
            tabIds: params.tabIds
          })
        }
        Logger.log('分组窗口不匹配，改为在Tab所在窗口创建分组', {
          groupId,
          groupWindowId: browserGroup.windowId,
          tabWindowId: params.windowId
        })
      } catch (error) {
        Logger.log('分组不存在，改为在Tab所在窗口创建分组', groupId, error)
      }
    }

    return chrome.tabs.group({
      tabIds: params.tabIds,
      createProperties: {
        windowId: params.windowId
      }
    })
  }

  /** 将标签添加到group */
  addTabToGroup(tabInfo: number, syncToBrowser: boolean): void
  addTabToGroup(tabInfo: chrome.tabs.Tab, syncToBrowser: boolean): void
  async addTabToGroup(tabInfoOrTabId: number | chrome.tabs.Tab, syncToBrowser = false) {
    let tabInfo: chrome.tabs.Tab = typeof tabInfoOrTabId === 'number'
      ? await chrome.tabs.get(tabInfoOrTabId)
      : tabInfoOrTabId
    if (!tabInfo.url || !tabInfo.id) return;

    this.removeTabFromGroups(tabInfo.id, tabInfo.windowId)

    const { groupTitle, groupColor, sortIndex } = this.getGroupTitleByUrl(tabInfo.url)
    const groupInfo = this.getGroupByWindowIdAndTitle({
      windowId: tabInfo.windowId,
      groupTitle
    })
    Logger.log('添加Tab到分组，Tab信息', cloneDeep(groupInfo), cloneDeep(tabInfo))

    if (groupInfo.title) {
      Logger.log('添加Tab到分组，匹配到分组')
      groupInfo.tabIds.add(tabInfo.id)

      if (syncToBrowser) {
        const previousGroupId = groupInfo.id
        const groupId = await this.groupTabsInWindow({
          groupId: groupInfo.id,
          tabIds: tabInfo.id,
          windowId: tabInfo.windowId
        })
        Logger.log('添加到分组，同步到浏览器', groupId)
        if (groupId !== previousGroupId) {
          Logger.log('添加到分组，分组不存在则更新分组相关信息', groupId)
          groupInfo.id = groupId
          await chrome.tabGroups.update(groupId, {
            title: groupInfo.title,
            collapsed: groupInfo.collapsed,
            color: groupInfo.color
          })
          await chrome.tabGroups.move(groupId, {
            index: this.getGroupIndex({
              groupTitle,
              sortIndex: groupInfo.index,
              windowId: tabInfo.windowId
            })
          })
        }
      }
    } else {
      Logger.log('添加Tab到分组，未匹配到分组')
      Object.assign(groupInfo, {
        collapsed: false,
        title: groupTitle,
        color: groupColor,
        tabIds: new Set([tabInfo.id]),
        index: sortIndex ?? -1,
        windowId: tabInfo.windowId
      })

      if (syncToBrowser) {
        const groupId = await this.groupTabsInWindow({
          tabIds: tabInfo.id,
          windowId: tabInfo.windowId
        })
        groupInfo.id = groupId

        const { title, color, index, collapsed } = groupInfo
        Logger.log('匹配不到分组', groupInfo)
        await chrome.tabGroups.update(groupId, { title, collapsed, color })

        chrome.tabGroups.move(groupId, {
          index: this.getGroupIndex({
            groupTitle,
            sortIndex: index,
            windowId: tabInfo.windowId
          })
        })
      }
    }
    return groupInfo
  }

  /**
   * 根据URL获取所在分组名称，默认使用域名
   */
  getGroupTitleByUrl(url: string) {
    const { host, protocol } = new URL(url)

    if (protocol === 'file:') {
      return {
        groupTitle: this.getLocalFileGroupTitle(),
        groupColor: undefined,
        sortIndex: -1
      }
    }

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

    let title = this.domainMap[host] || host
    if (this.setting.removeKeywordList?.length) {
      title = this.setting.removeKeywordList.reduce((prev, next) => {
        return prev.replace(next, '')
      }, title);
    }

    /** 按domain获取名称 */
    return {
      groupTitle: title,
      groupColor: undefined,
      sortIndex: -1
    }
  }

  getLocalFileGroupTitle() {
    const language = this.setting.language
    if (language && LOCAL_FILE_GROUP_TITLES[language]) {
      return LOCAL_FILE_GROUP_TITLES[language]
    }

    const browserLanguage = chrome.i18n?.getUILanguage?.() || ''
    return browserLanguage.toLowerCase().startsWith('zh')
      ? LOCAL_FILE_GROUP_TITLES['zh-CN']
      : LOCAL_FILE_GROUP_TITLES['en-US']
  }

  /**
   * 标签添加时进行移动
   */
  async onTabCreated(tab: chrome.tabs.Tab) {
    if (tab.id) {
      Logger.log('创建标签后添加到分组', tab.url)
      this.addTabToGroup(tab, true)
    }
  }

  async onTabAdded(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
    if (changeInfo.url || changeInfo.status === 'complete') {
      const tabInfo = await chrome.tabs.get(tabId)
      Logger.log('对标签添加到分组', changeInfo.url || tabInfo.url)
      this.addTabToGroup({
        ...tabInfo,
        url: changeInfo.url || tabInfo.url,
      }, true)
    }
  }

  /** 标签重新分组前，先从旧分组缓存中移除 */
  removeTabFromGroups(tabId: number, windowId: number) {
    for (const group of this.getSortedGroups(windowId)) {
      if (group.tabIds?.has?.(tabId)) {
        Logger.log('从旧分组移除Tab', group.title, tabId)
        group.tabIds.delete(tabId)
      }
    }
  }

  /** 标签移除时更新数据 */
  async onTabRemoved(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) {
    for (const group of this.getSortedGroups(removeInfo.windowId)) {
      if (group.tabIds?.has?.(tabId)) {
        Logger.log('onTabRemove', group.title, tabId)
        group.tabIds.delete(tabId)
      }
    }
  }

  /** 分组移除时更新数据 */
  onGroupRemoved(group: chrome.tabGroups.TabGroup) {
    const groupInfo = this.groups[group.windowId]?.[group.title || '']
    Logger.log('onGroupRemove', groupInfo)
    if (groupInfo?.id !== undefined && groupInfo.tabIds) {
      groupInfo.id = undefined
      groupInfo.tabIds.clear()
    }
  }

  /** 分组更新时更新分组数据 */
  onGroupUpdated(group: chrome.tabGroups.TabGroup) {
    const groupInfo = this.groups[group.windowId]?.[group.title || '']
    Logger.log('onGroupUpdated', groupInfo)
    if (groupInfo?.id !== undefined) {
      Object.assign(groupInfo, {
        title: group.title,
        color: group.color,
        id: group.id,
        collapsed: group.collapsed
      })
    }
  }

  /**
   * 获取窗口的分组信息
   */
  getGroupsByWindowId(params: { windowId: number }) {
    if (!this.groups[params.windowId]) {
      this.groups[params.windowId] = {}
    }
    return this.groups[params.windowId]
  }
  /**
   * 获取分组信息
   */
  getGroupByWindowIdAndTitle(params: { windowId: number; groupTitle: string }) {
    if (!this.groups[params.windowId]) {
      this.groups[params.windowId] = {}
    }
    if (!this.groups[params.windowId][params.groupTitle]) {
      this.groups[params.windowId][params.groupTitle] = {} as Groups[number]
    }
    return this.groups[params.windowId][params.groupTitle]
  }
}

let assistant: TabAssistant | undefined
let reloadAssistantTask: Promise<void> = Promise.resolve()

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    void chrome.storage.local.set({ [StorageKeyEnum.SIDE_PANEL_GUIDE_PENDING]: true })
    return
  }

  if (details.reason !== 'update') return

  void chrome.storage.local.get(StorageKeyEnum.SIDE_PANEL_GUIDE_PENDING).then(storage => {
    const guideState = storage[StorageKeyEnum.SIDE_PANEL_GUIDE_PENDING]
    if (typeof guideState === 'boolean') return

    return chrome.storage.local.set({ [StorageKeyEnum.SIDE_PANEL_GUIDE_PENDING]: true })
  }).catch(error => Logger.log('记录侧边栏升级引导状态失败', error))
})

async function configureToolbarEntry(setting?: TabAssistantConfig['setting']) {
  const openSidePanel = setting?.toolbarEntry === 'sidepanel'

  try {
    if (openSidePanel) {
      await chrome.action.setPopup({ popup: '' })
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      return
    }

    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
    await chrome.action.setPopup({ popup: 'popup.html' })
  } catch (error) {
    Logger.log('配置顶部图标打开方式失败', error)
  }
}

function main() {
  const nextReload = reloadAssistantTask.then(async () => {
    const storage = await chrome.storage.sync
      .get([
        StorageKeyEnum.RULES,
        StorageKeyEnum.SETTING
      ])

    await configureToolbarEntry(storage[StorageKeyEnum.SETTING])

    assistant?.dispose()

    /** 启动 */
    assistant = new TabAssistant({
      rules: storage[StorageKeyEnum.RULES],
      setting: storage[StorageKeyEnum.SETTING],
    })
    await assistant.bootstrap()
    Logger.log('assistant ins', assistant)
  })

  reloadAssistantTask = nextReload.catch(error => {
    Logger.log('初始化扩展失败', error)
  })

  return nextReload
};

void main();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message !== EventNameEnum.RELOAD_RULE) return false

  void main()
    .then(() => sendResponse(EventNameEnum.RELOAD_SUCC))
    .catch(error => Logger.log('重新加载扩展配置失败', error))
  return true;
})
