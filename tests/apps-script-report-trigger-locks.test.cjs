const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'apps-script', 'medsi-bot');

test('spreadsheet change trigger skips ordinary cell edits', () => {
  const context = { Logger: { log() {} } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'chat-d1-migration.js'), 'utf8'), context);
  let calls = 0;
  context.reconcileReportsProfilesToD1_ = () => { calls += 1; };

  context.onReportsD1Change({ changeType: 'EDIT' });
  assert.equal(calls, 0);
  context.onReportsD1Change({ changeType: 'INSERT_ROW' });
  assert.equal(calls, 1);
});

test('report publication uses a dedicated user lock', () => {
  const acquired = [];
  const lock = { waitLock() {}, releaseLock() {} };
  const values = new Map();
  const context = {
    Logger: { log() {} },
    LockService: {
      getUserLock() { acquired.push('user'); return lock; },
      getScriptLock() { acquired.push('script'); throw new Error('global script lock must not be used'); }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => key === 'MEDSI_SPREADSHEET_ID' ? 'synthetic-sheet' : (values.get(key) || ''),
      setProperty: (key, value) => values.set(key, value)
    }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => null }) }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'Медси бот.js'), 'utf8'), context);
  let cellValue = 'raw';
  const cell = { getValue: () => cellValue, setValue: value => { cellValue = value; } };

  assert.equal(context.saveRawReportPublication_('morning', cell, 'canonical', 10, 'raw'), true);
  assert.equal(cellValue, 'canonical');
  assert.deepEqual(acquired, ['user']);
});

test('report distribution lock serializes work without the global chat lock', () => {
  let acquired = 0;
  const lock = { waitLock() { acquired += 1; }, releaseLock() {} };
  const context = {
    LockService: {
      getUserLock: () => lock,
      getScriptLock: () => { throw new Error('global script lock must not be used'); }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'synthetic-sheet' }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => null }) },
    Logger: { log() {} }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'Медси бот.js'), 'utf8'), context);
  assert.equal(context.withReportWriteLock_(() => 'done'), 'done');
  assert.equal(acquired, 1);
});
