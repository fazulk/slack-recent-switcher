import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { watchWindow } from '../src/window.mjs';

const source = readFileSync(new URL('./search.fixture.txt', import.meta.url), 'utf8');

function fakeClient(alreadyPatched = false) {
  const calls = [];
  const listeners = new Set();
  let body = source;
  return {
    calls,
    setBody(value) { body = value; },
    emit(method, params) { for (const listener of listeners) listener({ method, params }); },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async send(method, params = {}) {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') return { result: { value: alreadyPatched } };
      if (method === 'Fetch.getResponseBody') return { body, base64Encoded: false };
      return {};
    },
    close() { calls.push({ method: 'close' }); }
  };
}

test('interception stays active across reloads and restores settings on stop', async () => {
  const client = fakeClient();
  const session = await watchWindow(client, () => {});
  try {
    assert.equal(client.calls.filter(call => call.method === 'Page.reload').length, 1);
    for (let reload = 0; reload < 2; reload++) {
      client.emit('Page.frameNavigated', { frame: { id: 'main', url: 'https://app.slack.com/client/workspace' } });
      client.emit('Fetch.requestPaused', { requestId: `script-${reload}`, responseStatusCode: 200, responseHeaders: [{ name: 'Content-Encoding', value: 'gzip' }, { name: 'Cache-Control', value: 'max-age=31536000' }] });
      await setImmediate();
    }
    const responses = client.calls.filter(call => call.method === 'Fetch.fulfillRequest');
    assert.equal(responses.length, 2);
    for (const { params } of responses) {
      assert.match(Buffer.from(params.body, 'base64').toString(), /slice\(0,8\)/);
      assert.deepEqual(params.responseHeaders, [{ name: 'Cache-Control', value: 'no-store' }]);
    }
    assert.equal(client.calls.some(call => call.method === 'Fetch.disable'), false);
  } finally { await session.close(); }
  assert.ok(client.calls.some(call => call.method === 'Fetch.disable'));
  assert.ok(client.calls.some(call => call.method === 'Network.setBypassServiceWorker' && call.params.bypass === false));
  assert.ok(client.calls.some(call => call.method === 'Network.setCacheDisabled' && call.params.cacheDisabled === false));
  assert.equal(client.calls.at(-1).method, 'close');
});

test('incompatible, unrelated and non-200 responses continue untouched', async () => {
  const client = fakeClient();
  const errors = [];
  const session = await watchWindow(client, message => errors.push(message));
  try {
    for (const [body, code] of [[source.replace('o=n.length>0?3:5', 'o=6'), 200], ['unrelated()', 200], [source, 404]]) {
      client.setBody(body);
      client.emit('Fetch.requestPaused', { requestId: String(code), responseStatusCode: code });
      await setImmediate();
    }
    assert.equal(client.calls.filter(call => call.method === 'Fetch.continueRequest').length, 3);
    assert.equal(client.calls.some(call => call.method === 'Fetch.fulfillRequest'), false);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /original response/);
  } finally { await session.close(); }
});

test('an already patched workspace attaches without another reload', async () => {
  const client = fakeClient(true);
  const session = await watchWindow(client, () => {});
  try {
    assert.equal(session.verified, true);
    assert.equal(client.calls.some(call => call.method === 'Page.reload'), false);
    assert.ok(client.calls.some(call => call.method === 'Fetch.enable'));
  } finally { await session.close(); }
});
