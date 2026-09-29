/** ========= НАСТРОЙКИ ========= **/
const SPREADSHEET_ID_PROPERTY = 'MEDSI_SPREADSHEET_ID';
const DATA_SHEET_NAME         = 'REPORTS';

const SHEET_MORNING           = 'MORNING';
const SHEET_EVENING           = 'EVENING';
const SHEET_PSYCHOLOGY        = 'PSYCHOLOGY';
const DATABASE_SHEET_NAME     = 'DATABASE';
const CHAT_SHEET_NAME         = 'CHAT_MESSAGES';
const CHAT_INDEX_SHEET_NAME   = 'CHAT_INDEX';
const CHAT_PINS_SHEET_NAME    = 'CHAT_PINS';
const REPORT_STATE_SHEET_NAME = 'REPORT_NOTIFICATION_STATE';
const REPORT_INACTIVITY_STATE_SHEET_NAME = 'REPORT_INACTIVITY_STATE';
const PUSH_SUBSCRIPTIONS_SHEET_NAME = 'PUSH_SUBSCRIPTIONS';
const PARENT_REGISTRATION_ATTEMPTS_SHEET_NAME = 'PARENT_REGISTRATION_ATTEMPTS';
const PARENT_ACCESS_REQUESTS_SHEET_NAME = 'PARENT_ACCESS_REQUESTS';
const PARENT_AUTH_SECRET_PROPERTY = 'PARENT_AUTH_SECRET';
const CHAT_PHOTOS_FOLDER_NAME = 'MEDSI_CHAT_PHOTOS';
const CHAT_IMAGE_TTL_DAYS     = 30;
const PUSH_WORKER_URL_FALLBACK = 'https://medsi-push-worker.medsi-children.workers.dev/notify';
const PUSH_WORKER_SECRET_PROPERTY = 'MEDSI_CHAT_PUSH_SECRET';
// With ~15–20 kids and ~15–20 messages each, 350 is usually enough and faster.
const CHAT_SCAN_LIMIT         = 350;
const CHAT_THREAD_INITIAL_LIMIT = 30;
const CHAT_THREAD_OLDER_LIMIT   = 50;

/** ========= БАЗОВЫЕ HELPERS ========= **/
function getRequiredScriptProperty_(propertyName) {
  const value = String(PropertiesService.getScriptProperties().getProperty(propertyName) || '').trim();
  if (!value) throw new Error('Не настроено обязательное свойство скрипта: ' + propertyName);
  return value;
}

function getSpreadsheetId_() {
  return getRequiredScriptProperty_(SPREADSHEET_ID_PROPERTY);
}

function getWorkerSharedSecret_() {
  return getRequiredScriptProperty_(PUSH_WORKER_SECRET_PROPERTY);
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getSpreadsheetId_());
}

function getSheet_(name) {
  const ss = getSpreadsheet_();
  return ss.getSheetByName(name);
}

function getDataSheet_() {
  return getSheet_(DATA_SHEET_NAME);
}

function getChatSheet_() {
  return getSheet_(CHAT_SHEET_NAME);
}

function buildProfileFromReportRow_(r) {
  const parentName = String(r[1] || '').trim();
  const childC     = String(r[2] || '').trim();
  const famD       = String(r[3] || '').trim();

  const childBase = stripInitialFromName_(childC) || childC;
  const childName = [childBase, famD].filter(Boolean).join(' ').trim();

  return {
    phone: normalizePhone_(r[0]),
    parentName,
    childName
  };
}

function getReportRowsByPhone_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  if (!phone10) return [];

  const sh = getDataSheet_();
  if (!sh) return [];

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const values = sh.getRange(2, 1, lastRow - 1, 8).getValues(); // A:H
  return values.filter(r => last10_(r[0]) === phone10);
}

/** ========= ВЭБ-апп ========= **/
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getChatBackendConfig() {
  return { ok: true, backend: String(PropertiesService.getScriptProperties().getProperty('CHAT_BACKEND') || 'sheets') };
}

function getD1ChatSession(roleRaw, phoneRaw, tutorTokenRaw) {
  const role = String(roleRaw || '').trim().toLowerCase();
  const phone10 = last10_(phoneRaw);

  if (role === 'educator') {
    requireTutorSession_(tutorTokenRaw);
  } else if (role === 'parent') {
    if (!phone10 || !isPhoneActiveInReports_(phone10)) {
      throw new Error('Чат недоступен.');
    }

    requireParentAccess_(phone10, tutorTokenRaw);

    // Profile refresh is best-effort. An already active parent must still
    // receive a D1 session if the administrative reconcile is temporarily down.
    if (
      String(
        PropertiesService.getScriptProperties().getProperty('CHAT_BACKEND') || 'sheets'
      ) === 'd1'
    ) {
      try {
        syncD1ProfileForPhone_(phone10);
      } catch (e) {
        Logger.log(
          'D1 profile refresh failed for ' +
          phone10 + ': ' +
          String(e && e.message || e)
        );
      }
    }
  } else {
    throw new Error('Некорректная роль.');
  }

  return createD1ChatSession_(role, phone10);
}

// Android fallback for the educator chat list.  This is deliberately a
// server-to-server proxy to the same Cloudflare D1 Worker, never a read from
// the legacy Messages / Chat index sheets.  It is used only when a device's
// WebView cannot reach workers.dev directly.
function listD1ChatsForEducator(tutorTokenRaw, bucketRaw) {
  requireTutorSession_(tutorTokenRaw);
  const bucket = String(bucketRaw || 'all').trim().toLowerCase();
  if (!['all', 'unread', 'read'].includes(bucket)) throw new Error('Некорректная группа чатов.');
  const session = createD1ChatSession_('educator', '');
  const response = UrlFetchApp.fetch(
    'https://medsi-chat-worker.medsi-children.workers.dev/lab/chats?bucket=' + encodeURIComponent(bucket),
    {
      method: 'get',
      muteHttpExceptions: true,
      headers: { 'X-Medsi-Chat-Session': session.token }
    }
  );
  const value = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !value.ok) {
    throw new Error(value.message || 'Не удалось получить список чатов из Cloudflare.');
  }
  return value;
}

// Fallback exclusively for the educator panel on browsers that leave a
// direct cross-origin Worker thread request pending.  This reads the same D1
// Worker endpoint as the normal fast path; it does not access Messages or
// Chat index in Google Sheets.
function getD1ThreadForEducator(phoneRaw, tutorTokenRaw, beforeKeyRaw, limitRaw) {
  requireTutorSession_(tutorTokenRaw);
  const phone = last10_(phoneRaw);
  if (!phone) throw new Error('Некорректный номер чата.');
  const beforeKey = String(beforeKeyRaw || '').trim();
  const requestedLimit = Number(limitRaw) || 50;
  const limit = Math.max(1, Math.min(150, requestedLimit));
  const session = createD1ChatSession_('educator', '');
  const response = UrlFetchApp.fetch(
    'https://medsi-chat-worker.medsi-children.workers.dev/lab/threads/' + encodeURIComponent(phone) +
      '?before=' + encodeURIComponent(beforeKey) + '&limit=' + encodeURIComponent(limit),
    {
      method: 'get',
      muteHttpExceptions: true,
      headers: { 'X-Medsi-Chat-Session': session.token }
    }
  );
  const value = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !value.ok) {
    throw new Error(value.message || 'Не удалось получить историю чата из Cloudflare.');
  }
  return value;
}


function getD1MediaForEducator(fileIdRaw, tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);

  const fileId = String(fileIdRaw || '').trim();
  if (!fileId) throw new Error('Некорректный идентификатор вложения.');

  if (!fileId.startsWith('kv:')) {
    throw new Error('Fallback поддерживает только Cloudflare KV-вложения.');
  }

  const key = fileId.slice(3);
  if (!key || key.indexOf('..') !== -1) {
    throw new Error('Некорректный идентификатор вложения.');
  }

  const scheme = 'https';
  const host = 'medsi-chat-worker.medsi-children.workers.dev';
  const mediaUrl = scheme + '://' + host + '/media/' + encodeURIComponent(key);

  const response = UrlFetchApp.fetch(mediaUrl, {
    method: 'get',
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Не удалось получить вложение из Cloudflare. HTTP ' + code);
  }

  const blob = response.getBlob();
  const contentType = String(
    blob.getContentType() ||
    response.getHeaders()['Content-Type'] ||
    'application/octet-stream'
  );

  const bytes = blob.getBytes();

  return {
    ok: true,
    fileId: fileId,
    contentType: contentType,
    size: bytes.length,
    dataUrl: 'data:' + contentType + ';base64,' + Utilities.base64Encode(bytes)
  };
}

function sendD1MessageForEducator(phoneRaw, messageRaw, tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);

  const phone = last10_(phoneRaw);
  if (!phone || !isPhoneActiveInReports_(phone)) {
    return { ok:false, message:'Диалог с родителем был закрыт.' };
  }

  const session = createD1ChatSession_('educator', '');
  const message = messageRaw || {};

  const response = UrlFetchApp.fetch(
    'https://medsi-chat-worker.medsi-children.workers.dev/lab/messages',
    {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: {
        'X-Medsi-Chat-Session': session.token
      },
      payload: JSON.stringify({
        phone: phone,
        side: 'educator',
        type: String(message.type || 'text'),
        text: String(message.text || ''),
        fileId: String(message.fileId || ''),
        replyToKey: String(message.replyToKey || '')
      })
    }
  );

  const value = JSON.parse(response.getContentText() || '{}');

  if (
    response.getResponseCode() < 200 ||
    response.getResponseCode() >= 300 ||
    !value.ok
  ) {
    throw new Error(value.message || 'D1 HTTP ' + response.getResponseCode());
  }

  return value;
}


// Emergency parent fallback for networks that cannot reach workers.dev
// directly. Messages still live exclusively in Cloudflare D1.
function getD1ThreadForParent(phoneRaw, beforeKeyRaw, limitRaw) {
  const phone = last10_(phoneRaw);
  if (!phone || !isPhoneActiveInReports_(phone)) {
    throw new Error('Чат недоступен.');
  }

  const beforeKey = String(beforeKeyRaw || '').trim();
  const requestedLimit = Number(limitRaw) || 50;
  const limit = Math.max(1, Math.min(150, requestedLimit));
  const session = createD1ChatSession_('parent', phone);
  const chatBase = 'https' + '://' + 'medsi-chat-worker.medsi-children.workers.dev';

  const response = UrlFetchApp.fetch(
    chatBase + '/lab/threads/' + encodeURIComponent(phone) +
      '?before=' + encodeURIComponent(beforeKey) +
      '&limit=' + encodeURIComponent(limit),
    {
      method: 'get',
      muteHttpExceptions: true,
      headers: { 'X-Medsi-Chat-Session': session.token }
    }
  );

  const value = JSON.parse(response.getContentText() || '{}');
  if (
    response.getResponseCode() < 200 ||
    response.getResponseCode() >= 300 ||
    !value.ok
  ) {
    throw new Error(value.message || 'Не удалось получить историю чата из Cloudflare.');
  }

  return value;
}

function sendD1MessageForParent(phoneRaw, messageRaw) {
  const phone = last10_(phoneRaw);
  if (!phone || !isPhoneActiveInReports_(phone)) {
    return { ok:false, code:'CHAT_CLOSED', message:'Чат недоступен.' };
  }

  const session = createD1ChatSession_('parent', phone);
  const message = messageRaw || {};
  const chatBase = 'https' + '://' + 'medsi-chat-worker.medsi-children.workers.dev';

  const response = UrlFetchApp.fetch(
    chatBase + '/lab/messages',
    {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { 'X-Medsi-Chat-Session': session.token },
      payload: JSON.stringify({
        phone: phone,
        side: 'parent',
        type: String(message.type || 'text'),
        text: String(message.text || ''),
        fileId: String(message.fileId || ''),
        replyToKey: String(message.replyToKey || '')
      })
    }
  );

  const value = JSON.parse(response.getContentText() || '{}');
  if (
    response.getResponseCode() < 200 ||
    response.getResponseCode() >= 300 ||
    !value.ok
  ) {
    throw new Error(value.message || 'D1 HTTP ' + response.getResponseCode());
  }

  return value;
}

// Creates only the short-lived Worker token.  All access checks remain in the
// public entry points above; this helper also lets a successful tutor login
// piggyback the D1 session on the same Apps Script response.
function createD1ChatSession_(role, phoneRaw) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('D1_SESSION_SECRET') || getWorkerSharedSecret_() || '');
  if (!secret) throw new Error('Сессии D1 не настроены.');

  const phone10 = role === 'parent' ? last10_(phoneRaw) : '';
  if (role === 'parent' && !phone10) {
    throw new Error('Некорректный номер родительской D1-сессии.');
  }

  // Educators should be able to open the panel for years without a renewal
  // request. Parent identity is always canonical PHONE10.
  const sessionDays = role === 'educator' ? 5 * 365 : 30;
  const exp = Date.now() + sessionDays * 24 * 60 * 60 * 1000;
  const payload = Utilities.base64EncodeWebSafe(
    JSON.stringify({ role:role, phone10:phone10, exp:exp })
  ).replace(/=+$/g, '');
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, secret)
  ).replace(/=+$/g, '');

  return { ok:true, token:payload + '.' + signature, expiresAt:exp };
}

function retiredLegacyUiPage_() {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Старая панель больше не используется</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7fbfc;color:#11424a;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;text-align:center"><main><h1 style="margin:0 0 12px">Эта старая страница больше не используется</h1><p style="margin:0;color:#5f7f86">Откройте Медси Бот по привычной ссылке. Серверные функции Apps Script продолжают работать.</p></main></body></html>'
  ).setTitle('Старая панель больше не используется');
}

function doGet(e) {
  if (e && e.parameter && e.parameter.debugPush === '1') {
    const debugResult = sendPushDebugEvent_({
      role: 'appscript-debug',
      phone: e.parameter.phone || '',
      title: 'doGet debugPush',
      body: 'AppScript reached Cloudflare from doGet'
    });

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, debugPush: true, debugResult }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const view = (e && e.parameter && String(e.parameter.view || '').toLowerCase()) || '';
  if (view !== 'psychology') return retiredLegacyUiPage_();
  const file = 'psychology';

  const template = HtmlService.createTemplateFromFile(file);
  template.shellMode = (e && e.parameter && String(e.parameter.shellMode || '')) || '';

  return template
    .evaluate()
    .setTitle('Отчёты')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents
      ? String(e.postData.contents || '')
      : '{}';
    const payload = JSON.parse(raw || '{}');
    const action = String(payload.action || '').trim();

    // One narrowly scoped server-to-server migration control. It is protected
    // by the existing private server secret and can never be called by UI code.
    if (action === 'd1Import' || action === 'd1Activate' || action === 'd1Rollback' || action === 'reportHistoryCapture' || action === 'd1ReportCurrentSync' || action === 'd1ProfileReconcile' || action === 'd1ProfileAudit' || action === 'reportQueueProcess') {
      if (String(payload.authorization || '') !== getWorkerSharedSecret_()) {
        return ContentService.createTextOutput(JSON.stringify({ ok:false, message:'Unauthorized' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      let result;
      if (action === 'd1Import') result = importChatHistoryToD1Production();
      else if (action === 'd1Activate') result = activateD1ChatBackend();
      else if (action === 'd1Rollback') result = rollbackD1ChatBackend();
      else if (action === 'd1ReportCurrentSync') result = syncD1CurrentReportsToWorker();
      else if (action === 'd1ProfileReconcile') result = syncD1ProfilesFromReports();
      else if (action === 'd1ProfileAudit') result = auditReportsD1Profiles();
      else if (action === 'reportQueueProcess') result = appendReportFromWorker_(payload.param || {});
      else {
        result = captureScheduledReportHistory();
      }
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'api') {
      return ContentService
        .createTextOutput(JSON.stringify(handleApiRequest_(payload)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, message: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, message: String(err && err.message || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getApiMethodMap_() {
  return {
    verifyTutorAccess,
    verifyTutorSession,
    checkPhoneExists,
    testCheckRegistrationState,
    getParentProfileByPhone,
    getParentBootstrap,
    verifyParentSession,
    getParentRegistrationStatus,
    requestParentReauthorization,
    getParentReauthorizationStatus,
    listPendingParentReauthorizations,
    decideParentReauthorization,
    getD1ChatSession,
    listD1ChatsForEducator,
    getD1ThreadForEducator,
    getD1MediaForEducator,
    sendD1MessageForEducator,
    getD1ThreadForParent,
    sendD1MessageForParent,
    registerParent,
    smartRegisterFromInboxCore,
    getReportFor,
    getPsychologyReportFor,
    appendReport,
    getReportSubmissionStatus,
    testAppendReportToTestSheet,
    testValidateAndWriteReport,
    getReportChildDeletionPreview,
    deleteReportChildByPhone,
    auditD1ToSheetsRollback,
    restoreD1ToSheetsRollback,
    getReportInactivityReminder,
    acknowledgeReportInactivityReminder,
    getParentUnreadState,
    markReportAsRead,
    getAllChatMessages,
    cleanupInactiveChatMessages,
    cleanupExpiredChatImages,
    listParentChats,
    listUnreadParentChats,
    listReadParentChats,
    setEducatorChatPin,
    hasUnreadParentChats,
    getChatMessages,
    getParentChatMessages,
    getOlderParentChatMessages,
    getOlderChatMessages,
    clearGetChatMessagesCache,
    setChatMessageReaction,
    deleteMessage,
    updateMessage,
    sendParentChatMessage,
    sendEducatorChatMessage,
    sendEducatorVideoMessage,
    uploadEducatorChatImage,
    uploadEducatorVideoThumbnail,
    uploadParentChatImage,
    listAvailableParentsForChat,
    deleteChatMessage: deleteMessage,
    editChatMessage: updateMessage,
    markEducatorMessagesAsRead,
    markParentMessagesAsReadByEducator,
    markParentMessagesAsUnreadByEducator,
    getLatestReport,
    splitBlocksByChildren,
    distributeChildReports,
    testDriveAccess,
    testUrlFetchAuthorization,
    testFetchDirect
  };
}

function handleApiRequest_(payload) {
  try {
    const method = String(payload && payload.method || '').trim();
    const args = Array.isArray(payload && payload.args) ? payload.args : [];
    const methods = getApiMethodMap_();
    const fn = methods[method];

    if (!method || typeof fn !== 'function') {
      return {
        ok: false,
        message: 'Unknown API method: ' + method
      };
    }

    return {
      ok: true,
      result: fn.apply(null, args)
    };
  } catch (err) {
    return {
      ok: false,
      message: String(err && err.message || err),
      stack: String(err && err.stack || '')
    };
  }
}

function checkPhoneExists(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  if (!phone10) return { ok: false };

  const sh = getDataSheet_();
  if (!sh) return { ok: false };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false };

  const phones = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const exists = phones.some(p => last10_(p) === phone10);

  return { ok: exists };
}

function getParentAuthSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = String(props.getProperty(PARENT_AUTH_SECRET_PROPERTY) || '');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(PARENT_AUTH_SECRET_PROPERTY, secret);
  }
  return secret;
}

function secureTextEqual_(leftRaw, rightRaw) {
  const left = String(leftRaw || '');
  const right = String(rightRaw || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

// Parent access is granted by registration or educator approval. The signed
// session remains independent of the retired password sheet. Existing signed
// sessions with older claim versions remain valid during the cleanup.
function issueParentSession_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({
    phone10: phone10,
    version: 'v2'
  })).replace(/=+$/g, '');
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, getParentAuthSecret_())
  ).replace(/=+$/g, '');
  return payload + '.' + signature;
}

function isParentSessionValid_(phoneRaw, tokenRaw) {
  const token = String(tokenRaw || '').trim();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const expected = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(parts[0], getParentAuthSecret_())
  ).replace(/=+$/g, '');
  if (!secureTextEqual_(parts[1], expected)) return false;
  try {
    const claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    // Accept old signed claims as well as v2 so existing saved sessions are
    // not logged out merely because the retired password layer was removed.
    return last10_(claims.phone10) === last10_(phoneRaw) && !!String(claims.version || '');
  } catch (_) {
    return false;
  }
}

function requireParentAccess_(phoneRaw, tokenRaw) {
  if (!isParentSessionValid_(phoneRaw, tokenRaw)) {
    throw new Error('Требуется подтверждение повторной авторизации.');
  }
  return { ok: true };
}

function verifyParentSession(phoneRaw, parentSessionRaw) {
  try {
    const phone10 = last10_(phoneRaw);
    if (!phone10 || !isPhoneActiveInReports_(phone10)) return { ok: false, message: 'Чат недоступен.' };
    requireParentAccess_(phone10, parentSessionRaw);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e && e.message || e) };
  }
}

function buildParentBootstrap_(profile, parentSession) {
  const unreadRes = hasUnreadEducatorMessages(profile.phone);
  let d1Session = null;
  try { d1Session = createD1ChatSession_('parent', profile.phone); } catch (e) { Logger.log('D1 session piggyback unavailable: ' + String(e && e.message || e)); }
  return {
    ok: true,
    phone: profile.phone,
    parentName: profile.parentName || '',
    childName: profile.childName || '',
    hasUnread: !!(unreadRes && unreadRes.ok && unreadRes.hasUnread),
    reportUnread: getReportUnreadStatus_(profile.phone),
    parentSession: parentSession || '',
    d1Session: d1Session
  };
}

/**
 * Быстрый профиль по номеру — для фронта, чтобы не тянуть весь список родителей.
 */
function getParentProfileByPhone(phoneRaw, parentSessionRaw) {
  try {
    requireParentAccess_(phoneRaw, parentSessionRaw);
const profile = getProfileByPhone_(phoneRaw);
    if (!profile || !profile.phone) {
      return { ok: false, message: 'Ваш номер не найден в системе.' };
    }

    return {
      ok: true,
      phone: profile.phone,
      parentName: profile.parentName || '',
      childName: profile.childName || ''};
  } catch (e) {
    return { ok: false, message: 'Ошибка загрузки профиля: ' + (e.message || e) };
  }
}

/**
 * Один компактный стартовый запрос:
 * профиль + непрочитанные сообщения.
 */
function getParentBootstrap(phoneRaw, parentSessionRaw) {
  try {
const profile = getProfileByPhone_(phoneRaw);
    if (!profile || !profile.phone) {
      return { ok: false, message: 'Ваш номер не найден в системе.' };
    }

    requireParentAccess_(profile.phone, parentSessionRaw);
    return buildParentBootstrap_(profile, String(parentSessionRaw || ''));
  } catch (e) {
    return { ok: false, message: 'Ошибка стартовой загрузки: ' + (e.message || e) };
  }
}

/** ========= ЗАГРУЗКА СЛОВАРЯ ИМЁН ========= **/
function addNameVariantRow_(dict, canon, canonRaw, variantsRaw) {
  const canonKey = normalizeName_(canonRaw);
  if (!canonKey) return;

  const variants = String(variantsRaw || '')
    .split(',')
    .map(v => normalizeName_(v))
    .filter(Boolean);

  const all = new Set(dict[canonKey] || []);
  all.add(canonKey);
  variants.forEach(v => all.add(v));

  dict[canonKey] = Array.from(all);
  all.forEach(v => { canon[v] = canonKey; });
}

function loadNameEquivalents_() {
  const dict = {};
  const canon = {};
  const sheet = getSheet_('NAME_VARIANTS');
  if (!sheet) {
    Logger.log('⚠️ Лист NAME_VARIANTS не найден');
    return { dict, canon };
  }

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const canonRaw = String(data[i][0] || '');
    const variantsRaw = String(data[i][1] || '');
    addNameVariantRow_(dict, canon, canonRaw, variantsRaw);
  }

  Logger.log(`📖 Загружено ${Object.keys(dict).length} канонических имён`);
  return { dict, canon };
}

const NAME_DATA = loadNameEquivalents_();
const NAME_EQUIVALENTS = NAME_DATA.dict;
const CANON_NAME_MAP   = NAME_DATA.canon;

function canonizeChildName_(fullName) {
  const raw = String(fullName || '').trim();
  if (!raw) return raw;

  const base = stripInitialFromName_(raw);
  const suf  = getSuffixToken_(raw);

  const baseNorm = normalizeName_(base);
  const canonKey = (CANON_NAME_MAP && CANON_NAME_MAP[baseNorm]) ? CANON_NAME_MAP[baseNorm] : baseNorm;

  const prettyCanon = capWord(canonKey || base);
  return suf ? `${prettyCanon} ${suf}` : prettyCanon;
}

