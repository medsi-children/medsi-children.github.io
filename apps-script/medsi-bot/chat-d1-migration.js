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
  return enrichProfilesWithRelationships_(Object.keys(byPhone).map(phone => byPhone[phone]));
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

function reportCurrentD1Fingerprints_(reports, publicationDates) {
  const grouped = { morning:[], evening:[], psychology:[] };
  (Array.isArray(reports) ? reports : []).forEach(function(item) {
    const kind = String(item && item.kind || '').trim().toLowerCase();
    const phone = last10_(item && item.phone);
    if (!phone || !grouped[kind]) return;
    // updatedAt is deliberately excluded: a periodic Sheets distribution must
    // not turn an unchanged report into a fresh D1 write/publication.
    grouped[kind].push([phone, String(item && item.text || ''), String(item && item.version || '')]);
  });
  const fingerprints = {};
  Object.keys(grouped).forEach(function(kind) {
    grouped[kind].sort(function(a, b) { return a[0].localeCompare(b[0]); });
    const hasPublishedText = grouped[kind].some(function(item) { return !!item[1]; });
    // The date advances only on an explicit publication event, not on the
    // background minute sync. Otherwise that sync could consume tomorrow's
    // fingerprint before the actual report arrives.
    const publicationDate = kind !== 'psychology' && hasPublishedText
      ? String(publicationDates && publicationDates[kind] || '') : '';
    fingerprints[kind] = reportFingerprint_(JSON.stringify([publicationDate, grouped[kind]]));
  });
  return fingerprints;
}

function syncD1CurrentReportsToWorker_(kindRaw, publicationKindRaw, forceRaw) {
  const requestedKind = String(kindRaw || '').trim().toLowerCase();
  const reports = snapshotCurrentReportsForD1_(requestedKind);
  const now = Date.now();
  const reportDate = reportHistoryDate_(new Date(now));
  const properties = PropertiesService.getScriptProperties();
  const publicationDates = {};
  ['morning', 'evening'].forEach(function(kind) {
    publicationDates[kind] = properties.getProperty('REPORT_CURRENT_D1_PUBLICATION_DATE_' + kind.toUpperCase()) || '';
  });
  const requestedPublicationKind = String(publicationKindRaw || '').trim().toLowerCase();
  const hasPublicationText = reports.some(function(item) {
    return item && item.kind === requestedPublicationKind && String(item.text || '').trim();
  });
  const explicitPublication = ['morning', 'evening'].includes(requestedPublicationKind) && hasPublicationText;
  if (explicitPublication) publicationDates[requestedPublicationKind] = reportDate;
  const fingerprints = reportCurrentD1Fingerprints_(reports, publicationDates);
  const kinds = requestedKind && fingerprints[requestedKind] ? [requestedKind] : Object.keys(fingerprints);
  const changedKinds = kinds.filter(function(kind) {
    return properties.getProperty('REPORT_CURRENT_D1_FINGERPRINT_' + kind.toUpperCase()) !== fingerprints[kind];
  });
  if (!changedKinds.length && forceRaw !== true) return { ok:true, reports:reports.length, updated:0, skipped:true, reason:'unchanged' };

  const notificationKind = ['morning', 'evening'].includes(requestedPublicationKind) &&
    explicitPublication && changedKinds.indexOf(requestedPublicationKind) >= 0 ? requestedPublicationKind : '';
  const result = d1AdminRequest_('/admin/report-current', 'post', {
    reports:reports,
    notificationKind:notificationKind,
    reportDate:reportDate,
    notificationEligible: reportNotificationWindowOpen_(notificationKind, new Date(now))
  });
  // Advance only after Worker confirms success, so a failed sync is retried
  // by the next distribution instead of being hidden by a local cache.
  kinds.forEach(function(kind) {
    properties.setProperty('REPORT_CURRENT_D1_FINGERPRINT_' + kind.toUpperCase(), fingerprints[kind]);
  });
  if (explicitPublication) {
    properties.setProperty('REPORT_CURRENT_D1_PUBLICATION_DATE_' + requestedPublicationKind.toUpperCase(), reportDate);
  }
  return { ok:true, reports:reports.length, updated:Number(result.updated || 0), changedKinds:changedKinds };
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
    return syncD1CurrentReportsToWorker_('', '', true);
  } catch (error) {
    Logger.log('REPORT_CURRENT_SYNC_FAILED ' + (error && error.message || error));
    return { ok:false, message:String(error && error.message || error) };
  }
}

