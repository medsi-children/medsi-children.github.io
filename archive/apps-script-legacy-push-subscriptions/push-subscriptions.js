/* Historical Apps Script spreadsheet-backed push subscription code. */

const PUSH_SUBSCRIPTIONS_SHEET_NAME = 'PUSH_SUBSCRIPTIONS';

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

/* Historical signed-client path; no active caller remains. */

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