function normRu(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function capWord(w) {
  const s = String(w || '');
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function isInNameBase(nameNorm) {
  if (!nameNorm) return false;
  const canonKey = (CANON_NAME_MAP && CANON_NAME_MAP[nameNorm]) ? CANON_NAME_MAP[nameNorm] : nameNorm;
  return !!NAME_EQUIVALENTS && Object.prototype.hasOwnProperty.call(NAME_EQUIVALENTS, canonKey);
}

function isSurnameLike(wordNorm) {
  return /(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкий|цкая|енко|чук|щук|юк|ко|дзе|швили|оглы|кызы|ули|ян|янц|яну|чян)$/.test(wordNorm);
}

/** 🧠 Умный разбор имени и фамилии */
function splitNameSmart(fullNameRaw) {
  const raw = String(fullNameRaw || '').trim();
  if (!raw) return { first: '', last: '' };

  const parts = raw
    .split(/\s+/)
    .map(p => p.replace(/[^А-Яа-яЁёA-Za-z\-]/g, '').trim())
    .filter(Boolean);

  if (parts.length === 1) {
    const first = capWord(parts[0]);
    return { first, last: '' };
  }

  const aRaw = parts[0];
  const bRaw = parts[1];
  const a = normRu(aRaw);
  const b = normRu(bRaw);

  const aInBase = isInNameBase(a);
  const bInBase = isInNameBase(b);
  const aLooksS = isSurnameLike(a);
  const bLooksS = isSurnameLike(b);

  if (aInBase && !bInBase) {
    return { first: capWord(aRaw), last: capWord(bRaw) };
  }

  if (!aInBase && bInBase) {
    return { first: capWord(bRaw), last: capWord(aRaw) };
  }

  if (!aInBase && !bInBase) {
    if (aLooksS && !bLooksS) return { first: capWord(bRaw), last: capWord(aRaw) };
    if (!aLooksS && bLooksS) return { first: capWord(aRaw), last: capWord(bRaw) };
    return { first: capWord(aRaw), last: capWord(bRaw) };
  }

  if (aInBase && bInBase) {
    return { first: capWord(aRaw), last: '' };
  }

  return { first: capWord(aRaw), last: capWord(bRaw) };
}

/** ========= Регистрация родителя ========= **/
function registerParent(parentNameRaw, childNameRaw, phoneRaw, registrationAttemptIdRaw) {
  const phone = normalizePhone_(phoneRaw);
  const parentName = String(parentNameRaw || '').trim();
  const childName  = String(childNameRaw  || '').trim();
  const registrationAttemptId = normalizeParentAccessId_(registrationAttemptIdRaw);
  if (!registrationAttemptId) {
    return registerParentLegacyDuringCutover_(parentNameRaw, childNameRaw, phoneRaw, registrationAttemptIdRaw);
  }
  if (!parentName || !childName || !phone || phone.length < 10) {
    return { ok: false, message: 'Заполните имя родителя, имя ребёнка и корректный телефон.' };
  }

  try {
    return withChatWriteLock_(function() {
      const recovered = recoverParentRegistrationAttempt_(registrationAttemptId, phone, parentName, childName);
      if (recovered) return recovered;
      const sh = getDataSheet_();
      if (!sh) return { ok:false, message:'Лист REPORTS не найден.' };
      const lastRow = sh.getLastRow();
      const data = lastRow > 1
        ? sh.getRange(2, 1, lastRow - 1, 1).getValues().flat()
        : [];
      const phone10 = last10_(phone);
      if (data.some(p => last10_(p) === phone10)) return { ok: true, duplicate: true };

      createParentRegistrationAttempt_(registrationAttemptId, phone10, parentName, childName);
      try {
        smartRegisterFromInboxCore(phone, parentName, childName);
      } catch (registrationError) {
        if (!isPhoneActiveInReports_(phone10)) {
          throw registrationError;
        }
        Logger.log('Registration completed with a secondary sync error: ' + String(registrationError && registrationError.message || registrationError));
      }
      const profile = getProfileByPhone_(phone10);
      if (!profile || !profile.phone) {
        throw new Error('Не удалось сохранить профиль родителя.');
      }
      // Registration must return a chat-ready session together with the
      // account.  The normal registration path already mirrors REPORTS to
      // D1, but that mirror is deliberately best-effort inside the write
      // helper.  Retry it once here so a parent cannot enter the chat during
      // the short propagation window after a successful registration.
      let d1Session = null;
      try {
        syncD1ProfileForPhone_(phone10);
        d1Session = createD1ChatSession_('parent', phone10);
      } catch (d1Error) {
        Logger.log('D1 registration bootstrap deferred: ' + String(d1Error && d1Error.message || d1Error));
      }
      completeParentRegistrationAttempt_(registrationAttemptId);

      return {
        ok: true,
        duplicate: false,
        phone: profile.phone,
        parentName: profile.parentName || parentName,
        childName: profile.childName || childName,
        parentSession: issueParentSession_(phone10),
        d1Session: d1Session,
        registrationAttemptId: registrationAttemptId
      };
    });
  } catch (e) {
    return { ok: false, message: 'Ошибка регистрации: ' + (e.message || e) };
  }
}

function smartRegisterFromInboxCore(phoneRaw, parentNameRaw, childNameRaw) {
  const phone = normalizePhone_(phoneRaw);
  const p = splitNameSmart(parentNameRaw);
  const c = splitNameSmart(childNameRaw);

  const parentFirst = p.first || '';
  const parentLast  = p.last  || '';
  const childFirst  = c.first || '';
  const childLast   = c.last  || '';

  if (!phone || !parentFirst || !childFirst) return;

  const sh = getDataSheet_();
  if (!sh) throw new Error(`Нет листа "${DATA_SHEET_NAME}"`);

  const lastRow = sh.getLastRow();
  const data = lastRow > 1
    ? sh.getRange(2, 1, lastRow - 1, 1).getValues().flat()
    : [];

  const phone10 = last10_(phone);
  if (data.some(p => last10_(p) === phone10)) return;

  const familyForStore = childLast || parentLast || '';

  sh.appendRow([
    phone,
    parentFirst,
    addFamilyInitialToName_(childFirst, familyForStore),
    familyForStore,
    '',
    '',
    '',
    ''
  ]);

  appendToDatabase_(phone, parentFirst, childFirst, familyForStore);

  // Google Contacts не синхронизируем внутри регистрации:
  // полный sync может занимать много секунд и не должен задерживать
  // успешный ответ новому родителю. Для Contacts уже есть часовой trigger.
  // REPORTS остаётся источником истины.
  // D1 зеркалим всегда, даже когда production-чат временно работает через Sheets,
  // чтобы новая GitHub-версия сразу видела зарегистрированного родителя.
  try {
    syncD1ProfileForPhone_(phone);
  } catch (d1Err) {
    Logger.log(
      'D1 profile sync after registration failed for ' +
      last10_(phone) + ': ' +
      String(d1Err && d1Err.message || d1Err)
    );
  }
}


function testCheckRegistrationState(phoneRaw, tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);

  const phone10 = last10_(phoneRaw);
  if (!phone10) {
    return {
      ok: false,
      message: 'Некорректный номер.'
    };
  }

  const reportRows = getReportRowsByPhone_(phone10);

  const db = getDatabaseSheet_();
  let databaseRows = [];

  if (db && db.getLastRow() >= 2) {
    const values = db
      .getRange(2, 1, db.getLastRow() - 1, 4)
      .getValues();

    databaseRows = values.filter(
      row => last10_(row[0]) === phone10
    );
  }

  const reportProfile = reportRows.length
    ? buildProfileFromReportRow_(reportRows[0])
    : null;

  const databaseProfile = databaseRows.length
    ? {
        phone: normalizePhone_(databaseRows[0][0]),
        parentName: String(databaseRows[0][1] || '').trim(),
        childName: String(databaseRows[0][2] || '').trim(),
        family: String(databaseRows[0][3] || '').trim()
      }
    : null;

  return {
    ok: true,
    reportsPresent: reportRows.length > 0,
    databasePresent: databaseRows.length > 0,
    reportProfile: reportProfile,
    databaseProfile: databaseProfile
  };
}

/** ========= НОРМАЛИЗАЦИИ ========= **/
function normalizeFamilyName_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z]/g, '')
    .trim();
}

function compareFamiliesSmart_(fam1, fam2) {
  const n1 = normalizeFamilyName_(fam1);
  const n2 = normalizeFamilyName_(fam2);
  if (!n1 || !n2) return false;

  const minLen = Math.min(5, n1.length, n2.length);
  return n1.slice(0, minLen) === n2.slice(0, minLen);
}

function normalizeName_(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseNameTrimInitial_(s) {
  return String(s || '').trim().replace(/\s+[А-ЯЁ]\.?$/, '').trim();
}

function getAllNameVariantsForBase_(baseRaw) {
  const cleaned = String(baseRaw || '')
    .replace(/❗️|❗|‼️|‼|!+/g, '')
    .trim();

  const base = cleaned;
  const baseNoInit = baseNameTrimInitial_(base);

  const key0 = normalizeName_(baseNoInit);
  const key  = (CANON_NAME_MAP && CANON_NAME_MAP[key0]) ? CANON_NAME_MAP[key0] : key0;

  const eqs = NAME_EQUIVALENTS[key] || [];

  const eqPretty = eqs.map(v => {
    const s = String(v || '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  });

  let suffix = '';
  if (baseNoInit && base.startsWith(baseNoInit)) {
    suffix = base.slice(baseNoInit.length);
  } else {
    const m = base.match(/(\s+[А-ЯЁ][а-яё]{0,9})\s*$/);
    suffix = m ? m[1] : '';
  }

  suffix = String(suffix || '').replace(/\s+/g, ' ');
  if (suffix && !suffix.startsWith(' ')) suffix = ' ' + suffix.trim();
  if (suffix === ' ') suffix = '';

  const out = [];

  function add(v) {
    const s = String(v || '').trim();
    if (s && !out.includes(s)) out.push(s);
  }

  add(base);
  if (baseNoInit && baseNoInit !== base) add(baseNoInit);
  eqPretty.forEach(v => add(v));

  if (suffix) {
    eqPretty.forEach(v => add(v + suffix));
  }

  return out;
}

function last10_(p) {
  const d = String(p || '').replace(/\D+/g, '');
  return d.slice(-10);
}

/** ========= Обработчик onEdit ========= **/
function onEdit(e) {
  try {
    if (!e) return;

    const sh = e.range.getSheet();
    const name = sh.getName();
    const row = e.range.getRow();
    const col = e.range.getColumn();

    // Report-source edits are handled by the installable onReportsD1Edit
    // trigger, which can call Cloudflare and must not be duplicated here.
    if (name === SHEET_MORNING || name === SHEET_EVENING || name === SHEET_PSYCHOLOGY) return;

    if (name === DATA_SHEET_NAME && row >= 2 && col === 1 && e.value) {
      const vals = sh.getRange(row, 1, 1, 4).getValues()[0];
      const phoneRaw = vals[0];
      const parentRaw = vals[1];
      const childRaw = vals[2];
      const famRaw = vals[3];

      const phone = normalizePhone_(phoneRaw);
      const parent = String(parentRaw || '').trim();
      const childC = String(childRaw || '').trim();
      const famD = String(famRaw || '').trim();

      if (!phone || phone.length < 10 || !parent || !childC) return;

      const childBase = stripInitialFromName_(childC) || childC;
      appendToDatabase_(phone, parent, childBase, famD);
      return;
    }

  } catch (err) {
    Logger.log('Ошибка в onEdit: ' + err);
  }
}

function stripLeadingNameHeader_(s) {
  if (!s) return s;

  return String(s)
    .replace(
      /^\s*[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z.\- ]{0,40}(?:\s+[А-ЯЁ])?\s*[:\-–—]\s*/u,
      ''
    )
    .trim();
}

function buildParentReportSnapshot_(phoneRaw, kindRaw, includeMissingRaw, rowsOverride) {
  const phone = onlyDigits_(phoneRaw);
  const kind = String(kindRaw || '').toLowerCase();
  if (!phone || !['morning', 'evening'].includes(kind)) {
    return { ok: false, hasReport: false, text: '' };
  }
  const rows = Array.isArray(rowsOverride) ? rowsOverride : getReportRowsByPhone_(phone);
  if (!rows.length) return { ok: false, hasReport: false, text: '' };
  const reports = [];
  let hasReport = false;
  rows.forEach(function(r) {
    const rawChild = String(r[2] || '');
    const reportText = kind === 'morning' ? r[4] : r[5];
    if (!isActualReportText_(reportText)) {
      if (includeMissingRaw === true) reports.push('Отчёта пока нет. Пожалуйста, попробуйте позже 🙏');
      return;
    }
    hasReport = true;
    const displayName = baseNameTrimInitial_(rawChild);
    const body = stripLeadingNameHeader_(String(reportText));
    const safeBody = body.replace(
      new RegExp(`^\\s*${displayName}\\s+[А-ЯЁ]\\.?\\s*[:\\-–—]\\s*`, 'i'),
      ''
    );
    reports.push(`${displayName}: ${safeBody}`.trim());
  });
  return { ok: true, hasReport: hasReport, text: reports.join('\n\n') };
}

function getReportFor(phoneRaw, kindRaw, parentSessionRaw) {
  try {
    const phone = onlyDigits_(phoneRaw);
    const kind = String(kindRaw || '').toLowerCase();
    if (!phone || !['morning', 'evening'].includes(kind)) {
      return { ok: false, message: 'Некорректные данные запроса.' };
    }
    requireParentAccess_(phone, parentSessionRaw);

    const snapshot = buildParentReportSnapshot_(phone, kind, true);
    if (!snapshot.ok) {
      return { ok: false, message: 'Ваш номер не найден в системе. Пожалуйста, попробуйте позже.' };
    }
    return {
      ok: true,
      text: snapshot.text || 'Отчёта пока нет. Пожалуйста, попробуйте позже 🙏',
      version: getReportVersion_(phone, kind),
      hasReport: snapshot.hasReport
    };

  } catch (err) {
    return { ok: false, message: 'Ошибка: ' + (err.message || err) };
  }
}

function getPsychologyReportFor(phoneRaw, parentSessionRaw) {
  try {
    const phone = onlyDigits_(phoneRaw);
    if (!phone) return { ok: false, message: 'Некорректные данные запроса.' };
    requireParentAccess_(phone, parentSessionRaw);

    const exists = checkPhoneExists(phone).ok;
    if (!exists) {
      return { ok: false, message: 'Ваш номер не найден в системе. Пожалуйста, попробуйте позже.' };
    }

    const sh = getSheet_(SHEET_PSYCHOLOGY);
    if (!sh) return { ok: false, message: 'Лист PSYCHOLOGY не найден.' };

    const text = String(sh.getRange(1, 1).getValue() || '').trim();
    if (!text) {
      return {
        ok: true,
        text: 'Отчёта пока нет. Пожалуйста, попробуйте позже 🙏',
        version: getReportVersion_(phone, 'psychology'),
        hasReport: false
      };
    }

    return { ok: true, text, version: getReportVersion_(phone, 'psychology'), hasReport: true };

  } catch (err) {
    return { ok: false, message: 'Ошибка: ' + (err.message || err) };
  }
}

function cleanIncomingText_(raw) {
  let s = String(raw == null ? '' : raw);

  s = s.replace(/\r\n?/g, '\n');

  s = s
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .replace(/[\u00A0\u202F\u2000-\u200A]/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  s = s
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return s.normalize('NFC');
}

/** ========= appendReport ========= **/
function buildReportValidationChildren_() {
  const dataSheet = getDataSheet_();
  if (!dataSheet) return [];

  const lastRow = dataSheet.getLastRow();
  const count = Math.max(lastRow - 1, 0);
  if (count === 0) return [];

  const rawNames = dataSheet.getRange(2, 3, count, 1).getValues().flat();
  const families = dataSheet.getRange(2, 4, count, 1).getValues().flat();
  const normalizedNames = rawNames.map((name, index) => (
    normalizeReportChildName_(String(name || '').trim(), families[index])
      || String(name || '').trim()
  ));

  return attachPhonesToReportChildren_(
    buildReportChildren_(normalizedNames, families),
    dataSheet,
    count
  );
}

function childDisplayNameForReportError_(child, fallback) {
  return String(
    (child && (child.fullName || child.baseName))
      || fallback
      || ''
  ).trim();
}

function uniqueStrings_(items) {
  const seen = {};
  const out = [];
  (items || []).forEach(item => {
    const value = String(item || '').trim();
    if (!value || seen[value]) return;
    seen[value] = true;
    out.push(value);
  });
  return out;
}

function makeReportFormatError_(message, details) {
  return {
    ok: false,
    code: 'REPORT_FORMAT_ERROR',
    message,
    details: details || {}
  };
}

function getReportHeaderCandidatesForValidation_(text, knownBaseKeys, contextByBase) {
  const clean = cleanReportTextForParsing_(text);
  const candidates = [];
  if (!clean) return { clean, candidates };

  const headerRe = /(^|\n)\s*([^:\-–—\n]+?)\s*(?:\.?\s*([:\-–—]))\s*/g;
  let match;

  while ((match = headerRe.exec(clean)) !== null) {
    const header = getReportHeaderParts_(match[2].trim());
    const isKnownRegistered = !!(knownBaseKeys && knownBaseKeys[header.baseKey]);
    const isKnownName = isInNameBase(normalizeName_(header.baseRaw));
    const probableAliasChildren = (!isKnownRegistered && !isKnownName)
      ? findProbableReportAliasChildren_(header, contextByBase)
      : [];
    const isProbableAlias = probableAliasChildren.length > 0;
    const isUnassignedHeader = (!isKnownRegistered && !isKnownName && !isProbableAlias)
      ? isPotentialUnassignedReportHeader_(header)
      : false;

    if (!header.baseKey || (!isKnownRegistered && !isKnownName && !isProbableAlias && !isUnassignedHeader)) continue;

    const lineStart = match.index + (match[1] ? 1 : 0);
    const lineNumber = clean.slice(0, lineStart).split('\n').length;
    const separator = match[3] === ':' ? 'colon' : 'dash';
    const block = {
      rawName: header.raw,
      baseRaw: header.baseRaw,
      baseKey: header.baseKey,
      suffix: header.suffix,
      suffixKey: header.suffixKey,
      hasSuffix: header.hasSuffix,
      body: '',
      start: match.index,
      headerEnd: headerRe.lastIndex,
      prefix: match[1] || ''
    };
    const resolution = isProbableAlias
      ? makeUnknownReportAliasResolution_(probableAliasChildren)
      : (isUnassignedHeader ? makeUnassignedReportHeaderResolution_() : resolveReportBlock_(block, contextByBase));

    candidates.push({
      rawName: header.raw,
      baseKey: header.baseKey,
      separator,
      start: match.index,
      headerEnd: headerRe.lastIndex,
      lineNumber,
      resolution
    });
  }

  return { clean, candidates };
}

function buildReportLineStartLabels_(children) {
  const labels = [];

  (children || []).forEach(child => {
    if (!child) return;

    const fullName = String(child.fullName || '').trim();
    const baseName = String(child.baseName || stripInitialFromName_(fullName) || '').trim();
    const suffix = String(child.suffix || '').trim();
    const variants = getAllNameVariantsForBase_(baseName || fullName);
    const values = [];

    if (fullName) values.push(fullName);
    if (baseName) values.push(baseName);
    variants.forEach(variant => {
      if (!variant) return;
      values.push(variant);
      if (suffix) values.push(`${variant} ${suffix}`);
    });

    uniqueStrings_(values)
      .sort((a, b) => b.length - a.length)
      .forEach(value => labels.push({
        label: value,
        display: childDisplayNameForReportError_(child, value),
        identityKey: reportChildIdentityKey_(child),
        baseKey: child.baseKey || getNameBaseKey_(baseName || value),
        // В тексте отчёта имя ребёнка нередко повторяется в начале нового
        // абзаца: «Маша рассказала…». Такой абзац не является заголовком
        // следующего блока, если для этой Маши уже найден корректный
        // заголовок выше.
        isBareBaseLabel: !getReportHeaderParts_(value).hasSuffix
      }));
  });

  return labels.sort((a, b) => b.label.length - a.label.length);
}

function hasReportHeaderSeparator_(line) {
  // Если после заголовка уже есть разрешённый разделитель, эта строка не
  // может одновременно считаться строкой «без : или -». Это защищает от
  // ложной ошибки при совпадающих именах и вариантах имён.
  return /^[^:\-–—\n]+?\s*\.?\s*[:\-–—]/.test(String(line || ''));
}

function findMissingReportDelimiters_(cleanText, children, startLineNumber, confirmedHeaderLines) {
  const labels = buildReportLineStartLabels_(children);
  const found = [];
  const seen = {};
  const confirmed = confirmedHeaderLines || {};
  const lines = String(cleanText || '').split('\n');

  for (let i = Math.max(0, (startLineNumber || 1) - 1); i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line) continue;
    if (!/^[А-ЯЁA-Z]/.test(line)) continue;
    if (hasReportHeaderSeparator_(line)) continue;

    for (const item of labels) {
      const label = escapeRegExp_(item.label).replace(/\s+/g, '\\s+');
      const validHeaderForThisNameRe = new RegExp('^' + label + '\\.?\\s*[:\\-–—]', 'i');
      const missingDelimiterRe = new RegExp('^(' + label + ')\\.?(?=$|[\\s,])', 'i');

      if (validHeaderForThisNameRe.test(line)) break;
      const missingMatch = line.match(missingDelimiterRe);
      if (!missingMatch) continue;

      // Имя может встретиться внутри уже корректно найденного блока:
      // «Полина: ...\nПолина переживает...». Это продолжение текста, а не
      // новый отчёт. Пропущенный заголовок другого ребёнка по-прежнему
      // остаётся критической ошибкой.
      const confirmedLine = Number(confirmed[item.identityKey] || 0);
      if (confirmedLine && confirmedLine < i + 1) break;

      // У двух детей может быть одно и то же имя. Например, после блока
      // «Маша У.: …» воспитатель естественно пишет отдельным абзацем
      // «Маша рассказала…». Метка «Маша» принадлежит также второй Маше,
      // поэтому одной проверки по identityKey недостаточно. Если любой
      // ребёнок с тем же базовым именем уже имеет заголовок выше, это
      // продолжение его текста, а не пропущенный разделитель.
      const hasConfirmedBaseAbove = item.isBareBaseLabel && (children || []).some(child => {
        if (!child || child.baseKey !== item.baseKey) return false;
        const childLine = Number(confirmed[reportChildIdentityKey_(child)] || 0);
        return childLine && childLine < i + 1;
      });
      if (hasConfirmedBaseAbove) break;

      // Для подсказки показываем ровно то имя, которое написал воспитатель,
      // а не расширенное имя из таблицы («Полина», а не «Полина Р.»).
      const rawName = String(missingMatch[1] || item.label || '')
        .replace(/\.$/, '')
        .trim();
      if (!seen[rawName]) {
        seen[rawName] = true;
        found.push({ name: rawName, lineNumber: i + 1 });
      }
      break;
    }
  }

  return found;
}

function buildConfirmedReportHeaderLines_(candidates) {
  const lines = {};

  (candidates || []).forEach(item => {
    if (!item || !item.resolution || item.resolution.status !== 'ok') return;
    const targets = (item.resolution.children && item.resolution.children.length)
      ? item.resolution.children
      : (item.resolution.child ? [item.resolution.child] : []);
    const line = Number(item.lineNumber || 0);

    targets.forEach(child => {
      const key = reportChildIdentityKey_(child);
      if (!key || !line) return;
      if (!lines[key] || line < lines[key]) lines[key] = line;
    });
  });

  return lines;
}

function reportAmbiguousNameMessage_(names) {
  return 'Ошибка отправки отчёта. Не получается определить ребёнка: «' +
    names.join('», «') +
    '». В таблице есть несколько подходящих детей. Добавьте инициал или уточните фамилию.';
}

function reportDuplicateBlockMessage_(names) {
  return 'Ошибка отправки отчёта. Для ребёнка «' +
    names.join('», «') +
    '» найдено два блока с разделителем. Проверьте, не попал ли сюда блок для врачей.';
}

function reportMissingDelimiterMessage_(names) {
  if (names.length === 1) {
    return 'Ошибка отправки отчёта. После имени «' + names[0] +
      '» не вижу «:» или тире. Поставьте разделитель, иначе текст может попасть в отчёт предыдущего ребёнка.';
  }

  return 'Ошибка отправки отчёта. После имён «' + names.join('», «') +
    '» не вижу «:» или тире. Поставьте разделители, иначе текст может попасть в отчёт предыдущего ребёнка.';
}

function validateChildReportFormat_(reportType, text) {
  const children = buildReportValidationChildren_();
  const knownBaseKeys = buildKnownBaseKeys_(children);
  const contextByBase = buildDistributionContext_(children, []);
  const parsed = getReportHeaderCandidatesForValidation_(text, knownBaseKeys, contextByBase);
  const candidates = parsed.candidates || [];
  const okCandidates = candidates.filter(item => item.resolution && item.resolution.status === 'ok');

  if (okCandidates.length === 0) {
    const ambiguous = candidates.filter(item => item.resolution && item.resolution.status === 'ambiguous');
    if (ambiguous.length) {
      const names = uniqueStrings_(ambiguous.map(item => item.rawName)).slice(0, 8);
      return makeReportFormatError_(
        reportAmbiguousNameMessage_(names),
        { ambiguousNames: names }
      );
    }

    if (candidates.length > 0) {
      return {
        ok: true,
        reportType,
        checkedBlocks: 0,
        skippedBlocks: candidates.length
      };
    }

    return makeReportFormatError_(
      'Ошибка отправки отчёта. Не найдено ни одного блока в формате “Имя: текст” или “Имя - текст”.',
      { reason: 'no_child_headers' }
    );
  }

  const mainStart = okCandidates[0].start;
  const mainStartLine = okCandidates[0].lineNumber || 1;
  const mainCandidates = candidates.filter(item => item.start >= mainStart);
  const preMainAmbiguous = candidates.filter(item => (
    item.start < mainStart &&
    item.resolution &&
    item.resolution.status === 'ambiguous'
  ));

  const ambiguous = preMainAmbiguous.concat(
    mainCandidates.filter(item => item.resolution && item.resolution.status === 'ambiguous')
  );
  if (ambiguous.length) {
    const names = uniqueStrings_(ambiguous.map(item => item.rawName)).slice(0, 8);
    return makeReportFormatError_(
      reportAmbiguousNameMessage_(names),
      { ambiguousNames: names }
    );
  }

  // Один и тот же ребёнок не должен иметь два отдельных блока отчёта.
  // При этом дети с одинаковым именем и разными инициалами считаются
  // разными детьми: «Маша М.» и «Маша У.» разрешены одновременно.
  const duplicateByIdentity = {};
  const duplicateNames = [];

  okCandidates.forEach(item => {
    const resolution = item && item.resolution;
    const targets = resolution && resolution.children && resolution.children.length
      ? resolution.children
      : (resolution && resolution.child ? [resolution.child] : []);

    // Один заголовок может соответствовать нескольким строкам REPORTS одного
    // ребёнка, например если зарегистрированы оба родителя. Это всё ещё один
    // блок отчёта, поэтому внутри одного candidate считаем identity только раз.
    const identitiesInBlock = {};

    targets.forEach(child => {
      const identity = reportChildIdentityKey_(child);
      if (!identity || identitiesInBlock[identity]) return;
      identitiesInBlock[identity] = true;

      if (!duplicateByIdentity[identity]) {
        duplicateByIdentity[identity] = {
          count: 0,
          name: childDisplayNameForReportError_(child, item.rawName)
        };
      }

      duplicateByIdentity[identity].count += 1;
    });
  });

  Object.keys(duplicateByIdentity).forEach(identity => {
    const item = duplicateByIdentity[identity];
    if (item.count > 1) duplicateNames.push(item.name);
  });

  if (duplicateNames.length) {
    const names = uniqueStrings_(duplicateNames).slice(0, 8);
    return makeReportFormatError_(
      reportDuplicateBlockMessage_(names),
      { duplicateNames: names }
    );
  }

  const confirmedHeaderLines = buildConfirmedReportHeaderLines_(okCandidates);

  const missingDelimiters = findMissingReportDelimiters_(
    parsed.clean,
    children,
    1,
    confirmedHeaderLines
  );

  if (missingDelimiters.length) {
    const names = uniqueStrings_(
      missingDelimiters.map(item => item.name)
    ).slice(0, 8);

    return makeReportFormatError_(
      reportMissingDelimiterMessage_(names),
      {
        missingDelimiterNames: names,
        missingDelimiterLines: missingDelimiters
      }
    );
  }

  return {
    ok: true,
    reportType,
    checkedBlocks: okCandidates.length
  };
}

const REPORT_SUBMISSION_PROPERTY_PREFIX_ = 'REPORT_SUBMISSION_V1_';
const REPORT_SUBMISSION_TTL_MS_ = 2 * 24 * 60 * 60 * 1000;

function normalizeReportSubmissionId_(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(id) ? id : '';
}

function reportSubmissionPropertyKey_(id) {
  return REPORT_SUBMISSION_PROPERTY_PREFIX_ + id;
}

function readReportSubmission_(id) {
  if (!id) return null;
  const raw = PropertiesService.getScriptProperties().getProperty(reportSubmissionPropertyKey_(id));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch (_) {
    return null;
  }
}

function writeReportSubmission_(id, value) {
  if (!id) return;
  PropertiesService.getScriptProperties().setProperty(
    reportSubmissionPropertyKey_(id),
    JSON.stringify(value || {})
  );
}

function cleanupReportSubmissions_() {
  const props = PropertiesService.getScriptProperties();
  const markerKey = 'REPORT_SUBMISSION_LAST_CLEANUP';
  const now = Date.now();
  const lastCleanup = Number(props.getProperty(markerKey) || 0);
  if (lastCleanup && now - lastCleanup < 6 * 60 * 60 * 1000) return;
  const all = props.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf(REPORT_SUBMISSION_PROPERTY_PREFIX_) !== 0) return;
    try {
      const item = JSON.parse(all[key] || '{}');
      if (!Number(item.updatedAt) || now - Number(item.updatedAt) > REPORT_SUBMISSION_TTL_MS_) {
        props.deleteProperty(key);
      }
    } catch (_) {
      props.deleteProperty(key);
    }
  });
  props.setProperty(markerKey, String(now));
}

function claimReportSubmission_(id, typeRaw, fingerprint) {
  if (!id) return { claimed:true, state:null };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existing = readReportSubmission_(id);
    if (existing) {
      if (existing.type !== typeRaw || existing.fingerprint !== fingerprint) {
        return { claimed:false, mismatch:true, state:existing };
      }
      return { claimed:false, state:existing };
    }
    const state = {
      status:'processing',
      type:typeRaw,
      fingerprint:fingerprint,
      startedAt:Date.now(),
      updatedAt:Date.now()
    };
    writeReportSubmission_(id, state);
    return { claimed:true, state:state };
  } finally {
    lock.releaseLock();
  }
}

