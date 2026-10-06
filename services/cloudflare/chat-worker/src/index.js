
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,x-medsi-chat-session,x-medsi-phone,x-file-name,x-medsi-upload-id'
    }
  });
}

function phone10(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authorized(request, env) {
  let raw = request.headers.get('x-medsi-chat-session') || '';
  // Read-only browser calls deliberately use a CORS-simple text/plain POST
  // (see chat-adapter.html).  Clone keeps the original body available to any
  // later route handler.
  if (!raw && request.method === 'POST' && /^text\/plain(?:;|$)/i.test(request.headers.get('content-type') || '')) {
    try { raw = String((JSON.parse(await request.clone().text()) || {})._medsiChatSession || ''); } catch (_) {}
  }
  const [payload, signature] = raw.split('.');
  if (!payload || !signature || !env.LAB_D1_SESSION_SECRET) return null;
  if (!equal(await hmac(env.LAB_D1_SESSION_SECRET, payload), signature)) return null;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return Number(claims.exp) > Date.now() ? claims : null;
  } catch { return null; }
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

function registrationId(value) {
  const id = String(value || '').trim();
  return /^reg_[A-Za-z0-9_-]{16,115}$/.test(id) ? id : '';
}

function parentAccessRequestId(value) {
  const id = String(value || '').trim();
  return /^auth_[A-Za-z0-9_-]{16,115}$/.test(id) ? id : '';
}

function issueParentSession(phone, secret) {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    role: 'parent', phone10: phone, exp, version: 'cf-parent-v1'
  })));
  return hmac(secret, payload).then(signature => ({
    token: payload + '.' + signature,
    expiresAt: exp
  }));
}

async function registerParent(request, env) {
  const payload = await body(request) || {};
  const phone = phone10(payload.phone);
  const parentName = String(payload.parentName || '').trim().slice(0, 160);
  const childName = String(payload.childName || '').trim().slice(0, 160);
  const attemptId = registrationId(payload.attemptId);
  if (!phone || !parentName || !childName || !attemptId) {
    return json({ ok: false, message: 'Заполните имя родителя, имя ребёнка и корректный телефон.' }, 400);
  }
  if (!env.LAB_D1_SESSION_SECRET) return json({ ok: false, message: 'Сервис регистрации временно недоступен.' }, 503);

  const priorAttempt = await env.CHAT_DB.prepare(
    'SELECT phone10, parent_name, child_name FROM parent_registration_attempts WHERE attempt_id = ?'
  ).bind(attemptId).first();
  if (priorAttempt) {
    if (priorAttempt.phone10 !== phone || priorAttempt.parent_name !== parentName || priorAttempt.child_name !== childName) {
      return json({ ok: false, message: 'Эта попытка регистрации относится к другим данным. Вернитесь назад и повторите ввод.' }, 409);
    }
    const active = await env.CHAT_DB.prepare('SELECT phone10 FROM chat_profiles WHERE phone10 = ?').bind(phone).first();
    if (!active) return json({ ok: false, status: 'REVOKED', message: 'Регистрация уже удалена. Начните заново.' }, 410);
    const session = await issueParentSession(phone, env.LAB_D1_SESSION_SECRET);
    return json({ ok: true, duplicate: false, phone: '8' + phone, parentName, childName,
      parentSession: session.token, d1Session: { ok: true, ...session }, registrationAttemptId: attemptId });
  }

  const existing = await env.CHAT_DB.prepare(
    'SELECT phone10 FROM chat_profiles WHERE phone10 = ?'
  ).bind(phone).first();
  if (existing) return json({ ok: true, duplicate: true });

  const createdAt = Date.now();
  await env.CHAT_DB.batch([
    env.CHAT_DB.prepare(`INSERT INTO parent_registration_attempts
      (attempt_id, phone10, parent_name, child_name, status, created_at) VALUES (?, ?, ?, ?, 'COMPLETED', ?)
      ON CONFLICT(attempt_id) DO NOTHING`).bind(attemptId, phone, parentName, childName, createdAt),
    env.CHAT_DB.prepare(`INSERT INTO chat_profiles (phone10, parent_name, child_name)
      VALUES (?, ?, ?) ON CONFLICT(phone10) DO NOTHING`).bind(phone, parentName, childName),
    env.CHAT_DB.prepare(`INSERT INTO parent_registration_outbox (attempt_id, phone10, parent_name, child_name, created_at)
      SELECT ?, phone10, parent_name, child_name, ? FROM chat_profiles
      WHERE phone10 = ? AND parent_name = ? AND child_name = ?
      ON CONFLICT(attempt_id) DO NOTHING`).bind(attemptId, createdAt, phone, parentName, childName)
  ]);

  const saved = await env.CHAT_DB.prepare(
    'SELECT phone10, parent_name, child_name FROM parent_registration_attempts WHERE attempt_id = ?'
  ).bind(attemptId).first();
  const savedProfile = await env.CHAT_DB.prepare(
    'SELECT phone10, parent_name, child_name FROM chat_profiles WHERE phone10 = ?'
  ).bind(phone).first();
  if (!saved || saved.phone10 !== phone || saved.parent_name !== parentName || saved.child_name !== childName ||
      !savedProfile || savedProfile.parent_name !== parentName || savedProfile.child_name !== childName) {
    if (saved) await env.CHAT_DB.prepare('DELETE FROM parent_registration_attempts WHERE attempt_id = ?').bind(attemptId).run();
    if (savedProfile) return json({ ok: true, duplicate: true });
    return json({ ok: false, message: 'Не удалось сохранить регистрацию. Попробуйте ещё раз.' }, 503);
  }

  const session = await issueParentSession(phone, env.LAB_D1_SESSION_SECRET);
  return json({ ok: true, duplicate: false, phone: '8' + phone, parentName, childName,
    parentSession: session.token, d1Session: { ok: true, ...session }, registrationAttemptId: attemptId });
}

async function getParentRegistrationStatus(request, env) {
  const url = new URL(request.url);
  const phone = phone10(url.searchParams.get('phone'));
  const attemptId = registrationId(url.searchParams.get('attemptId'));
  if (!phone || !attemptId) return json({ ok: true, status: 'NOT_FOUND' });
  if (!env.LAB_D1_SESSION_SECRET) return json({ ok: false, message: 'Сервис регистрации временно недоступен.' }, 503);
  const attempt = await env.CHAT_DB.prepare(
    'SELECT phone10, parent_name, child_name FROM parent_registration_attempts WHERE attempt_id = ?'
  ).bind(attemptId).first();
  if (!attempt || attempt.phone10 !== phone) return json({ ok: true, status: 'NOT_FOUND' });
  const active = await env.CHAT_DB.prepare('SELECT phone10 FROM chat_profiles WHERE phone10 = ?').bind(phone).first();
  if (!active) return json({ ok: true, status: 'REVOKED' });
  const session = await issueParentSession(phone, env.LAB_D1_SESSION_SECRET);
  return json({ ok: true, status: 'COMPLETED', phone: '8' + phone,
    parentName: attempt.parent_name, childName: attempt.child_name,
    parentSession: session.token, d1Session: { ok: true, ...session }, registrationAttemptId: attemptId });
}

async function listParentRegistrationOutbox(env) {
  const rows = await env.CHAT_DB.prepare(`SELECT attempt_id, phone10, parent_name, child_name, created_at
    FROM parent_registration_outbox ORDER BY created_at ASC LIMIT 50`).all();
  return json({ ok: true, registrations: rows.results || [] });
}

async function acknowledgeParentRegistrationOutbox(request, env) {
  const payload = await body(request) || {};
  const ids = Array.isArray(payload.attemptIds) ? payload.attemptIds.map(registrationId).filter(Boolean).slice(0, 50) : [];
  if (!ids.length) return json({ ok: true, acknowledged: 0 });
  await env.CHAT_DB.batch(ids.map(id => env.CHAT_DB.prepare(
    'DELETE FROM parent_registration_outbox WHERE attempt_id = ?'
  ).bind(id)));
  return json({ ok: true, acknowledged: ids.length });
}

async function failParentRegistrationOutbox(request, env) {
  const payload = await body(request) || {};
  const id = registrationId(payload.attemptId);
  if (!id) return json({ ok: false, message: 'Invalid attempt ID.' }, 400);
  await env.CHAT_DB.prepare(`UPDATE parent_registration_outbox SET attempts = attempts + 1, last_error = ?
    WHERE attempt_id = ?`).bind(String(payload.message || 'Sync failed').slice(0, 500), id).run();
  return json({ ok: true });
}

