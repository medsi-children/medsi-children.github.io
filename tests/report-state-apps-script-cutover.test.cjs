const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../apps-script/medsi-bot/Медси бот.js'), 'utf8');

function app() {
  const properties = new Map();
  const context = {
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key),
      setProperty: (key, value) => properties.set(key, value)
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, properties };
}

test('report badges keep using Sheets until the D1 cutover flag is set, then read D1', () => {
  const { context, properties } = app();
  context.last10_ = value => String(value || '').replace(/\D/g, '').slice(-10);
  context.ensureReportStateSheet_ = () => ({
    getLastRow: () => 2,
    getRange: () => ({ getValues: () => [['9990000001', 'v1:morning', '', 'v1:evening', 'v1:evening', '', '']] })
  });
  context.getD1ParentReportUnread_ = () => ({ reportUnread: { morning:false, evening:false, psychology:true } });
  let state = context.getReportUnreadStatus_('89990000001');
  assert.equal(state.morning, true, 'legacy unread state remains authoritative before import');
  properties.set('REPORT_STATE_D1_CUTOVER', 'true');
  state = context.getReportUnreadStatus_('89990000001');
  assert.equal(state.morning, false);
  assert.equal(state.psychology, true);
});

test('after cutover minute distribution sync sends only real report events to D1', () => {
  const { context, properties } = app();
  properties.set('REPORT_STATE_D1_CUTOVER', 'true');
  const calls = [];
  context.last10_ = value => String(value || '').replace(/\D/g, '').slice(-10);
  context.d1AdminRequest_ = (path, method, payload) => { calls.push({ path, method, payload }); return { ok:true }; };
  assert.equal(context.syncReportInactivityState_([
    { phone:'9990000001', hasNewReport:false },
    { phone:'9990000002', hasNewReport:false }
  ]).skipped, true);
  assert.equal(calls.length, 0, 'unchanged minute poll spends no D1 request');
  context.syncReportInactivityState_([
    { phone:'9990000001', hasNewReport:false },
    { phone:'9990000002', hasNewReport:true }
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload.items)), [
    { phone:'9990000002', hasNewReport:true, rosterOrder:1 }
  ]);
});

test('after cutover legacy sheet writers and sheet initializers cannot recreate deleted tabs', () => {
  const { context, properties } = app();
  properties.set('REPORT_STATE_D1_CUTOVER', 'true');
  assert.equal(context.syncReportNotificationState_({}, true).skipped, true);
  assert.equal(context.initializeReportNotificationState_().skipped, true);
  assert.equal(context.syncPsychologyNotificationState_('Synthetic report').skipped, true);
  assert.equal(context.syncLegacyReportInactivityState_([]).skipped, true);
  assert.throws(() => context.ensureReportStateSheet_(), /находится в D1/);
  assert.throws(() => context.ensureReportInactivityStateSheet_(), /находится в D1/);
});

test('cutover flag is set only after read-state and active-roster imports are confirmed', () => {
  const { context, properties } = app();
  const calls = [];
  context.Utilities = { formatDate: () => '20261022', getUuid: () => 'synthetic-uuid' };
  context.initializeReportNotificationState_ = () => {};
  context.ensureReportStateSheet_ = () => ({
    getLastRow: () => 2,
    getRange: () => ({ getValues: () => [['89990000001','9990000001','sheet-v1','', '', '', '', '', false, false, false]] })
  });
  context.ensureReportInactivityStateSheet_ = () => ({
    getLastRow: () => 1,
    getRange: () => ({ getValues: () => [] })
  });
  context.getDataSheet_ = () => ({
    getLastRow: () => 2,
    getRange: () => ({ getValues: () => [['89990000001']] })
  });
  context.d1AdminRequest_ = (path, method, payload) => {
    calls.push(path);
    if (path.endsWith('/versions')) return { versions:[{ phone:'9990000001',kind:'morning',version:'v2:current' }] };
    if (path.endsWith('/import')) return { received:payload.items.length,verified:payload.items.length };
    return { received:payload.items.length };
  };
  const result = context.migrateReportNotificationStateToD1();
  assert.equal(result.cutover, true);
  assert.equal(properties.get('REPORT_STATE_D1_CUTOVER'), 'true');
  assert.deepEqual(calls, ['/admin/report-current/versions','/admin/report-read-state/import','/admin/report-inactivity/sync']);
});

test('a version mismatch leaves the old Google Sheet path active', () => {
  const { context, properties } = app();
  context.Utilities = { formatDate: () => '20261022', getUuid: () => 'synthetic-uuid' };
  context.initializeReportNotificationState_ = () => {};
  context.ensureReportStateSheet_ = () => ({ getLastRow:()=>2, getRange:()=>({getValues:()=>[['89990000001','9990000001','old-fingerprint','', '', '', '', '', false, false, false]]}) });
  context.ensureReportInactivityStateSheet_ = () => ({ getLastRow:()=>1, getRange:()=>({getValues:()=>[]}) });
  context.getDataSheet_ = () => ({ getLastRow:()=>1, getRange:()=>({getValues:()=>[]}) });
  context.d1AdminRequest_ = path => path.endsWith('/versions')
    ? {versions:[{phone:'9990000001',kind:'morning',version:'v2:current'}]}
    : path.endsWith('/import') ? {received:1,verified:0} : {received:0};
  assert.throws(() => context.migrateReportNotificationStateToD1(), /не полностью|не все отметки/i);
  assert.notEqual(properties.get('REPORT_STATE_D1_CUTOVER'), 'true');
});
