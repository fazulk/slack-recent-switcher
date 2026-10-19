import assert from 'node:assert/strict';
import test from 'node:test';
import { syncWindows } from '../src/helper.mjs';

test('workspace discovery retries failures, attaches new targets once, and cleans up closed windows', async () => {
  const windows = new Map();
  const connections = [];
  const target = id => ({ id, type: 'page', url: `https://app.slack.com/client/${id}`, webSocketDebuggerUrl: id });
  const connectClient = async id => {
    const client = {
      id, connected: true, calls: [],
      onEvent() { return () => {}; },
      async send(method, params) { this.calls.push({ method, params }); return { result: { value: false } }; },
      close() { this.connected = false; }
    };
    connections.push(client);
    return client;
  };
  try {
    const first = target('first');
    const second = target('second');
    const failure = await syncWindows(windows, [first], () => {}, async () => { throw new Error('Target closed during discovery'); });
    assert.equal(failure, 'Target closed during discovery');
    assert.equal(windows.size, 0);
    await syncWindows(windows, [first, { id: 'popout', type: 'page', url: 'about:blank' }, { id: 'external', type: 'page', url: 'https://example.com/' }], () => {}, connectClient);
    assert.equal(windows.size, 1);
    assert.equal(connections.length, 1);
    await syncWindows(windows, [first, second], () => {}, connectClient);
    assert.equal(windows.size, 2);
    assert.equal(connections.length, 2);
    assert.equal(connections[0].calls.filter(call => call.method === 'Page.reload').length, 1);
    assert.equal(connections[1].calls.filter(call => call.method === 'Page.reload').length, 1);
    await syncWindows(windows, [first, second], () => {}, connectClient);
    assert.equal(connections.length, 2);
    connections[1].connected = false;
    await syncWindows(windows, [second], () => {}, connectClient);
    assert.equal(windows.size, 1);
    assert.equal(connections.length, 3);
    assert.equal(connections[0].connected, false);
    assert.ok(connections[0].calls.some(call => call.method === 'Network.setCacheDisabled' && call.params.cacheDisabled === false));
    assert.ok(connections[1].calls.some(call => call.method === 'Fetch.disable'));
  } finally { await syncWindows(windows, [], () => {}, connectClient); }
  assert.equal(windows.size, 0);
});