async function requestParentAccess(request, env) {
  const payload = await body(request) || {};
  const phone = phone10(payload.phone);
  const requestId = parentAccessRequestId(payload.requestId);
  if (!phone || !requestId) return json({ ok: false, message: 'Проверьте номер телефона.' }, 400);
  const profile = await env.CHAT_DB.prepare('SELECT phone10 FROM chat_profiles WHERE phone10 = ?').bind(phone).first();
  if (!profile) return json({ ok: false, code: 'NOT_FOUND', message: 'Этот номер не найден среди активных родителей.' }, 404);

  const prior = await env.CHAT_DB.prepare('SELECT phone10, code, status, created_at, expires_at FROM parent_access_requests WHERE request_id = ?').bind(requestId).first();
  if (prior) {
    if (prior.phone10 !== phone) return json({ ok: false, message: 'Запрос относится к другому номеру телефона.' }, 409);
    if (prior.status === 'PENDING' && Number(prior.expires_at) <= Date.now()) {
      await env.CHAT_DB.prepare("UPDATE parent_access_requests SET status='EXPIRED', updated_at=? WHERE request_id=? AND status='PENDING'").bind(Date.now(), requestId).run();
      prior.status = 'EXPIRED';
    }
    return json({ ok: true, requestId, code: prior.code, status: prior.status,
      createdAt: new Date(Number(prior.created_at)).toISOString(),
      expiresAt: new Date(Number(prior.expires_at)).toISOString(), created: false });
  }

  const recent = await env.CHAT_DB.prepare(`SELECT COUNT(*) AS total FROM parent_access_requests
    WHERE phone10 = ? AND created_at > ?`).bind(phone, Date.now() - 15 * 60 * 1000).first();
  if (Number(recent && recent.total || 0) >= 3) {
    return json({ ok: false, code: 'RATE_LIMITED', message: 'Слишком много запросов. Подождите немного и попробуйте ещё раз.' }, 429);
  }

  const createdAt = Date.now(), expiresAt = createdAt + 2 * 60 * 60 * 1000;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestId + '|' + phone)));
  const code = String((((digest[0] & 255) * 256) + (digest[1] & 255)) % 10000).padStart(4, '0');
  await env.CHAT_DB.prepare(`INSERT INTO parent_access_requests
    (request_id, phone10, code, status, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, 'PENDING', ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`)
    .bind(requestId, phone, code, createdAt, createdAt, expiresAt).run();
  const saved = await env.CHAT_DB.prepare('SELECT phone10, code, status, created_at, expires_at FROM parent_access_requests WHERE request_id = ?').bind(requestId).first();
  if (!saved || saved.phone10 !== phone) return json({ ok: false, message: 'Не удалось создать запрос на вход.' }, 503);
  return json({ ok: true, requestId, code: saved.code, status: saved.status,
    createdAt: new Date(Number(saved.created_at)).toISOString(),
    expiresAt: new Date(Number(saved.expires_at)).toISOString(), created: true });
}

async function getParentAccessStatus(request, env) {
  const url = new URL(request.url), phone = phone10(url.searchParams.get('phone'));
  const requestId = parentAccessRequestId(url.searchParams.get('requestId'));
  if (!phone || !requestId) return json({ ok: true, status: 'NOT_FOUND' });
  const row = await env.CHAT_DB.prepare('SELECT * FROM parent_access_requests WHERE request_id = ?').bind(requestId).first();
  if (!row || row.phone10 !== phone) return json({ ok: true, status: 'NOT_FOUND' });
  let status = String(row.status || '').toUpperCase();
  const now = Date.now();
  if (status === 'PENDING' && Number(row.expires_at) <= now) {
    await env.CHAT_DB.prepare("UPDATE parent_access_requests SET status='EXPIRED', updated_at=? WHERE request_id=? AND status='PENDING'").bind(now, requestId).run();
    status = 'EXPIRED';
  }
  if (status === 'APPROVED' || status === 'CONSUMED') {
    if (!env.LAB_D1_SESSION_SECRET) return json({ ok: false, message: 'Сервис авторизации временно недоступен.' }, 503);
    const profile = await env.CHAT_DB.prepare('SELECT phone10, parent_name, child_name FROM chat_profiles WHERE phone10 = ?').bind(phone).first();
    if (!profile) {
      await env.CHAT_DB.prepare("UPDATE parent_access_requests SET status='DENIED', decision='REVOKED', updated_at=? WHERE request_id=?").bind(now, requestId).run();
      return json({ ok: true, status: 'DENIED' });
    }
    if (status === 'APPROVED') await env.CHAT_DB.prepare("UPDATE parent_access_requests SET status='CONSUMED', updated_at=? WHERE request_id=? AND status='APPROVED'").bind(now, requestId).run();
    const session = await issueParentSession(phone, env.LAB_D1_SESSION_SECRET);
    return json({ ok: true, status: 'APPROVED', requestId, phone: '8' + phone,
      parentName: profile.parent_name || '', childName: profile.child_name || '',
      parentSession: session.token, d1Session: { ok: true, ...session } });
  }
  return json({ ok: true, requestId, phone: '8' + phone, code: row.code, status,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    expiresAt: new Date(Number(row.expires_at)).toISOString() });
}

async function listParentAccessRequests(env) {
  const now = Date.now();
  await env.CHAT_DB.prepare("UPDATE parent_access_requests SET status='EXPIRED', updated_at=? WHERE status='PENDING' AND expires_at<=?").bind(now, now).run();
  const result = await env.CHAT_DB.prepare(`SELECT request_id, phone10, code, status, created_at, expires_at
    FROM parent_access_requests WHERE status='PENDING' ORDER BY created_at ASC LIMIT 100`).all();
  return json({ ok: true, requests: (result.results || []).map(row => ({
    requestId: row.request_id, phone: '8' + row.phone10, code: row.code,
    status: row.status, createdAt: new Date(Number(row.created_at)).toISOString(),
    expiresAt: new Date(Number(row.expires_at)).toISOString()
  })) });
}

async function importParentAccessRequests(request, env) {
  const payload = await body(request) || {};
  const items = Array.isArray(payload.requests) ? payload.requests.slice(0, 500) : [];
  let imported = 0, skipped = 0;
  for (const item of items) {
    const requestId = parentAccessRequestId(item && item.requestId);
    const phone = phone10(item && item.phone);
    const code = String(item && item.code || '').padStart(4, '0');
    const status = String(item && item.status || '').toUpperCase();
    const createdAt = Number(item && item.createdAt), updatedAt = Number(item && item.updatedAt);
    const expiresAt = Number(item && item.expiresAt), decidedAt = Number(item && item.decidedAt) || null;
    const decision = String(item && item.decision || '').toUpperCase();
    if (!requestId || !phone || !/^\d{4}$/.test(code) || !['PENDING','APPROVED','CONSUMED','DENIED','EXPIRED'].includes(status) ||
        !Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || !Number.isFinite(expiresAt)) {
      skipped++;
      continue;
    }
    const profile = await env.CHAT_DB.prepare('SELECT phone10 FROM chat_profiles WHERE phone10 = ?').bind(phone).first();
    if (!profile) { skipped++; continue; }
    const result = await env.CHAT_DB.prepare(`INSERT INTO parent_access_requests
      (request_id, phone10, code, status, created_at, updated_at, expires_at, decided_at, decision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`)
      .bind(requestId, phone, code, status, createdAt, updatedAt, expiresAt, decidedAt, decision).run();
    imported += Number(result.meta && result.meta.changes || 0);
  }
  return json({ ok: true, imported, skipped });
}

async function decideParentAccessRequest(request, env) {
  const payload = await body(request) || {};
  const requestId = parentAccessRequestId(payload.requestId);
  const decision = String(payload.decision || '').trim().toUpperCase();
  if (!requestId || !['APPROVE', 'DENY'].includes(decision)) return json({ ok: false, message: 'Некорректное решение.' }, 400);
  const now = Date.now(), status = decision === 'APPROVE' ? 'APPROVED' : 'DENIED';
  const result = await env.CHAT_DB.prepare(`UPDATE parent_access_requests SET status=?, updated_at=?, decided_at=?, decision=?
    WHERE request_id=? AND status='PENDING' AND expires_at>?`).bind(status, now, now, decision, requestId, now).run();
  const row = await env.CHAT_DB.prepare('SELECT status, expires_at FROM parent_access_requests WHERE request_id = ?').bind(requestId).first();
  if (!row) return json({ ok: false, message: 'Запрос уже недоступен.' }, 404);
  if (!result.meta || !result.meta.changes) {
    if (row.status === 'PENDING' && Number(row.expires_at) <= now) {
      await env.CHAT_DB.prepare("UPDATE parent_access_requests SET status='EXPIRED', updated_at=? WHERE request_id=? AND status='PENDING'").bind(now, requestId).run();
      return json({ ok: true, status: 'EXPIRED', alreadyResolved: true });
    }
    return json({ ok: true, status: row.status, alreadyResolved: true });
  }
  return json({ ok: true, status, alreadyResolved: false });
}

function assertPhone(raw, env) {
  const phone = phone10(raw);
  if (!phone) throw new Error('A valid phone is required.');
  return phone;
}

function messageFromRow(row) {
  const fileId = row.file_id || '';
  return {
    messageKey: row.message_key,
    phone: row.phone10,
    side: row.side,
    type: row.type,
    text: row.text,
    timestamp: row.created_at,
    readByParent: Boolean(row.read_by_parent),
    readByEducator: Boolean(row.read_by_educator),
    fileId,
    mediaUrl: fileId.startsWith('kv:') ? '/media/' + encodeURIComponent(fileId.slice(3)) : '',
    reaction: row.reaction || '',
    reply: row.reply_to_key ? { messageKey: row.reply_to_key } : null,
    status: row.status || 'active'
  };
}

function mediaType(value) {
  const type = String(value || '').toLowerCase().split(';')[0].trim();
  return new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/x-msvideo'
  ]).has(type) ? type : '';
}

