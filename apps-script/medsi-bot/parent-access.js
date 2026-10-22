/** ========= РЕГИСТРАЦИЯ И ВХОД РОДИТЕЛЕЙ ========= **/

function normalizeParentAccessId_(value) {
  const id = String(value || '').trim();
  return /^(reg|auth)_[A-Za-z0-9_-]{16,115}$/.test(id) ? id : '';
}

function cloudflareParentRegistrationRequest_(method, payload) {
  const base = 'https://medsi-chat-worker.medsi-children.workers.dev/lab/parent-registration';
  const options = { method: method, muteHttpExceptions: true };
  let url = base;
  if (method === 'post') {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload || {});
  } else {
    url += '/status?phone=' + encodeURIComponent(String(payload.phone || '')) +
      '&attemptId=' + encodeURIComponent(String(payload.attemptId || ''));
  }
  const response = UrlFetchApp.fetch(url, options);
  let value = {};
  try { value = JSON.parse(response.getContentText() || '{}'); } catch (_) {}
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !value.ok) {
    return { ok:false, message:value.message || 'Не удалось связаться с Cloudflare.' };
  }
  return value;
}

function registerParentInCloudflare_(parentNameRaw, childNameRaw, phoneRaw, attemptIdRaw) {
  const phone = normalizePhone_(phoneRaw);
  const parentName = String(parentNameRaw || '').trim();
  const childName = String(childNameRaw || '').trim();
  const attemptId = normalizeParentAccessId_(attemptIdRaw);
  if (!phone || phone.length < 10 || !parentName || !childName || !attemptId) {
    return { ok:false, message:'Заполните имя родителя, имя ребёнка и корректный телефон.' };
  }
  try {
    return cloudflareParentRegistrationRequest_('post', {
      parentName:parentName, childName:childName, phone:phone, attemptId:attemptId
    });
  } catch (error) {
    return { ok:false, message:'Не удалось связаться с Cloudflare: ' + String(error && error.message || error) };
  }
}

function decodeCloudflareParentSession_(phoneRaw, tokenRaw) {
  const phone10 = last10_(phoneRaw);
  const parts = String(tokenRaw || '').trim().split('.');
  if (!phone10 || parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let secret = String(PropertiesService.getScriptProperties().getProperty('D1_SESSION_SECRET') || '');
  if (!secret) {
    try { secret = getWorkerSharedSecret_(); } catch (_) {}
  }
  if (!secret) return null;
  const expected = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(parts[0], secret)
  ).replace(/=+$/g, '');
  if (!secureTextEqual_(parts[1], expected)) return null;
  try {
    const claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    if (claims.role !== 'parent' || last10_(claims.phone10) !== phone10 || Number(claims.exp) <= Date.now()) return null;
    return claims;
  } catch (_) { return null; }
}

const REPORT_PARENT_GENERATION_COLUMN_ = 9;
const REPORT_PARENT_GENERATION_HEADER_ = 'Поколение профиля (служебный)';
const REPORT_REVOKED_REGISTRATION_CLEANUP_PROPERTY_ = 'REVOKED_PARENT_REGISTRATION_ROWS';

function ensureReportParentGenerationColumn_(sheet) {
  if (!sheet) throw new Error('Лист REPORTS не найден.');
  if (sheet.getMaxColumns() < REPORT_PARENT_GENERATION_COLUMN_) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), REPORT_PARENT_GENERATION_COLUMN_ - sheet.getMaxColumns());
  }
  const header = String(sheet.getRange(1, REPORT_PARENT_GENERATION_COLUMN_).getValue() || '').trim();
  if (header && header !== REPORT_PARENT_GENERATION_HEADER_) {
    throw new Error('REPORTS!I уже занята другим полем; поколение профиля не записано.');
  }
  if (!header) {
    const count = Math.max(0, sheet.getLastRow() - 1);
    const existing = count ? sheet.getRange(2, REPORT_PARENT_GENERATION_COLUMN_, count, 1).getValues() : [];
    if (existing.some(row => String(row[0] || '').trim())) {
      throw new Error('REPORTS!I содержит данные без заголовка; поколение профиля не записано.');
    }
    sheet.getRange(1, REPORT_PARENT_GENERATION_COLUMN_).setValue(REPORT_PARENT_GENERATION_HEADER_);
  }
  try {
    if (!sheet.isColumnHiddenByUser(REPORT_PARENT_GENERATION_COLUMN_)) sheet.hideColumns(REPORT_PARENT_GENERATION_COLUMN_);
  } catch (_) {}
}

