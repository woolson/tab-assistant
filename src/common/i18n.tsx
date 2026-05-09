import React, { createContext, useContext } from 'react';
import type { Locale } from 'antd/es/locale';
import zhCN from 'antd/es/locale/zh_CN';
import enUS from 'antd/es/locale/en_US';

export type Language = 'zh-CN' | 'en-US';

const zhCNMessages = {
  appTitle: 'TabAssistant 标签分组助手',
  appDescription: '按规则自动化标签分组工具',
  tabCurrent: '当前标签',
  tabRules: '分组规则',
  tabSettings: '设置',
  tabAbout: '关于插件',
  languageSetting: '语言设置',
  languageSettingExtra: '设置插件弹窗界面的显示语言。',
  languageChinese: '简体中文',
  languageEnglish: 'English',
  save: '保存',
  updateSuccess: '更新成功',
  ruleUpdateSuccess: '规则更新成功',
  groupNameIgnoreWords: '分组名忽略词',
  groupNameIgnoreWordsExtra: '以域名命名分组时，会移除域名中对应的关键词，如：www.xxx.com 转换为 xxx.com。',
  ignoreWordsPlaceholder: '输入自定义忽略词，按 Enter 确认',
  pinnedTab: '固定标签',
  webPage: '网页',
  browserPage: '浏览器页面',
  extensionPage: '扩展页面',
  localFile: '本地文件',
  other: '其他',
  unnamedTab: '未命名标签页',
  ungrouped: '未分组',
  groupedTabsClosed: '分组标签页已关闭',
  tabClosed: '网页已关闭',
  selectedTabsClosed: '选中的标签页已关闭',
  name: '名称',
  count: '数量',
  actions: '操作',
  current: '当前',
  close: '关闭',
  closeGroupConfirm: '确认关闭这个分组下所有标签页吗?',
  closeTabConfirm: '确认关闭这个网页吗?',
  closeSelectedConfirm: '确认关闭选中的 {count} 个标签页吗?',
  collapseAll: '全部折叠',
  expandAll: '全部展开',
  closeSelected: '关闭选中',
  restoreClosedTab: '恢复关闭页面',
  batchActions: '批量操作',
  noTabs: '暂无标签页',
  grey: '灰色',
  blue: '蓝色',
  red: '红色',
  yellow: '黄色',
  green: '绿色',
  pink: '粉色',
  purple: '紫色',
  cyan: '青色',
  groupTitle: '分组标题',
  matchMode: '匹配模式',
  matchContent: '匹配内容',
  edit: '编辑',
  delete: '删除',
  deleteRuleConfirm: '确认删除这个规则吗?',
  addRule: '添加规则',
  refreshRules: '刷新规则',
  noRules: '暂无规则',
  editRule: '编辑规则',
  newRule: '新建规则',
  cancel: '取消',
  confirm: '确认',
  ruleNameRequired: '规则名称必填',
  groupTitlePlaceholder: '请输入分组标题',
  priority: '优先级',
  groupColor: '分组颜色',
  groupColorPlaceholder: '请选择分组颜色',
  matchModeRequired: '匹配模式必选',
  matchByDomain: '按域名分组',
  matchByRegExp: '按正则匹配',
  matchContentRequired: '匹配内容必填',
  insertCurrentDomain: '点击插入当前标签域名',
  regExpMatchTip: '匹配模式为按正则时支持填写正则表达式，如：(developer.chrome.com|chrome.google.com)',
  inputPlaceholder: '请输入',
  domain: '域名',
  regExp: '正则',
  settingsSaved: '设置保存成功',
  settingsImportFailed: '设置导入失败',
  currentVersion: '当前版本：',
  author: '作者：',
  changelog: '更新日志',
  feedback: '问题反馈',
  exportRulesSettings: '导出规则和设置',
  importRulesSettings: '导入规则和设置',
  newFeature: '新增功能：',
  etc: '其他：',
  changelog1301: '新增当前标签功能，可以快速批量管理当前浏览器窗口的所有分组和标签页',
  changelog1302: '支持英文界面',
  changelog1303: '语言默认跟随浏览器语言，并支持在其他设置中手动切换',
  changelog1304: '优化设置页英文表单布局',
  changelog1305: '优化当前标签和规则管理表格显示细节',
  changelog1201: '支持多窗口的标签页管理',
  changelog1202: '新增规则支持快捷读取当前标签页域名',
  changelog1203: '新增问题反馈渠道',
  changelog1204: '优化新增规则和忽略词配置体验',
  changelog1121: '修复暗色样式问题',
  changelog1111: '更新扩展相关文案',
  changelog1101: '支持一键全部折叠和全部展开',
  changelog1102: '支持分组拖动排序',
  changelog1103: '支持分组名忽略多个关键词',
  changelog1104: '支持配置内容导出和导入',
  changelog1105: '增加配置界面暗黑模式（和浏览器暗黑模式联动，不可手动更改）',
  changelog1106: '增加版本更新日志',
  changelog1107: '配置窗口样式细节优化，更精致',
  changelog1108: '更换插件的 Logo',
  changelog1109: '首次使用体验优化',
  changelog1110: '其他内部兼容性提升',
  changelog1001: '分组规则管理，新增标签页按规则自动分组',
  changelog1002: '为匹配到分组的标签页按域名分组，域名分组按字母排序',
  changelog1003: '配置忽略 www. 关键词',
};

