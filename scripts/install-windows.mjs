import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { inspectArchive, patchArchive } from './archive.mjs';
import { windowsArchitecture, patchWindowsIntegrity } from './windows-pe.mjs';
import { windowsInstallState, createWindowsShortcut } from './windows-shell.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const folder = value => value?.toLowerCase().replaceAll('\\', '/').replace(/\/$/, '');
export function containsWindowsPath(parent, child) {
  return folder(child) === folder(parent) || folder(child)?.startsWith(`${folder(parent)}/`);
}
function versionParts(name) { return name.replace(/^app-/i, '').split('.').map(Number); }
function newestFirst(a, b) {
  const av = versionParts(a), bv = versionParts(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) { const diff = (bv[i] || 0) - (av[i] || 0); if (diff) return diff; }
  return 0;
}
export function findWindowsSource(explicit, environment = process.env) {
  const bases = explicit ? [explicit] : [
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'slack'),
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs/Slack'),
    environment.ProgramFiles && path.join(environment.ProgramFiles, 'Slack'),
    environment['ProgramFiles(x86)'] && path.join(environment['ProgramFiles(x86)'], 'Slack')
  ].filter(Boolean);
  for (let base of bases) {
    if (!fs.existsSync(base)) continue;
    base = fs.realpathSync(base);
    if (fs.statSync(base).isFile()) base = path.dirname(base);
    if (/(?:^|[/\\])WindowsApps(?:[/\\]|$)/i.test(base) || fs.existsSync(path.join(base, 'AppxManifest.xml'))) continue;
    // Squirrel installs put the real executable in app-<version>, with a stub
    // at the parent. Select the newest complete version, not the launcher stub.
    const versions = fs.readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^app-\d+(?:\.\d+){2,3}$/i.test(entry.name)).map(entry => entry.name).sort(newestFirst);
    for (const candidate of [...versions.map(name => path.join(base, name)), base]) {
      if (fs.existsSync(path.join(candidate, 'AppxManifest.xml'))) continue;
      if (fs.existsSync(path.join(candidate, 'slack.exe')) && fs.existsSync(path.join(candidate, 'resources/app.asar'))) return candidate;
    }
  }
  throw new Error('Slack’s desktop EXE installation was not found. Install the official “Download (Legacy)” Windows version from https://slack.com/downloads/windows, or pass --source to its app directory or slack.exe. Microsoft Store/MSIX installations are not supported as patch sources.');
}
export async function buildWindowsCopy({ source, staging, extracted }) {
  const archive = path.join(source, 'resources/app.asar');
  const { pkg } = inspectArchive(archive);
  const architecture = windowsArchitecture(path.join(source, 'slack.exe'));
  fs.cpSync(source, staging, { recursive: true, dereference: true, mode: fs.constants.COPYFILE_FICLONE });
  const result = await patchArchive({ archive, output: path.join(staging, 'resources/app.asar'), extracted, root });
  const digest = patchWindowsIntegrity(path.join(staging, 'slack.exe'), path.join(staging, 'resources/app.asar'));
  fs.writeFileSync(path.join(staging, 'resources/slack-recents-install.json'), JSON.stringify({
    patchVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
    slackVersion: pkg.version, platform: 'win32', architecture, source, installedAt: new Date().toISOString(), asarHeaderHash: digest
  }, null, 2));
  return { ...result, architecture, digest };
}
export async function installWindows(args = []) {
  function argument(name) {
    const index = args.indexOf(name);
    return index < 0 ? undefined : path.resolve(args[index + 1].replace(/^~(?=[/\\])/, os.homedir()));
  }
  const source = findWindowsSource(argument('--source'));
  if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is unavailable. Run this installer as your normal Windows desktop user.');
  const destination = argument('--destination') || path.join(process.env.LOCALAPPDATA, 'SlackRecents');
  if (containsWindowsPath(source, destination) || containsWindowsPath(destination, source)) throw new Error('Source and destination must be separate directories.');
  const marker = path.join(destination, 'resources/slack-recents-install.json');
  if (fs.existsSync(destination) && (fs.lstatSync(destination).isSymbolicLink() || !fs.existsSync(marker))) throw new Error('Destination exists and is not owned by this installer. Choose a different destination.');
  const { pkg } = inspectArchive(path.join(source, 'resources/app.asar'));
  const architecture = windowsArchitecture(path.join(source, 'slack.exe'));
  if (architecture !== process.arch) throw new Error(`Slack is ${architecture}, but Node is ${process.arch}. Install Node and Slack for the same architecture.`);
  const state = windowsInstallState();
  const executable = path.join(destination, 'slack.exe');
  if (state.running.some(file => containsWindowsPath(destination, file))) throw new Error('Quit Slack Recents before installing an update.');
  if (state.target !== null && folder(state.target) !== folder(executable)) throw new Error(`An unrelated shortcut already exists: ${state.shortcut}`);
  if (fs.existsSync(state.shortcut) && !fs.lstatSync(state.shortcut).isFile()) throw new Error('The existing Slack Recents shortcut is not a regular file.');
  const oldShortcut = fs.existsSync(state.shortcut) ? fs.readFileSync(state.shortcut) : null;
  const backup = `${destination}.previous`;
  if (fs.existsSync(backup)) throw new Error(`Previous backup still exists: ${backup}. Move it before installing again.`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(destination), '.slack-recents-build-'));
  const staging = path.join(temporary, 'app');
  let installed = false;
  try {
    console.log(`Building Slack Recents from Windows Slack ${pkg.version} (${architecture})…`);
    await buildWindowsCopy({ source, staging, extracted: path.join(temporary, 'archive') });
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    try {
      fs.renameSync(staging, destination); installed = true;
      fs.mkdirSync(path.dirname(state.shortcut), { recursive: true });
      createWindowsShortcut(state.shortcut, executable);
    } catch (error) {
      if (installed) fs.rmSync(destination, { recursive: true, force: true });
      if (fs.existsSync(backup)) fs.renameSync(backup, destination);
      if (oldShortcut) fs.writeFileSync(state.shortcut, oldShortcut);
      else fs.rmSync(state.shortcut, { force: true });
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
    console.log(`Installed: ${destination}\nOpen Slack Recents from the Start Menu and sign in.\nTap Ctrl-K to search; hold Ctrl and cycle K / Shift-K to switch on release.\nThis local modified EXE is unsigned. Its Electron integrity checks remain enabled.`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
