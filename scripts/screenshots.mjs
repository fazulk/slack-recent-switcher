#!/usr/bin/env node
// Renders the README screenshots from sample data (fictional names) in the isolated Electron fixture.
process.env.SLACK_RECENTS_MAIN = 'scripts/screenshots-main.cjs';
await import('./test-electron.mjs');