function mediaName(value) {
  return String(value || 'attachment').replace(/[^\w. -]/g, '_').slice(0, 160) || 'attachment';
}


async function authorizeFormSession_(raw, env) {
  const value = String(raw || '');
  const [payload, signature] = value.split('.');

  if (!payload || !signature || !env.LAB_D1_SESSION_SECRET) return null;
  if (!equal(await hmac(env.LAB_D1_SESSION_SECRET, payload), signature)) return null;

  try {
    const claims = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    );
    return Number(claims.exp) > Date.now() ? claims : null;
  } catch (_) {
    return null;
  }
}

async function uploadMediaForm(request, env) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  const maxBytes = 20 * 1024 * 1024;

  if (contentLength > maxBytes + 1024 * 1024) {
    return json({ ok: false, message: 'Размер файла не должен превышать 20 МБ.' }, 413);
  }

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ ok: false, message: 'Некорректные данные загрузки.' }, 400);
  }

  const auth = await authorizeFormSession_(
    form.get('_medsiChatSession'),
    env
  );

  if (!auth) {
    return json({ ok: false, message: 'Unauthorized' }, 401);
  }

  if (!['parent', 'educator'].includes(auth.role)) {
    return json({ ok: false, message: 'Forbidden' }, 403);
  }

  const phone = assertPhone(String(form.get('phone') || ''), env);

  if (auth.role === 'parent' && phone !== auth.phone10) {
    return json({ ok: false, message: 'Forbidden' }, 403);
  }
  const profile = await env.CHAT_DB.prepare('SELECT phone10 FROM chat_profiles WHERE phone10 = ?').bind(phone).first();
  if (!profile) return json({ ok:false, code:'CHAT_CLOSED', message:'Chat is closed' }, 410);

  const file = form.get('file');

  if (!file || typeof file.arrayBuffer !== 'function') {
    return json({ ok: false, message: 'Файл не получен.' }, 400);
  }

  const mimeType = mediaType(file.type || '');

  if (!mimeType) {
    return json({ ok: false, message: 'Можно прикреплять только фото или видео.' }, 400);
  }

  const data = await file.arrayBuffer();

  if (data.byteLength > maxBytes) {
    return json({ ok: false, message: 'Размер файла не должен превышать 20 МБ.' }, 413);
  }

  const key = `media:${crypto.randomUUID()}`;

  await env.CHAT_MEDIA.put(key, data, {
    metadata: {
      contentType: mimeType,
      name: mediaName(file.name || 'attachment')
    }
  });

  return json({
    ok: true,
    fileId: 'kv:' + key,
    url: '/media/' + encodeURIComponent(key),
    type: mimeType.startsWith('video/') ? 'video' : 'image'
  });
}

async function uploadMedia(request, env, auth) {
  const mimeType = mediaType(request.headers.get('content-type'));
  if (!mimeType) return json({ ok: false, message: 'Можно прикреплять только фото или видео.' }, 400);
  const bytes = Number(request.headers.get('content-length') || 0);
  const maxBytes = 20 * 1024 * 1024;
  if (bytes > maxBytes) return json({ ok: false, message: 'Размер файла не должен превышать 20 МБ.' }, 413);
  const rawPhone = request.headers.get('x-medsi-phone') || '';
  const phone = assertPhone(rawPhone, env);
  if (auth.role === 'parent' && phone !== auth.phone10) return json({ ok: false, message: 'Forbidden' }, 403);
  if (!['parent', 'educator'].includes(auth.role)) return json({ ok: false, message: 'Forbidden' }, 403);
  const profile = await env.CHAT_DB.prepare('SELECT phone10 FROM chat_profiles WHERE phone10 = ?').bind(phone).first();
  if (!profile) return json({ ok:false, code:'CHAT_CLOSED', message:'Chat is closed' }, 410);
  const data = await request.arrayBuffer();
  if (data.byteLength > maxBytes) return json({ ok: false, message: 'Размер файла не должен превышать 20 МБ.' }, 413);
  const rawUploadId = String(request.headers.get('x-medsi-upload-id') || '').trim();
  const uploadId = /^[a-zA-Z0-9_-]{8,120}$/.test(rawUploadId) ? rawUploadId : '';
  const key = `media:${uploadId || crypto.randomUUID()}`;

  await env.CHAT_MEDIA.put(key, data, {
    metadata: { contentType: mimeType, name: mediaName(request.headers.get('x-file-name')) }
  });
  return json({ ok: true, fileId: 'kv:' + key, url: '/media/' + encodeURIComponent(key), type: mimeType.startsWith('video/') ? 'video' : 'image' });
}

async function serveMedia(env, key) {
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 });
  const object = await env.CHAT_MEDIA.getWithMetadata(key, 'arrayBuffer');
  if (!object || !object.value) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  headers.set('content-type', String(object.metadata && object.metadata.contentType || 'application/octet-stream'));
  headers.set('content-disposition', 'inline; filename="' + mediaName(object.metadata && object.metadata.name) + '"');
  headers.set('cache-control', 'private, max-age=3600');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.value, { headers });
}

async function requireAdmin(request, env) {
  return Boolean(env.CHAT_ADMIN_TOKEN) && request.headers.get('authorization') === `Bearer ${env.CHAT_ADMIN_TOKEN}`;
}

async function importBatch(request, env) {
  const payload = await body(request) || {};
  const profiles = Array.isArray(payload.profiles) ? payload.profiles.slice(0, 200) : [];
  const messages = Array.isArray(payload.messages) ? payload.messages.slice(0, 400) : [];
  const pins = Array.isArray(payload.pins) ? payload.pins.slice(0, 200) : [];
  const statements = [];

  profiles.forEach(item => {
    const phone = phone10(item && item.phone);
    if (!phone) return;
    statements.push(env.CHAT_DB.prepare(`
      INSERT INTO chat_profiles (phone10, parent_name, child_name) VALUES (?, ?, ?)
      ON CONFLICT(phone10) DO UPDATE SET parent_name = excluded.parent_name, child_name = excluded.child_name
    `).bind(phone, String(item.parentName || '').slice(0, 300), String(item.childName || '').slice(0, 300)));
  });

  messages.forEach(item => {
    const phone = phone10(item && item.phone);
    const key = String(item && item.messageKey || '').trim().slice(0, 300);
    const side = String(item && item.side || '').trim();
    if (!phone || !key || !['parent', 'educator'].includes(side)) return;
    statements.push(env.CHAT_DB.prepare(`
      INSERT INTO chat_messages
        (message_key, phone10, side, type, text, file_id, delete_after, status, reply_to_key, reaction, edited_at, created_at, read_by_parent, read_by_educator)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_key) DO UPDATE SET
        phone10=excluded.phone10, side=excluded.side, type=excluded.type, text=excluded.text,
        -- Sheets retains its historical Google Drive ID.  Once a message has
        -- been verified in Timeweb S3, a later idempotent history import must
        -- never replace that durable S3 reference with the legacy source ID.
        file_id=CASE
          WHEN chat_messages.file_id LIKE 's3:%' AND excluded.file_id NOT LIKE 's3:%'
          THEN chat_messages.file_id
          ELSE excluded.file_id
        END,
        delete_after=excluded.delete_after, status=excluded.status,
        reply_to_key=excluded.reply_to_key, reaction=excluded.reaction, edited_at=excluded.edited_at,
        created_at=excluded.created_at, read_by_parent=excluded.read_by_parent, read_by_educator=excluded.read_by_educator
    `).bind(
      key, phone, side, ['text', 'image', 'video'].includes(String(item.type)) ? String(item.type) : 'text',
      String(item.text || '').slice(0, 4000), String(item.fileId || '').slice(0, 200), Number(item.deleteAfter || 0) || null,
      String(item.status || 'active') === 'deleted' ? 'deleted' : 'active', String(item.replyToKey || '').slice(0, 300),
      String(item.reaction || '').slice(0, 16), Number(item.editedAt || 0) || null, Number(item.createdAt || 0) || Date.now(),
      item.readByParent ? 1 : 0, item.readByEducator ? 1 : 0
    ));
  });

  pins.forEach(item => {
    const phone = phone10(item && item.phone);
    const bucket = String(item && item.bucket || '');
    if (!phone || !['read', 'unread'].includes(bucket)) return;
    statements.push(env.CHAT_DB.prepare(`
      INSERT INTO chat_pins (phone10, bucket, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(phone10) DO UPDATE SET bucket=excluded.bucket, updated_at=excluded.updated_at
    `).bind(phone, bucket, Number(item.updatedAt || 0) || Date.now()));
  });
  if (statements.length) await env.CHAT_DB.batch(statements);
  return json({ ok: true, imported: { profiles: profiles.length, messages: messages.length, pins: pins.length } });
}


