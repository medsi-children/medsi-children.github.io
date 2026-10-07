/* Active REPORTS -> D1 synchronization and guarded cleanup.
 * Historical import/rollback tools are kept outside the Apps Script bundle in
 * archive/apps-script-legacy/chat-d1-migration-legacy.js.
 */
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
  // Timeweb/D1 is the active chat backend. Registration and chat state are
  // mirrored from REPORTS here without a legacy backend switch.
  ensureReportsD1ProfileSyncTriggers_();
  try { ensureLegacyParentAccessRequestsImported_(); }
  catch (error) { Logger.log('LEGACY_PARENT_ACCESS_IMPORT_DEFERRED ' + String(error && error.message || error)); }
  let registrationSync = { ok:true, synced:0 };
  try { registrationSync = flushCloudflareParentRegistrationOutbox_(); }
  catch (error) {
    registrationSync = { ok:false, message:String(error && error.message || error) };
    Logger.log('CLOUDFLARE_REGISTRATION_OUTBOX_FAILED ' + registrationSync.message);
  }
  const reconciliation = reconcileReportsProfilesToD1_('scheduled');
  reconciliation.registrationSync = registrationSync;
  return reconciliation;
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
      // Keep the display name in `text`, but fingerprint only the report body.
      // A REPORTS name-variant update must not look like a new report to the
      // parent push pipeline.
      reports.push({
        phone:phone,
        kind:kind,
        text:text,
        version:reportContentVersionForD1_(rowsByPhone[phone] || [], kind),
        updatedAt:updatedAt
      });
    });
    if (needsPsychology) {
      reports.push({ phone:phone, kind:'psychology', text:psychologyText, version:reportFingerprint_(psychologyText), updatedAt:updatedAt });
    }
  });
  return reports;
}

function syncD1CurrentReportsToWorker_(kindRaw) {
  const requestedKind = String(kindRaw || '').trim().toLowerCase();
  const reports = snapshotCurrentReportsForD1_(requestedKind);
  const now = Date.now();
  const notificationKind = requestedKind === 'morning' || requestedKind === 'evening' ? requestedKind : '';
  const reportDate = reportHistoryDate_(new Date(now));
  const result = d1AdminRequest_('/admin/report-current', 'post', {
    reports:reports,
    notificationKind:notificationKind,
    reportDate:reportDate,
    notificationEligible: reportNotificationWindowOpen_(notificationKind, new Date(now))
  });
  return { ok:true, reports:reports.length, updated:Number(result.updated || 0) };
}

// Report pushes are intentionally limited to the publication windows shown
// to parents.  This also prevents an accidental manual edit/test at 16:00
// from sending an evening notification.
function reportNotificationWindowOpen_(kindRaw, date) {
  const kind = String(kindRaw || '').trim().toLowerCase();
  if (!['morning', 'evening'].includes(kind)) return false;
  const hour = Number(Utilities.formatDate(date || new Date(), 'Europe/Moscow', 'H'));
  if (kind === 'morning') return hour >= 13 && hour < 17;
  return hour >= 18 && hour < 24;
}

