const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(repo, name), 'utf8');

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
  const context = { Response, Request, URL, console, Date, TextEncoder, Uint8Array, btoa, atob, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(repo, 'services/cloudflare/chat-worker/src/index.js'), 'utf8')
    .replace('const parentAuthProfileCache = new Map();', 'const parentAuthProfileCache = globalThis.parentAuthProfileCache = new Map();')
    .replace('export default {', 'globalThis.worker = {');
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
    db.prepare('UPDATE parent_auth_profiles SET created_at=? WHERE phone10=?').run(Date.now(), '9990000004');
    context.parentAuthProfileCache.delete('9990000004');
    const noExpiryPayload = context.b64url(new TextEncoder().encode(JSON.stringify({
      phone10:'9990000004', version:'v2'
    })));
    const noExpiryLegacyToken = noExpiryPayload + '.' + await context.hmac(env.LAB_D1_SESSION_SECRET, noExpiryPayload);
    assert.equal(await context.authorized(requestFor(noExpiryLegacyToken), env), null);
    db.prepare('UPDATE parent_auth_profiles SET created_at=0 WHERE phone10=?').run('9990000004');
    context.parentAuthProfileCache.delete('9990000004');
    const renewedResponse = await context.worker.fetch(new Request('https://worker.test/lab/parent-session/renew', {
      method: 'POST', headers: { 'x-medsi-chat-session': legacyToken, 'content-type': 'application/json' }, body: '{}'
    }), env, {});
    const renewed = await renewedResponse.json();
    assert.equal(renewedResponse.status, 200);
    const renewedClaims = JSON.parse(Buffer.from(renewed.parentSession.split('.')[0], 'base64url').toString('utf8'));
    assert.equal(renewedClaims.version, 'cf-parent-v2');
    assert.equal(renewedClaims.phone10, '9990000004');
    assert.ok(renewedClaims.exp - Date.now() > 364 * 24 * 60 * 60 * 1000);
  } finally { db.close(); }
});

test('the educator fallback can safely repeat delivery after a lost response for the same device secret', async () => {
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

    const legacyAttempt = await context.requestParentAccess(request({ ...payload, requestSecret: undefined }), env, null);
    assert.equal(legacyAttempt.status, 400);
    const wrongSecretStatus = await context.getParentAccessStatus(request({ ...payload, requestSecret: secret + 'x' }), env, true);
    assert.equal((await wrongSecretStatus.json()).status, 'NOT_FOUND');

    await context.decideParentAccessRequest(request({ requestId: payload.requestId, decision: 'APPROVE' }), env);
    const approved = await (await context.getParentAccessStatus(request(payload), env, true)).json();
    assert.equal(approved.status, 'APPROVED');
    assert.ok(approved.parentSession);
    assert.equal(db.prepare('SELECT status FROM parent_access_requests WHERE request_id=?').get(payload.requestId).status, 'CONSUMED');
    const replay = await (await context.getParentAccessStatus(request(payload), env, true)).json();
    assert.equal(replay.status, 'APPROVED');
    assert.equal(replay.parentSession, approved.parentSession);
  } finally { db.close(); }
});

test('phone-only access is allowed only during the original 72-hour registration window and only without a passkey', async () => {
  const { db, env } = makeDatabase();
  const context = { Response, URL, console, Date, TextEncoder, Uint8Array, btoa, atob, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(repo, 'services/cloudflare/chat-worker/src/index.js'), 'utf8').replace('export default {', 'globalThis.worker = {'), context);
  env.LAB_D1_SESSION_SECRET = 'test-session-secret';
  try {
    const phone = '9990000006', requestId = 'auth_12345678901234567890123456789012';
    db.prepare('INSERT INTO chat_profiles(phone10,parent_name,child_name) VALUES(?,?,?)').run(phone, 'Тест Родитель', 'Тест Ребёнок');
    db.prepare(`INSERT INTO parent_registration_attempts(attempt_id,phone10,parent_name,child_name,status,created_at)
      VALUES(?,?,?,?,?,?)`).run('reg_12345678901234567890123456789012', phone, 'Тест Родитель', 'Тест Ребёнок', 'COMPLETED', Date.now() - 24 * 60 * 60 * 1000);
    const payload = { phone:'8' + phone, requestId, requestSecret:'A'.repeat(43) };
    const request = value => ({ json:async()=>value, url:'https://worker.test/lab/parent-auth/request' });
    const grace = await (await context.requestParentAccess(request(payload), env, null, true)).json();
    assert.equal(grace.recoveryMode, 'registration-grace');
    assert.ok(grace.parentSession);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parent_access_requests').get().n, 0);

    db.prepare(`INSERT INTO parent_passkeys(credential_id,user_handle,public_key,counter,created_at)
      SELECT ?,user_handle,?,?,? FROM parent_auth_profiles WHERE phone10=?`)
      .run('synthetic_credential_1234567890', new Uint8Array([1]), 0, Date.now(), phone);
    const recovery = await (await context.requestParentAccess(request({ ...payload, requestId:'auth_22345678901234567890123456789012' }), env, null, true)).json();
    assert.equal(recovery.status, 'PENDING');
    assert.equal(recovery.parentSession, undefined);
  } finally { db.close(); }
});