async function exportChatMessages(request, env) {
  const url = new URL(request.url);
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0) || 0);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 400) || 400));

  const totalRow = await env.CHAT_DB.prepare(
    'SELECT COUNT(*) AS total FROM chat_messages'
  ).first();

  const rows = await env.CHAT_DB.prepare(`
    SELECT
      m.message_key,
      m.phone10,
      m.side,
      m.type,
      m.text,
      m.file_id,
      m.delete_after,
      m.status,
      m.reply_to_key,
      m.reaction,
      m.edited_at,
      m.created_at,
      m.read_by_parent,
      m.read_by_educator,
      COALESCE(p.parent_name, '') AS parent_name,
      COALESCE(p.child_name, '') AS child_name
    FROM chat_messages m
    LEFT JOIN chat_profiles p ON p.phone10 = m.phone10
    ORDER BY m.created_at ASC, m.message_key ASC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  return json({
    ok: true,
    total: Number(totalRow && totalRow.total || 0),
    offset,
    limit,
    messages: rows.results || []
  });
}

async function verifySnapshot(env) {
  const totals = await env.CHAT_DB.prepare(`
    SELECT COUNT(*) AS messages, COUNT(DISTINCT phone10) AS phones, COALESCE(MIN(created_at), 0) AS oldest, COALESCE(MAX(created_at), 0) AS newest
    FROM chat_messages
  `).first();
  const byPhone = await env.CHAT_DB.prepare(`
    SELECT phone10, COUNT(*) AS messages, COALESCE(MIN(created_at), 0) AS oldest, COALESCE(MAX(created_at), 0) AS newest
    FROM chat_messages GROUP BY phone10 ORDER BY phone10
  `).all();
  return json({ ok: true, totals, byPhone: byPhone.results });
}

async function upsertReportSnapshots(request, env) {
  const payload = await body(request) || {};
  const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots.slice(0, 500) : [];
  const candidates = [];
  const seen = new Set();
  snapshots.forEach(item => {
    const phone = phone10(item && item.phone);
    const kind = String(item && item.kind || '').trim().toLowerCase();
    const reportDate = String(item && item.reportDate || '').trim();
    const text = String(item && item.text || '').trim();
    if (!phone || !['morning', 'evening'].includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !text) return;
    const key = `${phone}|${kind}|${reportDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ phone, kind, reportDate, text: text.slice(0, 30000), capturedAt: Number(item.capturedAt || 0) || Date.now() });
  });
  const normalizeText = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  let saved = 0;
  let skippedDuplicate = 0;
  let skippedExisting = 0;
  for (const candidate of candidates) {
    if (payload.skipIfMatchesPrevious === true) {
      const previous = await env.CHAT_DB.prepare(`
        SELECT text FROM report_snapshots
        WHERE phone10 = ? AND kind = ? AND report_date < ?
        ORDER BY report_date DESC LIMIT 1
      `).bind(candidate.phone, candidate.kind, candidate.reportDate).first();
      if (previous && normalizeText(previous.text) === normalizeText(candidate.text)) {
        skippedDuplicate++;
        continue;
      }
    }
    const result = await env.CHAT_DB.prepare(`
      INSERT INTO report_snapshots (phone10, kind, report_date, text, captured_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(phone10, kind, report_date) DO NOTHING
    `).bind(candidate.phone, candidate.kind, candidate.reportDate, candidate.text, candidate.capturedAt).run();
    const changes = Number(result && result.meta && result.meta.changes || 0);
    if (changes) saved += changes;
    else skippedExisting++;
  }
  const beforeDate = String(payload.beforeDate || '').trim();
  let pruned = 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
    const result = await env.CHAT_DB.prepare('DELETE FROM report_snapshots WHERE report_date < ?').bind(beforeDate).run();
    pruned = Number(result && result.meta && result.meta.changes || 0);
  }
  return json({ ok: true, received: candidates.length, saved, skippedDuplicate, skippedExisting, pruned });
}

async function getParentReportHistory(env, auth) {
  if (auth.role !== 'parent' || !auth.phone10) return json({ ok: false, message: 'Forbidden' }, 403);
  const result = await env.CHAT_DB.prepare(`
    SELECT kind, report_date, text, captured_at
    FROM report_snapshots
    WHERE phone10 = ?
    ORDER BY report_date DESC, CASE kind WHEN 'evening' THEN 0 ELSE 1 END
    LIMIT 80
  `).bind(auth.phone10).all();
  return json({
    ok: true,
    reports: (result.results || []).map(row => ({
      kind: row.kind,
      reportDate: row.report_date,
      text: row.text,
      capturedAt: Number(row.captured_at || 0)
    }))
  });
}

async function upsertCurrentReports(request, env, ctx) {
  const payload = await body(request) || {};
  const reports = Array.isArray(payload.reports) ? payload.reports.slice(0, 500) : [];
  const notificationKind = ['morning', 'evening'].includes(String(payload.notificationKind || '').toLowerCase())
    ? String(payload.notificationKind).toLowerCase()
    : '';
  const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.reportDate || ''))
    ? String(payload.reportDate)
    : '';
  const previousReports = new Map();
  if (notificationKind && reportDate) {
    const previous = await env.CHAT_DB.prepare(
      'SELECT phone10, version, updated_at FROM report_current WHERE kind = ?'
    ).bind(notificationKind).all();
    (previous.results || []).forEach(row => previousReports.set(row.phone10, row));
  }
  const statements = [];
  const seen = new Set();
  const notificationTargets = [];
  reports.forEach(item => {
    const phone = phone10(item && item.phone);
    const kind = String(item && item.kind || '').trim().toLowerCase();
    if (!phone || !['morning', 'evening', 'psychology'].includes(kind)) return;
    const key = `${phone}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    statements.push(env.CHAT_DB.prepare(`
      INSERT INTO report_current (phone10, kind, text, version, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(phone10, kind) DO UPDATE SET
        text = excluded.text,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).bind(
      phone,
      kind,
      String(item && item.text || '').slice(0, 30000),
      String(item && item.version || '').slice(0, 180),
      Number(item && item.updatedAt || 0) || Date.now()
    ));
    const text = String(item && item.text || '').trim();
    if (kind === notificationKind && reportDate && text) {
      const previous = previousReports.get(phone);
      const previousDate = previous ? reportDateInMoscow(previous.updated_at) : '';
      const samePublishedReport = previous &&
        String(previous.version || '') === String(item && item.version || '') &&
        previousDate === reportDate;
      if (!samePublishedReport) notificationTargets.push({ phone, kind, reportDate });
    }
  });
  if (statements.length) await env.CHAT_DB.batch(statements);
  let queued = 0;
  if (notificationTargets.length) {
    const reserved = await env.CHAT_DB.batch(notificationTargets.map(item => env.CHAT_DB.prepare(`
      INSERT INTO report_push_dedup (phone10, kind, report_date, last_push_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(phone10, kind, report_date) DO UPDATE SET last_push_at = excluded.last_push_at
      WHERE excluded.last_push_at - report_push_dedup.last_push_at >= 7200000
    `).bind(item.phone, item.kind, item.reportDate, Date.now())));
    const jobs = [];
    reserved.forEach((result, index) => {
      if (!result.meta || Number(result.meta.changes || 0) < 1) return;
      queued += 1;
      jobs.push(notifyParentReportBestEffort(env, notificationTargets[index].phone, notificationKind));
    });
    if (jobs.length) {
      const pushJob = Promise.allSettled(jobs).then(results => {
        const failed = results.filter(result => result.status === 'rejected').length;
        if (failed) console.error('REPORT_PUSH_BATCH_FAILED', JSON.stringify({ kind: notificationKind, failed, total: results.length }));
      });
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(pushJob);
      else await pushJob;
    }
  }
  return json({ ok: true, received: statements.length, updated: statements.length, pushQueued: queued });
}

function reportDateInMoscow(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

async function notifyParentReportBestEffort(env, phone, kind) {
  if (!env.PUSH_WORKER || !env.MEDSI_CHAT_PUSH_SECRET) return;
  const label = kind === 'morning' ? 'утренний' : 'вечерний';
  const response = await env.PUSH_WORKER.fetch('https://medsi-push-worker.internal/notify', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.MEDSI_CHAT_PUSH_SECRET}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      role: 'parent',
      phone,
      notification: {
        title: 'Новый ' + label + ' отчёт',
        body: 'Отчёт по вашему ребёнку уже доступен в Медси Боте.',
        url: '/',
        tag: 'medsi-report-' + kind + '-' + phone
      }
    })
  });
  if (!response.ok) throw new Error(`Push HTTP ${response.status}`);
}

async function getParentCurrentReports(env, auth) {
  if (auth.role !== 'parent' || !auth.phone10) return json({ ok: false, message: 'Forbidden' }, 403);
  const result = await env.CHAT_DB.prepare(`
    SELECT kind, text, version, updated_at
    FROM report_current
    WHERE phone10 = ?
  `).bind(auth.phone10).all();
  return json({
    ok: true,
    reports: (result.results || []).map(row => ({
      kind: row.kind,
      text: row.text || '',
      version: row.version || '',
      updatedAt: Number(row.updated_at || 0)
    }))
  });
}

async function getOwnProfile(env, auth) {
  const profile = await env.CHAT_DB.prepare('SELECT phone10, parent_name, child_name FROM chat_profiles WHERE phone10 = ?').bind(auth.phone10).first();
  if (!profile) return json({ ok: false, code: 'CHAT_CLOSED', message: 'Чат недоступен' }, 410);
  return json({ ok: true, phone: profile.phone10, parentName: profile.parent_name || '', childName: profile.child_name || '' });
}

