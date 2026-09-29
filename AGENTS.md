# Install Slack Recents on this computer

This file ships in the repository and in the portable ZIP. When the user asks you to install this package, carry out the installation and verification below. Use the paths on the destination computer; do not assume the original developer's username or directory structure.

## Get the code

```sh
git clone https://github.com/fazulk/slack-recent-switcher.git
cd slack-recent-switcher
```

Then follow the sections below from inside this folder. Slack Recents is an unofficial, local modification of the user's own Slack install; it does not replace or alter the official app.

## Scope and prerequisites

- Supported targets: macOS, graphical Linux desktops using Slack's official native .deb/.rpm installation, and Windows desktops using Slack's Legacy EXE installation. WSL as a desktop substitute, Snap, Flatpak, and Microsoft Store/MSIX patch sources are unsupported. Windows package patching has been verified; native Windows startup and sign-in still require verification on the destination computer.
- Read `README.md`. Detect the OS, CPU architecture, Node/npm versions, existing Slack installation, and any previous Slack Recents installation.
- Require Node.js >= 22.12 and npm. If missing, help install Node from https://nodejs.org or an appropriate trusted package manager, within the user's authorization. Do not silently replace a project's existing Node environment.
- Slack must already be installed from https://slack.com/downloads using binaries appropriate to the OS and CPU. On Linux and Windows, Node and Slack architectures must match. If only Snap/Flatpak or MSIX is present, explain that the official native Linux package or Windows Legacy EXE installation is needed. Do not patch files in WindowsApps.
- The ZIP contains patch source and installers, not Slack binaries, credentials, sign-in data, or browsing history. Each computer gets its own profile and the user signs in there.

## Install

1. Work inside a regular local checkout of this repository, or a folder extracted from the ZIP. Do not execute files from inside an archive preview.
2. Identify the original Slack app and the intended destination. Quit an existing Slack Recents process before updating it. Preserve the user's official Slack app, unrelated files, and existing profile.
3. Run `npm ci` and `npm test` (`npm.cmd ci` and `npm.cmd test` in Windows PowerShell). Then use the matching install command below. Use the normal desktop account, without root/sudo or an elevated Administrator shell.

### macOS

Default source: `/Applications/Slack.app`. For a fresh install, prefer `/Applications/Slack Recents.app` when `/Applications` is writable; otherwise use `~/Applications/Slack Recents.app`. For an update, use the existing copy's actual destination to avoid creating duplicates.

```sh
npm run install:slack -- --source "/Applications/Slack.app" --destination "/Applications/Slack Recents.app"
```

Or use the user Applications directory:

```sh
npm run install:slack -- --source "/Applications/Slack.app" --destination "$HOME/Applications/Slack Recents.app"
```

Adapt `--source` if official Slack is elsewhere. `Install.command` offers the interactive default install. The installer signs and verifies the modified copy locally. Open the actual installed destination afterward. If macOS requires a user action in Privacy & Security, explain it; do not disable Gatekeeper or strip security settings globally.

### Linux

The installer detects `/usr/lib/slack`, `/opt/slack`, or the real target of `/usr/bin/slack`. Run as the normal logged-in desktop user:

```sh
npm run install:slack
```

`sh Install.sh` is the convenience equivalent (it also runs `npm ci`). For a nonstandard native Slack installation, pass `--source /path/to/slack`. The source directory contains the `slack` executable and `resources/app.asar`.

The copy is installed in `${XDG_DATA_HOME:-$HOME/.local/share}/slack-recents`. The executable launcher is `~/.local/bin/slack-recents`; the applications-menu entry is `local.slackrecents.desktop` under the XDG data directory's `applications` folder. Launch through the menu or the full launcher path; do not assume `~/.local/bin` is already on PATH.

The installer registers the user's `slack://` protocol handler for browser sign-in. Keep official Slack installed, including its native libraries and sandbox helper. Do not add `--no-sandbox`, weaken AppArmor, or use root to work around a launch failure. Diagnose any destination-specific policy problem and explain the specific unresolved requirement.

### Windows

Use Slack's **Download (Legacy)** desktop EXE installer from https://slack.com/downloads/windows. The patch source is the installed app directory or `slack.exe`, not the downloaded setup program. The installer searches common per-user/system locations and selects the newest complete Squirrel `app-<version>` folder.

Run in PowerShell as the normal desktop user:

```powershell
npm.cmd run install:slack
```

`Install.cmd` is the interactive equivalent and also runs `npm ci`. Use `npm.cmd` to avoid PowerShell execution-policy restrictions on `npm.ps1`; do not change execution policy. A nonstandard installation can use:

