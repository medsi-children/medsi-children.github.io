/* Production-only migration; not called by normal chat requests. */
function snapshotChatForD1_() {
  const sh = ensureChatSheet_();
  const last = sh.getLastRow();
  const rows = last >= 2 ? sh.getRange(2, 1, last - 1, 14).getValues() : [];
  const profiles = {}, keys = {}, messages = [];
  rows.forEach(r => {
    const phone = last10_(r[1]), side = String(r[4] || '').trim();
    if (!phone || !['parent','educator'].includes(side)) return;
    const key = buildMessageKey_(r[0], side);
    if (keys[key]) throw new Error('Совпадающий ключ сообщения: ' + key);
    keys[key] = true;
    profiles[phone] = { phone:phone, parentName:String(r[2] || '').trim(), childName:String(r[3] || '').trim() };
    const reply = parseReplyContext_(r[13]);
    messages.push({ messageKey:key, phone:phone, side:side, type:String(r[5] || 'text').trim() || 'text', text:String(r[6] || ''), fileId:String(r[7] || '').trim(), deleteAfter:r[8] ? new Date(r[8]).getTime() : 0, status:String(r[9] || 'active').trim(), readByParent:r[10] === true || String(r[10]).toLowerCase() === 'true', readByEducator:r[11] === true || String(r[11]).toLowerCase() === 'true', reaction:normalizeReaction_(r[12]), replyToKey:reply ? reply.messageKey : '', createdAt:new Date(r[0]).getTime() });
  });
  const pins = Object.keys(getEducatorChatPins_()).map(phone => ({ phone:phone, bucket:getEducatorChatPins_()[phone] }));
  return { profiles:Object.keys(profiles).map(key => profiles[key]), messages:messages, pins:pins };
}
function d1AdminRequest_(path, method, payload) {
  const response = UrlFetchApp.fetch('https://medsi-chat-worker.medsi-children.workers.dev' + path, { method:method || 'get', contentType:'application/json', muteHttpExceptions:true, headers:{Authorization:'Bearer ' + getWorkerSharedSecret_()}, payload:payload ? JSON.stringify(payload) : undefined });
  const value = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !value.ok) throw new Error(value.message || 'D1 HTTP ' + response.getResponseCode());
  return value;
}

function snapshotActiveProfilesForD1_() {
  const sh = getDataSheet_();
  const lastRow = sh ? sh.getLastRow() : 0;
  if (lastRow < 2) return [];
  const byPhone = {};
  sh.getRange(2, 1, lastRow - 1, 4).getValues().forEach(row => {
    const profile = buildProfileFromReportRow_(row);
    const phone = last10_(profile.phone);
    if (phone) byPhone[phone] = { phone:phone, parentName:profile.parentName, childName:profile.childName };
  });
  return Object.keys(byPhone).map(phone => byPhone[phone]);
}

function syncD1ProfilesFromReports_(full) {
  const profiles = snapshotActiveProfilesForD1_();
  const result = d1AdminRequest_('/admin/reconcile', 'post', { profiles:profiles, full:full === true });
  return { ok:true, profiles:profiles.length, removed:Number(result.removed || 0), full:full === true };
}

// Public function: it can be run manually and is also used by the timed trigger.
function syncD1ProfilesFromReports() {
  // Timeweb uses D1 regardless of the retired CHAT_BACKEND switch, which is
  // still "sheets" in some installations for legacy Apps Script chat calls.
  ensureReportsD1ProfileSyncTriggers_();
  return reconcileReportsProfilesToD1_('scheduled');
}

function snapshotCurrentReportsForD1_(kindRaw) {
  const requestedKind = String(kindRaw || '').trim().toLowerCase();
  const allowedKinds = ['morning', 'evening', 'psychology'];
  const kinds = allowedKinds.indexOf(requestedKind) >= 0 ? [requestedKind] : allowedKinds;
  const profiles = snapshotActiveProfilesForD1_();
  const dataSheet = getDataSheet_();
  const lastRow = dataSheet ? dataSheet.getLastRow() : 0;
  const rowsByPhone = {};
  if (lastRow >= 2) {
    dataSheet.getRange(2, 1, lastRow - 1, 8).getValues().forEach(function(row) {
      const phone = last10_(row[0]);
      if (!phone) return;
      (rowsByPhone[phone] || (rowsByPhone[phone] = [])).push(row);
    });
  }
  const needsPsychology = kinds.indexOf('psychology') >= 0;
  const psychologySheet = needsPsychology ? getSheet_(SHEET_PSYCHOLOGY) : null;
  const psychologyText = psychologySheet ? String(psychologySheet.getRange(1, 1).getValue() || '').trim() : '';
  const updatedAt = Date.now();
  const reports = [];
  profiles.forEach(function(profile) {
    const phone = last10_(profile.phone);
    kinds.filter(function(kind) { return kind !== 'psychology'; }).forEach(function(kind) {
      const snapshot = buildParentReportSnapshot_(phone, kind, false, rowsByPhone[phone] || []);
      const text = snapshot.hasReport ? String(snapshot.text || '').trim() : '';
      reports.push({ phone:phone, kind:kind, text:text, version:reportFingerprint_(text), updatedAt:updatedAt });
    });
    if (needsPsychology) {
      reports.push({ phone:phone, kind:'psychology', text:psychologyText, version:reportFingerprint_(psychologyText), updatedAt:updatedAt });
    }
  });
  return reports;
}

function syncD1CurrentReportsToWorker_(kindRaw) {
  const reports = snapshotCurrentReportsForD1_(kindRaw);
  const result = d1AdminRequest_('/admin/report-current', 'post', { reports:reports });
  return { ok:true, reports:reports.length, updated:Number(result.updated || 0) };
}

function syncD1CurrentReportsToWorker() {
  try {
    return syncD1CurrentReportsToWorker_();
  } catch (error) {
    Logger.log('REPORT_CURRENT_SYNC_FAILED ' + (error && error.message || error));
    return { ok:false, message:String(error && error.message || error) };
  }
}

function reportHistoryDate_(date) {
  return Utilities.formatDate(date, 'Europe/Moscow', 'yyyy-MM-dd');
}

function reportHistoryShiftDays_(date, days) {
  const shifted = new Date(date.getTime());
  shifted.setDate(shifted.getDate() + Number(days || 0));
  return shifted;
}

function reportHistoryPublicationKey_(kind, suffix) {
  return 'REPORT_HISTORY_' + String(kind || '').toUpperCase() + '_' + suffix;
}

function readReportHistoryPublication_(kind) {
  const raw = PropertiesService.getScriptProperties().getProperty(reportHistoryPublicationKey_(kind, 'PUBLICATION'));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function recordReportHistoryPublication_(kind, textRaw, reportDateRaw) {
  if (!['morning', 'evening'].includes(String(kind || '').toLowerCase())) return;
  const normalizedKind = String(kind).toLowerCase();
  const properties = PropertiesService.getScriptProperties();
  const fingerprint = reportFingerprint_(textRaw);
  properties.setProperty(reportHistoryPublicationKey_(normalizedKind, 'SOURCE'), fingerprint);
  properties.setProperty(reportHistoryPublicationKey_(normalizedKind, 'PUBLICATION'), JSON.stringify({
    date: String(reportDateRaw || reportHistoryDate_(new Date())),
    at: Date.now(),
    fingerprint: fingerprint
  }));
}

function syncReportHistoryPublicationFromSource_(kind, textRaw, explicitPublication) {
  const normalizedKind = String(kind || '').toLowerCase();
  const properties = PropertiesService.getScriptProperties();
  const key = reportHistoryPublicationKey_(normalizedKind, 'SOURCE');
  const previous = properties.getProperty(key);
  const fingerprint = reportFingerprint_(textRaw);
  properties.setProperty(key, fingerprint);
  if (explicitPublication || (previous !== null && previous !== fingerprint && fingerprint)) {
    recordReportHistoryPublication_(normalizedKind, textRaw);
  }
}

function reportHistoryPublicationMatches_(kind, reportDate) {
  const publication = readReportHistoryPublication_(kind);
  return !publication || String(publication.date || '') === String(reportDate || '');
}

function seedReportHistoryPublication_(kind, reportDate) {
  if (readReportHistoryPublication_(kind)) return;
  const sheetName = kind === 'morning' ? SHEET_MORNING : SHEET_EVENING;
  const sheet = getSheet_(sheetName);
  const text = sheet ? (getLatestReport(sheet, 1) || '') : '';
  recordReportHistoryPublication_(kind, text, reportDate);
}

function captureReportHistoryKind_(kind, reportDate) {
  const snapshots = [];
  snapshotActiveProfilesForD1_().forEach(function(profile) {
    const phone = last10_(profile.phone);
    const report = buildParentReportSnapshot_(phone, kind);
    if (!phone || !report.ok || !report.hasReport || !String(report.text || '').trim()) return;
    snapshots.push({
      phone: phone,
      kind: kind,
      reportDate: reportDate,
      text: report.text,
      capturedAt: Date.now()
    });
  });
  const beforeDate = reportHistoryDate_(reportHistoryShiftDays_(new Date(), -45));
  const result = d1AdminRequest_('/admin/report-snapshots', 'post', {
    snapshots: snapshots,
    beforeDate: beforeDate,
    skipIfMatchesPrevious: true
  });
  seedReportHistoryPublication_(kind, reportDate);
  return {
    ok: true,
    kind: kind,
    reportDate: reportDate,
    saved: Number(result.saved || 0),
    skippedDuplicate: Number(result.skippedDuplicate || 0),
    skippedExisting: Number(result.skippedExisting || 0)
  };
}

function captureDueReportHistorySnapshots_() {
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, 'Europe/Moscow', 'H'));
  const today = reportHistoryDate_(now);
  const captured = [];
  // The D1 key (phone + kind + date) makes these retries idempotent. Running
  // throughout the capture window also picks up a child whose report was
  // distributed a little later than the others.
  if (hour >= 16) {
    if (reportHistoryPublicationMatches_('morning', today)) captured.push(captureReportHistoryKind_('morning', today));
    else captured.push({ ok:true, kind:'morning', reportDate:today, skipped:true, reason:'No morning publication for this date.' });
  }
  if (hour < 4) {
    const eveningDate = reportHistoryDate_(reportHistoryShiftDays_(now, -1));
    if (reportHistoryPublicationMatches_('evening', eveningDate)) captured.push(captureReportHistoryKind_('evening', eveningDate));
    else captured.push({ ok:true, kind:'evening', reportDate:eveningDate, skipped:true, reason:'No evening publication for this date.' });
  }
  return { ok: true, captured: captured };
}

function captureScheduledReportHistory() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok:true, skipped:true, message:'Another report-history capture is running.' };
  try {
    return captureDueReportHistorySnapshots_();
  } finally {
    lock.releaseLock();
  }
}

function captureReportHistoryNow() {
  return captureScheduledReportHistory();
}