test('old approvals without a device secret cannot issue a session through the current flow', async () => {
  const { db, env } = makeDatabase();
  const context = { Response, URL, console, Date, TextEncoder, Uint8Array, btoa, atob, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(repo, 'services/cloudflare/chat-worker/src/index.js'), 'utf8').replace('export default {', 'globalThis.worker = {'), context);
  env.LAB_D1_SESSION_SECRET = 'test-session-secret';
  try {
    const phone = '9990000007';
    db.prepare('INSERT INTO chat_profiles(phone10,parent_name,child_name) VALUES(?,?,?)').run(phone, 'Тест Родитель', 'Тест Ребёнок');
    const insert = db.prepare(`INSERT INTO parent_access_requests(request_id,phone10,code,status,created_at,updated_at,expires_at,request_secret_hash)
      VALUES(?,?,? ,?,?,?,?,'')`);
    insert.run('auth_12345678901234567890123456789012', phone, '1234', 'APPROVED', Date.now()-200000, Date.now()-100000, Date.now()-50000);
    insert.run('auth_22345678901234567890123456789012', phone, '1234', 'CONSUMED', Date.now()-200000, Date.now()-100000, Date.now()+1000000);
    const request = id => ({
      json:async()=>({ phone:'8'+phone, requestId:id, requestSecret:'A'.repeat(43) }),
      url:'https://worker.test/lab/parent-auth/status'
    });
    const expired = await (await context.getParentAccessStatus(request('auth_12345678901234567890123456789012'), env)).json();
    assert.equal(expired.status, 'NOT_FOUND');
    assert.equal(expired.parentSession, undefined);
    const consumed = await (await context.getParentAccessStatus(request('auth_22345678901234567890123456789012'), env)).json();
    assert.equal(consumed.status, 'NOT_FOUND');
    assert.equal(consumed.parentSession, undefined);
  } finally { db.close(); }
});

