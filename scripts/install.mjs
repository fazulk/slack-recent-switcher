#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { signApp } from './sign.mjs';
import { inspectArchive, patchArchive } from './archive.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const usage = 'Usage: npm run install:slack -- [--source PATH] [--destination PATH]\nmacOS: source /Applications/Slack.app; destination ~/Applications/Slack Recents.app\nLinux: source /usr/lib/slack or /opt/slack; destination ~/.local/share/slack-recents\nWindows: source desktop EXE Slack installation; destination %LOCALAPPDATA%\\SlackRecents';
function argument(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(usage);
  return path.resolve(args[index + 1].replace(/^~(?=\/)/, os.homedir()));
}
const source = argument('--source', '/Applications/Slack.app');
const destination = argument('--destination', path.join(os.homedir(), 'Applications/Slack Recents.app'));
const run = (program, values) => execFileSync(program, values, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function install() {
  if (args.includes('--help')) { console.log(usage); return; }
  for (let i = 0; i < args.length; i += 2) if (!['--source', '--destination'].includes(args[i])) throw new Error(usage);
  if (process.platform === 'linux') {
    const { installLinux } = await import('./install-linux.mjs');
    await installLinux(args);
    return;
  }
  if (process.platform === 'win32') {
    const { installWindows } = await import('./install-windows.mjs');
    await installWindows(args);
    return;
  }
  if (process.platform !== 'darwin') throw new Error('This installer supports macOS, Linux, and Windows.');
  if (source === destination || destination.startsWith(`${source}/`) || source.startsWith(`${destination}/`)) throw new Error('Source and destination must be separate app bundles.');
  if (!destination.endsWith('.app')) throw new Error('Destination must end with .app.');
  const archive = path.join(source, 'Contents/Resources/app.asar');
  if (!fs.existsSync(archive)) throw new Error(`Slack archive not found: ${archive}`);
  if (fs.existsSync(path.join(source, 'Contents/Resources/slack-recents-install.json'))) throw new Error('Use the original Slack app as the source, not a patched copy.');
  const marker = path.join(destination, 'Contents/Resources/slack-recents-install.json');
  if (fs.existsSync(destination) && !fs.existsSync(marker)) throw new Error('Destination exists and is not owned by this installer. Choose a different destination.');
  const processes = run('/bin/ps', ['-axo', 'comm=']);
  if (processes.split('\n').some(line => line.startsWith(`${destination}/Contents/`))) throw new Error('Quit Slack Recents before installing an update.');
  const info = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(source, 'Contents/Info.plist')]));
  if (info.CFBundleIdentifier !== 'com.tinyspeck.slackmacgap') throw new Error('Source is not the expected Slack macOS app.');
  inspectArchive(archive);
  const backup = `${destination}.previous`;
  if (fs.existsSync(backup)) throw new Error(`Previous backup still exists: ${backup}. Move it before installing again.`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(destination), '.slack-recents-build-'));
  const staging = path.join(temporary, 'Slack Recents.app');
  const extracted = path.join(temporary, 'archive');
  try {
    console.log(`Building Slack Recents from Slack ${info.CFBundleShortVersionString}…`);
    run('/usr/bin/ditto', [source, staging]);
    const stagedArchive = path.join(staging, 'Contents/Resources/app.asar');
    await patchArchive({ archive, output: stagedArchive, extracted, root });
    const digest = crypto.createHash('sha256').update(asar.getRawHeader(stagedArchive).headerString).digest('hex');
    const plist = path.join(staging, 'Contents/Info.plist');
    info.CFBundleIdentifier = 'local.slack-recents.desktop';
    delete info.ElectronTeamID;
    // Electron uses CFBundleName to locate the original "Slack Helper" executables.
    info.CFBundleName = 'Slack';
    info.CFBundleDisplayName = 'Slack Recents';
    // Keep Slack URL schemes so browser sign-in can return to this app.
    info.CFBundleURLTypes = info.CFBundleURLTypes?.map(type => ({ ...type, CFBundleURLName: info.CFBundleIdentifier }));
    info.ElectronAsarIntegrity = { ...info.ElectronAsarIntegrity, 'Resources/app.asar': { algorithm: 'SHA256', hash: digest } };
    fs.writeFileSync(plist, JSON.stringify(info));
    run('/usr/bin/plutil', ['-convert', 'xml1', plist]);
    fs.writeFileSync(path.join(staging, 'Contents/Resources/slack-recents-install.json'), JSON.stringify({
      patchVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, slackVersion: info.CFBundleShortVersionString, source, installedAt: new Date().toISOString()
    }, null, 2));
    console.log('Signing the modified copy and verifying its archive…');
    signApp(staging);
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    try { fs.renameSync(staging, destination); } catch (error) {
      if (fs.existsSync(backup)) fs.renameSync(backup, destination);
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
    console.log(`Installed: ${destination}\nOpen Slack Recents and sign in. History starts as you visit conversations.\nUse the README's sign-in instructions if your browser opens the original Slack.`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

install().catch(error => { console.error(error.message); if (error.stderr) console.error(error.stderr.toString()); process.exitCode = 1; });
