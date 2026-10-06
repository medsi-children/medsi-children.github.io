/** ========= РЕГИСТРАЦИЯ И ПОВТОРНАЯ АВТОРИЗАЦИЯ РОДИТЕЛЕЙ ========= **/
const PARENT_ACCESS_REQUESTS_SHEET_NAME = 'PARENT_ACCESS_REQUESTS';
const PARENT_ACCESS_D1_IMPORT_PROPERTY_ = 'PARENT_ACCESS_D1_IMPORTED_AT';

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

// Materialize a D1-first registration in REPORTS after the parent menu is
// already available. The D1 session restricts the operation to that parent's
// own account; the outbox makes the projection retryable if this call fails.
function mirrorCloudflareParentRegistration(phoneRaw, attemptIdRaw, parentSessionRaw) {
  const phone10 = last10_(phoneRaw);
  const attemptId = normalizeParentAccessId_(attemptIdRaw);
  const claims = decodeCloudflareParentSession_(phone10, parentSessionRaw);
  if (!phone10 || !attemptId || !claims) return { ok: false, message: 'Не удалось подтвердить регистрацию.' };

  try {
    return withChatWriteLock_(function() {
      const outbox = d1AdminRequest_('/admin/parent-registration-outbox', 'get');
      const item = (outbox.registrations || []).find(function(row) {
        return String(row.attempt_id || '') === attemptId && last10_(row.phone10) === phone10;
      });
      if (!item) {
        return getReportRowsByPhone_(phone10).length
          ? { ok: true, alreadySynced: true }
          : { ok: true, pending: true };
      }

      // A row created or deliberately edited by staff wins; never overwrite it
      // with the initial registration form contents.
      if (!getReportRowsByPhone_(phone10).length) {
        smartRegisterFromInboxCore('8' + phone10, item.parent_name, item.child_name, true);
      }
      // Keep the sheet-diff baseline aligned with the just-materialized row so
      // a subsequent manual deletion is recognized as an explicit revocation.
      if (typeof reportsD1ProfilesSnapshot_ === 'function' && typeof saveReportsD1ProfilesSnapshot_ === 'function') {
        saveReportsD1ProfilesSnapshot_(reportsD1ProfilesSnapshot_());
      }
      d1AdminRequest_('/admin/parent-registration-outbox/ack', 'post', { attemptIds: [attemptId] });
      return { ok: true, synced: true };
    });
  } catch (e) {
    try {
      d1AdminRequest_('/admin/parent-registration-outbox/fail', 'post', {
        attemptId: attemptId, message: String(e && e.message || e)
      });
    } catch (_) {}
    return { ok: false, pending: true, message: 'Профиль сохранён; синхронизация с таблицей продолжится автоматически.' };
  }
}

function flushCloudflareParentRegistrationOutbox_() {
  const outbox = d1AdminRequest_('/admin/parent-registration-outbox', 'get');
  const acknowledged = [], failed = [];
  (outbox.registrations || []).forEach(function(item) {
    const phone10 = last10_(item.phone10);
    const attemptId = normalizeParentAccessId_(item.attempt_id);
    if (!phone10 || !attemptId) return;
    try {
      if (!getReportRowsByPhone_(phone10).length) {
        smartRegisterFromInboxCore('8' + phone10, item.parent_name, item.child_name, true);
      }
      acknowledged.push(attemptId);
    } catch (e) {
      failed.push({ attemptId: attemptId, message: String(e && e.message || e) });
      try {
        d1AdminRequest_('/admin/parent-registration-outbox/fail', 'post', {
          attemptId: attemptId, message: String(e && e.message || e)
        });
      } catch (_) {}
    }
  });
  if (acknowledged.length) {
    d1AdminRequest_('/admin/parent-registration-outbox/ack', 'post', { attemptIds: acknowledged });
  }
  return { ok: failed.length === 0, synced: acknowledged.length, failed: failed };
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

function cloudflareParentAccessRequest_(method, path, payload) {
  const base = 'https://medsi-chat-worker.medsi-children.workers.dev';
  const options = { method:method, muteHttpExceptions:true };
  let url = base + path;
  if (method === 'post') {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload || {});
  } else if (path === '/lab/parent-access/status') {
    url += '?phone=' + encodeURIComponent(String(payload.phone || '')) +
      '&requestId=' + encodeURIComponent(String(payload.requestId || ''));
  }
  const response = UrlFetchApp.fetch(url, options);
  let value = {};
  try { value = JSON.parse(response.getContentText() || '{}'); } catch (_) {}
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    return Object.assign({ ok:false }, value, { ok:false });
  }
  return value;
}

