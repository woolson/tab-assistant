import { AI_API_CONFIG_KEY, normalizeAiApiConfig, type AiApiConfig } from "../../common/aiApi"
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
import { queryClickSourcePermission } from "../../common/permissions"
import { AI_MANUAL_EDIT_COOLDOWN_MS, scheduleTabReevaluation, forgetTabReevaluation, continueNewTabForAiGrouping, watchNewTabForAiGrouping } from "./aiAutoGroup"
import { CLEAR_AI_DECISION_LOG_MESSAGE, clearAiDecisionLog, recordAiDecision } from "./aiDecisionLog"
import { isGroupedId, normalizeGroupTitle, readRealUrl } from "./aiAutoGroupDecision"
import { reloadAutoClose, setupAutoClose } from "./autoClose"
import {
  forgetAllClickGestures,
  forgetClickGesture,
  normalizeClickGesture,
  rememberClickGesture,
} from "./clickGesture"
import { Logger } from "./helpers"
import { readSearchIntent } from "./searchIntent"
import { forgetNavigationLink, rememberNavigationLink } from "./navigationLink"
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
    rememberClickSource: false,
  }

  private readonly aiApi: AiApiConfig
  private disposed = false
  /** 扩展自己正在改分组时，忽略随之而来的移动事件，避免把它们当成用户操作。 */
  private browserMutationDepth = 0
  private browserMutationTimers: Array<ReturnType<typeof setTimeout>> = []
  /** 正在等待地址或处理决策的标签，合并同一次导航的多个更新事件。 */
  private readonly aiDecisionStarted = new Set<number>()
  /** 已处理的地址；未分组标签换了访问内容后，仍然可以再次询问模型。 */
  private readonly aiDecisionPages = new Map<number, { url: string; searchQuery?: string }>()
  private readonly manualHoldUntil = new Map<number, number>()
  private readonly automatedGroupTitles = new Map<number, string>()
  private readonly manuallyNamedGroups = new Set<number>()
  private readonly groupTitles = new Map<number, string | undefined>()
  private suppressGroupReorderUntil = 0

  constructor(config: TabAssistantConfig) {
    Logger.log('初始化_扩展配置', { rules: config.rules, setting: config.setting })
    this.aiApi = normalizeAiApiConfig(config.aiApi)

    this.rules = config.rules || []
    if (config.domainMap) this.domainMap = config.domainMap
    this.setting = Object.assign(this.setting, config.setting || {})

    Logger.log('初始化_分组信息', cloneDeep(this.groups))


    /** 点击来源采集只在 AI 分组开启且用户显式选择时才注册。 */
    void syncClickGestureCapture(this.setting.aiAutoGroupEnabled === true && this.setting.rememberClickSource === true)
      .catch(error => Logger.log('同步内容采集脚本失败', error))
  }

  /** 配置重载时停止旧实例；浏览器事件由顶层监听统一转发给新实例。 */
  dispose() {
    this.disposed = true
    this.browserMutationTimers.forEach(timer => clearTimeout(timer))
    this.browserMutationTimers = []
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
        this.groupTitles.set(group.id, group.title)
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
        // 唤醒 Worker 的新标签由 onCreated 处理，不能被启动整理抢先按域名分组。
        if (tab.id !== undefined && pendingCreatedTabIds.has(tab.id)) return
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

  private async writeGroupProperties(groupId: number, props: chrome.tabGroups.UpdateProperties) {
    if (props.title !== undefined) this.automatedGroupTitles.set(groupId, props.title)
    try {
      return await chrome.tabGroups.update(groupId, props)
    } catch (error) {
      this.automatedGroupTitles.delete(groupId)
      throw error
    }
  }

  /**
   * 更新分组信息。分组可能在操作间隙被移除（如标签页被自动关闭导致分组消失），
   * 失败时仅记录日志，避免产生未捕获的异常。
   */
  async updateGroupSafely(groupId: number, props: chrome.tabGroups.UpdateProperties) {
    await this.trackBrowserMutation(async () => {
      try {
        await this.writeGroupProperties(groupId, props)
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
    // AI 模式只有显式规则和本地文件使用这条路径，任何更新都不能按域名兜底。
    if (this.setting.aiAutoGroupEnabled && !this.shouldUseExistingGrouping(tabInfo.url)) return

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

  async canRenameTaskGroup(groupId: number) {
    if (this.disposed || !this.setting.aiAutoGroupEnabled || this.manuallyNamedGroups.has(groupId)) return false
    const group = await chrome.tabGroups.get(groupId)
    const key = `TA_AI_MANUAL_TITLE_${groupId}`
    const saved = await chrome.storage.local.get(key)
    if (saved[key] !== undefined && saved[key] === group.title) return false
    if (this.rules.some(rule => rule.groupTitle === group.title)) return false
    const tabs = await chrome.tabs.query({ groupId })
    return tabs.length > 0 && tabs.every(tab => !tab.pinned && tab.id !== undefined && !this.hasManualTabHold(tab.id) && !this.shouldUseExistingGrouping(readRealUrl(tab) || ''))
  }

  async renameTaskGroup(groupId: number, expectedTitle: string, title: string, expectedTab?: chrome.tabs.Tab) {
    if (!await this.canRenameTaskGroup(groupId)) return false
    const group = await chrome.tabGroups.get(groupId)
    if ((group.title || '') !== expectedTitle) return false
    const siblings = await chrome.tabGroups.query({ windowId: group.windowId })
    if (siblings.some(item => item.id !== groupId && item.title === title)) return false
    if (this.disposed || this.manuallyNamedGroups.has(groupId)) return false
    if (expectedTab?.id && !await this.readMovableTab(expectedTab.id, expectedTab)) return false
    if (this.disposed || this.manuallyNamedGroups.has(groupId)) return false
    await this.trackBrowserMutation(() => this.writeGroupProperties(groupId, { title }))
    this.groupTitles.set(groupId, title)
    return true
  }

  canReevaluateGroupedTab(tab: chrome.tabs.Tab) {
    const url = readRealUrl(tab)
    return !this.disposed && this.setting.aiAutoGroupEnabled === true && tab.id !== undefined &&
      !tab.pinned && isGroupedId(tab.groupId) && !this.hasManualTabHold(tab.id) &&
      Boolean(url && /^https?:\/\//i.test(url) && !this.shouldUseExistingGrouping(url))
  }

  async onPageContentChanged(tabId: number, url: string, signature: string) {
    if (this.disposed || !this.setting.aiAutoGroupEnabled || !this.canReadPageContent() || !await queryClickSourcePermission()) return
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (!tab || readRealUrl(tab) !== url) return
    scheduleTabReevaluation(this, tab, signature)
  }

  getAiApiConfig() { return this.aiApi }

  canReadPageContent() {
    return this.setting.rememberClickSource === true
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

  releaseInitialDecision(tabId: number, decidedUrl?: string, decidedTitle?: string) {
    this.aiDecisionStarted.delete(tabId)
    if (this.disposed) return
    if (decidedUrl) this.aiDecisionPages.set(tabId, { url: decidedUrl, searchQuery: readSearchIntent(decidedUrl, decidedTitle)?.query })
    // 导航可能在等待地址结束或 API 请求期间发生。重新读取，补上尚未处理的地址。
    void chrome.tabs.get(tabId).then(tab => {
      if (readRealUrl(tab)) this.startUngroupedTabDecision(tab)
    }).catch(() => this.aiDecisionPages.delete(tabId))
  }

  private startUngroupedTabDecision(tab: chrome.tabs.Tab, waitForUrl = false) {
    if (this.disposed || !this.setting.aiAutoGroupEnabled || !tab.id || tab.pinned ||
      isGroupedId(tab.groupId) || this.hasManualTabHold(tab.id) || this.aiDecisionStarted.has(tab.id)) return
    const url = readRealUrl(tab)
    const decided = this.aiDecisionPages.get(tab.id)
    if (url && decided?.url === url && decided.searchQuery === readSearchIntent(url, tab.title)?.query) return
    if (!url && !waitForUrl) return
    this.aiDecisionStarted.add(tab.id)
    if (waitForUrl) watchNewTabForAiGrouping(this, tab)
    else continueNewTabForAiGrouping(this, tab.id)
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

  async groupTabWithExistingRules(tab: chrome.tabs.Tab, expectedGroupId?: number) {
    if (!tab.id) return
    const latest = await this.readMovableTab(tab.id, expectedGroupId === undefined ? undefined : { ...tab, groupId: expectedGroupId })
    if (!latest) return
    const url = readRealUrl(latest)
    if (!url) return
    await this.addTabToGroup({ ...latest, url }, true)
  }

  async joinTabToGroup(tab: chrome.tabs.Tab, groupId: number, expectedGroupId?: number) {
    if (!tab.id || !Number.isInteger(groupId) || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return false
    const guard = expectedGroupId === undefined ? undefined : { ...tab, groupId: expectedGroupId }
    const latest = await this.readMovableTab(tab.id, guard)
    if (!latest?.id) return false

    let browserGroup: chrome.tabGroups.TabGroup
    try {
      browserGroup = await chrome.tabGroups.get(groupId)
    } catch (error) {
      Logger.log('要加入的分组不存在', groupId, error)
      return false
    }
    if (browserGroup.windowId !== latest.windowId) return false

    const refreshed = await this.readMovableTab(latest.id, guard)
    if (!refreshed?.id) return false

    try {
      await this.trackBrowserMutation(async () => {
        this.removeTabFromGroups(refreshed.id as number, refreshed.windowId)
        const nextGroupId = await chrome.tabs.group({
          groupId,
          tabIds: refreshed.id as number,
        })
        this.rememberJoinedTab(refreshed.windowId, nextGroupId, browserGroup, refreshed.id as number)
      })
      return true
    } catch (error) {
      Logger.log('加入已有分组失败', groupId, error)
      return false
    }
  }

  async createGroupForTab(tab: chrome.tabs.Tab, rawTitle: string, expectedGroupId?: number) {
    if (!tab.id) return false
    const title = normalizeGroupTitle(rawTitle)
    if (!title) return false
    const guard = expectedGroupId === undefined ? undefined : { ...tab, groupId: expectedGroupId }
    const latest = await this.readMovableTab(tab.id, guard)
    if (!latest?.id) return false

    const groups = await chrome.tabGroups.query({ windowId: latest.windowId })
    const sameTitle = groups.find(group => (group.title || '').trim().toLowerCase() === title.toLowerCase())
    if (sameTitle) {
      return this.joinTabToGroup(tab, sameTitle.id, expectedGroupId)
    }

    return this.trackBrowserMutation(async () => {
      const current = await this.readMovableTab(latest.id as number, guard)
      if (!current?.id) return false
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
        return true
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
      await this.writeGroupProperties(groupId, { title }).catch(error => {
        Logger.log('更新新建分组标题失败', groupId, error)
      })
      if (Date.now() >= this.suppressGroupReorderUntil) {
        await this.moveGroupSafely(groupId, this.getGroupIndex({
          groupTitle: title,
          sortIndex: groupInfo.index,
          windowId: current.windowId,
        }), current.windowId)
      }
      return true
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
      if (typeof tab.groupId === 'number' && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        Logger.log('新标签已在分组中，保持不动', tab.id)
        recordAiDecision({
          url: tab.pendingUrl || tab.url || '',
          title: tab.title || '',
          result: 'kept',
          via: 'none',
          modelStatus: 'not-asked',
          groupId: tab.groupId,
        })
        return
      }
      this.startUngroupedTabDecision(tab, true)
      return
    }

    if (tab.id) {
      Logger.log('创建标签后添加到分组', tab.url)
      await this.addTabToGroup(tab, true)
        .catch(error => Logger.log('创建标签加入分组失败', tab.id, error))
    }
  }

  /**
   * 记录「新标签页是被谁打开的」。
   * 相比 tab.openerTabId，这个事件在 rel=noopener / window.open 场景下
   * 依然能给出 sourceTabId，用来把上下两个页面关联起来。
   */
  onCreatedNavigationTarget(details: chrome.webNavigation.WebNavigationSourceCallbackDetails) {
    if (!this.setting.aiAutoGroupEnabled) return
    if (typeof details.tabId !== 'number' || details.tabId < 0) return
    const sourceTabId = details.sourceTabId
    rememberNavigationLink(details.tabId, {
      sourceTabId: typeof sourceTabId === 'number' && Number.isInteger(sourceTabId) && sourceTabId >= 0
        ? sourceTabId
        : undefined,
      sourceFrameId: details.sourceFrameId,
      url: details.url,
      at: Date.now(),
    })
  }

  async onTabAdded(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
    if (this.setting.aiAutoGroupEnabled) {
      if (!changeInfo.status && changeInfo.title === undefined && !changeInfo.url) return
      const tab = await chrome.tabs.get(tabId).catch(() => undefined)
      if (!tab) return
      if (isGroupedId(tab.groupId)) {
        const url = readRealUrl(tab)
        if (url && this.shouldUseExistingGrouping(url)) await this.groupTabWithExistingRules(tab, tab.groupId)
        else {
          this.rememberTabInItsCurrentGroup(tab)
          scheduleTabReevaluation(this, tab)
        }
      } else {
        // 不依赖 onCreated 留下的内存标记：Edge 新标签页等待搜索时，Worker
        // 可能已经休眠或因保存配置而重建。真实导航本身就应触发 AI 和决策日志。
        this.startUngroupedTabDecision(tab)
      }
      return
    }
    if (changeInfo.url || changeInfo.status === 'complete') {
      try {
        // 标签可能在事件派发后已被关闭（如被自动关闭），获取失败时直接忽略
        const tabInfo = await chrome.tabs.get(tabId)
        const currentTab = {
          ...tabInfo,
          url: changeInfo.url || tabInfo.url,
        }
        Logger.log('对标签添加到分组', currentTab.url)
        await this.addTabToGroup(currentTab, true)
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
    forgetTabReevaluation(this, tabId)
    this.aiDecisionStarted.delete(tabId)
    this.aiDecisionPages.delete(tabId)
    this.manualHoldUntil.delete(tabId)
    forgetNavigationLink(tabId)
    forgetClickGesture(tabId)
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
    this.manuallyNamedGroups.delete(group.id)
    this.automatedGroupTitles.delete(group.id)
    void chrome.storage.local.remove?.(`TA_AI_MANUAL_TITLE_${group.id}`)?.catch(() => {})
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
    const groups = this.groups[group.windowId]
    if (!groups) return
    const entry = Object.entries(groups).find(([, info]) => info.id === group.id)
    if (!entry) return
    const [oldTitle, groupInfo] = entry
    Object.assign(groupInfo, { title: group.title, color: group.color, id: group.id, collapsed: group.collapsed })
    const title = group.title || ''
    if (oldTitle !== title && !groups[title]) {
      delete groups[oldTitle]
      groups[title] = groupInfo
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

  private async readMovableTab(tabId: number, expected?: chrome.tabs.Tab) {
    if (this.disposed || this.hasManualTabHold(tabId)) return undefined
    try {
      const latest = await chrome.tabs.get(tabId)
      if (this.disposed || latest.pinned || !latest.id || this.hasManualTabHold(latest.id)) return undefined
      if (expected) {
        if (latest.groupId !== expected.groupId || latest.windowId !== expected.windowId ||
          readRealUrl(latest) !== readRealUrl(expected) || latest.title !== expected.title) return undefined
      } else if (isGroupedId(latest.groupId)) return undefined
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

  noteManualTabEdit(tabId: number) {
    if (!this.setting.aiAutoGroupEnabled || this.browserMutationDepth > 0) return
    this.manualHoldUntil.set(tabId, Date.now() + AI_MANUAL_EDIT_COOLDOWN_MS)
    Logger.log('检测到手动调整标签，短时间内不再自动分组', tabId)
  }

  noteManualGroupReorder() {
    if (!this.setting.aiAutoGroupEnabled || this.browserMutationDepth > 0) return
    this.suppressGroupReorderUntil = Date.now() + AI_MANUAL_EDIT_COOLDOWN_MS
    Logger.log('检测到手动移动分组，短时间内不再调整分组顺序')
  }

  private noteManualGroupTitle(group: chrome.tabGroups.TabGroup) {
    const seen = this.groupTitles.has(group.id)
    const previous = this.groupTitles.get(group.id)
    this.groupTitles.set(group.id, group.title)
    const automated = this.automatedGroupTitles.has(group.id) && this.automatedGroupTitles.get(group.id) === group.title
    if (automated) this.automatedGroupTitles.delete(group.id)
    if (!this.setting.aiAutoGroupEnabled || automated || !seen || previous === group.title) return
    this.manuallyNamedGroups.add(group.id)
    void chrome.storage.local.set({ [`TA_AI_MANUAL_TITLE_${group.id}`]: group.title || '' }).catch(() => {})
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
const pendingCreatedTabIds = new Set<number>()

/**
 * MV3 会在事件到来时重启 Worker。监听必须在脚本顶层同步注册，
 * 事件的实际处理再等待配置和启动整理，不能在 storage.get() 之后才加监听。
 */
function withAssistant(task: (instance: TabAssistant) => void | Promise<void>): Promise<void> {
  return reloadAssistantTask.then(async () => {
    if (assistant) await task(assistant)
  }).catch(error => Logger.log('处理标签或分组事件失败', error))
}

chrome.tabs.onCreated.addListener(tab => {
  if (tab.id !== undefined) pendingCreatedTabIds.add(tab.id)
  void withAssistant(instance => instance.onTabCreated(tab)).finally(() => {
    if (tab.id !== undefined) pendingCreatedTabIds.delete(tab.id)
  })
})
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // 手动操作要在事件发生时判断，异步转发会把扩展自己的移动误判为用户操作。
  if (changeInfo.groupId !== undefined && changeInfo.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    assistant?.noteManualTabEdit(tabId)
  }
  void withAssistant(instance => instance.onTabAdded(tabId, changeInfo))
})
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  pendingCreatedTabIds.delete(tabId)
  void withAssistant(instance => instance.onTabRemoved(tabId, removeInfo))
})
chrome.tabs.onMoved.addListener(tabId => assistant?.noteManualTabEdit(tabId))
chrome.tabGroups.onRemoved.addListener(group => {
  void withAssistant(instance => instance.onGroupRemoved(group))
})
chrome.tabGroups.onUpdated.addListener(group => assistant?.onGroupUpdated(group))
chrome.tabGroups.onMoved.addListener(() => assistant?.noteManualGroupReorder())
chrome.webNavigation?.onCreatedNavigationTarget?.addListener(details => {
  void withAssistant(instance => instance.onCreatedNavigationTarget(details))
})

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

    const local = await chrome.storage.local.get(AI_API_CONFIG_KEY)
    await configureToolbarEntry(storage[StorageKeyEnum.SETTING])
    await reloadAutoClose().catch(error => Logger.log('初始化自动关闭闲置标签页失败', error))

    assistant?.dispose()

    /** 启动 */
    assistant = new TabAssistant({
      aiApi: normalizeAiApiConfig(local[AI_API_CONFIG_KEY]),
      rules: storage[StorageKeyEnum.RULES],
      setting: storage[StorageKeyEnum.SETTING],
    })
    await assistant.bootstrap()
    Logger.log('标签助理初始化完成')
  })

  reloadAssistantTask = nextReload.catch(error => {
    Logger.log('初始化扩展失败', error)
  })

  return nextReload
};

setupAutoClose();

void main();

const CLICK_GESTURE_SCRIPT_ID = 'ta-click-gesture'

/**
 * 按「设置 + 实际权限」同步内容脚本的注册状态，重复调用是安全的。
 * 权限只能由用户手势触发申请，这里只负责在改设置后让注册状态跟上。
 */
async function syncClickGestureCapture(enabled: boolean) {
  const scripting = chrome.scripting
  if (!scripting?.registerContentScripts) return

  const registered = await scripting
    .getRegisteredContentScripts({ ids: [CLICK_GESTURE_SCRIPT_ID] })
    .catch(() => [] as chrome.scripting.RegisteredContentScript[])

  const granted = enabled ? await queryClickSourcePermission() : false

  if (!granted) {
    if (registered.length) {
      await scripting
        .unregisterContentScripts({ ids: [CLICK_GESTURE_SCRIPT_ID] })
        .catch(error => Logger.log('移除点击来源脚本失败', error))
    }
    forgetAllClickGestures()
    return
  }

  if (!registered.length) try {
    await scripting.registerContentScripts([{
      id: CLICK_GESTURE_SCRIPT_ID,
      matches: ['<all_urls>'],
      js: ['contentScript.bundle.js'],
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
    }])
  } catch (error) {
    Logger.log('注册点击来源脚本失败', error)
  }
  // Registered scripts normally apply only on the next navigation. Backfill
  // already-open pages once per capture version; the script guards duplicates.
  if (!scripting.executeScript) return
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })
  await Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(async tab => {
    const tabId = tab.id as number
    try {
      const result = await scripting.executeScript({ target: { tabId }, func: () => (globalThis as { __taCaptureVersion?: string }).__taCaptureVersion === 'page-changes-v1' })
      if (result[0]?.result) return
      await scripting.executeScript({ target: { tabId, allFrames: true }, files: ['contentScript.bundle.js'] })
    } catch { /* Browser-protected or recently closed pages are skipped. */ }
  }))
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === CLEAR_AI_DECISION_LOG_MESSAGE) {
    void clearAiDecisionLog().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }))
    return true
  }

  /** 内容脚本上报的点击，只按发送方标签页保存，几秒后过期。 */
  if (message?.type === 'ta:click-gesture') {
    const sourceTabId = sender.tab?.id
    if (typeof sourceTabId === 'number') {
      const gesture = normalizeClickGesture(message.gesture)
      if (gesture) rememberClickGesture(sourceTabId, gesture)
    }
    return false
  }

  if (message?.type === 'ta:page-content-changed') {
    const tabId = sender.tab?.id
    if (typeof tabId === 'number' && sender.frameId === 0 && typeof message.url === 'string' &&
      typeof message.signature === 'string' && /^[0-9a-f]{1,8}$/.test(message.signature)) {
      void withAssistant(instance => instance.onPageContentChanged(tabId, message.url, message.signature))
    }
    return false
  }

  if (message !== EventNameEnum.RELOAD_RULE) return false

  void main()
    .then(() => sendResponse(EventNameEnum.RELOAD_SUCC))
    .catch(error => Logger.log('重新加载扩展配置失败', error))
  return true;
})
