/** ========= РЕГИСТРАЦИЯ И ПОВТОРНАЯ АВТОРИЗАЦИЯ РОДИТЕЛЕЙ ========= **/
const PARENT_ACCESS_REQUEST_TTL_MS_ = 2 * 60 * 60 * 1000;

function normalizeParentAccessId_(value) {
  const id = String(value || '').trim();
  return /^(reg|auth)_[A-Za-z0-9_-]{16,115}$/.test(id) ? id : '';
}

// Compatibility path for an older cached form. It now uses the same
// passwordless registration contract and only exists until that form expires.
function registerParentLegacyDuringCutover_(parentNameRaw, childNameRaw, phoneRaw) {
  const phone = normalizePhone_(phoneRaw);
  const parentName = String(parentNameRaw || '').trim();
  const childName = String(childNameRaw || '').trim();
  if (!parentName || !childName || !phone || phone.length < 10) {
    return { ok: false, message: 'Заполните имя родителя, имя ребёнка и корректный телефон.' };
  }
  try {
    return withChatWriteLock_(function() {
      const phone10 = last10_(phone);
      if (isPhoneActiveInReports_(phone10)) return { ok: true, duplicate: true };
      smartRegisterFromInboxCore(phone, parentName, childName);
      const profile = getProfileByPhone_(phone10);
      if (!profile || !profile.phone) throw new Error('Не удалось сохранить профиль родителя.');
      return Object.assign(buildParentBootstrap_(profile, issueParentSession_(phone10)), {
        duplicate: false
      });
    });
  } catch (e) {
    return { ok: false, message: 'Ошибка регистрации: ' + String(e && e.message || e) };
  }
}

function ensureParentRegistrationAttemptsSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(PARENT_REGISTRATION_ATTEMPTS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(PARENT_REGISTRATION_ATTEMPTS_SHEET_NAME);
    sh.getRange(1, 1, 1, 7).setValues([[
      'ATTEMPT_ID', 'PHONE10', 'STATUS', 'PARENT_NAME', 'CHILD_NAME', 'CREATED_AT', 'UPDATED_AT'
    ]]);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

function findParentRegistrationAttempt_(attemptIdRaw) {
  const attemptId = normalizeParentAccessId_(attemptIdRaw);
  if (!attemptId) return null;
  const sh = ensureParentRegistrationAttemptsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const index = ids.findIndex(value => String(value || '').trim() === attemptId);
  if (index < 0) return null;
  const row = index + 2;
  const values = sh.getRange(row, 1, 1, 7).getValues()[0];
  return {
    sh, row,
    attemptId,
    phone10: last10_(values[1]),
    status: String(values[2] || '').trim().toUpperCase(),
    parentName: String(values[3] || '').trim(),
    childName: String(values[4] || '').trim()
  };
}

function createParentRegistrationAttempt_(attemptIdRaw, phoneRaw, parentNameRaw, childNameRaw) {
  const attemptId = normalizeParentAccessId_(attemptIdRaw);
  const existing = findParentRegistrationAttempt_(attemptId);
  if (existing) return existing;
  const sh = ensureParentRegistrationAttemptsSheet_();
  const now = new Date();
  sh.appendRow([
    attemptId,
    last10_(phoneRaw),
    'PENDING',
    String(parentNameRaw || '').trim(),
    String(childNameRaw || '').trim(),
    now,
    now
  ]);
  return findParentRegistrationAttempt_(attemptId);
}

function completeParentRegistrationAttempt_(attemptIdRaw) {
  const attempt = findParentRegistrationAttempt_(attemptIdRaw);
  if (!attempt) return;
  attempt.sh.getRange(attempt.row, 3).setValue('COMPLETED');
  attempt.sh.getRange(attempt.row, 7).setValue(new Date());
}

function parentRegistrationResult_(attempt) {
  const profile = getProfileByPhone_(attempt.phone10);
  if (!profile || !profile.phone) return null;
  return Object.assign(parentAuthorizedProfile_(profile), {
    duplicate: false, registrationAttemptId: attempt.attemptId
  });
}

// Complete entry without waiting for remote unread-message metadata.
// The parent page refreshes that metadata in the background after entry.
function parentAuthorizedProfile_(profile) {
  let d1Session = null;
  try { d1Session = createD1ChatSession_('parent', profile.phone); } catch (_) {}
  return {
    ok: true, phone: profile.phone, parentName: profile.parentName || '',
    childName: profile.childName || '', parentSession: issueParentSession_(profile.phone),
    d1Session: d1Session
  };
}

function recoverParentRegistrationAttempt_(attemptIdRaw, phoneRaw, parentNameRaw, childNameRaw) {
  const attempt = findParentRegistrationAttempt_(attemptIdRaw);
  if (!attempt) return null;
  if (
    attempt.phone10 !== last10_(phoneRaw) ||
    attempt.parentName !== String(parentNameRaw || '').trim() ||
    attempt.childName !== String(childNameRaw || '').trim()
  ) {
    throw new Error('Эта попытка регистрации относится к другим данным. Вернитесь назад и повторите ввод.');
  }
  if (attempt.status === 'COMPLETED') return parentRegistrationResult_(attempt);
  if (isPhoneActiveInReports_(attempt.phone10)) {
    completeParentRegistrationAttempt_(attempt.attemptId);
    return parentRegistrationResult_(attempt);
  }
  return null;
}

function getParentRegistrationStatus(phoneRaw, attemptIdRaw) {
  try {
    return withChatWriteLock_(function() {
      const attempt = findParentRegistrationAttempt_(attemptIdRaw);
      if (!attempt || attempt.phone10 !== last10_(phoneRaw)) return { ok: true, status: 'NOT_FOUND' };
      if (attempt.status === 'COMPLETED' || isPhoneActiveInReports_(attempt.phone10)) {
        if (attempt.status !== 'COMPLETED') completeParentRegistrationAttempt_(attempt.attemptId);
        const result = parentRegistrationResult_(attempt);
        return result || { ok: true, status: 'PROCESSING' };
      }
      return { ok: true, status: 'PROCESSING' };
    });
  } catch (e) {
    return { ok: false, message: 'Не удалось проверить регистрацию: ' + String(e && e.message || e) };
  }
}

function ensureParentAccessRequestsSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(PARENT_ACCESS_REQUESTS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(PARENT_ACCESS_REQUESTS_SHEET_NAME);
    sh.getRange(1, 1, 1, 9).setValues([[
      'REQUEST_ID', 'PHONE10', 'CODE', 'STATUS', 'CREATED_AT', 'UPDATED_AT', 'EXPIRES_AT', 'DECIDED_AT', 'DECISION'
    ]]);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

function findParentAccessRequest_(requestIdRaw) {
  const requestId = normalizeParentAccessId_(requestIdRaw);
  if (!requestId) return null;
  const sh = ensureParentAccessRequestsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const index = ids.findIndex(value => String(value || '').trim() === requestId);
  if (index < 0) return null;
  const row = index + 2;
  const values = sh.getRange(row, 1, 1, 9).getValues()[0];
  const request = {
    sh, row,
    requestId,
    phone10: last10_(values[1]),
    code: String(values[2] || '').padStart(4, '0'),
    status: String(values[3] || '').trim().toUpperCase(),
    createdAt: values[4] instanceof Date ? values[4] : new Date(values[4]),
    updatedAt: values[5] instanceof Date ? values[5] : new Date(values[5]),
    expiresAt: values[6] instanceof Date ? values[6] : new Date(values[6]),
    decision: String(values[8] || '').trim().toUpperCase()
  };
  if (request.status === 'PENDING' && request.expiresAt.getTime() <= Date.now()) {
    request.status = 'EXPIRED';
    sh.getRange(row, 4).setValue('EXPIRED');
    sh.getRange(row, 6).setValue(new Date());
  }
  return request;
}

function parentAccessRequestClientValue_(request) {
  return {
    ok: true,
    requestId: request.requestId,
    code: request.code,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt.toISOString()
  };
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
  if (!isPhoneActiveInReports_(phone10)) return { ok: false, code: 'NOT_FOUND', message: 'Этот номер не найден среди активных родителей.' };
  try {
    let created = false;
    const request = withChatWriteLock_(function() {
      const existing = findParentAccessRequest_(requestId);
      if (existing) {
        if (existing.phone10 !== phone10) throw new Error('Запрос относится к другому номеру телефона.');
        return existing;
      }
      const sh = ensureParentAccessRequestsSheet_();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + PARENT_ACCESS_REQUEST_TTL_MS_);
      const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, requestId + '|' + phone10);
      const code = String((((bytes[0] & 255) * 256) + (bytes[1] & 255)) % 10000).padStart(4, '0');
      sh.appendRow([requestId, phone10, code, 'PENDING', now, now, expiresAt, '', '']);
      created = true;
      return findParentAccessRequest_(requestId);
    });
    // Push is only a delivery hint.  The request is already safely queued in
    // Sheets, so a disabled worker or browser notification must never block
    // the parent authorization flow.  Keep the notification free of PII.
    if (created) {
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
    return parentAccessRequestClientValue_(request);
  } catch (e) {
    return { ok: false, message: 'Не удалось отправить запрос: ' + String(e && e.message || e) };
  }
}

function getParentReauthorizationStatus(phoneRaw, requestIdRaw) {
  const phone10 = last10_(phoneRaw);
  try {
    return withChatWriteLock_(function() {
      const request = findParentAccessRequest_(requestIdRaw);
      if (!request || request.phone10 !== phone10) return { ok: true, status: 'NOT_FOUND' };
      if ((request.status === 'APPROVED' || request.status === 'CONSUMED') && isPhoneActiveInReports_(phone10)) {
        const profile = getProfileByPhone_(phone10);
        if (!profile) return { ok: false, message: 'Профиль родителя больше не активен.' };
        if (request.status !== 'CONSUMED') {
          request.sh.getRange(request.row, 4).setValue('CONSUMED');
          request.sh.getRange(request.row, 6).setValue(new Date());
        }
        return Object.assign(
          parentAuthorizedProfile_(profile),
          { status: 'APPROVED', requestId: request.requestId }
        );
      }
      return parentAccessRequestClientValue_(request);
    });
  } catch (e) {
    return { ok: false, message: 'Не удалось проверить авторизацию: ' + String(e && e.message || e) };
  }
}

function listPendingParentReauthorizations(tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);
  const sh = ensureParentAccessRequestsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, requests: [] };
  const rows = sh.getRange(2, 1, lastRow - 1, 9).getValues();
  const requests = [];
  rows.forEach(function(values, index) {
    if (String(values[3] || '').trim().toUpperCase() !== 'PENDING') return;
    const expiresAt = values[6] instanceof Date ? values[6] : new Date(values[6]);
    if (!(expiresAt.getTime() > Date.now())) {
      sh.getRange(index + 2, 4).setValue('EXPIRED');
      sh.getRange(index + 2, 6).setValue(new Date());
      return;
    }
    const phone10 = last10_(values[1]);
    const actor = parentReauthorizationActor_(phone10);
    requests.push({
      requestId: String(values[0] || '').trim(),
      phone: '8' + phone10,
      code: String(values[2] || '').padStart(4, '0'),
      actor: actor,
      text: actor + ' запрашивает повторную авторизацию',
      createdAt: (values[4] instanceof Date ? values[4] : new Date(values[4])).toISOString(),
      expiresAt: expiresAt.toISOString()
    });
  });
  requests.sort(function(a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
  return { ok: true, requests: requests };
}

function decideParentReauthorization(requestIdRaw, decisionRaw, tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);
  const decision = String(decisionRaw || '').trim().toUpperCase();
  if (decision !== 'APPROVE' && decision !== 'DENY') return { ok: false, message: 'Неизвестное решение.' };
  let changed = false;
  try {
    const request = withChatWriteLock_(function() {
      const found = findParentAccessRequest_(requestIdRaw);
      if (!found) throw new Error('Запрос уже недоступен.');
      if (found.status !== 'PENDING') return found;
      const now = new Date();
      found.status = decision === 'APPROVE' ? 'APPROVED' : 'DENIED';
      found.sh.getRange(found.row, 4).setValue(found.status);
      found.sh.getRange(found.row, 6).setValue(now);
      found.sh.getRange(found.row, 8).setValue(now);
      found.sh.getRange(found.row, 9).setValue(decision);
      changed = true;
      return found;
    });
    return { ok: true, status: request.status, alreadyResolved: !changed };
  } catch (e) {
    return { ok: false, message: 'Не удалось сохранить решение: ' + String(e && e.message || e) };
  }
}
