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
      return {
        sql, args: [], bind(...args) { this.args = args; return this; },
        async first() { return db.prepare(sql).get(...this.args) || null; },
        async all() { return { results: db.prepare(sql).all(...this.args) }; },
        async run() { return { meta: { changes: db.prepare(sql).run(...this.args).changes } }; }
      };
    },
    async batch(items) {
      db.exec('BEGIN');
      try {
        const result = items.map(item => ({ meta: { changes: db.prepare(item.sql).run(...item.args).changes } }));
        db.exec('COMMIT');
        return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  const context = { Response, console, Date, TextEncoder, Uint8Array, btoa, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(read('services/cloudflare/chat-worker/src/index.js').replace('export default {', 'const worker = {'), context);
  return { db, context, env: { CHAT_DB: adapter } };
}

test('read-state import is version-bound, idempotent, and keeps stale imports from changing a newer report', async () => {
  const { db, context, env } = makeDatabase();
  try {
    db.prepare('INSERT INTO report_current(phone10,kind,text,version,updated_at) VALUES(?,?,?,?,?)')
      .run('9990000001', 'morning', 'Synthetic', 'v2:current', 1);
    const request = value => ({ json: async () => value });
    const imported = await context.importReportReadState(request({
      importId: 'report-state-v1-20261022',
      items: [{ phone: '9990000001', kind: 'morning', unread: true, expectedVersion: 'v2:current' }]
    }), env);
    assert.equal((await imported.json()).ok, true);
    let state = await (await context.getParentReportUnread(env, { role: 'parent', phone10: '9990000001' })).json();
    assert.equal(state.reportUnread.morning, true);
    await context.markParentReportRead(request({ kind: 'morning', version: 'v2:stale' }), env, { role: 'parent', phone10: '9990000001' });
    state = await (await context.getParentReportUnread(env, { role: 'parent', phone10: '9990000001' })).json();
    assert.equal(state.reportUnread.morning, true);
    await context.markParentReportRead(request({ kind: 'morning', version: 'v2:current' }), env, { role: 'parent', phone10: '9990000001' });
    state = await (await context.getParentReportUnread(env, { role: 'parent', phone10: '9990000001' })).json();
    assert.equal(state.reportUnread.morning, false);
    const replay = await context.importReportReadState(request({
      importId: 'report-state-v1-20261022',
      items: [{ phone: '9990000001', kind: 'morning', unread: true, expectedVersion: 'v2:current' }]
    }), env);
    assert.equal((await replay.json()).alreadyImported, true);
    state = await (await context.getParentReportUnread(env, { role: 'parent', phone10: '9990000001' })).json();
    assert.equal(state.reportUnread.morning, false);
  } finally { db.close(); }
});

test('inactivity import keeps absolute dates and tiers; live sync cannot undo educator acknowledgement', async () => {
  const { db, context, env } = makeDatabase();
  try {
    const lastReportAt = Date.UTC(2026, 9, 17, 9), firstSeenAt = Date.UTC(2026, 9, 1, 9);
    const request = value => ({ json: async () => value });
    await context.syncReportInactivity(request({ mode: 'import', items: [{
      phone: '9990000002', lastNewReportAt: lastReportAt, lastPromptDays: 7, firstSeenAt, rosterOrder: 4
    }] }), env);
    let row = db.prepare('SELECT * FROM report_inactivity_state WHERE phone10=?').get('9990000002');
    assert.equal(row.last_new_report_at, lastReportAt);
    assert.equal(row.last_prompt_days, 7);
    await context.acknowledgeReportInactivity(request({
      phone: '9990000002', tier: 21, expectedLastNewReportAt: lastReportAt, expectedFirstSeenAt: firstSeenAt
    }), env);
    await context.syncReportInactivity(request({ items: [{
      phone: '9990000002', lastNewReportAt: lastReportAt, lastPromptDays: 7, firstSeenAt, rosterOrder: 4
    }] }), env);
    row = db.prepare('SELECT * FROM report_inactivity_state WHERE phone10=?').get('9990000002');
    assert.equal(row.last_prompt_days, 21);
    const staleAck = await context.acknowledgeReportInactivity(request({
      phone: '9990000002', tier: 21, expectedLastNewReportAt: lastReportAt - 1, expectedFirstSeenAt: firstSeenAt
    }), env);
    assert.equal(staleAck.status, 404);
  } finally { db.close(); }
});

test('deleting a profile also deletes its D1 inactivity state', async () => {
  const { db, context, env } = makeDatabase();
  try {
    db.prepare('INSERT INTO chat_profiles(phone10,parent_name,child_name) VALUES(?,?,?)')
      .run('9990000003', 'Synthetic', 'Synthetic child');
    db.prepare('INSERT INTO report_inactivity_state(phone10,last_new_report_at,first_seen_at,last_prompt_days) VALUES(?,?,?,?)')
      .run('9990000003', 10, 1, 7);
    env.CHAT_MEDIA = { delete: async () => {} };
    const response = await context.deleteProfilePhone({ json: async () => ({ phone: '89990000003' }) }, env);
    assert.equal((await response.json()).ok, true);
    assert.equal(db.prepare('SELECT count(*) AS n FROM report_inactivity_state WHERE phone10=?').get('9990000003').n, 0);
  } finally { db.close(); }
});