function syncD1ProfileForPhone_(phoneRaw) {
  const phone = last10_(phoneRaw);
  const profile = getProfileByPhone_(phone);
  if (!phone || !profile) return { ok:false, message:'Parent is absent from REPORTS.' };
  return d1AdminRequest_('/admin/reconcile', 'post', {
    profiles:[{ phone:phone, parentName:profile.parentName, childName:profile.childName }], full:false
  });
}

/* ===== REPORTS -> D1 PROFILE LIFECYCLE =====
   These installable handlers run outside browser requests.  A snapshot makes
   phone changes deterministic: we move a thread only when one removed and one
   added row have the same parent/child identity.  Ambiguous cases are logged
   for the manual full reconcile instead of risking the wrong child's history.
*/
function reportsD1ProfilesSnapshot_() {
  const snapshot = {};
  snapshotActiveProfilesForD1_().forEach(function(profile) {
    const phone = last10_(profile.phone);
    if (!phone) return;
    snapshot[phone] = {
      phone: phone,
      parentName: String(profile.parentName || '').trim(),
      childName: String(profile.childName || '').trim()
    };
  });
  return snapshot;
}

function reportsD1ProfileIdentity_(profile) {
  return [
    String(profile && profile.parentName || '').trim().toLocaleLowerCase('ru'),
    String(profile && profile.childName || '').trim().toLocaleLowerCase('ru')
  ].join('|');
}

function saveReportsD1ProfilesSnapshot_(snapshot) {
  PropertiesService.getScriptProperties().setProperty(
    'REPORTS_D1_PROFILE_SNAPSHOT', JSON.stringify(snapshot || {})
  );
}

function loadReportsD1ProfilesSnapshot_() {
  const raw = PropertiesService.getScriptProperties().getProperty('REPORTS_D1_PROFILE_SNAPSHOT');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function reconcileReportsProfilesToD1NonDestructive_(reason) {
  const previous = loadReportsD1ProfilesSnapshot_();
  const current = reportsD1ProfilesSnapshot_();
  if (!previous) {
    d1AdminRequest_('/admin/reconcile', 'post', { profiles: Object.keys(current).map(function(phone) { return current[phone]; }), full: false });
    saveReportsD1ProfilesSnapshot_(current);
    return { ok: true, initialized: true, profiles: Object.keys(current).length, reason: reason || '' };
  }

  const removed = Object.keys(previous).filter(function(phone) { return !current[phone]; });
  const added = Object.keys(current).filter(function(phone) { return !previous[phone]; });
  const moves = [];
  const ambiguous = [];
  const usedAdded = {};
  removed.forEach(function(fromPhone) {
    const candidates = added.filter(function(toPhone) {
      return !usedAdded[toPhone] && reportsD1ProfileIdentity_(previous[fromPhone]) === reportsD1ProfileIdentity_(current[toPhone]);
    });
    if (candidates.length === 1) {
      const toPhone = candidates[0];
      d1AdminRequest_('/admin/move-profile-phone', 'post', {
        fromPhone: fromPhone, toPhone: toPhone,
        parentName: current[toPhone].parentName, childName: current[toPhone].childName
      });
      usedAdded[toPhone] = true;
      moves.push({ fromPhone: fromPhone, toPhone: toPhone });
    } else if (candidates.length > 1) {
      ambiguous.push({ phone: fromPhone, candidates: candidates });
    }
  });

  const upserts = Object.keys(current).filter(function(phone) { return !usedAdded[phone]; }).map(function(phone) { return current[phone]; });
  if (upserts.length) d1AdminRequest_('/admin/reconcile', 'post', { profiles: upserts, full: false });

  // Deletions are intentionally queued but not executed here until the S3
  // purge queue is installed and manually enabled after a smoke test.
  const deletionsPending = removed.filter(function(phone) {
    return !moves.some(function(move) { return move.fromPhone === phone; });
  });
  saveReportsD1ProfilesSnapshot_(current);
  const result = { ok: true, reason: reason || '', upserted: upserts.length, moved: moves, deletionsPending: deletionsPending, ambiguous: ambiguous };
  Logger.log('REPORTS_D1_PROFILE_SYNC ' + JSON.stringify(result));
  return result;
}

function reconcileReportsProfilesToD1_(reason) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok:true, skipped:true, message:'Profile sync is already running.' };
  try {
    const sheet = getDataSheet_();
    if (!sheet) throw new Error('Лист REPORTS не найден; удаление профилей остановлено.');
    const current = reportsD1ProfilesSnapshot_();
    const sync = reconcileReportsProfilesToD1NonDestructive_(reason);
    const inventory = d1AdminRequest_('/admin/profile-phones', 'get');
    const stale = (Array.isArray(inventory.phones) ? inventory.phones : []).filter(function(phone) {
      return !current[last10_(phone)];
    });
    const deleted = [];
    const failed = [];
    const cleanupErrors = [];
    // Limit one pass so an unexpectedly empty sheet cannot erase every chat.
    stale.slice(0, 3).forEach(function(phone) {
      try {
        // A parent may have been registered again while the D1 inventory was read.
        if (getProfileByPhone_(phone)) return;
        const result = deleteD1ProfileWithS3Purge_(phone);
        deleted.push({ phone:phone, purgeComplete:!!(result.purge && result.purge.ok) });
      } catch (error) {
        failed.push({ phone:phone, message:String(error && error.message || error) });
      }
    });
    try { purgeInactiveChatMessages_(); }
    catch (error) { cleanupErrors.push('legacy chat: ' + String(error && error.message || error)); }
    deleted.forEach(function(item) {
      const phone = item.phone;
      [
        ['inactivity', removeReportInactivityState_],
        ['pin', removeEducatorChatPin_],
        ['cache', clearGetChatMessagesCache],
        ['contact', removeMedsiParentContactBestEffort_]
      ].forEach(function(step) {
        try { step[1](phone); }
        catch (error) { cleanupErrors.push(step[0] + ' ' + phone + ': ' + String(error && error.message || error)); }
      });
    });
    const purge = flushReportsS3PurgeQueue_();
    const result = {
      ok:failed.length === 0 && purge.ok,
      reason:reason || '',
      sync:sync,
      staleFound:stale.length,
      deleted:deleted,
      failed:failed,
      cleanupErrors:cleanupErrors,
      purge:purge
    };
    Logger.log('REPORTS_D1_PROFILE_LIFECYCLE ' + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function auditReportsD1Profiles() {
  const sheet = getDataSheet_();
  if (!sheet) return { ok:false, message:'Лист REPORTS не найден.' };
  const current = reportsD1ProfilesSnapshot_();
  const inventory = d1AdminRequest_('/admin/profile-phones', 'get');
  const stale = (Array.isArray(inventory.phones) ? inventory.phones : []).filter(function(phone) {
    return !current[last10_(phone)];
  });
  const active = new Set(Object.keys(current));
  const chatSheet = getChatSheet_();
  let legacyInactiveRows = 0;
  if (chatSheet && chatSheet.getLastRow() >= 2) {
    chatSheet.getRange(2, 2, chatSheet.getLastRow() - 1, 1).getValues().forEach(function(row) {
      if (!active.has(last10_(row[0]))) legacyInactiveRows++;
    });
  }
  const triggers = ScriptApp.getProjectTriggers().map(function(trigger) { return trigger.getHandlerFunction(); });
  return {
    ok:true,
    reportsProfiles:Object.keys(current).length,
    d1Profiles:inventory.phones.length,
    stale:stale,
    legacyInactiveRows:legacyInactiveRows,
    triggerHandlers:triggers,
    profileTriggers:triggers.filter(function(name) {
      return ['onReportsD1Edit', 'onReportsD1Change', 'syncD1ProfilesFromReports'].indexOf(name) >= 0;
    })
  };
}

function onReportsD1Edit(event) {
  try {
    if (!event || !event.range) return;
    const sheetName = event.range.getSheet().getName();
    const coversA1 = event.range.getRow() === 1 && event.range.getColumn() === 1;
    if (coversA1 && (sheetName === SHEET_MORNING || sheetName === SHEET_EVENING)) {
      distributeChildReports(sheetName === SHEET_MORNING ? 'morning' : 'evening');
      return;
    }
    if (coversA1 && sheetName === SHEET_PSYCHOLOGY) {
      const text = String(event.range.getSheet().getRange(1, 1).getValue() || '');
      syncPsychologyNotificationState_(text);
      syncD1CurrentReportsToWorker_('psychology');
      return;
    }
    if (sheetName !== DATA_SHEET_NAME) return;
    reconcileReportsProfilesToD1_('edit');
  } catch (error) { Logger.log('REPORTS_D1_EDIT_SYNC_FAILED ' + (error && error.message || error)); }
}

function onReportsD1Change(event) {
  try { reconcileReportsProfilesToD1_('change:' + String(event && event.changeType || 'unknown')); }
  catch (error) { Logger.log('REPORTS_D1_CHANGE_SYNC_FAILED ' + (error && error.message || error)); }
}

function installReportsD1ProfileSyncTriggers() {
  const handlers = ['onReportsD1Edit', 'onReportsD1Change'];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(trigger);
  });
  saveReportsD1ProfilesSnapshot_(reportsD1ProfilesSnapshot_());
  ScriptApp.newTrigger('onReportsD1Edit').forSpreadsheet(getSpreadsheetId_()).onEdit().create();
  ScriptApp.newTrigger('onReportsD1Change').forSpreadsheet(getSpreadsheetId_()).onChange().create();
  return { ok: true, installed: handlers };
}

function ensureReportsD1ProfileSyncTriggers_() {
  const existing = ScriptApp.getProjectTriggers().map(function(trigger) { return trigger.getHandlerFunction(); });
  if (existing.indexOf('onReportsD1Edit') < 0) {
    ScriptApp.newTrigger('onReportsD1Edit').forSpreadsheet(getSpreadsheetId_()).onEdit().create();
  }
  if (existing.indexOf('onReportsD1Change') < 0) {
    ScriptApp.newTrigger('onReportsD1Change').forSpreadsheet(getSpreadsheetId_()).onChange().create();
  }
  ensureD1ProfileSyncTrigger_();
}

/* ===== D1 + TIMEWEB S3 DELETION QUEUE =====
   REPORTS remains the authority.  Before a D1 thread is removed we store its
   S3 keys in Script Properties.  A failed S3 purge can therefore be retried
   later without ever restoring the deleted parent's chat access. */
function reportsS3PurgeQueue_() {
  const raw = PropertiesService.getScriptProperties().getProperty('REPORTS_D1_S3_PURGE_QUEUE');
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (_) { return {}; }
}

function saveReportsS3PurgeQueue_(queue) {
  PropertiesService.getScriptProperties().setProperty('REPORTS_D1_S3_PURGE_QUEUE', JSON.stringify(queue || {}));
}

function timewebReportsSyncRequest_(path, payload) {
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty('TIMEWEB_REPORTS_SYNC_URL') || '').replace(/\/$/, '');
  const secret = String(props.getProperty('REPORTS_SYNC_SECRET') || '');
  if (!base || !secret) throw new Error('Защищённая очередь S3 ещё не настроена.');
  const response = UrlFetchApp.fetch(base + path, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Medsi-Reports-Sync-Secret': secret },
    payload: JSON.stringify(payload || {})
  });
  let value = {};
  try { value = JSON.parse(response.getContentText() || '{}'); } catch (_) {}
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !value.ok) {
    throw new Error(value.message || value.code || 'Timeweb HTTP ' + response.getResponseCode());
  }
  return value;
}

