// Behavioural test for patches/baileys+7.0.0-rc.9.patch (Baileys #2858, Evolution #2778).
// It lives here, beside the patch it proves, because upstream's .gitignore excludes /test/.
//
// It runs the real Baileys socket against a WebSocket server on localhost, so it
// never contacts WhatsApp. Before the Noise handshake completes Baileys sends
// frames unencrypted, which lets the test read exactly what goes on the wire.
//
//   docker run --rm --entrypoint node -v "$PWD/patches:/evolution/patches:ro" <image> \
//     --test --test-force-exit patches/baileys-status-ack.test.mjs
//
// On an unpatched Baileys 7.0.0-rc.9 all three tests fail.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import makeWASocket, { decodeBinaryNode, useMultiFileAuthState } from 'baileys';
import pino from 'pino';

// `ws` is a dependency of Baileys, not of Evolution, so resolve it from Baileys.
const { WebSocketServer } = createRequire(import.meta.resolve('baileys'))('ws');

const CONTACT = '5511999999999@s.whatsapp.net';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await sleep(20);
  }
}

/** The <ack> attributes carried by one websocket message, or null if it is not an ack. */
async function ackAttrs(data) {
  const frame = Buffer.from(data);
  // The first frame carries the one-time "WA" intro header and the ClientHello.
  if (frame.subarray(0, 2).toString('latin1') === 'WA') return null;
  const size = (frame[0] << 16) | frame.readUInt16BE(1);
  try {
    const node = await decodeBinaryNode(frame.subarray(3, 3 + size));
    return node.tag === 'ack' ? node.attrs : null;
  } catch {
    return null;
  }
}

/** Starts a local server plus a Baileys socket connected to it, and collects the acks Baileys sends. */
async function withSocket(run) {
  const dir = await mkdtemp(join(tmpdir(), 'status-ack-'));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));

  const acks = [];
  let connected = false;
  server.on('connection', client => {
    client.on('message', async data => {
      connected = true;
      const attrs = await ackAttrs(data);
      if (attrs) acks.push(attrs);
    });
  });

  const { state } = await useMultiFileAuthState(dir);
  state.creds.me = { id: '1234567890:1@s.whatsapp.net', name: 'Test' };
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    waWebSocketUrl: `ws://127.0.0.1:${server.address().port}`,
  });

  try {
    await waitFor(() => connected, 5000, 'Baileys never connected to the local test server');
    await run({ sock, acks });
  } finally {
    sock.end(new Error('test finished'));
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

const statusNode = (id, extra = {}) => ({ tag: 'status', attrs: { id, from: CONTACT, type: 'media', ...extra } });
const expectedAck = id => ({ id, to: CONTACT, class: 'status', type: 'media' });

test('a live <status> stanza is acknowledged with class "status"', async () => {
  await withSocket(async ({ sock, acks }) => {
    sock.ws.emit('CB:status', statusNode('3A2069ED'));
    await waitFor(() => acks.length > 0, 2000, 'no ack was sent for the <status> stanza');
    assert.deepEqual(acks, [expectedAck('3A2069ED')]);
  });
});

test('a <status> stanza from the offline queue is acknowledged too', async () => {
  await withSocket(async ({ sock, acks }) => {
    sock.ws.emit('CB:status', statusNode('3A2069EE', { offline: '1' }));
    await waitFor(() => acks.length > 0, 2000, 'no ack was sent for the offline <status> stanza');
    assert.deepEqual(acks, [expectedAck('3A2069EE')]);
  });
});

test('one failing offline stanza does not stop the rest of the offline queue', async () => {
  await withSocket(async ({ sock, acks }) => {
    // A <call> with no child element makes Baileys' call handler throw inside the offline loop.
    sock.ws.emit('CB:call', { tag: 'call', attrs: { id: 'CALL1', from: CONTACT, offline: '1' } });
    await sleep(50);
    sock.ws.emit('CB:status', statusNode('3A2069EF', { offline: '1' }));
    await waitFor(
      () => acks.some(ack => ack.id === '3A2069EF'),
      2000,
      'the offline queue stopped after one stanza failed',
    );
    assert.deepEqual(
      acks.filter(ack => ack.class === 'status'),
      [expectedAck('3A2069EF')],
    );
  });
});