const enUSMessages: Record<keyof typeof zhCNMessages, string> = {
  appTitle: 'TabAssistant Tab Grouping Helper',
  appDescription: 'Automatically group tabs by rules',
  tabCurrent: 'Current Tabs',
  tabRules: 'Rules',
  tabSettings: 'Settings',
  tabAbout: 'About',
  languageSetting: 'Language',
  languageSettingExtra: 'Set the display language for the extension popup.',
  languageChinese: '简体中文',
  languageEnglish: 'English',
  save: 'Save',
  updateSuccess: 'Updated successfully',
  ruleUpdateSuccess: 'Rules updated successfully',
  groupNameIgnoreWords: 'Ignored words',
  groupNameIgnoreWordsExtra: 'When a group is named by domain, matching keywords are removed. For example: www.xxx.com becomes xxx.com.',
  ignoreWordsPlaceholder: 'Enter custom ignored words, then press Enter',
  pinnedTab: 'Pinned tab',
  webPage: 'Web page',
  browserPage: 'Browser page',
  extensionPage: 'Extension page',
  localFile: 'Local file',
  other: 'Other',
  unnamedTab: 'Untitled tab',
  ungrouped: 'Ungrouped',
  groupedTabsClosed: 'Group tabs closed',
  tabClosed: 'Tab closed',
  selectedTabsClosed: 'Selected tabs closed',
  name: 'Name',
  count: 'Count',
  actions: 'Actions',
  current: 'Current',
  close: 'Close',
  closeGroupConfirm: 'Close all tabs in this group?',
  closeTabConfirm: 'Close this tab?',
  closeSelectedConfirm: 'Close the selected {count} tabs?',
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',
  closeSelected: 'Close selected',
  restoreClosedTab: 'Restore closed tab',
  batchActions: 'Batch actions',
  noTabs: 'No tabs',
  grey: 'Grey',
  blue: 'Blue',
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  pink: 'Pink',
  purple: 'Purple',
  cyan: 'Cyan',
  groupTitle: 'Group title',
  matchMode: 'Match mode',
  matchContent: 'Match content',
  edit: 'Edit',
  delete: 'Delete',
  deleteRuleConfirm: 'Delete this rule?',
  addRule: 'Add rule',
  refreshRules: 'Refresh rules',
  noRules: 'No rules',
  editRule: 'Edit rule',
  newRule: 'New rule',
  cancel: 'Cancel',
  confirm: 'Confirm',
  ruleNameRequired: 'Rule name is required',
  groupTitlePlaceholder: 'Enter group title',
  priority: 'Priority',
  groupColor: 'Group color',
  groupColorPlaceholder: 'Select a group color',
  matchModeRequired: 'Match mode is required',
  matchByDomain: 'Group by domain',
  matchByRegExp: 'Match by regular expression',
  matchContentRequired: 'Match content is required',
  insertCurrentDomain: 'Insert current tab domain',
  regExpMatchTip: 'Regular expression mode supports patterns such as: (developer.chrome.com|chrome.google.com)',
  inputPlaceholder: 'Enter',
  domain: 'Domain',
  regExp: 'RegExp',
  settingsSaved: 'Settings saved successfully',
  settingsImportFailed: 'Failed to import settings',
  currentVersion: 'Current version: ',
  author: 'Author: ',
  changelog: 'Changelog',
  feedback: 'Feedback',
  exportRulesSettings: 'Export rules and settings',
  importRulesSettings: 'Import rules and settings',
  newFeature: 'New features:',
  etc: 'Other:',
  changelog1301: 'Add Current Tabs for quickly managing all groups and tabs in the current browser window',
  changelog1302: 'Support English UI',
  changelog1303: 'Default to the browser language and support manual switching in Other Settings',
  changelog1304: 'Improve the settings form layout for English labels',
  changelog1305: 'Refine table display details for Current Tabs and Grouping Rules',
  changelog1201: 'Support tab management across multiple windows',
  changelog1202: 'Rules can quickly read the current tab domain',
  changelog1203: 'Add a feedback channel',
  changelog1204: 'Improve the experience for adding rules and ignored words',
  changelog1121: 'Fix dark mode styles',
  changelog1111: 'Update extension copy',
  changelog1101: 'Support one-click collapse all and expand all',
  changelog1102: 'Support drag sorting for groups',
  changelog1103: 'Support multiple ignored keywords in group names',
  changelog1104: 'Support importing and exporting configuration',
  changelog1105: 'Add dark mode for the settings UI, following browser dark mode',
  changelog1106: 'Add version changelog',
  changelog1107: 'Polish configuration window styling',
  changelog1108: 'Replace the extension logo',
  changelog1109: 'Improve first-use experience',
  changelog1110: 'Improve internal compatibility',
  changelog1001: 'Manage grouping rules and automatically group new tabs by rule',
  changelog1002: 'Group matched tabs by domain and sort domain groups alphabetically',
  changelog1003: 'Support ignoring the www. keyword',
};

export type TranslationKey = keyof typeof zhCNMessages;

export const messages = {
  'zh-CN': zhCNMessages,
  'en-US': enUSMessages,
};

export const antdLocales: Record<Language, Locale> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export const languageOptions: Array<{ value: Language; labelKey: TranslationKey }> = [
  { value: 'zh-CN', labelKey: 'languageChinese' },
  { value: 'en-US', labelKey: 'languageEnglish' },
];

export const getBrowserLanguage = (): Language => {
  const browserLanguage = navigator.language || navigator.languages?.[0] || '';
  return browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
};

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const defaultContext: I18nContextValue = {
  language: 'zh-CN',
  setLanguage: () => undefined,
  t: key => zhCNMessages[key],
};

const I18nContext = createContext<I18nContextValue>(defaultContext);

export const I18nProvider: React.FC<{
  language: Language;
  setLanguage: (language: Language) => void;
  children: React.ReactNode;
}> = ({ language, setLanguage, children }) => {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => {
    let text = messages[language][key] || zhCNMessages[key];
    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value));
      });
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => useContext(I18nContext);