async function captureScheduledReportHistory(env) {
  if (!env.APP_SCRIPT_URL || !env.CHAT_ADMIN_TOKEN) throw new Error('Report history scheduler is not configured');
  const response = await fetch(env.APP_SCRIPT_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'reportHistoryCapture', authorization: env.CHAT_ADMIN_TOKEN })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.ok) {
    throw new Error(payload && payload.message || `Apps Script HTTP ${response.status}`);
  }
  return payload;
}

async function enqueueReportSubmission(request, env, auth, ctx) {
  if (auth.role !== 'educator') return json({ ok: false, message: 'Forbidden' }, 403);
  const payload = await body(request) || {};
  const submissionId = String(payload.submissionId || '').trim().slice(0, 120);
  const reportType = String(payload.reportType || '').trim().toLowerCase();
  const reportText = String(payload.text || '').trim().slice(0, 50000);
  if (!/^report_[A-Za-z0-9_-]{8,120}$/.test(submissionId)) return json({ ok: false, message: 'Некорректный идентификатор отправки.' }, 400);
  if (!['morning', 'evening', 'psychology'].includes(reportType) || !reportText) return json({ ok: false, message: 'Некорректные данные отчёта.' }, 400);
  const now = Date.now();
  await env.CHAT_DB.prepare(`
    INSERT INTO report_submission_queue (submission_id, report_type, report_text, status, attempts, last_error, result_json, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', 0, '', '', ?, ?)
    ON CONFLICT(submission_id) DO UPDATE SET updated_at = excluded.updated_at
  `).bind(submissionId, reportType, reportText, now, now).run();
  if (ctx) ctx.waitUntil(drainReportQueue(env));
  return json({ ok: true, accepted: true, submissionId, status: 'pending' });
}

async function getReportSubmissionQueueStatus(env, auth, submissionId) {
  if (auth.role !== 'educator') return json({ ok: false, message: 'Forbidden' }, 403);
  const id = String(submissionId || '').trim();
  const row = await env.CHAT_DB.prepare(`SELECT submission_id, status, attempts, last_error, result_json, updated_at FROM report_submission_queue WHERE submission_id = ?`).bind(id).first();
  if (!row) return json({ ok: true, status: 'not_found', submissionId: id });
  let result = null;
  try { result = row.result_json ? JSON.parse(row.result_json) : null; } catch (_) {}
  return json({ ok: true, status: row.status, submissionId: id, attempts: Number(row.attempts || 0), message: row.last_error || '', result, updatedAt: Number(row.updated_at || 0) });
}

async function drainReportQueue(env) {
  if (!env.APP_SCRIPT_URL || !env.CHAT_ADMIN_TOKEN) return { ok: false, message: 'Report queue is not configured' };
  // Submission IDs are only needed while a result can still be recovered.
  // Periodic pruning keeps this operational queue bounded.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  await env.CHAT_DB.prepare(`DELETE FROM report_submission_queue WHERE status IN ('completed','failed') AND updated_at < ?`).bind(cutoff).run();
  const staleProcessing = Date.now() - 10 * 60 * 1000;
  await env.CHAT_DB.prepare(`UPDATE report_submission_queue SET status='retry', last_error='Повтор после прерванной обработки', updated_at=? WHERE status='processing' AND updated_at < ?`).bind(Date.now(), staleProcessing).run();
  const rows = await env.CHAT_DB.prepare(`SELECT submission_id, report_type, report_text, attempts FROM report_submission_queue WHERE status IN ('pending','retry') ORDER BY created_at LIMIT 5`).all();
  const results = [];
  for (const row of (rows.results || [])) {
    const claimed = await env.CHAT_DB.prepare(`UPDATE report_submission_queue SET status='processing', attempts=attempts+1, updated_at=? WHERE submission_id=? AND status IN ('pending','retry')`).bind(Date.now(), row.submission_id).run();
    if (!claimed.meta || !claimed.meta.changes) continue;
    try {
      const response = await fetch(env.APP_SCRIPT_URL, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ action: 'reportQueueProcess', authorization: env.CHAT_ADMIN_TOKEN, param: { reportType: row.report_type, text: row.report_text, submissionId: row.submission_id } })
      });
      const payload = await response.json().catch(() => null);
      const result = payload && payload.result ? payload.result : payload;
      if (!response.ok || !result || result.ok === false) throw new Error(result && result.message || `Apps Script HTTP ${response.status}`);
      await env.CHAT_DB.prepare(`UPDATE report_submission_queue SET status='completed', result_json=?, last_error='', updated_at=? WHERE submission_id=?`).bind(JSON.stringify(result), Date.now(), row.submission_id).run();
      results.push({ submissionId: row.submission_id, status: 'completed' });
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const next = attempts >= 8 ? 'failed' : 'retry';
      await env.CHAT_DB.prepare(`UPDATE report_submission_queue SET status=?, last_error=?, updated_at=? WHERE submission_id=?`).bind(next, String(error && error.message || error).slice(0, 500), Date.now(), row.submission_id).run();
      results.push({ submissionId: row.submission_id, status: next });
    }
  }
  return { ok: true, results };
}

// REPORTS remains the authority for which parents exist.  This endpoint is
// deliberately available only to Apps Script: it upserts active profiles and,
// on a full reconciliation, removes every trace of parents no longer present
// in the table.
async function reconcileProfiles(request, env) {
  const payload = await body(request) || {};
  const profiles = Array.isArray(payload.profiles) ? payload.profiles.slice(0, 500) : [];
  const full = payload.full === true;
  const active = new Map();
  profiles.forEach(item => {
    const phone = phone10(item && item.phone);
    if (!phone) return;
    active.set(phone, {
      parentName: String(item.parentName || '').trim().slice(0, 300),
      childName: String(item.childName || '').trim().slice(0, 300)
    });
  });

  const statements = [];
  active.forEach((profile, phone) => {
    statements.push(env.CHAT_DB.prepare(`
      DELETE FROM legacy_parent_access
      WHERE phone10 = ?
        AND EXISTS (
          SELECT 1 FROM chat_profiles AS current
          WHERE current.phone10 = ?
            AND current.parent_name <> ?
            AND current.child_name <> ?
        )
    `).bind(phone, phone, profile.parentName, profile.childName));
    statements.push(env.CHAT_DB.prepare(`
      INSERT INTO chat_profiles (phone10, parent_name, child_name) VALUES (?, ?, ?)
      ON CONFLICT(phone10) DO UPDATE SET parent_name = excluded.parent_name, child_name = excluded.child_name
    `).bind(phone, profile.parentName, profile.childName));
  });
  if (statements.length) await env.CHAT_DB.batch(statements);

  let removed = 0;
  if (full) {
    const current = await env.CHAT_DB.prepare('SELECT phone10 FROM chat_profiles').all();
    const stale = (current.results || []).map(row => row.phone10).filter(phone => !active.has(phone));
    if (stale.length) {
      const deletions = [];
      stale.forEach(phone => {
        deletions.push(env.CHAT_DB.prepare('DELETE FROM chat_messages WHERE phone10 = ?').bind(phone));
        deletions.push(env.CHAT_DB.prepare('DELETE FROM chat_pins WHERE phone10 = ?').bind(phone));
        deletions.push(env.CHAT_DB.prepare('DELETE FROM report_snapshots WHERE phone10 = ?').bind(phone));
        deletions.push(env.CHAT_DB.prepare('DELETE FROM report_current WHERE phone10 = ?').bind(phone));
        deletions.push(env.CHAT_DB.prepare("UPDATE parent_access_requests SET status='DENIED', decision='REVOKED', updated_at=? WHERE phone10 = ? AND status IN ('PENDING','APPROVED')").bind(Date.now(), phone));
        deletions.push(env.CHAT_DB.prepare('DELETE FROM parent_registration_outbox WHERE phone10 = ?').bind(phone));
        deletions.push(env.CHAT_DB.prepare('DELETE FROM parent_registration_attempts WHERE phone10 = ?').bind(phone));
        deletions.push(env.CHAT_DB.prepare('DELETE FROM legacy_parent_access WHERE phone10 = ?').bind(phone));
        deletions.push(env.CHAT_DB.prepare('DELETE FROM chat_profiles WHERE phone10 = ?').bind(phone));
      });
      await env.CHAT_DB.batch(deletions);
      removed = stale.length;
    }
  }
  return json({ ok: true, active: active.size, removed, full });
}

async function listProfilePhones(env) {
  const rows = await env.CHAT_DB.prepare('SELECT phone10 FROM chat_profiles ORDER BY phone10').all();
  return json({ ok: true, phones: (rows.results || []).map(row => row.phone10) });
}

async function getProfileForAdmin(env, phoneRaw) {
  const phone = phone10(phoneRaw);
  if (!phone) return json({ ok: false, message: 'A valid phone is required.' }, 400);
  const profile = await env.CHAT_DB.prepare(
    'SELECT phone10, parent_name, child_name FROM chat_profiles WHERE phone10 = ?'
  ).bind(phone).first();
  return json({ ok: true, profile: profile ? {
    phone: '8' + profile.phone10,
    parentName: profile.parent_name || '',
    childName: profile.child_name || ''
  } : null });
}

