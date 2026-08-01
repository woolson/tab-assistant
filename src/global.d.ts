declare module "*.svg";
declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";

declare interface Window {
  main: any
}

declare namespace chrome.sidePanel {
  interface PanelBehavior {
    openPanelOnActionClick: boolean;
  }

  interface OpenOptions {
    tabId?: number;
    windowId?: number;
  }

  function open(options: OpenOptions): Promise<void>;
  function setPanelBehavior(behavior: PanelBehavior): Promise<void>;
}
