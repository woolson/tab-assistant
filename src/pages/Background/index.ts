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
import { AI_MANUAL_EDIT_COOLDOWN_MS, continueNewTabForAiGrouping, suspendOnDeviceModel, watchNewTabForAiGrouping } from "./aiAutoGroup"
import { isPlaceholderTabUrl, normalizeGroupTitle } from "./aiAutoGroupDecision"
import { reloadAutoClose, setupAutoClose } from "./autoClose"
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
    removeKeywordList: [],
    aiAutoGroupEnabled: false,
  }

  private readonly tabCreatedListener = this.onTabCreated.bind(this)
  private readonly tabRemovedListener = this.onTabRemoved.bind(this)
  private readonly tabUpdatedListener = this.onTabAdded.bind(this)
  private readonly tabMovedListener = (tabId: number) => {
    this.noteManualTabEdit(tabId)
  }
  private readonly tabGroupChangedListener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
    if (changeInfo.groupId === undefined || changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return
    this.noteManualTabEdit(tabId)
  }
  private readonly groupRemovedListener = this.onGroupRemoved.bind(this)
  private readonly groupUpdatedListener = this.onGroupUpdated.bind(this)
  private readonly groupMovedListener = () => {
    this.noteManualGroupReorder()
  }

  private disposed = false
  /** 扩展自己正在改分组时，忽略随之而来的移动事件，避免把它们当成用户操作。 */
  private browserMutationDepth = 0
  private browserMutationTimers: Array<ReturnType<typeof setTimeout>> = []
  /** 开启 AI 后新建的标签不再走原来的“地址变化就按域名分组”。 */
  private readonly aiManagedTabIds = new Set<number>()
  /** 已经开始（或完成）第一次放置决策的新标签，避免重复询问模型。 */
  private readonly aiDecisionStarted = new Set<number>()
  private readonly manualHoldUntil = new Map<number, number>()
  private readonly groupTitles = new Map<number, string | undefined>()
  private suppressGroupReorderUntil = 0

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
    chrome.tabs.onMoved.addListener(this.tabMovedListener)
    chrome.tabs.onUpdated.addListener(this.tabGroupChangedListener)
    chrome.tabGroups.onRemoved.addListener(this.groupRemovedListener)
    chrome.tabGroups.onUpdated.addListener(this.groupUpdatedListener)
    chrome.tabGroups.onMoved.addListener(this.groupMovedListener)

    if (!this.setting.aiAutoGroupEnabled) suspendOnDeviceModel()
  }

  /** 配置重载时移除旧实例监听，避免同一个事件被重复处理。 */
  dispose() {
    this.disposed = true
    this.browserMutationTimers.forEach(timer => clearTimeout(timer))
    this.browserMutationTimers = []
    chrome.tabs.onCreated.removeListener(this.tabCreatedListener)
    chrome.tabs.onRemoved.removeListener(this.tabRemovedListener)
    chrome.tabs.onUpdated.removeListener(this.tabUpdatedListener)
    chrome.tabs.onMoved.removeListener(this.tabMovedListener)
    chrome.tabs.onUpdated.removeListener(this.tabGroupChangedListener)
    chrome.tabGroups.onRemoved.removeListener(this.groupRemovedListener)
    chrome.tabGroups.onUpdated.removeListener(this.groupUpdatedListener)
    chrome.tabGroups.onMoved.removeListener(this.groupMovedListener)
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

      /**
       * AI 开启时，启动整理不再把已经在分组里、且没有命中规则的标签拉回域名分组，
       * 否则 Service Worker 每次唤醒都会拆掉模型刚放好的分组。
       */
      tabs.forEach(tab => {
        if (this.shouldKeepCurrentGroup(tab)) {
          this.rememberTabInItsCurrentGroup(tab)
          return
        }
        this.addTabToGroup(tab, false)
      })

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
          await this.updateGroupSafely(groupId, { title: groupInfo.title, color: groupInfo.color })
          await this.moveGroupSafely(groupId, this.getGroupIndex({
            sortIndex: groupInfo.index,
            groupTitle: groupInfo.title || '',
            windowId: window.id
          }), window.id)
        }
      }
    }))
  }

  /**
   * 更新分组信息。分组可能在操作间隙被移除（如标签页被自动关闭导致分组消失），
   * 失败时仅记录日志，避免产生未捕获的异常。
   */
  async updateGroupSafely(groupId: number, props: chrome.tabGroups.UpdateProperties) {
    await this.trackBrowserMutation(async () => {
      try {
        await chrome.tabGroups.update(groupId, props)
      } catch (error) {
        Logger.log('更新分组失败', groupId, error)
      }
    })
  }

  /**
   * 移动分组到目标位置。
   * 固定标签占据窗口起始位置且不能与分组交叉，目标索引需要加上固定标签数量的偏移；
   * 分组也可能在操作间隙被移除，失败时仅记录日志。
   */
  async moveGroupSafely(groupId: number, index: number, windowId: number) {
    await this.trackBrowserMutation(async () => {
      try {
        let targetIndex = index
        if (index >= 0) {
          const pinnedTabs = await chrome.tabs.query({ windowId, pinned: true })
          targetIndex = index + pinnedTabs.length
        }
        await chrome.tabGroups.move(groupId, { index: targetIndex })
      } catch (error) {
        Logger.log('移动分组失败', groupId, error)
      }
    })
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
    return this.trackBrowserMutation(() => this.groupTabsInWindowNow(params))
  }

  private async groupTabsInWindowNow(params: {
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
  addTabToGroup(tabInfo: number, syncToBrowser: boolean): Promise<Groups[number] | undefined>
  addTabToGroup(tabInfo: chrome.tabs.Tab, syncToBrowser: boolean): Promise<Groups[number] | undefined>
  async addTabToGroup(tabInfoOrTabId: number | chrome.tabs.Tab, syncToBrowser = false) {
    let tabInfo: chrome.tabs.Tab = typeof tabInfoOrTabId === 'number'
      ? await chrome.tabs.get(tabInfoOrTabId)
      : tabInfoOrTabId
    // 固定标签不参与分组：加入分组会使其被取消固定
    if (!tabInfo.url || !tabInfo.id || tabInfo.pinned) return;

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
          await this.updateGroupSafely(groupId, {
            title: groupInfo.title,
            collapsed: groupInfo.collapsed,
            color: groupInfo.color
          })
          await this.moveGroupSafely(groupId, this.getGroupIndex({
            groupTitle,
            sortIndex: groupInfo.index,
            windowId: tabInfo.windowId
          }), tabInfo.windowId)
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
        await this.updateGroupSafely(groupId, { title, collapsed, color })

        await this.moveGroupSafely(groupId, this.getGroupIndex({
          groupTitle,
          sortIndex: index,
          windowId: tabInfo.windowId
        }), tabInfo.windowId)
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

    const rule = this.findMatchedRule(url, host)
    if (rule) return rule

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

  /** 规则和本地文件分组仍然优先于模型判断。 */
  shouldUseExistingGrouping(url: string) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'file:') return true
      return Boolean(this.findMatchedRule(url, parsed.host))
    } catch (error) {
      Logger.log('判断已有分组规则失败', url, error)
      return false
    }
  }

  findMatchedRule(url: string, host = new URL(url).host) {
    const rules = this.rules.slice(0).sort((a, b) => b.priority - a.priority)
    Logger.log('sorted rules', rules)

    for (const rule of rules) {
      if (rule.matchType === MatchTypeEnum.Domain && host === rule.matchContent) {
        return rule
      } else if (rule.matchType === MatchTypeEnum.RegExp) {
        const reg = new RegExp(rule.matchContent)
        if (reg.test(url)) return rule
      }
    }
    return undefined
  }

  isDisposed() {
    return this.disposed
  }

  releaseInitialDecision(tabId: number) {
    this.aiDecisionStarted.delete(tabId)
  }

  hasManualTabHold(tabId: number) {
    const until = this.manualHoldUntil.get(tabId)
    if (!until) return false
    if (until < Date.now()) {
      this.manualHoldUntil.delete(tabId)
      return false
    }
    return true
  }

  async groupTabWithExistingRules(tab: chrome.tabs.Tab) {
    if (!tab.id) return
    const latest = await this.readMovableTab(tab.id)
    if (!latest) return
    await this.addTabToGroup(latest, true)
  }

  async joinTabToGroup(tab: chrome.tabs.Tab, groupId: number) {
    if (!tab.id || !Number.isInteger(groupId) || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return
    const latest = await this.readMovableTab(tab.id)
    if (!latest?.id) return

    let browserGroup: chrome.tabGroups.TabGroup
    try {
      browserGroup = await chrome.tabGroups.get(groupId)
    } catch (error) {
      Logger.log('要加入的分组不存在', groupId, error)
      return
    }
    if (browserGroup.windowId !== latest.windowId) return

    const refreshed = await this.readMovableTab(latest.id)
    if (!refreshed?.id) return

    try {
      await this.trackBrowserMutation(async () => {
        this.removeTabFromGroups(refreshed.id as number, refreshed.windowId)
        const nextGroupId = await chrome.tabs.group({
          groupId,
          tabIds: refreshed.id as number,
        })
        this.rememberJoinedTab(refreshed.windowId, nextGroupId, browserGroup, refreshed.id as number)
      })
    } catch (error) {
      Logger.log('加入已有分组失败', groupId, error)
    }
  }

  async createGroupForTab(tab: chrome.tabs.Tab, rawTitle: string) {
    if (!tab.id) return
    const title = normalizeGroupTitle(rawTitle)
    if (!title) return
    const latest = await this.readMovableTab(tab.id)
    if (!latest?.id) return

    const groups = await chrome.tabGroups.query({ windowId: latest.windowId })
    const sameTitle = groups.find(group => (group.title || '').trim().toLowerCase() === title.toLowerCase())
    if (sameTitle) {
      await this.joinTabToGroup(latest, sameTitle.id)
      return
    }

    await this.trackBrowserMutation(async () => {
      const current = await this.readMovableTab(latest.id as number)
      if (!current?.id) return
      this.removeTabFromGroups(current.id, current.windowId)
      const groupInfo = this.getGroupByWindowIdAndTitle({
        windowId: current.windowId,
        groupTitle: title,
      })
      if (typeof groupInfo.id === 'number') {
        const nextGroupId = await chrome.tabs.group({
          groupId: groupInfo.id,
          tabIds: current.id,
        })
        const tabIds = groupInfo.tabIds instanceof Set ? groupInfo.tabIds : new Set<number>()
        tabIds.add(current.id)
        groupInfo.tabIds = tabIds
        groupInfo.id = nextGroupId
        return
      }

      const groupId = await this.groupTabsInWindowNow({
        tabIds: current.id,
        windowId: current.windowId,
      })
      const tabIds = groupInfo.tabIds instanceof Set ? groupInfo.tabIds : new Set<number>()
      tabIds.add(current.id)
      Object.assign(groupInfo, {
        collapsed: false,
        title,
        tabIds,
        index: typeof groupInfo.index === 'number' ? groupInfo.index : -1,
        windowId: current.windowId,
        id: groupId,
      })
      await chrome.tabGroups.update(groupId, { title }).catch(error => {
        Logger.log('更新新建分组标题失败', groupId, error)
      })
      if (Date.now() >= this.suppressGroupReorderUntil) {
        await this.moveGroupSafely(groupId, this.getGroupIndex({
          groupTitle: title,
          sortIndex: groupInfo.index,
          windowId: current.windowId,
        }), current.windowId)
      }
    })
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
    if (tab.id && this.setting.aiAutoGroupEnabled && !tab.pinned) {
      this.aiManagedTabIds.add(tab.id)
      this.aiDecisionStarted.add(tab.id)
      if (typeof tab.groupId === 'number' && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        Logger.log('新标签已在分组中，保持不动', tab.id)
        return
      }
      watchNewTabForAiGrouping(this, tab)
      return
    }

    if (tab.id) {
      Logger.log('创建标签后添加到分组', tab.url)
      await this.addTabToGroup(tab, true)
        .catch(error => Logger.log('创建标签加入分组失败', tab.id, error))
    }
  }

  async onTabAdded(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
    if (this.aiManagedTabIds.has(tabId)) {
      if (this.aiDecisionStarted.has(tabId)) return
      if (!changeInfo.url || isPlaceholderTabUrl(changeInfo.url)) return
      this.aiDecisionStarted.add(tabId)
      continueNewTabForAiGrouping(this, tabId)
      return
    }
    if (changeInfo.url || changeInfo.status === 'complete') {
      try {
        // 标签可能在事件派发后已被关闭（如被自动关闭），获取失败时直接忽略
        const tabInfo = await chrome.tabs.get(tabId)
        Logger.log('对标签添加到分组', changeInfo.url || tabInfo.url)
        await this.addTabToGroup({
          ...tabInfo,
          url: changeInfo.url || tabInfo.url,
        }, true)
      } catch (error) {
        Logger.log('更新标签加入分组失败', tabId, error)
      }
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
    this.aiManagedTabIds.delete(tabId)
    this.aiDecisionStarted.delete(tabId)
    this.manualHoldUntil.delete(tabId)
    for (const group of this.getSortedGroups(removeInfo.windowId)) {
      if (group.tabIds?.has?.(tabId)) {
        Logger.log('onTabRemove', group.title, tabId)
        group.tabIds.delete(tabId)
      }
    }
  }

  /** 分组移除时更新数据 */
  onGroupRemoved(group: chrome.tabGroups.TabGroup) {
    this.groupTitles.delete(group.id)
    const groupInfo = this.groups[group.windowId]?.[group.title || '']
    Logger.log('onGroupRemove', groupInfo)
    if (groupInfo?.id !== undefined && groupInfo.tabIds) {
      groupInfo.id = undefined
      groupInfo.tabIds.clear()
    }
  }

  /** 分组更新时更新分组数据 */
  onGroupUpdated(group: chrome.tabGroups.TabGroup) {
    this.noteManualGroupTitle(group)
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

  private shouldKeepCurrentGroup(tab: chrome.tabs.Tab) {
    if (!this.setting.aiAutoGroupEnabled || !tab.url) return false
    return !this.shouldUseExistingGrouping(tab.url)
  }

  /** 启动时只记住标签当前所在分组，不再按域名把它搬走。 */
  private rememberTabInItsCurrentGroup(tab: chrome.tabs.Tab) {
    if (!tab.url || !tab.id || tab.pinned) return
    if (typeof tab.groupId !== 'number' || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return
    const groupInfo = Object.values(this.getGroupsByWindowId({ windowId: tab.windowId }))
      .find(group => group.id === tab.groupId)
    if (!groupInfo) return
    const tabIds = groupInfo.tabIds instanceof Set ? groupInfo.tabIds : new Set<number>()
    tabIds.add(tab.id)
    groupInfo.tabIds = tabIds
  }

  private async readMovableTab(tabId: number) {
    if (this.disposed || this.hasManualTabHold(tabId)) return undefined
    try {
      const latest = await chrome.tabs.get(tabId)
      if (this.disposed || latest.pinned || !latest.id || this.hasManualTabHold(latest.id)) return undefined
      if (typeof latest.groupId === 'number' && latest.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return undefined
      return latest
    } catch (error) {
      Logger.log('读取待分组标签失败', tabId, error)
      return undefined
    }
  }

  private rememberJoinedTab(
    windowId: number,
    groupId: number,
    browserGroup: chrome.tabGroups.TabGroup,
    tabId: number,
  ) {
    const groups = this.getGroupsByWindowId({ windowId })
    let groupInfo = Object.values(groups).find(group => group.id === groupId)
    if (!groupInfo) {
      groupInfo = this.getGroupByWindowIdAndTitle({
        windowId,
        groupTitle: browserGroup.title || `group-${groupId}`,
      })
    }
    const tabIds = groupInfo.tabIds instanceof Set ? groupInfo.tabIds : new Set<number>()
    tabIds.add(tabId)
    Object.assign(groupInfo, {
      id: groupId,
      title: browserGroup.title || groupInfo.title,
      color: browserGroup.color,
      collapsed: browserGroup.collapsed,
      windowId,
      index: typeof groupInfo.index === 'number' ? groupInfo.index : -1,
      tabIds,
    })
  }

  private noteManualTabEdit(tabId: number) {
    if (!this.setting.aiAutoGroupEnabled || this.browserMutationDepth > 0) return
    this.manualHoldUntil.set(tabId, Date.now() + AI_MANUAL_EDIT_COOLDOWN_MS)
    Logger.log('检测到手动调整标签，短时间内不再自动分组', tabId)
  }

  private noteManualGroupReorder() {
    if (!this.setting.aiAutoGroupEnabled || this.browserMutationDepth > 0) return
    this.suppressGroupReorderUntil = Date.now() + AI_MANUAL_EDIT_COOLDOWN_MS
    Logger.log('检测到手动移动分组，短时间内不再调整分组顺序')
  }

  private noteManualGroupTitle(group: chrome.tabGroups.TabGroup) {
    const seen = this.groupTitles.has(group.id)
    const previous = this.groupTitles.get(group.id)
    this.groupTitles.set(group.id, group.title)
    if (!this.setting.aiAutoGroupEnabled || this.browserMutationDepth > 0 || !seen || previous === group.title) return
    this.suppressGroupReorderUntil = Date.now() + AI_MANUAL_EDIT_COOLDOWN_MS
    Logger.log('检测到手动重命名分组，短时间内不再调整分组顺序', group.id)
  }

  private async trackBrowserMutation<T>(task: () => Promise<T>): Promise<T> {
    this.browserMutationDepth += 1
    try {
      return await task()
    } finally {
      const timer = setTimeout(() => {
        this.browserMutationDepth = Math.max(0, this.browserMutationDepth - 1)
      }, 1000)
      this.browserMutationTimers.push(timer)
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
    await reloadAutoClose().catch(error => Logger.log('初始化自动关闭闲置标签页失败', error))

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

setupAutoClose();

void main();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message !== EventNameEnum.RELOAD_RULE) return false

  void main()
    .then(() => sendResponse(EventNameEnum.RELOAD_SUCC))
    .catch(error => Logger.log('重新加载扩展配置失败', error))
  return true;
})
