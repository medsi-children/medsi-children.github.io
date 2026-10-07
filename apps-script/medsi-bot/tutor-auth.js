/** ========= ДОСТУП ВОСПИТАТЕЛЕЙ ========= **/
// Значения находятся только на стороне Apps Script и не попадают в HTML-страницу.
// После однократной настройки используются свойства скрипта, а не этот исходник.
const TUTOR_ACCESS_LOGIN_PROPERTY_ = 'MEDSI_TUTOR_ACCESS_LOGIN';
const TUTOR_ACCESS_PASSWORD_PROPERTY_ = 'MEDSI_TUTOR_ACCESS_PASSWORD';
// Данные входа задаются только через Script Properties и никогда не хранятся в Git.
const TUTOR_SESSION_PREFIX_ = 'MEDSI_TUTOR_SESSION_';
const TUTOR_SESSION_VERSION_KEY_ = 'MEDSI_TUTOR_SESSION_VERSION';
const TUTOR_LEGACY_CLEARED_KEY_ = 'MEDSI_TUTOR_LEGACY_CLEARED';

function getTutorAccessCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const login = String(props.getProperty(TUTOR_ACCESS_LOGIN_PROPERTY_) || '').trim();
  const password = String(props.getProperty(TUTOR_ACCESS_PASSWORD_PROPERTY_) || '');
  if (login && password) return { login, password, configured: true };
  return { login: '', password: '', configured: false };
}

function getTutorSessionVersion_() {
  const props = PropertiesService.getScriptProperties();
  let version = String(props.getProperty(TUTOR_SESSION_VERSION_KEY_) || '').trim();
  if (!version) {
    version = Utilities.getUuid();
    props.setProperty(TUTOR_SESSION_VERSION_KEY_, version);
  }
  return version;
}

function tutorSessionKey_(tokenRaw) {
  const token = String(tokenRaw || '').trim();
  return token && /^[a-f0-9-]{36}$/i.test(token) ? TUTOR_SESSION_PREFIX_ + token : '';
}

function tutorSessionSigningKey_(credentials) {
  return String(credentials.login || '') + ':' + String(credentials.password || '');
}

function signTutorSessionPayload_(payload, credentials) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, tutorSessionSigningKey_(credentials))
  ).replace(/=+$/g, '');
}

function createTutorSessionToken_(credentials) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({
    version: getTutorSessionVersion_(),
    issuedAt: Date.now()
  })).replace(/=+$/g, '');
  return 'tutor1.' + payload + '.' + signTutorSessionPayload_(payload, credentials);
}

function isSignedTutorSessionValid_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'tutor1' || !parts[1] || !parts[2]) return false;
  const credentials = getTutorAccessCredentials_();
  if (!credentials.configured) return false;
  const expected = signTutorSessionPayload_(parts[1], credentials);
  if (parts[2].length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ parts[2].charCodeAt(i);
  if (difference !== 0) return false;
  try {
    const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
    return !!(payload && payload.version === getTutorSessionVersion_() && Number(payload.issuedAt) > 0);
  } catch (e) {
    return false;
  }
}

function clearLegacyTutorSessionProperties_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(TUTOR_LEGACY_CLEARED_KEY_) === '1') return;
  const legacySessionKey = /^MEDSI_TUTOR_SESSION_[a-f0-9-]{36}$/i;
  Object.keys(props.getProperties()).forEach(function (key) {
    if (legacySessionKey.test(key)) props.deleteProperty(key);
  });
  props.setProperty(TUTOR_LEGACY_CLEARED_KEY_, '1');
}

function isTutorSessionValid_(tokenRaw) {
  const token = String(tokenRaw || '').trim();
  if (token.indexOf('tutor1.') === 0) return isSignedTutorSessionValid_(token);

  // Accept old device keys until a successful login migrates them away.
  const key = tutorSessionKey_(token);
  if (!key) return false;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(key);
  if (!raw) return false;
  try {
    const session = JSON.parse(raw);
    return !!(session && session.version === getTutorSessionVersion_());
  } catch (e) {
    return false;
  }
}

/** Серверная граница: интерфейс нельзя обойти прямым запросом без сессии. */
function requireTutorSession_(tokenRaw) {
  if (!isTutorSessionValid_(tokenRaw)) {
    throw new Error('Требуется действующий вход сотрудника.');
  }
}

/** Вызывается экраном входа. В localStorage сохраняется только выданный ключ сессии. */
function verifyTutorAccess(loginRaw, passwordRaw) {
  const login = String(loginRaw || '').trim();
  const password = String(passwordRaw || '');
  const credentials = getTutorAccessCredentials_();
  if (!credentials.configured) {
    throw new Error('Доступ воспитателей ещё не настроен.');
  }
  if (login !== credentials.login || password !== credentials.password) {
    return { ok: false, message: 'Неверный логин или пароль.' };
  }

  // One-time migration: remove the old per-device properties.
  clearLegacyTutorSessionProperties_();
  const token = createTutorSessionToken_(credentials);
  return { ok: true, token: token, d1Session: getTutorD1Session_() };
}

/** Проверка уже сохранённой разовой авторизации при каждом новом открытии панели. */
function verifyTutorSession(tokenRaw) {
  if (!isTutorSessionValid_(tokenRaw)) return { ok: false };
  return { ok: true, d1Session: getTutorD1Session_() };
}

// D1 is optional at this boundary: an unavailable chat backend must never
// prevent a correctly authorised educator from entering the reports panel.
function getTutorD1Session_() {
  try {
    // The web panel uses the Cloudflare/D1 chat backend. Apps Script only
    // mints the short-lived session token here.
    return createD1ChatSession_('educator', '');
  } catch (e) {
    return null;
  }
}

/**
 * Аварийная команда для владельца проекта: после ручного запуска в Apps Script
 * все ранее выданные ключи перестают работать, новые логины остаются доступны.
 */
function revokeAllTutorSessions_() {
  PropertiesService.getScriptProperties().setProperty(TUTOR_SESSION_VERSION_KEY_, Utilities.getUuid());
  return { ok: true };
}