function flushReportsS3PurgeQueue_() {
  const queue = reportsS3PurgeQueue_();
  const phones = Object.keys(queue);
  const completed = [], failed = [];
  phones.forEach(function(phone) {
    const entry = queue[phone] || {};
    try {
      if (entry.phase !== 'd1-deleted') {
        if (getProfileByPhone_(phone)) {
          throw new Error('Номер снова есть в REPORTS; ожидает ручной проверки.');
        }
        d1AdminRequest_('/admin/delete-profile-phone', 'post', { phone: phone });
        entry.phase = 'd1-deleted';
        entry.updatedAt = Date.now();
        queue[phone] = entry;
        saveReportsS3PurgeQueue_(queue);
      }
      timewebReportsSyncRequest_('/__sync/purge-s3', { keys: Array.isArray(entry.keys) ? entry.keys : [] });
      delete queue[phone];
      completed.push(phone);
    } catch (error) {
      entry.lastError = String(error && error.message || error);
      entry.attempts = Number(entry.attempts || 0) + 1;
      entry.updatedAt = Date.now();
      queue[phone] = entry;
      failed.push({ phone: phone, message: entry.lastError });
    }
  });
  saveReportsS3PurgeQueue_(queue);
  return { ok: failed.length === 0, completed: completed, failed: failed };
}

function deleteD1ProfileWithS3Purge_(phoneRaw) {
  const phone = last10_(phoneRaw);
  if (!phone) throw new Error('Не удалось определить номер родителя для D1.');
  // Refuse to delete the D1 record until the separate Timeweb credential is
  // present: media is then never silently abandoned.
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TIMEWEB_REPORTS_SYNC_URL') || !props.getProperty('REPORTS_SYNC_SECRET')) {
    throw new Error('Защищённая очередь S3 ещё не настроена.');
  }
  const queue = reportsS3PurgeQueue_();
  if (!queue[phone]) {
    const listed = d1AdminRequest_('/admin/profile-s3-keys', 'post', { phone: phone });
    queue[phone] = { keys: Array.isArray(listed.s3Keys) ? listed.s3Keys : [], queuedAt: Date.now(), attempts: 0, phase: 'listed' };
    saveReportsS3PurgeQueue_(queue);
  }
  let deleted = null;
  if (queue[phone].phase !== 'd1-deleted') {
    deleted = d1AdminRequest_('/admin/delete-profile-phone', 'post', { phone: phone });
    queue[phone].phase = 'd1-deleted';
    queue[phone].updatedAt = Date.now();
    saveReportsS3PurgeQueue_(queue);
  }
  const purge = flushReportsS3PurgeQueue_();
  return { ok: true, deleted: deleted, purge: purge };
}

function retryReportsS3PurgeQueue() {
  return flushReportsS3PurgeQueue_();
}

// Manual smoke test for the two protected sides of the queue.  An empty list
// is a no-op in S3 and proves only that Apps Script can reach Timeweb with the
// stored credential.
function verifyReportsS3PurgeQueueSetup() {
  return timewebReportsSyncRequest_('/__sync/purge-s3', { keys: [] });
}

function ensureD1ProfileSyncTrigger_() {
  const handler = 'syncD1ProfilesFromReports';
  const already = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === handler);
  if (!already) ScriptApp.newTrigger(handler).timeBased().everyMinutes(10).create();
}
function importChatHistoryToD1Production() {
  const snapshot = snapshotChatForD1_(), batchSize = 250;
  for (let i = 0; i < snapshot.messages.length || (i === 0 && !snapshot.messages.length); i += batchSize) {
    d1AdminRequest_('/admin/import', 'post', { profiles:i === 0 ? snapshot.profiles : [], pins:i === 0 ? snapshot.pins : [], messages:snapshot.messages.slice(i, i + batchSize) });
    if (!snapshot.messages.length) break;
  }
  const remote = d1AdminRequest_('/admin/verify', 'get');
  const source = {};
  snapshot.messages.forEach(m => { const x = source[m.phone] || (source[m.phone] = {messages:0,oldest:0,newest:0}); x.messages++; x.oldest = !x.oldest ? m.createdAt : Math.min(x.oldest,m.createdAt); x.newest=Math.max(x.newest,m.createdAt); });
  const target = {}; (remote.byPhone || []).forEach(x => { target[x.phone10] = x; });
  const mismatches = Object.keys(source).filter(phone => { const a=source[phone], b=target[phone]; return !b || Number(b.messages)!==a.messages || Number(b.oldest)!==a.oldest || Number(b.newest)!==a.newest; });
  const ok = Number(remote.totals && remote.totals.messages || 0) === snapshot.messages.length && mismatches.length === 0;
  if (ok) PropertiesService.getScriptProperties().setProperty('CHAT_D1_IMPORT_VERIFIED_AT', String(Date.now()));
  else PropertiesService.getScriptProperties().deleteProperty('CHAT_D1_IMPORT_VERIFIED_AT');
  const result = { ok:ok, source:{messages:snapshot.messages.length, phones:Object.keys(source).length}, remote:remote.totals, mismatches:mismatches };
  Logger.log('D1 migration verification: ' + JSON.stringify(result));
  return result;
}
function activateD1ChatBackend() {
  const props=PropertiesService.getScriptProperties(), verified=Number(props.getProperty('CHAT_D1_IMPORT_VERIFIED_AT') || 0);
  if (!verified || Date.now()-verified > 30*60*1000) return {ok:false,message:'Нет свежей успешной сверки импорта.'};
  const sync = syncD1ProfilesFromReports_(false);
  ensureD1ProfileSyncTrigger_();
  props.setProperty('CHAT_BACKEND','d1'); return {ok:true,backend:'d1',sync:sync};
}
function rollbackD1ChatBackend() { PropertiesService.getScriptProperties().setProperty('CHAT_BACKEND','sheets'); return {ok:true,backend:'sheets'}; }


/* ========= TEMPORARY SAFE D1 -> SHEETS ROLLBACK =========
   Keeps D1/KV untouched. Used only to restore the legacy production chat.
*/

function getD1RollbackMessages_() {
  const out = [];
  let offset = 0;
  const limit = 400;

  while (true) {
    const page = d1AdminRequest_(
      '/admin/export?offset=' + encodeURIComponent(offset) +
      '&limit=' + encodeURIComponent(limit),
      'get'
    );

    const rows = Array.isArray(page && page.messages) ? page.messages : [];
    out.push.apply(out, rows);

    if (!rows.length || out.length >= Number(page.total || 0)) break;

    offset += rows.length;

    if (out.length > 20000) {
      throw new Error('Rollback safety stop: больше 20 000 сообщений.');
    }
  }

  return out;
}

function rollbackLegacyKey_(phoneRaw, createdAtRaw, sideRaw) {
  const phone = last10_(phoneRaw);
  const ms = Number(createdAtRaw || 0);
  const side = String(sideRaw || '').trim();
  return phone + '|' + ms + '_' + side;
}

function getLegacyRollbackState_() {
  const sh = ensureChatSheet_();
  const last = sh.getLastRow();
  const rows = last >= 2
    ? sh.getRange(2, 1, last - 1, 14).getValues()
    : [];

  const keys = {};

  rows.forEach(r => {
    const phone = last10_(r[1]);
    const side = String(r[4] || '').trim();
    const ms = new Date(r[0]).getTime();

    if (!phone || !ms || !side) return;
    keys[rollbackLegacyKey_(phone, ms, side)] = true;
  });

  return {
    sheet: sh,
    rows: rows,
    keys: keys
  };
}

function auditD1ToSheetsRollback(tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);

    const d1 = getD1RollbackMessages_();
    const legacy = getLegacyRollbackState_();

    const seen = {};
    const collisions = [];
    const missing = [];

    d1.forEach(m => {
      const k = rollbackLegacyKey_(
        m.phone10,
        m.created_at,
        m.side
      );

      if (seen[k] && seen[k] !== String(m.message_key || '')) {
        collisions.push({
          key: k,
          first: seen[k],
          second: String(m.message_key || '')
        });
      }

      seen[k] = String(m.message_key || '');

      if (!legacy.keys[k]) missing.push(m);
    });

    const missingImages = missing.filter(
      m => String(m.type || '') === 'image'
    );

    const missingVideos = missing.filter(
      m => String(m.type || '') === 'video'
    );

    const kvImages = missingImages.filter(
      m => String(m.file_id || '').startsWith('kv:')
    );

    const kvVideos = missingVideos.filter(
      m => String(m.file_id || '').startsWith('kv:')
    );

    return {
      ok: collisions.length === 0,
      backend: String(
        PropertiesService.getScriptProperties().getProperty('CHAT_BACKEND') || 'sheets'
      ),
      d1Messages: d1.length,
      sheetsMessages: legacy.rows.length,
      missingMessages: missing.length,
      missingImages: missingImages.length,
      missingVideos: missingVideos.length,
      kvImagesToCopyToDrive: kvImages.length,
      kvVideosToCopyToDrive: kvVideos.length,
      collisions: collisions.slice(0, 20)
    };

  } catch (e) {
    return {
      ok: false,
      message: 'Rollback audit failed: ' + (e.message || e)
    };
  }
}

function rollbackMimeExtension_(mimeRaw) {
  const mime = String(mimeRaw || '').toLowerCase();

  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';

  return '.bin';
}

function copyRollbackKvImageToDrive_(message) {
  const fileId = String(message.file_id || '').trim();

  if (!fileId.startsWith('kv:')) return fileId;

  const mediaKey = fileId.slice(3);

  const url =
    'https://medsi-chat-worker.medsi-children.workers.dev/media/' +
    encodeURIComponent(mediaKey);

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error(
      'Не удалось скачать вложение ' + fileId +
      ' из Cloudflare. HTTP ' + code
    );
  }

  const blob = response.getBlob();
  const mime = String(blob.getContentType() || 'application/octet-stream');

  if (!/^image\//i.test(mime)) {
    throw new Error(
      'Rollback ожидал изображение, но получил ' + mime +
      ' для ' + fileId
    );
  }

  const name =
    'medsi-restored-' +
    String(message.created_at || Date.now()) +
    rollbackMimeExtension_(mime);

  blob.setName(name);

  const file = getChatPhotosFolder_().createFile(blob);

  file.setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW
  );

  return file.getId();
}

function rollbackReplyContext_(message, d1ByKey) {
  const replyKey = String(message.reply_to_key || '').trim();

  if (!replyKey) return '';

  const target = d1ByKey[replyKey];
  if (!target) return '';

  const type = String(target.type || 'text');
  let preview = buildChatPreviewText_(type, target.text || '');

  if (type === 'video') {
    const video = parseVideoPayload_(target.text || '');
    preview =
      video.caption ||
      video.videoTitle ||
      '[Видео]';
  }

  if (!preview && type === 'image') preview = '[Фотография]';
  if (!preview) preview = '[Сообщение]';

  return JSON.stringify({
    messageKey: buildMessageKey_(
      new Date(Number(target.created_at || 0)),
      String(target.side || '')
    ),
    side: String(target.side || ''),
    type: type,
    text: String(preview).slice(0, 240)
  });
}