async function getLegacyParentAccess(env, phoneRaw) {
  const phone = phone10(phoneRaw);
  if (!phone) return json({ ok: false, allowed: false }, 400);
  const result = await env.CHAT_DB.prepare(`
    SELECT legacy.parent_name AS legacy_parent_name, legacy.child_name AS legacy_child_name,
      profile.parent_name AS parent_name, profile.child_name AS child_name
    FROM legacy_parent_access AS legacy
    JOIN chat_profiles AS profile ON profile.phone10 = legacy.phone10
    WHERE legacy.phone10 = ?
  `).bind(phone).first();
  const allowed = !!result && (
    result.legacy_parent_name === result.parent_name || result.legacy_child_name === result.child_name
  );
  if (result && !allowed) {
    await env.CHAT_DB.prepare('DELETE FROM legacy_parent_access WHERE phone10 = ?').bind(phone).run();
  }
  return json({ ok: true, allowed });
}

// These two lifecycle operations are intentionally admin-only.  REPORTS is
// the authority; Apps Script invokes them after a protected snapshot/diff.
// Neither endpoint is reachable through the browser chat session.
async function moveProfilePhone(request, env) {
  const payload = await body(request) || {};
  const from = phone10(payload.fromPhone);
  const to = phone10(payload.toPhone);
  if (!from || !to || from === to) return json({ ok: false, message: 'Two different valid phones are required.' }, 400);

  const target = await env.CHAT_DB.prepare('SELECT phone10 FROM chat_profiles WHERE phone10 = ?').bind(to).first();
  if (target) return json({ ok: false, message: 'Target phone already has a profile.' }, 409);

  const before = await env.CHAT_DB.prepare('SELECT COUNT(*) AS messages FROM chat_messages WHERE phone10 = ?').bind(from).first();
  const parentName = String(payload.parentName || '').trim().slice(0, 300);
  const childName = String(payload.childName || '').trim().slice(0, 300);
  await env.CHAT_DB.batch([
    env.CHAT_DB.prepare('UPDATE chat_messages SET phone10 = ? WHERE phone10 = ?').bind(to, from),
    env.CHAT_DB.prepare('UPDATE chat_pins SET phone10 = ? WHERE phone10 = ?').bind(to, from),
    env.CHAT_DB.prepare('UPDATE report_snapshots SET phone10 = ? WHERE phone10 = ?').bind(to, from),
    env.CHAT_DB.prepare('UPDATE report_current SET phone10 = ? WHERE phone10 = ?').bind(to, from),
    env.CHAT_DB.prepare('DELETE FROM legacy_parent_access WHERE phone10 IN (?, ?)').bind(from, to),
    env.CHAT_DB.prepare('UPDATE chat_profiles SET phone10 = ?, parent_name = ?, child_name = ? WHERE phone10 = ?').bind(to, parentName, childName, from),
    env.CHAT_DB.prepare('INSERT INTO chat_profiles (phone10, parent_name, child_name) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM chat_profiles WHERE phone10 = ?)').bind(to, parentName, childName, to),
    env.CHAT_DB.prepare('DELETE FROM parent_registration_outbox WHERE phone10 = ?').bind(from),
    env.CHAT_DB.prepare('DELETE FROM parent_registration_outbox WHERE phone10 = ?').bind(to),
    env.CHAT_DB.prepare("UPDATE parent_access_requests SET status='DENIED', decision='REVOKED', updated_at=? WHERE phone10 = ? AND status IN ('PENDING','APPROVED')").bind(Date.now(), from),
    env.CHAT_DB.prepare('DELETE FROM parent_registration_attempts WHERE phone10 = ?').bind(from)
  ]);
  return json({ ok: true, fromPhone: from, toPhone: to, movedMessages: Number(before && before.messages || 0) });
}

// Returns S3 object keys alongside D1 deletion so Apps Script can enqueue a
// protected Timeweb purge.  The queue makes a transient S3 failure retryable
// without restoring the deleted parent's chat visibility.
async function deleteProfilePhone(request, env) {
  const payload = await body(request) || {};
  const phone = phone10(payload.phone);
  if (!phone) return json({ ok: false, message: 'A valid phone is required.' }, 400);
  const media = await env.CHAT_DB.prepare("SELECT file_id FROM chat_messages WHERE phone10 = ? AND file_id LIKE 's3:%'").bind(phone).all();
  const s3Keys = [...new Set((media.results || []).map(row => String(row.file_id || '').slice(3)).filter(Boolean))];
  const legacyMedia = await env.CHAT_DB.prepare("SELECT file_id FROM chat_messages WHERE phone10 = ? AND file_id LIKE 'kv:%'").bind(phone).all();
  const kvKeys = [...new Set((legacyMedia.results || []).map(row => String(row.file_id || '').slice(3)).filter(Boolean))];
  for (const key of kvKeys) await env.CHAT_MEDIA.delete(key);
  await env.CHAT_DB.batch([
    env.CHAT_DB.prepare('DELETE FROM chat_messages WHERE phone10 = ?').bind(phone),
    env.CHAT_DB.prepare('DELETE FROM chat_pins WHERE phone10 = ?').bind(phone),
    env.CHAT_DB.prepare('DELETE FROM report_snapshots WHERE phone10 = ?').bind(phone),
    env.CHAT_DB.prepare('DELETE FROM report_current WHERE phone10 = ?').bind(phone),
    env.CHAT_DB.prepare('DELETE FROM chat_profiles WHERE phone10 = ?').bind(phone),
    env.CHAT_DB.prepare('DELETE FROM legacy_parent_access WHERE phone10 = ?').bind(phone),
    env.CHAT_DB.prepare('DELETE FROM parent_registration_outbox WHERE phone10 = ?').bind(phone),
    env.CHAT_DB.prepare('DELETE FROM parent_registration_attempts WHERE phone10 = ?').bind(phone),
    env.CHAT_DB.prepare("UPDATE parent_access_requests SET status='DENIED', decision='REVOKED', updated_at=? WHERE phone10 = ? AND status IN ('PENDING','APPROVED')").bind(Date.now(), phone)
  ]);
  return json({ ok: true, phone, s3Keys, deletedKvKeys:kvKeys.length });
}

// Read-only first half of the deletion protocol.  Apps Script persists this
// result in its own retry queue before calling deleteProfilePhone, so a later
// S3 outage cannot make attachment keys disappear with the D1 records.
async function profileS3Keys(request, env) {
  const payload = await body(request) || {};
  const phone = phone10(payload.phone);
  if (!phone) return json({ ok: false, message: 'A valid phone is required.' }, 400);
  const media = await env.CHAT_DB.prepare("SELECT file_id FROM chat_messages WHERE phone10 = ? AND file_id LIKE 's3:%'").bind(phone).all();
  const s3Keys = [...new Set((media.results || []).map(row => String(row.file_id || '').slice(3)).filter(Boolean))];
  return json({ ok: true, phone, s3Keys });
}

async function notifyChatMessageBestEffort(env, phone, side, type, text) {
  if (!env.MEDSI_CHAT_PUSH_SECRET) return;

  const targetRole = side === 'parent' ? 'educator' : 'parent';

  let childName = '';
  if (side === 'parent') {
    try {
      const profile = await env.CHAT_DB.prepare(
        'SELECT child_name FROM chat_profiles WHERE phone10 = ? LIMIT 1'
      ).bind(phone).first();
      childName = String(profile && profile.child_name || '').trim();
    } catch (error) {
      console.error('CHAT_PUSH_PROFILE_LOOKUP_FAILED', error);
    }
  }

  const bodyText = type === 'image'
    ? 'Новое фото в чате'
    : type === 'video'
      ? 'Новое видео в чате'
      : (text ? String(text).slice(0, 180) : 'Новое сообщение в чате');

  const notification = {
    title: side === 'parent'
      ? (childName || 'Новое сообщение от родителя')
      : 'Детское Отделение Медси',
    body: bodyText,
    url: targetRole === 'educator' ? '/tutors' : '/',
    tag: 'medsi-chat-' + phone
  };

  if (!env.PUSH_WORKER) {
    throw new Error('PUSH_WORKER service binding is not configured');
  }

  const response = await env.PUSH_WORKER.fetch(
    'https://medsi-push-worker.internal/notify',
    {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${env.MEDSI_CHAT_PUSH_SECRET}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        role: targetRole,
        phone: targetRole === 'parent' ? phone : '',
        notification
      })
    }
  );

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Push HTTP ${response.status}: ${message.slice(0, 300)}`);
  }
}

async function addMessage(request, env, auth, ctx) {
  const payload = await body(request);
  const phone = assertPhone(payload && payload.phone, env);
  const profile = await env.CHAT_DB.prepare('SELECT phone10 FROM chat_profiles WHERE phone10 = ?').bind(phone).first();
  if (!profile) return json({ ok:false, code:'CHAT_CLOSED', message:'Chat is closed' }, 410);
  const side = auth.role;
  const type = String(payload && payload.type || 'text');
  if (side !== 'parent' && side !== 'educator') return json({ ok: false, message: 'Bad side' }, 400);
  const text = String(payload && payload.text || '').trim().slice(0, 4000);
  const fileId = String(payload && payload.fileId || '').trim().slice(0, 200);
  const clientMessageId = String(payload && payload.clientMessageId || '').trim().slice(0, 200);
  const replyToKey = String(payload && payload.replyToKey || '').trim().slice(0, 200);
  if (!text && !fileId) return json({ ok: false, message: 'Text or file is required' }, 400);
  if (!['text', 'image', 'video'].includes(type)) return json({ ok: false, message: 'Bad message type' }, 400);
  if (replyToKey) {
    const replyTarget = await env.CHAT_DB.prepare(
      "SELECT message_key FROM chat_messages WHERE message_key = ? AND phone10 = ? AND status = 'active'"
    ).bind(replyToKey, phone).first();
    if (!replyTarget) return json({ ok: false, message: 'Reply target does not belong to this chat' }, 400);
  }

  const now = Date.now();
  const key = `${now}-${side}-${crypto.randomUUID()}`;
  try {
    await env.CHAT_DB.prepare(`
      INSERT INTO chat_messages
        (message_key, client_message_id, phone10, side, type, text, file_id, reply_to_key, created_at, read_by_parent, read_by_educator)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(key, clientMessageId, phone, side, type, text, fileId, replyToKey, now, side === 'parent' ? 1 : 0, side === 'educator' ? 1 : 0).run();
  } catch (error) {
    // A lost response or a repeated POST can race with the first insert.
    // The partial unique index makes the client id the operation's idempotency
    // key while preserving unlimited ordinary messages with an empty id.
    if (!clientMessageId) throw error;
    const existing = await env.CHAT_DB.prepare('SELECT * FROM chat_messages WHERE phone10 = ? AND client_message_id = ?').bind(phone, clientMessageId).first();
    if (!existing) throw error;
    return json({ ok: true, duplicate: true, message: messageFromRow(existing) });
  }
  const pushJob = notifyChatMessageBestEffort(env, phone, side, type, text)
    .catch(error => console.error('CHAT_PUSH_FAILED', error));

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(pushJob);
  } else {
    await pushJob;
  }

  return json({ ok: true, message: { messageKey: key, phone, side, type, text, fileId, reply: replyToKey ? { messageKey: replyToKey } : null, timestamp: now } });
}

