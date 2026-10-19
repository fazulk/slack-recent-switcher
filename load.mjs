#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { stat, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareState, request, socketPath, stateDirectory, status } from './src/control.mjs';

const usage = 'Usage: node load.mjs [--port 9327] [--install | --status | --stop]\nStarts official Slack and keeps eight recents first across reloads and new windows.\n--install creates ~/Applications/Slack Recents.app and starts it. No npm install needed.';
const args = process.argv.slice(2);
let port = 9327;
let command = 'launch';
try {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') { console.log(usage); process.exit(0); }
    if (arg === '--port') { port = Number(args[++index]); continue; }
    if (!['--install', '--status', '--stop', '--helper'].includes(arg) || command !== 'launch') throw new Error(usage);
    command = arg.slice(2);
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer between 1024 and 65535.');
  if (process.platform !== 'darwin') throw new Error('The Slack Recents launcher requires macOS.');
  if (command === 'helper') {
    process.umask(0o077);
    await prepareState();
    const logPath = join(stateDirectory, 'helper.log');
    if ((await stat(logPath).catch(() => null))?.size > 1024 * 1024) await truncate(logPath, 0);
    const { runHelper } = await import('./src/helper.mjs');
    await runHelper(port);
  } else if (command === 'status') {
    console.log(JSON.stringify(await status() ?? { phase: 'stopped' }, null, 2));
  } else if (command === 'stop') {
    if (await status()) {
      await request(socketPath, 'stop');
      for (let attempt = 0; attempt < 100 && await status(); attempt++) await delay(100);
      if (await status()) throw new Error('Helper is still stopping; check --status and the helper log.');
    }
    console.log('Helper stopped. Slack is still open; quit it to close the debugging port.');
  } else {
    if (command === 'install') {
      const { installLauncher } = await import('./src/install.mjs');
      console.log(`Installed ${await installLauncher(port)}`);
    }
    let current = await status();
    if (!current) {
      await prepareState();
      const { installLauncher, launcherPath } = await import('./src/install.mjs');
      if (command !== 'install') await installLauncher(port);
      execFileSync('/usr/bin/open', [launcherPath]);
    }
    for (let attempt = 0; attempt < 120; attempt++) {
      current = await status();
      if (current && current.phase !== 'starting') break;
      await delay(200);
    }
    if (!current || current.phase === 'starting') throw new Error(`Launcher helper did not start. See ${join(stateDirectory, 'helper.log')}`);
    if (current.phase !== 'running') throw new Error(current.error ?? `Helper is ${current.phase}; try again after it stops.`);
    if (current.port !== port) console.log(`Existing helper uses port ${current.port}. Stop it before changing ports.`);
    execFileSync('/usr/bin/open', ['-a', '/Applications/Slack.app']);
    console.log(`Slack Recents is running (helper ${current.pid}). Use --status or --stop to manage it.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
