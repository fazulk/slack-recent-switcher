import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from './cdp.mjs';
import { clearStaleSocket, serve, socketPath } from './control.mjs';
import { watchWindow } from './window.mjs';

const execute = promisify(execFile);
const slackExecutable = '/Applications/Slack.app/Contents/MacOS/Slack';

export async function slackPid() {
  try {
    const { stdout } = await execute('/usr/bin/pgrep', ['-x', 'Slack']);
    for (const pid of stdout.trim().split('\n').map(Number)) {
      const result = await execute('/bin/ps', ['-p', String(pid), '-o', 'comm=']);
      if (result.stdout.trim() === slackExecutable) return pid;
    }
  } catch { return undefined; }
}

async function endpointOwner(port) {
  try {
    const { stdout: output } = await execute('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn']);
    const pids = [...output.matchAll(/^p(\d+)$/gm)].map(match => Number(match[1]));
    const addresses = [...output.matchAll(/^n(.+)$/gm)].map(match => match[1]);
    if (!addresses.length || addresses.some(address => address !== `127.0.0.1:${port}`)) throw new Error('Debugging must listen only on 127.0.0.1.');
    const pid = await slackPid();
    if (!pid || pids.some(owner => owner !== pid)) throw new Error(`Port ${port} is not owned by the official Slack app.`);
    return pid;
  } catch (error) {
    if (error.code === 1) return undefined;
    throw error;
  }
}

export async function runHelper(port) {
  const windows = new Map();
  let stopping = false;
  let phase = 'starting';
  let failure;
  let slack;
  const report = message => console.log(`${new Date().toISOString()} ${message}`);
  const stop = reason => { report(`Stop requested (${reason}).`); stopping = true; };
  const onTerm = () => stop('SIGTERM');
  const onInt = () => stop('SIGINT');
  await clearStaleSocket();
  const closeServer = await serve(socketPath, () => ({ pid: process.pid, port, phase, windows: windows.size, verified: [...windows.values()].filter(window => window.session?.verified).length, error: failure }), () => stop('control'));
  if (!closeServer) return;
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);
  try {
    slack = await endpointOwner(port);
    if (!slack) {
      if (await slackPid()) throw new Error('Quit Slack completely with ⌘Q, then open Slack Recents again. Slack is running without this debugging port.');
      await execute('/usr/bin/open', ['-a', '/Applications/Slack.app', '--args', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`]);
      for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
        slack = await endpointOwner(port);
        if (slack) break;
        await delay(200);
      }
      if (!slack && !stopping) throw new Error('Slack did not open its loopback debugging port within 20 seconds.');
    } else {
      await execute('/usr/bin/open', ['-a', '/Applications/Slack.app']);
    }
    report(`Watching Slack process ${slack}.`);
    phase = 'running';
    while (!stopping) {
      try { process.kill(slack, 0); }
      catch (error) { if (error.code === 'ESRCH') { report(`Slack process ${slack} exited.`); break; } throw error; }
      let targets;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
        if (!response.ok) throw new Error(`Debugging returned HTTP ${response.status}.`);
        targets = await response.json();
        if (!Array.isArray(targets)) throw new Error('Invalid Slack debugging targets.');
        failure = undefined;
      } catch (error) {
        failure = error.message;
        await delay(1000);
        continue;
      }
      failure = await syncWindows(windows, targets, report);
      await delay(750);
    }
  } catch (error) {
    phase = 'error';
    failure = error.message;
    report(failure);
    await delay(2500); // Let the launching process read the actionable error.
    process.exitCode = 1;
  } finally {
    phase = 'stopping';
    await Promise.allSettled([...windows.values()].map(window => window.session?.close()));
    await closeServer();
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInt);
    report('Helper stopped.');
  }
}

export async function syncWindows(windows, targets, report, connectClient = connect) {
  let failure;
  const workspaces = targets.filter(target => target.type === 'page' && target.url?.startsWith('https://app.slack.com/client/'));
  for (const [id, window] of windows) {
    if (workspaces.some(target => target.id === id) && window.client.connected) continue;
    await window.session?.close();
    windows.delete(id);
  }
  for (const target of workspaces) {
    if (windows.has(target.id)) continue;
    try {
      const client = await connectClient(target.webSocketDebuggerUrl);
      const window = { client };
      windows.set(target.id, window);
      window.session = await watchWindow(client, message => report(`[${target.id}] ${message}`));
    } catch (error) {
      windows.get(target.id)?.client.close();
      windows.delete(target.id);
      failure = error.message;
      report(`Could not watch workspace: ${error.message}`);
    }
  }
  return failure;
}