function restoreD1ToSheetsRollback(tutorTokenRaw, switchBackendRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);

    const audit = auditD1ToSheetsRollback(tutorTokenRaw);

    if (!audit || !audit.ok) {
      return {
        ok: false,
        message: 'Аудит rollback не пройден.',
        audit: audit
      };
    }

    // Старый production Sheets UI не поддерживает загруженные video-файлы.
    // Не переключаем backend, если есть хотя бы одно такое новое сообщение.
    if (Number(audit.missingVideos || 0) > 0) {
      return {
        ok: false,
        code: 'ROLLBACK_VIDEO_BLOCK',
        message:
          'Обнаружены новые video-сообщения в D1. ' +
          'Автоматический rollback остановлен, чтобы не потерять видео.',
        audit: audit
      };
    }

    const d1 = getD1RollbackMessages_();
    const legacy = getLegacyRollbackState_();
    const d1ByKey = {};

    d1.forEach(m => {
      d1ByKey[String(m.message_key || '')] = m;
    });

    const missing = d1.filter(m => {
      const k = rollbackLegacyKey_(
        m.phone10,
        m.created_at,
        m.side
      );
      return !legacy.keys[k];
    });

    missing.sort((a, b) => {
      const dt = Number(a.created_at || 0) - Number(b.created_at || 0);
      return dt || String(a.message_key || '').localeCompare(String(b.message_key || ''));
    });

    let restored = 0;
    let restoredImages = 0;

    missing.forEach(m => {
      const type = ['text', 'image', 'video'].includes(String(m.type))
        ? String(m.type)
        : 'text';

      let driveFileId = String(m.file_id || '').trim();
      let deleteAfter = m.delete_after
        ? new Date(Number(m.delete_after))
        : '';

      if (driveFileId.startsWith('kv:')) {
        if (type !== 'image') {
          throw new Error(
            'Неподдерживаемое KV-вложение типа ' + type +
            ': ' + driveFileId
          );
        }

        driveFileId = copyRollbackKvImageToDrive_(m);

        // Старый чат умеет чистить временные изображения сам.
        deleteAfter = new Date(
          Date.now() +
          Number(CHAT_IMAGE_TTL_DAYS || 30) * 86400000
        );

        restoredImages++;
      }

      const replyContext = rollbackReplyContext_(m, d1ByKey);

      legacy.sheet.appendRow([
        new Date(Number(m.created_at || Date.now())),
        last10_(m.phone10),
        String(m.parent_name || ''),
        String(m.child_name || ''),
        String(m.side || ''),
        type,
        String(m.text || ''),
        driveFileId,
        deleteAfter,
        String(m.status || 'active') === 'deleted'
          ? 'deleted'
          : 'active',
        !!m.read_by_parent,
        !!m.read_by_educator,
        normalizeReaction_(m.reaction || ''),
        replyContext
      ]);

      legacy.keys[
        rollbackLegacyKey_(
          m.phone10,
          m.created_at,
          m.side
        )
      ] = true;

      restored++;
    });

    if (restored > 0) {
      rebuildChatIndex_();
      clearGetChatMessagesCache();
      ensureChatCleanupTrigger_();
    }

    const verify = auditD1ToSheetsRollback(tutorTokenRaw);

    if (!verify || !verify.ok || Number(verify.missingMessages || 0) !== 0) {
      return {
        ok: false,
        code: 'ROLLBACK_VERIFY_FAILED',
        message:
          'Перенос выполнен не полностью. Backend НЕ переключён.',
        restored: restored,
        restoredImages: restoredImages,
        verify: verify
      };
    }

    if (switchBackendRaw === true) {
      PropertiesService
        .getScriptProperties()
        .setProperty('CHAT_BACKEND', 'sheets');
    }

    return {
      ok: true,
      backend: String(
        PropertiesService
          .getScriptProperties()
          .getProperty('CHAT_BACKEND') || 'sheets'
      ),
      restoredMessages: restored,
      restoredImages: restoredImages,
      verify: verify
    };

  } catch (e) {
    return {
      ok: false,
      message: 'Rollback failed: ' + (e.message || e)
    };
  }
}


function auditSheetsToD1Delta() {
  const snapshot = snapshotChatForD1_();
  const d1 = getD1RollbackMessages_();

  const sheetByKey = {};
  const d1ByKey = {};
  const sheetDuplicates = [];
  const d1Duplicates = [];

  snapshot.messages.forEach(m => {
    const key = String(m.messageKey || '').trim();
    if (!key) return;
    if (sheetByKey[key]) sheetDuplicates.push(key);
    sheetByKey[key] = m;
  });

  d1.forEach(m => {
    const key = String(m.message_key || '').trim();
    if (!key) return;
    if (d1ByKey[key]) d1Duplicates.push(key);
    d1ByKey[key] = m;
  });

  const missingInD1 = Object.keys(sheetByKey)
    .filter(key => !d1ByKey[key])
    .map(key => sheetByKey[key])
    .sort((a, b) =>
      Number(a.createdAt || 0) - Number(b.createdAt || 0) ||
      String(a.messageKey || '').localeCompare(String(b.messageKey || ''))
    );

  const d1Only = Object.keys(d1ByKey)
    .filter(key => !sheetByKey[key])
    .map(key => d1ByKey[key]);

  const result = {
    ok: sheetDuplicates.length === 0 && d1Duplicates.length === 0,
    sheetsMessages: snapshot.messages.length,
    d1Messages: d1.length,
    missingInD1: missingInD1.length,
    d1Only: d1Only.length,
    sheetDuplicateKeys: sheetDuplicates.slice(0, 20),
    d1DuplicateKeys: d1Duplicates.slice(0, 20),
    firstMissing: missingInD1.slice(0, 10).map(m => ({
      messageKey: m.messageKey,
      phone: m.phone,
      side: m.side,
      type: m.type,
      createdAt: m.createdAt
    }))
  };

  Logger.log('D1 DELTA AUDIT ' + JSON.stringify(result));
  return result;
}