function getReportSubmissionStatus(submissionIdRaw, tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);
  const submissionId = normalizeReportSubmissionId_(submissionIdRaw);
  if (!submissionId) return { ok:false, message:'Некорректный идентификатор отправки.' };
  const state = readReportSubmission_(submissionId);
  if (!state) return { ok:true, status:'not_found', submissionId:submissionId };
  return {
    ok:true,
    status:String(state.status || 'processing'),
    submissionId:submissionId,
    result:state.result || null,
    message:String(state.message || '')
  };
}

function appendReport(param, tutorTokenRaw) {
  let submissionId = '';
  try {
    if (String(tutorTokenRaw || '') !== String(getWorkerSharedSecret_() || '')) requireTutorSession_(tutorTokenRaw);
    cleanupReportSubmissions_();
    const typeRaw = String(param?.reportType || '').trim().toLowerCase();
    if (!typeRaw) return { ok: false, message: 'Тип отчёта не указан.' };

    let targetSheetName = '';
    if (typeRaw === 'morning') targetSheetName = SHEET_MORNING;
    else if (typeRaw === 'evening') targetSheetName = SHEET_EVENING;
    else if (typeRaw === 'psychology') targetSheetName = SHEET_PSYCHOLOGY;
    else return { ok: false, message: 'Неизвестный тип отчёта.' };

    const sheet = getSheet_(targetSheetName);
    if (!sheet) return { ok: false, message: `Лист "${targetSheetName}" не найден.` };

    const raw = (param && param.text) || '';
    const text = cleanIncomingText_(raw);

    if (!text) return { ok: false, message: 'Пустой текст отчёта.' };

    if (targetSheetName !== SHEET_PSYCHOLOGY) {
      const validation = validateChildReportFormat_(typeRaw, text);
      if (!validation.ok) return validation;
    }

    submissionId = normalizeReportSubmissionId_(param && param.submissionId);
    if (param && param.submissionId && !submissionId) {
      return { ok:false, message:'Некорректный идентификатор отправки.' };
    }
    const fingerprint = reportFingerprint_(typeRaw + '\n' + text);
    const claim = claimReportSubmission_(submissionId, typeRaw, fingerprint);
    if (claim.mismatch) {
      return { ok:false, message:'Эта попытка отправки уже относится к другому отчёту.' };
    }
    if (!claim.claimed) {
      if (claim.state.status === 'completed') return claim.state.result;
      if (claim.state.status === 'failed') {
        return { ok:false, message:String(claim.state.message || 'Не удалось отправить отчёт.'), submissionId:submissionId };
      }
      return { ok:true, processing:true, submissionId:submissionId };
    }

    sheet.getRange(1, 1).setValue(text);
    if (submissionId) {
      writeReportSubmission_(submissionId, {
        status:'saved',
        type:typeRaw,
        fingerprint:fingerprint,
        updatedAt:Date.now()
      });
    }

    if (targetSheetName === SHEET_PSYCHOLOGY) {
      syncPsychologyNotificationState_(text);
      try {
        syncD1CurrentReportsToWorker_('psychology');
      } catch (error) {
        Logger.log('REPORT_CURRENT_SYNC_AFTER_PSYCHOLOGY_FAILED ' + (error && error.message || error));
      }
    } else {
      distributeChildReports(typeRaw);
    }

    const result = {
      ok: true,
      sheet: targetSheetName,
      submissionId: submissionId,
      message: targetSheetName === SHEET_PSYCHOLOGY
        ? 'Отчёт успешно отправлен.'
        : 'Отчёт успешно отправлен.'
    };
    if (submissionId) {
      writeReportSubmission_(submissionId, {
        status:'completed',
        type:typeRaw,
        fingerprint:fingerprint,
        result:result,
        updatedAt:Date.now()
      });
    }
    return result;
  } catch (e) {
    if (submissionId) {
      const previous = readReportSubmission_(submissionId) || {};
      writeReportSubmission_(submissionId, {
        status:'failed',
        type:String(previous.type || ''),
        fingerprint:String(previous.fingerprint || ''),
        message:'Ошибка: ' + (e.message || e),
        updatedAt:Date.now()
      });
    }
    return { ok: false, message: 'Ошибка: ' + (e.message || e) };
  }
}

// Server-to-server queue boundary. The caller is authenticated in doPost by
// the private worker secret; keeping this wrapper separate prevents the
// browser API from gaining an unauthenticated report path.
function appendReportFromWorker_(param) {
  return appendReport(param, getWorkerSharedSecret_());
}


function testAppendReportToTestSheet(param, tutorTokenRaw) {
  const TEST_SHEET_NAME = 'TEST_REPORTS_API';

  try {
    try {
      requireTutorSession_(tutorTokenRaw);
    } catch (e) {
      return {
        ok: false,
        code: 'AS-W10 AUTH',
        message: 'Сессия воспитателя отклонена: ' + (e.message || e)
      };
    }

    const typeRaw = String(param && param.reportType || '').trim().toLowerCase();
    if (!['morning', 'evening', 'psychology'].includes(typeRaw)) {
      return {
        ok: false,
        code: 'AS-W11 BAD_TYPE',
        message: 'Неизвестный тип тестового отчёта.'
      };
    }

    const text = cleanIncomingText_(String(param && param.text || ''));
    if (!text) {
      return {
        ok: false,
        code: 'AS-W12 EMPTY',
        message: 'После очистки текст отчёта пуст.'
      };
    }

    let sh;
    try {
      const ss = getSpreadsheet_();
      if (!ss) throw new Error('getSpreadsheet_() вернул пустое значение.');

      sh = ss.getSheetByName(TEST_SHEET_NAME);

      if (!sh) {
        sh = ss.insertSheet(TEST_SHEET_NAME);
        sh.getRange(1, 1, 1, 4).setValues([[
          'TIMESTAMP',
          'WRITE_ID',
          'REPORT_TYPE',
          'TEXT'
        ]]);
      }
    } catch (e) {
      return {
        ok: false,
        code: 'AS-W13 SHEET',
        message: 'Не удалось открыть или создать тестовый лист: ' + (e.message || e)
      };
    }

    const writeId = Utilities.getUuid();
    let row;

    try {
      sh.appendRow([
        new Date(),
        writeId,
        typeRaw,
        text
      ]);

      row = sh.getLastRow();
    } catch (e) {
      return {
        ok: false,
        code: 'AS-W14 WRITE',
        message: 'Ошибка записи строки: ' + (e.message || e)
      };
    }

    try {
      const saved = sh.getRange(row, 1, 1, 4).getValues()[0];

      const savedId = String(saved[1] || '');
      const savedType = String(saved[2] || '');
      const savedText = String(saved[3] || '');

      if (
        savedId !== writeId ||
        savedType !== typeRaw ||
        savedText !== text
      ) {
        return {
          ok: false,
          code: 'AS-W15 VERIFY',
          message: 'Контрольное чтение не совпало с отправленными данными.',
          expected: {
            writeId: writeId,
            reportType: typeRaw,
            text: text
          },
          actual: {
            writeId: savedId,
            reportType: savedType,
            text: savedText
          }
        };
      }

      return {
        ok: true,
        sheet: TEST_SHEET_NAME,
        row: row,
        writeId: writeId,
        reportType: savedType,
        text: savedText
      };

    } catch (e) {
      return {
        ok: false,
        code: 'AS-W15 VERIFY',
        message: 'Не удалось выполнить контрольное чтение: ' + (e.message || e)
      };
    }

  } catch (e) {
    return {
      ok: false,
      code: 'AS-W16 INTERNAL',
      message: 'Непредвиденная ошибка тестового метода: ' + (e.message || e)
    };
  }
}



function testValidateAndWriteReport(param, tutorTokenRaw) {
  const TEST_SHEET_NAME = 'TEST_REPORTS_VALIDATED';

  try {
    // Test bench deliberately requires an educator session for all three types.
    // Production report sheets are not touched.
    try {
      requireTutorSession_(tutorTokenRaw);
    } catch (e) {
      return {
        ok: false,
        code: 'AS-V10 AUTH',
        message: 'Сессия воспитателя отклонена: ' + (e.message || e)
      };
    }

    const typeRaw = String(param && param.reportType || '').trim().toLowerCase();

    if (!['morning', 'evening', 'psychology'].includes(typeRaw)) {
      return {
        ok: false,
        code: 'AS-V11 BAD_TYPE',
        message: 'Неизвестный тип отчёта.'
      };
    }

    const text = cleanIncomingText_(String(param && param.text || ''));

    if (!text) {
      return {
        ok: false,
        code: 'AS-V12 EMPTY',
        message: 'Пустой текст отчёта после cleanIncomingText_.'
      };
    }

    let validation = {
      ok: true,
      reportType: typeRaw,
      skipped: typeRaw === 'psychology'
    };

    // Это ровно тот же validator, который использует production appendReport.
    if (typeRaw !== 'psychology') {
      validation = validateChildReportFormat_(typeRaw, text);

      if (!validation || !validation.ok) {
        return {
          ok: false,
          code: 'AS-V13 VALIDATION',
          message:
            (validation && validation.message) ||
            'validateChildReportFormat_ отклонила отчёт.',
          validation: validation || null
        };
      }
    }

    let sh;

    try {
      const ss = getSpreadsheet_();
      if (!ss) throw new Error('getSpreadsheet_() вернул пустое значение.');

      sh = ss.getSheetByName(TEST_SHEET_NAME);

      if (!sh) {
        sh = ss.insertSheet(TEST_SHEET_NAME);
        sh.getRange(1, 1, 1, 6).setValues([[
          'TIMESTAMP',
          'WRITE_ID',
          'REPORT_TYPE',
          'VALIDATION',
          'TEXT',
          'CHECKED_BLOCKS'
        ]]);
      }
    } catch (e) {
      return {
        ok: false,
        code: 'AS-V14 SHEET',
        message: 'Не удалось открыть или создать тестовый лист: ' + (e.message || e)
      };
    }

    const writeId = Utilities.getUuid();
    let row;

    try {
      sh.appendRow([
        new Date(),
        writeId,
        typeRaw,
        JSON.stringify(validation),
        text,
        Number(validation.checkedBlocks || 0)
      ]);

      row = sh.getLastRow();
    } catch (e) {
      return {
        ok: false,
        code: 'AS-V15 WRITE',
        message: 'Валидация прошла, но тестовая запись упала: ' + (e.message || e)
      };
    }

    try {
      const saved = sh.getRange(row, 1, 1, 6).getValues()[0];

      if (
        String(saved[1] || '') !== writeId ||
        String(saved[2] || '') !== typeRaw ||
        String(saved[4] || '') !== text
      ) {
        return {
          ok: false,
          code: 'AS-V16 VERIFY',
          message: 'Контрольное чтение не совпало с отправленными данными.',
          expected: {
            writeId: writeId,
            reportType: typeRaw,
            text: text
          },
          actual: {
            writeId: String(saved[1] || ''),
            reportType: String(saved[2] || ''),
            text: String(saved[4] || '')
          }
        };
      }

      return {
        ok: true,
        sheet: TEST_SHEET_NAME,
        row: row,
        writeId: writeId,
        reportType: typeRaw,
        checkedBlocks: Number(validation.checkedBlocks || 0),
        validation: validation
      };

    } catch (e) {
      return {
        ok: false,
        code: 'AS-V16 VERIFY',
        message: 'Не удалось выполнить контрольное чтение: ' + (e.message || e)
      };
    }

  } catch (e) {
    return {
      ok: false,
      code: 'AS-V17 INTERNAL',
      message: 'Непредвиденная ошибка: ' + (e.message || e)
    };
  }
}


/** ========= ЧАТ РОДИТЕЛЕЙ И ВОСПИТАТЕЛЕЙ ========= **/
function ensureChatSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(CHAT_SHEET_NAME);

  const headers = [[
    'TIMESTAMP',
    'PHONE',
    'PARENT_NAME',
    'CHILD_NAME',
    'SIDE',
    'TYPE',
    'TEXT',
    'FILE_ID',
    'DELETE_AFTER',
    'STATUS',
    'READ_BY_PARENT',
    'READ_BY_EDUCATOR',
    'MESSAGE_REACTION',
    'REPLY_CONTEXT'
  ]];

  if (!sh) {
    sh = ss.insertSheet(CHAT_SHEET_NAME);
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
    return sh;
  }

  const lastCol = sh.getLastColumn();
  const currentHeaders = lastCol > 0
    ? sh.getRange(1, 1, 1, Math.max(lastCol, headers[0].length)).getValues()[0]
    : [];

  const needRewrite =
    currentHeaders.length < headers[0].length ||
    String(currentHeaders[0] || '') !== 'TIMESTAMP' ||
    String(currentHeaders[5] || '') !== 'TYPE' ||
    String(currentHeaders[10] || '') !== 'READ_BY_PARENT' ||
    String(currentHeaders[11] || '') !== 'READ_BY_EDUCATOR' ||
    String(currentHeaders[12] || '') !== 'MESSAGE_REACTION' ||
    String(currentHeaders[13] || '') !== 'REPLY_CONTEXT';

  if (needRewrite) {
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }

  return sh;
}

function ensureChatIndexSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(CHAT_INDEX_SHEET_NAME);

  const headers = [[
    'PHONE',
    'PHONE10',
    'PARENT_NAME',
    'CHILD_NAME',
    'LAST_TS',
    'LAST_SIDE',
    'LAST_TEXT',
    'HAS_UNREAD_PARENT',
    'HAS_UNREAD_EDUCATOR',
    'STATUS',
    'READ_BY_PARENT',
    'READ_BY_EDUCATOR'
  ]];

  if (!sh) {
    sh = ss.insertSheet(CHAT_INDEX_SHEET_NAME);
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
    return sh;
  }

  const lastCol = sh.getLastColumn();
  const currentHeaders = lastCol > 0
    ? sh.getRange(1, 1, 1, Math.max(lastCol, headers[0].length)).getValues()[0]
    : [];

  const needRewrite =
    currentHeaders.length < headers[0].length ||
    String(currentHeaders[0] || '') !== 'PHONE' ||
    String(currentHeaders[1] || '') !== 'PHONE10' ||
    String(currentHeaders[7] || '') !== 'HAS_UNREAD_PARENT' ||
    String(currentHeaders[10] || '') !== 'READ_BY_PARENT' ||
    String(currentHeaders[11] || '') !== 'READ_BY_EDUCATOR' ||
    String(currentHeaders[8] || '') !== 'HAS_UNREAD_EDUCATOR';

  if (needRewrite) {
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }

  return sh;
}

/** Закрепления — отдельный служебный лист, чтобы пересборка CHAT_INDEX
 * никогда не сбрасывала их. BUCKET фиксирует, в каком списке держать чат. */
function ensureChatPinsSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(CHAT_PINS_SHEET_NAME);
  const headers = [['PHONE10', 'BUCKET', 'UPDATED_AT']];

  if (!sh) {
    sh = ss.insertSheet(CHAT_PINS_SHEET_NAME);
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
    sh.hideSheet();
    return sh;
  }

  if (sh.getLastColumn() < headers[0].length || String(sh.getRange(1, 1).getValue() || '') !== 'PHONE10') {
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }
  return sh;
}

function getEducatorChatPins_() {
  const sh = ensureChatPinsSheet_();
  const lastRow = sh.getLastRow();
  const pins = {};
  if (lastRow < 2) return pins;

  sh.getRange(2, 1, lastRow - 1, 2).getValues().forEach(row => {
    const phone10 = last10_(row[0]);
    const bucket = String(row[1] || '').trim().toLowerCase();
    if (phone10 && (bucket === 'unread' || bucket === 'read')) pins[phone10] = bucket;
  });
  return pins;
}

function removeEducatorChatPin_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  if (!phone10) return;
  const sh = ensureChatPinsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  const values = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  for (let i = values.length - 1; i >= 0; i--) {
    if (last10_(values[i]) === phone10) sh.deleteRow(i + 2);
  }
}

function setEducatorChatPin(phoneRaw, bucketRaw, tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);
  const phone10 = last10_(phoneRaw);
  const bucket = String(bucketRaw || '').trim().toLowerCase();
  if (!phone10 || (bucket !== 'unread' && bucket !== 'read')) {
    return { ok:false, message:'Не удалось определить список для закрепления.' };
  }

  try {
    return withChatWriteLock_(function() {
      const sh = ensureChatPinsSheet_();
      const lastRow = sh.getLastRow();
      const rows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 2).getValues() : [];
      const matches = [];
      rows.forEach((row, index) => {
        if (last10_(row[0]) === phone10) matches.push({ row: index + 2, bucket: String(row[1] || '').trim().toLowerCase() });
      });

      const isAlreadyPinnedHere = matches.some(match => match.bucket === bucket);
      for (let i = matches.length - 1; i >= 0; i--) sh.deleteRow(matches[i].row);

      if (!isAlreadyPinnedHere) {
        sh.appendRow([phone10, bucket, new Date()]);
      }
      clearGetChatMessagesCache(phone10);
      return { ok:true, pinned:!isAlreadyPinnedHere, bucket:!isAlreadyPinnedHere ? bucket : '' };
    });
  } catch (e) {
    return { ok:false, message:'Ошибка закрепления чата: ' + (e.message || e) };
  }
}

/** ========= СОСТОЯНИЕ НЕПРОЧИТАННЫХ ОТЧЁТОВ ========= **/
function ensureReportStateSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(REPORT_STATE_SHEET_NAME);
  const headers = [[
    'PHONE', 'PHONE10',
    'MORNING_CURRENT', 'MORNING_READ',
    'EVENING_CURRENT', 'EVENING_READ',
    'PSYCHOLOGY_CURRENT', 'PSYCHOLOGY_READ',
    'MORNING_WAS_MISSING', 'EVENING_WAS_MISSING', 'PSYCHOLOGY_WAS_MISSING'
  ]];

  if (!sh) {
    sh = ss.insertSheet(REPORT_STATE_SHEET_NAME);
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
    sh.hideSheet();
    return sh;
  }

  const current = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers[0].length)).getValues()[0]
    : [];
  if (
    String(current[0] || '') !== 'PHONE' ||
    String(current[7] || '') !== 'PSYCHOLOGY_READ' ||
    String(current[10] || '') !== 'PSYCHOLOGY_WAS_MISSING'
  ) {
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }
  return sh;
}

function isActualReportText_(raw) {
  const text = cleanIncomingText_(raw);
  return !!text &&
    text !== 'Пока ещё нет отчёта 🙏' &&
    text !== 'Пока нет отчёта. Пожалуйста, попробуйте позже 🙏' &&
    text !== 'Отчёта пока нет. Пожалуйста, попробуйте позже 🙏';
}

function reportFingerprint_(raw) {
  const text = cleanIncomingText_(raw);
  if (!isActualReportText_(text)) return '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function reportContentFingerprintFromVersion_(versionRaw) {
  return String(versionRaw || '').split('.')[0];
}

function buildReportUpdatesByPhone_(phones, morningValues, eveningValues, psychologyText) {
  const grouped = {};
  (phones || []).forEach((phoneRaw, i) => {
    const phone = normalizePhone_(phoneRaw);
    const phone10 = last10_(phone);
    if (!phone10) return;
    if (!grouped[phone10]) grouped[phone10] = { phone, morning: [], evening: [] };
    if (morningValues) grouped[phone10].morning.push(String((morningValues[i] || [])[0] || ''));
    if (eveningValues) grouped[phone10].evening.push(String((eveningValues[i] || [])[0] || ''));
  });

  const updates = {};
  Object.keys(grouped).forEach(phone10 => {
    const item = grouped[phone10];
    updates[phone10] = { phone: item.phone };
    if (morningValues) updates[phone10].morning = reportFingerprint_(item.morning.filter(isActualReportText_).join('\n\n'));
    if (eveningValues) updates[phone10].evening = reportFingerprint_(item.evening.filter(isActualReportText_).join('\n\n'));
    if (psychologyText !== undefined) updates[phone10].psychology = reportFingerprint_(psychologyText);
  });
  return updates;
}

