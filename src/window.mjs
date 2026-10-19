import { patchMarker, patchSearch } from './patch.mjs';

export const verificationExpression = `(() => {
  const chunks = globalThis.rspackChunkGantryV2;
  if (!chunks?.push) return false;
  let runtime;
  chunks.push([['slack-recents-verification-' + crypto.randomUUID()], {}, value => { runtime = value; }]);
  return Object.values(runtime?.m ?? {}).some(factory => String(factory).includes(${JSON.stringify(patchMarker)}));
})()`;

// Keep interception active for the lifetime of this workspace, including reloads.
export async function watchWindow(client, report) {
  const pending = new Set();
  let closed = false;
  let delivered = false;
  let verified = false;
  let checking = false;
  let deadline = 0;
  const unsubscribe = client.onEvent(event => {
    if (event.method === 'Page.frameNavigated' && !event.params.frame.parentId) {
      delivered = false;
      verified = false;
      deadline = Date.now() + 45000;
    }
    if (event.method !== 'Fetch.requestPaused') return;
    const task = intercept(event.params);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });

  async function intercept(params) {
    const { requestId, responseStatusCode } = params;
    let handled = false;
    try {
      if (responseStatusCode !== 200) return;
      const body = await client.send('Fetch.getResponseBody', { requestId });
      const source = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
      const patched = patchSearch(source);
      if (patched === null) return;
      const headers = (params.responseHeaders ?? []).filter(header => !['content-encoding', 'content-length', 'cache-control', 'etag', 'last-modified'].includes(header.name.toLowerCase()));
      headers.push({ name: 'Cache-Control', value: 'no-store' });
      await client.send('Fetch.fulfillRequest', { requestId, responseCode: responseStatusCode, responseHeaders: headers, body: Buffer.from(patched).toString('base64') });
      handled = true;
      delivered = true;
      deadline = Date.now() + 45000;
    } catch (error) {
      if (!closed) report(`Patch rejected; keeping Slack's original response: ${error.message}`);
    } finally {
      if (!handled) await client.send('Fetch.continueRequest', { requestId }).catch(() => {});
    }
  }

  async function check() {
    if (closed || checking || verified) return;
    checking = true;
    try {
      const result = await client.send('Runtime.evaluate', { expression: verificationExpression, returnByValue: true });
      if (result?.result?.value === true) {
        verified = true;
        report('Loaded: Recent places first, up to 8 entries. Press ⌘K.');
      } else if (deadline && Date.now() > deadline) {
        report(delivered ? 'The modified search bundle did not initialize.' : 'Search bundle not found; Slack may have changed. Original responses remain available.');
        deadline = 0;
      }
    } catch { /* Navigation can replace the execution context between checks. */ }
    finally { checking = false; }
  }

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    await client.send('Fetch.disable').catch(() => {});
    await Promise.allSettled([...pending]);
    unsubscribe();
    await client.send('Network.setBypassServiceWorker', { bypass: false }).catch(() => {});
    await client.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});
    client.close();
  }

  let timer;
  try {
    await client.send('Page.enable');
    await client.send('Network.enable');
    await client.send('Network.setBypassServiceWorker', { bypass: true });
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    await client.send('Fetch.enable', { patterns: [{ urlPattern: 'https://a.slack-edge.com/*', resourceType: 'Script', requestStage: 'Response' }] });
    await check();
    if (!verified) {
      deadline = Date.now() + 45000;
      await client.send('Page.reload', { ignoreCache: true });
    }
    timer = setInterval(() => { void check(); }, 1000);
    return { close, get verified() { return verified; } };
  } catch (error) {
    await close();
    throw error;
  }
}
