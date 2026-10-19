import { execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDirectory } from './control.mjs';

const bundleId = 'com.fazulk.slack-recents';
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export const launcherPath = join(homedir(), 'Applications', 'Slack Recents.app');

export function launcherFiles(node, entry, port, state = stateDirectory) {
  const log = join(state, 'helper.log');
  return {
    executable: `#!/bin/sh\numask 077\nmkdir -p ${shellQuote(state)}\nexec ${[node, entry, '--helper', '--port', String(port)].map(shellQuote).join(' ')} >> ${shellQuote(log)} 2>&1\n`,
    plist: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>launcher</string>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleName</key><string>Slack Recents</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>app.icns</string>
<key>LSUIElement</key><true/>
<key>LSMultipleInstancesProhibited</key><true/>
<key>SlackRecentsNode</key><string>${escapeXml(node)}</string>
<key>SlackRecentsEntry</key><string>${escapeXml(entry)}</string>
</dict></plist>
`
  };
}

export async function installLauncher(port) {
  const node = await realpath(process.execPath);
  if (node.includes('/fnm_multishells/')) throw new Error('Install with a stable Node executable, outside fnm_multishells.');
  await access(node, constants.X_OK);
  const applications = join(homedir(), 'Applications');
  await mkdir(applications, { recursive: true });
  const exists = await access(launcherPath).then(() => true, () => false);
  if (exists) {
    const existingId = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(launcherPath, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
    if (existingId !== bundleId) throw new Error(`Refusing to replace another app at ${launcherPath}`);
  }
  const temporary = await mkdtemp(join(applications, '.slack-recents-'));
  const built = join(temporary, 'Slack Recents.app');
  const backup = join(temporary, 'previous.app');
  let backedUp = false;
  try {
    const entry = fileURLToPath(new URL('../load.mjs', import.meta.url));
    const files = launcherFiles(node, entry, port);
    await mkdir(join(built, 'Contents/MacOS'), { recursive: true });
    await mkdir(join(built, 'Contents/Resources'));
    await writeFile(join(built, 'Contents/MacOS/launcher'), files.executable, { mode: 0o755 });
    await writeFile(join(built, 'Contents/Info.plist'), files.plist);
    await copyFile('/Applications/Slack.app/Contents/Resources/electron.icns', join(built, 'Contents/Resources/app.icns'));
    if (exists) { await rename(launcherPath, backup); backedUp = true; }
    try { await rename(built, launcherPath); }
    catch (error) { if (backedUp) await rename(backup, launcherPath); throw error; }
    return launcherPath;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
