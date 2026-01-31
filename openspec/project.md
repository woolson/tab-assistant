# Project Context - Tab Assistant

## Project Overview
- **Name**: Tab Assistant
- **Description**: Chrome 扩展 - 按规则自动化标签分组工具
- **Language**: TypeScript + React
- **Framework**: Chrome Extension Manifest V3
- **UI Library**: Ant Design (antd)
- **Build Tool**: Webpack

## Tech Stack
- **Frontend**: React 17, TypeScript
- **Styling**: UnoCSS, Less
- **State Management**: React Hooks (useState, useEffect, useCallback)
- **Chrome APIs**: `chrome.tabs`, `chrome.tabGroups`, `chrome.storage`, `chrome.windows`

## Project Structure
```
src/
├── pages/
│   ├── Background/    # 后台脚本（Service Worker）
│   └── Popup/         # Popup 页面（React）
├── common/           # 公共常量和工具
└── global.d.ts       # 类型声明
```

## Conventions
- **Commit Convention**: Conventional Commits (feat, fix, docs, etc.)
- **AI Identifier**: All AI-generated commits include `(ai: aidai) 🤔`
- **File Naming**: kebab-case for directories, PascalCase for components
- **Component Style**: Functional components with hooks
- **ESLint & Prettier**: Enabled, run `npm run prettier` to format

## Key Features
1. **自动分组**: 根据域名/正则规则自动将标签页分组
2. **分组管理**: 分组颜色、排序、多窗口支持、暗黑模式
3. **规则配置**: 拖拽排序、优先级、分组名关键字过滤
4. **配置管理**: 规则导出/导入、配置保存

## Active Change: Group Quick Management (分组快速管理)
- **Status**: In Progress
- **Priority**: P1
- **Description**: 在 Popup 页面新增分组管理功能，展示所有分组并支持一键关闭
