'use strict';
// Runs inside the isolated Electron fixture (see screenshots.mjs). All names below are fictional.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const renderSwitcher = require('./src/overlay.cjs');

app.setPath('userData', process.env.SLACK_RECENTS_TEST_PROFILE);
const out = process.env.SLACK_RECENTS_SHOTS;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const item = (channel, label, extra = {}) => ({ key: `T1/${channel}`, team: 'T1', channel, label, workspace: 'Acme', ...extra });
const recents = [
  item('C001', 'product-design'),
  item('D002', 'Jane Doe', { unread: true, count: 2 }),
  item('C003', 'launch-planning', { unread: true }),
  item('D004', 'Sam Rivera'),
  item('C005', 'eng-standup', { unread: true, count: 1 }),
  item('D006', 'Priya Patel')
];
const modifier = '⌘';
const shots = {
  'recents': { theme: 'dark', state: { search: true, query: '', items: recents, index: 1, currentKey: 'T1/C001', modifier, tab: 'unread' } },
  'unread': { theme: 'dark', state: { search: true, query: '', unreadOnly: true, items: recents.filter(x => x.unread), index: 0, currentKey: 'T1/C001', modifier, tab: 'all' } },
  'search': { theme: 'dark', typed: 'jane', state: { search: true, query: 'jane', index: 0, currentKey: 'T1/C001', modifier, items: [
    { label: 'Jane Doe', unread: true, count: 1, icon: '@' }, { label: 'Jane Doe, Sam Rivera', icon: '@' },
    { label: 'jane-onboarding', icon: '#' }, { label: 'Jane Doe’s notes.pdf', icon: '▤' }
  ] } },
  'recents-light': { theme: 'light', state: { search: true, query: '', items: recents, index: 1, currentKey: 'T1/C001', modifier, tab: 'unread' } }
};
const page = theme => `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;display:grid;grid-template-columns:220px 1fr;height:100vh;font:15px -apple-system,sans-serif;background:${theme === 'dark' ? '#1a1d21' : '#ffffff'};color:${theme === 'dark' ? '#d1d2d3' : '#1d1c1d'}}
  aside{background:${theme === 'dark' ? '#19171d' : '#3f0e40'};color:#cfc3cf;padding:20px 16px;line-height:2}main{padding:24px 32px;line-height:1.7}
  b{color:inherit}.dim{opacity:.55}</style>
  <aside><b>Acme</b><br># product-design<br># launch-planning<br># eng-standup<br>Jane Doe<br>Sam Rivera<br>Priya Patel</aside>
  <main><b>Jane Doe</b> <span class="dim">10:42</span><br>Draft of the launch checklist is ready for review.<br><br>
  <b>Sam Rivera</b> <span class="dim">10:47</span><br>Looks good. I'll update the timeline this afternoon.<br><br>
  <b>Priya Patel</b> <span class="dim">11:03</span><br>Shipping the design tokens once standup wraps up.</main>`;

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const window = new BrowserWindow({ width: 960, height: 760, show: true, webPreferences: { sandbox: true } });
  for (const [name, shot] of Object.entries(shots)) {
    nativeTheme.themeSource = shot.theme;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(shot.theme))}`);
    await window.webContents.executeJavaScript(`(${renderSwitcher.toString()})(${JSON.stringify(shot.state)})`);
    if (shot.typed) {
      // In Slack the native search box sits over this slot; draw its text the same way for the sample.
      await window.webContents.executeJavaScript(`(() => { const slot = document.getElementById('slack-recent-switcher-overlay').shadowRoot.querySelector('.query-slot'); const text = document.createElement('span'); text.textContent = ${JSON.stringify(shot.typed)}; text.style.cssText = 'position:absolute;left:13px;top:14px;font:14px/20px -apple-system,sans-serif;color:${shot.theme === 'dark' ? '#f3eff8' : '#24202d'}'; slot.append(text); })()`);
    }
    await delay(400);
    const image = (await window.webContents.capturePage()).resize({ width: 960 });
    fs.writeFileSync(path.join(out, `${name}.png`), image.toPNG());
    console.log(`wrote ${name}.png`);
  }
  app.quit();
});
