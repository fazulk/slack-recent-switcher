import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function windowsShell(script, data = {}) {
  const program = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source = `$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n$config = $env:SLACK_RECENTS_INSTALL_CONFIG | ConvertFrom-Json\n${script}`;
  return execFileSync(program, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, SLACK_RECENTS_INSTALL_CONFIG: JSON.stringify(data) }
  }).replace(/^\uFEFF/, '').trim();
}
export function windowsInstallState() {
  return JSON.parse(windowsShell(`
$programs = [Environment]::GetFolderPath('Programs')
if (-not $programs) { throw 'Windows Start Menu folder could not be located.' }
$shortcutPath = Join-Path $programs 'Slack Recents.lnk'
$target = $null
if (Test-Path -LiteralPath $shortcutPath) {
  $shell = New-Object -ComObject WScript.Shell
  $target = $shell.CreateShortcut($shortcutPath).TargetPath
}
$running = @(Get-CimInstance Win32_Process -Filter "Name = 'slack.exe'" | Where-Object { $_.ExecutablePath } | ForEach-Object { $_.ExecutablePath })
@{ shortcut = $shortcutPath; target = $target; running = $running } | ConvertTo-Json -Compress
`));
}
export function createWindowsShortcut(shortcut, executable) {
  windowsShell(`
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($config.shortcut)
$link.TargetPath = $config.executable
$link.WorkingDirectory = Split-Path -LiteralPath $config.executable
$link.IconLocation = $config.executable + ',0'
$link.Description = 'Slack Recents: recent conversations and custom search'
$link.Save()
if ($shell.CreateShortcut($config.shortcut).TargetPath -ne $config.executable) { throw 'Start Menu shortcut verification failed.' }
`, { shortcut, executable });
}
