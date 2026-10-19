# Slack Recent Switcher

A launcher for the official Slack macOS app: **Recent places first, up to eight entries**, followed by **Unreads & drafts**. It keeps Slack's native switcher, search, history, and keyboard handlers across reloads and new workspace windows.

## Install and launch

Requires macOS, `/Applications/Slack.app`, and Node.js 22 or newer. No npm dependencies.

1. Quit Slack completely with **⌘Q** on the first run.
2. Double-click `Install.command` in Finder, or run:

```sh
node load.mjs --install
```

This installs **~/Applications/Slack Recents.app** and starts Slack. Open that launcher in future; it can be added to the Dock. No Terminal window stays open when launching the app. It uses your existing Slack profile and sign-in.

`node load.mjs`, `npm start`, and the existing `dot-slack-recents` command refresh the installed app when the helper is stopped, then start the same helper. Repeated launches reuse one helper. The helper exits when Slack quits. Starting Slack directly after quitting uses the stock switcher until you launch Slack Recents again; if Slack is already running without debugging, quit it normally and use the launcher.

Eight is a maximum; fewer eligible recent places may be available. Press **⌘K** to use the switcher.

## Status and stop

From this repository:

```sh
node load.mjs --status
node load.mjs --stop
```

Status reports the helper PID, port, attached workspace windows, and how many currently have a verified patch. Stop disconnects the helper and restores its cache/service-worker settings. It leaves Slack open; an already loaded patch remains until that workspace reloads. Quit Slack and open it normally to close the debugging port and return to stock behavior.

The helper log is `~/Library/Application Support/Slack Recents/helper.log`; it is capped between starts. An unsupported Slack bundle is left untouched and reported there. If port 9327 is occupied, quit Slack and use `node load.mjs --install --port 9328`. Stop an existing helper before changing ports.

The launcher references this checkout and the real, stable Node executable used to install it. Keep both in place. Reinstall after moving the repo or removing that Node installation. To uninstall, stop the helper, quit Slack, and remove `~/Applications/Slack Recents.app` and `~/Library/Application Support/Slack Recents`.

## How it works

The app's executable runs one helper directly, with macOS Launch Services preventing duplicate app instances. It starts only when launched; no login item, LaunchAgent, or automatic restart is installed. The helper starts official Slack with a debugging port bound to **127.0.0.1**. It verifies that the listener belongs to `/Applications/Slack.app`, then watches signed-in `https://app.slack.com/client/` workspace targets. Each newly discovered workspace is reloaded once if its patch is absent; interception stays attached for subsequent reloads. A newly opened window may briefly show the stock client before that automatic reload.

The Chrome DevTools Protocol intercepts public JavaScript assets from `https://a.slack-edge.com/`. The patch changes recent-place budgets, native suggestion ordering, the render limit, and section ordering. It does not maintain a second history database or replace Slack's keyboard handling. Expected code shapes must all match before a rewritten response is returned; incompatible responses continue unchanged.

While attached, each workspace bypasses its service worker and HTTP cache so reloads receive the patch. Modified responses use `no-store`. These session settings are restored on stop. Reloads may use more network traffic while the helper runs.

The official app bundle stays intact. No profile data or credentials are copied, and no sandbox, signing, or integrity settings are changed. The local debugging port remains available until Slack quits; local programs can use it to control the app.

Slack can change its web client independently of desktop updates. Tested against Slack 4.52.178 on macOS with its October 19, 2026 web client.

## Development

```sh
npm test
```

Tests cover native suggestion assembly, empty lists, eight-item limits, section dividers, native selection indices, huddles, incompatible source rejection, persistent interception, new workspace discovery, reconnects, stop cleanup, launcher argument quoting, and singleton control. Live verification also needs real Slack: startup, reload, a new workspace window, duplicate launch, normal quit, arrow keys across sections, Enter, Escape, and typed search. Never send messages while testing.

## Source map

- Launch, status, and stop: `load.mjs`, `src/control.mjs`.
- App installation and stable Node path: `src/install.mjs`.
- Singleton and on-demand lifecycle: `src/install.mjs`, `src/helper.mjs`.
- Reload interception, verification, and cleanup: `src/window.mjs`, `src/cdp.mjs`.
- Suggestion changes and compatibility checks: `src/patch.mjs`, `test/patch.test.mjs`.
- Live compatibility details are verified on the installed Slack client; fixtures alone do not establish them.

## License

MIT applies to this project's code only. No Slack code or app binaries are distributed. This is an unofficial local modification, unaffiliated with Slack or Salesforce.
