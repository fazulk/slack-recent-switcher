import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { windowsShell } from './windows-shell.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-recents-package-'));
try {
  const destination = path.join(temporary, 'slack-recent-switcher');
  fs.mkdirSync(destination);
  for (const name of ['package.json', 'package-lock.json', 'README.md', 'AGENTS.md', 'LICENSE', 'docs', 'Install.command', 'Install.sh', 'Install.cmd', 'src', 'scripts', 'test']) {
    fs.cpSync(path.join(root, name), path.join(destination, name), { recursive: true, filter: name => !name.split(path.sep).includes('artifacts') });
  }
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const archive = path.join(root, 'dist/slack-recent-switcher.zip');
  fs.rmSync(archive, { force: true });
  if (process.platform === 'win32') {
    windowsShell('Compress-Archive -LiteralPath $config.source -DestinationPath $config.archive -Force', { source: destination, archive });
  } else {
    execFileSync('zip', ['-qr', archive, 'slack-recent-switcher'], { cwd: temporary });
  }
  console.log(archive);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
