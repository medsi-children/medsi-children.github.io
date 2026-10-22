/* Event-driven reports. Clock runs are only a daytime safety net;
 * explicit web/manual publications and durable registration retries run at night too. */
function reportMaintenanceDaytime_(date) {
  const hour = Number(Utilities.formatDate(date || new Date(), 'Europe/Moscow', 'H'));
  return hour >= 7 && hour < 24;
}

function reportDistributionStateFingerprint_() {
  const sheet = getDataSheet_();
  if (!sheet) return '';
  const count = Math.max(0, sheet.getLastRow() - 1);
  const rows = count ? sheet.getRange(2, 1, count, 9).getValues() : [];
  const variants = getSheet_('NAME_VARIANTS');
  const props = PropertiesService.getScriptProperties().getProperties();
  const owners = Object.keys(props).filter(function(key) { return key.indexOf('RAW_REPORT_OWNER_') === 0; })
    .sort().map(function(key) { return [key, props[key]]; });
  return reportFingerprint_(JSON.stringify({
    rows:rows.map(function(row) { return [row[0],row[2],row[3],row[4],row[5],row[7],row[8]]; }),
    morning:String(getLatestReport(getSheet_(SHEET_MORNING), 1) || ''),
    evening:String(getLatestReport(getSheet_(SHEET_EVENING), 1) || ''),
    variants:variants ? variants.getDataRange().getValues() : [],
    owners:owners
  }));
}

function queueReportPostCommitSync_(inactivityUpdates, publicationKinds, kindsRaw, alreadyLocked) {
  if (alreadyLocked) return queueReportPostCommitSyncCore_(inactivityUpdates, publicationKinds, kindsRaw);
  const lock = LockService.getUserLock();
  lock.waitLock(5000);
  try { return queueReportPostCommitSyncCore_(inactivityUpdates, publicationKinds, kindsRaw); }
  finally { lock.releaseLock(); }
}

function queueReportPostCommitSyncCore_(inactivityUpdates, publicationKinds, kindsRaw) {
  const props = PropertiesService.getScriptProperties();
  let previous = {};
  try { previous = JSON.parse(props.getProperty('REPORT_POST_COMMIT_REQUEST') || '{}'); } catch (_) {}
  const completed = props.getProperty('REPORT_POST_COMMIT_COMPLETED');
  const pending = previous.token && previous.token !== completed ? previous : {};
  const dataSheet = getDataSheet_();
  const count = dataSheet ? Math.max(0, dataSheet.getLastRow() - 1) : 0;
  const rows = count ? dataSheet.getRange(2, 1, count, 9).getValues() : [];
  const admissions = {};
  rows.forEach(function(row) { admissions[last10_(row[0])] = String(row[7] || ''); });
  const previousUpdates = (pending.inactivityUpdates || []).filter(function(item) {
    const phone = last10_(item.phone);
    return Object.prototype.hasOwnProperty.call(admissions, phone) &&
      admissions[phone] === String(pending.admissions && pending.admissions[phone] || '');
  });
  const byPhone = {};
  previousUpdates.concat(inactivityUpdates || []).forEach(function(item) {
    const phone = String(item.phone || '');
    if (!phone) return;
    const previousItem = byPhone[phone];
    byPhone[phone] = { phone:phone, hasNewReport:!!item.hasNewReport || !!(previousItem && previousItem.hasNewReport) };
  });
  const request = {
    token:Utilities.getUuid(),
    inactivityUpdates:Object.keys(byPhone).map(function(phone) { return byPhone[phone]; }),
    publicationKinds:Array.from(new Set((pending.publicationKinds || []).concat(publicationKinds || []))),
    kinds:Array.from(new Set((pending.kinds || []).concat(kindsRaw || ['morning', 'evening'])))
  };
  // Snapshot admission IDs so a deferred reminder update cannot touch a new
  // admission that later reuses the same parent's phone number.
  request.admissions = admissions;
  props.setProperty('REPORT_POST_COMMIT_REQUEST', JSON.stringify(request));
  return request.token;
}

function flushPendingReportPostCommitSync_() {
  const props = PropertiesService.getScriptProperties();
  let pending = {};
  try { pending = JSON.parse(props.getProperty('REPORT_POST_COMMIT_REQUEST') || '{}'); } catch (_) { return {ok:false}; }
  if (!pending.token || pending.token === props.getProperty('REPORT_POST_COMMIT_COMPLETED')) return {ok:true, skipped:true};
  const lock = LockService.getUserLock();
  if (!lock.tryLock(100)) return {ok:true, pending:true};
  let lease;
  try {
    let previous = {};
    try { previous = JSON.parse(props.getProperty('REPORT_POST_COMMIT_LEASE') || '{}'); } catch (_) {}
    if (Number(previous.until || 0) > Date.now()) return {ok:true, pending:true};
    lease = {token:Utilities.getUuid(), until:Date.now() + 360000};
    props.setProperty('REPORT_POST_COMMIT_LEASE', JSON.stringify(lease));
  } finally { lock.releaseLock(); }
  try { return flushPendingReportPostCommitSyncCore_(); }
  finally {
    // A late completion must not release a newer execution's lease.
    if (lock.tryLock(100)) {
      try {
        const current = props.getProperty('REPORT_POST_COMMIT_LEASE');
        if (current === JSON.stringify(lease)) props.setProperty('REPORT_POST_COMMIT_LEASE', '{}');
      } finally { lock.releaseLock(); }
    }
  }
}