function syncD1ProfileForPhone_(phoneRaw) {
  const phone = last10_(phoneRaw);
  const profile = getProfileByPhone_(phone);
  if (!phone || !profile) return { ok:false, message:'Parent is absent from REPORTS.' };
  const enriched = enrichProfilesWithRelationships_([{
    phone:phone, parentName:profile.parentName, childName:profile.childName
  }]);
  return d1AdminRequest_('/admin/reconcile', 'post', {
    profiles:enriched, full:false
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
  enrichProfilesWithRelationships_(Object.keys(snapshot).map(function(phone) { return snapshot[phone]; }));
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

function reconcileReportsProfilesToD1NonDestructive_(reason, deferSnapshot) {
  const previous = loadReportsD1ProfilesSnapshot_();
  const current = reportsD1ProfilesSnapshot_();
  if (!previous) {
    d1AdminRequest_('/admin/reconcile', 'post', { profiles: Object.keys(current).map(function(phone) { return current[phone]; }), full: false });
    if (!deferSnapshot) saveReportsD1ProfilesSnapshot_(current);
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
  if (!deferSnapshot) saveReportsD1ProfilesSnapshot_(current);
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
    movedCount: result.moved.length,
    deletionsPendingCount: result.deletionsPending.length,
    ambiguousCount: result.ambiguous.length
  }));
  return result;
}

function reportsProfileDeletionProtected_(phoneRaw) {
  const phone = last10_(phoneRaw);
  if (!phone) return true;
  if (reportsD1ProfilesSnapshot_()[phone]) return true;
  const pending = d1AdminRequest_('/admin/parent-registration-outbox', 'get');
  return (pending.registrations || []).some(function(item) {
    return last10_(item.phone10) === phone;
  });
}

// Separate request/ack tokens avoid losing an edit arriving while a pass is
// finishing. Never delete the request: a late acknowledgement cannot erase it.
function requestReportsD1ProfileSync_() {
  const token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('REPORTS_D1_SYNC_REQUEST', token);
  return token;
}

function retryPendingReportsD1ProfileSync() {
  const props = PropertiesService.getScriptProperties();
  const requested = props.getProperty('REPORTS_D1_SYNC_REQUEST');
  if (!requested || requested === props.getProperty('REPORTS_D1_SYNC_COMPLETED')) {
    return { ok:true, skipped:true };
  }
  return reconcileReportsProfilesToD1_('pending-retry');
}

function reconcileReportsProfilesToD1_(reason) {
  if (reason !== 'pending-retry') requestReportsD1ProfileSync_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok:true, skipped:true, message:'Profile sync is already running.' };
  let previousSnapshot = null;
  let current = null;
  try {
    const props = PropertiesService.getScriptProperties();
    const requestToken = props.getProperty('REPORTS_D1_SYNC_REQUEST');
    const sheet = getDataSheet_();
    if (!sheet) throw new Error('Лист REPORTS не найден; удаление профилей остановлено.');
    previousSnapshot = loadReportsD1ProfilesSnapshot_();
    current = reportsD1ProfilesSnapshot_();
    const sync = reconcileReportsProfilesToD1NonDestructive_(reason, true);
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

    // Limit one pass so an unexpectedly empty sheet cannot erase every chat.
    stale.slice(0, 3).forEach(function(phone) {
      try {
        // Recheck only REPORTS and unmirrored registrations. A generic profile
        // lookup falls back to D1 and would protect the stale record itself.
        if (reportsProfileDeletionProtected_(phone)) return;
        const result = deleteD1ProfileWithS3Purge_(phone, true);
        deleted.push({
          phone:phone,
          purgeComplete:!!(result.purge && result.purge.ok && !result.purge.deferred),
          rawReportBlocks:Number(rawCleanupByPhone[phone] && rawCleanupByPhone[phone].removedBlocks || 0)
        });
      } catch (error) {
        failed.push({ phone:phone, message:String(error && error.message || error) });
      }
    });
    // Active directory changes reach D1 before slower report/media work.
    // Retain the previous snapshot until maintenance succeeds, so failures
    // can retry identity cleanup even after the D1 profile has disappeared.
    let reportMaintenance = { ok:true, skipped:true };
    if (previousSnapshot && reportsD1SnapshotsDiffer_(previousSnapshot, current)) {
      try {
        reportMaintenance = maintainRawReportsAfterProfilesChangeCore_(previousSnapshot, 'reports:' + String(reason || ''));
      } catch (error) {
        reportMaintenance = { ok:false };
        Logger.log('REPORT_IDENTITY_MAINTENANCE_FAILED');
      }
    }
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
    deleted.forEach(function(item) {
      item.rawReportBlocks = Number(rawCleanupByPhone[item.phone] && rawCleanupByPhone[item.phone].removedBlocks || 0);
    });
    deleted.forEach(function(item) {
      const phone = item.phone;
      [
        ['inactivity', removeReportInactivityState_],
        ['contact', removeMedsiParentContactBestEffort_]
      ].forEach(function(step) {
        try { step[1](phone); }
        catch (error) { cleanupErrors.push(step[0] + ' ' + phone + ': ' + String(error && error.message || error)); }
      });
    });
    const purge = flushReportsS3PurgeQueue_();
    const result = {
      ok:failed.length === 0 && purge.ok && reportMaintenance.ok !== false && cleanupErrors.length === 0,
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
    if (reportMaintenance.ok !== false && !cleanupErrors.length) {
      saveReportsD1ProfilesSnapshot_(current);
    }
    if (result.ok && stale.length === deleted.length && requestToken) {
      props.setProperty('REPORTS_D1_SYNC_COMPLETED', requestToken);
    }
    // Log aggregate diagnostics only, never the embedded profile snapshots.
    Logger.log('REPORTS_D1_PROFILE_LIFECYCLE ' + JSON.stringify({
      ok:result.ok, reason:result.reason, upserted:Number(sync.upserted || sync.profiles || 0),
      staleFound:stale.length, deletedCount:deleted.length, failedCount:failed.length,
      cleanupErrorCount:cleanupErrors.length, reportMaintenance:result.reportMaintenance,
      purgeOk:!!purge.ok,
      retryPending:props.getProperty('REPORTS_D1_SYNC_REQUEST') !== props.getProperty('REPORTS_D1_SYNC_COMPLETED')
    }));
    return result;
  } catch (error) {
    if (previousSnapshot) saveReportsD1ProfilesSnapshot_(previousSnapshot);
    throw error;
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
  // Retired Sheets chat storage is never consulted by lifecycle audits.
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
    legacyInactiveRows:0,
    triggerHandlers:triggers,
    triggerAudit:triggerAudit,
    duplicateHandlers:duplicateHandlers,
    triggerIssues:triggerIssues,
    profileTriggers:triggers.filter(function(name) {
      return ['onReportsD1Edit', 'onReportsD1Change', 'syncD1ProfilesFromReports', 'retryPendingReportsD1ProfileSync'].indexOf(name) >= 0;
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
      saveRawReportPublication_('psychology', event.range.getSheet().getRange(1, 1), text, Date.now());
      recordReportHistoryPublication_('psychology', text);
      syncPsychologyNotificationState_(text);
      syncD1CurrentReportsToWorker_('psychology');
      return;
    }
    if (sheetName !== DATA_SHEET_NAME) return;
    if (event.range.getColumn() === 7 && event.range.getNumColumns() === 1) {
      syncD1ProfilesFromReports_(false);
      return;
    }
    reconcileReportsProfilesToD1_('edit');
  } catch (error) {
    const message = String(error && error.message || error);
    Logger.log('REPORTS_D1_EDIT_SYNC_FAILED ' + message);
    try {
      const range = event && event.range;
      const sheet = range && range.getSheet();
      const sheetName = sheet && sheet.getName();
      if (range && range.getRow() === 1 && range.getColumn() === 1 &&
          (sheetName === SHEET_MORNING || sheetName === SHEET_EVENING)) {
        setRawReportSourceNote_(range, 'Ошибка автоматической обработки отчёта: ' + message + '. Исходный текст сохранён; повторите изменение ячейки после устранения причины.');
      }
    } catch (noteError) {
      Logger.log('REPORTS_D1_EDIT_ERROR_NOTE_FAILED ' + (noteError && noteError.message || noteError));
    }
  }
}

function onReportsD1Change(event) {
  // A cell edit already has a dedicated onEdit handler. Running the broader
  // profile reconciliation for EDIT events holds the global script lock while
  // it calls D1, blocking report publication and distribution.
  if (event && String(event.changeType || '').toUpperCase() === 'EDIT') return;
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

function retireLegacyChatCleanupTriggers_(triggers) {
  const retired = ['cleanupInactiveChatMessages', 'cleanupExpiredChatImages'];
  (triggers || ScriptApp.getProjectTriggers()).forEach(function(trigger) {
    if (retired.indexOf(trigger.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(trigger);
  });
}

function ensureReportsD1ProfileSyncTriggers_() {
  const spreadsheetId = getSpreadsheetId_();
  const triggers = ScriptApp.getProjectTriggers();
  retireLegacyChatCleanupTriggers_(triggers);
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
  const retryTriggers = triggers.filter(function(trigger) {
    return trigger.getHandlerFunction() === 'retryPendingReportsD1ProfileSync';
  });
  retryTriggers.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  if (!retryTriggers.length) {
    ScriptApp.newTrigger('retryPendingReportsD1ProfileSync').timeBased().everyMinutes(1).create();
  }
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
      const keys = Array.isArray(entry.keys) ? entry.keys : [];
      if (keys.length) timewebReportsSyncRequest_('/__sync/purge-s3', { keys:keys });
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

function deleteD1ProfileWithS3Purge_(phoneRaw, deferPurge) {
  const phone = last10_(phoneRaw);
  if (!phone) throw new Error('Не удалось определить номер родителя для D1.');
  // Revoke profile/chat access first. S3 cleanup is a separate retryable
  // queue and must not leave a removed parent active when Timeweb is offline
  // or its purge credentials have not been configured.
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
  const purge = deferPurge ? { ok:true, deferred:true } : flushReportsS3PurgeQueue_();
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