function auditSheetsToD1DeltaDetails() {
  const snapshot = snapshotChatForD1_();
  const d1 = getD1RollbackMessages_();
  const activeProfiles = snapshotActiveProfilesForD1_();

  const activePhones = {};
  activeProfiles.forEach(p => {
    const phone = last10_(p.phone);
    if (phone) activePhones[phone] = true;
  });

  const sheetByKey = {};
  const d1ByKey = {};

  snapshot.messages.forEach(m => {
    const key = String(m.messageKey || '').trim();
    if (key) sheetByKey[key] = m;
  });

  d1.forEach(m => {
    const key = String(m.message_key || '').trim();
    if (key) d1ByKey[key] = m;
  });

  const missing = Object.keys(sheetByKey)
    .filter(key => !d1ByKey[key])
    .map(key => sheetByKey[key]);

  const d1Only = Object.keys(d1ByKey)
    .filter(key => !sheetByKey[key])
    .map(key => d1ByKey[key]);

  const d1OnlyByPhone = {};
  d1Only.forEach(m => {
    const phone = last10_(m.phone10);
    const x = d1OnlyByPhone[phone] || (d1OnlyByPhone[phone] = {
      phone: phone,
      activeInReports: !!activePhones[phone],
      messages: 0,
      oldest: 0,
      newest: 0,
      types: {}
    });

    const ts = Number(m.created_at || 0);
    x.messages++;
    x.oldest = !x.oldest ? ts : Math.min(x.oldest, ts);
    x.newest = Math.max(x.newest, ts);

    const type = String(m.type || 'text');
    x.types[type] = Number(x.types[type] || 0) + 1;
  });

  function norm(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  const differences = [];

  Object.keys(sheetByKey).forEach(key => {
    const a = sheetByKey[key];
    const b = d1ByKey[key];
    if (!b) return;

    const fields = [];

    if (last10_(a.phone) !== last10_(b.phone10)) fields.push('phone');
    if (norm(a.side) !== norm(b.side)) fields.push('side');
    if (norm(a.type) !== norm(b.type)) fields.push('type');
    if (norm(a.text) !== norm(b.text)) fields.push('text');
    if (norm(a.fileId) !== norm(b.file_id)) fields.push('fileId');
    if (norm(a.status || 'active') !== norm(b.status || 'active')) fields.push('status');
    if (!!a.readByParent !== !!b.read_by_parent) fields.push('readByParent');
    if (!!a.readByEducator !== !!b.read_by_educator) fields.push('readByEducator');
    if (norm(a.reaction) !== norm(b.reaction)) fields.push('reaction');
    if (norm(a.replyToKey) !== norm(b.reply_to_key)) fields.push('replyToKey');
    if (Number(a.createdAt || 0) !== Number(b.created_at || 0)) fields.push('createdAt');
    if (Number(a.deleteAfter || 0) !== Number(b.delete_after || 0)) fields.push('deleteAfter');

    if (fields.length) {
      differences.push({
        messageKey: key,
        phone: last10_(a.phone),
        fields: fields
      });
    }
  });

  const missingTypes = {};
  let missingWithFiles = 0;

  missing.forEach(m => {
    const type = String(m.type || 'text');
    missingTypes[type] = Number(missingTypes[type] || 0) + 1;
    if (String(m.fileId || '').trim()) missingWithFiles++;
  });

  const result = {
    ok: true,
    overlap: Object.keys(sheetByKey).filter(key => !!d1ByKey[key]).length,
    overlapWithDifferences: differences.length,
    differenceSamples: differences.slice(0, 20),

    missingInD1: missing.length,
    missingTypes: missingTypes,
    missingWithFiles: missingWithFiles,

    d1Only: d1Only.length,
    d1OnlyActiveProfiles: d1Only.filter(m => !!activePhones[last10_(m.phone10)]).length,
    d1OnlyInactiveProfiles: d1Only.filter(m => !activePhones[last10_(m.phone10)]).length,
    d1OnlyByPhone: Object.keys(d1OnlyByPhone)
      .map(phone => d1OnlyByPhone[phone])
      .sort((a, b) => b.messages - a.messages)
  };

  Logger.log('D1 DELTA DETAILS ' + JSON.stringify(result));
  return result;
}

function auditSheetsToD1SemanticDelta() {
  const snapshot = snapshotChatForD1_();
  const d1 = getD1RollbackMessages_();

  function identity(phone, timestamp, side) {
    return last10_(phone) + '|' +
      Number(timestamp || 0) + '|' +
      String(side || '').trim();
  }

  function norm(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  const sheetByIdentity = {};
  const d1ByIdentity = {};
  const sheetIdentityDuplicates = [];
  const d1IdentityDuplicates = [];

  snapshot.messages.forEach(m => {
    const id = identity(m.phone, m.createdAt, m.side);
    if (sheetByIdentity[id]) sheetIdentityDuplicates.push(id);
    sheetByIdentity[id] = m;
  });

  d1.forEach(m => {
    const id = identity(m.phone10, m.created_at, m.side);
    if (d1ByIdentity[id]) d1IdentityDuplicates.push(id);
    d1ByIdentity[id] = m;
  });

  const semanticMatchesDifferentKey = [];
  const semanticDifferences = [];

  Object.keys(sheetByIdentity).forEach(id => {
    const a = sheetByIdentity[id];
    const b = d1ByIdentity[id];
    if (!b) return;

    if (String(a.messageKey || '') !== String(b.message_key || '')) {
      const fields = [];

      if (norm(a.type) !== norm(b.type)) fields.push('type');
      if (norm(a.text) !== norm(b.text)) fields.push('text');
      if (norm(a.fileId) !== norm(b.file_id)) fields.push('fileId');
      if (norm(a.status || 'active') !== norm(b.status || 'active')) fields.push('status');
      if (!!a.readByParent !== !!b.read_by_parent) fields.push('readByParent');
      if (!!a.readByEducator !== !!b.read_by_educator) fields.push('readByEducator');
      if (norm(a.reaction) !== norm(b.reaction)) fields.push('reaction');

      const row = {
        phone: last10_(a.phone),
        createdAt: Number(a.createdAt || 0),
        side: a.side,
        sheetKey: a.messageKey,
        d1Key: b.message_key,
        differences: fields
      };

      semanticMatchesDifferentKey.push(row);
      if (fields.length) semanticDifferences.push(row);
    }
  });

  const trulyMissing = snapshot.messages.filter(m =>
    !d1ByIdentity[identity(m.phone, m.createdAt, m.side)]
  );

  const trulyD1Only = d1.filter(m =>
    !sheetByIdentity[identity(m.phone10, m.created_at, m.side)]
  );

  const result = {
    ok:
      sheetIdentityDuplicates.length === 0 &&
      d1IdentityDuplicates.length === 0 &&
      semanticDifferences.length === 0,

    sheetsMessages: snapshot.messages.length,
    d1Messages: d1.length,

    sameLogicalMessageDifferentKey: semanticMatchesDifferentKey.length,
    semanticDifferences: semanticDifferences.length,

    trulyMissingInD1: trulyMissing.length,
    trulyD1Only: trulyD1Only.length,

    sheetIdentityDuplicates: sheetIdentityDuplicates.slice(0, 20),
    d1IdentityDuplicates: d1IdentityDuplicates.slice(0, 20),

    differentKeySamples: semanticMatchesDifferentKey.slice(0, 20),

    trulyMissingSamples: trulyMissing.slice(0, 20).map(m => ({
      messageKey: m.messageKey,
      phone: m.phone,
      side: m.side,
      type: m.type,
      createdAt: m.createdAt,
      hasFile: !!String(m.fileId || '').trim()
    })),

    trulyD1OnlySamples: trulyD1Only.slice(0, 20).map(m => ({
      messageKey: m.message_key,
      phone: m.phone10,
      side: m.side,
      type: m.type,
      createdAt: m.created_at
    }))
  };

  Logger.log('D1 SEMANTIC DELTA ' + JSON.stringify(result));
  return result;
}

function auditSheetsToD1SemanticDifferenceDetails() {
  const snapshot = snapshotChatForD1_();
  const d1 = getD1RollbackMessages_();

  function identity(phone, timestamp, side) {
    return last10_(phone) + '|' +
      Number(timestamp || 0) + '|' +
      String(side || '').trim();
  }

  function fileKind(v) {
    const s = String(v || '').trim();
    if (!s) return 'empty';
    if (s.indexOf('kv:') === 0) return 'kv';
    if (s.indexOf('r2:') === 0) return 'r2';
    return 'drive-or-other';
  }

  const d1ByIdentity = {};
  d1.forEach(m => {
    d1ByIdentity[identity(m.phone10, m.created_at, m.side)] = m;
  });

  const differences = [];

  snapshot.messages.forEach(a => {
    const b = d1ByIdentity[identity(a.phone, a.createdAt, a.side)];
    if (!b) return;

    if (String(a.messageKey || '') === String(b.message_key || '')) return;

    const fields = [];

    if (String(a.type || '') !== String(b.type || '')) fields.push('type');
    if (String(a.text || '') !== String(b.text || '')) fields.push('text');
    if (String(a.fileId || '') !== String(b.file_id || '')) fields.push('fileId');
    if (String(a.status || 'active') !== String(b.status || 'active')) fields.push('status');
    if (!!a.readByParent !== !!b.read_by_parent) fields.push('readByParent');
    if (!!a.readByEducator !== !!b.read_by_educator) fields.push('readByEducator');
    if (String(a.reaction || '') !== String(b.reaction || '')) fields.push('reaction');

    if (!fields.length) return;

    differences.push({
      phone: last10_(a.phone),
      createdAt: Number(a.createdAt || 0),
      side: String(a.side || ''),
      sheetKey: String(a.messageKey || ''),
      d1Key: String(b.message_key || ''),
      fields: fields,

      sheetType: String(a.type || ''),
      d1Type: String(b.type || ''),

      sheetTextLength: String(a.text || '').length,
      d1TextLength: String(b.text || '').length,

      sheetFileKind: fileKind(a.fileId),
      d1FileKind: fileKind(b.file_id),

      sheetReadByParent: !!a.readByParent,
      d1ReadByParent: !!b.read_by_parent,

      sheetReadByEducator: !!a.readByEducator,
      d1ReadByEducator: !!b.read_by_educator,

      sheetStatus: String(a.status || 'active'),
      d1Status: String(b.status || 'active'),

      sheetReaction: String(a.reaction || ''),
      d1Reaction: String(b.reaction || '')
    });
  });

  const result = {
    ok: true,
    count: differences.length,
    differences: differences
  };

  Logger.log('D1 SEMANTIC DIFFERENCE DETAILS ' + JSON.stringify(result));
  return result;
}

function importMissingSheetsMessagesToD1Production() {
  const snapshot = snapshotChatForD1_();
  const d1Before = getD1RollbackMessages_();

  function identity(phone, timestamp, side) {
    return last10_(phone) + '|' +
      Number(timestamp || 0) + '|' +
      String(side || '').trim();
  }

  const sheetByIdentity = {};
  const d1ByIdentity = {};
  const sheetDuplicates = [];
  const d1Duplicates = [];

  snapshot.messages.forEach(m => {
    const id = identity(m.phone, m.createdAt, m.side);
    if (sheetByIdentity[id]) sheetDuplicates.push(id);
    sheetByIdentity[id] = m;
  });

  d1Before.forEach(m => {
    const id = identity(m.phone10, m.created_at, m.side);
    if (d1ByIdentity[id]) d1Duplicates.push(id);
    d1ByIdentity[id] = m;
  });

  if (sheetDuplicates.length || d1Duplicates.length) {
    throw new Error(
      'DELTA IMPORT STOP: обнаружены дубли логической идентичности. ' +
      JSON.stringify({
        sheetDuplicates: sheetDuplicates.slice(0, 20),
        d1Duplicates: d1Duplicates.slice(0, 20)
      })
    );
  }

  const d1Only = Object.keys(d1ByIdentity)
    .filter(id => !sheetByIdentity[id]);

  if (d1Only.length) {
    throw new Error(
      'DELTA IMPORT STOP: в D1 появились логически лишние сообщения: ' +
      d1Only.length
    );
  }

  const missing = snapshot.messages
    .filter(m => !d1ByIdentity[identity(m.phone, m.createdAt, m.side)])
    .sort((a, b) =>
      Number(a.createdAt || 0) - Number(b.createdAt || 0) ||
      String(a.messageKey || '').localeCompare(String(b.messageKey || ''))
    );

  if (!missing.length) {
    return {
      ok: true,
      imported: 0,
      message: 'Новых сообщений для импорта нет.'
    };
  }

  // Safety stop против случайного массового импорта.
  if (missing.length > 500) {
    throw new Error(
      'DELTA IMPORT STOP: неожиданно много отсутствующих сообщений: ' +
      missing.length
    );
  }

  const batchSize = 250;

  for (let i = 0; i < missing.length; i += batchSize) {
    d1AdminRequest_('/admin/import', 'post', {
      profiles: [],
      pins: [],
      messages: missing.slice(i, i + batchSize)
    });
  }

  const d1After = getD1RollbackMessages_();
  const afterByIdentity = {};
  const afterDuplicates = [];

  d1After.forEach(m => {
    const id = identity(m.phone10, m.created_at, m.side);
    if (afterByIdentity[id]) afterDuplicates.push(id);
    afterByIdentity[id] = m;
  });

  const stillMissing = snapshot.messages.filter(
    m => !afterByIdentity[identity(m.phone, m.createdAt, m.side)]
  );

  const importedKeysMissing = missing
    .map(m => String(m.messageKey || ''))
    .filter(key => !d1After.some(x => String(x.message_key || '') === key));

  const ok =
    afterDuplicates.length === 0 &&
    stillMissing.length === 0 &&
    importedKeysMissing.length === 0;

  const result = {
    ok: ok,
    beforeD1Messages: d1Before.length,
    sheetsMessages: snapshot.messages.length,
    imported: missing.length,
    importedTypes: missing.reduce((acc, m) => {
      const type = String(m.type || 'text');
      acc[type] = Number(acc[type] || 0) + 1;
      return acc;
    }, {}),
    importedWithFiles: missing.filter(
      m => !!String(m.fileId || '').trim()
    ).length,
    afterD1Messages: d1After.length,
    stillMissing: stillMissing.length,
    duplicateIdentitiesAfter: afterDuplicates.length,
    importedKeysMissing: importedKeysMissing.length
  };

  Logger.log('D1 MISSING-ONLY IMPORT ' + JSON.stringify(result));

  if (!ok) {
    throw new Error(
      'DELTA IMPORT VERIFY FAILED: ' + JSON.stringify(result)
    );
  }

  return result;
}

function smokeTestProductionD1Worker() {
  const verify = d1AdminRequest_('/admin/verify', 'get');

  const profiles = snapshotActiveProfilesForD1_();
  if (!profiles.length) {
    throw new Error('SMOKE STOP: нет активных профилей.');
  }

  const phone = last10_(profiles[0].phone);
  if (!phone) {
    throw new Error('SMOKE STOP: не удалось получить тестовый телефон.');
  }

  const session = createD1ChatSession_('parent', phone);
  if (!session || !session.token) {
    throw new Error('SMOKE STOP: не удалось создать parent D1 session.');
  }

  const response = UrlFetchApp.fetch(
    'https://medsi-chat-worker.medsi-children.workers.dev/lab/threads/' +
    encodeURIComponent(phone) +
    '?limit=5',
    {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'X-Medsi-Chat-Session': session.token
      }
    }
  );

  const code = response.getResponseCode();
  let body = {};
  try {
    body = JSON.parse(response.getContentText() || '{}');
  } catch (_) {}

  const result = {
    ok:
      code === 200 &&
      body &&
      body.ok === true &&
      Number(verify && verify.totals && verify.totals.messages || 0) > 0,
    adminVerifyMessages:
      Number(verify && verify.totals && verify.totals.messages || 0),
    parentThreadHttp: code,
    parentThreadOk: !!(body && body.ok),
    returnedMessages:
      Array.isArray(body && body.messages) ? body.messages.length : 0
  };

  Logger.log('D1 PRODUCTION SMOKE ' + JSON.stringify(result));

  if (!result.ok) {
    throw new Error('PRODUCTION D1 SMOKE FAILED: ' + JSON.stringify(result));
  }

  return result;
}

function cutoverToD1ProductionSafely() {
  // 1. Последняя дельта прямо перед переключением.
  const delta = importMissingSheetsMessagesToD1Production();

  const snapshot = snapshotChatForD1_();
  const d1 = getD1RollbackMessages_();
  const activeProfiles = snapshotActiveProfilesForD1_();

  function identity(phone, timestamp, side) {
    return last10_(phone) + '|' +
      Number(timestamp || 0) + '|' +
      String(side || '').trim();
  }

  function norm(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  const activePhones = {};
  activeProfiles.forEach(p => {
    const phone = last10_(p.phone);
    if (phone) activePhones[phone] = true;
  });

  const sheets = {};
  const remote = {};
  const sheetDuplicates = [];
  const d1Duplicates = [];

  snapshot.messages.forEach(m => {
    const id = identity(m.phone, m.createdAt, m.side);
    if (sheets[id]) sheetDuplicates.push(id);
    sheets[id] = m;
  });

  d1.forEach(m => {
    const id = identity(m.phone10, m.created_at, m.side);
    if (remote[id]) d1Duplicates.push(id);
    remote[id] = m;
  });

  const missing = Object.keys(sheets).filter(id => !remote[id]);
  const d1Only = Object.keys(remote).filter(id => !sheets[id]);

  // Не даём full reconcile неожиданно удалить только что мигрированные сообщения.
  const inactiveSheetMessages = Object.keys(sheets).filter(id => {
    return !activePhones[last10_(sheets[id].phone)];
  });

  const unsafeDifferences = [];
  let allowedCloudflareFileDifferences = 0;

  Object.keys(sheets).forEach(id => {
    const a = sheets[id];
    const b = remote[id];
    if (!b) return;

    const fields = [];

    if (norm(a.side) !== norm(b.side)) fields.push('side');
    if (norm(a.type) !== norm(b.type)) fields.push('type');
    if (norm(a.text) !== norm(b.text)) fields.push('text');
    if (norm(a.status || 'active') !== norm(b.status || 'active')) fields.push('status');
    if (!!a.readByParent !== !!b.read_by_parent) fields.push('readByParent');
    if (!!a.readByEducator !== !!b.read_by_educator) fields.push('readByEducator');
    if (norm(a.reaction) !== norm(b.reaction)) fields.push('reaction');
    if (Number(a.createdAt || 0) !== Number(b.created_at || 0)) fields.push('createdAt');
    const sheetFile = norm(a.fileId).trim();
    const d1File = norm(b.file_id).trim();

    const migratedCloudflareImage =
      String(a.type || '') === 'image' &&
      !!sheetFile &&
      !sheetFile.startsWith('kv:') &&
      !sheetFile.startsWith('r2:') &&
      (d1File.startsWith('kv:') || d1File.startsWith('r2:'));

    if (sheetFile !== d1File) {
      if (migratedCloudflareImage) {
        allowedCloudflareFileDifferences++;
      } else {
        fields.push('fileId');
      }
    }

    if (
      Number(a.deleteAfter || 0) !== Number(b.delete_after || 0) &&
      !migratedCloudflareImage
    ) {
      fields.push('deleteAfter');
    }

    // replyToKey сравниваем только когда значения реально различаются.
    // Старые UUID message_key допустимы, но неизвестную потерю reply не пропускаем.
    if (norm(a.replyToKey) !== norm(b.reply_to_key)) {
      fields.push('replyToKey');
    }

    if (fields.length) {
      unsafeDifferences.push({
        phone: last10_(a.phone),
        createdAt: Number(a.createdAt || 0),
        side: String(a.side || ''),
        fields: fields
      });
    }
  });

  const preflight = {
    sheetsMessages: snapshot.messages.length,
    d1Messages: d1.length,
    missing: missing.length,
    d1Only: d1Only.length,
    sheetDuplicateIdentities: sheetDuplicates.length,
    d1DuplicateIdentities: d1Duplicates.length,
    inactiveSheetMessages: inactiveSheetMessages.length,
    unsafeDifferences: unsafeDifferences.length,
    allowedCloudflareFileDifferences: allowedCloudflareFileDifferences,
    deltaImportedNow: Number(delta && delta.imported || 0)
  };

  if (
    missing.length ||
    d1Only.length ||
    sheetDuplicates.length ||
    d1Duplicates.length ||
    inactiveSheetMessages.length ||
    unsafeDifferences.length
  ) {
    Logger.log(
      'D1 CUTOVER BLOCKED ' +
      JSON.stringify({
        preflight: preflight,
        unsafeDifferenceSamples: unsafeDifferences.slice(0, 20)
      })
    );

    throw new Error(
      'D1 CUTOVER BLOCKED: ' + JSON.stringify(preflight)
    );
  }

  // activateD1ChatBackend() требует свежую отметку успешной проверки.
  PropertiesService
    .getScriptProperties()
    .setProperty('CHAT_D1_IMPORT_VERIFIED_AT', String(Date.now()));

  // Внутри: full sync профилей + trigger + CHAT_BACKEND=d1.
  const activation = activateD1ChatBackend();

  if (!activation || activation.ok !== true || activation.backend !== 'd1') {
    throw new Error(
      'D1 ACTIVATION FAILED: ' + JSON.stringify(activation || {})
    );
  }

  const result = {
    ok: true,
    backend: 'd1',
    preflight: preflight,
    activation: activation
  };

  Logger.log('D1 CUTOVER SUCCESS ' + JSON.stringify(result));
  return result;
}

function inspectCutoverDeleteAfterDifference() {
  const snapshot = snapshotChatForD1_();
  const d1 = getD1RollbackMessages_();

  const phone = '9265488357';
  const createdAt = 1788434400501;
  const side = 'educator';

  const sheet = snapshot.messages.find(m =>
    last10_(m.phone) === phone &&
    Number(m.createdAt || 0) === createdAt &&
    String(m.side || '') === side
  );

  const remote = d1.find(m =>
    last10_(m.phone10) === phone &&
    Number(m.created_at || 0) === createdAt &&
    String(m.side || '') === side
  );

  function kind(v) {
    const s = String(v || '').trim();
    if (!s) return 'empty';
    if (s.startsWith('kv:')) return 'kv';
    if (s.startsWith('r2:')) return 'r2';
    return 'drive-or-other';
  }

  const result = {
    sheetFound: !!sheet,
    d1Found: !!remote,

    sheetFileKind: sheet ? kind(sheet.fileId) : '',
    d1FileKind: remote ? kind(remote.file_id) : '',

    sheetDeleteAfter: sheet ? Number(sheet.deleteAfter || 0) : 0,
    d1DeleteAfter: remote ? Number(remote.delete_after || 0) : 0,

    sheetDeleteAfterIso:
      sheet && Number(sheet.deleteAfter || 0)
        ? new Date(Number(sheet.deleteAfter)).toISOString()
        : '',

    d1DeleteAfterIso:
      remote && Number(remote.delete_after || 0)
        ? new Date(Number(remote.delete_after)).toISOString()
        : ''
  };

  Logger.log(
    'D1 DELETE_AFTER DIFFERENCE ' + JSON.stringify(result)
  );

  return result;
}

function auditD1ImageStorage() {
  const d1 = getD1RollbackMessages_();

  const images = d1.filter(m => String(m.type || '') === 'image');

  const result = {
    totalImages: images.length,
    timewebS3: 0,
    cloudflareKv: 0,
    cloudflareR2: 0,
    driveOrOther: 0,
    emptyFileId: 0,
    driveOrOtherSamples: []
  };

  images.forEach(m => {
    const fileId = String(m.file_id || '').trim();

    if (!fileId) {
      result.emptyFileId++;
      return;
    }

    if (fileId.startsWith('kv:')) {
      result.cloudflareKv++;
      return;
    }

    if (fileId.startsWith('s3:')) {
      result.timewebS3++;
      return;
    }

    if (fileId.startsWith('r2:')) {
      result.cloudflareR2++;
      return;
    }

    result.driveOrOther++;

    if (result.driveOrOtherSamples.length < 30) {
      result.driveOrOtherSamples.push({
        messageKey: String(m.message_key || ''),
        phone: last10_(m.phone10),
        createdAt: Number(m.created_at || 0),
        side: String(m.side || '')
      });
    }
  });

  Logger.log('D1 IMAGE STORAGE AUDIT ' + JSON.stringify(result));
  return result;
}

/* ===== MANUAL LEGACY MEDIA -> TIMEWEB S3 MIGRATION =====
   This is deliberately not exposed to normal chat requests or triggers.
   It moves one verified attachment at a time and never deletes Drive/KV data.
*/

function legacyMediaMigrationConfig_() {
  const props = PropertiesService.getScriptProperties();
  const secret = String(props.getProperty('MIGRATION_SHARED_SECRET') || '');
  const base = String(
    props.getProperty('TIMEWEB_MIGRATION_URL') ||
    'https://medsi-children-medsi-children-github-io-4f52.twc1.net'
  ).replace(/\/+$/, '');

  if (!secret) throw new Error('MIGRATION_SHARED_SECRET is not configured.');
  if (!/^https:\/\//.test(base)) throw new Error('TIMEWEB_MIGRATION_URL must be HTTPS.');
  return { secret: secret, base: base };
}

function legacyMediaSha256Hex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function(byte) {
      const value = byte < 0 ? byte + 256 : byte;
      return value.toString(16).padStart(2, '0');
    })
    .join('');
}

function legacyMediaSource_(message) {
  const fileId = String(message.file_id || '').trim();
  if (!fileId) throw new Error('Legacy media has an empty file_id.');

  if (fileId.startsWith('kv:')) {
    const response = UrlFetchApp.fetch(
      'https://medsi-chat-worker.medsi-children.workers.dev/media/' +
      encodeURIComponent(fileId.slice(3)),
      { method: 'get', muteHttpExceptions: true }
    );
    if (response.getResponseCode() !== 200) {
      throw new Error('Cloudflare media download failed: HTTP ' + response.getResponseCode());
    }
    const headers = response.getHeaders();
    return {
      bytes: response.getContent(),
      mime: String(headers['Content-Type'] || headers['content-type'] || 'application/octet-stream'),
      name: 'legacy-media'
    };
  }

  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  return {
    bytes: blob.getBytes(),
    mime: String(blob.getContentType() || 'application/octet-stream'),
    name: String(file.getName() || 'legacy-media')
  };
}

function legacyMediaD1Payload_(message, s3FileId) {
  return {
    messageKey: String(message.message_key || ''),
    phone: last10_(message.phone10),
    side: String(message.side || ''),
    type: String(message.type || 'image'),
    text: String(message.text || ''),
    fileId: s3FileId,
    deleteAfter: Number(message.delete_after || 0),
    status: String(message.status || 'active'),
    replyToKey: String(message.reply_to_key || ''),
    reaction: String(message.reaction || ''),
    editedAt: Number(message.edited_at || 0),
    createdAt: Number(message.created_at || 0),
    readByParent: !!message.read_by_parent,
    readByEducator: !!message.read_by_educator
  };
}

function migrateLegacyMediaToTimewebS3_(limit) {
  const count = Math.max(1, Math.min(Number(limit || 1), 20));
  const config = legacyMediaMigrationConfig_();
  const pending = getD1RollbackMessages_().filter(function(message) {
    const fileId = String(message.file_id || '').trim();
    return String(message.type || '') === 'image' && fileId && !fileId.startsWith('s3:');
  }).slice(0, count);

  if (!pending.length) return { ok: true, migrated: 0, remaining: 0, message: 'Все изображения уже проверенно перенесены в Timeweb S3.' };

  const migrated = [];
  pending.forEach(function(message) {
    const source = legacyMediaSource_(message);
    if (!source.bytes || source.bytes.length > 20 * 1024 * 1024) {
      throw new Error('Legacy media has invalid size for ' + String(message.message_key || 'unknown'));
    }
    const sha256 = legacyMediaSha256Hex_(source.bytes);
    const upload = UrlFetchApp.fetch(config.base + '/__migration/media', {
      method: 'post',
      contentType: source.mime,
      payload: source.bytes,
      muteHttpExceptions: true,
      headers: {
        'X-Medsi-Migration-Secret': config.secret,
        'X-Medsi-Source-Sha256': sha256,
        'X-File-Name': source.name.slice(0, 180)
      }
    });
    let body = {};
    try { body = JSON.parse(upload.getContentText() || '{}'); } catch (_) {}
    if (upload.getResponseCode() < 200 || upload.getResponseCode() >= 300 || !body.ok || !String(body.fileId || '').startsWith('s3:') || String(body.sha256 || '') !== sha256) {
      throw new Error('Timeweb S3 upload verification failed: HTTP ' + upload.getResponseCode());
    }

    const s3Key = String(body.fileId).slice(3);
    const check = UrlFetchApp.fetch(config.base + '/media/s3/' + encodeURIComponent(s3Key), {
      method: 'get', muteHttpExceptions: true
    });
    if (check.getResponseCode() !== 200 || legacyMediaSha256Hex_(check.getContent()) !== sha256) {
      throw new Error('Timeweb S3 read-back verification failed for ' + String(message.message_key || 'unknown'));
    }

    d1AdminRequest_('/admin/import', 'post', {
      profiles: [], pins: [], messages: [legacyMediaD1Payload_(message, String(body.fileId))]
    });
    migrated.push(String(message.message_key || ''));
  });

  const remaining = getD1RollbackMessages_().filter(function(message) {
    return String(message.type || '') === 'image' && String(message.file_id || '').trim() && !String(message.file_id || '').startsWith('s3:');
  }).length;
  return { ok: true, migrated: migrated.length, migratedKeys: migrated, remaining: remaining };
}

// Run this first. It migrates exactly one attachment and leaves originals untouched.
function migrateNextLegacyMediaToTimewebS3() {
  return migrateLegacyMediaToTimewebS3_(1);
}

// Use only after the single-item smoke test succeeds. Maximum three per run.
function migrateLegacyMediaBatchToTimewebS3() {
  return migrateLegacyMediaToTimewebS3_(3);
}

// Resume every remaining attachment in one bounded Apps Script execution.
// Each item still uploads, reads back, and hash-checks independently.
function migrateAllRemainingLegacyMediaToTimewebS3() {
  return migrateLegacyMediaToTimewebS3_(20);
}

function migrateD1DriveImagesToCloudflare() {
  const workerBase =
    'https://medsi-chat-worker.medsi-children.workers.dev';

  const all = getD1RollbackMessages_();

  const pending = all.filter(m => {
    if (String(m.type || '') !== 'image') return false;

    const fileId = String(m.file_id || '').trim();

    return (
      !!fileId &&
      !fileId.startsWith('kv:') &&
      !fileId.startsWith('r2:')
    );
  });

  if (!pending.length) {
    const result = {
      ok: true,
      migrated: 0,
      remaining: 0,
      message: 'Все D1-изображения уже находятся в Cloudflare.'
    };

    Logger.log(
      'D1 IMAGE MIGRATION ' + JSON.stringify(result)
    );

    return result;
  }

  const batch = pending.slice(0, 6);

  // Сначала проверяем весь текущий batch.
  // До окончания preflight ничего в Cloudflare не записываем.
  const prepared = batch.map(m => {
    const driveId = String(m.file_id || '').trim();

    let file;

    try {
      file = DriveApp.getFileById(driveId);
    } catch (e) {
      throw new Error(
        'IMAGE MIGRATION PREFLIGHT: файл Drive недоступен для ' +
        String(m.message_key || '') +
        ': ' + (e.message || e)
      );
    }

    const blob = file.getBlob();
    const mime = String(blob.getContentType() || '').toLowerCase();
    const bytes = blob.getBytes();

    if (!/^image\//.test(mime)) {
      throw new Error(
        'IMAGE MIGRATION PREFLIGHT: ожидалось изображение, получено ' +
        mime + ' для ' + String(m.message_key || '')
      );
    }

    if (bytes.length > 20 * 1024 * 1024) {
      throw new Error(
        'IMAGE MIGRATION PREFLIGHT: изображение больше 20 МБ: ' +
        String(m.message_key || '')
      );
    }

    return {
      message: m,
      file: file,
      mime: mime,
      bytes: bytes
    };
  });

  const educatorSession = createD1ChatSession_('educator', '');

  if (!educatorSession || !educatorSession.token) {
    throw new Error(
      'IMAGE MIGRATION: не удалось создать educator D1 session.'
    );
  }

  function digest_(bytes) {
    return Utilities.base64Encode(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        bytes
      )
    );
  }

  let migrated = 0;
  const migratedKeys = [];

  prepared.forEach(item => {
    const m = item.message;
    const phone = last10_(m.phone10);

    const upload = UrlFetchApp.fetch(
      workerBase + '/lab/upload',
      {
        method: 'post',
        contentType: item.mime,
        payload: item.bytes,
        muteHttpExceptions: true,
        headers: {
          'X-Medsi-Chat-Session': educatorSession.token,
          'x-medsi-phone': phone,
          'x-file-name': String(
            item.file.getName() || 'image'
          ).slice(0, 180)
        }
      }
    );

    const uploadCode = upload.getResponseCode();

    let uploadBody = {};

    try {
      uploadBody = JSON.parse(
        upload.getContentText() || '{}'
      );
    } catch (_) {}

    if (
      uploadCode < 200 ||
      uploadCode >= 300 ||
      !uploadBody.ok ||
      !String(uploadBody.fileId || '').startsWith('kv:')
    ) {
      throw new Error(
        'IMAGE MIGRATION UPLOAD FAILED ' +
        String(m.message_key || '') +
        ': HTTP ' + uploadCode +
        ' ' + String(upload.getContentText() || '')
      );
    }

    const kvFileId = String(uploadBody.fileId);
    const mediaKey = kvFileId.slice(3);

    // Проверяем бинарник уже из production Cloudflare.
    const check = UrlFetchApp.fetch(
      workerBase + '/media/' + encodeURIComponent(mediaKey),
      {
        method: 'get',
        muteHttpExceptions: true
      }
    );

    if (check.getResponseCode() !== 200) {
      throw new Error(
        'IMAGE MIGRATION VERIFY FAILED ' +
        String(m.message_key || '') +
        ': Cloudflare media HTTP ' +
        check.getResponseCode()
      );
    }

    const sourceHash = digest_(item.bytes);
    const cloudHash = digest_(check.getContent());

    if (sourceHash !== cloudHash) {
      throw new Error(
        'IMAGE MIGRATION VERIFY FAILED: SHA-256 mismatch для ' +
        String(m.message_key || '')
      );
    }

    // Обновляем существующее D1-сообщение.
    // Все остальные значения берём из самого D1.
    d1AdminRequest_('/admin/import', 'post', {
      profiles: [],
      pins: [],
      messages: [{
        messageKey: String(m.message_key || ''),
        phone: phone,
        side: String(m.side || ''),
        type: String(m.type || 'image'),
        text: String(m.text || ''),
        fileId: kvFileId,
        deleteAfter: 0,
        status: String(m.status || 'active'),
        replyToKey: String(m.reply_to_key || ''),
        reaction: String(m.reaction || ''),
        editedAt: Number(m.edited_at || 0),
        createdAt: Number(m.created_at || 0),
        readByParent: !!m.read_by_parent,
        readByEducator: !!m.read_by_educator
      }]
    });

    migrated++;
    migratedKeys.push(String(m.message_key || ''));
  });

  // Контрольное чтение уже после изменений.
  const after = getD1RollbackMessages_();

  const remaining = after.filter(m => {
    if (String(m.type || '') !== 'image') return false;

    const fileId = String(m.file_id || '').trim();

    return (
      !!fileId &&
      !fileId.startsWith('kv:') &&
      !fileId.startsWith('r2:')
    );
  });

  const result = {
    ok: true,
    migrated: migrated,
    migratedKeys: migratedKeys,
    remaining: remaining.length,
    cloudflareImages: after.filter(m =>
      String(m.type || '') === 'image' &&
      (
        String(m.file_id || '').startsWith('kv:') ||
        String(m.file_id || '').startsWith('r2:')
      )
    ).length
  };

  Logger.log(
    'D1 IMAGE MIGRATION ' + JSON.stringify(result)
  );

  return result;
}


