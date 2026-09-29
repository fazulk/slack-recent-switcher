import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import * as asar from '@electron/asar';
import { signApp } from './sign.mjs';
import { findWindowsSource } from './install-windows.mjs';
import { patchWindowsIntegrity } from './windows-pe.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-recents-electron-'));
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const mac = process.platform === 'darwin';
const windows = process.platform === 'win32';
if (!mac && !windows && process.platform !== 'linux') throw new Error('Electron integration test supports macOS, Linux, and Windows.');
try {
  const candidates = process.env.SLACK_RECENTS_TEST_SOURCE ? [process.env.SLACK_RECENTS_TEST_SOURCE] : mac
    ? ['/Applications/Slack Recents.app', path.join(os.homedir(), 'Applications/Slack Recents.app'), '/Applications/Slack.app']
    : windows ? [findWindowsSource()] : ['/usr/lib/slack', '/opt/slack'];
  const source = candidates.find(value => fs.existsSync(path.join(value, mac ? 'Contents/Resources/app.asar' : 'resources/app.asar')));
  if (!source) throw new Error('Install Slack first, or set SLACK_RECENTS_TEST_SOURCE to its app directory.');
  const app = path.join(temporary, mac ? 'Switcher Test.app' : 'slack-test');
  if (mac) run('/usr/bin/ditto', [source, app]);
  else fs.cpSync(source, app, { recursive: true, dereference: true });
  const src = path.join(temporary, 'src'); fs.mkdirSync(src);
  fs.cpSync(path.join(root, 'src'), path.join(src, 'src'), { recursive: true });
  fs.copyFileSync(path.join(root, process.env.SLACK_RECENTS_MAIN ?? 'test/electron-harness.cjs'), path.join(src, 'main.cjs'));
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'slack-recents-test', version: '1.0.0', main: 'main.cjs' }));
  const archive = path.join(app, mac ? 'Contents/Resources/app.asar' : 'resources/app.asar'); fs.rmSync(archive);
  await asar.createPackage(src, archive);
  if (mac) {
    const plist = path.join(app, 'Contents/Info.plist');
    const info = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]));
    info.CFBundleIdentifier = 'local.slack-recents.test';
    delete info.CFBundleURLTypes;
    info.ElectronAsarIntegrity = { 'Resources/app.asar': { algorithm: 'SHA256', hash: crypto.createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex') } };
    fs.writeFileSync(plist, JSON.stringify(info)); run('/usr/bin/plutil', ['-convert', 'xml1', plist]);
    signApp(app);
  } else if (windows) {
    patchWindowsIntegrity(path.join(app, 'slack.exe'), archive);
  } else if (fs.existsSync(path.join(app, 'chrome-sandbox'))) {
    fs.unlinkSync(path.join(app, 'chrome-sandbox'));
    fs.symlinkSync(path.join(source, 'chrome-sandbox'), path.join(app, 'chrome-sandbox'));
  }
  const artifacts = path.join(root, 'test/artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  // Only the offline fixture may opt out when a container forbids user namespaces.
  // This flag is never added to the installed Slack Recents launcher.
  const args = process.platform === 'linux' && process.env.SLACK_RECENTS_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
  const child = spawn(path.join(app, mac ? 'Contents/MacOS/Slack' : windows ? 'slack.exe' : 'slack'), args, {
    stdio: 'inherit', env: { ...process.env, SLACK_RECENTS_TEST_PROFILE: path.join(temporary, 'profile'), SLACK_RECENTS_SCREENSHOT: path.join(artifacts, `switcher-${process.platform}.png`), SLACK_RECENTS_SHOTS: path.join(root, 'docs/screenshots') }
  });
  process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
