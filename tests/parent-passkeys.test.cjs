const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.join(__dirname, '..');

function makeDatabase() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const dir = path.join(repo, 'services/cloudflare/chat-worker/migrations');
  fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()
    .forEach(file => db.exec(fs.readFileSync(path.join(dir, file), 'utf8')));
  const adapter = {
    prepare(sql) {
      return { sql, args: [], bind(...args) { this.args = args; return this; },
        async first() { return db.prepare(sql).get(...this.args) || null; },
        async all() { return { results: db.prepare(sql).all(...this.args) }; },
        async run() { return { meta: { changes: db.prepare(sql).run(...this.args).changes } }; } };
    },
    async batch(items) { return items.map(item => ({ meta: { changes: db.prepare(item.sql).run(...item.args).changes } })); }
  };
  return { db, env: { CHAT_DB: adapter, PARENT_PASSKEY_RP_ID: 'xn----btbhdqvtun.xn--p1ai', PARENT_PASSKEY_ORIGIN: 'https://xn----btbhdqvtun.xn--p1ai' } };
}

test('passkey ceremonies are discoverable, short-lived, and bound to the active parent profile', async () => {
  const { parentPasskeyRegistrationOptions, parentPasskeyAuthenticationOptions } =
    await import('../services/cloudflare/chat-worker/src/parent-passkeys.mjs');
  const { db, env } = makeDatabase();
  try {
    db.prepare('INSERT INTO chat_profiles(phone10,parent_name,child_name) VALUES(?,?,?)')
      .run('9990000001', 'Тест Родитель', 'Тест Ребёнок');
    const parentAuth = { role: 'parent', phone10: '9990000001' };
    const registration = await (await parentPasskeyRegistrationOptions({ json: async () => ({}) }, env, parentAuth)).json();
    assert.equal(registration.ok, true);
    assert.equal(registration.options.authenticatorSelection.residentKey, 'required');
    assert.equal(registration.options.authenticatorSelection.userVerification, 'required');
    assert.equal(registration.options.user.displayName, 'Медси Бот');
    assert.equal(registration.options.user.name.includes('9990000001'), false);
    assert.ok(registration.challengeId.startsWith('pach_'));
    const storedRegistration = db.prepare('SELECT * FROM parent_auth_challenges WHERE challenge_id=?').get(registration.challengeId);
    assert.equal(storedRegistration.purpose, 'registration');
    assert.equal(storedRegistration.phone10, '9990000001');
    assert.ok(storedRegistration.expires_at - storedRegistration.created_at <= 5 * 60 * 1000);

    const login = await (await parentPasskeyAuthenticationOptions({ json: async () => ({}) }, env)).json();
    assert.equal(login.ok, true);
    assert.equal(login.options.userVerification, 'required');
    assert.equal(login.options.allowCredentials, undefined);
    const storedLogin = db.prepare('SELECT * FROM parent_auth_challenges WHERE challenge_id=?').get(login.challengeId);
    assert.equal(storedLogin.purpose, 'authentication');
    assert.equal(storedLogin.phone10, null);
    assert.equal(storedLogin.user_handle, null);
  } finally { db.close(); }
});

test('removing an active profile revokes its passkeys and outstanding ceremonies', () => {
  const { db } = makeDatabase();
  try {
    db.prepare('INSERT INTO chat_profiles(phone10,parent_name,child_name) VALUES(?,?,?)')
      .run('9990000002', 'Тест Родитель', 'Тест Ребёнок');
    const account = db.prepare('SELECT * FROM parent_auth_profiles WHERE phone10=?').get('9990000002');
    db.prepare(`INSERT INTO parent_passkeys(credential_id,user_handle,public_key,counter,created_at)
      VALUES(?,?,?,?,?)`).run('synthetic_credential_1234567890', account.user_handle, new Uint8Array([1, 2, 3]), 0, 1);
    db.prepare(`INSERT INTO parent_auth_challenges(challenge_id,challenge,purpose,phone10,user_handle,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?)`).run('pach_synthetic_1234567890123456', 'challenge', 'registration', '9990000002', account.user_handle, 1, 999999);
    db.prepare('DELETE FROM chat_profiles WHERE phone10=?').run('9990000002');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parent_auth_profiles WHERE phone10=?').get('9990000002').n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parent_passkeys WHERE user_handle=?').get(account.user_handle).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parent_auth_challenges WHERE phone10=?').get('9990000002').n, 0);
  } finally { db.close(); }
});

