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
      const previousSnapshot = typeof loadReportsD1ProfilesSnapshot_ === 'function'
        ? (loadReportsD1ProfilesSnapshot_() || reportsD1ProfilesSnapshot_())
        : null;
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
        smartRegisterFromInboxCore_('8' + phone10, item.parent_name, item.child_name, true);
      }
      let reportMaintenance = { ok:true, skipped:true };
      const currentSnapshot = typeof reportsD1ProfilesSnapshot_ === 'function'
        ? reportsD1ProfilesSnapshot_()
        : null;
      if (
        previousSnapshot && currentSnapshot &&
        typeof reportsD1SnapshotsDiffer_ === 'function' &&
        reportsD1SnapshotsDiffer_(previousSnapshot, currentSnapshot) &&
        typeof maintainRawReportsAfterProfilesChangeCore_ === 'function'
      ) {
        reportMaintenance = maintainRawReportsAfterProfilesChangeCore_(previousSnapshot, 'registration');
      }
      // Keep the sheet-diff baseline aligned with the just-materialized row so
      // a subsequent manual deletion is recognized as an explicit revocation.
      // If an infrastructure error prevented report maintenance, keep the old
      // baseline so the scheduled reconciliation can retry the transition.
      if (
        reportMaintenance.ok !== false &&
        currentSnapshot &&
        typeof saveReportsD1ProfilesSnapshot_ === 'function'
      ) {
        saveReportsD1ProfilesSnapshot_(currentSnapshot);
      }
      d1AdminRequest_('/admin/parent-registration-outbox/ack', 'post', { attemptIds: [attemptId] });
      return {
        ok:true,
        synced:true,
        reportMaintenancePending:reportMaintenance.ok === false
      };
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
        smartRegisterFromInboxCore_('8' + phone10, item.parent_name, item.child_name, true);
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