// D1 report versions use a prefix so the Worker can distinguish the new
// content-only fingerprint from the old display-text fingerprint during the
// one-time rollout.  The header is the generated child name, not report data.
function reportContentVersionForD1_(rows, kindRaw) {
  const kind = String(kindRaw || '').trim().toLowerCase();
  const parts = (Array.isArray(rows) ? rows : []).map(function(row) {
    const raw = kind === 'morning' ? row[4] : row[5];
    if (!isActualReportText_(raw)) return '';
    return stripLeadingNameHeader_(String(raw)).trim();
  }).filter(Boolean);
  const fingerprint = reportFingerprint_(parts.join('\n\n'));
  return fingerprint ? 'v2:' + fingerprint : '';
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


function syncReportHistorySourceFingerprintSilently_(kindRaw, textRaw) {
  const kind = String(kindRaw || '').toLowerCase();
  if (!['morning', 'evening'].includes(kind)) return;
  PropertiesService.getScriptProperties().setProperty(
    reportHistoryPublicationKey_(kind, 'SOURCE'),
    reportFingerprint_(textRaw)
  );
}

function reportsD1SnapshotSignature_(snapshotRaw) {
  const snapshot = snapshotRaw || {};
  return Object.keys(snapshot).sort().map(function(phone) {
    const profile = snapshot[phone] || {};
    return [
      phone,
      String(profile.parentName || '').trim().toLowerCase(),
      String(profile.childName || '').trim().toLowerCase(),
      String(profile.reportChildName || '').trim().toLowerCase(),
      String(profile.familyName || '').trim().toLowerCase()
    ].join('|');
  }).join('~');
}

function reportsD1SnapshotsDiffer_(left, right) {
  return reportsD1SnapshotSignature_(left) !== reportsD1SnapshotSignature_(right);
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
  return !!publication && String(publication.date || '') === String(reportDate || '');
}

function seedReportHistoryPublication_(kind, reportDate) {
  if (readReportHistoryPublication_(kind)) return;
  const sheetName = kind === 'morning' ? SHEET_MORNING : SHEET_EVENING;
  const sheet = getSheet_(sheetName);
  const text = sheet ? (getLatestReport(sheet, 1) || '') : '';
  recordReportHistoryPublication_(kind, text, reportDate);
}

const REPORT_HISTORY_SLOTS_ = {
  morning: [15, 16, 17],
  psychology: [16, 18, 21, 23],
  evening: [20, 21, 22, 23]
};

function reportHistoryKindsForHour_(hourRaw) {
  const hour = Number(hourRaw);
  return Object.keys(REPORT_HISTORY_SLOTS_).filter(function(kind) {
    return REPORT_HISTORY_SLOTS_[kind].indexOf(hour) >= 0;
  });
}

function reportHistorySnapshotKey_(reportDateRaw, hourRaw) {
  const reportDate = String(reportDateRaw || '').trim();
  const hour = Number(hourRaw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !Number.isInteger(hour) || hour < 0 || hour > 23) return '';
  return reportDate + 'T' + String(hour).padStart(2, '0') + ':00';
}

function psychologyHistoryText_() {
  const sheet = getSheet_(SHEET_PSYCHOLOGY);
  return sheet ? String(sheet.getRange(1, 1).getValue() || '').trim() : '';
}

function captureReportHistoryKind_(kindRaw, reportDate, slotHour) {
  const kind = String(kindRaw || '').trim().toLowerCase();
  if (!['morning', 'evening', 'psychology'].includes(kind)) {
    return { ok:false, kind:kind, reportDate:reportDate, message:'Unknown report kind.' };
  }

  const snapshotKey = reportHistorySnapshotKey_(reportDate, slotHour);
  if (!snapshotKey) return { ok:false, kind:kind, reportDate:reportDate, message:'Invalid report snapshot slot.' };

  const snapshots = [];
  const psychologyText = kind === 'psychology' ? psychologyHistoryText_() : '';
  snapshotActiveProfilesForD1_().forEach(function(profile) {
    const phone = last10_(profile.phone);
    let report;
    if (kind === 'psychology') {
      report = { ok:true, hasReport:!!psychologyText, text:psychologyText };
    } else {
      report = buildParentReportSnapshot_(phone, kind);
    }
    if (!phone || !report.ok || !report.hasReport || !String(report.text || '').trim()) return;
    snapshots.push({
      phone: phone,
      kind: kind,
      reportDate: reportDate,
      snapshotKey: snapshotKey,
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

  if (kind !== 'psychology') seedReportHistoryPublication_(kind, reportDate);

  return {
    ok: true,
    kind: kind,
    reportDate: reportDate,
    snapshotKey: snapshotKey,
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

  reportHistoryKindsForHour_(hour).forEach(function(kind) {
    if (kind === 'psychology') {
      captured.push(captureReportHistoryKind_(kind, today, hour));
      return;
    }

    if (reportHistoryPublicationMatches_(kind, today)) {
      captured.push(captureReportHistoryKind_(kind, today, hour));
    } else {
      captured.push({
        ok:true,
        kind:kind,
        reportDate:today,
        snapshotKey:reportHistorySnapshotKey_(today, hour),
        skipped:true,
        reason:'No ' + kind + ' publication for this date.'
      });
    }
  });

  return { ok: true, hour: hour, captured: captured };
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
  const sheet = getDataSheet_();
  const lastRow = sheet ? sheet.getLastRow() : 0;
  const rows = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, 4).getValues()
    : [];

  rows.forEach(function(row) {
    const profile = buildProfileFromReportRow_(row);
    const phone = last10_(profile.phone);
    if (!phone) return;
    snapshot[phone] = {
      phone: phone,
      parentName: String(profile.parentName || '').trim(),
      childName: String(profile.childName || '').trim(),
      // Keep the REPORTS display name and the full family name only in the
      // local lifecycle snapshot.  D1 still receives its existing public
      // profile payload above; these fields let a row-deletion trigger remove
      // exactly "Кирилл Ш.", never another Кирилл, from raw reports.
      reportChildName: String(row[2] || '').trim(),
      familyName: String(row[3] || '').trim()
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
  const removedProfiles = {};
  deletionsPending.forEach(function(phone) { removedProfiles[phone] = previous[phone]; });
  saveReportsD1ProfilesSnapshot_(current);
  const result = {
    ok: true,
    reason: reason || '',
    upserted: upserts.length,
    moved: moves,
    deletionsPending: deletionsPending,
    ambiguous: ambiguous,
    // Used only by the in-process reconciliation below; keep this identity
    // data out of the Apps Script log.
    removedProfiles: removedProfiles,
    previousProfiles: previous
  };
  Logger.log('REPORTS_D1_PROFILE_SYNC ' + JSON.stringify({
    ok: result.ok,
    reason: result.reason,
    upserted: result.upserted,
    moved: result.moved,
    deletionsPending: result.deletionsPending,
    ambiguous: result.ambiguous
  }));
  return result;
}

function reconcileReportsProfilesToD1_(reason) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok:true, skipped:true, message:'Profile sync is already running.' };
  try {
    const sheet = getDataSheet_();
    if (!sheet) throw new Error('Лист REPORTS не найден; удаление профилей остановлено.');
    const previousSnapshot = loadReportsD1ProfilesSnapshot_();
    const current = reportsD1ProfilesSnapshot_();
    let reportMaintenance = { ok:true, skipped:true };
    if (previousSnapshot && reportsD1SnapshotsDiffer_(previousSnapshot, current)) {
      try {
        reportMaintenance = maintainRawReportsAfterProfilesChangeCore_(previousSnapshot, 'reports:' + String(reason || ''));
      } catch (error) {
        reportMaintenance = { ok:false, message:String(error && error.message || error) };
        Logger.log('REPORT_IDENTITY_MAINTENANCE_FAILED ' + reportMaintenance.message);
      }
    }
    const maintenanceFailed = reportMaintenance.ok === false;
    const sync = reconcileReportsProfilesToD1NonDestructive_(reason);
    // The D1 profile upsert may still be safe when raw-report maintenance
    // failed, but the old snapshot must remain pending so the next scheduled
    // pass retries the name/header repair instead of treating it as complete.
    if (maintenanceFailed && previousSnapshot) {
      saveReportsD1ProfilesSnapshot_(previousSnapshot);
      Logger.log('REPORTS_D1_PROFILE_SNAPSHOT_RETRY_PENDING');
    }
    // If staff removed a just-mirrored registration before its outbox ACK
    // completed, cancel that pending create before lifecycle reconciliation.
    const removedPhones = Object.keys(sync.removedProfiles || {});
    if (removedPhones.length) {
      const pending = d1AdminRequest_('/admin/parent-registration-outbox', 'get');
      const removedSet = new Set(removedPhones);
      const cancelled = (pending.registrations || []).filter(function(item) {
        return removedSet.has(last10_(item.phone10));
      }).map(function(item) { return String(item.attempt_id || ''); }).filter(Boolean);
      if (cancelled.length) d1AdminRequest_('/admin/parent-registration-outbox/ack', 'post', { attemptIds:cancelled });
    }
    const inventory = d1AdminRequest_('/admin/profile-phones', 'get');
    const pendingRegistrations = d1AdminRequest_('/admin/parent-registration-outbox', 'get');
    const pendingRegistrationPhones = new Set((pendingRegistrations.registrations || []).map(function(item) {
      return last10_(item.phone10);
    }).filter(Boolean));
    const stale = (Array.isArray(inventory.phones) ? inventory.phones : []).filter(function(phone) {
      const normalized = last10_(phone);
      return !current[normalized] && !pendingRegistrationPhones.has(normalized);
    });
    const deleted = [];
    const failed = [];
    const cleanupErrors = [];
    const rawActiveTargets = Object.keys(current)
      .map(function(phone) { return rawReportChildTargetFromProfileSnapshot_(current[phone]); })
      .filter(Boolean);
    const rawCleanupByPhone = {};

    // Raw report cleanup is independent from the D1 inventory.  This also
    // covers a deletion initiated by the educator panel: that panel closes
    // D1 first, so the following onChange must not skip raw cleanup simply
    // because the profile no longer appears in the Worker inventory.
    Object.keys(sync.removedProfiles || {}).forEach(function(phone) {
      try {
        const rawTarget = rawReportChildTargetFromProfileSnapshot_(sync.removedProfiles[phone]);
        const rawTargets = rawReportTargetsNoLongerActive_([rawTarget], rawActiveTargets);
        if (!rawTargets.length) return;
        rawCleanupByPhone[phone] = applyRawReportCleanup_(
          prepareRawReportCleanupForChildren_(rawTargets, rawActiveTargets.concat(rawTargets))
        );
      } catch (error) {
        cleanupErrors.push('raw reports ' + phone + ': ' + String(error && error.message || error));
      }
    });
    // Limit one pass so an unexpectedly empty sheet cannot erase every chat.
    stale.slice(0, 3).forEach(function(phone) {
      try {
        // A parent may have been registered again while the D1 inventory was read.
        if (getProfileByPhone_(phone)) return;
        const result = deleteD1ProfileWithS3Purge_(phone);
        deleted.push({
          phone:phone,
          purgeComplete:!!(result.purge && result.purge.ok),
          rawReportBlocks:Number(rawCleanupByPhone[phone] && rawCleanupByPhone[phone].removedBlocks || 0)
        });
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
      reportMaintenance:{
        ok:reportMaintenance.ok !== false,
        skipped:!!reportMaintenance.skipped,
        rewritten:Number(reportMaintenance.rewritten || 0),
        recovered:Number(reportMaintenance.recovered || 0),
        redistributed:Number(reportMaintenance.redistributed || 0),
        blocked:Number(reportMaintenance.blocked || 0)
      },
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
  const triggerObjects = ScriptApp.getProjectTriggers();
  const triggerAudit = triggerObjects.map(function(trigger) {
    let source = '', sourceId = '', eventType = '';
    try { source = String(trigger.getTriggerSource() || ''); } catch (_) {}
    try { sourceId = String(trigger.getTriggerSourceId() || ''); } catch (_) {}
    try { eventType = String(trigger.getEventType() || ''); } catch (_) {}
    return {
      handler: trigger.getHandlerFunction(),
      source: source,
      sourceId: sourceId,
      eventType: eventType
    };
  });
  const triggers = triggerAudit.map(function(item) { return item.handler; });
  const counts = {};
  triggers.forEach(function(name) { counts[name] = Number(counts[name] || 0) + 1; });
  const duplicateHandlers = Object.keys(counts).filter(function(name) { return counts[name] > 1; });
  const expectedSpreadsheetId = getSpreadsheetId_();
  const triggerIssues = duplicateHandlers.map(function(name) {
    return 'duplicate:' + name + ':' + counts[name];
  });
  triggerAudit.forEach(function(item) {
    if (['onReportsD1Edit', 'onReportsD1Change'].indexOf(item.handler) >= 0 && item.sourceId && item.sourceId !== expectedSpreadsheetId) {
      triggerIssues.push('wrong-source:' + item.handler);
    }
  });
  return {
    ok:true,
    reportsProfiles:Object.keys(current).length,
    d1Profiles:inventory.phones.length,
    stale:stale,
    legacyInactiveRows:legacyInactiveRows,
    triggerHandlers:triggers,
    triggerAudit:triggerAudit,
    duplicateHandlers:duplicateHandlers,
    triggerIssues:triggerIssues,
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
      processRawReportSourceEdit_(
        sheetName === SHEET_MORNING ? 'morning' : 'evening',
        event.range.getSheet()
      );
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
  const spreadsheetId = getSpreadsheetId_();
  const triggers = ScriptApp.getProjectTriggers();
  ['onReportsD1Edit', 'onReportsD1Change'].forEach(function(handler) {
    const matching = triggers.filter(function(trigger) {
      if (trigger.getHandlerFunction() !== handler) return false;
      try { return String(trigger.getTriggerSourceId() || '') === spreadsheetId; }
      catch (_) { return false; }
    });
    matching.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
    triggers.filter(function(trigger) {
      if (trigger.getHandlerFunction() !== handler) return false;
      return matching.indexOf(trigger) < 0;
    }).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
    if (matching.length) return;
    if (handler === 'onReportsD1Edit') {
      ScriptApp.newTrigger(handler).forSpreadsheet(spreadsheetId).onEdit().create();
    } else {
      ScriptApp.newTrigger(handler).forSpreadsheet(spreadsheetId).onChange().create();
    }
  });
  const syncTriggers = triggers.filter(function(trigger) {
    return trigger.getHandlerFunction() === 'syncD1ProfilesFromReports';
  });
  syncTriggers.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  if (!syncTriggers.length) {
    ScriptApp.newTrigger('syncD1ProfilesFromReports').timeBased().everyMinutes(10).create();
  }
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
