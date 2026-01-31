# Delta for Popup

## ADDED Requirements
### Requirement: Group Management Page
The system SHALL provide a group management page in the Popup interface.

#### Scenario: User opens group management
- WHEN a user clicks the "分组管理" tab
- THEN a list of all tab groups is displayed
- AND each group shows its name, color, tab count, and window

#### Scenario: User views group statistics
- WHEN the group management page is displayed
- THEN the total group count is shown
- AND the total tab count is shown
- AND the ungrouped tab count is shown

### Requirement: Quick Group Closure
The system SHALL allow users to close groups with a single click.

#### Scenario: User closes a group
- WHEN a user clicks the "关闭" button on a group
- THEN a confirmation prompt is displayed
- AND when confirmed, all tabs in the group are closed
- AND the group is removed from the list

### Requirement: Batch Operations
The system SHALL support batch operations on groups.

#### Scenario: User selects multiple groups
- WHEN a user checks multiple groups
- THEN a "批量关闭" button becomes available
- AND clicking it closes all selected groups

#### Scenario: User filters by window
- WHEN a user selects a window from the filter dropdown
- THEN only groups from that window are displayed

#### Scenario: User sorts by tab count
- WHEN a user clicks the "标签数" column header
- THEN groups are sorted by tab count in ascending order
- AND clicking again sorts in descending order

## ADDED Technical Specs
### Component: GroupManagement
- Location: `src/pages/Popup/GroupManagement/index.tsx`
- APIs used:
  - `chrome.tabGroups.query({ windowId })` - Get groups for a window
  - `chrome.tabs.query({ groupId })` - Get tabs in a group
  - `chrome.tabs.remove(tabIds)` - Close tabs in a group
- State: `groups` (array of GroupItem), `selectedGroupIds` (Set<string>)

### Interface: GroupItem
```typescript
interface GroupItem {
  id: number;
  title: string;
  color: string;
  windowId: number;
  tabCount: number;
  collapsed: boolean;
}
```

### Interface: GroupManagementStats
```typescript
interface GroupManagementStats {
  totalGroups: number;
  totalTabs: number;
  ungroupedTabs: number;
}
```
