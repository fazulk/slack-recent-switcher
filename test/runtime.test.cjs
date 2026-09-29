const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const install = require('../src/runtime.cjs');

function fixture(t, platform = 'darwin') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-recents-test-'));
  const app = new EventEmitter(); app.getPath = () => directory; app.whenReady = () => Promise.resolve();
  const contents = new EventEmitter();
  Object.assign(contents, { id: 1, url: '', title: '', focused: true, destroyed: false, scripts: [] });
  contents.getURL = () => contents.url; contents.getTitle = () => contents.title;
  contents.isFocused = () => contents.focused; contents.isDestroyed = () => contents.destroyed;
  contents.executeJavaScript = async script => { contents.scripts.push(script); };
  contents.session = { registerPreloadScript() {} };
  contents.setIgnoreMenuShortcuts = value => { contents.ignoresMenu = value; };
  contents.send = () => {};
  contents.inserted = [];
  contents.insertText = text => contents.inserted.push(text);
  contents.inputs = [];
  contents.sendInputEvent = input => contents.inputs.push(input);
  const ipcMain = new EventEmitter();
  let time = 1000;
  const links = []; app.on('open-url', (_event, url) => links.push(url));
  const secondInstances = []; app.on('second-instance', (_event, argv, directory, data) => secondInstances.push({ argv, directory, data }));
  const runtime = install({ app, ipcMain, webContents: { getAllWebContents: () => [contents], getFocusedWebContents: () => contents } }, { test: true, platform, now: () => time });
  app.emit('web-contents-created', {}, contents);
  function navigate(channel) {
    contents.url = `https://app.slack.com/client/T123/${channel}`;
    contents.emit('did-navigate-in-page', {}, contents.url, true);
    contents.title = `${channel} - Acme - Slack`; contents.emit('page-title-updated', {}, contents.title);
  }
  function key(input) {
    let prevented = false;
    contents.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', key: 'k', code: 'KeyK', meta: true, ...input });
    return prevented;
  }
  t.after(() => { app.emit('before-quit'); fs.rmSync(directory, { recursive: true, force: true }); });
  return { app, contents, links, secondInstances, runtime, navigate, key, directory, ipcMain, elapse: ms => { time += ms; } };
}

