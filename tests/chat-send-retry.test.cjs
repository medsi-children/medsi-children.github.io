const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'chat-overlay', 'transport.js'), 'utf8');

function transport(fetch) {
  const window = { location: { origin: 'https://example.test' } };
  const document = {
    getElementById: () => null,
    createElement: () => ({}),
    querySelectorAll: () => [],
    addEventListener: () => {},
    documentElement: {},
    head: { appendChild: () => {} }
  };
  class MutationObserver { observe() {} }
  vm.runInNewContext(source, {
    window, document, fetch, MutationObserver, AbortController, setTimeout, clearTimeout,
    crypto: { randomUUID: () => 'one-send-id' }
  });
  return window.MedsiOverlayTransport;
}

test('a lost send response retries the same message id', async () => {
  const requests = [];
  const chat = transport(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) throw new TypeError('VPN disconnected');
    return { ok: true, status: 200, json: async () => ({ ok: true, message: { messageKey: 'saved' } }) };
  });
  const result = await chat.sendMessage({ token: 'session' }, 'parent', '9991112233', { type: 'text', text: 'Привет' });
  assert.equal(result.message.messageKey, 'saved');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].clientMessageId, 'one-send-id');
  assert.deepEqual(requests[0], requests[1]);
});

test('an access denial is not retried', async () => {
  let calls = 0;
  const chat = transport(async () => {
    calls += 1;
    return { ok: false, status: 403, json: async () => ({ ok: false, message: 'Forbidden' }) };
  });
  await assert.rejects(chat.sendMessage({ token: 'session' }, 'parent', '9991112233', { type: 'text', text: 'Привет' }), /Forbidden/);
  assert.equal(calls, 1);
});

test('a temporary Timeweb gateway error gets one more attempt', async () => {
  let calls = 0;
  const chat = transport(async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 502, json: async () => ({ ok: false, code: 'UPSTREAM_UNAVAILABLE' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, message: { messageKey: 'saved' } }) };
  });
  const result = await chat.sendMessage({ token: 'session' }, 'parent', '9991112233', { type: 'text', text: 'Привет' });
  assert.equal(result.message.messageKey, 'saved');
  assert.equal(calls, 2);
});

test('other writes remain single-attempt operations', async () => {
  let calls = 0;
  const chat = transport(async () => { calls += 1; throw new TypeError('network failed'); });
  await assert.rejects(chat.markRead({ token: 'session' }, 'parent', '9991112233'));
  assert.equal(calls, 1);
});