```powershell
npm.cmd run install:slack -- --source 'C:\path\to\Slack' --destination "$env:LOCALAPPDATA\SlackRecents"
```

The default app is `%LOCALAPPDATA%\SlackRecents\slack.exe`. The installer adds **Slack Recents.lnk** to the current user's Start Menu Programs folder. Locate that folder with `[Environment]::GetFolderPath('Programs')` rather than assuming the default path. Launch through the shortcut or the full installed executable path. Keep the executable named `slack.exe` inside the separate copy.

The modified EXE is unsigned because its archive-integrity resource changed. Archive integrity checks remain enabled. No signing certificate or security-policy change is required by the installer. If organization policy blocks unsigned applications, explain that specific restriction; do not bypass SmartScreen, Defender, AppLocker, or other protections. The copied app registers `slack://` on startup; if needed, let the user select the app in Windows Default Apps rather than editing protected UserChoice entries.

## Verify and hand off

- Confirm the installer reported success, the destination exists, and `slack-recents-install.json` records this package's version and the expected source. It is in `Contents/Resources` on macOS and `resources` on Linux/Windows.
- On macOS, verify with `codesign --verify --deep --strict "<installed app path>"`. On Linux, run `desktop-file-validate` on the installed `.desktop` file if available; check the launcher is executable.
- On Windows, confirm the Start Menu shortcut targets the installed `slack.exe` and opens the copy. The installer validates the executable's new archive digest and preservation of its code sections before replacing the destination. An unsigned Authenticode status is expected for this local modification. Run `npm.cmd run test:electron` on Windows to check the native runtime; this has not been run on Windows by the package author.
- Open the installed Slack Recents app and verify its window appears. Keep the user's credentials within Slack's normal sign-in flow. If authentication requires the user, finish all other setup and clearly hand off that step; do not claim workspace behavior was verified before signing in.
- Once signed in, visit several channels/DMs. Confirm: a quick Command-K (macOS) / Ctrl-K (Linux/Windows) tap leaves the custom searchable panel open; typing returns Slack suggestions; the shortcut moves down; Shift plus the shortcut moves up; Enter opens the selection; Escape cancels; holding the modifier and cycling switches on release. Do not send messages while testing.
- `npm run test:electron` runs an isolated fixture against the destination machine's Slack Electron binary. It is useful for keyboard diagnostics; it is not a substitute for live sign-in verification. It has no workspace credentials. Never use its container-only sandbox override to launch the user's real Slack.
- Report where the app was installed, how to open it, and which checks passed. Distinguish unverified behavior from passed checks. See README for the current compatibility/test limits.

## Updates and troubleshooting

- To pick up new patch code, `git pull` in this checkout. Then update official Slack first if needed, quit Slack Recents, and rerun this installer with the same source and destination. Profiles/history remain separate from the app files and are preserved.
- If the original source has already been patched or renamed from Slack Recents, do not patch it again. Locate a fresh official Slack installation. Never overwrite the user's working copy to obtain a source.
- The installer refuses unrelated destinations and leftover `.previous` backups. Inspect these before taking action; do not delete them blindly.
- If browser sign-in opens official Slack, choose Slack Recents when the browser offers a choice. On Linux, check `xdg-mime query default x-scheme-handler/slack`; repair with `xdg-mime default local.slackrecents.desktop x-scheme-handler/slack` if needed. On Windows, launch Slack Recents and check Windows Default Apps if the original still opens.
- User profiles: macOS `~/Library/Application Support/Slack Recents`; Linux `${XDG_CONFIG_HOME:-$HOME/.config}/Slack Recents`; Windows `%APPDATA%\Slack Recents`. Do not delete or copy credentials as an installation workaround.
- Uninstall: quit Slack Recents, then remove the installed copy. macOS: the `.app`. Linux: the install directory, `~/.local/bin/slack-recents`, and `local.slackrecents.desktop` (restore links with `xdg-mime default slack.desktop x-scheme-handler/slack`). Windows: `%LOCALAPPDATA%\SlackRecents` and **Slack Recents.lnk** in the Start Menu Programs folder. Remove the profile directory only if the user wants to erase its sign-in and history.
- If you change source code, run the appropriate tests and `npm run package` (`npm.cmd run package` in Windows PowerShell). The output is `dist/slack-recent-switcher.zip`. Keep this file, all three installers, and the README in that archive. Never include node_modules, test artifacts, Slack binaries, or profiles. ZIPs rebuilt on Windows may need `chmod +x Install.command Install.sh` after extraction on macOS/Linux; direct npm installation works without executable bits.