function flushPendingReportPostCommitSyncCore_() {
  const props = PropertiesService.getScriptProperties();
  let request;
  try { request = JSON.parse(props.getProperty('REPORT_POST_COMMIT_REQUEST') || '{}'); } catch (_) { return {ok:false}; }
  if (!request.token || request.token === props.getProperty('REPORT_POST_COMMIT_COMPLETED')) return {ok:true, skipped:true};
  try {
    if ((request.inactivityUpdates || []).length) {
      const sheet = getDataSheet_();
      const count = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
      const current = {};
      if (count) sheet.getRange(2, 1, count, 9).getValues().forEach(function(row) { current[last10_(row[0])] = String(row[7] || ''); });
      const updates = request.inactivityUpdates.filter(function(item) {
        const phone = last10_(item.phone);
        return Object.prototype.hasOwnProperty.call(current, phone) &&
          current[phone] === String(request.admissions && request.admissions[phone] || '');
      });
      if (updates.length) syncReportInactivityState_(updates);
    }
    const kinds = request.kinds || [];
    const explicitKinds = (request.publicationKinds || []).filter(function(kind) {
      return reportHistoryPublicationMatches_(kind, reportHistoryDate_(new Date()));
    });
    if (explicitKinds.length > 1) {
      kinds.forEach(function(kind) { syncD1CurrentReportsToWorker_(kind, explicitKinds.indexOf(kind) >= 0 ? kind : ''); });
    } else {
      // One shared snapshot, not one all-kinds snapshot per report kind.
      syncD1CurrentReportsToWorker_(kinds.length === 1 ? kinds[0] : '', explicitKinds[0] || '');
    }
    props.setProperty('REPORT_POST_COMMIT_COMPLETED', request.token);
    return {ok:true};
  } catch (error) {
    Logger.log('REPORT_POST_COMMIT_SYNC_DEFERRED ' + String(error && error.message || error));
    return {ok:false, pending:true};
  }
}

function runScheduledMedsiMaintenance(event) {
  if (!reportMaintenanceDaytime_(new Date())) return {ok:true, skipped:true, reason:'night'};
  // Profile/registration recovery keeps its own durable minute retry. This
  // timer never replaces that queue or changes parent session behaviour.
  let profiles, distribution;
  try { profiles = syncD1ProfilesFromReports(); }
  catch (error) {
    profiles = {ok:false};
    Logger.log('REPORT_SAFETY_PROFILE_SYNC_FAILED ' + String(error && error.message || error));
  }
  try { distribution = distributeChildReports(); }
  catch (error) {
    distribution = {ok:false};
    Logger.log('REPORT_SAFETY_DISTRIBUTION_FAILED ' + String(error && error.message || error));
  }
  const props = PropertiesService.getScriptProperties();
  const sheet = getSheet_(SHEET_PSYCHOLOGY);
  const text = String(sheet ? sheet.getRange(1, 1).getValue() || '' : '');
  const signature = reportFingerprint_(JSON.stringify([text, reportsD1ProfilesSnapshot_()]));
  if (props.getProperty('REPORT_PSYCHOLOGY_CHECKPOINT') !== signature) {
    syncReportHistoryPublicationFromSource_('psychology', text, false);
    queueReportPostCommitSync_([], [], ['psychology']);
    props.setProperty('REPORT_PSYCHOLOGY_CHECKPOINT', signature);
  }
  const delivery = flushPendingReportPostCommitSync_();
  return {ok:profiles.ok !== false && distribution && distribution.ok !== false && delivery.ok !== false, distribution:distribution, delivery:delivery};
}

function ensureReportMaintenanceClock_() {
  const clockHandlers = ['distributeChildReports', 'syncD1ProfilesFromReports'];
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (clockHandlers.indexOf(trigger.getHandlerFunction()) < 0) return;
    if (typeof trigger.getTriggerSource === 'function' && String(trigger.getTriggerSource()) !== 'CLOCK') return;
    // Both public handlers were historically installed only as clock tasks.
    // Never remove spreadsheet edit/change handlers or unrelated Google tasks.
    ScriptApp.deleteTrigger(trigger);
  });
  const matching = triggers.filter(function(trigger) { return trigger.getHandlerFunction() === 'runScheduledMedsiMaintenance'; });
  matching.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  if (!matching.length) ScriptApp.newTrigger('runScheduledMedsiMaintenance').timeBased().everyMinutes(10).create();
  PropertiesService.getScriptProperties().setProperty('REPORT_MAINTENANCE_CLOCK_V1', 'ready');
}