test('new parent sessions bind to a profile generation while existing pre-migration sessions remain compatible', async () => {
  const { db, env } = makeDatabase();
  const context = { Response, URL, console, Date, TextEncoder, Uint8Array, btoa, atob, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(repo, 'services/cloudflare/chat-worker/src/index.js'), 'utf8')
    .replace('const parentAuthProfileCache = new Map();', 'const parentAuthProfileCache = globalThis.parentAuthProfileCache = new Map();')
    .replace('export default {', 'const worker = {');
  vm.runInContext(source, context);
  env.LAB_D1_SESSION_SECRET = 'test-session-secret';
  try {
    db.prepare('INSERT INTO chat_profiles(phone10,parent_name,child_name) VALUES(?,?,?)')
      .run('9990000003', 'Тест Родитель', 'Тест Ребёнок');
    const modern = await context.issueParentSession('9990000003', env.LAB_D1_SESSION_SECRET, env);
    const modernClaims = JSON.parse(Buffer.from(modern.token.split('.')[0], 'base64url').toString('utf8'));
    assert.ok(modernClaims.exp - Date.now() > 364 * 24 * 60 * 60 * 1000);
    const requestFor = token => ({ method: 'GET', headers: { get: name => name === 'x-medsi-chat-session' ? token : '' } });
    assert.equal((await context.authorized(requestFor(modern.token), env)).authGeneration.length > 0, true);
    db.prepare('DELETE FROM chat_profiles WHERE phone10=?').run('9990000003');
    context.parentAuthProfileCache.delete('9990000003');
    assert.equal(await context.authorized(requestFor(modern.token), env), null);
    db.prepare('INSERT INTO chat_profiles(phone10,parent_name,child_name) VALUES(?,?,?)')
      .run('9990000003', 'Другой Родитель', 'Другой Ребёнок');
    context.parentAuthProfileCache.delete('9990000003');
    assert.equal(await context.authorized(requestFor(modern.token), env), null);

    db.prepare('INSERT INTO chat_profiles(phone10,parent_name,child_name) VALUES(?,?,?)')
      .run('9990000004', 'Старый Родитель', 'Старый Ребёнок');
    db.prepare('UPDATE parent_auth_profiles SET created_at=0 WHERE phone10=?').run('9990000004');
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const payload = context.b64url(new TextEncoder().encode(JSON.stringify({
      role: 'parent', phone10: '9990000004', exp: expiresAt, version: 'cf-parent-v1'
    })));
    const legacyToken = payload + '.' + await context.hmac(env.LAB_D1_SESSION_SECRET, payload);
    context.parentAuthProfileCache.delete('9990000004');
    assert.ok(await context.authorized(requestFor(legacyToken), env));
  } finally { db.close(); }
});

test('the educator fallback is bound to a random device secret and can deliver a session only once', async () => {
  const { db, env } = makeDatabase();
  const context = { Response, URL, console, Date, TextEncoder, Uint8Array, btoa, atob, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(repo, 'services/cloudflare/chat-worker/src/index.js'), 'utf8')
    .replace('const parentAuthProfileCache = new Map();', 'const parentAuthProfileCache = globalThis.parentAuthProfileCache = new Map();')
    .replace('export default {', 'const worker = {');
  vm.runInContext(source, context);
  env.LAB_D1_SESSION_SECRET = 'test-session-secret';
  try {
    db.prepare('INSERT INTO chat_profiles(phone10,parent_name,child_name) VALUES(?,?,?)')
      .run('9990000005', 'Тест Родитель', 'Тест Ребёнок');
    const secret = Buffer.from(require('node:crypto').webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const payload = { phone: '89990000005', requestId: 'auth_12345678901234567890123456789012', requestSecret: secret };
    const request = value => ({ json: async () => value, url: 'https://worker.test/lab/parent-auth/status' });
    const created = await context.requestParentAccess(request(payload), env, null, true);
    const createdBody = await created.json();
    assert.equal(createdBody.ok, true);
    const stored = db.prepare('SELECT request_secret_hash, status FROM parent_access_requests WHERE request_id=?').get(payload.requestId);
    assert.notEqual(stored.request_secret_hash, secret);
    assert.equal(stored.status, 'PENDING');

    const legacyAttempt = await context.requestParentAccess(request({ ...payload, requestSecret: undefined }), env, null, false);
    assert.equal(legacyAttempt.status, 404);
    const wrongSecretStatus = await context.getParentAccessStatus(request({ ...payload, requestSecret: secret + 'x' }), env, true);
    assert.equal((await wrongSecretStatus.json()).status, 'NOT_FOUND');

    await context.decideParentAccessRequest(request({ requestId: payload.requestId, decision: 'APPROVE' }), env);
    const approved = await (await context.getParentAccessStatus(request(payload), env, true)).json();
    assert.equal(approved.status, 'APPROVED');
    assert.ok(approved.parentSession);
    assert.equal(db.prepare('SELECT status FROM parent_access_requests WHERE request_id=?').get(payload.requestId).status, 'CONSUMED');
    const replay = await (await context.getParentAccessStatus(request(payload), env, true)).json();
    assert.equal(replay.status, 'CONSUMED');
    assert.equal(replay.parentSession, undefined);
  } finally { db.close(); }
});