/* ===== TEMP MANUAL D1 -> SHEETS ROLLBACK 2026-09-05 =====
   Manual Apps Script editor helpers only.
   Not exposed through getApiMethodMap_().
*/

function manualAuditD1ToSheetsRollback20260905() {
  try {
const d1 = getD1RollbackMessages_();
    const legacy = getLegacyRollbackState_();

    const seen = {};
    const collisions = [];
    const missing = [];

    d1.forEach(m => {
      const k = rollbackLegacyKey_(
        m.phone10,
        m.created_at,
        m.side
      );

      if (seen[k] && seen[k] !== String(m.message_key || '')) {
        collisions.push({
          key: k,
          first: seen[k],
          second: String(m.message_key || '')
        });
      }

      seen[k] = String(m.message_key || '');

      if (!legacy.keys[k]) missing.push(m);
    });

    const missingImages = missing.filter(
      m => String(m.type || '') === 'image'
    );

    const missingVideos = missing.filter(
      m => String(m.type || '') === 'video'
    );

    const kvImages = missingImages.filter(
      m => String(m.file_id || '').startsWith('kv:')
    );

    const kvVideos = missingVideos.filter(
      m => String(m.file_id || '').startsWith('kv:')
    );

    return {
      ok: collisions.length === 0,
      backend: String(
        PropertiesService.getScriptProperties().getProperty('CHAT_BACKEND') || 'sheets'
      ),
      d1Messages: d1.length,
      sheetsMessages: legacy.rows.length,
      missingMessages: missing.length,
      missingImages: missingImages.length,
      missingVideos: missingVideos.length,
      kvImagesToCopyToDrive: kvImages.length,
      kvVideosToCopyToDrive: kvVideos.length,
      collisions: collisions.slice(0, 20)
    };

  } catch (e) {
    return {
      ok: false,
      message: 'Rollback audit failed: ' + (e.message || e)
    };
  }
}

