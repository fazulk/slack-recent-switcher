'use strict';
const { ipcRenderer } = require('electron');
let active = false;
const mac = process.platform === 'darwin';
ipcRenderer.on('slack-recents:active', (_event, value) => { active = value === true; });
// Cancel the DOM shortcut, not the native key-down. Chromium otherwise suppresses
// the subsequent Command key-up, which is needed to commit the selected item.
function suppressShortcut(event) {
  if (location.protocol !== 'https:' || !/(^|\.)slack\.com$/.test(location.hostname) || !location.pathname.startsWith('/client/')) return;
  const chord = (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey && (event.code === 'KeyK' || event.key.toLowerCase() === 'k');
  if (chord || (active && ['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key))) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
window.addEventListener('keydown', suppressShortcut, true);
window.addEventListener('keyup', suppressShortcut, true);
window.addEventListener('slack-recents:search-ui', event => {
  if (location.protocol !== 'https:' || !/(^|\.)slack\.com$/.test(location.hostname) || !location.pathname.startsWith('/client/')) return;
  if (typeof event.detail !== 'string' || event.detail.length > 300) return;
  try {
    const detail = JSON.parse(event.detail);
    if (['ready', 'pick', 'close', 'closed', 'unavailable'].includes(detail.type)) ipcRenderer.send('slack-recents:search-ui', detail);
  } catch { /* Ignore malformed page events. */ }
});

let searchOpen = false;
let searchElement;
const searchObserver = new MutationObserver(() => {
  if (!searchElement?.isConnected) reportSearch();
});
function reportSearch() {
  searchElement = document.querySelector('[role="combobox"][data-feat="qs"]');
  const opened = !!searchElement;
  if (opened !== searchOpen) {
    searchOpen = opened;
    ipcRenderer.send('slack-recents:native-search', opened);
    searchObserver.disconnect();
    if (opened) searchObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
}
window.addEventListener('focusin', reportSearch, true);
window.addEventListener('focusout', () => queueMicrotask(reportSearch), true);
window.addEventListener('keyup', event => {
  if (event.key === 'Escape' || event.key === 'Enter') setTimeout(reportSearch, 0);
}, true);
