import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { render } from 'react-dom';
import {
  QUICK_SEARCH_LOAD, QUICK_SEARCH_HISTORY, QUICK_SEARCH_OPEN, QUICK_SEARCH_CLOSE, QUICK_SEARCH_READY, QUICK_SEARCH_FOCUS, QUICK_SEARCH_FILTERS, prepareQuickSearch, searchQuickSearch, quickSearchKey, requestQuickSearch, quickSearchFallbackReason, quickSearchFaviconUrl, recoverQuickSearchHistoryTitles,
  type QuickSearchFilter, type QuickSearchHistory, type QuickSearchItem, type QuickSearchSnapshot,
} from '../../common/quickSearch';
import { quickSearchAppearance, quickSearchGlassVariables, type QuickSearchAppearance } from '../../common/quickSearchAppearance';
import { createSearchGlass, type SearchGlassController } from '../../common/glass';
import { useFilterMotion } from './useFilterMotion';
import './style.less';

const embedded = window.parent !== window;
const session = new URLSearchParams(window.location.search).get('session');
const fallback = embedded ? undefined : quickSearchFallbackReason(new URLSearchParams(window.location.search).get('fallback'));

const labels = {
  'zh-CN': {
    title: '快捷搜索', placeholder: '搜索标签页、收藏夹、历史记录…', all: '全部', tab: '标签页', bookmark: '收藏夹', history: '历史记录',
    loading: '正在读取搜索数据…', empty: '没有找到匹配结果', emptyHint: '试试标题中的关键词、域名或收藏夹名称',
    close: '关闭搜索', openTab: '切换标签', openBookmark: '新标签页打开', navigate: '选择', exit: '关闭',
    local: '本机搜索', results: '个结果', currentTab: '正在浏览', current: '本窗口标签', other: '其他窗口标签', types: '类型', error: '无法读取搜索数据，请重新唤出后重试。',
    missing: '这个标签、收藏或历史记录已不可用，搜索结果已刷新。', openError: '无法打开此结果，请选择其他项目。',
    bookmarksError: '暂时无法读取收藏夹，请重新加载扩展并检查收藏夹权限。',
    historyError: '暂时无法读取历史记录，请重新加载扩展并检查历史记录权限。', historyLoading: '正在搜索历史记录…', lastVisited: '最近访问：', untitledPage: '未获取网页标题',
    fallback: {
      'restricted-page': '此页面不允许网页内悬浮搜索，已使用独立窗口。',
      'no-active-tab': '未能定位当前标签页，已使用独立窗口。回到网页后按快捷键重试。',
      'permission-denied': '未获得此网页的访问权限，已使用独立窗口。请检查扩展对此网站的访问权限，重新加载扩展后重试。',
      'injection-failed': '网页内搜索未能启动，已使用独立窗口。请重新加载扩展后重试。',
      'frame-timeout': '网页内搜索界面未完成加载，已使用独立窗口。页面繁忙或加载被阻止，请重试。',
    },
  },
  'en-US': {
    title: 'Quick search', placeholder: 'Search tabs, bookmarks and history…', all: 'All', tab: 'Tabs', bookmark: 'Bookmarks', history: 'History',
    loading: 'Loading search data…', empty: 'No matching results', emptyHint: 'Try a title keyword, domain or bookmark folder',
    close: 'Close search', openTab: 'Switch to tab', openBookmark: 'Open in new tab', navigate: 'Select', exit: 'Close',
    local: 'Local search', results: 'results', currentTab: 'Currently viewing', current: 'Tab in this window', other: 'Tab in another window', types: 'Type', error: 'Could not load search data. Close and open search again.',
    missing: 'This tab, bookmark or history entry is no longer available. Results have been refreshed.', openError: 'Could not open this result. Choose another item.',
    bookmarksError: 'Bookmarks are unavailable. Reload the extension and check its bookmarks permission.',
    historyError: 'History is unavailable. Reload the extension and check its history permission.', historyLoading: 'Searching history…', lastVisited: 'Last visited:', untitledPage: 'Page title unavailable',
    fallback: {
      'restricted-page': 'This page does not allow an overlay. Search is using a separate window.',
      'no-active-tab': 'Could not locate the active tab. Return to the web page and try the shortcut again.',
      'permission-denied': 'Access to this page was denied. Check the extension’s site access, reload it and try again.',
      'injection-failed': 'Could not start search on the page. Reload the extension and try again.',
      'frame-timeout': 'The overlay did not finish loading. The page may be busy or may block it. Try again.',
    },
  },
};