function manualRestoreD1ToSheetsRollback20260905() {
  try {
const audit = manualAuditD1ToSheetsRollback20260905();

    if (!audit || !audit.ok) {
      return {
        ok: false,
        message: 'Аудит rollback не пройден.',
        audit: audit
      };
    }

    // Старый production Sheets UI не поддерживает загруженные video-файлы.
    // Не переключаем backend, если есть хотя бы одно такое новое сообщение.
    if (Number(audit.missingVideos || 0) > 0) {
      return {
        ok: false,
        code: 'ROLLBACK_VIDEO_BLOCK',
        message:
          'Обнаружены новые video-сообщения в D1. ' +
          'Автоматический rollback остановлен, чтобы не потерять видео.',
        audit: audit
      };
    }

    const d1 = getD1RollbackMessages_();
    const legacy = getLegacyRollbackState_();
    const d1ByKey = {};

    d1.forEach(m => {
      d1ByKey[String(m.message_key || '')] = m;
    });

    const missing = d1.filter(m => {
      const k = rollbackLegacyKey_(
        m.phone10,
        m.created_at,
        m.side
      );
      return !legacy.keys[k];
    });

    missing.sort((a, b) => {
      const dt = Number(a.created_at || 0) - Number(b.created_at || 0);
      return dt || String(a.message_key || '').localeCompare(String(b.message_key || ''));
    });

    let restored = 0;
    let restoredImages = 0;

    missing.forEach(m => {
      const type = ['text', 'image', 'video'].includes(String(m.type))
        ? String(m.type)
        : 'text';

      let driveFileId = String(m.file_id || '').trim();
      let deleteAfter = m.delete_after
        ? new Date(Number(m.delete_after))
        : '';

      if (driveFileId.startsWith('kv:')) {
        if (type !== 'image') {
          throw new Error(
            'Неподдерживаемое KV-вложение типа ' + type +
            ': ' + driveFileId
          );
        }

        driveFileId = copyRollbackKvImageToDrive_(m);

        // Старый чат умеет чистить временные изображения сам.
        deleteAfter = new Date(
          Date.now() +
          Number(CHAT_IMAGE_TTL_DAYS || 30) * 86400000
        );

        restoredImages++;
      }

      const replyContext = rollbackReplyContext_(m, d1ByKey);

      legacy.sheet.appendRow([
        new Date(Number(m.created_at || Date.now())),
        last10_(m.phone10),
        String(m.parent_name || ''),
        String(m.child_name || ''),
        String(m.side || ''),
        type,
        String(m.text || ''),
        driveFileId,
        deleteAfter,
        String(m.status || 'active') === 'deleted'
          ? 'deleted'
          : 'active',
        !!m.read_by_parent,
        !!m.read_by_educator,
        normalizeReaction_(m.reaction || ''),
        replyContext
      ]);

      legacy.keys[
        rollbackLegacyKey_(
          m.phone10,
          m.created_at,
          m.side
        )
      ] = true;

      restored++;
    });

    if (restored > 0) {
      rebuildChatIndex_();
      clearGetChatMessagesCache();
      ensureChatCleanupTrigger_();
    }

    const verify = manualAuditD1ToSheetsRollback20260905();

    if (!verify || !verify.ok || Number(verify.missingMessages || 0) !== 0) {
      return {
        ok: false,
        code: 'ROLLBACK_VERIFY_FAILED',
        message:
          'Перенос выполнен не полностью. Backend НЕ переключён.',
        restored: restored,
        restoredImages: restoredImages,
        verify: verify
      };
    }

    if (false) {
      PropertiesService
        .getScriptProperties()
        .setProperty('CHAT_BACKEND', 'sheets');
    }

    return {
      ok: true,
      backend: String(
        PropertiesService
          .getScriptProperties()
          .getProperty('CHAT_BACKEND') || 'sheets'
      ),
      restoredMessages: restored,
      restoredImages: restoredImages,
      verify: verify
    };

  } catch (e) {
    return {
      ok: false,
      message: 'Rollback failed: ' + (e.message || e)
    };
  }
}

