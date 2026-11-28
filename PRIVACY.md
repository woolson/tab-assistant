# TabAssistant 隐私政策

更新日期为 2026 年 11 月 27 日，适用于 1.8.0。

TabAssistant 由 Woolson Lee 提供，用于查找和整理浏览器标签页。本版在用户的浏览器中处理标签页、收藏夹、历史记录和扩展设置，不向开发者服务器上传这些数据。

## 处理哪些数据

- 标签页的标题、网址、窗口和分组信息，用于按规则分组、展示和搜索标签页。
- 收藏夹的标题、网址和文件夹路径，以及浏览历史的标题、网址和访问时间，用于用户主动打开的快捷搜索。
- 标签页最近被访问的时间和锁定状态，用于闲置清理和保护重要页面。自动关闭默认停用，可在设置中开启和调整时长。
- 用户配置的分组规则、主题、快捷搜索设置、面板尺寸，以及更新介绍的已读状态，用于保存用户选择。

本版未开放 AI 分组，不会为分组调用 AI 服务。扩展不读取账号密码或表单输入内容，不采集网页正文用于分组。

用户单独开启本机语义搜索后，扩展使用非无痕标签页、收藏夹和近期历史记录的标题、网址、分组名及收藏夹路径生成本地向量索引。未开启时不自动下载语义模型或建立该索引。

「索引页面内容」需单独开启。用户可以授权所有普通 HTTP(S) 网页，也可以只授权指定站点。两个开关都开启后，扩展在访问网页时读取可见标题、当前模块、业务字段和短摘要。其他已打开的标签页在系统空闲时按最近使用顺序分批补采。密码页面、表单输入和无痕窗口均跳过。历史记录用于关联已有摘要。

## 存储与保留

分组规则及部分设置使用浏览器自带的同步存储；是否同步到其他设备取决于用户的浏览器账号和同步设置。最近访问时间、面板尺寸和更新提醒状态保存在浏览器本地，标签页和分组锁定信息保存在浏览器会话存储中。

搜索使用浏览器已有的标签页、收藏夹和历史记录。扩展不会另行建立开发者服务器上的浏览历史或书签副本。已关闭标签页的闲置计时记录会随标签页清理，或在与当前标签页列表同步时清理。

本机语义搜索的必要元数据与向量保存在 IndexedDB，模型文件保存在浏览器本机缓存。索引、本机开启状态和模型不进入规则 JSON 导出或浏览器同步。关闭开关暂停建库并保留缓存；“清空模型与索引”可移除这些数据。删除历史记录、收藏或标签页时，相应来源的索引也会清理；同一地址的其他仍存在来源可继续保留。

页面摘要和对应向量保存在本机 IndexedDB。撤销站点访问权后，该授权产生的摘要与向量会清除。撤销全站访问权后，仍有单独授权的站点可以继续索引。

如果浏览器拒绝索引存储访问或写入失败，语义搜索可使用仅驻留于当前运行组件内存中的会话索引；设置会显示该状态和不含浏览内容的原生错误类型。会话索引随组件关闭而移除，不同步、不导出。持久化数据的清除仍取决于浏览器允许相应存储操作。

用户可以在扩展中更改规则和设置、关闭自动清理，并在浏览器中管理或删除书签、浏览历史及扩展数据。卸载扩展可移除其本地扩展数据；浏览器账号同步数据的管理由浏览器提供。

## 数据共享与网络请求

开发者不接收、出售或使用这些浏览数据进行广告投放、用户画像、信用评估或贷款决策，也不提供供开发者人员查看用户浏览数据的服务。

当用户主动选择网络搜索时，查询词会通过浏览器发送给用户已设置的默认搜索引擎。打开搜索结果时，浏览器会访问用户选择的网站。这些由用户发起的访问适用对应搜索引擎或网站的隐私政策。

浏览器自带的配置同步由浏览器服务提供。TabAssistant 不另行提供配置同步服务器。

首次开启本机语义搜索时，从 Hugging Face 下载固定版本的公开模型与分词器文件，约 136 MB。下载服务可接收 IP 地址等常规网络请求信息；下载请求不包含搜索词、标签页、收藏或历史记录内容。模型缓存后可在离线状态检索；向量计算和检索均在本机执行，不调用云端 AI API。

## 权限与用户控制

标签页和分组权限用于查找、分组和管理页面；收藏夹和历史记录权限用于快捷搜索；网站图标权限用于区分搜索结果；活动标签页和脚本权限用于用户主动打开的网页内搜索面板；搜索权限用于用户主动发起的默认引擎搜索；定时任务权限用于用户开启的闲置清理；存储和侧边栏权限用于保存配置和展示管理界面。

网页访问权限由用户在页面内容索引设置中主动授予。系统空闲权限只用于安排已打开标签页的分批补采。扩展执行的代码随安装包提供。

