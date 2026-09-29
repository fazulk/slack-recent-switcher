'use strict';

// Slack owns its editor and search logic. Keep those nodes in React's tree and
// present its suggestions in our panel, preserving native ranking and actions.
module.exports = function mountSearch(render, initial) {
  window.__slackRecentsSearchCleanup?.();
  let query;
  let dialog;
  let nativeRows = [];
  let recentIndex = initial.index;
  let fallbackIndex = -1;
  let unreadOnly = false;
  let visible = initial.items;
  const team = location.pathname.match(/^\/client\/([TE][A-Z0-9]+)/)?.[1];
  let queryText = '';
  let scheduled = false;
  let closed = false;
  const marked = [];
  const signal = detail => window.dispatchEvent(new CustomEvent('slack-recents:search-ui', { detail: JSON.stringify(detail) }));
  const style = document.createElement('style');
  style.textContent = `
    .sr-search-path{background:transparent!important;border-color:transparent!important;box-shadow:none!important;pointer-events:none!important;overflow:visible!important;transform:none!important}
    .sr-search-path::before,.sr-search-path::after{display:none!important}
    .sr-search-path > :not(.sr-search-path):not([data-slack-recents-query]){opacity:0!important;pointer-events:none!important}
    .sr-search-top{z-index:2147483647!important;position:fixed!important;inset:0!important}
    [data-slack-recents-query]{position:fixed!important;left:var(--sr-left)!important;top:var(--sr-top)!important;width:var(--sr-width)!important;height:48px!important;min-height:0!important;max-height:48px!important;box-sizing:border-box!important;margin:0!important;padding:13px!important;background:transparent!important;border:0!important;outline:0!important;box-shadow:none!important;overflow:hidden!important;color:#24202d!important;caret-color:currentColor!important;font:14px/20px -apple-system,BlinkMacSystemFont,sans-serif!important;pointer-events:auto!important;opacity:1!important}
    [data-slack-recents-query]::before,[data-slack-recents-query]::after{display:none!important}
    @media(prefers-color-scheme:dark){[data-slack-recents-query]{color:#f3eff8!important}}
  `;
  document.head.append(style);
  // Unread state comes from Slack's own sidebar rows: treeitem[data-item-key=<channel id>] holding
  // .p-channel_sidebar__channel--unread, plus a numeric .c-badge when there are mentions.
  function readUnread() {
    const found = new Map();
    if (!team) return found;
    for (const row of document.querySelectorAll('[role="treeitem"][data-item-key]')) {
      const channel = row.getAttribute('data-item-key');
      if (!/^[CDG][A-Z0-9]+$/.test(channel) || !row.querySelector('.p-channel_sidebar__channel--unread')) continue;
      const label = row.querySelector('.p-channel_sidebar__name')?.textContent.trim();
      if (!label) continue;
      const badge = row.querySelector('.c-badge')?.textContent.trim() ?? '';
      found.set(channel, { key: `${team}/${channel}`, team, channel, label, workspace: '', unread: true, count: /^\d+$/.test(badge) ? Number(badge) : 0 });
    }
    return found;
  }
  function listItems() {
    const unread = readUnread();
    const marked = initial.items.map(item => item.team === team && unread.has(item.channel) ? { ...item, unread: true, count: unread.get(item.channel).count } : item);
    if (!unreadOnly) return marked;
    const shown = marked.filter(item => item.unread);
    const known = new Set(shown.map(item => item.key));
    return [...shown, ...[...unread.values()].filter(item => !known.has(item.key))];
  }
  function text() { return (query?.value ?? query?.textContent ?? '').trim(); }
  function position() {
    if (!query) return;
    const slot = document.getElementById('slack-recent-switcher-overlay')?.shadowRoot.querySelector('.query-slot');
    if (!slot) return;
    const rect = slot.getBoundingClientRect();
    query.style.setProperty('--sr-left', `${rect.left}px`);
    query.style.setProperty('--sr-top', `${rect.top}px`);
    query.style.setProperty('--sr-width', `${rect.width}px`);
  }
  function redraw() {
    if (closed) return;
    queryText = text();
    nativeRows = query && dialog ? [...dialog.querySelectorAll('[role="option"]')] : [];
    let selected = nativeRows.findIndex(row => row.getAttribute('aria-selected') === 'true');
    fallbackIndex = -1;
    // Slack may leave nothing selected while it shows an inline completion ("jane Doe — Open").
    // Highlight the first result whose label starts with what is typed, ignoring that completion.
    if (selected < 0 && queryText) {
      const typed = queryText.replace(/\s+—\s+\S+$/, '').toLowerCase();
      selected = fallbackIndex = nativeRows.findIndex(row => (row.getAttribute('aria-label') || row.textContent).trim().toLowerCase().startsWith(typed));
    }
    const items = queryText ? nativeRows.map(row => {
      const type = row.dataset.type || '';
      // Slack flags unread suggestions with a trailing "(has 1 notification)"; show our Unread label instead.
      const raw = row.getAttribute('aria-label') || row.textContent.trim();
      const flag = /\s*\(has [^)]*\)\s*$/i.exec(raw);
      const unread = flag ? { unread: true, count: Number(/\d+/.exec(flag[0])?.[0] ?? 0) } : {};
      return { label: flag ? raw.slice(0, flag.index) : raw, ...unread, icon: /channel/.test(type) ? '#' : /user|person|dm/.test(type) ? '@' : /file/.test(type) ? '▤' : '⌕' };
    }) : (visible = listItems());
    if (!queryText) recentIndex = visible.length ? Math.min(Math.max(recentIndex, 0), visible.length - 1) : 0;
    render({ ...initial, search: true, query: queryText, items, unreadOnly, tab: queryText ? undefined : unreadOnly ? 'all' : 'unread', index: queryText ? selected : recentIndex });
    position();
  }
  function attach() {
    const found = document.querySelector('[role="combobox"][data-feat="qs"]');
    if (query && !query.isConnected) { cleanup(); return; }
    if (found && found !== query) {
      query = found;
      dialog = query.closest('[role="dialog"]') || query.parentElement;
      query.setAttribute('data-slack-recents-query', '');
      for (let node = query.parentElement; node && node !== document.body; node = node.parentElement) {
        node.classList.add('sr-search-path'); marked.push(node);
      }
      marked.at(-1)?.classList.add('sr-search-top');
      query.addEventListener('input', redraw);
      clearTimeout(startupTimeout);
      // Tell the main process typing can start; it replays keys pressed while this was opening.
      query.focus();
      signal({ type: 'ready' });
    }
    redraw();
  }
  const observer = new MutationObserver(() => {
    if (scheduled || closed) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; attach(); });
  });
  // The overlay is outside body, so rendering it cannot feed this observer.
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-selected'] });
  function pick(index) {
    if (queryText) nativeRows[index]?.click();
    else if (visible[index]) signal({ type: 'pick', key: visible[index].key });
  }
  function keydown(event) {
    if (!query || event.isComposing) return;
    if (text() && event.key === 'Enter' && fallbackIndex >= 0) {
      // Slack has nothing selected, so Enter would ignore the row we highlighted. Open that row instead.
      event.preventDefault(); event.stopImmediatePropagation();
      pick(fallbackIndex);
    } else if (!text() && event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopImmediatePropagation();
      unreadOnly = !unreadOnly;
      recentIndex = unreadOnly ? 0 : initial.index;
      redraw();
    } else if (!text() && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Enter') pick(recentIndex);
      else if (visible.length) {
        recentIndex = (recentIndex + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
        redraw();
      }
    }
  }
  function click(event) {
    const row = event.target.closest?.('.row');
    if (row) pick(Number(row.dataset.index));
    else if (event.target.classList?.contains('backdrop')) signal({ type: 'close' });
    else query?.focus();
  }
  function cleanup() {
    if (closed) return;
    closed = true;
    clearTimeout(startupTimeout); observer.disconnect();
    window.removeEventListener('keydown', keydown, true);
    window.removeEventListener('resize', position);
    query?.removeEventListener('input', redraw);
    query?.removeAttribute('data-slack-recents-query');
    for (const property of ['--sr-left', '--sr-top', '--sr-width']) query?.style.removeProperty(property);
    for (const node of marked) node.classList.remove('sr-search-path', 'sr-search-top');
    style.remove(); render(null);
    window.__slackRecentsSearchCleanup = undefined;
    signal({ type: 'closed' });
  }
  window.__slackRecentsSearchCleanup = cleanup;
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('resize', position);
  const startupTimeout = setTimeout(() => { if (!query) { cleanup(); signal({ type: 'unavailable' }); } }, 5000);
  redraw();
  const root = document.getElementById('slack-recent-switcher-overlay').shadowRoot;
  root.addEventListener('mousedown', event => event.preventDefault());
  root.addEventListener('click', click);
  attach();
};