async function listParents(env) {
  const result = await env.CHAT_DB.prepare(`
    SELECT phone10, parent_name, child_name
    FROM chat_profiles
    ORDER BY child_name COLLATE NOCASE ASC, parent_name COLLATE NOCASE ASC, phone10 ASC
  `).all();

  const parents = (result.results || []).map(row => ({
    phone: row.phone10,
    parentName: row.parent_name || '',
    childName: row.child_name || ''
  }));

  return json({ ok: true, parents });
}

async function listChats(env, bucket) {
  const unreadOnly = bucket === 'unread';
  const readOnly = bucket === 'read';
  const condition = unreadOnly
    ? "WHERE unread.has_unread = 1 OR pins.bucket = 'unread'"
    : readOnly
      ? "WHERE unread.has_unread = 0 OR pins.bucket = 'read'"
      : '';
  const result = await env.CHAT_DB.prepare(`
    WITH latest AS (
      SELECT m1.phone10, m1.id AS last_id
      FROM chat_messages m1
      WHERE m1.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM chat_messages m2
          WHERE m2.phone10 = m1.phone10
            AND m2.status = 'active'
            AND (
              m2.created_at > m1.created_at
              OR (m2.created_at = m1.created_at AND m2.id > m1.id)
            )
        )
    ), unread AS (
      SELECT phone10,
        MAX(CASE WHEN side = 'parent' AND read_by_educator = 0 THEN 1 ELSE 0 END) AS has_unread
      FROM chat_messages WHERE status = 'active'
      GROUP BY phone10
    )
    SELECT m.phone10, p.parent_name, p.child_name, m.side AS last_side, m.type AS last_type, m.text AS last_text,
      m.created_at, unread.has_unread, pins.bucket AS pinned_bucket
    FROM latest
    JOIN chat_messages m ON m.id = latest.last_id
    JOIN chat_profiles p ON p.phone10 = m.phone10
    JOIN unread ON unread.phone10 = m.phone10
    LEFT JOIN chat_pins pins ON pins.phone10 = m.phone10
    ${condition}
    ORDER BY CASE WHEN pins.bucket = ? THEN 1 ELSE 0 END DESC, m.created_at DESC, m.id DESC
  `).bind(bucket === 'read' ? 'read' : 'unread').all();
  const chats = result.results.map(row => ({
    phone: row.phone10,
    parentName: row.parent_name,
    childName: row.child_name,
    lastSide: row.last_side,
    lastType: row.last_type || 'text',
    lastText: row.last_text,
    hasUnread: Boolean(row.has_unread),
    pinnedBucket: row.pinned_bucket || ''
  }));

  return json({ ok: true, chats });
}

async function getThread(env, rawPhone, beforeRaw, limitRaw) {
  const phone = assertPhone(rawPhone, env);
  const limit = Math.max(1, Math.min(150, Number(limitRaw) || 50));
  const beforeKey = String(beforeRaw || '').trim();
  const profile = await env.CHAT_DB.prepare('SELECT * FROM chat_profiles WHERE phone10 = ?').bind(phone).first();
  const result = await env.CHAT_DB.prepare(`
    WITH boundary AS (
      SELECT created_at, id
      FROM chat_messages
      WHERE message_key = ?
    )
    SELECT m.*
    FROM chat_messages m
    WHERE m.phone10 = ? AND m.status = 'active'
      AND (
        ? = ''
        OR NOT EXISTS (SELECT 1 FROM boundary)
        OR m.created_at < (SELECT created_at FROM boundary)
        OR (
          m.created_at = (SELECT created_at FROM boundary)
          AND m.id < (SELECT id FROM boundary)
        )
      )
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?
  `).bind(beforeKey, phone, beforeKey, limit + 1).all();
  const hasMore = result.results.length > limit;
  const rows = hasMore ? result.results.slice(0, limit) : result.results;
  const messages = rows.reverse().map(messageFromRow);
  const byKey = new Map(messages.map(message => [message.messageKey, message]));
  const missingReplyKeys = [...new Set(messages
    .map(message => message.reply && message.reply.messageKey)
    .filter(key => key && !byKey.has(key)))];
  if (missingReplyKeys.length) {
    const placeholders = missingReplyKeys.map(() => '?').join(',');
    const referenced = await env.CHAT_DB.prepare(
      `SELECT * FROM chat_messages WHERE phone10 = ? AND message_key IN (${placeholders}) AND status = 'active'`
    ).bind(phone, ...missingReplyKeys).all();
    referenced.results.forEach(row => {
      const message = messageFromRow(row);
      byKey.set(message.messageKey, message);
    });
  }
  messages.forEach(message => {
    if (!message.reply || !message.reply.messageKey) return;
    const target = byKey.get(message.reply.messageKey);
    if (target) message.reply = { messageKey:target.messageKey, side:target.side, type:target.type, text:target.text, fileId:target.fileId };
  });
  return json({ ok: true, phone, parentName: profile.parent_name, childName: profile.child_name,
    messages, hasMore });
}

async function markEducatorRead(env, rawPhone) {
  const phone = assertPhone(rawPhone, env);
  await env.CHAT_DB.prepare('UPDATE chat_messages SET read_by_educator = 1 WHERE phone10 = ? AND side = \'parent\'').bind(phone).run();
  return json({ ok: true });
}

async function markEducatorUnread(env, rawPhone) {
  const phone = assertPhone(rawPhone, env);
  await env.CHAT_DB.prepare(
    "UPDATE chat_messages SET read_by_educator = 0 WHERE phone10 = ? AND side = 'parent' AND status = 'active'"
  ).bind(phone).run();
  return json({ ok: true });
}

async function markParentRead(env, rawPhone) {
  const phone = assertPhone(rawPhone, env);
  await env.CHAT_DB.prepare("UPDATE chat_messages SET read_by_parent = 1 WHERE phone10 = ? AND side = 'educator'").bind(phone).run();
  return json({ ok: true });
}

async function setPin(request, env, rawPhone) {
  const phone = assertPhone(rawPhone, env);
  const payload = await body(request);
  const bucket = String(payload && payload.bucket || '').trim();
  if (!['read', 'unread', ''].includes(bucket)) return json({ ok: false, message: 'Bad pin bucket' }, 400);
  if (!bucket) {
    await env.CHAT_DB.prepare('DELETE FROM chat_pins WHERE phone10 = ?').bind(phone).run();
    return json({ ok: true, pinned: false });
  }
  await env.CHAT_DB.prepare('INSERT INTO chat_pins (phone10, bucket, updated_at) VALUES (?, ?, ?) ON CONFLICT(phone10) DO UPDATE SET bucket = excluded.bucket, updated_at = excluded.updated_at').bind(phone, bucket, Date.now()).run();
  return json({ ok: true, pinned: true, bucket });
}

