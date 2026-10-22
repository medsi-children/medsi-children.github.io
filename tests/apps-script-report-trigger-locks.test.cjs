const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'apps-script', 'medsi-bot');

test('D1 admin requests report Cloudflare runtime errors without masking them as JSON parse errors', () => {
  const context = {
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 500, getContentText: () => 'error code: 1101' }) },
    getWorkerSharedSecret_: () => 'synthetic-secret'
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'chat-d1-migration.js'), 'utf8'), context);
  assert.throws(() => context.d1AdminRequest_('/admin/reconcile', 'post', {}), /D1 HTTP 500; Cloudflare error code 1101/);
});

test('spreadsheet change trigger skips ordinary cell edits', () => {
  const context = { Logger: { log() {} } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'chat-d1-migration.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'report-history.js'), 'utf8'), context);
  let calls = 0;
  context.reconcileReportsProfilesToD1_ = () => { calls += 1; };

  context.onReportsD1Change({ changeType: 'EDIT' });
  assert.equal(calls, 0);
  context.onReportsD1Change({ changeType: 'INSERT_ROW' });
  assert.equal(calls, 1);
});

test('simple onEdit can start without spreadsheet-scope access', () => {
  let spreadsheetReads = 0;
  const context = {
    Logger: { log() {} },
    SpreadsheetApp: { openById() { spreadsheetReads += 1; throw new Error('Spreadsheet scope is unavailable'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'synthetic-sheet' }) }
  };
  vm.createContext(context);
  for (const file of ['report-names.js', 'report-parser.js', 'report-history.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  vm.runInContext(fs.readFileSync(path.join(root, 'Медси бот.js'), 'utf8'), context);
  context.onEdit({ range: { getSheet: () => ({ getName: () => 'MORNING' }), getRow: () => 1, getColumn: () => 1 } });
  assert.equal(spreadsheetReads, 0);
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
  for (const file of ['report-names.js', 'report-parser.js', 'report-history.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
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
  for (const file of ['report-names.js', 'report-parser.js', 'report-history.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  vm.runInContext(fs.readFileSync(path.join(root, 'Медси бот.js'), 'utf8'), context);
  assert.equal(context.withReportWriteLock_(() => 'done'), 'done');
  assert.equal(acquired, 1);
});

test('registration outbox locks the REPORTS check-and-append and defers on contention', () => {
  let held = false;
  let appends = 0;
  const requests = [];
  const cells = new Map();
  const properties = new Map();
  const sheet = {
    getMaxColumns:() => 9,
    getLastRow:() => 1,
    getRange:(row, column) => ({
      getValue:() => cells.get(`${row}:${column}`) || '',
      setValue:value => cells.set(`${row}:${column}`, value),
      getValues:() => []
    }),
    isColumnHiddenByUser:() => true,
    hideColumns() {}
  };
  const context = {
    LockService: { getScriptLock: () => ({
      tryLock() { if (held) return false; held = true; return true; },
      releaseLock() { held = false; }
    }) },
    last10_: value => String(value || '').slice(-10),
    normalizeParentAccessId_: value => String(value || ''),
    PropertiesService:{ getScriptProperties:() => ({ getProperty:key => properties.get(key) || null, setProperty:(key,value) => properties.set(key,value), deleteProperty:key => properties.delete(key) }) },
    getDataSheet_:() => sheet,
    getReportRowsByPhone_: () => [],
    smartRegisterFromInboxCore_: (phone,parent,child,defer,generation) => {
      appends += 1;
      assert.equal(generation, 'reg_abcdefghijklmnop');
      // Simulate the immediate path trying to mirror the same outbox row
      // while the scheduled path is inside its critical section.
      const nested = context.flushCloudflareParentRegistrationOutbox_();
      assert.equal(nested.deferred, 1);
      assert.equal(nested.synced, 0);
    },
    d1AdminRequest_: (route, method, payload) => {
      requests.push({ route, payload });
      return route === '/admin/parent-registration-outbox'
        ? { registrations: [{ phone10:'0000000001', attempt_id:'reg_abcdefghijklmnop', parent_name:'Parent', child_name:'Child' }] }
        : { ok:true };
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'parent-access.js'), 'utf8'), context);

  const result = context.flushCloudflareParentRegistrationOutbox_();
  assert.equal(appends, 1);
  assert.equal(result.synced, 1);
  assert.equal(result.deferred, 0);
  assert.equal(requests.filter(x => x.route.endsWith('/ack')).length, 1);
  assert.equal(cells.get('1:9'), 'Поколение профиля (служебный)');
  assert.equal(held, false);
});

test('revoked registration cleanup removes only the REPORTS row carrying that attempt ID', () => {
  const attemptId = 'reg_revoked_synthetic';
  const rows = [
    ['phone-a','Parent A','Child A','Family A','','','','admission-a',attemptId],
    ['phone-b','Parent B','Child B','Family B','','','','admission-b','reg_current_synthetic']
  ];
  const properties = new Map();
  const sheet = {
    getMaxColumns:() => 9,
    getLastRow:() => rows.length + 1,
    getRange:(row,column,numRows=1,numColumns=1) => ({
      getValue:() => row === 1 ? 'Поколение профиля (служебный)' : rows[row - 2]?.[column - 1] || '',
      setValue:value => { if (row === 1) return; rows[row - 2][column - 1] = value; },
      getValues:() => Array.from({length:numRows},(_,index)=>[
        rows[row - 2 + index]?.[column - 1] || ''
      ])
    }),
    isColumnHiddenByUser:() => true,
    hideColumns() {},
    deleteRow:row => rows.splice(row - 2,1)
  };
  const context = {
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value),deleteProperty:key=>properties.delete(key)})},
    getDataSheet_:()=>sheet,
    normalizeParentAccessId_:value=>String(value||'')
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'parent-access.js'),'utf8'),context);
  const result = context.queueRevokedParentRegistrationCleanup_([attemptId]);
  assert.equal(result.removed,1);
  assert.equal(rows.length,1);
  assert.equal(rows[0][8],'reg_current_synthetic');
  assert.equal(properties.has('REVOKED_PARENT_REGISTRATION_ROWS'),false);
});