function syncReportNotificationState_(updates, pruneMissing) {
  if (!updates || !Object.keys(updates).length) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureReportStateSheet_();
    const lastRow = sh.getLastRow();
    let existing = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, 11).getValues() : [];
    const byPhone = {};
    let dirty = false;
    let needsClear = false;
    if (pruneMissing) {
      const activePhones = new Set(Object.keys(updates));
      const filtered = existing.filter(r => activePhones.has(last10_(r[1] || r[0])));
      if (filtered.length !== existing.length) {
        existing = filtered;
        dirty = true;
        needsClear = true;
      }
    }
    existing.forEach((r, i) => {
      const phone10 = last10_(r[1] || r[0]);
      if (phone10 && byPhone[phone10] === undefined) byPhone[phone10] = i;
    });

    Object.keys(updates).forEach(phone10 => {
      const update = updates[phone10] || {};
      const index = byPhone[phone10];
      if (index === undefined) {
        const m = String(update.morning || '');
        const e = String(update.evening || '');
        const p = String(update.psychology || '');
        byPhone[phone10] = existing.length;
        existing.push([
          update.phone || phone10, phone10,
          m, m, e, e, p, p,
          Object.prototype.hasOwnProperty.call(update, 'morning') ? !m : '',
          Object.prototype.hasOwnProperty.call(update, 'evening') ? !e : '',
          Object.prototype.hasOwnProperty.call(update, 'psychology') ? !p : ''
        ]);
        dirty = true;
        return;
      }

      const row = existing[index];
      if (update.phone && String(row[0] || '') !== String(update.phone)) {
        row[0] = update.phone;
        dirty = true;
      }
      const mapping = {
        morning: { current: 2, read: 3, missing: 8 },
        evening: { current: 4, read: 5, missing: 9 },
        psychology: { current: 6, read: 7, missing: 10 }
      };
      Object.keys(mapping).forEach(kind => {
        if (!Object.prototype.hasOwnProperty.call(update, kind)) return;
        const fingerprint = String(update[kind] || '');
        const currentIndex = mapping[kind].current;
        const readIndex = mapping[kind].read;
        const missingIndex = mapping[kind].missing;
        const missingValue = row[missingIndex];
        const missingInitialized = missingValue !== '' && missingValue !== null && missingValue !== undefined;
        const wasMissing = row[missingIndex] === true || String(row[missingIndex]).toLowerCase() === 'true';

        // Пустота сама по себе не создаёт уведомление, но взводит следующий
        // непустой текст как новую публикацию — даже если текст вернули тот же.
        if (!fingerprint) {
          if (!wasMissing) {
            row[missingIndex] = true;
            dirty = true;
          }
          return;
        }

        const currentContent = reportContentFingerprintFromVersion_(row[currentIndex]);
        if (!missingInitialized && !row[currentIndex] && !row[readIndex]) {
          // Этот вид отчёта ещё ни разу не попадал в состояние (например,
          // лист создала психотерапия до первого распределения утра/вечера).
          row[currentIndex] = fingerprint;
          row[readIndex] = fingerprint;
          row[missingIndex] = false;
          dirty = true;
          return;
        }
        if (fingerprint !== currentContent || wasMissing) {
          row[currentIndex] = (wasMissing && fingerprint === currentContent)
            ? fingerprint + '.' + String(Date.now())
            : fingerprint;
          dirty = true;
        }
        if (wasMissing) {
          row[missingIndex] = false;
          dirty = true;
        } else if (!missingInitialized) {
          row[missingIndex] = false;
          dirty = true;
        }
      });
    });

    if (dirty) {
      if (needsClear && lastRow >= 2) sh.getRange(2, 1, lastRow - 1, 11).clearContent();
      if (existing.length) sh.getRange(2, 1, existing.length, 11).setValues(existing);
    }
  } finally {
    lock.releaseLock();
  }
}

function initializeReportNotificationState_() {
  const dataSheet = getDataSheet_();
  if (!dataSheet || dataSheet.getLastRow() < 2) return;
  const count = dataSheet.getLastRow() - 1;
  const values = dataSheet.getRange(2, 1, count, 6).getValues();
  const phones = values.map(r => r[0]);
  const morning = values.map(r => [r[4]]);
  const evening = values.map(r => [r[5]]);
  const psychologySheet = getSheet_(SHEET_PSYCHOLOGY);
  const psychology = psychologySheet ? String(psychologySheet.getRange(1, 1).getValue() || '') : '';
  syncReportNotificationState_(buildReportUpdatesByPhone_(phones, morning, evening, psychology));
}

function syncPsychologyNotificationState_(textRaw) {
  const dataSheet = getDataSheet_();
  if (!dataSheet || dataSheet.getLastRow() < 2) return;
  const phones = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, 1).getValues().flat();
  syncReportNotificationState_(buildReportUpdatesByPhone_(phones, null, null, String(textRaw || '')));
}

function getReportUnreadStatus_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  const empty = { morning: false, evening: false, psychology: false };
  if (!phone10) return empty;

  let sh = ensureReportStateSheet_();
  let lastRow = sh.getLastRow();
  if (lastRow < 2) {
    initializeReportNotificationState_();
    sh = ensureReportStateSheet_();
    lastRow = sh.getLastRow();
  }
  if (lastRow < 2) return empty;

  const rows = sh.getRange(2, 2, lastRow - 1, 7).getValues();
  for (const r of rows) {
    if (last10_(r[0]) !== phone10) continue;
    return {
      morning: !!r[1] && String(r[1]) !== String(r[2] || ''),
      evening: !!r[3] && String(r[3]) !== String(r[4] || ''),
      psychology: !!r[5] && String(r[5]) !== String(r[6] || '')
    };
  }

  initializeReportNotificationState_();
  return getReportUnreadStatusWithoutInit_(phone10);
}

function getReportUnreadStatusWithoutInit_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  const empty = { morning: false, evening: false, psychology: false };
  const sh = ensureReportStateSheet_();
  const lastRow = sh.getLastRow();
  if (!phone10 || lastRow < 2) return empty;
  const rows = sh.getRange(2, 2, lastRow - 1, 7).getValues();
  for (const r of rows) {
    if (last10_(r[0]) === phone10) {
      return {
        morning: !!r[1] && String(r[1]) !== String(r[2] || ''),
        evening: !!r[3] && String(r[3]) !== String(r[4] || ''),
        psychology: !!r[5] && String(r[5]) !== String(r[6] || '')
      };
    }
  }
  return empty;
}

function getReportVersion_(phoneRaw, kindRaw) {
  const phone10 = last10_(phoneRaw);
  const kind = String(kindRaw || '').toLowerCase();
  const offsets = { morning: 1, evening: 3, psychology: 5 };
  if (!phone10 || offsets[kind] === undefined) return '';
  const sh = ensureReportStateSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return '';
  const rows = sh.getRange(2, 2, lastRow - 1, 7).getValues();
  for (const r of rows) {
    if (last10_(r[0]) === phone10) return String(r[offsets[kind]] || '');
  }
  return '';
}


function getParentUnreadState(phoneRaw, parentSessionRaw) {
  try {
    requireParentAccess_(phoneRaw, parentSessionRaw);
  } catch (e) {
    return { ok: false, message: String(e && e.message || e) };
  }
  const chat = hasUnreadEducatorMessages(phoneRaw);
  return {
    ok: true,
    hasUnread: !!(chat && chat.ok && chat.hasUnread),
    reportUnread: getReportUnreadStatus_(phoneRaw)
  };
}

function markReportAsRead(phoneRaw, kindRaw, expectedVersionRaw, parentSessionRaw) {
  const phone10 = last10_(phoneRaw);
  const kind = String(kindRaw || '').toLowerCase();
  const columns = { morning: [3, 4], evening: [5, 6], psychology: [7, 8] };
  if (!phone10 || !columns[kind]) return { ok: false, message: 'Некорректный отчёт.' };
  requireParentAccess_(phone10, parentSessionRaw);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureReportStateSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true };
    const phones = sh.getRange(2, 2, lastRow - 1, 1).getValues().flat();
    const index = phones.findIndex(value => last10_(value) === phone10);
    if (index < 0) return { ok: true };
    const pair = columns[kind];
    const current = sh.getRange(index + 2, pair[0]).getValue();
    const expectedVersion = String(expectedVersionRaw || '');
    if (expectedVersion && String(current || '') !== expectedVersion) {
      return { ok: true, skipped: true };
    }
    if (current) sh.getRange(index + 2, pair[1]).setValue(current);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function ensurePushSubscriptionsSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(PUSH_SUBSCRIPTIONS_SHEET_NAME);

  const headers = [[
    'CREATED_AT',
    'UPDATED_AT',
    'ROLE',
    'PHONE',
    'ENDPOINT',
    'P256DH',
    'AUTH',
    'SUBSCRIPTION_JSON',
    'USER_AGENT',
    'ENABLED',
    'LAST_ERROR'
  ]];

  if (!sh) {
    sh = ss.insertSheet(PUSH_SUBSCRIPTIONS_SHEET_NAME);
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
    return sh;
  }

  const lastCol = sh.getLastColumn();
  const currentHeaders = lastCol > 0
    ? sh.getRange(1, 1, 1, Math.max(lastCol, headers[0].length)).getValues()[0]
    : [];

  const needRewrite =
    currentHeaders.length < headers[0].length ||
    String(currentHeaders[0] || '') !== 'CREATED_AT' ||
    String(currentHeaders[4] || '') !== 'ENDPOINT';

  if (needRewrite) {
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }

  return sh;
}

function normalizePushRole_(roleRaw) {
  const role = String(roleRaw || '').trim().toLowerCase();
  return role === 'educator' ? 'educator' : 'parent';
}

function savePushSubscription(payloadRaw) {
  try {
    const payload = payloadRaw || {};
    const role = normalizePushRole_(payload.role);
    const phone = role === 'parent' ? normalizePhone_(payload.phone || '') : '';
    const subscription = payload.subscription || {};
    const endpoint = String(subscription.endpoint || '').trim();
    const keys = subscription.keys || {};
    const p256dh = String(keys.p256dh || '').trim();
    const auth = String(keys.auth || '').trim();
    const userAgent = String(payload.userAgent || '').trim();

    if (!endpoint || !p256dh || !auth) {
      return { ok: false, message: 'Некорректная подписка уведомлений.' };
    }

    if (role === 'parent' && !last10_(phone)) {
      return { ok: false, message: 'Не указан телефон родителя для уведомлений.' };
    }

    const sh = ensurePushSubscriptionsSheet_();
    const now = new Date();
    const row = [
      now,
      now,
      role,
      phone,
      endpoint,
      p256dh,
      auth,
      JSON.stringify(subscription),
      userAgent,
      true,
      ''
    ];

    const lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      const endpoints = sh.getRange(2, 5, lastRow - 1, 1).getValues().flat();
      const foundIndex = endpoints.findIndex(v => String(v || '').trim() === endpoint);
      if (foundIndex >= 0) {
        const rowIndex = foundIndex + 2;
        row[0] = sh.getRange(rowIndex, 1).getValue() || now;
        sh.getRange(rowIndex, 1, 1, row.length).setValues([row]);
        return { ok: true, updated: true };
      }
    }

    sh.appendRow(row);
    return { ok: true, created: true };
  } catch (e) {
    return { ok: false, message: 'Ошибка сохранения подписки уведомлений: ' + (e.message || e) };
  }
}

function deletePushSubscription(endpointRaw) {
  const endpoint = String(endpointRaw || '').trim();
  if (!endpoint) return { ok: false, message: 'Endpoint не указан.' };

  try {
    markPushSubscriptionError_(endpoint, 'Отключено пользователем', false);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: 'Ошибка отключения уведомлений: ' + (e.message || e) };
  }
}

function getPushSubscriptions_(roleRaw, phoneRaw) {
  const role = normalizePushRole_(roleRaw);
  const phone10 = role === 'parent' ? last10_(phoneRaw) : '';
  const sh = ensurePushSubscriptionsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const rows = sh.getRange(2, 1, lastRow - 1, 11).getValues();
  return rows
    .filter(r => {
      const rowRole = normalizePushRole_(r[2]);
      const enabled = r[9] === true || String(r[9]).toLowerCase() === 'true';
      if (!enabled || rowRole !== role) return false;
      if (role === 'parent') return last10_(r[3]) === phone10;
      return true;
    })
    .map(r => {
      let subscription = null;
      try {
        subscription = JSON.parse(String(r[7] || '{}'));
      } catch (e) {
        subscription = null;
      }

      return {
        endpoint: String(r[4] || '').trim(),
        subscription
      };
    })
    .filter(item => item.endpoint && item.subscription && item.subscription.endpoint);
}

function markPushSubscriptionError_(endpointRaw, errorRaw, enabled) {
  const endpoint = String(endpointRaw || '').trim();
  if (!endpoint) return;

  try {
    const sh = ensurePushSubscriptionsSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    const endpoints = sh.getRange(2, 5, lastRow - 1, 1).getValues().flat();
    const foundIndex = endpoints.findIndex(v => String(v || '').trim() === endpoint);
    if (foundIndex < 0) return;

    const rowIndex = foundIndex + 2;
    sh.getRange(rowIndex, 2).setValue(new Date());
    sh.getRange(rowIndex, 10).setValue(enabled !== false);
    sh.getRange(rowIndex, 11).setValue(String(errorRaw || '').slice(0, 500));
  } catch (e) {}
}

function getPushWorkerConfig_() {
  const props = PropertiesService.getScriptProperties();
  const propUrl = String(props.getProperty('MEDSI_PUSH_WORKER_URL') || '').trim();
  const propSecret = String(props.getProperty('MEDSI_PUSH_WORKER_SECRET') || '').trim();
  const isExpectedWorkerUrl = /^https:\/\/medsi-push-worker\.medsi-children\.workers\.dev\/notify$/i.test(propUrl);

  return {
    url: isExpectedWorkerUrl ? propUrl : PUSH_WORKER_URL_FALLBACK,
    secret: getWorkerSharedSecret_() || propSecret
  };
}

function sendPushViaWorker_(role, phone, notification) {
  const cfg = getPushWorkerConfig_();
  if (!cfg.url || !cfg.secret) {
    return { ok: false, skipped: true };
  }

  const response = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + cfg.secret
    },
    payload: JSON.stringify({
      role,
      phone,
      notification
    })
  });

  const code = response.getResponseCode();
  const text = response.getContentText() || '';
  let parsed = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (e) {
    parsed = null;
  }

  if (code >= 200 && code < 300) {
    return {
      ok: !!(parsed && parsed.ok),
      code,
      sent: parsed && typeof parsed.sent !== 'undefined' ? parsed.sent : '',
      failed: parsed && typeof parsed.failed !== 'undefined' ? parsed.failed : '',
      total: parsed && typeof parsed.total !== 'undefined' ? parsed.total : '',
      message: text
    };
  }

  return {
    ok: false,
    code,
    disabled: code === 404 || code === 410,
    message: text
  };
}

function sendPushDebugEvent_(payload) {
  try {
    const response = UrlFetchApp.fetch('https://medsi-push-worker.medsi-children.workers.dev/debug/client', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify(payload || {})
    });
    return {
      ok: true,
      code: response.getResponseCode(),
      text: String(response.getContentText() || '').slice(0, 500)
    };
  } catch (e) {
    return { ok: false, message: String(e && e.message || e) };
  }
}

function buildPushSignaturePayload_(roleRaw, phoneRaw, notification, ts) {
  const role = normalizePushRole_(roleRaw);
  return [
    role,
    role === 'parent' ? last10_(phoneRaw) : '',
    String(notification && notification.title || ''),
    String(notification && notification.body || ''),
    String(notification && notification.url || '/'),
    String(notification && notification.tag || 'medsi-message'),
    String(ts || '')
  ].join('\n');
}

function signPushPayload_(payload) {
  const bytes = Utilities.computeHmacSha256Signature(payload, getWorkerSharedSecret_());
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function buildPushClientPayload_(roleRaw, phoneRaw, notification) {
  const role = normalizePushRole_(roleRaw);
  const phone10 = role === 'parent' ? last10_(phoneRaw) : '';
  const ts = String(Date.now());
  const safeNotification = {
    title: String(notification && notification.title || 'Медси Бот').slice(0, 80),
    body: String(notification && notification.body || 'Новое сообщение').slice(0, 240),
    url: String(notification && notification.url || '/').slice(0, 500),
    tag: String(notification && notification.tag || 'medsi-message').slice(0, 80)
  };

  return {
    role,
    phone: phone10,
    notification: safeNotification,
    ts,
    sig: signPushPayload_(buildPushSignaturePayload_(role, phone10, safeNotification, ts))
  };
}

function sendPushNotification_(role, phone, notification) {
  const res = sendPushViaWorker_(role, phone, notification);

  if (res && res.skipped) {
    Logger.log('Push skipped: worker is not configured');
    return res;
  }

  Logger.log(
    'Push notify result: role=' + role +
    ', phone=' + last10_(phone || '') +
    ', ok=' + !!(res && res.ok) +
    ', sent=' + String((res && res.sent) || '') +
    ', total=' + String((res && res.total) || '') +
    ', failed=' + String((res && res.failed) || '') +
    ', message=' + String((res && (res.message || res.code)) || '')
  );

  return res;
}

function notifyNewChatMessage_(profile, side, type, text) {
  try {
    const preview = buildChatPreviewText_(type, text) || 'Новое сообщение';
    const messageTag = String(new Date().getTime());

    if (side === 'parent') {
      const phone10 = last10_(profile.phone || '');
      const notification = {
        title: profile.childName || 'Медси Бот',
        body: preview,
        url: '/tutors',
        tag: 'medsi-educator-chat-' + messageTag
      };

      const serverResult = sendPushNotification_('educator', '', notification);

      return {
        server: serverResult,
        fallback: buildPushClientPayload_('educator', '', notification)
      };
    }

    if (side === 'educator') {
      const notification = {
        title: 'Детское Отделение Медси',
        body: preview,
        url: '/',
        tag: 'medsi-parent-chat-' + last10_(profile.phone || '') + '-' + messageTag
      };

      const serverResult = sendPushNotification_('parent', profile.phone || '', notification);

      return {
        server: serverResult,
        fallback: buildPushClientPayload_('parent', profile.phone || '', notification)
      };
    }
  } catch (e) {
    Logger.log('Push notification error: ' + (e.message || e));
    return { ok: false, message: String(e && e.message || e) };
  }

  return { ok: false, message: 'No push side matched' };
}

function getActiveReportPhonesSet_() {
  const sh = getDataSheet_();
  const set = new Set();

  if (!sh) return set;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return set;

  const values = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();

  values.forEach(v => {
    const p10 = last10_(v);
    if (p10) set.add(p10);
  });

  return set;
}

function isPhoneActiveInReports_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  if (!phone10) return false;

  const activePhones = getActiveReportPhonesSet_();
  return activePhones.has(phone10);
}

/**
 * Полностью удаляет из CHAT_MESSAGES все строки,
 * относящиеся к телефонам, которых больше нет в REPORTS.
 */
function purgeInactiveChatMessages_() {
  const sh = ensureChatSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, deletedRows: 0 };

  const reportPhones = new Set();
  const dataSh = getDataSheet_();

  if (dataSh) {
    const dataLastRow = dataSh.getLastRow();
    if (dataLastRow >= 2) {
      const phones = dataSh.getRange(2, 1, dataLastRow - 1, 1).getValues().flat();
      phones.forEach(v => {
        const p10 = last10_(v);
        if (p10) reportPhones.add(p10);
      });
    }
  }

  const rows = sh.getRange(2, 1, lastRow - 1, 12).getValues();
  const rowsToDelete = [];

  for (let i = 0; i < rows.length; i++) {
    const phone10 = last10_(rows[i][1]);
    if (!phone10 || !reportPhones.has(phone10)) {
      rowsToDelete.push(i + 2);
    }
  }

  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sh.deleteRow(rowsToDelete[i]);
  }

  if (rowsToDelete.length > 0) {
    rebuildChatIndex_();
    clearGetChatMessagesCache();
  }

  return { ok: true, deletedRows: rowsToDelete.length };
}

function purgeLegacyChatMessagesForPhone_(phoneRaw) {
  const phone = last10_(phoneRaw);
  if (!phone) return { ok:true, deletedRows:0 };
  const sheet = ensureChatSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok:true, deletedRows:0 };
  const phones = sheet.getRange(2, 2, lastRow - 1, 1).getValues().flat();
  const rows = [];
  phones.forEach(function(value, index) {
    if (last10_(value) === phone) rows.push(index + 2);
  });
  for (let i = rows.length - 1; i >= 0; i--) sheet.deleteRow(rows[i]);
  if (rows.length) {
    rebuildChatIndex_();
    clearGetChatMessagesCache(phone);
  }
  return { ok:true, deletedRows:rows.length };
}

function getReportChildDeletionPreview(phoneRaw, tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const phone10 = last10_(phoneRaw);
    if (!phone10) return { ok: false, message: 'Не удалось определить номер родителя.' };

    const sh = getDataSheet_();
    const lastRow = sh ? sh.getLastRow() : 0;
    if (lastRow < 2) return { ok: false, message: 'Строка ребёнка уже удалена.' };

    const values = sh.getRange(2, 1, lastRow - 1, 4).getValues();
    const names = normalizeReportChildNames_(
      sh,
      values.map(row => String(row[2] || '').trim()),
      values.map(row => String(row[3] || '').trim())
    );
    const index = values.findIndex(row => last10_(row[0]) === phone10);
    if (index < 0) return { ok: false, message: 'Строка ребёнка уже удалена.' };

    return { ok: true, phone: normalizePhone_(values[index][0]), childName: names[index] || 'Без имени ребёнка' };
  } catch (e) {
    return { ok: false, message: 'Не удалось подготовить удаление: ' + (e.message || e) };
  }
}

function ensureReportInactivityStateSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(REPORT_INACTIVITY_STATE_SHEET_NAME);
  const headers = [['PHONE10', 'LAST_NEW_REPORT_AT', 'FIRST_SEEN_AT', 'LAST_PROMPT_DAYS']];
  if (!sh) {
    sh = ss.insertSheet(REPORT_INACTIVITY_STATE_SHEET_NAME);
    sh.getRange(1, 1, 1, headers[0].length).setValues(headers);
    sh.hideSheet();
  }
  return sh;
}

function syncReportInactivityState_(updates) {
  const sh = ensureReportInactivityStateSheet_();
  const now = new Date();
  const lastRow = sh.getLastRow();
  const rows = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, 4).getValues() : [];
  const byPhone = {};
  rows.forEach((row, index) => { const phone = last10_(row[0]); if (phone) byPhone[phone] = index; });

  (updates || []).forEach(update => {
    const phone = last10_(update && update.phone);
    if (!phone) return;
    const index = byPhone[phone];
    if (index === undefined) {
      rows.push([phone, update.hasNewReport ? now : '', now, '']);
      byPhone[phone] = rows.length - 1;
      return;
    }
    if (update.hasNewReport) {
      rows[index][1] = now;
      rows[index][3] = '';
    }
  });

  if (lastRow >= 2) sh.getRange(2, 1, lastRow - 1, 4).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 4).setValues(rows);
}

function removeReportInactivityState_(phoneRaw) {
  const phone = last10_(phoneRaw);
  if (!phone) return;
  const sh = ensureReportInactivityStateSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  const rows = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (last10_(rows[i]) === phone) sh.deleteRow(i + 2);
  }
}

function getReportInactivityReminder(tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const dataSheet = getDataSheet_();
    const count = dataSheet ? Math.max(dataSheet.getLastRow() - 1, 0) : 0;
    if (!count) return { ok: true, reminder: null };
    const rows = dataSheet.getRange(2, 1, count, 4).getValues();
    const names = normalizeReportChildNames_(dataSheet, rows.map(r => String(r[2] || '').trim()), rows.map(r => String(r[3] || '').trim()));
    syncReportInactivityState_(rows.map(row => ({ phone: row[0], hasNewReport: false })));

    const stateSheet = ensureReportInactivityStateSheet_();
    const stateRows = stateSheet.getLastRow() >= 2 ? stateSheet.getRange(2, 1, stateSheet.getLastRow() - 1, 4).getValues() : [];
    const stateByPhone = {};
    stateRows.forEach(row => { const phone = last10_(row[0]); if (phone) stateByPhone[phone] = row; });
    const now = Date.now();
    const candidates = [];
    rows.forEach((row, index) => {
      const phone = last10_(row[0]);
      const state = stateByPhone[phone];
      if (!phone || !state) return;
      const since = state[1] || state[2];
      const days = Math.floor((now - new Date(since).getTime()) / 86400000);
      const tier = days >= 21 ? 21 : (days >= 7 ? 7 : (days >= 3 ? 3 : 0));
      const lastPrompt = Number(state[3] || 0);
      if (tier && tier > lastPrompt) candidates.push({ phone: normalizePhone_(row[0]), childName: names[index] || 'Без имени ребёнка', days, tier, index });
    });
    // Не создаём очередь окон: показываем только последнюю строку из таблицы.
    candidates.sort((a, b) => b.index - a.index);
    return { ok: true, reminder: candidates[0] || null };
  } catch (e) { return { ok: false, message: 'Не удалось проверить напоминания: ' + (e.message || e) }; }
}

function acknowledgeReportInactivityReminder(phoneRaw, tierRaw, tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const phone = last10_(phoneRaw);
    const tier = Number(tierRaw || 0);
    if (!phone || !tier) return { ok: false, message: 'Не удалось отметить напоминание.' };
    const sh = ensureReportInactivityStateSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, message: 'Напоминание не найдено.' };
    const phones = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const index = phones.findIndex(value => last10_(value) === phone);
    if (index < 0) return { ok: false, message: 'Напоминание не найдено.' };
    sh.getRange(index + 2, 4).setValue(tier);
    return { ok: true };
  } catch (e) { return { ok: false, message: 'Не удалось отметить напоминание: ' + (e.message || e) }; }
}