async function mutateMessage(request, env, kind, rawKey, auth) {
  const key = String(rawKey || '').trim();
  const payload = await body(request);
  if (!key) return json({ ok: false, message: 'Message key is required' }, 400);
  const row = await env.CHAT_DB.prepare('SELECT * FROM chat_messages WHERE message_key = ?').bind(key).first();
  if (!row) return json({ ok: false, message: 'Message not found' }, 404);
  if (auth.role === 'parent' && row.phone10 !== auth.phone10) {
    return json({ ok: false, message: 'Forbidden' }, 403);
  }
  if (kind === 'reaction') {
    const reaction = String(payload && payload.reaction || '').trim();
    const allowedReactions = new Set(['❤️', '👍', '👌', '🙏', '🥰', '😁', '🔥']);

    if (reaction && !allowedReactions.has(reaction)) {
      return json({ ok: false, message: 'Bad reaction' }, 400);
    }

    await env.CHAT_DB.prepare('UPDATE chat_messages SET reaction = ? WHERE message_key = ?').bind(row.reaction === reaction ? '' : reaction, key).run();
    return json({ ok: true, reaction: row.reaction === reaction ? '' : reaction });
  }

  const actor = auth.role;
  if (actor !== row.side) return json({ ok: false, message: 'Only own messages can be changed' }, 403);
  if (kind === 'edit') {
    const text = String(payload && payload.text || '').trim().slice(0, 4000);
    if (!text) return json({ ok: false, message: 'Text is required' }, 400);
    await env.CHAT_DB.prepare('UPDATE chat_messages SET text = ?, edited_at = ? WHERE message_key = ?').bind(text, Date.now(), key).run();
    return json({ ok: true, text });
  }
  await env.CHAT_DB.prepare("UPDATE chat_messages SET status = 'deleted' WHERE message_key = ?").bind(key).run();
  return json({ ok: true });
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(captureScheduledReportHistory(env));
    ctx.waitUntil(drainReportQueue(env));
  },
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return json({ ok: true });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
      return serveMedia(env, decodeURIComponent(url.pathname.slice('/media/'.length)));
    }
    if (request.method === 'GET' && url.pathname === '/admin/bot-logs') {
      return json({ ok: false }, 410);
    }
    if (url.pathname.startsWith('/admin/')) {
      if (!await requireAdmin(request, env)) return json({ ok: false, message: 'Unauthorized' }, 401);
      if (request.method === 'POST' && url.pathname === '/admin/import') return importBatch(request, env);
      if (request.method === 'GET' && url.pathname === '/admin/export') return exportChatMessages(request, env);
      if (request.method === 'POST' && url.pathname === '/admin/reconcile') return reconcileProfiles(request, env);
      if (request.method === 'GET' && url.pathname === '/admin/profile-phones') return listProfilePhones(env);
      if (request.method === 'GET' && url.pathname.startsWith('/admin/profile/')) return getProfileForAdmin(env, url.pathname.slice('/admin/profile/'.length));
      if (request.method === 'GET' && url.pathname.startsWith('/admin/parent-legacy-access/')) return getLegacyParentAccess(env, url.pathname.slice('/admin/parent-legacy-access/'.length));
      if (request.method === 'POST' && url.pathname === '/admin/move-profile-phone') return moveProfilePhone(request, env);
      if (request.method === 'POST' && url.pathname === '/admin/profile-s3-keys') return profileS3Keys(request, env);
      if (request.method === 'POST' && url.pathname === '/admin/delete-profile-phone') return deleteProfilePhone(request, env);
      if (request.method === 'POST' && url.pathname === '/admin/report-snapshots') return upsertReportSnapshots(request, env);
      if (request.method === 'POST' && url.pathname === '/admin/report-current') return upsertCurrentReports(request, env, ctx);
      if (request.method === 'GET' && url.pathname === '/admin/parent-registration-outbox') return listParentRegistrationOutbox(env);
      if (request.method === 'POST' && url.pathname === '/admin/parent-registration-outbox/ack') return acknowledgeParentRegistrationOutbox(request, env);
      if (request.method === 'POST' && url.pathname === '/admin/parent-registration-outbox/fail') return failParentRegistrationOutbox(request, env);
      if (request.method === 'GET' && url.pathname === '/admin/parent-access-requests') return listParentAccessRequests(env);
      if (request.method === 'POST' && url.pathname === '/admin/parent-access-requests/import') return importParentAccessRequests(request, env);
      if (request.method === 'POST' && url.pathname === '/admin/parent-access-requests/decision') return decideParentAccessRequest(request, env);
      if (request.method === 'GET' && url.pathname === '/admin/verify') return verifySnapshot(env);
      return json({ ok: false, message: 'Not found' }, 404);
    }
    if (request.method === 'POST' && url.pathname === '/lab/parent-registration') {
      return registerParent(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/lab/parent-registration/status') {
      return getParentRegistrationStatus(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/lab/parent-access/request') {
      return requestParentAccess(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/lab/parent-access/status') {
      return getParentAccessStatus(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/lab/upload-form') {
      return uploadMediaForm(request, env);
    }
    const auth = await authorized(request, env);
    if (!auth) return json({ ok: false, message: 'Unauthorized' }, 401);

    if (auth.role === 'parent') {
      const activeProfile = await env.CHAT_DB.prepare(
        'SELECT phone10 FROM chat_profiles WHERE phone10 = ?'
      ).bind(auth.phone10).first();

      if (!activeProfile) {
        return json({
          ok: false,
          code: 'CHAT_CLOSED',
          message: 'Chat is closed'
        }, 410);
      }
    }

    const guardedPhone = url.pathname.match(/^\/lab\/(?:threads|read|unread|read-parent|pin)\/([^/]+)/)?.[1] || '';
    if (auth.role === 'parent' && guardedPhone && phone10(guardedPhone) !== auth.phone10) return json({ ok: false, message: 'Forbidden' }, 403);
    if (auth.role === 'parent' && request.method === 'POST' && url.pathname === '/lab/messages') {
      const cloned = request.clone();
      const payload = await body(cloned);
      if (phone10(payload && payload.phone) !== auth.phone10 || String(payload && payload.side) !== 'parent') return json({ ok: false, message: 'Forbidden' }, 403);
    }
    if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'medsi-chat-worker' });
    if (request.method === 'POST' && url.pathname === '/lab/upload') {
      if (!['parent', 'educator'].includes(auth.role)) return json({ ok: false, message: 'Forbidden' }, 403);
      return uploadMedia(request, env, auth);
    }
    if (request.method === 'POST' && url.pathname === '/lab/report-submit') {
      return enqueueReportSubmission(request, env, auth, ctx);
    }
    if (request.method === 'GET' && url.pathname === '/lab/report-submit/status') {
      return getReportSubmissionQueueStatus(env, auth, url.searchParams.get('submissionId'));
    }
    if (request.method === 'GET' && url.pathname === '/lab/profile') {
      return getOwnProfile(env, auth);
    }
    if (request.method === 'POST' && url.pathname === '/lab/bot-log') {
      return json({ ok: false }, 410);
    }
    if (request.method === 'POST' && url.pathname === '/lab/messages') {
      if (!['parent', 'educator'].includes(auth.role)) return json({ ok: false, message: 'Forbidden' }, 403);
      return addMessage(request, env, auth, ctx);
    }
    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/lab/parents') {
      if (auth.role !== 'educator') return json({ ok: false, message: 'Forbidden' }, 403);
      return listParents(env);
    }
    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/lab/chats') {
      if (!['educator'].includes(auth.role)) return json({ ok: false, message: 'Forbidden' }, 403);
      return listChats(env, url.searchParams.get('bucket') || 'all');
    }
    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/lab/report-history') {
      return getParentReportHistory(env, auth);
    }
    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/lab/report-current') {
      return getParentCurrentReports(env, auth);
    }
    if ((request.method === 'GET' || request.method === 'POST') && url.pathname.startsWith('/lab/threads/')) return getThread(env, url.pathname.slice('/lab/threads/'.length), url.searchParams.get('before'), url.searchParams.get('limit'));
    if (request.method === 'POST' && url.pathname.startsWith('/lab/read/')) {
      if (!['educator'].includes(auth.role)) return json({ ok: false, message: 'Forbidden' }, 403);
      return markEducatorRead(env, url.pathname.slice('/lab/read/'.length));
    }
    if (request.method === 'POST' && url.pathname.startsWith('/lab/unread/')) {
      if (!['educator'].includes(auth.role)) return json({ ok: false, message: 'Forbidden' }, 403);
      return markEducatorUnread(env, url.pathname.slice('/lab/unread/'.length));
    }
    if (request.method === 'POST' && url.pathname.startsWith('/lab/read-parent/')) {
      if (!['parent', 'educator'].includes(auth.role)) return json({ ok: false, message: 'Forbidden' }, 403);
      return markParentRead(env, url.pathname.slice('/lab/read-parent/'.length));
    }
    if (request.method === 'POST' && url.pathname.startsWith('/lab/pin/')) {
      if (!['educator'].includes(auth.role)) return json({ ok: false, message: 'Forbidden' }, 403);
      return setPin(request, env, url.pathname.slice('/lab/pin/'.length));
    }
    if (request.method === 'POST' && url.pathname.startsWith('/lab/reaction/')) return mutateMessage(request, env, 'reaction', url.pathname.slice('/lab/reaction/'.length), auth);
    if (request.method === 'POST' && url.pathname.startsWith('/lab/edit/')) return mutateMessage(request, env, 'edit', url.pathname.slice('/lab/edit/'.length), auth);
    if (request.method === 'POST' && url.pathname.startsWith('/lab/delete/')) return mutateMessage(request, env, 'delete', url.pathname.slice('/lab/delete/'.length), auth);
    return json({ ok: false, message: 'Not found' }, 404);
  }
};
