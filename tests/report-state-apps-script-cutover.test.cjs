const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../apps-script/medsi-bot/Медси бот.js'), 'utf8');

function app() {
  const context = { Logger: { log() {} } };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test('report read state always comes from D1 and legacy sheet migration code is gone', () => {
  const context = app();
  context.getD1ParentReportUnread_ = () => ({ reportUnread: { morning:false, evening:true, psychology:false } });
  assert.deepEqual(JSON.parse(JSON.stringify(context.getReportUnreadStatus_('89990000001'))), {
    morning:false, evening:true, psychology:false
  });
  assert.doesNotMatch(source, /REPORT_STATE_D1_CUTOVER|migrateReportNotificationStateToD1|ensureReportStateSheet_|REPORT_NOTIFICATION_STATE/);
  assert.doesNotMatch(source, /ensureReportInactivityStateSheet_|REPORT_INACTIVITY_STATE_SHEET_NAME/);
});

test('minute report distribution sends only new inactivity reminders to D1', () => {
  const context = app();
  const calls = [];
  context.last10_ = value => String(value || '').replace(/\D/g, '').slice(-10);
  context.d1AdminRequest_ = (url, method, payload) => { calls.push({ url, method, payload }); return { ok:true }; };
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
