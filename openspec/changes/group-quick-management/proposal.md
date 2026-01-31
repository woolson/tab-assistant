# Proposal: Group Quick Management (分组快速管理)

## Summary
在 Popup 页面新增「分组管理」功能，展示当前所有窗口的分组列表，支持一键关闭分组（关闭分组内所有标签页）。

## Motivation
- **痛点**: 浏览器标签多了以后，分组也变多了，管理麻烦
- **痛点**: 删除不需要的分组时，需要一个个去右键关闭，效率低
- **痛点**: 想快速清理临时工作分组（如某个调研项目、临时代码库）

## Proposed Changes

### New Feature: Group Management Page
在 Popup 的 Tabs 中新增「分组管理」页面，复用被注释的「常用分组」Tab。

#### Functionality
1. **分组列表展示**
   - 显示当前所有窗口的分组
   - 每个分组显示：
     - 分组名称（带颜色标识）
     - 标签数量（如：GitHub - 12 个标签）
     - 所属窗口（窗口 ID 或序号）
   - 分组按窗口分组显示，或者统一列表显示

2. **快速关闭分组**
   - 每个分组旁边有「关闭」按钮
   - 关闭分组时：
     - 关闭该分组内的所有标签页
     - 分组自动消失
     - 可选提示：「确定关闭此分组？关闭将删除分组内的所有标签」

3. **批量操作**
   - 支持全选/取消全选分组
   - 批量关闭多个分组
   - 按窗口筛选：只显示某个窗口的分组
   - 按标签数量排序：快速找到标签少的分组

4. **分组统计**
   - 显示当前总分组数
   - 显示总标签数
   - 显示未分组标签数

### Technical Approach
- 使用 `chrome.tabGroups.query()` 获取所有分组
- 使用 `chrome.tabs.query({ groupId })` 获取分组内的标签数
- 关闭分组逻辑：先获取分组内所有标签，然后调用 `chrome.tabs.remove()`
- UI 组件：基于 Antd 的 List 或 Table 组件

## Impact
- **User Experience**: 大幅提升分组管理效率
- **Code Changes**: 新增一个 React 组件，修改 Popup 主页面
- **Risk**: 低 - 不影响现有功能

## Alternatives Considered
1. **直接使用浏览器原生功能**: 不够灵活，无法批量操作
2. **在规则页面添加**: 规则页面已经很复杂，不适合混入管理功能
3. **独立扩展**: 过度设计，现有 Popup 已够用

## Success Criteria
- [ ] 用户可以在 Popup 页面看到「分组管理」Tab
- [ ] 分组列表正确显示所有分组及标签数
- [ ] 一键关闭分组功能正常工作
- [ ] 批量操作功能可用
- [ ] 统计信息准确

## Related Issues
None

## References
- PID.md - 功能四：分组快速管理
- Chrome Tab Groups API: https://developer.chrome.com/docs/extensions/reference/tabGroups/