function runManualAuditD1ToSheetsRollback20260905() {
  const result = manualAuditD1ToSheetsRollback20260905();
  Logger.log('MANUAL_ROLLBACK_AUDIT ' + JSON.stringify(result));
  return result;
}

function runManualRestoreD1ToSheetsRollback20260905() {
  const result = manualRestoreD1ToSheetsRollback20260905();
  Logger.log('MANUAL_ROLLBACK_RESTORE ' + JSON.stringify(result));
  return result;
}

/* TEMP emergency D1 -> Sheets rollback. Remove after rollback. */

function emergencyAuditD1ToSheetsRollback20260905_() {
  try {
const d1 = getD1RollbackMessages_();
    const legacy = getLegacyRollbackState_();

    const seen = {};
    const collisions = [];
    const missing = [];

    d1.forEach(m => {
      const k = rollbackLegacyKey_(
        m.phone10,
        m.created_at,
        m.side
      );

      if (seen[k] && seen[k] !== String(m.message_key || '')) {
        collisions.push({
          key: k,
          first: seen[k],
          second: String(m.message_key || '')
        });
      }

      seen[k] = String(m.message_key || '');

      if (!legacy.keys[k]) missing.push(m);
    });

    const missingImages = missing.filter(
      m => String(m.type || '') === 'image'
    );

    const missingVideos = missing.filter(
      m => String(m.type || '') === 'video'
    );

    const kvImages = missingImages.filter(
      m => String(m.file_id || '').startsWith('kv:')
    );

    const kvVideos = missingVideos.filter(
      m => String(m.file_id || '').startsWith('kv:')
    );

    return {
      ok: collisions.length === 0,
      backend: String(
        PropertiesService.getScriptProperties().getProperty('CHAT_BACKEND') || 'sheets'
      ),
      d1Messages: d1.length,
      sheetsMessages: legacy.rows.length,
      missingMessages: missing.length,
      missingImages: missingImages.length,
      missingVideos: missingVideos.length,
      kvImagesToCopyToDrive: kvImages.length,
      kvVideosToCopyToDrive: kvVideos.length,
      collisions: collisions.slice(0, 20)
    };

  } catch (e) {
    return {
      ok: false,
      message: 'Rollback audit failed: ' + (e.message || e)
    };
  }
}

function emergencyRollbackToSheets20260905() {
  try {
const audit = emergencyAuditD1ToSheetsRollback20260905_();

    if (!audit || !audit.ok) {
      return {
        ok: false,
        message: 'Аудит rollback не пройден.',
        audit: audit
      };
    }

    // Старый production Sheets UI не поддерживает загруженные video-файлы.
    // Не переключаем backend, если есть хотя бы одно такое новое сообщение.
    if (Number(audit.missingVideos || 0) > 0) {
      return {
        ok: false,
        code: 'ROLLBACK_VIDEO_BLOCK',
        message:
          'Обнаружены новые video-сообщения в D1. ' +
          'Автоматический rollback остановлен, чтобы не потерять видео.',
        audit: audit
      };
    }

    const d1 = getD1RollbackMessages_();
    const legacy = getLegacyRollbackState_();
    const d1ByKey = {};

    d1.forEach(m => {
      d1ByKey[String(m.message_key || '')] = m;
    });

    const missing = d1.filter(m => {
      const k = rollbackLegacyKey_(
        m.phone10,
        m.created_at,
        m.side
      );
      return !legacy.keys[k];
    });

    missing.sort((a, b) => {
      const dt = Number(a.created_at || 0) - Number(b.created_at || 0);
      return dt || String(a.message_key || '').localeCompare(String(b.message_key || ''));
    });

    let restored = 0;
    let restoredImages = 0;

    missing.forEach(m => {
      const type = ['text', 'image', 'video'].includes(String(m.type))
        ? String(m.type)
        : 'text';

      let driveFileId = String(m.file_id || '').trim();
      let deleteAfter = m.delete_after
        ? new Date(Number(m.delete_after))
        : '';

      if (driveFileId.startsWith('kv:')) {
        if (type !== 'image') {
          throw new Error(
            'Неподдерживаемое KV-вложение типа ' + type +
            ': ' + driveFileId
          );
        }

        driveFileId = copyRollbackKvImageToDrive_(m);

        // Старый чат умеет чистить временные изображения сам.
        deleteAfter = new Date(
          Date.now() +
          Number(CHAT_IMAGE_TTL_DAYS || 30) * 86400000
        );

        restoredImages++;
      }

      const replyContext = rollbackReplyContext_(m, d1ByKey);

      legacy.sheet.appendRow([
        new Date(Number(m.created_at || Date.now())),
        last10_(m.phone10),
        String(m.parent_name || ''),
        String(m.child_name || ''),
        String(m.side || ''),
        type,
        String(m.text || ''),
        driveFileId,
        deleteAfter,
        String(m.status || 'active') === 'deleted'
          ? 'deleted'
          : 'active',
        !!m.read_by_parent,
        !!m.read_by_educator,
        normalizeReaction_(m.reaction || ''),
        replyContext
      ]);

      legacy.keys[
        rollbackLegacyKey_(
          m.phone10,
          m.created_at,
          m.side
        )
      ] = true;

      restored++;
    });

    if (restored > 0) {
      rebuildChatIndex_();
      clearGetChatMessagesCache();
      ensureChatCleanupTrigger_();
    }

    const verify = emergencyAuditD1ToSheetsRollback20260905_();

    if (!verify || !verify.ok || Number(verify.missingMessages || 0) !== 0) {
      return {
        ok: false,
        code: 'ROLLBACK_VERIFY_FAILED',
        message:
          'Перенос выполнен не полностью. Backend НЕ переключён.',
        restored: restored,
        restoredImages: restoredImages,
        verify: verify
      };
    }

    if (true) {
      PropertiesService
        .getScriptProperties()
        .setProperty('CHAT_BACKEND', 'sheets');
    }

    Logger.log('EMERGENCY_ROLLBACK_SWITCHING_TO_SHEETS');

    return {
      ok: true,
      backend: String(
        PropertiesService
          .getScriptProperties()
          .getProperty('CHAT_BACKEND') || 'sheets'
      ),
      restoredMessages: restored,
      restoredImages: restoredImages,
      verify: verify
    };

  } catch (e) {
    return {
      ok: false,
      message: 'Rollback failed: ' + (e.message || e)
    };
  }
}
