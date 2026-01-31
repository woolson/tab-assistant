# Tasks: Group Quick Management

## 1. Project Setup
- [x] 1.1 创建 OpenSpec 目录结构
- [x] 1.2 初始化 AGENTS.md 和 project.md
- [x] 1.3 验证 OpenSpec 工作流

## 2. Create Group Management Component
- [x] 2.1 创建 `src/pages/Popup/GroupManagement/index.tsx`
- [x] 2.2 创建样式文件 `src/pages/Popup/GroupManagement/style.less`
- [x] 2.3 定义 TypeScript 接口

## 3. Implement Group Query Logic
- [x] 3.1 调用 `chrome.tabGroups.query()` 获取所有分组
- [x] 3.2 调用 `chrome.tabs.query({ groupId })` 获取分组内的标签数
- [x] 3.3 按窗口分组分组数据
- [x] 3.4 计算统计数据（总分组数、总标签数、未分组标签数）

## 4. Implement UI
- [x] 4.1 显示分组列表（使用 Antd List 或 Table）
- [x] 4.2 显示分组名称（带颜色标识）
- [x] 4.3 显示标签数量和所属窗口
- [x] 4.4 添加关闭按钮到每个分组
- [x] 4.5 添加统计信息区域

## 5. Implement Close Group Function
- [x] 5.1 实现单个分组关闭逻辑
- [x] 5.2 添加确认弹窗
- [x] 5.3 关闭后刷新列表

## 6. Implement Batch Operations
- [x] 6.1 添加全选/取消全选功能
- [x] 6.2 实现批量关闭逻辑
- [x] 6.3 添加窗口筛选下拉框
- [x] 6.4 添加标签数量排序功能

## 7. Integrate to Popup
- [x] 7.1 在 `src/pages/Popup/index.tsx` 中添加「分组管理」Tab
- [x] 7.2 导入 GroupManagement 组件
- [x] 7.3 测试 Popup 显示

## 8. Testing & Refinement
- [x] 8.1 测试分组列表正确显示
- [x] 8.2 测试关闭分组功能
- [x] 8.3 测试批量操作功能
- [x] 8.4 测试统计信息准确性
- [x] 8.5 测试多窗口场景
- [x] 8.6 测试暗黑模式

## 9. Code Quality
- [x] 9.1 运行 ESLint 检查
- [x] 9.2 运行 Prettier 格式化
- [x] 9.3 编写必要的注释
- [x] 9.4 代码审查

## 10. Documentation
- [x] 10.1 更新 README.md（如有需要）
- [x] 10.2 更新 PID.md（标记功能已实现）
- [x] 10.3 准备提交信息

## 11. Git & PR
- [x] 11.1 提交代码：`feat: add group management page (ai: aidai) 🤔`
- [ ] 11.2 推送到远程 (需要手动执行：git push，网络问题待解决)
- [ ] 11.3 创建/更新 Pull Request