function attachParentRegistrationGeneration_(item, attemptId, sheet) {
  const phone = last10_(item && item.phone10);
  const parentFirst = splitNameSmart(item && item.parent_name).first;
  const child = splitNameSmart(item && item.child_name);
  const childKey = reportAdmissionChildKey_(child.first, child.last);
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, REPORT_PARENT_GENERATION_COLUMN_).getValues() : [];
  const matches = [];
  rows.forEach(function(row, index) {
    if (last10_(row[0]) !== phone || normalizeName_(row[1]) !== normalizeName_(parentFirst)) return;
    if (reportAdmissionChildKey_(row[2], row[3]) !== childKey) return;
    matches.push({ row:row, sheetRow:index + 2 });
  });
  if (matches.length !== 1) return false;
  const current = String(matches[0].row[REPORT_PARENT_GENERATION_COLUMN_ - 1] || '').trim();
  if (current && current !== attemptId) return false;
  if (!current) sheet.getRange(matches[0].sheetRow, REPORT_PARENT_GENERATION_COLUMN_).setValue(attemptId);
  return true;
}

function drainRevokedParentRegistrationCleanup_() {
  const props = PropertiesService.getScriptProperties();
  let pending = [];
  try { pending = JSON.parse(props.getProperty(REPORT_REVOKED_REGISTRATION_CLEANUP_PROPERTY_) || '[]'); } catch (_) {}
  pending = Array.isArray(pending) ? pending.map(normalizeParentAccessId_).filter(Boolean) : [];
  if (!pending.length) return { ok:true, removed:0 };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok:true, deferred:true, removed:0 };
  try {
    const sheet = getDataSheet_();
    ensureReportParentGenerationColumn_(sheet);
    const lastRow = sheet.getLastRow();
    const ids = new Set(pending);
    let removed = 0;
    if (lastRow >= 2) {
      const markers = sheet.getRange(2, REPORT_PARENT_GENERATION_COLUMN_, lastRow - 1, 1).getValues();
      for (let index = markers.length - 1; index >= 0; index--) {
        if (!ids.has(String(markers[index][0] || '').trim())) continue;
        sheet.deleteRow(index + 2);
        removed += 1;
      }
    }
    props.deleteProperty(REPORT_REVOKED_REGISTRATION_CLEANUP_PROPERTY_);
    return { ok:true, removed:removed };
  } finally {
    lock.releaseLock();
  }
}

function queueRevokedParentRegistrationCleanup_(attemptIds) {
  const props = PropertiesService.getScriptProperties();
  let current = [];
  try { current = JSON.parse(props.getProperty(REPORT_REVOKED_REGISTRATION_CLEANUP_PROPERTY_) || '[]'); } catch (_) {}
  const merged = Array.from(new Set((Array.isArray(current) ? current : [])
    .concat(attemptIds || []).map(normalizeParentAccessId_).filter(Boolean)));
  if (merged.length) props.setProperty(REPORT_REVOKED_REGISTRATION_CLEANUP_PROPERTY_, JSON.stringify(merged.slice(-100)));
  return drainRevokedParentRegistrationCleanup_();
}

// Materialize a D1-first registration in REPORTS after the parent menu is
// already available. The D1 session restricts the operation to that parent's
// own account; the outbox makes the projection retryable if this call fails.
function mirrorCloudflareParentRegistration(phoneRaw, attemptIdRaw, parentSessionRaw) {
  const phone10 = last10_(phoneRaw);
  const attemptId = normalizeParentAccessId_(attemptIdRaw);
  const claims = decodeCloudflareParentSession_(phone10, parentSessionRaw);
  if (!phone10 || !attemptId || !claims) return { ok: false, message: 'Не удалось подтвердить регистрацию.' };

  try {
    // Cloudflare already owns the durable registration/outbox. A browser
    // request must not wait for the global Apps Script lock or for follow-up
    // Worker calls. Wake the minute trigger; the 10-minute reconciliation is
    // still the safety net if this signal cannot be processed immediately.
    const props = PropertiesService.getScriptProperties();
    props.setProperty('PARENT_REGISTRATION_OUTBOX_REQUEST', Utilities.getUuid());
    if (typeof requestReportsD1ProfileSync_ === 'function') requestReportsD1ProfileSync_();
    return { ok:true, pending:true };
  } catch (e) {
    return { ok:false, pending:true, message:'Профиль сохранён; синхронизация с таблицей продолжится автоматически.' };
  }
}