function deleteReportChildByPhone(phoneRaw, tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const phone10 = last10_(phoneRaw);
    if (!phone10) return { ok: false, message: 'Не удалось определить номер родителя.' };

    return withChatWriteLock_(function() {
      const sh = getDataSheet_();
      const lastRow = sh ? sh.getLastRow() : 0;

      const values = lastRow >= 2
        ? sh.getRange(2, 1, lastRow - 1, 4).getValues()
        : [];
      const rowNumbers = [];

      values.forEach((row, index) => {
        if (last10_(row[0]) === phone10) rowNumbers.push(index + 2);
      });

      const rawDeletedTargets = rowNumbers
        .map(function(rowNumber) { return rawReportChildTargetFromReportRow_(values[rowNumber - 2]); })
        .filter(Boolean);
      const rawActiveTargets = values
        .filter(function(row) { return last10_(row[0]) !== phone10; })
        .map(rawReportChildTargetFromReportRow_)
        .filter(Boolean);
      const rawTargets = rawReportTargetsNoLongerActive_(rawDeletedTargets, rawActiveTargets);
      const rawAllTargets = rawActiveTargets.concat(rawTargets);
      const rawCleanupPlan = prepareRawReportCleanupForChildren_(rawTargets, rawAllTargets);

      let cleanup = null;
      let d1Cleanup = null;
      let rawCleanup = null;
      const cleanupErrors = [];

      // First close the production chat. If Cloudflare is temporarily
      // unavailable, keep REPORTS intact so the whole operation can be retried.
      try {
        d1Cleanup = deleteD1ProfileWithS3Purge_(phone10);
      } catch (e) {
        return {
          ok: false,
          message: 'Не удалось закрыть чат родителя. Попробуйте удалить ещё раз: ' + String(e && e.message || e)
        };
      }

      // The D1 profile is closed before REPORTS is changed, but raw report
      // edits are prepared from the still-authoritative row above.  This keeps
      // deletion from accidentally selecting a same-named child by first name.
      try {
        rawCleanup = applyRawReportCleanup_(rawCleanupPlan);
      } catch (e) {
        // Do not leave a parent half-deleted after their production thread was
        // closed.  Deleting REPORTS below will make the installed onChange
        // trigger retry this exact cleanup from the saved pre-delete snapshot.
        const message = String(e && e.message || e);
        cleanupErrors.push('raw reports: ' + message);
        Logger.log('Raw report cleanup will retry after REPORTS deletion for ' + phone10 + ': ' + message);
      }

      // REPORTS remains the access authority. D1 access is already closed.
      for (let i = rowNumbers.length - 1; i >= 0; i -= 1) {
        sh.deleteRow(rowNumbers[i]);
      }

      function bestEffortDeleteCleanup_(label, fn) {
        try {
          return fn();
        } catch (e) {
          const message = String(e && e.message || e);
          cleanupErrors.push(label + ': ' + message);
          Logger.log(
            'Cleanup after parent deletion failed [' +
            label + '] for ' + phone10 + ': ' + message
          );
          return null;
        }
      }

      // Legacy Sheets chat.
      cleanup = bestEffortDeleteCleanup_(
        'legacy chat',
        function() { return purgeLegacyChatMessagesForPhone_(phone10); }
      );

      bestEffortDeleteCleanup_(
        'report inactivity state',
        function() { return removeReportInactivityState_(phone10); }
      );

      bestEffortDeleteCleanup_(
        'educator pin',
        function() { return removeEducatorChatPin_(phone10); }
      );

      // purgeInactiveChatMessages_ already rebuilds the legacy index when
      // it deletes rows. This extra rebuild is only a safety cleanup and
      // must never turn a successful profile deletion into a failure.
      bestEffortDeleteCleanup_(
        'chat index',
        function() { return rebuildChatIndex_(); }
      );

      bestEffortDeleteCleanup_(
        'chat cache',
        function() { return clearGetChatMessagesCache(); }
      );

      bestEffortDeleteCleanup_(
        'parent contact',
        function() { return removeMedsiParentContactBestEffort_(phone10); }
      );

      return {
        ok: true,
        alreadyDeleted: rowNumbers.length === 0,
        deletedReportRows: rowNumbers.length,
        deletedRawReportBlocks: Number(rawCleanup && rawCleanup.removedBlocks || 0),
        deletedChatRows: Number(cleanup && cleanup.deletedRows || 0),
        deletedD1Profiles: Number(d1Cleanup && d1Cleanup.deleted && 1 || 0),
        cleanupComplete: cleanupErrors.length === 0,
        cleanupErrors: cleanupErrors
      };
    });
  } catch (e) {
    return { ok: false, message: 'Не удалось удалить ребёнка: ' + (e.message || e) };
  }
}

/**
 * Загрузить ВСЕ сообщения ВСЕХ родителей одним запросом.
 * Возвращает объект: { phone: { parentName, childName, messages: [...] } }
 */
function getAllChatMessages(tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const sh = ensureChatSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, chats: {} };

    // Performance: load only recent rows
    const startRow = 2;
    const rows = sh.getRange(startRow, 1, lastRow - startRow + 1, 14).getValues();

    const byPhone = {};

    rows.forEach(r => {
      const phone = normalizePhone_(r[1]);
      const phone10 = last10_(phone);
      if (!phone10) return;

      const parentName = String(r[2] || '').trim();
      const childName = String(r[3] || '').trim();
      const side = String(r[4] || '').trim();
      const type = String(r[5] || '').trim() || 'text';
      const textCell = String(r[6] || '').trim();
      const fileId = String(r[7] || '').trim();
      const ts = r[0];
      const readByParent = r[10] === true || String(r[10]).toLowerCase() === 'true';
      const readByEducator = r[11] === true || String(r[11]).toLowerCase() === 'true';
      const reaction = normalizeReaction_(r[12] || '');
      const reply = parseReplyContext_(r[13]);

      let mediaUrl = '';
      let videoUrl = '';
      let videoTitle = '';
      let text = textCell;

      if (fileId) {
        if (type === 'image') {
          mediaUrl = buildDriveImageUrl_(fileId);
        } else if (type === 'video') {
            mediaUrl = buildDriveImageUrl_(fileId);
        }
      }

      if (type === 'video') {
        const parsedVideo = parseVideoPayload_(textCell);
        videoUrl = parsedVideo.videoUrl;
        videoTitle = parsedVideo.videoTitle;
        text = parsedVideo.caption;
      }

      if (!byPhone[phone10]) {
        byPhone[phone10] = {
          phone: phone,
          parentName: parentName,
          childName: childName,
          messages: []
        };
      }

      // Update names from latest message
      if (parentName) byPhone[phone10].parentName = parentName;
      if (childName) byPhone[phone10].childName = childName;

      byPhone[phone10].messages.push({
        messageKey: buildMessageKey_(ts, side),
        side: side,
        type: type,
        text: text,
        mediaUrl: mediaUrl,
        videoUrl: videoUrl,
        videoTitle: videoTitle,
        parentName: parentName,
        childName: childName,
        timestamp: humanTime_(ts),
        readByParent: readByParent,
        readByEducator: readByEducator,
        reaction: reaction,
        reply: reply
      });
    });

    return { ok: true, chats: byPhone };
  } catch (e) {
    return { ok: false, message: 'Ошибка загрузки всех сообщений: ' + (e.message || e) };
  }
}

/**
 * Публичная функция для триггера.
 */
function cleanupInactiveChatMessages() {
  return purgeInactiveChatMessages_();
}

function ensureInactiveChatCleanupTrigger_() {
  const handler = 'cleanupInactiveChatMessages';
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === handler);
  if (exists) return;

  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyHours(1)
    .create();
}

function getChatPhotosFolder_() {
  const folders = DriveApp.getFoldersByName(CHAT_PHOTOS_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(CHAT_PHOTOS_FOLDER_NAME);
}



function ensureChatCleanupTrigger_() {
  const handler = 'cleanupExpiredChatImages';
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === handler);
  if (exists) return;

  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();
}

function appendChatMessage_(profile, side, type, text, fileId, deleteAfter, status, replyToKey) {
  return withChatWriteLock_(function() {
    const sh = ensureChatSheet_();

    const readByParent = side === 'educator' ? false : true;
    const readByEducator = side === 'parent' ? false : true;
    const ts = new Date();
    const replyContext = resolveReplyContext_(profile && profile.phone, replyToKey);

    sh.appendRow([
      ts,
      profile.phone || '',
      profile.parentName || '',
      profile.childName || '',
      side || '',
      type || 'text',
      text || '',
      fileId || '',
      deleteAfter || '',
      status || 'active',
      readByParent,
      readByEducator,
      '',
      replyContext ? JSON.stringify(replyContext) : ''
    ]);

    upsertChatIndexFromMessage_(
      profile,
      side,
      type,
      text,
      ts,
      readByParent,
      readByEducator,
      status
    );

    clearGetChatMessagesCache(profile && profile.phone);

    return {
      messageKey: buildMessageKey_(ts, side),
      timestamp: humanTime_(ts),
      side: side || '',
      type: type || 'text',
      text: text || '',
      fileId: fileId || '',
      reply: replyContext
    };
  });
}

function withChatWriteLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function buildVideoPayload_(videoUrl, videoTitle, caption) {
  return JSON.stringify({
    videoUrl: String(videoUrl || '').trim(),
    videoTitle: String(videoTitle || '').trim(),
    caption: String(caption || '').trim()
  });
}

function parseVideoPayload_(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return { videoUrl: '', videoTitle: '', caption: '' };

  try {
    const parsed = JSON.parse(raw);
    return {
      videoUrl: String(parsed.videoUrl || '').trim(),
      videoTitle: String(parsed.videoTitle || '').trim(),
      caption: String(parsed.caption || '').trim()
    };
  } catch (_) {
    // Backward compatibility for old token format: [▶ title|url|thumbnailUrl]
    const m = raw.match(/\[▶\s*([^\|\[\]\n]+)\|(https?:\/\/[^\s\]|]+)(?:\|https?:\/\/[^\s\]|]+)?\]/);
    if (m) {
      return {
        videoUrl: String(m[2] || '').trim(),
        videoTitle: String(m[1] || '').trim(),
        caption: raw.replace(m[0], '').trim()
      };
    }

    return { videoUrl: '', videoTitle: '', caption: raw };
  }
}

