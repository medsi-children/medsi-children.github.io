/** ========= ДОСТУП ВОСПИТАТЕЛЕЙ ========= **/
// Значения находятся только на стороне Apps Script и не попадают в HTML-страницу.
// После однократной настройки используются свойства скрипта, а не этот исходник.
const TUTOR_ACCESS_LOGIN_PROPERTY_ = 'MEDSI_TUTOR_ACCESS_LOGIN';
const TUTOR_ACCESS_PASSWORD_PROPERTY_ = 'MEDSI_TUTOR_ACCESS_PASSWORD';
// Данные входа задаются только через Script Properties и никогда не хранятся в Git.
const TUTOR_SESSION_PREFIX_ = 'MEDSI_TUTOR_SESSION_';
const TUTOR_SESSION_VERSION_KEY_ = 'MEDSI_TUTOR_SESSION_VERSION';

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

function isTutorSessionValid_(tokenRaw) {
  const key = tutorSessionKey_(tokenRaw);
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

  const token = Utilities.getUuid();
  const props = PropertiesService.getScriptProperties();
  props.setProperty(tutorSessionKey_(token), JSON.stringify({
    version: getTutorSessionVersion_(),
    createdAt: new Date().toISOString()
  }));

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
    if (String(PropertiesService.getScriptProperties().getProperty('CHAT_BACKEND') || 'sheets') !== 'd1') {
      return null;
    }
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
