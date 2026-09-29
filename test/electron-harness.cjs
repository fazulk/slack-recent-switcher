const { app, BrowserWindow, session, webContents, Menu, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const install = require('./src/runtime.cjs');
app.setPath('userData', process.env.SLACK_RECENTS_TEST_PROFILE);
const mac = process.platform === 'darwin';
const modifier = mac ? 'meta' : 'control';
const modifierKey = mac ? 'Meta' : 'Control';
const runtime = install({ app, webContents, BrowserWindow, ipcMain, Menu }, { test: true });
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const names = { C111: 'general', D222: 'Alex Morgan', G333: 'design-team', C999: 'ops-alerts' };
let window;
const navigations = [];
let nativeShortcutCount = 0;
let routeQueue = Promise.resolve();
async function visit(channel) {
  await window.webContents.executeJavaScript(`history.pushState({}, '', '/client/T123/${channel}');document.title=${JSON.stringify(`${names[channel]} - Acme - Slack`)};document.querySelector('h1').textContent=${JSON.stringify(names[channel])};`);
  await delay(100);
}
function opened(value) {
  const url = new URL(value);
  navigations.push(url.searchParams.get('id'));
  routeQueue = routeQueue.then(() => visit(url.searchParams.get('id')));
}
if (mac) app.on('open-url', (_event, value) => opened(value));
else app.on('second-instance', (_event, argv) => opened(argv.find(value => value.startsWith('slack://'))));
function input(type, keyCode, modifiers = []) { window.webContents.sendInputEvent({ type, keyCode, modifiers }); }
async function k(shift = false) {
  input('keyDown', 'K', [modifier, ...(shift ? ['shift'] : [])]);
  input('keyUp', 'K', [modifier, ...(shift ? ['shift'] : [])]);
  await delay(80);
  await runtime.painted();
}
async function release() {
  input('keyUp', modifierKey);
  await delay(100); await routeQueue; await runtime.painted();
}
async function checkOverlay() {
  return window.webContents.executeJavaScript(`(() => { const host=document.getElementById('slack-recent-switcher-overlay'); return host ? {text:host.shadowRoot.textContent, selected:host.shadowRoot.querySelector('[aria-selected="true"] .name')?.textContent, rows:[...host.shadowRoot.querySelectorAll('.row')].map(r=>r.querySelector('.name').textContent+(r.querySelector('.unread')?' ['+r.querySelector('.unread').textContent+']':''))} : null; })()`);
}
app.whenReady().then(async () => {
  // Serve the fixture locally through Electron; no requests go to Slack.
  session.defaultSession.protocol.handle('https', () => new Response('<!doctype html><html><head><meta charset="utf-8"><title>general - Acme - Slack</title><style>body{font:16px -apple-system;background:#efedf4;padding:50px;color:#61566f}h1{color:#302738}</style></head><body><small>Slack Recents · isolated integration fixture</small><h1>general</h1><p>The switcher runs in Slack’s Electron 44 runtime.</p><textarea placeholder="Draft message"></textarea></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Test', submenu: [
    { label: 'Original Command-K', accelerator: 'CommandOrControl+K', click() { nativeShortcutCount++; } },
    { label: 'Switch to Channel', accelerator: 'CommandOrControl+T', click() { window.webContents.executeJavaScript('window.showFixtureSearch()'); } }
  ] }]));
  window = new BrowserWindow({ width: 1050, height: 750, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await window.loadURL('https://app.slack.com/client/T123/C111');
  await window.webContents.executeJavaScript(`
    // Mirrors Slack's sidebar rows: treeitem[data-item-key] with an --unread channel element and a mention badge.
    const sidebar = document.createElement('div');
    for (const [key, name, unread, badge] of [['C111','general',false],['D222','Alex Morgan',false],['G333','design-team',true,'2'],['C999','ops-alerts',true],['Pfake','Drafts',true]]) {
      const row = document.createElement('div'); row.setAttribute('role','treeitem'); row.setAttribute('data-item-key', key);
      row.innerHTML = '<div class="p-channel_sidebar__channel' + (unread ? ' p-channel_sidebar__channel--unread' : '') + '"><span class="p-channel_sidebar__name">' + name + '</span>' + (badge ? '<span class="c-badge">' + badge + '</span>' : '') + '</div>';
      sidebar.append(row);
    }
    document.body.append(sidebar);
    window.showFixtureSearch = () => {
      const dialog = document.createElement('section'); dialog.id='native-search-fixture'; dialog.setAttribute('role','dialog');
      const input = document.createElement('input'); input.setAttribute('role','combobox'); input.dataset.feat='qs';
      const list = document.createElement('ol'); list.setAttribute('role','listbox');
      const all=['general','Alex Morgan','design-team','calendar.pdf','deploy-log (has 1 notification)'];
      let index=0; let filtered=all;
      const open = i => {window.openedFixtureResult=filtered[i];dialog.remove();document.querySelector('textarea').focus();};
      const render=()=>{list.replaceChildren(...filtered.map((label,i)=>{const row=document.createElement('li');row.textContent=label;row.setAttribute('role','option');row.setAttribute('aria-label',label);row.setAttribute('aria-selected',String(i===index));row.dataset.type=label.endsWith('.pdf')?'file':label.includes('Morgan')?'user':'channel';row.addEventListener('click',()=>open(i));return row}));};
      input.addEventListener('input',()=>{filtered=all.filter(x=>x.toLowerCase().includes(input.value.toLowerCase()));index=window.fixtureNoSelection?-1:0;render();});
      input.addEventListener('keydown', event=>{
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();index=(index+(event.key==='ArrowDown'?1:-1)+filtered.length)%filtered.length;render();}
        if(event.key==='Enter')open(index);
        if(event.key==='Escape'){dialog.remove();document.querySelector('textarea').focus();}
      });
      dialog.append(input,list);document.body.append(dialog);render();input.focus();
    }; undefined;
  `);
  await window.webContents.executeJavaScript(`window.pageShortcutCount=0;window.addEventListener('keydown', event => {if(event.${mac ? 'metaKey' : 'ctrlKey'}&&event.code==='KeyK')window.pageShortcutCount++;},true)`);
  window.show(); window.focus(); window.webContents.focus(); await delay(300);
  await visit('D222'); await visit('G333');
  assert.deepEqual(runtime.recents.items.map(x => x.channel), ['G333', 'D222', 'C111']);
  await window.webContents.executeJavaScript("document.querySelector('textarea').focus();document.querySelector('textarea').value='Unsent draft stays intact'");
  input('keyDown', modifierKey, [modifier]); await k();
  await delay(160); await runtime.painted();
  assert.equal((await checkOverlay()).selected, 'Alex Morgan');
  assert.equal(nativeShortcutCount, 0);
  await k(); assert.equal((await checkOverlay()).selected, 'general');
  await k(true); assert.equal((await checkOverlay()).selected, 'Alex Morgan');
  assert.ok((await checkOverlay()).text.includes(mac ? 'Hold ⌘' : 'Hold Ctrl'));
  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync(process.env.SLACK_RECENTS_SCREENSHOT, screenshot.toPNG());
  await release();
  assert.deepEqual(navigations, ['D222']); assert.equal(await checkOverlay(), null);
  assert.match(window.webContents.getURL(), /\/D222$/);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('textarea').value"), 'Unsent draft stays intact');
  input('keyDown', modifierKey, [modifier]); await k();
  await delay(160); await runtime.painted();
  assert.equal((await checkOverlay()).selected, 'design-team');
  input('keyDown', 'Escape', [modifier]); await release(); assert.equal(navigations.length, 1);
  // A quick tap keeps our panel open, with Slack's own editor and hidden results.
  input('keyDown', modifierKey, [modifier]); input('keyDown', 'K', [modifier]); input('keyUp', 'K', [modifier]); await release();
  assert.deepEqual(navigations, ['D222']);
  assert.equal(await window.webContents.executeJavaScript('document.activeElement.dataset.feat'), 'qs');
  assert.equal((await checkOverlay()).selected, 'design-team');
  await k(); assert.equal((await checkOverlay()).selected, 'general');
  await k(true); assert.equal((await checkOverlay()).selected, 'design-team');
  await release(); assert.ok(await checkOverlay());
  assert.equal(await window.webContents.executeJavaScript('getComputedStyle(document.querySelector("#native-search-fixture ol")).opacity'), '0');
  window.webContents.insertText('al'); await delay(100);
  assert.equal(await window.webContents.executeJavaScript('document.activeElement.value'), 'al');
  assert.equal((await checkOverlay()).selected, 'general');
  await k(); assert.equal((await checkOverlay()).selected, 'Alex Morgan');
  await k(); assert.equal((await checkOverlay()).selected, 'calendar.pdf');
  await k(true); assert.equal((await checkOverlay()).selected, 'Alex Morgan');
  await k(true); assert.equal((await checkOverlay()).selected, 'general');
  await release();
  assert.equal(await window.webContents.executeJavaScript('!!document.querySelector("#native-search-fixture")'), true);
  assert.equal(await window.webContents.executeJavaScript('document.activeElement.dataset.feat'), 'qs');
  input('keyDown', 'Return'); input('keyUp', 'Return'); await delay(100);
  assert.equal(await window.webContents.executeJavaScript('window.openedFixtureResult'), 'general');
  assert.equal(await checkOverlay(), null);
  // Empty-query Enter opens the selected recent, never native unread suggestions.
  input('keyDown', 'K', [modifier]); input('keyUp', 'K', [modifier]); await release();
  input('keyDown', 'Return'); input('keyUp', 'Return'); await delay(150); await routeQueue;
  assert.deepEqual(navigations, ['D222', 'G333']);
  assert.equal(await checkOverlay(), null);
  input('keyDown', 'K', [modifier]); input('keyUp', 'K', [modifier]); await release();
  assert.equal(await window.webContents.executeJavaScript('document.activeElement.dataset.feat'), 'qs');
  // Recents mark unread conversations; Tab toggles an unread-only view (sidebar order after recents) and back.
  assert.deepEqual((await checkOverlay()).rows, ['design-team [Unread · 2]', 'Alex Morgan', 'general']);
  input('keyDown', 'Tab'); input('keyUp', 'Tab'); await delay(100);
  let view = await checkOverlay();
  assert.deepEqual(view.rows, ['design-team [Unread · 2]', 'ops-alerts [Unread]']);
  assert.match(view.text, /Unread conversations/); assert.match(view.text, /Tab show all/);
  assert.equal(view.selected, 'design-team');
  input('keyDown', 'Down'); input('keyUp', 'Down'); await delay(100);
  assert.equal((await checkOverlay()).selected, 'ops-alerts');
  input('keyDown', 'Tab'); input('keyUp', 'Tab'); await delay(100);
  view = await checkOverlay();
  assert.match(view.text, /Recent conversations/); assert.match(view.text, /Tab unread only/);
  assert.equal(view.rows.length, 3);
  // Slack can leave nothing selected; a result starting with the typed text is highlighted anyway.
  await window.webContents.executeJavaScript('window.fixtureNoSelection = true');
  window.webContents.insertText('ale'); await delay(100);
  assert.equal((await checkOverlay()).selected, 'Alex Morgan');
  await window.webContents.executeJavaScript('window.fixtureNoSelection = false');
  // Slack's "(has 1 notification)" suffix becomes the Unread label instead of trailing text.
  await window.webContents.executeJavaScript(`(() => { const q = document.querySelector('[data-feat=qs]'); q.value = 'deploy'; q.dispatchEvent(new Event('input')); })()`); await delay(100);
  assert.deepEqual((await checkOverlay()).rows, ['deploy-log [Unread · 1]']);
  await window.webContents.executeJavaScript('window.fixtureNoSelection = true');
  await window.webContents.executeJavaScript(`(() => { const q = document.querySelector('[data-feat=qs]'); q.value = 'ale'; q.dispatchEvent(new Event('input')); })()`); await delay(100);
  input('keyDown', 'Return'); input('keyUp', 'Return'); await delay(150);
  assert.equal(await window.webContents.executeJavaScript('window.openedFixtureResult'), 'Alex Morgan', 'Enter opens the highlighted match');
  await window.webContents.executeJavaScript('window.fixtureNoSelection = false');
  await window.webContents.executeJavaScript('document.querySelector("#native-search-fixture")?.remove()'); await delay(80);
  input('keyDown', 'K', [modifier]); assert.ok(runtime.active, 'Removing native search must restore the recent switcher');
  input('keyDown', 'Escape'); input('keyUp', 'Escape');
  assert.equal(await checkOverlay(), null); assert.equal(nativeShortcutCount, 0);
  assert.equal(await window.webContents.executeJavaScript('window.pageShortcutCount'), 0);
  runtime.flush();
  console.log('PASS: Electron integration: hold/cycle/release, custom search panel, hidden native panel, recent/channel/person/file suggestions, forward/reverse selection, Enter, cleanup and draft preservation.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('Electron test timed out'); app.exit(1); }, 45000).unref();