function Icon({ kind }: { kind: 'search' | QuickSearchItem['kind'] }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    {kind === 'search' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>
      : kind === 'tab' ? <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 10h18m-14-3h.01M10 7h.01" /></>
        : kind === 'history' ? <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>
          : <path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1Z" />}
  </svg>;
}

function ResultIcon({ item }: { item: QuickSearchItem }) {
  const src = useMemo(() => quickSearchFaviconUrl(item.url), [item.url]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <>
    {!loaded && <Icon kind={item.kind} />}
    {src && !failed && <img className={`quick-search-favicon${loaded ? ' is-loaded' : ''}`} src={src} alt="" width="20" height="20"
      loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer"
      onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); setFailed(true); }} />}
  </>;
}

function HistoryVisitTime({ timestamp, label, formatter }: { timestamp?: number; label: string; formatter: Intl.DateTimeFormat }) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return <span className="quick-search-result-visited">
    {label} <time dateTime={date.toISOString()}>{formatter.format(date)}</time>
  </span>;
}

const QuickSearch = () => {
  const [snapshot, setSnapshot] = useState<QuickSearchSnapshot>();
  const [recentHistory, setRecentHistory] = useState<QuickSearchHistory>();
  const [matchedHistory, setMatchedHistory] = useState<{ query: string; data: QuickSearchHistory }>();
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historySearching, setHistorySearching] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<QuickSearchFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'load' | 'missing' | 'open'>();
  const [busy, setBusy] = useState(false);
  const [appearance, setAppearance] = useState<QuickSearchAppearance>();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const input = useRef<HTMLInputElement>(null);
  const windowSurface = useRef<HTMLDivElement>(null);
  const windowGlass = useRef<SearchGlassController>();
  const resultsViewport = useRef<HTMLDivElement>(null);
  const resultsList = useRef<HTMLDivElement>(null);
  const selection = useRef<HTMLDivElement>(null);
  const selectionBounds = useRef<{ top: number; height: number }>();
  const selectionContext = useRef<{ query: string; filter: QuickSearchFilter }>();
  const mousePosition = useRef<{ x: number; y: number }>();
  const composing = useRef(false);
  const acting = useRef(false);
  const closing = useRef(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  const readySent = useRef(false);
  const initiallyFocused = useRef(false);
  const language = snapshot?.language || (navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US');
  const t = labels[language];
  const visitTimeFormatter = useMemo(() => new Intl.DateTimeFormat(language, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }), [language]);
  const includeHistory = filter === 'all' || filter === 'history';
  const historyQuery = includeHistory ? query.trim() : '';
  const items = useMemo(() => {
    const history = new Map((recentHistory?.items || []).map(item => [item.key, item]));
    if (historyQuery && matchedHistory?.query === historyQuery) matchedHistory.data.items.forEach(item => history.set(item.key, item));
    const titledHistory = recoverQuickSearchHistoryTitles(Array.from(history.values()), [...(snapshot?.items || []), ...(recentHistory?.items || [])]);
    return [...(snapshot?.items || []), ...titledHistory];
  }, [snapshot?.items, recentHistory, matchedHistory, historyQuery]);
  const index = useMemo(() => prepareQuickSearch(items), [items]);
  const results = useMemo(() => searchQuickSearch(index, query, filter), [index, query, filter]);
  const active = Math.max(0, selectedKey ? results.findIndex(item => item.key === selectedKey) : 0);
  const counts = useMemo(() => items.reduce((total, item) => { total[item.kind]++; return total; }, { tab: 0, bookmark: 0, history: 0 }), [items]);
  const historyBusy = !recentHistory || historySearching;
  const listLoading = loading || includeHistory && historyBusy && !results.length;
  const historyUnavailable = recentHistory?.available === false || !!historyQuery && matchedHistory?.query === historyQuery && !matchedHistory.data.available;
  const searchAppearance = appearance || snapshot?.appearance;
  const theme = searchAppearance?.theme || 'system';
  const appearanceReady = searchAppearance !== undefined;
  const dark = theme === 'dark' || theme !== 'light' && systemDark;

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (embedded) {
      // Removing an embedded palette must never close its containing browser window.
      void requestQuickSearch(QUICK_SEARCH_CLOSE).catch(() => { closing.current = false; });
      return;
    }
    void chrome.tabs.getCurrent().then(tab => { if (tab?.id !== undefined) return chrome.tabs.remove(tab.id); }).catch(() => { closing.current = false; });
  }, []);

  const load = useCallback(async () => {
    const request = ++revision.current;
    try {
      const response = await requestQuickSearch(QUICK_SEARCH_LOAD);
      if (!mounted.current || request !== revision.current) return;
      if (!response.ok || !response.snapshot) throw new Error('load');
      setSnapshot(response.snapshot);
    } catch { if (mounted.current && request === revision.current) setError('load'); }
    finally { if (mounted.current && request === revision.current) setLoading(false); }
  }, []);

  useEffect(() => {
    let current = true;
    void requestQuickSearch(QUICK_SEARCH_HISTORY).then(response => {
      if (current) setRecentHistory(response.ok && response.history ? response.history : { items: [], available: false });
    }).catch(() => { if (current) setRecentHistory({ items: [], available: false }); });
    return () => { current = false; };
  }, [historyRevision]);

  useEffect(() => {
    if (!historyQuery) { setHistorySearching(false); return; }
    let current = true;
    setHistorySearching(true);
    // Local fuzzy results update immediately; only the browser-wide history lookup is debounced.
    const timer = setTimeout(() => {
      void requestQuickSearch(QUICK_SEARCH_HISTORY, { query: historyQuery }).then(response => {
        if (current) setMatchedHistory({ query: historyQuery, data: response.ok && response.history ? response.history : { items: [], available: false } });
      }).catch(() => { if (current) setMatchedHistory({ query: historyQuery, data: { items: [], available: false } }); })
        .finally(() => { if (current) setHistorySearching(false); });
    }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [historyQuery, historyRevision]);

  useEffect(() => {
    mounted.current = true;
    // Theme preparation is independent of collecting search data.
    void chrome.storage.sync.get('TA_SETTING').then(({ TA_SETTING }) => {
      if (mounted.current) setAppearance(quickSearchAppearance(TA_SETTING));
    }).catch(() => { if (mounted.current) setAppearance(quickSearchAppearance()); });
    const appearanceChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'sync' && changes.TA_SETTING && mounted.current) setAppearance(quickSearchAppearance(changes.TA_SETTING.newValue));
    };
    chrome.storage.onChanged.addListener(appearanceChanged);
    void load();
    const focus = (event: MessageEvent) => {
      if (embedded && session && event.source === window.parent && event.data?.type === QUICK_SEARCH_FOCUS && event.data.session === session && !closing.current) {
        input.current?.focus({ preventScroll: true });
      }
    };
    if (embedded) window.addEventListener('message', focus);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let historyTimer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void load(); }, 120); };
    const historyChanged = () => { if (historyTimer) clearTimeout(historyTimer); historyTimer = setTimeout(() => setHistoryRevision(value => value + 1), 250); };
    const tabChanged = (_id: number, info: chrome.tabs.TabChangeInfo) => { if (info.title !== undefined || info.url || info.status === 'complete' || info.groupId !== undefined) changed(); };
    const events = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onActivated, chrome.bookmarks?.onCreated, chrome.bookmarks?.onRemoved, chrome.bookmarks?.onChanged, chrome.bookmarks?.onMoved, chrome.bookmarks?.onChildrenReordered].filter(Boolean);
    events.forEach(event => (event as chrome.events.Event<() => void>).addListener(changed));
    const historyEvents = [chrome.history?.onVisited, chrome.history?.onVisitRemoved].filter(Boolean);
    historyEvents.forEach(event => (event as chrome.events.Event<() => void>).addListener(historyChanged));
    chrome.tabs.onUpdated.addListener(tabChanged);
    const blur = () => { if (!acting.current) close(); };
    if (!embedded) window.addEventListener('blur', blur);
    return () => {
      mounted.current = false;
      if (timer) clearTimeout(timer);
      if (historyTimer) clearTimeout(historyTimer);
      events.forEach(event => (event as chrome.events.Event<() => void>).removeListener(changed));
      historyEvents.forEach(event => (event as chrome.events.Event<() => void>).removeListener(historyChanged));
      chrome.tabs.onUpdated.removeListener(tabChanged);
      window.removeEventListener('blur', blur);
      window.removeEventListener('message', focus);
      chrome.storage.onChanged.removeListener(appearanceChanged);
    };
  }, [close, load]);

  useLayoutEffect(() => {
    const viewport = resultsViewport.current, list = resultsList.current, highlight = selection.current;
    if (!viewport || !list || !highlight) return;
    const row = listLoading ? null : document.getElementById(`quick-result-${active}`);
    const contextChanged = selectionContext.current?.query !== query || selectionContext.current?.filter !== filter;
    selectionContext.current = { query, filter };
    if (!row) {
      highlight.hidden = true;
      selectionBounds.current = undefined;
      return;
    }
    if (contextChanged) selectionBounds.current = undefined;
    const align = (animate: boolean, from?: { top: number; height: number }) => {
      const top = row.offsetTop, height = row.offsetHeight;
      const previous = selectionBounds.current;
      if (!height) return;
      if (!from && previous?.top === top && previous.height === height) return;
      if (from) {
        highlight.dataset.animate = 'false';
        highlight.style.transform = `translate3d(0, ${from.top}px, 0)`;
        highlight.style.height = `${from.height}px`;
        // Commit the compensated start before resuming the movement after a scroll.
        highlight.getBoundingClientRect();
      }
      highlight.dataset.animate = String(animate && !!previous);
      highlight.style.transform = `translate3d(0, ${top}px, 0)`;
      highlight.style.height = `${height}px`;
      highlight.hidden = false;
      selectionBounds.current = { top, height };
    };
    const rendered = selectionBounds.current ? highlight.getBoundingClientRect() : undefined;
    const fromTop = rendered ? rendered.top - list.getBoundingClientRect().top : 0;
    const oldScrollTop = viewport.scrollTop;
    // Only scroll vertically: scrollIntoView can shift the clipped stage during a horizontal slide.
    const viewportTop = viewport.getBoundingClientRect().top + viewport.clientTop;
    const rowTop = row.getBoundingClientRect().top - viewportTop + viewport.scrollTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < viewport.scrollTop) viewport.scrollTop = rowTop;
    else if (rowBottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = Math.min(rowTop, rowBottom - viewport.clientHeight);
    }
    const scrollDelta = viewport.scrollTop - oldScrollTop;
    align(true, rendered && scrollDelta ? { top: fromTop + scrollDelta, height: rendered.height } : undefined);
    const observer = new ResizeObserver(() => align(false));
    observer.observe(list);
    observer.observe(row);
    return () => observer.disconnect();
  }, [active, results, listLoading, query, filter]);
  const filterMotion = useFilterMotion(filter, resultsViewport);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.presentation = embedded ? 'overlay' : 'window';
    if (searchAppearance) {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.material = searchAppearance.quickSearchMaterial;
      Object.entries(quickSearchGlassVariables({ ...searchAppearance, theme: dark ? 'dark' : 'light' })).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));
    }
    document.documentElement.dataset.ready = String(appearanceReady);
    document.title = `TabAssistant · ${t.title}`;
    if (appearanceReady && !initiallyFocused.current) {
      initiallyFocused.current = true;
      input.current?.focus({ preventScroll: true });
    }
  }, [dark, language, t.title, appearanceReady, searchAppearance]);
  useLayoutEffect(() => {
    if (embedded || !windowSurface.current || !searchAppearance) return;
    const glass = createSearchGlass(windowSurface.current, { ...searchAppearance, theme: dark ? 'dark' : 'light' });
    windowGlass.current = glass;
    return () => { glass.destroy(); windowGlass.current = undefined; };
  }, [appearanceReady]);
  useLayoutEffect(() => {
    if (searchAppearance) windowGlass.current?.update({ ...searchAppearance, theme: dark ? 'dark' : 'light' });
  }, [searchAppearance, dark]);
  useEffect(() => {
    if (embedded && appearanceReady && !readySent.current) {
      readySent.current = true;
      void requestQuickSearch(QUICK_SEARCH_READY, { appearance: searchAppearance }).catch(() => {});
    }
  }, [appearanceReady]);

  const open = async (item: QuickSearchItem) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const response = await requestQuickSearch(QUICK_SEARCH_OPEN, { item: { kind: item.kind, id: item.id, ...(item.kind === 'history' ? { url: item.url } : {}) } });
      if (response.ok) { close(); return; }
      if (mounted.current) { setError(response.error === 'not-found' ? 'missing' : 'open'); setHistoryRevision(value => value + 1); await load(); }
    } catch { if (mounted.current) setError('open'); }
    finally { if (!closing.current) { acting.current = false; if (mounted.current) { setBusy(false); input.current?.focus(); } } }
  };

  const changeFilter = (kind: QuickSearchFilter, direction?: 1 | -1) => {
    if (kind !== filter) {
      filterMotion.prepareSlide(direction || (QUICK_SEARCH_FILTERS.indexOf(kind) > QUICK_SEARCH_FILTERS.indexOf(filter) ? 1 : -1));
      mousePosition.current = undefined;
      setFilter(kind);
      setSelectedKey(undefined);
    }
    input.current?.focus({ preventScroll: true });
  };

  const keyDown = (event: React.KeyboardEvent) => {
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)) return;
    const action = quickSearchKey(event.key, composing.current || event.nativeEvent.isComposing || event.keyCode === 229, active, results.length, filter);
    if (action.close) { event.preventDefault(); close(); }
    else if (action.filter) { event.preventDefault(); changeFilter(action.filter, event.key === 'ArrowRight' ? 1 : -1); }
    else if (action.select !== undefined) { event.preventDefault(); setSelectedKey(results[action.select]?.key); }
    else if (action.open && !busy) { event.preventDefault(); void open(results[active]); }
  };

  return <>
    {!embedded && <div ref={windowSurface} className="quick-search-window-surface" aria-hidden="true" />}
    <main className="quick-search" onKeyDown={event => { if (['Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key) && event.target !== input.current) keyDown(event); }}>
    <div className="quick-search-input-row">
      <span className="quick-search-lens"><Icon kind="search" /></span>
      <input ref={input} value={query} placeholder={t.placeholder} autoComplete="off" spellCheck={false} maxLength={160}
        role="combobox" aria-label={t.title} aria-expanded="true" aria-autocomplete="list" aria-controls="quick-search-results"
        aria-activedescendant={results.length ? `quick-result-${active}` : undefined}
        onChange={event => { setQuery(event.target.value); setSelectedKey(undefined); setError(undefined); }} onKeyDown={keyDown}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
      <button className="quick-search-escape" onClick={close} aria-label={t.close}>esc</button>
    </div>
    <div className="quick-search-toolbar">
      <div ref={filterMotion.filters} className="quick-search-filters" aria-label={t.title}>
        <div ref={filterMotion.highlight} className="quick-search-filter-selection" hidden aria-hidden="true" />
        {QUICK_SEARCH_FILTERS.map(kind => <button key={kind} className={filter === kind ? 'is-active' : ''}
          aria-pressed={filter === kind} onClick={() => changeFilter(kind)}>{t[kind]}<span>{kind === 'all' ? items.length : counts[kind]}</span></button>)}
      </div>
      <span className="quick-search-count" aria-live="polite">{results.length} {t.results}</span>
    </div>
    {error && <p className="quick-search-notice is-error" role="alert">{error === 'load' ? t.error : error === 'missing' ? t.missing : t.openError}</p>}
    {fallback && <p className="quick-search-notice" role="status">{t.fallback[fallback]}</p>}
    {snapshot && !snapshot.bookmarksAvailable && <p className="quick-search-notice" role="status">{t.bookmarksError}</p>}
    {includeHistory && historyUnavailable && <p className="quick-search-notice" role="status">{t.historyError}</p>}
    {includeHistory && historyBusy && !listLoading && <p className="quick-search-notice" role="status">{t.historyLoading}</p>}
    <div ref={filterMotion.stage} className="quick-search-results-stage">
    <div ref={resultsViewport} className="quick-search-results" id="quick-search-results" role="listbox" aria-label={t.title} aria-busy={listLoading || busy || includeHistory && historyBusy}
      onMouseLeave={() => { mousePosition.current = undefined; }}>
      <div ref={resultsList} className="quick-search-results-list" hidden={listLoading || !results.length} role="presentation">
        <div ref={selection} className="quick-search-selection" hidden aria-hidden="true" />
        {!listLoading && results.map((item, i) => <button id={`quick-result-${i}`} key={item.key} role="option" aria-selected={active === i} tabIndex={-1}
            className={`quick-search-result${active === i ? ' is-selected' : ''}${busy && active === i ? ' is-busy' : ''}`}
            onMouseDown={event => event.preventDefault()} onMouseMove={event => {
              const previous = mousePosition.current;
              if (previous?.x === event.clientX && previous.y === event.clientY) return;
              mousePosition.current = { x: event.clientX, y: event.clientY };
              if (!busy) setSelectedKey(item.key);
            }} onClick={() => void open(item)}>
            <span className={`quick-search-result-icon is-${item.kind}`}><ResultIcon key={item.url} item={item} /></span>
            <span className="quick-search-result-main">
              <strong title={item.title || item.url}>{item.title || (item.kind === 'history' ? t.untitledPage : item.url)}</strong>
              <span className="quick-search-result-url" title={item.url}>{item.url}</span>
              {(item.kind === 'bookmark' ? item.folder : item.group) && <span className="quick-search-result-context">{item.kind === 'bookmark' ? item.folder : item.group}</span>}
              {item.kind === 'history' && <HistoryVisitTime timestamp={item.lastAccessed} label={t.lastVisited} formatter={visitTimeFormatter} />}
            </span>
            <span className="quick-search-result-type">{item.kind === 'tab' ? item.currentWindow ? item.active ? t.currentTab : t.current : t.other : t[item.kind]}</span>
            <span className="quick-search-enter" aria-hidden="true">↵</span>
          </button>)}
      </div>
      {listLoading ? <div className="quick-search-empty"><span className="quick-search-spinner" /><p>{t.loading}</p></div>
        : !results.length ? <div className="quick-search-empty"><Icon kind="search" /><h2>{t.empty}</h2><p>{t.emptyHint}</p></div> : null}
    </div>
    </div>
    <footer className="quick-search-footer"><span className="quick-search-brand"><span />TabAssistant <small>{t.local}</small></span>
      <span className="quick-search-key-hints"><kbd>←</kbd><kbd>→</kbd><span>{t.types}</span><kbd>↑</kbd><kbd>↓</kbd><span>{t.navigate}</span><kbd>↵</kbd><span>{results[active] && results[active].kind !== 'tab' ? t.openBookmark : t.openTab}</span></span>
    </footer>
    </main>
  </>;
};

render(<QuickSearch />, document.getElementById('quick-search-root'));