test('native chord suppression, repeated cycling, and Meta release navigate once', async t => {
  const f = fixture(t);
  ['C111', 'D222', 'G333'].forEach(f.navigate);
  assert.equal(f.key({}), false);
  assert.equal(f.contents.ignoresMenu, true);
  assert.equal(f.runtime.active.cycle.selected.channel, 'D222');
  f.key({ isAutoRepeat: true }); assert.equal(f.runtime.active.cycle.selected.channel, 'D222');
  f.key({ type: 'keyUp' }); assert.equal(f.links.length, 0);
  f.key({}); assert.equal(f.runtime.active.cycle.selected.channel, 'C111');
  f.key({ key: 'Meta', code: 'MetaLeft', type: 'keyUp', meta: false });
  assert.equal(f.runtime.active, null);
  assert.equal(f.contents.ignoresMenu, false);
  assert.deepEqual(f.links, ['slack://channel?team=T123&id=C111']);
  await f.runtime.painted();
  assert.match(f.contents.scripts.at(-1), /\(null\)$/);
});
test('Escape, window focus loss, and navigation cancel without switching', t => {
  const f = fixture(t); ['C111', 'D222'].forEach(f.navigate);
  for (const cancel of [() => f.key({ key: 'Escape', code: 'Escape' }), () => f.app.emit('browser-window-blur'), () => f.contents.emit('blur'), () => f.navigate('G333')]) {
    f.key({}); cancel(); assert.equal(f.runtime.active, null);
    f.key({ key: 'Meta', code: 'MetaRight', type: 'keyUp', meta: false });
  }
  assert.deepEqual(f.links, []);
});
test('quick tap mounts custom search before opening Slack search, and history is persisted', async t => {
  const f = fixture(t); ['C111', 'D222'].forEach(f.navigate);
  assert.equal(f.key({ control: true }), false);
  assert.equal(f.key({ alt: true }), false);
  assert.equal(f.key({ meta: false }), false);
  f.key({}); f.key({ key: 'Meta', code: 'MetaLeft', type: 'keyUp', meta: false });
  await f.runtime.painted();
  assert.equal(f.links.length, 0);
  assert.match(f.contents.scripts.at(-1), /function mountSearch/);
  assert.equal(f.contents.inputs[0].keyCode, 'T');
  f.runtime.flush();
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, 'recent-conversations.json')))[0].channel, 'D222');
});
test('keys typed while Slack search is still opening are buffered and replayed once it is ready', async t => {
  const f = fixture(t); ['C111', 'D222'].forEach(f.navigate);
  f.key({}); f.key({ key: 'Meta', code: 'MetaLeft', type: 'keyUp', meta: false });
  const type = key => f.key({ key, code: `Key${key.toUpperCase()}`, meta: false });
  assert.equal(type('h'), true); assert.equal(type('e'), true); assert.equal(type('y'), true);
  assert.equal(f.key({ key: 'Backspace', code: 'Backspace', meta: false }), true);
  assert.equal(type('y'), true);
  assert.equal(f.key({ key: 'Enter', code: 'Enter', meta: false }), true, 'Enter must not reach the composer');
  assert.equal(f.key({ key: 'a', code: 'KeyA', meta: true }), false, 'shortcuts still pass through');
  assert.equal(f.key({ key: 'Shift', code: 'ShiftLeft', meta: false }), false);
  await f.runtime.painted();
  f.ipcMain.emit('slack-recents:search-ui', { sender: f.contents }, { type: 'ready' });
  assert.deepEqual(f.contents.inserted, ['hey']);
  assert.equal(type('z'), false, 'typing after ready goes straight to Slack');
  f.ipcMain.emit('slack-recents:search-ui', { sender: f.contents }, { type: 'ready' });
  assert.deepEqual(f.contents.inserted, ['hey']);
});
test('buffered keys are dropped when search closes without becoming ready', t => {
  const f = fixture(t); ['C111', 'D222'].forEach(f.navigate);
  f.key({}); f.key({ key: 'Meta', code: 'MetaLeft', type: 'keyUp', meta: false });
  f.key({ key: 'h', code: 'KeyH', meta: false });
  f.ipcMain.emit('slack-recents:search-ui', { sender: f.contents }, { type: 'closed' });
  assert.equal(f.key({ key: 'h', code: 'KeyH', meta: false }), false);
  assert.deepEqual(f.contents.inserted, []);
});
test('picking an unread sidebar conversation navigates only for well-formed keys in the current workspace', t => {
  const f = fixture(t); ['C111', 'D222'].forEach(f.navigate);
  f.key({}); f.key({ key: 'Meta', code: 'MetaLeft', type: 'keyUp', meta: false });
  const pick = key => f.ipcMain.emit('slack-recents:search-ui', { sender: f.contents }, { type: 'pick', key });
  pick('T999/C555'); pick('T123/../C555'); pick('T123/Pdrafts'); pick(undefined);
  assert.equal(f.links.length, 0);
  pick('T123/C555');
  assert.deepEqual(f.links, ['slack://channel?team=T123&id=C555']);
  // A workspace home URL has no channel yet still identifies the workspace.
  f.contents.url = 'https://app.slack.com/client/T123';
  pick('T123/C556');
  assert.equal(f.links.at(-1), 'slack://channel?team=T123&id=C556');
});
test('holding one Cmd-K switches on release, and native search cycles in both directions without committing', async t => {
  const f = fixture(t); ['C111', 'D222'].forEach(f.navigate);
  f.key({}); f.elapse(250); f.key({ key: 'Meta', code: 'MetaLeft', type: 'keyUp', meta: false });
  assert.equal(f.links.length, 1);
  f.ipcMain.emit('slack-recents:native-search', { sender: f.contents }, true);
  f.key({}); f.key({ shift: true });
  assert.deepEqual(f.contents.inputs.filter(x=>x.type==='keyDown').map(x=>x.keyCode), ['Down', 'Up']);
  f.key({ key: 'Meta', code: 'MetaLeft', type: 'keyUp', meta: false });
  assert.equal(f.links.length, 1);
  assert.equal(f.contents.ignoresMenu, false);
  f.ipcMain.emit('slack-recents:native-search', { sender: f.contents }, false);
  f.key({}); assert.ok(f.runtime.active);
  f.key({ key: 'Escape', code: 'Escape' });
});
test('background workspace events do not reorder recents; title updates do not mark a visit', t => {
  const f = fixture(t); ['C111', 'D222'].forEach(f.navigate);
  f.contents.focused = false; f.navigate('G333');
  assert.deepEqual(f.runtime.recents.items.map(x => x.channel), ['D222', 'C111']);
  f.contents.focused = true; f.contents.emit('focus');
  assert.equal(f.runtime.recents.items[0].channel, 'G333');
});
test('releasing K after cancelling does not leave menu shortcuts disabled', t => {
  const f = fixture(t); ['C111', 'D222'].forEach(f.navigate);
  f.key({}); f.key({ key: 'Escape', code: 'Escape' }); f.key({ type: 'keyUp' });
  assert.equal(f.contents.ignoresMenu, false);
});

