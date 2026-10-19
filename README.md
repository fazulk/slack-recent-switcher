# Slack Recent Switcher

A script for the official Slack desktop app: **Recent places first, up to eight entries**, followed by **Unreads & drafts**. It keeps Slack’s own switcher, search, history, and keyboard handlers.

## Run

Requires macOS, the official app at `/Applications/Slack.app`, and Node.js 22 or newer. There are no npm dependencies.

1. Quit Slack completely with **⌘Q** on the first run.
2. From this directory, run:

```sh
node load.mjs
```

`npm start` does the same thing. You can also double-click `Install.command` in Finder.

The script starts Slack with a debugging port bound to `127.0.0.1`, reloads the open workspace windows, changes the search bundle as it loads, checks that the modified module is present, and exits. Press **⌘K** to use the native switcher. Your existing Slack profile and sign-in are used.

Run the script again after restarting or reloading Slack. The change lasts in the current page until its next reload. A newly opened Slack window may need another run. Eight is a maximum: Slack still excludes the current location, unread places already listed below, and history entries it cannot resolve.

If Slack is already running without the debugging flag, the script asks you to quit it and rerun. If port 9327 is occupied, use `node load.mjs --port 9328` after quitting Slack.

## How it works

The loader uses the Chrome DevTools Protocol to intercept Slack’s public JavaScript asset during a reload. It changes the recent-place budget, the native suggestion order, the render limit, and the section order. It does not replace the switcher or maintain a second history database.

The official app bundle stays intact. Modified responses use `no-store`; the loader bypasses the service worker and disables the HTTP cache for its reload, then restores those settings before disconnecting. It does not copy credentials or create another app/profile.

The local debugging port remains available until Slack quits; local programs can use it to control the app. Quit Slack and open it normally to close that port and return to the stock switcher.

Slack can change its web client independently of desktop updates. The patch checks the expected code shapes and rejects unsupported versions instead of returning a partial rewrite. Tested against Slack 4.52.178 on macOS with its October 19, 2026 web client.

## Development

```sh
npm test
```

Tests cover both native suggestion assembly paths, empty lists, the eight-item limit, section dividers, native selection indices, huddles, and rejection of incompatible source. Live verification also needs the real Slack app; fixtures alone do not prove compatibility with a new client.

## License

MIT applies to this project’s code only. No Slack code or app binaries are distributed. This is an unofficial local modification, unaffiliated with Slack or Salesforce.