function flushCloudflareParentRegistrationOutbox_() {
  const cleanup = drainRevokedParentRegistrationCleanup_();
  if (cleanup.deferred) return { ok:true, synced:0, deferred:1, failed:[] };
  const outbox = d1AdminRequest_('/admin/parent-registration-outbox', 'get');
  const acknowledged = [], failed = [];
  let deferred = 0;
  (outbox.registrations || []).forEach(function(item) {
    const phone10 = last10_(item.phone10);
    const attemptId = normalizeParentAccessId_(item.attempt_id);
    if (!phone10 || !attemptId) return;
    const lock = LockService.getScriptLock();
    let acquired = false;
    try {
      // The immediate registration mirror and this scheduled outbox drain can
      // race. Protect only the sheet check-and-append; never hold the global
      // script lock across a Worker request.
      acquired = lock.tryLock(1000);
      if (!acquired) {
        deferred += 1;
        return;
      }
      const sheet = getDataSheet_();
      ensureReportParentGenerationColumn_(sheet);
      const phoneRows = getReportRowsByPhone_(phone10);
      if (!phoneRows.length) {
        smartRegisterFromInboxCore_('8' + phone10, item.parent_name, item.child_name, true, attemptId);
      } else if (!attachParentRegistrationGeneration_(item, attemptId, sheet)) {
        throw new Error('В REPORTS уже есть другая запись для этого номера; регистрацию оставили на повторную сверку.');
      }
      acknowledged.push(attemptId);
    } catch (e) {
      failed.push({ attemptId: attemptId, message: String(e && e.message || e) });
    } finally {
      if (acquired) lock.releaseLock();
    }
  });
  failed.forEach(function(item) {
    try {
      d1AdminRequest_('/admin/parent-registration-outbox/fail', 'post', {
        attemptId: item.attemptId, message: item.message
      });
    } catch (_) {}
  });
  if (acknowledged.length) {
    const result = d1AdminRequest_('/admin/parent-registration-outbox/ack', 'post', { attemptIds: acknowledged });
    if (Array.isArray(result.revokedAttemptIds) && result.revokedAttemptIds.length) {
      queueRevokedParentRegistrationCleanup_(result.revokedAttemptIds);
    }
  }
  return { ok: failed.length === 0, synced: acknowledged.length, deferred: deferred, failed: failed };
}

function getParentRegistrationStatus(phoneRaw, attemptIdRaw) {
  const phone = normalizePhone_(phoneRaw);
  const attemptId = normalizeParentAccessId_(attemptIdRaw);
  if (!phone || !attemptId) return { ok:true, status:'NOT_FOUND' };
  try {
    return cloudflareParentRegistrationRequest_('get', { phone:phone, attemptId:attemptId });
  } catch (e) {
    return { ok:false, message:'Не удалось проверить регистрацию: ' + String(e && e.message || e) };
  }
}

function parentReauthorizationActor_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  const profile = getMedsiContactProfiles_()[phone10];
  if (!profile) return 'Родитель';
  const parent = medsiContactCap_(profile.parentFirst);
  const role = profile.relationship || defaultParentRelationship_(parent);
  const childBase = canonizeChildName_(stripInitialFromName_(profile.childRaw)) || stripInitialFromName_(profile.childRaw);
  const childFull = [childBase, profile.childFamily].filter(Boolean).join(' ');
  const childGenitive = parentChildGenitive_(childFull);
  return childGenitive ? role + ' ' + childGenitive : role + ': ' + parent + ' (ребёнок: ' + childFull + ')';
}

function listPendingParentReauthorizations(tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);
  const value = d1AdminRequest_('/admin/parent-access-requests', 'get');
  const requests = (value.requests || []).map(function(request) {
    const actor = parentReauthorizationActor_(last10_(request.phone));
    return Object.assign({}, request, { actor:actor, text:actor + ' запрашивает повторную авторизацию' });
  });
  return { ok:true, requests:requests };
}

function decideParentReauthorization(requestIdRaw, decisionRaw, tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);
  const decision = String(decisionRaw || '').trim().toUpperCase();
  if (decision !== 'APPROVE' && decision !== 'DENY') return { ok: false, message: 'Неизвестное решение.' };
  try {
    return d1AdminRequest_('/admin/parent-access-requests/decision', 'post', {
      requestId:normalizeParentAccessId_(requestIdRaw), decision:decision
    });
  } catch (e) {
    return { ok: false, message: 'Не удалось сохранить решение: ' + String(e && e.message || e) };
  }
}