for (const platform of ['linux', 'win32']) {
test(`${platform}: Ctrl-K cycles and reverses; releasing Control routes through Slack’s second-instance handler`, t => {
  const f = fixture(t, platform); ['C111', 'D222', 'G333'].forEach(f.navigate);
  const chord = { meta: false, control: true };
  f.key({}); assert.equal(f.runtime.active, null, 'Super-K is not overridden on Linux');
  f.key({ ...chord, alt: true }); assert.equal(f.runtime.active, null);
  f.key(chord); assert.equal(f.runtime.active.cycle.selected.channel, 'D222');
  f.key(chord); assert.equal(f.runtime.active.cycle.selected.channel, 'C111');
  f.key({ ...chord, shift: true }); assert.equal(f.runtime.active.cycle.selected.channel, 'D222');
  f.key({ key: 'Meta', code: 'MetaLeft', type: 'keyUp', meta: false }); assert.ok(f.runtime.active);
  f.key({ key: 'Control', code: 'ControlLeft', type: 'keyUp', meta: false, control: false });
  assert.equal(f.runtime.active, null);
  assert.deepEqual(f.links, []);
  assert.deepEqual(f.secondInstances[0].argv, [process.execPath, 'slack://channel?team=T123&id=D222']);
  assert.equal(f.contents.ignoresMenu, false);
});

test(`${platform}: tap-to-search and picking a recent use Ctrl and validated in-process navigation`, async t => {
  const f = fixture(t, platform); ['C111', 'D222'].forEach(f.navigate);
  f.key({ meta: false, control: true });
  f.key({ key: 'Control', code: 'ControlRight', type: 'keyUp', meta: false, control: false });
  await f.runtime.painted();
  assert.equal(f.secondInstances.length, 0);
  assert.match(f.contents.scripts.at(-1), /"modifier":"Ctrl"/);
  assert.deepEqual(f.contents.inputs[0], { type: 'keyDown', keyCode: 'T', modifiers: ['control'] });
  f.ipcMain.emit('slack-recents:search-ui', { sender: f.contents }, { type: 'pick', key: 'T999/C999' });
  assert.equal(f.secondInstances.length, 0);
  f.ipcMain.emit('slack-recents:search-ui', { sender: f.contents }, { type: 'pick', key: 'T123/C111' });
  assert.equal(f.secondInstances[0].argv[1], 'slack://channel?team=T123&id=C111');
});

}
