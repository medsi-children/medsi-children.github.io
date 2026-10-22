/* Report publication markers and D1 snapshot history.
 * These functions share global Apps Script scope with chat-d1-migration.js.
 */
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
  if (!['morning', 'evening', 'psychology'].includes(String(kind || '').toLowerCase())) return;
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
  const changed = !!fingerprint && (explicitPublication === true || (previous !== null && previous !== fingerprint));
  if (changed) {
    recordReportHistoryPublication_(normalizedKind, textRaw);
  }
  return changed;
}

function reportHistoryPublicationMatches_(kind, reportDate, textRaw) {
  const publication = readReportHistoryPublication_(kind);
  if (!publication || String(publication.date || '') !== String(reportDate || '')) return false;
  return textRaw === undefined || String(publication.fingerprint || '') === reportFingerprint_(textRaw);
}

const REPORT_HISTORY_REFRESH_HOURS_ = {
  morning: [15, 16, 17],
  psychology: [16, 18, 21, 23],
  evening: [20, 21, 22, 23]
};

function reportHistoryKindsForHour_(hourRaw) {
  const hour = Number(hourRaw);
  return Object.keys(REPORT_HISTORY_REFRESH_HOURS_).filter(function(kind) {
    return REPORT_HISTORY_REFRESH_HOURS_[kind].indexOf(hour) >= 0;
  });
}

function psychologyHistoryText_() {
  const sheet = getSheet_(SHEET_PSYCHOLOGY);
  return sheet ? String(sheet.getRange(1, 1).getValue() || '').trim() : '';
}

function captureReportHistoryKind_(kindRaw, reportDate) {
  const kind = String(kindRaw || '').trim().toLowerCase();
  if (!['morning', 'evening', 'psychology'].includes(kind)) {
    return { ok:false, kind:kind, reportDate:reportDate, message:'Unknown report kind.' };
  }

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

  return {
    ok: true,
    kind: kind,
    reportDate: reportDate,
    saved: Number(result.saved || 0),
    updated: Number(result.updated || 0),
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
    if (reportHistoryPublicationMatches_(kind, today)) {
      captured.push(captureReportHistoryKind_(kind, today));
    } else {
      captured.push({
        ok:true,
        kind:kind,
        reportDate:today,
        skipped:true,
        reason:'No ' + kind + ' publication for this date.'
      });
    }
  });

  return { ok:true, hour:hour, captured:captured };
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