test('new registration stores its attempt as the profile generation without changing the access flow', async () => {
  const { db, env } = makeDatabase();
  const context = { Response, console, Date, TextEncoder, Uint8Array, btoa,
    crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(read('services/cloudflare/chat-worker/src/index.js').replace('export default {', 'const worker = {'), context);
  try {
    env.LAB_D1_SESSION_SECRET = 'synthetic-session-secret';
    const attemptId = 'reg_synthetic-generation-001';
    const response = await context.registerParent({ json: async () => ({
      phone:'89990000001', parentName:'Анна Синтетическая', childName:'Миша Примеров', attemptId
    }) }, env);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(db.prepare('SELECT profile_generation FROM chat_profiles WHERE phone10=?').get('9990000001').profile_generation, attemptId);
    assert.equal(db.prepare('SELECT attempt_id FROM parent_registration_outbox WHERE phone10=?').get('9990000001').attempt_id, attemptId);
    assert.ok(result.d1Session && result.d1Session.ok);
  } finally { db.close(); }
});

test('a registration fetched before discharge is rejected on ACK and cannot be restored by stale REPORTS sync', async () => {
  const { db, env } = makeDatabase();
  const context = { Response, console, Date, TextEncoder, Uint8Array, btoa,
    crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(read('services/cloudflare/chat-worker/src/index.js').replace('export default {', 'const worker = {'), context);
  try {
    env.LAB_D1_SESSION_SECRET = 'synthetic-session-secret';
    const attemptId = 'reg_synthetic-discharge-race';
    await context.registerParent({ json:async()=>({ phone:'89990000001', parentName:'Анна Синтетическая', childName:'Миша Примеров', attemptId }) }, env);
    const listed = await (await context.listParentRegistrationOutbox(env)).json();
    assert.equal(listed.registrations.length, 1);

    // Simulate Cloudflare discharge after Apps Script fetched the outbox row.
    db.prepare('DELETE FROM parent_registration_outbox WHERE attempt_id=?').run(attemptId);
    db.prepare('DELETE FROM chat_profiles WHERE phone10=?').run('9990000001');
    db.prepare('DELETE FROM parent_registration_attempts WHERE attempt_id=?').run(attemptId);
    db.prepare(`INSERT INTO parent_deletion_queue
      (operation_id,phone10,parent_name,child_name,status,created_at,updated_at,profile_generation)
      VALUES(?,?,?,?,?,?,?,?)`).run('delete_synthetic-race-001','9990000001','Анна Синтетическая','Миша Примеров','completed',Date.now(),Date.now(),attemptId);

    const ack = await (await context.acknowledgeParentRegistrationOutbox({ json:async()=>({ attemptIds:[attemptId] }) }, env)).json();
    assert.deepEqual(ack.acceptedAttemptIds, []);
    assert.deepEqual(ack.revokedAttemptIds, [attemptId]);

    await context.reconcileProfiles({ json:async()=>({ full:false, profiles:[{
      phone:'89990000001', parentName:'Анна Синтетическая', childName:'Миша Примеров',
      profileGeneration:attemptId, childAdmissionId:'adm_synthetic_old'
    }] }) }, env);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_profiles WHERE phone10=?').get('9990000001').n, 0);

    // A request from an already-running older deployment has no generation at all.
    await context.reconcileProfiles({ json:async()=>({ full:false, profiles:[{
      phone:'89990000001', parentName:'Анна Синтетическая', childName:'Миша Примеров',
      childAdmissionId:'adm_synthetic_old'
    }] }) }, env);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_profiles WHERE phone10=?').get('9990000001').n, 0);

    const nextAttemptId = 'reg_synthetic-new-admission';
    const nextRegistration = await context.registerParent({ json:async()=>({
      phone:'89990000001', parentName:'Анна Синтетическая', childName:'Миша Примеров', attemptId:nextAttemptId
    }) }, env);
    assert.equal((await nextRegistration.json()).ok, true);
    await context.reconcileProfiles({ json:async()=>({ full:false, profiles:[{
      phone:'89990000001', parentName:'Анна Синтетическая', childName:'Миша Примеров',
      profileGeneration:nextAttemptId, childAdmissionId:'adm_synthetic_new'
    }] }) }, env);
    const current = db.prepare('SELECT profile_generation,child_admission_id FROM chat_profiles WHERE phone10=?').get('9990000001');
    assert.equal(current.profile_generation, nextAttemptId);
    assert.equal(current.child_admission_id, 'adm_synthetic_new');
  } finally { db.close(); }
});

test('profile reconciliation rejects a different generation or admission and fills missing metadata', async () => {
  const { db, env } = makeDatabase();
  const context = { Response, console, Date, TextEncoder, Uint8Array, btoa,
    crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(read('services/cloudflare/chat-worker/src/index.js').replace('export default {', 'const worker = {'), context);
  try {
    const current = 'reg_current-synthetic-generation';
    const stale = 'reg_stale-synthetic-generation';
    db.prepare(`INSERT INTO chat_profiles
      (phone10,parent_name,child_name,profile_generation,child_admission_id)
      VALUES(?,?,?,?,?)`).run('9990000001','Анна','Миша Примеров',current,'');
    const request = profile => ({ json: async () => ({ profiles:[profile], full:false }) });
    await context.reconcileProfiles(request({
      phone:'9990000001', parentName:'Старое имя', childName:'Старое имя ребёнка', profileGeneration:stale,
      childAdmissionId:'adm_stale'
    }), env);
    let row = db.prepare('SELECT parent_name,child_name,profile_generation,child_admission_id FROM chat_profiles WHERE phone10=?').get('9990000001');
    assert.equal(row.parent_name, 'Анна');
    assert.equal(row.child_name, 'Миша Примеров');
    assert.equal(row.profile_generation, current);
    assert.equal(row.child_admission_id, '');

    await context.reconcileProfiles(request({
      phone:'9990000001', parentName:'Анна', childName:'Миша Примеров',
      profileGeneration:current, childAdmissionId:'adm_current'
    }), env);
    row = db.prepare('SELECT profile_generation,child_admission_id FROM chat_profiles WHERE phone10=?').get('9990000001');
    assert.equal(row.profile_generation, current);
    assert.equal(row.child_admission_id, 'adm_current');

    await context.reconcileProfiles(request({
      phone:'9990000001', parentName:'Старый профиль', childName:'Другая Саша',
      profileGeneration:current, childAdmissionId:'adm_previous'
    }), env);
    row = db.prepare('SELECT parent_name,child_name,profile_generation,child_admission_id FROM chat_profiles WHERE phone10=?').get('9990000001');
    assert.equal(row.parent_name, 'Анна');
    assert.equal(row.child_name, 'Миша Примеров');
    assert.equal(row.profile_generation, current);
    assert.equal(row.child_admission_id, 'adm_current');

    await context.reconcileProfiles(request({
      phone:'9990000001', parentName:'Анна', childName:'Миша Иванов',
      profileGeneration:current, childAdmissionId:'adm_current'
    }), env);
    row = db.prepare('SELECT child_name,child_admission_id FROM chat_profiles WHERE phone10=?').get('9990000001');
    assert.equal(row.child_name, 'Миша Иванов');
    assert.equal(row.child_admission_id, 'adm_current');
  } finally { db.close(); }
});