function parentAccessTimestamp_(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

// One-time compatibility bridge for requests created before Cloudflare became
// the registration/access store. In particular, an already approved request
// must still complete on the parent's phone after the cutover.
function ensureLegacyParentAccessRequestsImported_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(PARENT_ACCESS_D1_IMPORT_PROPERTY_)) return { ok:true, alreadyImported:true };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (props.getProperty(PARENT_ACCESS_D1_IMPORT_PROPERTY_)) return { ok:true, alreadyImported:true };
    const sheet = getSpreadsheet_().getSheetByName(PARENT_ACCESS_REQUESTS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) {
      props.setProperty(PARENT_ACCESS_D1_IMPORT_PROPERTY_, String(Date.now()));
      return { ok:true, imported:0 };
    }
    const requests = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues().map(function(row) {
      const status = String(row[3] || '').trim().toUpperCase();
      if (!['PENDING','APPROVED'].includes(status)) return null;
      const phone = last10_(row[1]);
      const requestId = normalizeParentAccessId_(row[0]);
      const createdAt = parentAccessTimestamp_(row[4]);
      const updatedAt = parentAccessTimestamp_(row[5]) || createdAt;
      const expiresAt = parentAccessTimestamp_(row[6]);
      if (!phone || !requestId || !createdAt || !expiresAt) return null;
      // D1's access request table requires an active profile. Seed only the
      // matching profile from the existing REPORTS row before importing.
      syncD1ProfileForPhone_(phone);
      return {
        requestId:requestId, phone:'8' + phone,
        code:String(row[2] || '').trim().padStart(4, '0'), status:status,
        createdAt:createdAt, updatedAt:updatedAt, expiresAt:expiresAt,
        decidedAt:parentAccessTimestamp_(row[7]) || null,
        decision:String(row[8] || '').trim().toUpperCase()
      };
    }).filter(Boolean);
    let imported = 0;
    for (let i = 0; i < requests.length; i += 100) {
      const result = d1AdminRequest_('/admin/parent-access-requests/import', 'post', { requests:requests.slice(i, i + 100) });
      imported += Number(result.imported || 0);
      if (Number(result.skipped || 0)) throw new Error('Не все старые запросы на авторизацию удалось перенести. Импорт будет повторён.');
    }
    props.setProperty(PARENT_ACCESS_D1_IMPORT_PROPERTY_, String(Date.now()));
    return { ok:true, imported:imported };
  } finally {
    lock.releaseLock();
  }
}

function parentReauthorizationActor_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  const profile = getMedsiContactProfiles_()[phone10];
  if (!profile) return 'Родитель';
  const parent = medsiContactCap_(profile.parentFirst);
  const parentGender = medsiContactGender_(parent);
  const role = parentGender === 'female' ? 'Мама' : (parentGender === 'male' ? 'Папа' : 'Родитель');
  const childBase = canonizeChildName_(stripInitialFromName_(profile.childRaw)) || stripInitialFromName_(profile.childRaw);
  const childGender = medsiContactGender_(childBase);
  const childName = childGender ? medsiContactGenitiveName_(childBase, childGender) : medsiContactCap_(childBase);
  const familyGender = childGender === 'ambiguous' ? medsiContactFamilyGenderHint_(profile.childFamily) : childGender;
  const family = familyGender ? medsiContactGenitiveFamily_(profile.childFamily, familyGender) : medsiContactCap_(profile.childFamily);
  return [role, childName, family].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || 'Родитель';
}

function requestParentReauthorization(phoneRaw, requestIdRaw) {
  const phone10 = last10_(phoneRaw);
  const requestId = normalizeParentAccessId_(requestIdRaw);
  if (!phone10 || !requestId) return { ok: false, message: 'Проверьте номер телефона.' };
  try {
    ensureLegacyParentAccessRequestsImported_();
    const result = cloudflareParentAccessRequest_('post', '/lab/parent-access/request', {
      phone:'8' + phone10, requestId:requestId
    });
    if (!result || result.ok === false) return result || { ok:false, message:'Не удалось отправить запрос.' };
    // D1 stores the request before push is attempted. A notification failure
    // never loses the pending request; the educator panel polls Cloudflare.
    if (result.created) {
      try {
        const actor = parentReauthorizationActor_(phone10);
        sendPushNotification_('educator', '', {
          title: 'Медси Бот',
          body: actor + ' запрашивает авторизацию в Медси Боте',
          url: '/tutors?reauth=' + encodeURIComponent(requestId),
          tag: 'medsi-parent-reauth-' + requestId
        });
      } catch (_) {
        // The pending request remains visible in the educator panel.
      }
    }
    return result;
  } catch (e) {
    return { ok: false, message: 'Не удалось отправить запрос: ' + String(e && e.message || e) };
  }
}

function getParentReauthorizationStatus(phoneRaw, requestIdRaw) {
  const phone10 = last10_(phoneRaw);
  const requestId = normalizeParentAccessId_(requestIdRaw);
  if (!phone10 || !requestId) return { ok:true, status:'NOT_FOUND' };
  try {
    ensureLegacyParentAccessRequestsImported_();
    return cloudflareParentAccessRequest_('get', '/lab/parent-access/status', { phone:'8' + phone10, requestId:requestId });
  }
  catch (e) { return { ok:false, message:'Не удалось проверить авторизацию: ' + String(e && e.message || e) }; }
}

function listPendingParentReauthorizations(tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);
  ensureLegacyParentAccessRequestsImported_();
  const value = d1AdminRequest_('/admin/parent-access-requests', 'get');
  const requests = (value.requests || []).map(function(request) {
    const actor = parentReauthorizationActor_(last10_(request.phone));
    return Object.assign({}, request, { actor:actor, text:actor + ' запрашивает повторную авторизацию' });
  });
  return { ok:true, requests:requests };
}

function decideParentReauthorization(requestIdRaw, decisionRaw, tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);
  ensureLegacyParentAccessRequestsImported_();
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
