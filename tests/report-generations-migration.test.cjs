const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrations = path.join(root, 'services/cloudflare/chat-worker/migrations');
const migration = fs.readFileSync(path.join(migrations, '0017_profile_and_report_generations.sql'), 'utf8');

test('generation migration preserves existing data and only links exact active registrations', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    for (const file of fs.readdirSync(migrations).filter(name => /^00(01|03|04|07|10|11|12)_.+\.sql$/.test(name)).sort()) {
      db.exec(fs.readFileSync(path.join(migrations, file), 'utf8'));
    }
    db.exec(`
      INSERT INTO parent_registration_attempts(attempt_id,phone10,parent_name,child_name,status,created_at)
      VALUES ('reg_a','9000000001','Мама А','Аня Примерова','COMPLETED',1);
      INSERT INTO chat_profiles(phone10,parent_name,child_name) VALUES
        ('9000000001','Мама А','Аня Примерова'),
        ('9000000002','Мама Б','Боря Примеров');
      INSERT INTO report_current(phone10,kind,text,version,updated_at) VALUES
        ('9000000001','morning','Синтетический отчёт','old-version',2),
        ('9000000002','evening','Старый отчёт без точной регистрации','old-version',3);
      INSERT INTO report_snapshots(phone10,kind,report_date,text,captured_at)
      VALUES ('9000000001','morning','2026-10-21','Исторический текст',4);
      INSERT INTO parent_deletion_queue(operation_id,phone10,status,created_at,updated_at)
      VALUES ('op_a','9000000001','pending',5,5);
    `);
    db.exec(migration);

    const profile = db.prepare('SELECT profile_generation,child_admission_id FROM chat_profiles WHERE phone10=?').get('9000000001');
    assert.deepEqual({ ...profile }, { profile_generation:'reg_a', child_admission_id:'' });
    const unmatched = db.prepare('SELECT profile_generation FROM chat_profiles WHERE phone10=?').get('9000000002');
    assert.equal(unmatched.profile_generation, '');
    const report = db.prepare('SELECT text,version,profile_generation,child_admission_id,revision,publication_id FROM report_current WHERE phone10=? AND kind=?').get('9000000001','morning');
    assert.deepEqual({ ...report }, { text:'Синтетический отчёт',version:'old-version',profile_generation:'reg_a',child_admission_id:'',revision:0,publication_id:'' });
    const history = db.prepare('SELECT text,profile_generation,child_admission_id,publication_id FROM report_snapshots').get();
    assert.deepEqual({ ...history }, { text:'Исторический текст',profile_generation:'',child_admission_id:'',publication_id:'' });
    assert.equal(db.prepare('SELECT profile_generation FROM parent_deletion_queue').get().profile_generation, '');
  } finally {
    db.close();
  }
});