test('browser registration mirror returns without waiting for a lock or Worker call', () => {
  const properties = new Map();
  const context = {
    last10_: value => String(value || '').slice(-10),
    decodeCloudflareParentSession_: () => ({ role:'parent' }),
    normalizeParentAccessId_: value => String(value || ''),
    LockService: { getScriptLock() { throw new Error('browser path must not acquire a lock'); } },
    Utilities: { getUuid:() => 'outbox-request-1' },
    PropertiesService: { getScriptProperties:() => ({ setProperty:(key,value) => properties.set(key,value) }) },
    requestReportsD1ProfileSync_:() => properties.set('REPORTS_D1_SYNC_REQUEST','profile-request-1'),
    d1AdminRequest_:() => { throw new Error('browser path must not call Worker'); }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'parent-access.js'), 'utf8'), context);
  context.decodeCloudflareParentSession_ = () => ({ role:'parent' });

  const result = context.mirrorCloudflareParentRegistration('80000000001', 'reg_abcdefghijklmnop', 'signed-session');
  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
  assert.equal(properties.get('PARENT_REGISTRATION_OUTBOX_REQUEST'), 'outbox-request-1');
  assert.equal(properties.get('REPORTS_D1_SYNC_REQUEST'), 'profile-request-1');
});

test('minute retry drains a signaled registration outbox before profile reconciliation', () => {
  const properties = new Map([
    ['PARENT_REGISTRATION_OUTBOX_REQUEST','outbox-request-1'],
    ['REPORTS_D1_SYNC_REQUEST','profile-request-1']
  ]);
  const calls = [];
  const context = {
    PropertiesService: { getScriptProperties:() => ({
      getProperty:key => properties.get(key) || null,
      setProperty:(key,value) => properties.set(key,value)
    }) },
    flushCloudflareParentRegistrationOutbox_:() => { calls.push('outbox'); return { ok:true, synced:1, deferred:0 }; },
    reconcileReportsProfilesToD1_:reason => {
      calls.push(reason);
      properties.set('REPORTS_D1_SYNC_COMPLETED', properties.get('REPORTS_D1_SYNC_REQUEST'));
      return { ok:true };
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'chat-d1-migration.js'), 'utf8'), context);
  context.flushCloudflareParentRegistrationOutbox_ = () => { calls.push('outbox'); return { ok:true, synced:1, deferred:0 }; };
  context.reconcileReportsProfilesToD1_ = reason => {
    calls.push(reason);
    properties.set('REPORTS_D1_SYNC_COMPLETED', properties.get('REPORTS_D1_SYNC_REQUEST'));
    return { ok:true };
  };

  const result = context.retryPendingReportsD1ProfileSync();
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['outbox','pending-retry']);
  assert.equal(properties.get('PARENT_REGISTRATION_OUTBOX_COMPLETED'), 'outbox-request-1');
  assert.equal(context.retryPendingReportsD1ProfileSync().skipped, true);
});

