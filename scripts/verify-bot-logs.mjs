import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

const source = readFileSync(new URL('../services/cloudflare/chat-worker/src/bot-logs.js', import.meta.url), 'utf8');
const originalCrypto = globalThis.crypto;
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
  subtle: { timingSafeEqual: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) }
} });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { saveBotLog, listBotLogs } = await import(moduleUrl);

const values = new Map();
const env = {
  BOT_LOG_VIEWER_TOKEN: '0123456789abcdef0123456789abcdef',
  CHAT_MEDIA: {
    async put(key, value, options) { values.set(key, { value: JSON.parse(value), options }); },
    async get(key) { return values.get(key)?.value || null; },
    async list({ prefix }) {
      return { keys: [...values.keys()].filter(key => key.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true };
    }
  }
};
const parent = { role: 'parent', phone10: '9000000000' };
const entry = {
  sessionId: '12345678-1234-4123-8123-123456789abc',
  eventId: 'abcdef12-1234-4123-8123-123456789abc',
  entries: [{ side: 'user', text: 'Когда отчёт?' }, { side: 'bot', text: 'Утренний отчёт с 15:00 до 16:00.' }]
};
const request = payload => new Request('https://example.test/lab/bot-log', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
});

assert.equal((await saveBotLog(request(entry), env, { role: 'educator' })).status, 403);
assert.equal((await saveBotLog(request({ ...entry, eventId: 'bad' }), env, parent)).status, 400);
assert.equal((await saveBotLog(request(entry), env, parent)).status, 200);
assert.equal(values.size, 1);
const stored = [...values.values()][0];
assert.equal(stored.options.expirationTtl, 30 * 24 * 60 * 60);
assert.equal(JSON.stringify(stored.value).includes(parent.phone10), false);

const viewerRequest = token => new Request('https://example.test/admin/bot-logs', {
  headers: { authorization: `Bearer ${token}` }
});
assert.equal((await listBotLogs(viewerRequest('wrong'), env)).status, 401);
const listed = await (await listBotLogs(viewerRequest(env.BOT_LOG_VIEWER_TOKEN), env)).json();
assert.equal(listed.records.length, 1);
assert.equal(listed.records[0].entries[0].text, 'Когда отчёт?');

Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
console.log('✓ Журнал Медси Бота: доступ, срок хранения и запись диалога');