function buildDriveImageUrl_(fileId) {
  return fileId
    ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`
    : '';
}

function buildMessageKey_(ts, side) {
  const ms = new Date(ts).getTime();
  return String(ms) + '_' + String(side || '').trim();
}

function resolveReplyContext_(phoneRaw, messageKeyRaw) {
  const phone10 = last10_(phoneRaw);
  const messageKey = String(messageKeyRaw || '').trim();
  if (!phone10 || !messageKey) return null;

  const sh = ensureChatSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const targetMs = Number(messageKey.split('_')[0] || 0);
  let cursorEnd = lastRow;
  while (cursorEnd >= 2) {
    const firstRow = Math.max(2, cursorEnd - CHAT_SCAN_LIMIT + 1);
    const rows = sh.getRange(firstRow, 1, cursorEnd - firstRow + 1, 14).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const side = String(r[4] || '').trim();
      if (last10_(r[1]) !== phone10 || buildMessageKey_(r[0], side) !== messageKey) continue;
      const type = String(r[5] || '').trim() || 'text';
      let preview = buildChatPreviewText_(type, r[6]);
      if (type === 'video') {
        const video = parseVideoPayload_(r[6]);
        preview = video.caption || video.videoTitle || '[Видео]';
      }
      return {
        messageKey,
        side,
        type,
        text: String(preview || (type === 'image' ? '[Фотография]' : '[Сообщение]')).slice(0, 240)
      };
    }

    // CHAT_MESSAGES заполняется по времени. Если весь просмотренный пакет уже
    // старше целевого сообщения, дальше искать бессмысленно.
    const oldestMs = rows.length ? new Date(rows[0][0]).getTime() : 0;
    if (targetMs && oldestMs && oldestMs < targetMs) break;
    cursorEnd = firstRow - 1;
  }
  return null;
}

function parseReplyContext_(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw));
    const messageKey = String(parsed.messageKey || '').trim();
    if (!messageKey) return null;
    return {
      messageKey,
      side: String(parsed.side || '').trim(),
      type: String(parsed.type || 'text').trim(),
      text: String(parsed.text || '').slice(0, 240)
    };
  } catch (_) {
    return null;
  }
}

function normalizeReaction_(reactionRaw) {
  const allowed = ['❤️','👍','👌','🙏','🥰','😁'];
  const reaction = String(reactionRaw || '').trim();
  if (!reaction) return '';
  return allowed.includes(reaction) ? reaction : '';
}

function buildChatPreviewText_(type, cellValue) {
  const raw = String(cellValue || '').trim();
  if (type === 'image') return '[Фотография]';
  if (type === 'video') return '[Видео]';
  if (!raw) return '';

  const cleaned = raw.replace(/\[([^\|\]]+)\|https?:\/\/[^\]]+\]/g, '$1').trim();
  const maxChars = 200;
  if (cleaned.length <= maxChars) return cleaned;

  const truncated = cleaned.substring(0, maxChars);
  const lastSpaceIdx = truncated.lastIndexOf(' ');
  const endText = lastSpaceIdx > 0 ? truncated.substring(0, lastSpaceIdx) : truncated;
  return endText.trim() + '...';
}

function rebuildChatIndex_() {
  const chatSh = ensureChatSheet_();
  const indexSh = ensureChatIndexSheet_();
  const lastRow = chatSh.getLastRow();

  if (lastRow < 2) {
    const existingLastRow = indexSh.getLastRow();
    if (existingLastRow > 1) {
      indexSh.getRange(2, 1, existingLastRow - 1, 12).clearContent();
    }
    return { ok: true, rows: 0 };
  }

  const rows = chatSh.getRange(2, 1, lastRow - 1, 14).getValues();
  const byPhone = {};

  // First pass: group messages by phone and collect all data
  rows.forEach(r => {
    const phone = normalizePhone_(r[1]);
    const phone10 = last10_(phone);
    if (!phone10) return;

    const parentName = String(r[2] || '').trim();
    const childName = String(r[3] || '').trim();
    const side = String(r[4] || '').trim();
    const type = String(r[5] || '').trim() || 'text';
    const text = String(r[6] || '').trim();
    const status = String(r[9] || '').trim() || 'active';
    const readByParent = r[10] === true || String(r[10]).toLowerCase() === 'true';
    const readByEducator = r[11] === true || String(r[11]).toLowerCase() === 'true';
    const tsMs = r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime();

    // Initialize or reuse entry
    if (!byPhone[phone10]) {
      byPhone[phone10] = {
        phone,
        phone10,
        parentName: parentName || '',
        childName: childName || '',
        lastTs: tsMs,
        lastSide: side,
        lastText: buildChatPreviewText_(type, text),
        status: status || 'active',
        hasUnreadParent: false,
        hasUnreadEducator: false,
        hasAnyMessages: false,
        messages: []
      };
    }

    // Update to more recent message info
    if (tsMs > byPhone[phone10].lastTs) {
      byPhone[phone10].lastTs = tsMs;
      byPhone[phone10].lastSide = side;
      byPhone[phone10].lastText = buildChatPreviewText_(type, text);
    }

    if (parentName) byPhone[phone10].parentName = parentName;
    if (childName) byPhone[phone10].childName = childName;
    if (status) byPhone[phone10].status = status;

    byPhone[phone10].hasAnyMessages = true;
    byPhone[phone10].messages.push({
      side: side,
      readByParent: readByParent,
      readByEducator: readByEducator
    });
  });

  // Second pass: determine unread status by checking ALL messages
  Object.keys(byPhone).forEach(phone10 => {
    const chat = byPhone[phone10];
    
    // Check if there are unread messages FROM parent (for educator)
    chat.hasUnreadEducator = chat.messages.some(msg => msg.side === 'parent' && !msg.readByEducator);
    
    // Check if there are unread messages FROM educator (for parent)
    chat.hasUnreadParent = chat.messages.some(msg => msg.side === 'educator' && !msg.readByParent);
  });

  const rowsToWrite = Object.values(byPhone)
    .filter(chat => chat.hasAnyMessages)
    .sort((a, b) => b.lastTs - a.lastTs)
    .map(item => [
      item.phone,
      item.phone10,
      item.parentName || '',
      item.childName || '',
      item.lastTs ? new Date(item.lastTs) : '',
      item.lastSide || '',
      item.lastText || '',
      item.hasUnreadParent ? true : false,
      item.hasUnreadEducator ? true : false,
      item.status || 'active',
      item.hasUnreadParent ? false : true,
      item.hasUnreadEducator ? false : true
    ]);

  const existingLastRow = indexSh.getLastRow();
  if (existingLastRow > 1) {
    indexSh.getRange(2, 1, existingLastRow - 1, 12).clearContent();
  }

  if (rowsToWrite.length > 0) {
    indexSh.getRange(2, 1, rowsToWrite.length, 12).setValues(rowsToWrite);
  }

  return { ok: true, rows: rowsToWrite.length };
}

function upsertChatIndexFromMessage_(profile, side, type, text, ts, readByParent, readByEducator, status) {
  const indexSh = ensureChatIndexSheet_();
  const phone = normalizePhone_(profile && profile.phone ? profile.phone : '');
  const phone10 = last10_(phone);
  if (!phone10) return;

  const baseUnreadParent = side === 'educator';
  const baseUnreadEducator = side === 'parent';

  const rowValues = [
    phone,
    phone10,
    profile.parentName || '',
    profile.childName || '',
    ts || new Date(),
    side || '',
    buildChatPreviewText_(type, text),
    baseUnreadParent,
    baseUnreadEducator,
    status || 'active',
    readByParent || false,
    readByEducator || false
  ];

  const lastRow = indexSh.getLastRow();
  if (lastRow < 2) {
    indexSh.getRange(2, 1, 1, rowValues.length).setValues([rowValues]);
    return;
  }

  const phoneValues = indexSh.getRange(2, 2, lastRow - 1, 1).getValues().flat();
  const rowIndexes = [];
  phoneValues.forEach((v, i) => {
    if (last10_(v) === phone10) rowIndexes.push(i);
  });
  const rowIndex = rowIndexes.length ? rowIndexes[0] : -1;

  if (rowIndex === -1) {
    indexSh.getRange(lastRow + 1, 1, 1, rowValues.length).setValues([rowValues]);
    return;
  }

  for (let i = rowIndexes.length - 1; i >= 1; i--) {
    indexSh.deleteRow(rowIndexes[i] + 2);
  }

  const existing = indexSh.getRange(rowIndex + 2, 1, 1, 12).getValues()[0];
  // Если это новое сообщение от воспитателя, родитель видит непрочитанное
  const nextUnreadParent = side === 'educator' ? true : String(existing[7]).toLowerCase() === 'true';
  // Если это новое сообщение от родителя, воспитатель видит непрочитанное
  const nextUnreadEducator = side === 'parent' ? true : String(existing[8]).toLowerCase() === 'true';
  // Preserve read_by flags from existing row
  const nextReadByParent = existing[10] === true || String(existing[10]).toLowerCase() === 'true';
  const nextReadByEducator = existing[11] === true || String(existing[11]).toLowerCase() === 'true';

  indexSh.getRange(rowIndex + 2, 1, 1, 12).setValues([[
    rowValues[0],
    rowValues[1],
    rowValues[2],
    rowValues[3],
    rowValues[4],
    rowValues[5],
    rowValues[6],
    nextUnreadParent,
    nextUnreadEducator,
    rowValues[9],
    nextReadByParent,
    nextReadByEducator
  ]]);
}

function setChatIndexReadFlag_(phoneRaw, columnIndex, value) {
  const phone10 = last10_(phoneRaw);
  if (!phone10) return;

  const indexSh = ensureChatIndexSheet_();
  const lastRow = indexSh.getLastRow();
  if (lastRow < 2) return;

  const phoneValues = indexSh.getRange(2, 2, lastRow - 1, 1).getValues().flat();
  const rowIndex = phoneValues.findIndex(v => last10_(v) === phone10);
  if (rowIndex === -1) return;

  indexSh.getRange(rowIndex + 2, columnIndex, 1, 1).setValue(!!value);
}

function getChatIndexEntryByPhone_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  if (!phone10) return null;

  const indexSh = ensureChatIndexSheet_();
  const lastRow = indexSh.getLastRow();
  if (lastRow < 2) return null;

  const rows = indexSh.getRange(2, 1, lastRow - 1, 12).getValues();
  for (const r of rows) {
    if (last10_(r[1]) !== phone10) continue;

    return {
      phone: normalizePhone_(r[0]),
      parentName: String(r[2] || '').trim(),
      childName: String(r[3] || '').trim()
    };
  }

  return null;
}

function getChatIndexUnreadFlag_(phoneRaw, columnIndex) {
  const phone10 = last10_(phoneRaw);
  if (!phone10) return null;

  const indexSh = ensureChatIndexSheet_();
  let lastRow = indexSh.getLastRow();

  if (lastRow < 2) {
    rebuildChatIndex_();
    lastRow = indexSh.getLastRow();
  }

  if (lastRow < 2) return false;

  const width = Math.max(1, columnIndex - 1);
  const rows = indexSh.getRange(2, 2, lastRow - 1, width).getValues(); // B:target
  const valueOffset = columnIndex - 2;

  for (const r of rows) {
    if (last10_(r[0]) !== phone10) continue;
    return r[valueOffset] === true || String(r[valueOffset]).toLowerCase() === 'true';
  }

  return null;
}

function buildLatestChatIndexItems_(rows) {
  const byPhone = {};

  rows.forEach(r => {
    const phone = String(r[0] || '').trim();
    const phone10 = String(r[1] || '').trim() || last10_(phone);
    if (!phone || !phone10) return;

    const tsMs = r[4] instanceof Date ? r[4].getTime() : new Date(r[4]).getTime();
    const item = {
      phone,
      phone10,
      parentName: String(r[2] || '').trim(),
      childName: String(r[3] || '').trim(),
      tsMs: Number.isFinite(tsMs) ? tsMs : 0,
      lastSide: String(r[5] || '').trim(),
      lastText: String(r[6] || '').trim(),
      hasUnreadParent: String(r[7]).toLowerCase() === 'true',
      hasUnreadEducator: String(r[8]).toLowerCase() === 'true',
      readByParent: r[10] === true || String(r[10]).toLowerCase() === 'true',
      readByEducator: r[11] === true || String(r[11]).toLowerCase() === 'true',
      status: String(r[9] || '').trim() || 'active'
    };

    const previous = byPhone[phone10];
    if (!previous || item.tsMs >= previous.tsMs) {
      byPhone[phone10] = item;
    }
  });

  return Object.values(byPhone);
}

function cleanupExpiredChatImages() {
  const sh = ensureChatSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const rows = sh.getRange(2, 1, lastRow - 1, 13).getValues();
  const now = Date.now();

  const rowsToDelete = [];
  const filesToDelete = [];

  for (let i = 0; i < rows.length; i++) {
    const type        = String(rows[i][5] || '').trim(); // TYPE
    const fileId      = String(rows[i][7] || '').trim(); // FILE_ID
    const deleteAfter = rows[i][8];                      // DELETE_AFTER

    if (type === 'image' && fileId && deleteAfter) {
      let deleteTs;
      
      if (typeof deleteAfter === 'string') {
        // Если строка, попробуем распарсить
        deleteTs = new Date(deleteAfter).getTime();
      } else if (deleteAfter instanceof Date) {
        deleteTs = deleteAfter.getTime();
      } else {
        // Попробуем расценить как число миллисекунд
        deleteTs = Number(deleteAfter) > 1e10 ? Number(deleteAfter) : new Date(deleteAfter).getTime();
      }

      if (!isNaN(deleteTs) && deleteTs <= now) {
        filesToDelete.push(fileId);
        rowsToDelete.push(i + 2); // +2 потому что данные начинаются со 2 строки
      }
    }
  }

  // Удаляем файлы из Drive
  for (const fileId of filesToDelete) {
    try {
      const file = DriveApp.getFileById(fileId);
      file.setTrashed(true);
    } catch (e) {
      // Файл уже удален или недоступен - это нормально
      Logger.log('File cleanup error for ' + fileId + ': ' + e.message);
    }
  }

  // Удаляем строки из таблицы в обратном порядке
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sh.deleteRow(rowsToDelete[i]);
  }

  if (rowsToDelete.length > 0) {
    rebuildChatIndex_();
    clearGetChatMessagesCache();
  }
}

function getProfileByPhone_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  if (!phone10) return null;

  if (!isPhoneActiveInReports_(phone10)) return null;

  const sh = getDataSheet_();

  if (sh) {
    const lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      const values = sh.getRange(2, 1, lastRow - 1, 7).getValues(); // A:G

      for (const r of values) {
        if (last10_(r[0]) !== phone10) continue;

        return buildProfileFromReportRow_(r);
      }
    }
  }

  const chatSh = ensureChatSheet_();
  const chatLastRow = chatSh.getLastRow();

  if (chatLastRow >= 2) {
    const latestRows = getChatRowsForPhone_(phone10, '', 1).rows;
    if (latestRows.length) {
      const r = latestRows[latestRows.length - 1];

      return {
        phone: normalizePhone_(r[1]),
        parentName: String(r[2] || '').trim(),
        childName:  String(r[3] || '').trim()
      };
    }
  }

  return null;
}

function getChatProfileByPhone_(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  if (!phone10) return null;

  const activeProfile = getProfileByPhone_(phoneRaw);
  if (activeProfile) return activeProfile;

  const sh = getDataSheet_();
  if (sh) {
    const lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      const values = sh.getRange(2, 1, lastRow - 1, 7).getValues();
      for (const r of values) {
        if (last10_(r[0]) === phone10) {
          return buildProfileFromReportRow_(r);
        }
      }
    }
  }

  const indexProfile = getChatIndexEntryByPhone_(phone10);
  if (indexProfile) return indexProfile;

  const latestRows = getChatRowsForPhone_(phone10, '', 1).rows;
  if (latestRows.length) {
    const r = latestRows[latestRows.length - 1];
    return {
      phone: normalizePhone_(r[1]),
      parentName: String(r[2] || '').trim(),
      childName: String(r[3] || '').trim()
    };
  }

  return {
    phone: normalizePhone_(phoneRaw),
    parentName: '',
    childName: ''
  };
}

function listParentChats(tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const userCache = CacheService.getUserCache();
    const scriptCache = CacheService.getScriptCache();
    const cacheKey = 'listParentChats_result';
    const cached = userCache.get(cacheKey) || scriptCache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const sh = ensureChatIndexSheet_();
    const lastRow = sh.getLastRow();

    if (lastRow < 2) {
      rebuildChatIndex_();
    }

    const freshLastRow = sh.getLastRow();
    if (freshLastRow < 2) return { ok: true, chats: [] };

    const rows = sh.getRange(2, 1, freshLastRow - 1, 12).getValues();
    const activePhones = getActiveReportPhonesSet_();

    const chats = buildLatestChatIndexItems_(rows)
      .map(x => ({
        ...x,
        hasUnread: x.hasUnreadParent
      }))
      .filter(x => x.phone && x.phone10 && x.status !== 'deleted' && activePhones.has(x.phone10))
      .sort((a, b) => b.tsMs - a.tsMs) // Sort by timestamp only
      .map(x => ({
        phone: x.phone,
        parentName: x.parentName,
        childName: x.childName,
        lastSide: x.lastSide,
        lastText: x.lastText,
        hasUnread: x.hasUnread
      }));

    // Cache for 3 seconds - enough to absorb bursts, but still feel live.
    const payload = JSON.stringify({ ok: true, chats });
    userCache.put(cacheKey, payload, 3);
    scriptCache.put(cacheKey, payload, 3);

    return { ok: true, chats };

  } catch (e) {
    return { ok: false, message: 'Ошибка загрузки списка чатов: ' + (e.message || e) };
  }
}

/**
 * Получить только чаты с непрочитанными сообщениями для воспитателя
 */
function listUnreadParentChats(tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const userCache = CacheService.getUserCache();
    const scriptCache = CacheService.getScriptCache();
    const cacheKey = 'listUnreadParentChats_result';
    const cached = userCache.get(cacheKey) || scriptCache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const sh = ensureChatIndexSheet_();
    const lastRow = sh.getLastRow();

    if (lastRow < 2) {
      rebuildChatIndex_();
    }

    const freshLastRow = sh.getLastRow();
    if (freshLastRow < 2) return { ok: true, chats: [] };

    const rows = sh.getRange(2, 1, freshLastRow - 1, 12).getValues();
    const activePhones = getActiveReportPhonesSet_();
    const pins = getEducatorChatPins_();

    const chats = buildLatestChatIndexItems_(rows)
      .filter(x => x.phone && x.phone10 && x.status !== 'deleted' && activePhones.has(x.phone10) &&
        (x.hasUnreadEducator || pins[x.phone10] === 'unread'))
      .sort((a, b) => {
        const pinDiff = Number(pins[b.phone10] === 'unread') - Number(pins[a.phone10] === 'unread');
        return pinDiff || b.tsMs - a.tsMs;
      })
      .map(x => ({
        phone: x.phone,
        parentName: x.parentName,
        childName: x.childName,
        lastSide: x.lastSide,
        lastText: x.lastText,
        hasUnread: x.hasUnreadEducator,
        pinnedBucket: pins[x.phone10] || ''
      }));

    const payload = JSON.stringify({ ok: true, chats });
    userCache.put(cacheKey, payload, 3);
    scriptCache.put(cacheKey, payload, 3);

    return { ok: true, chats };

  } catch (e) {
    return { ok: false, message: 'Ошибка загрузки непрочитанных чатов: ' + (e.message || e) };
  }
}

/**
 * Получить только прочитанные чаты 
 */
function listReadParentChats(tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const userCache = CacheService.getUserCache();
    const scriptCache = CacheService.getScriptCache();
    const cacheKey = 'listReadParentChats_result';
    const cached = userCache.get(cacheKey) || scriptCache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const sh = ensureChatIndexSheet_();
    const lastRow = sh.getLastRow();

    if (lastRow < 2) {
      rebuildChatIndex_();
    }

    const freshLastRow = sh.getLastRow();
    if (freshLastRow < 2) return { ok: true, chats: [] };

    const rows = sh.getRange(2, 1, freshLastRow - 1, 12).getValues();
    const activePhones = getActiveReportPhonesSet_();
    const pins = getEducatorChatPins_();

    const chats = buildLatestChatIndexItems_(rows)
      .filter(x => x.phone && x.phone10 && x.status !== 'deleted' && activePhones.has(x.phone10) &&
        (!x.hasUnreadEducator || pins[x.phone10] === 'read'))
      .sort((a, b) => {
        const pinDiff = Number(pins[b.phone10] === 'read') - Number(pins[a.phone10] === 'read');
        return pinDiff || b.tsMs - a.tsMs;
      })
      .map(x => ({
        phone: x.phone,
        parentName: x.parentName,
        childName: x.childName,
        lastSide: x.lastSide,
        lastText: x.lastText,
        hasUnread: x.hasUnreadEducator,
        pinnedBucket: pins[x.phone10] || ''
      }));

    const payload = JSON.stringify({ ok: true, chats });
    userCache.put(cacheKey, payload, 3);
    scriptCache.put(cacheKey, payload, 3);

    return { ok: true, chats };

  } catch (e) {
    return { ok: false, message: 'Ошибка загрузки прочитанных чатов: ' + (e.message || e) };
  }
}

function hasUnreadParentChats(tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const sh = ensureChatIndexSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, hasUnread: false };

    const rows = sh.getRange(2, 1, lastRow - 1, 12).getValues();

    const hasUnread = rows.some(r => {
      // Column I (index 8) = HAS_UNREAD_EDUCATOR (new messages from parent FOR educator)
      const hasUnreadEducator = String(r[8]).toLowerCase() === 'true';
      const status = String(r[9] || '').trim().toLowerCase();

      return hasUnreadEducator && status === 'active';
    });

    return { ok: true, hasUnread };
  } catch (e) {
    return {
      ok: false,
      hasUnread: false,
      message: 'Ошибка проверки новых сообщений: ' + (e.message || e)
    };
  }
}

function buildChatMessageFromRow_(r) {
  const ts     = r[0];
  const side   = String(r[4] || '').trim();
  const type   = String(r[5] || '').trim() || 'text';
  const textCell = String(r[6] || '').trim();
  const fileId = String(r[7] || '').trim();
  const reaction = normalizeReaction_(r[12] || '');
  const reply = parseReplyContext_(r[13]);

  const readByParent   = r[10] === true || String(r[10]).toLowerCase() === 'true';
  const readByEducator = r[11] === true || String(r[11]).toLowerCase() === 'true';

  let mediaUrl = '';
  let videoUrl = '';
  let videoTitle = '';
  let text = textCell;

  if (fileId) {
    if (type === 'image') {
      mediaUrl = buildDriveImageUrl_(fileId);
    } else if (type === 'video') {
      mediaUrl = buildDriveImageUrl_(fileId);
    }
  }

  if (type === 'video') {
    const parsedVideo = parseVideoPayload_(textCell);
    videoUrl = parsedVideo.videoUrl;
    videoTitle = parsedVideo.videoTitle;
    text = parsedVideo.caption;
  }

  return {
    messageKey: buildMessageKey_(ts, side),
    side,
    type,
    text,
    mediaUrl,
    videoUrl,
    videoTitle,
    parentName: String(r[2] || '').trim(),
    childName: String(r[3] || '').trim(),
    timestamp: humanTime_(ts),
    readByParent,
    readByEducator,
    reaction,
    reply
  };
}

function getChatRowsForPhone_(phoneRaw, beforeKeyRaw, limitRaw) {
  const phone10 = last10_(phoneRaw);
  const beforeKey = String(beforeKeyRaw || '').trim();
  const limit = Math.max(1, Number(limitRaw) || CHAT_THREAD_INITIAL_LIMIT);
  const sh = ensureChatSheet_();
  const lastRow = sh.getLastRow();

  if (!phone10 || lastRow < 2) {
    return { rows: [], hasMore: false };
  }

  const firstDataRow = 2;
  const batchSize = Math.max(CHAT_SCAN_LIMIT, limit * 6);
  const collected = [];
  let hasMore = false;
  let seenBeforeKey = !beforeKey;
  let cursorEnd = lastRow;

  while (cursorEnd >= firstDataRow && collected.length < limit + 1) {
    const batchStart = Math.max(firstDataRow, cursorEnd - batchSize + 1);
    const batchRows = cursorEnd - batchStart + 1;
    const rows = sh.getRange(batchStart, 1, batchRows, 14).getValues();

    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (last10_(r[1]) !== phone10) continue;

      const rowKey = buildMessageKey_(r[0], String(r[4] || '').trim());
      if (!seenBeforeKey) {
        if (rowKey === beforeKey) {
          seenBeforeKey = true;
        }
        continue;
      }

      collected.push(r);
      if (collected.length > limit) {
        hasMore = true;
        break;
      }
    }

    cursorEnd = batchStart - 1;
  }

  if (!seenBeforeKey && beforeKey) {
    return getChatRowsForPhone_(phone10, '', limit);
  }

  if (collected.length > limit) {
    collected.length = limit;
  }

  collected.reverse();
  return { rows: collected, hasMore };
}

function getChatMessages(phoneRaw, options, tutorTokenRaw) {
  // A one-argument educator call is also supported: getChatMessages(phone, token).
  if (typeof options === 'string' && tutorTokenRaw === undefined) {
    tutorTokenRaw = options;
    options = {};
  }
  requireTutorSession_(tutorTokenRaw);
  return getChatMessagesCore_(phoneRaw, options);
}

function getChatMessagesCore_(phoneRaw, options) {
  try {
    const phone10 = last10_(phoneRaw);
    if (!phone10) return { ok: false, message: 'Некорректный номер телефона.' };

    options = options || {};
    const beforeKey = String(options.beforeKey || '').trim();
    const limitRaw = Number(options.limit || (beforeKey ? CHAT_THREAD_OLDER_LIMIT : CHAT_THREAD_INITIAL_LIMIT));
    const limit = Math.max(1, Math.min(150, Number.isFinite(limitRaw) ? limitRaw : CHAT_THREAD_INITIAL_LIMIT));
    const isClosed = !isPhoneActiveInReports_(phone10);

    const cache = CacheService.getUserCache();
    const cacheKey = 'getChatMessages_' + phone10 + '_' + (beforeKey || 'latest') + '_' + limit;
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const profile = getChatProfileByPhone_(phoneRaw);
    const page = getChatRowsForPhone_(phone10, beforeKey, limit);
    const messages = page.rows.map(buildChatMessageFromRow_);

    const result = {
      ok: true,
      phone: profile ? profile.phone : normalizePhone_(phoneRaw),
      parentName: profile ? profile.parentName : '',
      childName: profile ? profile.childName : '',
      messages,
      hasMore: !!page.hasMore,
      closed: isClosed
    };

    cache.put(cacheKey, JSON.stringify(result), 1);

    return result;

  } catch (e) {
    return { ok: false, message: 'Ошибка загрузки чата: ' + (e.message || e) };
  }
}

function getParentChatMessages(phoneRaw, options, parentSessionRaw) {
  requireParentAccess_(phoneRaw, parentSessionRaw);
  return getChatMessagesCore_(phoneRaw, options);
}

function getOlderParentChatMessages(phoneRaw, beforeKeyRaw, parentSessionRaw) {
  return getParentChatMessages(phoneRaw, {
    beforeKey: beforeKeyRaw,
    limit: CHAT_THREAD_OLDER_LIMIT
  }, parentSessionRaw);
}

function getOlderChatMessages(phoneRaw, beforeKeyRaw, tutorTokenRaw) {
  requireTutorSession_(tutorTokenRaw);
  return getChatMessagesCore_(phoneRaw, {
    beforeKey: beforeKeyRaw,
    limit: CHAT_THREAD_OLDER_LIMIT
  });
}

function clearGetChatMessagesCache(phoneRaw) {
  const phone10 = last10_(phoneRaw);
  const userCache = CacheService.getUserCache();
  const scriptCache = CacheService.getScriptCache();

  if (phone10) {
    userCache.remove('getChatMessages_' + phone10);
    scriptCache.remove('getChatMessages_' + phone10);
    userCache.removeAll([
      'getChatMessages_' + phone10 + '_latest_' + CHAT_THREAD_INITIAL_LIMIT,
      'getChatMessages_' + phone10 + '_latest_' + CHAT_THREAD_OLDER_LIMIT
    ]);
    scriptCache.removeAll([
      'getChatMessages_' + phone10 + '_latest_' + CHAT_THREAD_INITIAL_LIMIT,
      'getChatMessages_' + phone10 + '_latest_' + CHAT_THREAD_OLDER_LIMIT
    ]);
  }

  userCache.remove('listParentChats_result');
  scriptCache.remove('listParentChats_result');
  userCache.remove('listUnreadParentChats_result');
  scriptCache.remove('listUnreadParentChats_result');
  userCache.remove('listReadParentChats_result');
  scriptCache.remove('listReadParentChats_result');
}

function setChatMessageReaction(phoneRaw, messageKeyRaw, reactionRaw) {
  try {
    const phone10 = last10_(phoneRaw);
    const messageKey = String(messageKeyRaw || '').trim();
    const reaction = normalizeReaction_(reactionRaw);

    if (!phone10) return { ok: false, message: 'Некорректный номер телефона.' };
    if (!messageKey) return { ok: false, message: 'Не найдено сообщение для реакции.' };

    const sh = ensureChatSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, message: 'Сообщения не найдены.' };

    const startRow = 2;
    const rows = sh.getRange(startRow, 1, lastRow - startRow + 1, 13).getValues();

    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const rowPhone10 = last10_(r[1]);
      const rowSide = String(r[4] || '').trim();
      const rowKey = buildMessageKey_(r[0], rowSide);

      if (rowPhone10 !== phone10) continue;
      if (rowKey !== messageKey) continue;

      const currentReaction = normalizeReaction_(r[12] || '');

      const nextReaction = (currentReaction === reaction) ? '' : reaction;

      // rows are loaded from startRow, so the sheet row index is offset
      sh.getRange(startRow + i, 13).setValue(nextReaction);
      clearGetChatMessagesCache(phoneRaw);

      return { ok: true, reaction: nextReaction };
    }

    return { ok: false, message: 'Сообщение для реакции не найдено.' };

  } catch (e) {
    return { ok: false, message: 'Ошибка сохранения реакции: ' + (e.message || e) };
  }
}

function deleteMessage(phoneRaw, messageKeyRaw, actorSideRaw, tutorTokenRaw) {
  try {
    const phone10 = last10_(phoneRaw);
    const messageKey = String(messageKeyRaw || '').trim();
    const actorSide = String(actorSideRaw || 'educator').trim().toLowerCase();

    if (actorSide === 'educator') requireTutorSession_(tutorTokenRaw);

    if (!phone10) return { ok: false, message: 'Некорректный номер телефона.' };
    if (!messageKey) return { ok: false, message: 'Не найдено сообщение для удаления.' };
    if (!['parent', 'educator'].includes(actorSide)) return { ok: false, message: 'Некорректная сторона чата.' };

    if (!isPhoneActiveInReports_(phone10)) {
      return { ok: false, message: 'Чат больше недоступен.' };
    }

    const sh = ensureChatSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, message: 'Сообщение не найдено.' };

    const startRow = 2;
    const rows = sh.getRange(startRow, 1, lastRow - startRow + 1, 13).getValues();

    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const rowPhone10 = last10_(r[1]);
      const rowSide = String(r[4] || '').trim();
      const rowKey = buildMessageKey_(r[0], rowSide);

      if (rowPhone10 !== phone10) continue;
      if (rowKey !== messageKey) continue;
      if (rowSide !== actorSide) {
        return { ok: false, message: 'Можно удалять только свои сообщения.' };
      }

      sh.deleteRow(startRow + i);

      rebuildChatIndex_();

      clearGetChatMessagesCache(phoneRaw);
      return { ok: true, message: 'Сообщение удалено.' };
    }

    return { ok: false, message: 'Сообщение не найдено.' };

  } catch (e) {
    return { ok: false, message: 'Ошибка удаления сообщения: ' + (e.message || e) };
  }
}

function updateMessage(phoneRaw, messageKeyRaw, newTextRaw, actorSideRaw, tutorTokenRaw) {
  try {
    const phone10 = last10_(phoneRaw);
    const messageKey = String(messageKeyRaw || '').trim();
    const newText = cleanIncomingText_(newTextRaw);
    const actorSide = String(actorSideRaw || 'educator').trim().toLowerCase();

    if (actorSide === 'educator') requireTutorSession_(tutorTokenRaw);

    if (!phone10) return { ok: false, message: 'Некорректный номер телефона.' };
    if (!messageKey) return { ok: false, message: 'Не найдено сообщение для редактирования.' };
    if (!newText) return { ok: false, message: 'Пустой текст.' };
    if (!['parent', 'educator'].includes(actorSide)) return { ok: false, message: 'Некорректная сторона чата.' };

    if (!isPhoneActiveInReports_(phone10)) {
      return { ok: false, message: 'Чат больше недоступен.' };
    }

    const sh = ensureChatSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, message: 'Сообщение не найдено.' };

    const startRow = 2;
    const rows = sh.getRange(startRow, 1, lastRow - startRow + 1, 13).getValues();

    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const rowPhone10 = last10_(r[1]);
      const rowSide = String(r[4] || '').trim();
      const rowKey = buildMessageKey_(r[0], rowSide);

      if (rowPhone10 !== phone10) continue;
      if (rowKey !== messageKey) continue;

      if (rowSide !== actorSide) {
        return { ok: false, message: 'Можно редактировать только свои сообщения.' };
      }

      sh.getRange(startRow + i, 7).setValue(newText);

      rebuildChatIndex_();

      clearGetChatMessagesCache(phoneRaw);
      return { ok: true, message: 'Сообщение обновлено.' };
    }

    return { ok: false, message: 'Сообщение не найдено.' };

  } catch (e) {
    return { ok: false, message: 'Ошибка редактирования сообщения: ' + (e.message || e) };
  }
}

function isD1ChatBackendActive_() {
  return String(PropertiesService.getScriptProperties().getProperty('CHAT_BACKEND') || 'sheets') === 'd1';
}

// Keeps the old Apps Script UI contract while making D1 the only write that
// determines success.  The Worker itself schedules push strictly after the
// insert, so legacy clients cannot produce a Sheets-only/push-only message.
function legacyD1MessageResult_(result) {
  if (!result || !result.ok || !result.message) {
    return result || { ok:false, message:'Не удалось сохранить сообщение в чате.' };
  }

  const message = result.message;
  return {
    ok: true,
    messageKey: String(message.messageKey || ''),
    timestamp: humanTime_(new Date(Number(message.timestamp || Date.now()))),
    type: String(message.type || 'text'),
    text: String(message.text || ''),
    fileId: String(message.fileId || '')
  };
}

function sendParentChatMessage(phoneRaw, textRaw, replyToKeyRaw, parentSessionRaw) {
  try {
    requireParentAccess_(phoneRaw, parentSessionRaw);
    const text = cleanIncomingText_(textRaw);
    if (!isPhoneActiveInReports_(phoneRaw)) {
      return { ok: false, message: 'Чат больше недоступен.' };
    }
    if (!text) return { ok: false, message: 'Пустое сообщение.' };

    const profile = getProfileByPhone_(phoneRaw);
    if (!profile || !profile.phone) {
      return { ok: false, message: 'Ваш номер не найден в системе.' };
    }

    // Old cached Apps Script pages can still call this server function even
    // after the visible product moved to Timeweb.  Once D1 is active, never
    // let that compatibility path create a Sheets-only message: the Worker
    // stores the canonical message before it sends a push notification.
    if (isD1ChatBackendActive_()) {
      return legacyD1MessageResult_(
        sendD1MessageForParent(phoneRaw, {
          type: 'text',
          text: text,
          replyToKey: String(replyToKeyRaw || '')
        })
      );
    }

    const appended = appendChatMessage_(profile, 'parent', 'text', text, '', '', 'active', replyToKeyRaw);
    const pushResult = notifyNewChatMessage_(profile, 'parent', 'text', text);
    clearGetChatMessagesCache(phoneRaw);

    return {
      ok: true,
      messageKey: appended.messageKey,
      timestamp: appended.timestamp,
      type: appended.type,
      pushClient: pushResult && pushResult.fallback ? pushResult.fallback : pushResult,
      pushDebug: pushResult && pushResult.server ? pushResult.server : pushResult
    };

  } catch (e) {
    return { ok: false, message: 'Ошибка отправки сообщения: ' + (e.message || e) };
  }
}

function sendEducatorChatMessage(phoneRaw, textRaw, replyToKeyRaw, tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const text = cleanIncomingText_(textRaw);

    if (!isPhoneActiveInReports_(phoneRaw)) {
      return { ok: false, message: 'Диалог с родителем был закрыт.' };
    }
    if (!text) return { ok: false, message: 'Пустое сообщение.' };

    const profile = getProfileByPhone_(phoneRaw);
    if (!profile || !profile.phone) {
      return { ok: false, message: 'Не удалось определить чат по номеру телефона.' };
    }

    if (isD1ChatBackendActive_()) {
      return legacyD1MessageResult_(
        sendD1MessageForEducator(phoneRaw, {
          type: 'text',
          text: text,
          replyToKey: String(replyToKeyRaw || '')
        }, tutorTokenRaw)
      );
    }

    const appended = appendChatMessage_(profile, 'educator', 'text', text, '', '', 'active', replyToKeyRaw);
    const pushResult = notifyNewChatMessage_(profile, 'educator', 'text', text);
    clearGetChatMessagesCache(phoneRaw);

    return {
      ok: true,
      messageKey: appended.messageKey,
      timestamp: appended.timestamp,
      type: appended.type,
      pushClient: pushResult && pushResult.fallback ? pushResult.fallback : pushResult,
      pushDebug: pushResult && pushResult.server ? pushResult.server : pushResult
    };

  } catch (e) {
    return { ok: false, message: 'Ошибка отправки ответа: ' + (e.message || e) };
  }
}

function uploadEducatorChatImage(phoneRaw, fileName, mimeType, base64Data, textRaw, replyToKeyRaw, tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    if (!isPhoneActiveInReports_(phoneRaw)) {
      return { ok: false, message: 'Чат больше недоступен.' };
    }

    const profile = getProfileByPhone_(phoneRaw);
    if (!profile || !profile.phone) {
      return { ok: false, message: 'Не удалось определить чат.' };
    }

    if (!base64Data || !mimeType) {
      return { ok: false, message: 'Файл не получен.' };
    }

    if (!/^image\//i.test(mimeType)) {
      return { ok: false, message: 'Можно загружать только фото.' };
    }

    const bytes = Utilities.base64Decode(base64Data);
    const safeName = String(fileName || 'image')
      .replace(/[^\wа-яА-ЯёЁ.\- ]/g, '_')
      .trim() || 'image';

    const blob = Utilities.newBlob(bytes, mimeType, safeName);
    const folder = getChatPhotosFolder_();
    const file = folder.createFile(blob);

    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const deleteAfter = new Date(Date.now() + CHAT_IMAGE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const text = cleanIncomingText_(textRaw);

    const appended = appendChatMessage_(
      profile,
      'educator',
      'image',
      text,
      file.getId(),
      deleteAfter,
      'active',
      replyToKeyRaw
    );
    const pushClient = notifyNewChatMessage_(profile, 'educator', 'image', text);

    ensureChatCleanupTrigger_();
    clearGetChatMessagesCache(phoneRaw);

    return {
      ok: true,
      url: buildDriveImageUrl_(file.getId()),
      type: 'image',
      messageKey: appended.messageKey,
      timestamp: appended.timestamp,
      pushClient
    };

  } catch (e) {
    return { ok: false, message: 'Ошибка загрузки файла: ' + (e.message || e) };
  }
}

function uploadEducatorVideoThumbnail(phoneRaw, fileName, mimeType, base64Data, tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    if (!isPhoneActiveInReports_(phoneRaw)) {
      return { ok: false, message: 'Чат больше недоступен.' };
    }

    const profile = getProfileByPhone_(phoneRaw);
    if (!profile || !profile.phone) {
      return { ok: false, message: 'Не удалось определить чат.' };
    }

    if (!base64Data || !mimeType) {
      return { ok: false, message: 'Файл не получен.' };
    }

    const isImage = /^image\//i.test(mimeType);
    const isVideo = /^video\//i.test(mimeType);

    if (!isImage && !isVideo) {
      return { ok: false, message: 'Можно загружать только фото или короткое видео.' };
    }

    const bytes = Utilities.base64Decode(base64Data);
    const safeName = String(fileName || 'video_thumbnail')
      .replace(/[^\wа-яА-ЯёЁ.\- ]/g, '_')
      .trim() || 'video_thumbnail';

    const blob = Utilities.newBlob(bytes, mimeType, safeName);
    const folder = getChatPhotosFolder_();
    const file = folder.createFile(blob);

    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return {
      ok: true,
      url: buildDriveImageUrl_(file.getId()),
      fileId: file.getId()
    };

  } catch (e) {
    return { ok: false, message: 'Ошибка загрузки обложки: ' + (e.message || e) };
  }
}

function sendEducatorVideoMessage(phoneRaw, videoUrlRaw, videoTitleRaw, thumbnailFileIdRaw, captionRaw, replyToKeyRaw, tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    if (!isPhoneActiveInReports_(phoneRaw)) {
      return { ok: false, message: 'Диалог с родителем был закрыт.' };
    }

    const profile = getProfileByPhone_(phoneRaw);
    if (!profile || !profile.phone) {
      return { ok: false, message: 'Не удалось определить чат по номеру телефона.' };
    }

    const videoUrl = String(videoUrlRaw || '').trim();
    const videoTitle = String(videoTitleRaw || '').trim();
    const thumbnailFileId = String(thumbnailFileIdRaw || '').trim();
    const caption = cleanIncomingText_(captionRaw);

    if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
      return { ok: false, message: 'Укажите корректную ссылку на видео.' };
    }

    const payload = buildVideoPayload_(videoUrl, videoTitle, caption);

    const appended = appendChatMessage_(
      profile,
      'educator',
      'video',
      payload,
      thumbnailFileId,
      '',
      'active',
      replyToKeyRaw
    );
    const pushClient = notifyNewChatMessage_(profile, 'educator', 'video', payload);

    clearGetChatMessagesCache(phoneRaw);

    return {
      ok: true,
      type: 'video',
      videoUrl,
      videoTitle,
      caption,
      thumbnailUrl: thumbnailFileId ? buildDriveImageUrl_(thumbnailFileId) : '',
      messageKey: appended.messageKey,
      timestamp: appended.timestamp,
      pushClient
    };
  } catch (e) {
    return { ok: false, message: 'Ошибка отправки видео: ' + (e.message || e) };
  }
}

function uploadParentChatImage(phoneRaw, fileName, mimeType, base64Data, textRaw, replyToKeyRaw, parentSessionRaw) {
  try {
    requireParentAccess_(phoneRaw, parentSessionRaw);
    if (!isPhoneActiveInReports_(phoneRaw)) {
      return { ok: false, message: 'Чат больше недоступен.' };
    }
    
    const profile = getProfileByPhone_(phoneRaw);
    if (!profile || !profile.phone) {
      return { ok: false, message: 'Ваш номер не найден в системе.' };
    }

    if (!base64Data || !mimeType) {
      return { ok: false, message: 'Файл не получен.' };
    }

    if (!/^image\//i.test(mimeType)) {
      return { ok: false, message: 'Можно загружать только фото.' };
    }

    const bytes = Utilities.base64Decode(base64Data);
    const safeName = String(fileName || 'image')
      .replace(/[^\wа-яА-ЯёЁ.\- ]/g, '_')
      .trim() || 'image';

    const blob = Utilities.newBlob(bytes, mimeType, safeName);
    const folder = getChatPhotosFolder_();
    const file = folder.createFile(blob);

    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const deleteAfter = new Date(Date.now() + CHAT_IMAGE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const text = cleanIncomingText_(textRaw);

    const appended = appendChatMessage_(
      profile,
      'parent',
      'image',
      text,
      file.getId(),
      deleteAfter,
      'active',
      replyToKeyRaw
    );
    const pushClient = notifyNewChatMessage_(profile, 'parent', 'image', text);

    ensureChatCleanupTrigger_();
    clearGetChatMessagesCache(phoneRaw);

    return {
      ok: true,
      url: buildDriveImageUrl_(file.getId()),
      type: 'image',
      messageKey: appended.messageKey,
      timestamp: appended.timestamp,
      pushClient
    };

  } catch (e) {
    return { ok: false, message: 'Ошибка загрузки файла: ' + (e.message || e) };
  }
}

function uploadChatAttachmentForD1(phoneRaw, fileName, mimeType, base64Data, roleRaw, tutorTokenRaw) {
  try {
    const role = String(roleRaw || '').trim().toLowerCase();
    if (!['parent', 'educator'].includes(role)) return { ok:false, message:'Некорректная роль.' };
    if (role === 'educator') requireTutorSession_(tutorTokenRaw);
    if (!isPhoneActiveInReports_(phoneRaw)) return { ok:false, message:'Чат больше недоступен.' };
    const profile = getProfileByPhone_(phoneRaw);
    if (!profile || !profile.phone) return { ok:false, message:'Чат не найден.' };
    if (!base64Data || !/^image\//i.test(String(mimeType || ''))) return { ok:false, message:'Можно загружать только фото.' };
    const safeName = String(fileName || 'image').replace(/[^\wа-яА-ЯёЁ.\- ]/g, '_').trim() || 'image';
    const file = getChatPhotosFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, safeName));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    ensureChatCleanupTrigger_();
    return { ok:true, fileId:file.getId(), url:buildDriveImageUrl_(file.getId()), deleteAfter:Date.now() + CHAT_IMAGE_TTL_DAYS * 86400000 };
  } catch (e) { return { ok:false, message:'Ошибка загрузки файла: ' + (e.message || e) }; }
}

function notifyD1ChatMessage(phoneRaw, roleRaw, typeRaw, textRaw, tutorTokenRaw) {
  try {
    const role = String(roleRaw || '').trim().toLowerCase();
    if (!['parent', 'educator'].includes(role)) return { ok:false, message:'Некорректная роль.' };
    if (role === 'educator') requireTutorSession_(tutorTokenRaw);
    const profile = getProfileByPhone_(phoneRaw);
    if (!profile || !profile.phone) return { ok:false, message:'Чат не найден.' };
    const push = notifyNewChatMessage_(profile, role, String(typeRaw || 'text'), String(textRaw || ''));
    return { ok:true, pushClient:push && push.fallback ? push.fallback : push };
  } catch (e) { return { ok:false, message:'Ошибка уведомления: ' + (e.message || e) }; }
}

function listAvailableParentsForChat(tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    purgeInactiveChatMessages_();
    ensureInactiveChatCleanupTrigger_();

    const sh = getDataSheet_();
    if (!sh) return { ok: false, message: 'Лист REPORTS не найден.' };

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, rows: [] };

    const values = sh.getRange(2, 1, lastRow - 1, 7).getValues();
    const byPhone = {};

    values.forEach(r => {
      const phone = normalizePhone_(r[0]);
      const phone10 = last10_(phone);
      const parentName = String(r[1] || '').trim();
      const childC = String(r[2] || '').trim();
      const famD = String(r[3] || '').trim();
      if (!phone10) return;

      const childBase = stripInitialFromName_(childC) || childC;
      const childName = [childBase, famD].filter(Boolean).join(' ').trim();

      if (!byPhone[phone10]) {
        byPhone[phone10] = {
          phone,
          parentName,
          childName
        };
      }
    });

    const rows = Object.values(byPhone).sort((a, b) => {
      const aChild = String(a.childName || '').toLowerCase();
      const bChild = String(b.childName || '').toLowerCase();
      return aChild.localeCompare(bChild, 'ru');
    });

    return { ok: true, rows };

  } catch (e) {
    return { ok: false, message: 'Ошибка загрузки родителей: ' + (e.message || e) };
  }
}

function hasUnreadEducatorMessages(phoneRaw) {
  try {
    const phone10 = last10_(phoneRaw);
    if (!phone10) return { ok: false, hasUnread: false };

    const indexedUnread = getChatIndexUnreadFlag_(phone10, 8);
    if (indexedUnread !== null) {
      return { ok: true, hasUnread: indexedUnread };
    }

    const sh = ensureChatSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, hasUnread: false };

    const startRow = 2;
    const rows = sh.getRange(startRow, 1, lastRow - startRow + 1, 13).getValues();

    const hasUnread = rows.some(r => {
      const rowPhone10 = last10_(r[1]);
      const side = String(r[4] || '').trim();
      const isRead = r[10] === true || String(r[10]).toLowerCase() === 'true';
      return rowPhone10 === phone10 && side === 'educator' && !isRead;
    });

    return { ok: true, hasUnread };

  } catch (e) {
    return { ok: false, hasUnread: false, message: 'Ошибка проверки новых сообщений: ' + (e.message || e) };
  }
}

function markEducatorMessagesAsRead(phoneRaw, parentSessionRaw) {
  try {
    requireParentAccess_(phoneRaw, parentSessionRaw);
    const phone10 = last10_(phoneRaw);
    if (!phone10) return { ok: false };

    return withChatWriteLock_(function() {
      markChatMessagesRead_(phone10, 'educator', 11);
      setChatIndexReadFlag_(phone10, 8, false);
      setChatIndexReadFlag_(phone10, 11, true);
      clearGetChatMessagesCache(phoneRaw);
      return { ok: true };
    });

  } catch (e) {
    return { ok: false, message: 'Ошибка отметки сообщений: ' + (e.message || e) };
  }
}

function markParentMessagesAsReadByEducator(phoneRaw, tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const phone10 = last10_(phoneRaw);
    if (!phone10) return { ok: false };

    return withChatWriteLock_(function() {
      // Always repair the source rows too. The index can be stale after an
      // interrupted or older concurrent execution and must not short-circuit this write.
      markChatMessagesRead_(phone10, 'parent', 12);
      setChatIndexReadFlag_(phone10, 9, false);
      setChatIndexReadFlag_(phone10, 12, true);
      clearGetChatMessagesCache(phoneRaw);
      return { ok: true };
    });

  } catch (e) {
    return { ok: false, message: 'Ошибка отметки сообщений воспитателем: ' + (e.message || e) };
  }
}

function markParentMessagesAsUnreadByEducator(phoneRaw, tutorTokenRaw) {
  try {
    requireTutorSession_(tutorTokenRaw);
    const phone10 = last10_(phoneRaw);
    if (!phone10) return { ok: false };

    return withChatWriteLock_(function() {
      const updated = markChatMessagesReadValue_(phone10, 'parent', 12, false);
      if (updated > 0) {
        setChatIndexReadFlag_(phone10, 9, true);
        setChatIndexReadFlag_(phone10, 12, false);
      }
      clearGetChatMessagesCache(phoneRaw);
      return { ok: true, updated };
    });

  } catch (e) {
    return { ok: false, message: 'Ошибка возврата чата в непрочитанные: ' + (e.message || e) };
  }
}

function markChatMessagesRead_(phoneRaw, sideToMark, readColumnIndex) {
  return markChatMessagesReadValue_(phoneRaw, sideToMark, readColumnIndex, true);
}

function markChatMessagesReadValue_(phoneRaw, sideToMark, readColumnIndex, value) {
  const phone10 = last10_(phoneRaw);
  if (!phone10) return 0;

  const sh = ensureChatSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;

  const startRow = 2;
  const rows = sh.getRange(startRow, 2, lastRow - startRow + 1, 11).getValues(); // B:L
  const targetRows = [];
  const readValueIndex = readColumnIndex - 2;
  const nextValue = !!value;

  rows.forEach((r, idx) => {
    const rowPhone10 = last10_(r[0]);
    const side = String(r[3] || '').trim();
    const currentValue = r[readValueIndex] === true || String(r[readValueIndex]).toLowerCase() === 'true';

    if (rowPhone10 === phone10 && side === sideToMark && currentValue !== nextValue) {
      targetRows.push(startRow + idx);
    }
  });

  if (!targetRows.length) return 0;

  let rangeStart = targetRows[0];
  let rangeLength = 1;
  let updated = 0;

  for (let i = 1; i <= targetRows.length; i++) {
    const row = targetRows[i];
    if (row === targetRows[i - 1] + 1) {
      rangeLength += 1;
      continue;
    }

    sh.getRange(rangeStart, readColumnIndex, rangeLength, 1).setValue(nextValue);
    updated += rangeLength;
    rangeStart = row;
    rangeLength = 1;
  }

  return updated;
}

/** ========= Утилиты ========= **/
function getDatabaseSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(DATABASE_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(DATABASE_SHEET_NAME);
  return sh;
}

function findFirstEmptyRowInColA_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 2;

  const col = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  for (let i = 0; i < col.length; i++) {
    if (!String(col[i] || '').trim()) return i + 2;
  }
  return lastRow + 1;
}

function appendToDatabase_(phone, parentFirst, childFirst, familyForStore) {
  const sh = getDatabaseSheet_();

  const phone10 = last10_(phone);
  const lastRow = sh.getLastRow();

  if (lastRow >= 2) {
    const phones = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const exists = phones.some(p => last10_(p) === phone10);
    if (exists) return;
  }

  const childCanonBase = canonizeChildName_(childFirst);

  const row = findFirstEmptyRowInColA_(sh);
  sh.getRange(row, 1, 1, 4).setValues([[
    phone,
    parentFirst,
    childCanonBase,
    familyForStore
  ]]);
}

function normalizePhone_(raw) {
  let phone = String(raw || '').replace(/\D+/g, '');
  if (phone.startsWith('7')) phone = '8' + phone.slice(1);
  if (phone.length === 10) phone = '8' + phone;
  return phone;
}

function onlyDigits_(v) {
  return String(v == null ? '' : v).replace(/\D+/g, '');
}

function nowTs_() {
  return Date.now();
}

function getLatestReport(sheet, colIndex = 1) {
  if (!sheet) return "";
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return "";
  const data = sheet.getRange(1, colIndex, lastRow, 1).getValues().flat();
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i] && String(data[i]).trim() !== "") return data[i];
  }
  return "";
}

function splitBlocksByChildren(text, childrenVariants) {
  const blocks = {};
  if (!text) return blocks;

  function norm(n) {
    return String(n || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .normalize('NFD')
      .replace(/ь/g, '')
      .replace(/ъ/g, '')
      .replace(/[^а-яa-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const EXCL = /[!！‼️❗️❗❕❕]+/g;

  let clean = String(text)
    .replace(EXCL, '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  clean = clean.replace(
    /(^|\n)\s*№?\s*(50[1-9]|51[0-2])\s*(?=\n|$)/g,
    ''
  );

  clean = clean
    .replace(/(\b\d{1,2})\s*:\s*(\d{2})(\b)/g, '$1:$2$3')
    .replace(/(\b\d{1,2})\s*:\s*(\d{2})\s*:\s*(\d{2})(\b)/g, '$1:$2:$3$4');

  const index = {};
  const baseInitial = {};
  const baseOrder  = {};

  function addIndexKey_(key, base) {
    if (!key) return;
    if (!index[key]) index[key] = new Set();
    index[key].add(base);
  }

  childrenVariants.forEach((variants, idx) => {
    const base = variants?.[0] || '';
    if (!base) return;

    baseOrder[base] = idx;

    const baseCleanForInit = String(base || '').trim().replace(/[.]+$/g, '').trim();
    const initMatch = baseCleanForInit.match(/\s+([А-ЯЁ])\s*$/);
    baseInitial[base] = initMatch ? initMatch[1].toUpperCase() : '';

    const all = new Set();
    (variants || []).forEach(v => {
      const s = norm(v);
      if (!s) return;
      all.add(s);
      all.add(s.replace(/\s+/g, ''));
    });

    all.forEach(k => addIndexKey_(k, base));
  });

  const headerRe = /(^|\n)\s*([^:\-–—\n]+?)\s*(?:\.?\s*[:\-–—])\s*/g;
  const parts = [];
  let m;
  while ((m = headerRe.exec(clean)) !== null) {
    parts.push({
      nameRaw: m[2].trim(),
      start: m.index,
      bodyStart: headerRe.lastIndex
    });
  }

  if (parts.length === 0) {
    for (const v of childrenVariants) {
      if (v?.length) blocks[v[0]] = "Пока ещё нет отчёта 🙏";
    }
    return blocks;
  }

  for (let i = 0; i < parts.length; i++) {
    const { nameRaw, bodyStart } = parts[i];
    const bodyEnd = (i + 1 < parts.length) ? parts[i + 1].start : clean.length;
    const body = clean.slice(bodyStart, bodyEnd).trim();

    const nameClean = String(nameRaw || '').replace(EXCL, '').trim();
    const nameCleanForInit = nameClean
      .replace(/\.\s*$/g, '')
      .replace(/\.\s+(?=[:\-–—])/g, '')
      .trim();

    const nameNorm = norm(nameClean);
    const nameNoSpace = nameNorm.replace(/\s+/g, '');

    const headerInitMatch = nameCleanForInit.match(/\s+([А-ЯЁ])\s*$/);
    const headerInitial = headerInitMatch ? headerInitMatch[1].toUpperCase() : '';

    const candSet = new Set();
    (index[nameNorm] || []).forEach(b => candSet.add(b));
    (index[nameNoSpace] || []).forEach(b => candSet.add(b));

    let candidates = [...candSet];

    if (headerInitial && candidates.length > 0) {
      let filtered = candidates.filter(b => {
        const bi = baseInitial[b] || '';
        return (!bi || bi === headerInitial);
      });

      if (filtered.length === 0) {
        const stripped = norm(
          nameCleanForInit.replace(/\s+[А-ЯЁ]\s*$/, '').trim()
        );
        const strippedNoSpace = stripped.replace(/\s+/g, '');
        (index[stripped] || []).forEach(b => candSet.add(b));
        (index[strippedNoSpace] || []).forEach(b => candSet.add(b));

        filtered = [...candSet].filter(b => {
          const bi = baseInitial[b] || '';
          return (!bi || bi === headerInitial);
        });
      }

      candidates = filtered;
    }

    if (candidates.length === 0) continue;

    if (!headerInitial && candidates.length > 1) {
      candidates.sort((a, b) => (baseOrder[a] || 0) - (baseOrder[b] || 0));
      candidates = [candidates[0]];
    }

    if (candidates.length > 1) {
      candidates.sort((a, b) => (baseOrder[a] || 0) - (baseOrder[b] || 0));
      candidates = [candidates[0]];
    }

    const winner = candidates[0];
    if (winner) {
      blocks[winner] = `${winner}: ${body}`;
    }
  }

  for (const v of childrenVariants) {
    const main = v?.[0];
    if (main && !blocks[main]) blocks[main] = "Пока ещё нет отчёта 🙏";
  }

  return blocks;
}

function cleanReportTextForParsing_(text) {
  const EXCL = /[!！‼️❗️❗❕❕]+/g;

  let clean = String(text || '')
    .replace(EXCL, '')
    .replace(/\r/g, '\n')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[ \t]+$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  clean = clean.replace(
    /(^|\n)\s*№?\s*(50[1-9]|51[0-2])\s*(?=\n|$)/g,
    ''
  );

  return clean
    .replace(/(\b\d{1,2})\s*:\s*(\d{2})(\b)/g, '$1:$2$3')
    .replace(/(\b\d{1,2})\s*:\s*(\d{2})\s*:\s*(\d{2})(\b)/g, '$1:$2:$3$4')
    .trim();
}

function normalizeSuffixKey_(suffixRaw) {
  return String(suffixRaw || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z]/g, '');
}

function isInitialSuffixKey_(suffixKey) {
  return String(suffixKey || '').length === 1;
}

function getNameBaseKey_(nameRaw) {
  const base = stripInitialFromName_(nameRaw);
  const key0 = normalizeName_(base);
  return (CANON_NAME_MAP && CANON_NAME_MAP[key0]) ? CANON_NAME_MAP[key0] : key0;
}

function getReportHeaderParts_(nameRaw) {
  const name = String(nameRaw || '')
    .replace(/❗️|❗|‼️|‼|!+/g, '')
    .replace(/\.\s*$/g, '')
    .trim();

  const suffix = getSuffixToken_(name);

  return {
    raw: name,
    baseRaw: stripInitialFromName_(name),
    baseKey: getNameBaseKey_(name),
    suffix,
    suffixKey: normalizeSuffixKey_(suffix),
    hasSuffix: !!suffix
  };
}

const REPORT_NON_NAME_HEADER_WORDS_ = {
  аппетит: true,
  активность: true,
  активности: true,
  анализы: true,
  арт: true,
  беседа: true,
  вечер: true,
  врач: true,
  врача: true,
  врачам: true,
  врачи: true,
  врачей: true,
  завтрак: true,
  занятие: true,
  занятия: true,
  игры: true,
  итог: true,
  итоги: true,
  кино: true,
  киносеанс: true,
  комментарий: true,
  обед: true,
  обход: true,
  общение: true,
  отчет: true,
  отчёт: true,
  полдник: true,
  прогулка: true,
  прогулки: true,
  самочувствие: true,
  сон: true,
  танцы: true,
  терапия: true,
  творчество: true,
  ужин: true,
  утро: true,
  йога: true
};

const REPORT_SERVICE_HEADER_PHRASES_ = {
  'для врачей': true,
  врачам: true,
  'общий комментарий': true,
  'сегодня у ребят были': true
};

function normalizeReportHeaderPhrase_(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isServiceReportHeader_(raw) {
  const phrase = normalizeReportHeaderPhrase_(raw);
  return !!(phrase && REPORT_SERVICE_HEADER_PHRASES_[phrase]);
}

function isNonNameReportHeader_(raw) {
  const phrase = normalizeReportHeaderPhrase_(raw);
  if (!phrase) return true;
  if (isServiceReportHeader_(raw)) return true;
  if (/\d/.test(String(raw || ''))) return true;

  const compact = phrase.replace(/\s+/g, '');
  if (REPORT_NON_NAME_HEADER_WORDS_[compact]) return true;

  return false;
}

function getReportAliasCandidateKey_(header) {
  const key = normalizeName_(header && header.baseRaw);
  if (!key) return '';
  if (key.indexOf(' ') !== -1) return '';
  if (key.length < 4 || key.length > 12) return '';
  if (isNonNameReportHeader_(key)) return '';

  return key;
}

function commonPrefixLength_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const limit = Math.min(left.length, right.length);
  let i = 0;
  while (i < limit && left.charAt(i) === right.charAt(i)) i += 1;
  return i;
}

function levenshteinDistance_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const prev = [];
  const curr = [];

  for (let j = 0; j <= right.length; j += 1) prev[j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left.charAt(i - 1) === right.charAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = curr[j];
  }

  return prev[right.length] || 0;
}

function isProbableReportNameAlias_(aliasKey, childBaseKey) {
  const alias = String(aliasKey || '');
  const base = String(childBaseKey || '');
  if (!alias || !base || alias === base) return false;
  if (alias.length < 4 || base.length < 4) return false;

  const prefix = commonPrefixLength_(alias, base);
  if (prefix < 3) return false;

  const distance = levenshteinDistance_(alias, base);
  if (distance <= 2) return true;

  return prefix >= 4 && distance <= 3 && Math.max(alias.length, base.length) <= 8;
}

function findProbableReportAliasChildren_(header, contextByBase) {
  const aliasKey = getReportAliasCandidateKey_(header);
  if (!aliasKey || !contextByBase) return [];

  const found = [];
  const seen = {};

  Object.keys(contextByBase).forEach(baseKey => {
    if (!isProbableReportNameAlias_(aliasKey, baseKey)) return;

    const ctx = contextByBase[baseKey] || {};
    const active = (ctx.registered || []).filter(Boolean);
    active.forEach(child => {
      const key = reportChildIdentityKey_(child) || ('row:' + child.index);
      if (seen[key]) return;
      seen[key] = true;
      found.push(child);
    });
  });

  return found;
}

function makeUnknownReportAliasResolution_(children) {
  const list = (children || []).filter(Boolean);
  return {
    status: 'unknown_alias',
    child: null,
    children: list,
    reason: 'Заголовок похож на вариант имени активного ребёнка, но не найден в NAME_VARIANTS.'
  };
}

function makeUnassignedReportHeaderResolution_() {
  return {
    status: 'unassigned_header',
    child: null,
    children: [],
    reason: 'Заголовок похож на имя, но не привязан к активной строке REPORTS/NAME_VARIANTS.'
  };
}

function isPotentialUnassignedReportHeader_(header) {
  const raw = String(header && header.raw || '').trim();
  if (!raw || isNonNameReportHeader_(raw)) return false;

  const phrase = normalizeReportHeaderPhrase_(raw);
  if (!phrase) return false;

  const parts = phrase
    .split(/[\s-]+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length < 1 || parts.length > 3) return false;
  if (parts.some(part => REPORT_NON_NAME_HEADER_WORDS_[part])) return false;
  if (parts.every(part => part.length <= 1)) return false;
  if (parts.some(part => part.length > 20)) return false;

  // Здесь не проверяем имя по NAME_VARIANTS намеренно: незнакомые,
  // иностранные или ещё не зарегистрированные имена тоже должны быть
  // границей блока, чтобы не прилипать к предыдущему ребёнку.
  return true;
}

function normalizeReportBlockBody_(bodyRaw) {
  // Переносы нужны только пока мы ищем границы блоков. В самом отчёте для
  // родителя они не несут отдельного смысла и могут появиться из-за вставки
  // текста воспитателем, поэтому превращаем их в обычные пробелы.
  const flattened = String(bodyRaw || '')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return normalizeReportBlockPunctuation_(flattened);
}

function normalizeReportBlockPunctuation_(text) {
  // Только безопасная механическая правка: «слово ,следующее» →
  // «слово, следующее» и «слово .» → «слово.». Не исправляем слова,
  // регистр, тире и не трогаем десятичные числа вроде «1,5».
  return String(text || '')
    .replace(/[ \t]+([,.])/g, '$1')
    .replace(/,(?=[А-Яа-яЁёA-Za-z])/g, ', ')
    .replace(/([а-яёa-z])\.([А-ЯЁA-Z])/gu, '$1. $2')
    .trim();
}

function parseReportBlocks_(text, knownBaseKeys, contextByBase) {
  const clean = cleanReportTextForParsing_(text);
  const blocks = [];
  if (!clean) return { clean, blocks };

  const headerRe = /(^|\n)\s*([^:\-–—\n]+?)\s*(?:\.?\s*[:\-–—])\s*/g;
  const parts = [];
  let m;

  while ((m = headerRe.exec(clean)) !== null) {
    const header = getReportHeaderParts_(m[2].trim());
    const isKnownRegistered = !!(knownBaseKeys && knownBaseKeys[header.baseKey]);
    const isKnownName = isInNameBase(normalizeName_(header.baseRaw));
    const probableAliasChildren = (!isKnownRegistered && !isKnownName)
      ? findProbableReportAliasChildren_(header, contextByBase)
      : [];
    const isProbableAlias = probableAliasChildren.length > 0;
    const isUnassignedHeader = (!isKnownRegistered && !isKnownName && !isProbableAlias)
      ? isPotentialUnassignedReportHeader_(header)
      : false;

    if (!header.baseKey || (!isKnownRegistered && !isKnownName && !isProbableAlias && !isUnassignedHeader)) continue;

    parts.push({
      nameRaw: m[2].trim(),
      header,
      start: m.index,
      headerEnd: headerRe.lastIndex,
      prefix: m[1] || '',
      bodyStart: headerRe.lastIndex,
      forcedResolution: isProbableAlias
        ? makeUnknownReportAliasResolution_(probableAliasChildren)
        : (isUnassignedHeader ? makeUnassignedReportHeaderResolution_() : null)
    });
  }

  parts.sort((a, b) => (a.start - b.start) || (a.headerEnd - b.headerEnd));

  const uniqueParts = [];
  const seenStarts = {};
  parts.forEach(part => {
    const key = String(part.start);
    if (seenStarts[key]) return;
    seenStarts[key] = true;
    uniqueParts.push(part);
  });

  for (let i = 0; i < uniqueParts.length; i++) {
    const bodyEnd = (i + 1 < uniqueParts.length) ? uniqueParts[i + 1].start : clean.length;
    const body = normalizeReportBlockBody_(clean.slice(uniqueParts[i].bodyStart, bodyEnd));
    const header = uniqueParts[i].header;

    blocks.push({
      rawName: header.raw,
      baseRaw: header.baseRaw,
      baseKey: header.baseKey,
      suffix: header.suffix,
      suffixKey: header.suffixKey,
      hasSuffix: header.hasSuffix,
      body,
      start: uniqueParts[i].start,
      headerEnd: uniqueParts[i].headerEnd,
      prefix: uniqueParts[i].prefix,
      forcedResolution: uniqueParts[i].forcedResolution
    });
  }

  return { clean, blocks };
}

function buildKnownBaseKeys_(children) {
  const keys = {};
  (children || []).forEach(child => {
    if (child.baseKey) keys[child.baseKey] = true;
  });
  return keys;
}

function getFamilyInitialSuffix_(familyRaw) {
  const m = String(familyRaw || '').trim().match(/^([A-ZА-ЯЁ])/i);
  return m ? m[1].toUpperCase() : '';
}

function normalizeReportChildName_(nameRaw, familyRaw) {
  const name = String(nameRaw || '').trim();
  if (!name) return '';

  const baseKey = getNameBaseKey_(name);
  const baseName = baseKey ? capWord(baseKey) : (stripInitialFromName_(name) || name);
  const suffix = getSuffixToken_(name) || getFamilyInitialSuffix_(familyRaw);

  return suffix ? `${baseName} ${suffix}` : baseName;
}

function addFamilyInitialToName_(nameRaw, familyRaw) {
  return normalizeReportChildName_(nameRaw, familyRaw);
}

function normalizeReportChildNames_(dataSheet, names, families) {
  if (!dataSheet || !names || !names.length) return names;

  let changed = false;
  const nextNames = names.map((name, index) => {
    const nextName = normalizeReportChildName_(name, families[index]);
    if (nextName && nextName !== name) changed = true;
    return nextName || name;
  });

  if (changed) {
    dataSheet.getRange(2, 3, nextNames.length, 1).setValues(nextNames.map(name => [name]));
  }

  return nextNames;
}

function escapeRegExp_(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeLegacyDistributionLogSheet_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName('DISTRIBUTION_LOG');
  if (sh) ss.deleteSheet(sh);
}

function buildReportChildren_(baseNames, families) {
  return baseNames.map((fullName, index) => {
    const name = String(fullName || '').trim();
    const suffix = getSuffixToken_(name) || getFamilyInitialSuffix_(families[index]);
    const baseKey = getNameBaseKey_(name);
    const phone = '';

    return {
      index,
      fullName: name,
      baseName: stripInitialFromName_(name),
      baseKey,
      suffix,
      suffixKey: normalizeSuffixKey_(suffix),
      family: String(families[index] || '').trim(),
      phone,
      identityKey: normalizeSuffixKey_(suffix) || ('row:' + index)
    };
  });
}

function attachPhonesToReportChildren_(children, dataSheet, count) {
  if (!dataSheet || count <= 0) return children;

  const phones = dataSheet.getRange(2, 1, count, 1).getValues().flat();
  children.forEach((child, i) => {
    const phone = normalizePhone_(phones[i]);
    child.phone = phone;
    child.phone10 = last10_(phone);
    if (!child.suffixKey) child.identityKey = 'phone:' + (child.phone10 || child.index);
  });

  return children;
}

function buildDistributionContext_(children, parsedReports) {
  const byBase = {};

  children.forEach(child => {
    if (!child.baseKey) return;
    if (!byBase[child.baseKey]) {
      byBase[child.baseKey] = {
        registered: [],
        activeIdentityKeys: {}
      };
    }

    byBase[child.baseKey].registered.push(child);
    byBase[child.baseKey].activeIdentityKeys[child.identityKey] = true;
  });

  return byBase;
}

function reportChildIdentityKey_(child) {
  if (!child) return '';
  return [
    child.baseKey || '',
    child.suffixKey || '',
    normalizeFamilyName_(child.family || '')
  ].join('|');
}

function areSameReportChild_(children) {
  if (!children || children.length === 0) return false;
  const key = reportChildIdentityKey_(children[0]);
  return !!key && children.every(child => reportChildIdentityKey_(child) === key);
}

function findReportChildrenByFamilyPrefix_(children, prefixRaw) {
  const prefix = normalizeFamilyName_(prefixRaw);
  // Одна буква — это обычный инициал. Для различения фамилий принимаем
  // короткое начало из 2–4 букв: «Бы», «Быч», «Бычк».
  if (prefix.length < 2 || prefix.length > 4) return [];

  return (children || []).filter(child => {
    const family = normalizeFamilyName_(child && child.family);
    return !!family && family.indexOf(prefix) === 0;
  });
}

function okReportChildren_(children, reason) {
  const list = (children || []).filter(Boolean);
  return {
    status: 'ok',
    child: list[0] || null,
    children: list,
    reason
  };
}

function resolveReportBlock_(block, contextByBase) {
  if (block && block.forcedResolution) return block.forcedResolution;

  const ctx = contextByBase[block.baseKey] || {
    registered: [],
    activeIdentityKeys: {}
  };

  let candidates = ctx.registered.filter(child => child.baseKey === block.baseKey);

  if (block.hasSuffix) {
    const exactCandidates = candidates.filter(child => child.suffixKey && child.suffixKey === block.suffixKey);

    if (exactCandidates.length === 1) {
      return { status: 'ok', child: exactCandidates[0], reason: 'Точный заголовок с инициалом.' };
    }

    if (exactCandidates.length > 1) {
      if (areSameReportChild_(exactCandidates)) {
        return okReportChildren_(exactCandidates, 'Точный заголовок совпал с одним ребёнком в нескольких родительских строках.');
      }

      return { status: 'ambiguous', child: null, reason: 'Один и тот же инициал подходит нескольким строкам REPORTS.' };
    }

    // Если первых букв фамилий недостаточно (две Саши Б.), воспитатель может
    // написать 2–4 первые буквы фамилии: «Саша Бы» / «Саша Быч». Сверяем их
    // с полной фамилией из REPORTS, не меняя красивое отображение «Саша Б.»
    // в таблице.
    const familyPrefixCandidates = findReportChildrenByFamilyPrefix_(candidates, block.suffixKey);
    if (familyPrefixCandidates.length === 1) {
      return {
        status: 'ok',
        child: familyPrefixCandidates[0],
        reason: 'Точный заголовок с началом фамилии.'
      };
    }

    if (familyPrefixCandidates.length > 1) {
      if (areSameReportChild_(familyPrefixCandidates)) {
        return okReportChildren_(familyPrefixCandidates, 'Начало фамилии совпало с одним ребёнком в нескольких родительских строках.');
      }

      return { status: 'ambiguous', child: null, reason: 'Начало фамилии подходит нескольким разным детям.' };
    }

    // A full surname can also identify the child, even though REPORTS stores
    // only its initial in the display name.
    const fullFamilyKey = normalizeFamilyName_(block.suffix);
    const fullFamilyCandidates = fullFamilyKey.length > 4
      ? candidates.filter(child => normalizeFamilyName_(child.family) === fullFamilyKey)
      : [];
    if (fullFamilyCandidates.length === 1) {
      return { status: 'ok', child: fullFamilyCandidates[0], reason: 'Точная фамилия из REPORTS.' };
    }
    if (fullFamilyCandidates.length > 1) {
      if (areSameReportChild_(fullFamilyCandidates)) {
        return okReportChildren_(fullFamilyCandidates, 'Фамилия совпала с одним ребёнком в нескольких родительских строках.');
      }
      return { status: 'ambiguous', child: null, reason: 'Фамилия подходит нескольким разным детям.' };
    }

    // An explicit different initial or surname must never fall back to the
    // only registered child with this first name.  Otherwise «Кирилл М.»
    // gets assigned to «Кирилл Ш.» and triggers a false duplicate-block error
    // or, worse, exposes the wrong child's report to a parent.
    return { status: 'no_parent', child: null, reason: 'Инициал или фамилия заголовка не совпадает с активной строкой REPORTS.' };
  }

  // Голое имя нельзя распределять, если в REPORTS есть ещё один другой
  // ребёнок с тем же именем и другим инициалом. Несколько строк одного
  // ребёнка (например, для двух родителей) здесь не блокируют распределение.
  if (candidates.length > 1 && !areSameReportChild_(candidates)) {
    return {
      status: 'ambiguous',
      child: null,
      reason: 'Голое имя совпадает с несколькими разными строками REPORTS; требуется инициал фамилии.'
    };
  }

  const activeCandidates = candidates;

  if (activeCandidates.length === 0) {
    return { status: 'no_parent', child: null, reason: 'Имя есть в сыром отчёте, но активной строки в REPORTS нет.' };
  }

  if (activeCandidates.length > 1) {
    if (areSameReportChild_(activeCandidates)) {
      return okReportChildren_(activeCandidates, 'Голое имя совпало с одним ребёнком в нескольких родительских строках.');
    }

    return { status: 'ambiguous', child: null, reason: 'Голое имя подходит нескольким активным строкам REPORTS.' };
  }

  return { status: 'ok', child: activeCandidates[0], reason: 'Единственный безопасный кандидат.' };
}

function reportDisplayNameForChild_(child) {
  if (!child) return '';
  const fullName = String(child.fullName || '').trim();
  return stripInitialFromName_(fullName) || String(child.baseName || '').trim() || fullName;
}

function buildSafeDistribution_(reportType, parsed, contextByBase) {
  const byRow = {};

  parsed.blocks.forEach(block => {
    const res = resolveReportBlock_(block, contextByBase);
    const targets = (res.children && res.children.length) ? res.children : (res.child ? [res.child] : []);
    const child = targets[0] || null;
    const reportName = child ? reportDisplayNameForChild_(child) : (block.rawName || '');
    const finalText = child ? `${reportName}: ${block.body}`.trim() : '';

    if (res.status === 'ok' && finalText) {
      targets.forEach(target => {
        byRow[target.index] = byRow[target.index]
          ? `${byRow[target.index]}\n\n${finalText}`
          : finalText;
      });
    }
  });

  return { byRow };
}

function prepareReportForParent_(text, storedName, cleanName) {
  if (!text || text === 'Пока ещё нет отчёта 🙏') return text;

  const from = escapeRegExp_(storedName);
  const re = new RegExp(`(^|\\n\\n?)${from}\\.?\\s*[:\\-–—]\\s*`, 'gu');
  return String(text).replace(re, `$1${cleanName}: `);
}

function stripInitialFromName_(name) {
  return String(name || '')
    .trim()
    .replace(/\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё]{0,9}\.?$/, '')
    .trim();
}

function getSuffixToken_(fullName) {
  const m = String(fullName || '')
    .trim()
    .match(/\s+([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё]{0,9})\.?$/);
  return m ? m[1] : '';
}

/*
 * Raw MORNING/EVENING reports are the only place where a child can still be
 * mentioned after their REPORTS row is removed.  Their headers use the short
 * form (for example, "Кирилл Ш."), while REPORTS also keeps the full family
 * name.  Keep the two pieces of identity together so a cleanup never removes
 * another child with the same first name.
 */
function rawReportChildTargetFromReportRow_(row) {
  const displayName = normalizeReportChildName_(row && row[2], row && row[3]);
  const header = getReportHeaderParts_(displayName);
  const familyKey = normalizeFamilyName_(row && row[3]);
  const suffixKey = header.suffixKey || getFamilyInitialSuffix_(row && row[3]).toLowerCase();

  if (!header.baseKey || !suffixKey) return null;
  return {
    baseKey: header.baseKey,
    suffixKey: suffixKey,
    familyKey: familyKey,
    displayName: displayName,
    identityKey: [header.baseKey, suffixKey, familyKey].join('|')
  };
}

function rawReportChildTargetFromProfileSnapshot_(profile) {
  if (!profile) return null;
  const storedName = String(profile.reportChildName || '').trim();
  const storedFamily = String(profile.familyName || '').trim();

  if (storedName) {
    return rawReportChildTargetFromReportRow_(['', '', storedName, storedFamily]);
  }

  // Snapshots made before this cleanup was introduced only contain the public
  // form "Имя Фамилия".  It is enough for a conservative one-time fallback:
  // take the first word as the first name and use the remaining words solely
  // to derive the family initial.  If either part is absent, leave the raw
  // report untouched rather than guessing.
  const legacyParts = String(profile.childName || '').trim().split(/\s+/).filter(Boolean);
  if (legacyParts.length < 2) return null;
  return rawReportChildTargetFromReportRow_([
    '', '', legacyParts.shift(), legacyParts.join(' ')
  ]);
}

function rawReportHeaderMatchesTarget_(header, target) {
  if (!header || !target || header.baseKey !== target.baseKey || !header.hasSuffix) return false;
  const suffixKey = String(header.suffixKey || '');
  if (!suffixKey) return false;
  if (suffixKey === target.suffixKey) return true;

  // A longer beginning of the surname is allowed by the report parser for
  // cases such as two children with the same first-name initial.
  return suffixKey.length >= 2 && !!target.familyKey && target.familyKey.indexOf(suffixKey) === 0;
}

function rawReportHeaderIdentifiesOnlyTarget_(header, target, allTargets) {
  if (!rawReportHeaderMatchesTarget_(header, target)) return false;
  const candidatesByIdentity = {};
  (allTargets || []).forEach(function(candidate) {
    if (rawReportHeaderMatchesTarget_(header, candidate)) {
      candidatesByIdentity[candidate.identityKey] = candidate;
    }
  });
  const candidates = Object.keys(candidatesByIdentity).map(function(key) { return candidatesByIdentity[key]; });

  // A lone "Кирилл Ш." is deliberately kept if there are two different
  // Kirills with that same initial.  A longer surname prefix is safe once it
  // narrows the header down to this exact child.
  return candidates.length === 1 && candidates[0].identityKey === target.identityKey;
}

function rawReportTargetsNoLongerActive_(targetsRaw, activeTargetsRaw) {
  const active = {};
  (activeTargetsRaw || []).filter(Boolean).forEach(function(target) {
    active[target.identityKey] = true;
  });
  const unique = {};
  (targetsRaw || []).filter(Boolean).forEach(function(target) {
    if (!active[target.identityKey]) unique[target.identityKey] = target;
  });
  return Object.keys(unique).map(function(key) { return unique[key]; });
}

function removeRawReportBlocksForChildren_(textRaw, targets, allTargets) {
  const text = String(textRaw || '');
  if (!text || !targets || !targets.length) return { text: text, removedBlocks: 0 };

  const headerRe = /(^|\n)\s*([^:\-–—\n]+?)\s*(?:\.?\s*[:\-–—])\s*/g;
  const headers = [];
  let match;
  while ((match = headerRe.exec(text)) !== null) {
    headers.push({
      start: match.index,
      end: headerRe.lastIndex,
      header: getReportHeaderParts_(match[2].trim())
    });
  }

  const ranges = [];
  headers.forEach(function(item, index) {
    const shouldRemove = targets.some(function(target) {
      return rawReportHeaderIdentifiesOnlyTarget_(item.header, target, allTargets);
    });
    if (!shouldRemove) return;
    ranges.push({ start: item.start, end: index + 1 < headers.length ? headers[index + 1].start : text.length });
  });

  if (!ranges.length) return { text: text, removedBlocks: 0 };

  let next = text;
  for (let i = ranges.length - 1; i >= 0; i -= 1) {
    next = next.slice(0, ranges[i].start) + next.slice(ranges[i].end);
  }
  next = next.replace(/^\s*\n/, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: next, removedBlocks: ranges.length };
}

function prepareRawReportCleanupForChildren_(targetsRaw, allTargetsRaw) {
  const targets = (targetsRaw || []).filter(Boolean);
  const allTargets = (allTargetsRaw || []).filter(Boolean);
  if (!targets.length) return { patches: [], removedBlocks: 0 };

  const patches = [];
  let removedBlocks = 0;
  [SHEET_MORNING, SHEET_EVENING].forEach(function(sheetName) {
    const sheet = getSheet_(sheetName);
    const lastRow = sheet ? sheet.getLastRow() : 0;
    if (!sheet || lastRow < 1) return;
    const values = sheet.getRange(1, 1, lastRow, 1).getValues();
    values.forEach(function(row, index) {
      const result = removeRawReportBlocksForChildren_(row[0], targets, allTargets);
      if (!result.removedBlocks) return;
      patches.push({ sheet: sheet, row: index + 1, before: String(row[0] || ''), after: result.text });
      removedBlocks += result.removedBlocks;
    });
  });
  return { patches: patches, removedBlocks: removedBlocks };
}

function applyRawReportCleanup_(plan) {
  (plan && plan.patches || []).forEach(function(patch) {
    // Never overwrite a report that was edited after the deletion started.
    // The next REPORTS change will create a fresh cleanup plan instead.
    const range = patch.sheet.getRange(patch.row, 1);
    if (String(range.getValue() || '') !== patch.before) {
      throw new Error('Сырой отчёт был изменён во время удаления; повторите удаление.');
    }
    range.setValue(patch.after);
  });
  return { removedBlocks: Number(plan && plan.removedBlocks || 0) };
}

function distributeChildReports(triggerKindRaw) {
  return withChatWriteLock_(function() {
  removeLegacyDistributionLogSheet_();

  const dataSheet    = getDataSheet_();
  const morningSheet = getSheet_(SHEET_MORNING);
  const eveningSheet = getSheet_(SHEET_EVENING);
  if (!dataSheet || !morningSheet || !eveningSheet) return;

  const morningText = getLatestReport(morningSheet, 1) || "";
  const eveningText = getLatestReport(eveningSheet, 1) || "";
  const triggerKind = String(triggerKindRaw || '').toLowerCase();
  syncReportHistoryPublicationFromSource_('morning', morningText, triggerKind === 'morning');
  syncReportHistoryPublicationFromSource_('evening', eveningText, triggerKind === 'evening');

  const lastRow = dataSheet.getLastRow();
  const count   = Math.max(lastRow - 1, 0);
  if (count === 0) return;

  const rawNames = dataSheet.getRange(2, 3, count, 1).getValues().flat();
  const families = dataSheet.getRange(2, 4, count, 1).getValues().flat();

  const baseNames = normalizeReportChildNames_(
    dataSheet,
    rawNames.map(n => String(n || '').trim()),
    families
  );

  const previousReports = dataSheet.getRange(2, 5, count, 2).getValues();
  const reportPhones = dataSheet.getRange(2, 1, count, 1).getValues().flat();
  const children = attachPhonesToReportChildren_(
    buildReportChildren_(baseNames, families),
    dataSheet,
    count
  );
  const knownBaseKeys = buildKnownBaseKeys_(children);

  const contextByBase = buildDistributionContext_(children, []);
  const parsedMorning = parseReportBlocks_(morningText, knownBaseKeys, contextByBase);
  const parsedEvening = parseReportBlocks_(eveningText, knownBaseKeys, contextByBase);

  const morningDistribution = buildSafeDistribution_('morning', parsedMorning, contextByBase);
  const eveningDistribution = buildSafeDistribution_('evening', parsedEvening, contextByBase);

  const MISSING = "Пока ещё нет отчёта 🙏";
  const morningOut = [];
  const eveningOut = [];
  const inactivityUpdates = [];

  for (let i = 0; i < count; i++) {
    const storedName = baseNames[i];
    const cleanName  = stripInitialFromName_(storedName);

    let m = morningDistribution.byRow[i] || MISSING;
    let e = eveningDistribution.byRow[i] || MISSING;

    m = prepareReportForParent_(m, storedName, cleanName);
    e = prepareReportForParent_(e, storedName, cleanName);

    morningOut.push([m]);
    eveningOut.push([e]);
    inactivityUpdates.push({
      phone: reportPhones[i],
      hasNewReport: (m !== MISSING && String(m) !== String(previousReports[i][0] || '')) ||
        (e !== MISSING && String(e) !== String(previousReports[i][1] || ''))
    });

  }

  dataSheet.getRange(2, 5, count, 1).setValues(morningOut);
  dataSheet.getRange(2, 6, count, 1).setValues(eveningOut);
  // Один пакетный снимок после распределения. Повторные запуски с тем же
  // содержимым не меняют версию и не создают ложных уведомлений.
  syncReportNotificationState_(
    buildReportUpdatesByPhone_(reportPhones, morningOut, eveningOut),
    true
  );
  syncReportInactivityState_(inactivityUpdates);
  try {
    syncD1CurrentReportsToWorker_(triggerKind === 'morning' || triggerKind === 'evening' ? triggerKind : '');
  } catch (error) {
    Logger.log('REPORT_CURRENT_SYNC_AFTER_DISTRIBUTION_FAILED ' + (error && error.message || error));
  }
  });
}

function pluralizeDaysRu_(n) {
  const value = Math.abs(Number(n) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'дня';
  return 'дней';
}

function humanTime_(ts){
  if(!ts) return '';

  const date = new Date(ts);
  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const diffDays = Math.round((today - msgDay) / (24 * 60 * 60 * 1000));

  const time = Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    'HH:mm'
  );

  if(diffDays === 0) return 'сегодня • ' + time;
  if(diffDays === 1) return 'вчера • ' + time;

  const months = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
  const dateLabel = date.getDate() + ' ' + months[date.getMonth()];

  return dateLabel + ' • ' + time;
}

/**
 * Запуск этой функции нужен, чтобы Google запросил разрешение на доступ к Drive
 * для папки с фотографиями
 */
function testDriveAccess() {
  try {
    // Проверяем папку с фото
    const photoFolder = getChatPhotosFolder_();
    Logger.log('✅ Папка фото: ' + photoFolder.getName());

    return 'Папка фотографий успешно создана/найдена:\n' + 
           '• ' + photoFolder.getName();
  } catch (e) {
    Logger.log('❌ Ошибка: ' + e);
    return 'Ошибка: ' + e.toString();
  }
}

function testUrlFetchAuthorization() {
  const result = sendPushDebugEvent_({
    role: 'appscript-auth-test',
    phone: '9255751935',
    title: 'Apps Script auth test',
    body: 'Testing UrlFetchApp authorization'
  });

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function testFetchDirect() {
  const res = UrlFetchApp.fetch('https://www.google.com');
  Logger.log(res.getResponseCode());
}
