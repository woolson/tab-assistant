export enum EventNameEnum {
  /** 重新加载规则 */
  RELOAD_RULE = "TA_RELOAD_RULE",
  /** 重新加载规则成功 */
  RELOAD_SUCC = "TA_RELOAD_SUCC"
}

export enum StorageKeyEnum {
  /** 规则 */
  RULES = 'TAB_ASSISTANT_RULES',
  /** 设置 */
  SETTING = 'TA_SETTING',
  /** 侧边栏功能升级引导是否待展示（仅存储在本机） */
  SIDE_PANEL_GUIDE_PENDING = 'TA_SIDE_PANEL_GUIDE_PENDING'
}