function profileSyncFixture() {
  const properties = new Map();
  const calls = [];
  let token = 0;
  let locked = false;
  const previous = { '0000000001': { childName:'Synthetic A' } };
  const current = { '0000000002': { childName:'Synthetic B' } };
  let snapshot = previous;
  const context = {
    Logger:{ log(value) { calls.push(value); } },
    Utilities:{ getUuid:() => 'request-' + (++token) },
    PropertiesService:{ getScriptProperties:() => ({
      getProperty:key => properties.get(key) || null,
      setProperty:(key,value) => properties.set(key,value)
    }) },
    LockService:{ getScriptLock:() => ({ tryLock:() => !locked, releaseLock() {} }) }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'chat-d1-migration.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'report-history.js'), 'utf8'), context);
  const realUpsert = context.reconcileReportsProfilesToD1NonDestructive_;
  Object.assign(context, {
    getDataSheet_:() => ({}),
    loadReportsD1ProfilesSnapshot_:() => snapshot,
    saveReportsD1ProfilesSnapshot_:value => { snapshot = value; },
    reportsD1ProfilesSnapshot_:() => current,
    reportsD1SnapshotsDiffer_:() => true,
    last10_:value => value,
    reconcileReportsProfilesToD1NonDestructive_:() => {
      calls.push('upsert');
      return { upserted:1, removedProfiles:previous, previousProfiles:previous };
    },
    d1AdminRequest_:route => route === '/admin/profile-phones' ? { phones:['0000000001'] } : { registrations:[] },
    rawReportChildTargetFromProfileSnapshot_:value => value,
    reportsProfileDeletionProtected_:() => false,
    deleteD1ProfileWithS3Purge_:() => { calls.push('delete'); return { purge:{ ok:true, deferred:true } }; },
    maintainRawReportsAfterProfilesChangeCore_:() => { calls.push('maintenance'); return { ok:true }; },
    rawReportTargetsNoLongerActive_:() => [],
    purgeInactiveChatMessages_:() => {},
    removeReportInactivityState_:() => {}, removeEducatorChatPin_:() => {},
    clearGetChatMessagesCache:() => {}, removeMedsiParentContactBestEffort_:() => {},
    flushReportsS3PurgeQueue_:() => { calls.push('purge'); return { ok:true }; }
  });
  return { context, properties, calls, previous, current, realUpsert,
    get snapshot() { return snapshot; }, setLocked:value => { locked = value; } };
}

test('busy profile sync retains a request and minute retry completes it before slow maintenance', () => {
  const f = profileSyncFixture();
  f.setLocked(true);
  assert.equal(f.context.reconcileReportsProfilesToD1_('change:REMOVE_ROW').skipped, true);
  assert.ok(f.properties.get('REPORTS_D1_SYNC_REQUEST'));
  assert.equal(f.properties.get('REPORTS_D1_SYNC_COMPLETED'), undefined);
  f.setLocked(false);
  assert.equal(f.context.retryPendingReportsD1ProfileSync().ok, true);
  assert.ok(f.calls.indexOf('delete') < f.calls.indexOf('maintenance'));
  assert.ok(f.calls.indexOf('maintenance') < f.calls.indexOf('purge'));
  assert.equal(f.snapshot, f.current);
  assert.equal(f.properties.get('REPORTS_D1_SYNC_REQUEST'), f.properties.get('REPORTS_D1_SYNC_COMPLETED'));
  const count = f.calls.length;
  assert.equal(f.context.retryPendingReportsD1ProfileSync().skipped, true);
  assert.equal(f.calls.length, count); // Idle minute tick performs no network/report work.
  assert.ok(!f.calls.filter(x => x.startsWith('REPORTS_D1_PROFILE_LIFECYCLE')).join('').includes('Synthetic'));
});

test('an edit during a running sync cannot be erased by its acknowledgement', () => {
  const f = profileSyncFixture();
  f.context.maintainRawReportsAfterProfilesChangeCore_ = () => {
    f.context.requestReportsD1ProfileSync_();
    return { ok:true };
  };
  f.context.reconcileReportsProfilesToD1_('edit');
  assert.notEqual(f.properties.get('REPORTS_D1_SYNC_REQUEST'), f.properties.get('REPORTS_D1_SYNC_COMPLETED'));
  f.context.maintainRawReportsAfterProfilesChangeCore_ = () => ({ ok:true });
  assert.equal(f.context.retryPendingReportsD1ProfileSync().ok, true);
  assert.equal(f.properties.get('REPORTS_D1_SYNC_REQUEST'), f.properties.get('REPORTS_D1_SYNC_COMPLETED'));
});

test('maintenance failure retains the old identity snapshot and retry request', () => {
  const f = profileSyncFixture();
  f.context.maintainRawReportsAfterProfilesChangeCore_ = () => { throw new Error('temporary failure'); };
  assert.equal(f.context.reconcileReportsProfilesToD1_('edit').ok, false);
  assert.equal(f.snapshot, f.previous);
  assert.equal(f.properties.get('REPORTS_D1_SYNC_COMPLETED'), undefined);
  f.context.maintainRawReportsAfterProfilesChangeCore_ = () => ({ ok:true });
  assert.equal(f.context.retryPendingReportsD1ProfileSync().ok, true);
  assert.equal(f.snapshot, f.current);
});

test('network failure leaves a durable retry without advancing the snapshot', () => {
  const f = profileSyncFixture();
  f.context.d1AdminRequest_ = () => { throw new Error('offline'); };
  assert.throws(() => f.context.reconcileReportsProfilesToD1_('edit'), /offline/);
  assert.equal(f.snapshot, f.previous);
  assert.equal(f.properties.get('REPORTS_D1_SYNC_COMPLETED'), undefined);
});

test('trigger setup installs a minute retry without duplicating it or changing the full sync timer', () => {
  const f = profileSyncFixture();
  const triggers = [];
  const created = [];
  f.context.getSpreadsheetId_ = () => 'synthetic-sheet';
  f.context.ScriptApp = {
    getProjectTriggers:() => triggers,
    deleteTrigger:trigger => triggers.splice(triggers.indexOf(trigger),1),
    newTrigger(handler) {
      const entry = { handler };
      const builder = {
        forSpreadsheet() { return builder; }, onEdit() { return builder; }, onChange() { return builder; },
        timeBased() { return builder; }, everyMinutes(value) { entry.minutes = value; return builder; },
        create() {
          created.push(entry);
          triggers.push({ getHandlerFunction:() => handler, getTriggerSourceId:() => 'synthetic-sheet' });
        }
      };
      return builder;
    }
  };
  f.context.ensureReportsD1ProfileSyncTriggers_();
  f.context.ensureReportsD1ProfileSyncTriggers_();
  assert.equal(created.filter(x => x.handler === 'retryPendingReportsD1ProfileSync').length, 1);
  assert.equal(created.find(x => x.handler === 'retryPendingReportsD1ProfileSync').minutes, 1);
  assert.equal(created.find(x => x.handler === 'syncD1ProfilesFromReports').minutes, 10);
});

test('a limited deletion batch remains pending for the next minute', () => {
  const f = profileSyncFixture();
  f.context.d1AdminRequest_ = route => route === '/admin/profile-phones'
    ? { phones:['0000000001','0000000003','0000000004','0000000005'] } : { registrations:[] };
  let deleted = 0;
  f.context.deleteD1ProfileWithS3Purge_ = () => { deleted++; return { purge:{ ok:true } }; };
  assert.equal(f.context.reconcileReportsProfilesToD1_('change:REMOVE_ROW').ok, true);
  assert.equal(deleted, 3);
  assert.equal(f.properties.get('REPORTS_D1_SYNC_COMPLETED'), undefined);
});

test('non-destructive upsert defers snapshot advancement until lifecycle maintenance finishes', () => {
  const f = profileSyncFixture();
  // Restore the real upsert function; simulate an interrupted pass immediately
  // after its return. The old identity snapshot must still be available.
  f.context.reconcileReportsProfilesToD1NonDestructive_ = f.realUpsert;
  f.context.reportsD1ProfileIdentity_ = profile => profile.childName;
  f.context.reconcileReportsProfilesToD1NonDestructive_('edit', true);
  assert.equal(f.snapshot, f.previous);
});
