import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { request, serve, status } from '../src/control.mjs';
import { connect } from '../src/cdp.mjs';

test('only one control server owns the launcher; duplicates reuse it and stop is explicit', async () => {
  const directory = await mkdtemp('/tmp/slack-recents-');
  const socket = join(directory, 'helper.sock');
  let stops = 0;
  let close;
  try {
    assert.equal(await status(socket), null);
    close = await serve(socket, () => ({ pid: 123, phase: 'running', windows: 2 }), () => { stops++; });
    assert.ok(close);
    assert.equal(await serve(socket, () => ({ pid: 456 }), () => {}), null);
    const replies = await Promise.all(Array.from({ length: 8 }, () => status(socket)));
    assert.ok(replies.every(reply => reply.pid === 123 && reply.windows === 2));
    assert.equal(stops, 0);
    await request(socket, 'stop');
    assert.equal(stops, 1);
    await close();
    close = undefined;
    assert.equal(await status(socket), null);
  } finally {
    await close?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test('CDP rejects non-loopback and non-WebSocket endpoints', async () => {
  for (const url of ['ws://example.com/devtools/page/1', 'ws://localhost/devtools/page/1', 'wss://127.0.0.1/devtools/page/1', 'http://127.0.0.1/']) {
    await assert.rejects(connect(url), /Only loopback/);
  }
});
