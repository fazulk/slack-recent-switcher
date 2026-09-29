'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Recents, Cycle, conversationFromURL, deepLink } = require('./core.cjs');
const renderSwitcher = require('./overlay.cjs');
const mountSearch = require('./search-ui.cjs');
const { shortcut } = require('./platform.cjs');

module.exports = function install({ app, webContents, ipcMain, Menu, BrowserWindow }, options = {}) {
  const holdDelay = 220;
  const now = options.now ?? Date.now;
  const platform = options.platform ?? process.platform;
  const keys = shortcut(platform);
  const dataFile = path.join(app.getPath('userData'), 'recent-conversations.json');
  let saved = [];
  try { saved = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[Slack Recents] Could not read history:', error.message);
  }
  const recents = new Recents(saved);
  const attached = new WeakSet();
  const sessions = new WeakSet();
  const current = new Map();
  const nativeSearch = new Set();
  const customSearch = new Map();
  // Keys typed between the Cmd-K tap and Slack's search box being focused. Replayed once it is ready.
  const pendingSearch = new Map();
  let active = null;
  let showTimer;
  let saveTimer;
  let dirty = false;
  let paintQueue = Promise.resolve();

  function flush() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      fs.writeFileSync(`${dataFile}.tmp`, JSON.stringify(recents.items, null, 2), { mode: 0o600 });
      fs.renameSync(`${dataFile}.tmp`, dataFile);
      dirty = false;
    } catch (error) { console.warn('[Slack Recents] Could not save history:', error.message); }
  }
  function save() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); saveTimer.unref?.(); }
  function paint(contents, state) {
    // Keep show/advance/hide ordered, including a quick Cmd-K key-up before rendering finishes.
    const script = `(${renderSwitcher.toString()})(${JSON.stringify(state)})`;
    paintQueue = paintQueue.then(() => {
      if (!contents.isDestroyed()) return contents.executeJavaScript(script);
    }).catch(error => console.warn('[Slack Recents] Overlay:', error.message));
  }
  function show() {
    if (!active) return;
    const { contents, cycle, currentKey } = active;
    clearTimeout(showTimer);
    paint(contents, { items: cycle.items, index: cycle.index, currentKey, modifier: keys.label });
  }
  function keyStroke(contents, keyCode, modifiers = []) {
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }
  function openSearch(contents) {
    nativeSearch.add(contents.id);
    const currentKey = current.get(contents.id)?.key;
    const cycle = new Cycle(recents.snapshot(currentKey), currentKey);
    customSearch.set(contents.id, cycle.items);
    pendingSearch.set(contents.id, '');
    // macOS menu accelerators do not reliably run for sendInputEvent. Invoke the
    // original menu item's action, preserving Slack's real search implementation.
    paintQueue = paintQueue.then(async () => {
      if (contents.isDestroyed()) return;
      await contents.executeJavaScript(`(${mountSearch.toString()})(${renderSwitcher.toString()}, ${JSON.stringify({ items: cycle.items, index: cycle.index, currentKey, modifier: keys.label })})`);
      function items(menu) { return (menu?.items ?? []).flatMap(item => [item, ...items(item.submenu)]); }
      const candidates = items(Menu?.getApplicationMenu()).filter(item => item.enabled !== false && typeof item.click === 'function');
      const accelerator = key => candidates.find(item => new RegExp(`^(?:${keys.menuPattern})\\+${key}$`, 'i').test(item.accelerator ?? ''));
      const item = accelerator('t') ?? accelerator('k') ?? candidates.find(item => item.label?.replaceAll('&', '') === 'Switch to Channel');
      if (item) item.click(item, BrowserWindow.fromWebContents(contents) ?? BrowserWindow.getFocusedWindow(), { triggeredByAccelerator: true });
      else keyStroke(contents, 'T', [keys.modifier]);
    }).catch(error => {
      nativeSearch.delete(contents.id); customSearch.delete(contents.id); pendingSearch.delete(contents.id);
      console.warn('[Slack Recents] Search:', error.message);
    });
  }
  function workspaceOf(contents) {
    try {
      const url = new URL(contents.getURL());
      return /(^|\.)slack\.com$/.test(url.hostname) ? url.pathname.match(/^\/client\/([TE][A-Z0-9]+)/)?.[1] : undefined;
    } catch { return undefined; }
  }
  function navigate(item) {
    const url = deepLink(item);
    // Slack handles protocol activations via open-url on macOS and argv elsewhere.
    // Dispatch inside this process so the official Slack app cannot steal the link.
    if (platform === 'darwin') app.emit('open-url', { preventDefault() {} }, url);
    else app.emit('second-instance', { preventDefault() {} }, [process.execPath, url], process.cwd(), {});
  }
  function finish(commit) {
    if (!active) return;
    clearTimeout(showTimer);
    const { contents, cycle, currentKey } = active;
    active = null;
    if (!contents.isDestroyed()) {
      contents.setIgnoreMenuShortcuts(false);
      contents.send('slack-recents:active', false);
    }
    paint(contents, null);
    const item = cycle.selected;
    if (commit && item && item.key !== currentKey) {
      navigate(item);
    }
  }
  function visit(contents, url, mainFrame = true) {
    if (!mainFrame) return;
    const conversation = conversationFromURL(url);
    const previous = current.get(contents.id);
    if (!conversation) { current.delete(contents.id); return; }
    current.set(contents.id, conversation);
    if (conversation.key !== previous?.key && contents.isFocused()) {
      if (active) finish(false);
      // Navigation often precedes the title change. Never assign the previous conversation's title.
      recents.visit(conversation);
      save();
    }
  }
  function focused(contents) {
    const conversation = conversationFromURL(contents.getURL());
    if (!conversation) return;
    current.set(contents.id, conversation);
    recents.visit(conversation, contents.getTitle());
    save();
  }
  function attach(contents) {
    if (attached.has(contents)) return;
    attached.add(contents);
    if (!sessions.has(contents.session)) {
      contents.session.registerPreloadScript({ type: 'frame', id: 'slack-recents', filePath: path.join(__dirname, 'preload.cjs') });
      sessions.add(contents.session);
    }
    visit(contents, contents.getURL());
    contents.on('did-navigate', (_event, url) => visit(contents, url));
    contents.on('did-navigate-in-page', (_event, url, mainFrame) => visit(contents, url, mainFrame));
    contents.on('page-title-updated', (_event, title) => {
      const conversation = current.get(contents.id);
      if (conversation) { recents.rename(conversation, title); save(); }
    });
    contents.on('focus', () => focused(contents));
    contents.on('blur', () => { if (active?.contents === contents) finish(false); });
    contents.on('destroyed', () => { if (active?.contents === contents) finish(false); current.delete(contents.id); nativeSearch.delete(contents.id); customSearch.delete(contents.id); pendingSearch.delete(contents.id); });
    contents.prependListener('before-input-event', (event, input) => {
      const isChord = keys.isChord(input);
      if (isChord && (conversationFromURL(contents.getURL()) || /^https:\/\/(?:[^/]+\.)?slack\.com\/client\//.test(contents.getURL()))) {
        if (input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing) return;
        contents.setIgnoreMenuShortcuts(true);
        if (nativeSearch.has(contents.id)) {
          keyStroke(contents, input.shift ? 'Up' : 'Down');
          return;
        }
        if (active && active.contents !== contents) finish(false);
        if (!active) {
          focused(contents);
          const currentKey = current.get(contents.id)?.key;
          active = { contents, currentKey, startedAt: now(), presses: 1, cycle: new Cycle(recents.snapshot(currentKey), currentKey, input.shift) };
          contents.send('slack-recents:active', true);
          showTimer = setTimeout(show, holdDelay);
        } else {
          active.presses++;
          active.cycle.step(input.shift ? -1 : 1);
          clearTimeout(showTimer);
          show();
        }
        return;
      }
      if (pendingSearch.has(contents.id) && input.type === 'keyDown' && !input.isComposing) {
        // Slack's search box is still opening. Hold typed characters instead of letting them
        // reach the page (where they would be lost or land in the message composer).
        const typed = pendingSearch.get(contents.id);
        const plain = !input.control && !input.meta && !input.alt;
        if (plain && [...(input.key ?? '')].length === 1) { event.preventDefault(); pendingSearch.set(contents.id, typed + input.key); return; }
        if (plain && input.key === 'Backspace') { event.preventDefault(); pendingSearch.set(contents.id, [...typed].slice(0, -1).join('')); return; }
        // Never let Enter submit a draft in the composer while the search box is not ready.
        if (plain && input.key === 'Enter') { event.preventDefault(); return; }
      }
      const releasedCommand = keys.isRelease(input);
      if (releasedCommand && nativeSearch.has(contents.id)) contents.setIgnoreMenuShortcuts(false);
      if (!active || active.contents !== contents) return;
      if (releasedCommand) {
        const tapped = active.presses === 1 && now() - active.startedAt < holdDelay;
        finish(!tapped);
        if (tapped) openSearch(contents);
      } else if (input.key === 'Escape') {
        event.preventDefault(); if (input.type === 'keyDown') finish(false);
      } else if (['ArrowDown', 'ArrowUp'].includes(input.key)) {
        if (input.type === 'keyDown') { active.presses++; active.cycle.step(input.key === 'ArrowDown' ? 1 : -1); show(); }
      }
    });
  }
  ipcMain.on('slack-recents:native-search', (event, opened) => {
    const contents = event.sender;
    if (!attached.has(contents) || contents.isDestroyed()) return;
    if (opened === true) nativeSearch.add(contents.id);
    else {
      nativeSearch.delete(contents.id);
      if (active?.contents !== contents) contents.setIgnoreMenuShortcuts(false);
    }
  });
  ipcMain.on('slack-recents:search-ui', (event, detail) => {
    const contents = event.sender;
    if (!attached.has(contents) || contents.isDestroyed() || !customSearch.has(contents.id) || !detail) return;
    if (detail.type === 'ready') {
      const typed = pendingSearch.get(contents.id);
      pendingSearch.delete(contents.id);
      if (typed) contents.insertText(typed);
    } else if (detail.type === 'pick' || detail.type === 'close') {
      // Unread conversations come from Slack's sidebar, not our history: accept well-formed ones in this workspace.
      const sidebar = /^([TE][A-Z0-9]+)\/([CDG][A-Z0-9]+)$/.exec(detail.key);
      const item = customSearch.get(contents.id).find(item => item.key === detail.key) ??
        (sidebar && sidebar[1] === workspaceOf(contents) ? { key: detail.key, team: sidebar[1], channel: sidebar[2] } : undefined);
      if (detail.type === 'pick' && !item) return;
      keyStroke(contents, 'Escape');
      if (item && item.key !== current.get(contents.id)?.key) navigate(item);
    } else if (detail.type === 'closed') {
      customSearch.delete(contents.id); nativeSearch.delete(contents.id); pendingSearch.delete(contents.id);
      contents.setIgnoreMenuShortcuts(false);
    }
  });
  app.on('web-contents-created', (_event, contents) => attach(contents));
  app.on('browser-window-blur', () => finish(false));
  app.on('browser-window-focus', (_event, window) => {
    const contents = webContents.getFocusedWebContents() ?? window.webContents;
    if (contents) focused(contents);
  });
  app.on('before-quit', flush);
  app.whenReady().then(() => webContents.getAllWebContents().forEach(attach));
  // Used only by the isolated Electron test harness.
  if (options.test) return { recents, flush, get active() { return active; }, painted: () => paintQueue };
};
