const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const migrations = path.join(root, 'services/cloudflare/chat-worker/migrations');
const source = fs.readFileSync(path.join(root, 'services/cloudflare/chat-worker/src/index.js'), 'utf8');

function fixture() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  fs.readdirSync(migrations).filter(file => file.endsWith('.sql')).sort()
    .forEach(file => db.exec(fs.readFileSync(path.join(migrations, file), 'utf8')));
  db.prepare(`INSERT INTO chat_profiles
    (phone10,parent_name,child_name,profile_generation,child_admission_id)
    VALUES(?,?,?,?,?)`).run('9000000001','Synthetic Parent','Synthetic Child','reg_new_1234567890','adm_child_123456');

  const adapter = {
    prepare(sql) {
      return {
        sql, args:[], bind(...args) { this.args=args; return this; },
        async first() { return db.prepare(sql).get(...this.args) || null; },
        async all() { return { results:db.prepare(sql).all(...this.args) }; },
        async run() { return { meta:{ changes:db.prepare(sql).run(...this.args).changes } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const values = statements.map(statement => ({ meta:{ changes:db.prepare(statement.sql).run(...statement.args).changes } }));
        db.exec('COMMIT');
        return values;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  const context = { Response, Intl, URL, Date, console };
  vm.createContext(context);
  vm.runInContext(source.replace('export default {','const worker = {'), context);
  return { db, env:{ CHAT_DB:adapter }, worker:context };
}

function report(text, version, overrides={}) {
  return { phone:'9000000001',kind:'morning',text,version,updatedAt:100,
    profileGeneration:'reg_new_1234567890',childAdmissionId:'adm_child_123456',...overrides };
}
function publication(expectedRevision, sourceFingerprint, publicationId) {
  return { expectedRevision,sourceFingerprint,publicationId };
}
function request(payload) { return { json:async()=>payload }; }
async function parse(response) { return response.json(); }

test('Cloudflare rejects an older report batch after a newer publication wins', async () => {
  const x=fixture();
  try {
    let result=await parse(await x.worker.upsertCurrentReports(request({
      reports:[report('Newest report','v2:new')],
      publications:{morning:publication(0,'source_new_123456','publication_new_123456')}
    }),x.env));
    assert.equal(result.rejectedRows,0);
    assert.equal(result.states.morning.revision,1);

    result=await parse(await x.worker.upsertCurrentReports(request({
      reports:[report('Late stale report','v2:old')],
      publications:{morning:publication(0,'source_old_123456','publication_old_123456')}
    }),x.env));
    assert.deepEqual(Array.from(result.rejectedKinds),['morning']);
    assert.equal(result.rejectedRows,1);
    assert.equal(x.db.prepare('SELECT text FROM report_current WHERE phone10=? AND kind=?').get('9000000001','morning').text,'Newest report');
    assert.equal(x.db.prepare('SELECT revision FROM report_publication_state WHERE kind=?').get('morning').revision,1);
  } finally { x.db.close(); }
});

test('a current admission publishes without a profile generation marker, while a previous admission is rejected', async () => {
  const x=fixture();
  try {
    await x.worker.upsertCurrentReports(request({
      reports:[report('First report','v2:first')],
      publications:{morning:publication(0,'source_first_1234','publication_first_1234')}
    }),x.env);
    let result=await parse(await x.worker.upsertCurrentReports(request({
      reports:[report('Second report','v2:second')],
      publications:{morning:publication(1,'source_second_1234','publication_second_1234')}
    }),x.env));
    assert.equal(result.rejectedRows,0);
    assert.equal(result.states.morning.revision,2);

    result=await parse(await x.worker.upsertCurrentReports(request({
      reports:[report('Current admission report','v2:current-admission',{profileGeneration:''})],
      publications:{morning:publication(2,'source_currentadm_1234','publication_currentadm_1234')}
    }),x.env));
    assert.deepEqual(Array.from(result.rejectedKinds),[]);
    assert.equal(result.rejectedRows,0);
    assert.equal(x.db.prepare('SELECT text FROM report_current WHERE phone10=? AND kind=?').get('9000000001','morning').text,'Current admission report');
    assert.equal(x.db.prepare('SELECT profile_generation FROM report_current WHERE phone10=? AND kind=?').get('9000000001','morning').profile_generation,'');
    assert.equal(x.db.prepare('SELECT revision FROM report_publication_state WHERE kind=?').get('morning').revision,3);

    result=await parse(await x.worker.upsertCurrentReports(request({
      reports:[report('Previous admission report','v2:previous-admission',{
        profileGeneration:'reg_old_1234567890',childAdmissionId:'adm_old_child_1234'
      })],
      publications:{morning:publication(3,'source_previousadm_1234','publication_previousadm_1234')}
    }),x.env));
    assert.deepEqual(Array.from(result.rejectedKinds),['morning']);
    assert.equal(result.rejectedRows,1);
    assert.equal(x.db.prepare('SELECT text FROM report_current WHERE phone10=? AND kind=?').get('9000000001','morning').text,'Current admission report');
    assert.equal(x.db.prepare('SELECT revision FROM report_publication_state WHERE kind=?').get('morning').revision,3);
  } finally { x.db.close(); }
});

test('history cannot be replaced by a stale or mismatched current publication', async () => {
  const x=fixture();
  try {
    for (const [revision, text, version, fingerprint, publicationId] of [
      [0,'First report','v2:first','source_first_1234','publication_first_1234'],
      [1,'Second report','v2:second','source_second_1234','publication_second_1234']
    ]) {
      await x.worker.upsertCurrentReports(request({reports:[report(text,version)],
        publications:{morning:publication(revision,fingerprint,publicationId)}}),x.env);
    }
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM report_current').get().n,1);
    assert.deepEqual({ ...x.db.prepare('SELECT phone10,kind,text,revision,publication_id,profile_generation,child_admission_id FROM report_current').get() }, {
      phone10:'9000000001',kind:'morning',text:'Second report',revision:2,publication_id:'publication_second_1234',
      profile_generation:'',child_admission_id:'adm_child_123456'
    });
    assert.ok(x.db.prepare(`SELECT 1 FROM report_current c JOIN chat_profiles p ON p.phone10=c.phone10
      WHERE c.phone10=? AND c.kind=? AND c.text=? AND c.revision=? AND c.publication_id=?
        AND c.child_admission_id=? AND p.child_admission_id=c.child_admission_id`)
      .get('9000000001','morning','Second report',2,'publication_second_1234','adm_child_123456'));
    const snapshots = (revision,text,publicationId) => ({ snapshots:[{
      phone:'9000000001',kind:'morning',reportDate:'2026-10-22',text,capturedAt:200,
      profileGeneration:'reg_new_1234567890',childAdmissionId:'adm_child_123456',revision,publicationId
    }] });
    const saved=await parse(await x.worker.upsertReportSnapshots(request(snapshots(2,'Second report','publication_second_1234')),x.env));
    assert.equal(saved.saved,1,JSON.stringify(saved));
    let result=await parse(await x.worker.upsertReportSnapshots(request(snapshots(1,'Stale report','publication_first_1234')),x.env));
    assert.equal(result.updated,0);
    assert.equal(x.db.prepare('SELECT text FROM report_snapshots WHERE phone10=?').get('9000000001').text,'Second report');
  } finally { x.db.close(); }
});