`offscreen` 权限用于让本机推理 Worker 在独立的扩展文档中运行，避免阻塞搜索界面。JavaScript 与 WebAssembly 运行时代码随扩展打包；在线下载的模型文件作为数据使用。

TabAssistant 对用户数据的使用遵守 Chrome 应用商店用户数据政策及其 Limited Use 要求，仅服务于向用户展示的标签页查找与整理功能。

## 联系方式

隐私问题可联系：woolson.lee@gmail.com。

---

# TabAssistant Privacy Policy

Updated November 27, 2026. Applies to version 1.8.0.

TabAssistant is provided by Woolson Lee to help users find and organize browser tabs. This version processes tabs, bookmarks, browsing history, and extension settings in the user's browser. It does not upload this information to developer-operated servers.

## Data handled

- Tab titles, URLs, windows, and groups, to organize and search open pages.
- Bookmark titles, URLs, and folder paths, and browsing-history titles, URLs, and visit times, for Quick Search when the user opens it.
- Recent tab access times and lock states, to close idle tabs and protect important pages. Automatic closing is off by default and can be configured in Settings.
- Grouping rules, appearance and search settings, panel size, and update-notice read state, to retain user preferences.

AI grouping is unavailable in this version, and the extension does not call AI services for grouping. It does not read passwords or form entries, or collect page body text for grouping.

Separately enabling on-device semantic search creates a local vector index from titles, URLs, group names, and bookmark folder paths for non-private tabs, bookmarks, and recent browsing history. The model download and indexing begin after opt-in.

Page content indexing has its own opt-in in Quick Search settings. You can authorize all ordinary HTTP(S) websites or choose individual sites. With both switches on, TabAssistant extracts visible headings, navigation context, business fields, and short excerpts as you visit authorized pages. It processes other open tabs in recent-use order, in small batches while your system is idle. The extension skips password pages, form entries, and private windows. Browser history links existing summaries to visits.

## Storage and retention

Grouping rules and some settings use the browser's built-in sync storage. Synchronization across devices depends on the user's browser account and sync settings. Recent access times, panel size, and update-notice state use local browser storage. Tab and group locks use browser session storage.

Search uses the tabs, bookmarks, and history already maintained by the browser. The extension does not create a developer-hosted copy of browsing history or bookmarks. Idle-time records for closed tabs are removed as tabs close or when records are reconciled with the current tab list.

Semantic metadata and vectors use local IndexedDB; models use the browser's local cache. The index, device opt-in and models are excluded from settings exports and browser sync. Switching off pauses indexing while retaining completed files. Clear model and index removes these local caches. Removing a tab, bookmark or history source also removes that source's index entry, including while paused; other surviving sources for the same URL may remain.

Page summaries and their vectors stay in local IndexedDB and are excluded from settings exports and sync. Turning off page content indexing pauses collection and content matches. Revoking site access removes summaries and vectors created under that authorization. When you revoke all-sites access, any separately authorized sites can still be indexed. A summary may be used by a matching tab, bookmark, or recent history entry while that source exists.

If the browser denies index storage access or a write fails, semantic search can use an in-memory session index. Settings reports this state and a native error category containing no browsing content. The session index is removed when its host closes and is neither synced nor exported. Clearing persistent data still requires the browser to allow the corresponding storage operation.

Users can change rules and settings, disable idle-tab closing, and manage or delete bookmarks, history, and extension data through their browser. Uninstalling removes local extension data. Browser-account sync data is managed through the browser's own controls.

## Sharing and network requests

The developer does not receive or sell this browsing data, use it for advertising, profiling, creditworthiness, or lending decisions, or provide developer personnel with a service for viewing it.

When a user explicitly chooses a web search, the browser sends the query to the user's default search engine. Opening a result visits the website chosen by the user. These user-initiated requests are subject to the search engine's or website's privacy policy.

Built-in configuration synchronization is provided by the browser. TabAssistant does not operate a separate synchronization server.

First enabling semantic search downloads about 136 MB of pinned public model/tokenizer data from Hugging Face. The host can receive normal network metadata such as the IP address; requests do not contain search queries, tabs, bookmarks or history data. Once cached, inference and retrieval can run offline on this device without a cloud AI API.

## Permissions and control

Tab and tab-group access supports finding and organizing pages. Bookmark and history access supports Quick Search. Favicon access displays result icons. Active-tab and scripting access displays the in-page search panel when requested by the user. Search access invokes the default engine at the user's request. Alarms support enabled idle-tab closing. Storage and side-panel access retain settings and display the management interface.

Website access is granted explicitly through the page content indexing settings. The idle permission schedules background indexing of open tabs. Executable code ships with the extension.

The offscreen permission hosts a dedicated local-inference worker without blocking search. JavaScript and WebAssembly runtime code ships inside the extension; downloaded model files are treated as data.

TabAssistant's use of user data follows the Chrome Web Store User Data Policy, including the Limited Use requirements, and is limited to its user-facing tab-finding and organization features.

## Contact

For privacy questions, contact woolson.lee@gmail.com.
