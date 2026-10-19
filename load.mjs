#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from './src/cdp.mjs';
import { patchSearch } from './src/patch.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node load.mjs [--port 9327]\nQuit Slack first on the first run. Loads eight recents above unreads in the official macOS app.\nRun again after restarting or reloading Slack. No npm install is needed.');
  process.exit(0);
}
if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('Usage: node load.mjs [--port 9327]');
const port = Number(args[1] ?? 9327);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer between 1024 and 65535.');
const endpoint = `http://127.0.0.1:${port}`;

async function targets() {
  const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error('Could not list Slack windows.');
  const result = await response.json();
  if (!Array.isArray(result)) throw new Error('The local port did not return debugging targets.');
  return result.filter(target => target.type === 'page' && typeof target.url === 'string' && target.url.startsWith('https://app.slack.com/client/'));
}

async function findSlack() {
  let list;
  try { list = await targets(); } catch (error) {
    if (process.platform !== 'darwin') throw new Error('Automatic launch supports macOS. Start Slack with --remote-debugging-address=127.0.0.1 and --remote-debugging-port=' + port, { cause: error });
    execFileSync('/usr/bin/open', ['-a', '/Applications/Slack.app', '--args', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`]);
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    try { list = await targets(); if (list.length) return list; } catch { /* Slack may still be starting. */ }
    await delay(250);
  }
  if (list) throw new Error('Open a signed-in Slack workspace, then run this script again.');
  throw new Error('Slack is already running without the debugging flag. Quit Slack completely with ⌘Q, then run this script again.');
}

async function load(target) {
  const client = await connect(target.webSocketDebuggerUrl);
  let settle;
  let fail;
  let timeout;
  let patchedUrl;
  const applied = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  const pending = new Set();
  async function intercept(params) {
    const { requestId, request, responseStatusCode } = params;
    let handled = false;
    try {
      if (responseStatusCode !== 200) { await client.send('Fetch.continueRequest', { requestId }); return; }
      const body = await client.send('Fetch.getResponseBody', { requestId });
      const source = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
      const patched = patchSearch(source);
      if (patched === null) { await client.send('Fetch.continueRequest', { requestId }); return; }
      const headers = (params.responseHeaders ?? []).filter(header => !['content-encoding', 'content-length', 'cache-control', 'etag', 'last-modified'].includes(header.name.toLowerCase()));
      headers.push({ name: 'Cache-Control', value: 'no-store' });
      await client.send('Fetch.fulfillRequest', { requestId, responseCode: responseStatusCode, responseHeaders: headers, body: Buffer.from(patched).toString('base64') });
      handled = true;
      patchedUrl = request.url;
      settle();
    } catch (error) {
      if (!handled) await client.send('Fetch.continueRequest', { requestId }).catch(() => {});
      fail(error);
    }
  }
  const unsubscribe = client.onEvent(event => {
    if (event.method !== 'Fetch.requestPaused') return;
    const task = intercept(event.params);
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  try {
    await client.send('Network.enable');
    await client.send('Network.setBypassServiceWorker', { bypass: true });
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    await client.send('Fetch.enable', { patterns: [{ urlPattern: 'https://a.slack-edge.com/*', resourceType: 'Script', requestStage: 'Response' }] });
    timeout = setTimeout(() => fail(new Error('Slack’s search bundle was not found within 45 seconds. The client may have changed.')), 45000);
    console.log('Reloading Slack to load the native switcher patch…');
    await Promise.all([client.send('Page.reload', { ignoreCache: true }), applied]);
    for (let attempt = 0; attempt < 80; attempt++) {
      const result = await client.send('Runtime.evaluate', { expression: `(() => {
        const chunks = globalThis.rspackChunkGantryV2;
        if (!chunks?.push) return false;
        let runtime;
        chunks.push([['slack-recents-verification-' + crypto.randomUUID()], {}, value => { runtime = value; }]);
        return Object.values(runtime?.m ?? {}).some(factory => {
          const source = String(factory);
          return source.includes('renderBlankSlateSuggestions(){') && /\\.slice\\(0,8\\)\\.map/.test(source) && !/=[\\w$]+\\.length>0\\?3:5/.test(source);
        });
      })()`, returnByValue: true }).catch(error => {
        if (/Inspected target navigated or closed|Execution context was destroyed|Cannot find context/.test(error.message)) return null;
        throw error;
      });
      if (result?.exceptionDetails) throw new Error('Slack could not verify the loaded search bundle.');
      if (result?.result?.value === true) {
        console.log('Loaded: Recent places first, up to 8 entries. Press ⌘K.');
        return patchedUrl;
      }
      await delay(250);
    }
    throw new Error('The modified search bundle was delivered but did not initialize.');
  } finally {
    clearTimeout(timeout);
    await client.send('Fetch.disable').catch(() => {});
    await Promise.allSettled([...pending]);
    unsubscribe();
    await client.send('Network.setBypassServiceWorker', { bypass: false }).catch(() => {});
    await client.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});
    client.close();
  }
}

try {
  const windows = await findSlack();
  for (const window of windows) await load(window);
  console.log('Done. Run this script again after reloading or restarting Slack.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
