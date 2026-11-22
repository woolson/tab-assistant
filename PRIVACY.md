# TabAssistant 隐私政策

更新日期：2026 年 11 月 22 日。适用版本：1.7.0。

TabAssistant 由 Woolson Lee 提供，用于查找和整理浏览器标签页。本版在用户的浏览器中处理标签页、收藏夹、历史记录和扩展设置，不向开发者服务器上传这些数据。

## 处理哪些数据

- 标签页的标题、网址、窗口和分组信息，用于按规则分组、展示和搜索标签页。
- 收藏夹的标题、网址和文件夹路径，以及浏览历史的标题、网址和访问时间，用于用户主动打开的快捷搜索。
- 标签页最近被访问的时间和锁定状态，用于闲置清理和保护重要页面。自动关闭默认停用，可在设置中开启和调整时长。
- 用户配置的分组规则、主题、快捷搜索设置、面板尺寸，以及更新介绍的已读状态，用于保存用户选择。

本版未开放 AI 分组，不会为分组调用 AI 服务。扩展不读取账号密码或表单输入内容，不采集网页正文用于分组。

## 存储与保留

分组规则及部分设置使用浏览器自带的同步存储；是否同步到其他设备取决于用户的浏览器账号和同步设置。最近访问时间、面板尺寸和更新提醒状态保存在浏览器本地，标签页和分组锁定信息保存在浏览器会话存储中。

搜索使用浏览器已有的标签页、收藏夹和历史记录。扩展不会另行建立开发者服务器上的浏览历史或书签副本。已关闭标签页的闲置计时记录会随标签页清理，或在与当前标签页列表同步时清理。

用户可以在扩展中更改规则和设置、关闭自动清理，并在浏览器中管理或删除书签、浏览历史及扩展数据。卸载扩展可移除其本地扩展数据；浏览器账号同步数据的管理由浏览器提供。

## 数据共享与网络请求

开发者不接收、出售或使用这些浏览数据进行广告投放、用户画像、信用评估或贷款决策，也不提供供开发者人员查看用户浏览数据的服务。

当用户主动选择网络搜索时，查询词会通过浏览器发送给用户已设置的默认搜索引擎。打开搜索结果时，浏览器会访问用户选择的网站。这些由用户发起的访问适用对应搜索引擎或网站的隐私政策。

浏览器自带的配置同步由浏览器服务提供。TabAssistant 不另行提供配置同步服务器。

## 权限与用户控制

标签页和分组权限用于查找、分组和管理页面；收藏夹和历史记录权限用于快捷搜索；网站图标权限用于区分搜索结果；活动标签页和脚本权限用于用户主动打开的网页内搜索面板；搜索权限用于用户主动发起的默认引擎搜索；定时任务权限用于用户开启的闲置清理；存储和侧边栏权限用于保存配置和展示管理界面。

本版不申请全站访问权限或网页导航监听权限。扩展执行的代码随安装包提供，不下载执行远程代码。

TabAssistant 对用户数据的使用遵守 Chrome 应用商店用户数据政策及其 Limited Use 要求，仅服务于向用户展示的标签页查找与整理功能。

## 联系方式

隐私问题可联系：woolson.lee@gmail.com。

---

# TabAssistant Privacy Policy

Updated November 22, 2026. Applies to version 1.7.0.

TabAssistant is provided by Woolson Lee to help users find and organize browser tabs. This version processes tabs, bookmarks, browsing history, and extension settings in the user's browser. It does not upload this information to developer-operated servers.

## Data handled

- Tab titles, URLs, windows, and groups, to organize and search open pages.
- Bookmark titles, URLs, and folder paths, and browsing-history titles, URLs, and visit times, for Quick Search when the user opens it.
- Recent tab access times and lock states, to close idle tabs and protect important pages. Automatic closing is off by default and can be configured in Settings.
- Grouping rules, appearance and search settings, panel size, and update-notice read state, to retain user preferences.

AI grouping is unavailable in this version, and the extension does not call AI services for grouping. It does not read passwords or form entries, or collect page body text for grouping.

## Storage and retention

Grouping rules and some settings use the browser's built-in sync storage. Synchronization across devices depends on the user's browser account and sync settings. Recent access times, panel size, and update-notice state use local browser storage. Tab and group locks use browser session storage.

Search uses the tabs, bookmarks, and history already maintained by the browser. The extension does not create a developer-hosted copy of browsing history or bookmarks. Idle-time records for closed tabs are removed as tabs close or when records are reconciled with the current tab list.

Users can change rules and settings, disable idle-tab closing, and manage or delete bookmarks, history, and extension data through their browser. Uninstalling removes local extension data. Browser-account sync data is managed through the browser's own controls.

## Sharing and network requests

The developer does not receive or sell this browsing data, use it for advertising, profiling, creditworthiness, or lending decisions, or provide developer personnel with a service for viewing it.

When a user explicitly chooses a web search, the browser sends the query to the user's default search engine. Opening a result visits the website chosen by the user. These user-initiated requests are subject to the search engine's or website's privacy policy.

Built-in configuration synchronization is provided by the browser. TabAssistant does not operate a separate synchronization server.

## Permissions and control

Tab and tab-group access supports finding and organizing pages. Bookmark and history access supports Quick Search. Favicon access displays result icons. Active-tab and scripting access displays the in-page search panel when requested by the user. Search access invokes the default engine at the user's request. Alarms support enabled idle-tab closing. Storage and side-panel access retain settings and display the management interface.

This version does not request all-sites access or web-navigation monitoring. Executable code is included in the installation package; the extension does not download and execute remote code.

TabAssistant's use of user data follows the Chrome Web Store User Data Policy, including the Limited Use requirements, and is limited to its user-facing tab-finding and organization features.

## Contact

For privacy questions, contact woolson.lee@gmail.com.
