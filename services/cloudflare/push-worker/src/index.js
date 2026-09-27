import webpush from 'web-push';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type',
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase() === 'educator' ? 'educator' : 'parent';
}

function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function last10(value) {
  const digits = onlyDigits(value);
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function subscriptionKey(endpoint) {
  const source = new TextEncoder().encode(String(endpoint || ''));
  return crypto.subtle.digest('SHA-256', source).then(hash => {
    return Array.from(new Uint8Array(hash))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  });
}

function isAuthorized(request, env) {
  const expected = env.MEDSI_PUSH_SECRET || '';
  if (!expected) return false;

  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${expected}`;
}

function isNotifyAuthorized(request, env) {
  const header = request.headers.get('authorization') || '';
  const primary = env.MEDSI_PUSH_SECRET || '';
  const chat = env.MEDSI_CHAT_PUSH_SECRET || '';

  return Boolean(
    (primary && header === `Bearer ${primary}`) ||
    (chat && header === `Bearer ${chat}`)
  );
}

function normalizeNotification(notification) {
  const src = notification || {};
  return {
    title: String(src.title || 'Медси Бот').slice(0, 80),
    body: String(src.body || 'Новое сообщение').slice(0, 240),
    url: String(src.url || '/').slice(0, 500),
    tag: String(src.tag || 'medsi-message').slice(0, 80),
    action: String(src.action || '').slice(0, 40),
    icon: String(src.icon || '/apple-touch-icon.png').slice(0, 500),
    badge: String(src.badge || '/apple-touch-icon.png').slice(0, 500)
  };
}

function notificationSignaturePayload(role, phone10, notification, ts) {
  return [
    normalizeRole(role),
    normalizeRole(role) === 'parent' ? last10(phone10) : '',
    notification.title,
    notification.body,
    notification.url,
    notification.tag,
    String(ts || '')
  ].join('\n');
}

function base64UrlEncode(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signPayload(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function configureWebPush(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    throw new Error('Worker is not configured');
  }

  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    try {
      const text = await request.text();
      return text ? JSON.parse(text) : null;
    } catch (err) {
      return null;
    }
  }
}

async function writeNotifyEvent(env, event) {
  if (!env.PUSH_SUBSCRIPTIONS) {
    return { ok: false, message: 'KV is not configured' };
  }

  try {
    const key = `event:${Date.now()}:${crypto.randomUUID()}`;
    await env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify({
      ...event,
      at: new Date().toISOString()
    }), { expirationTtl: 7 * 24 * 60 * 60 });
    return { ok: true, key };
  } catch (e) {
    return { ok: false, message: String(e && e.message || e) };
  }
}



const TUTOR_AUTH_URL = 'https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';

async function verifyEducatorTutorToken(token) {
  const tutorToken = String(token || '').trim();
  if (!tutorToken) return false;

  try {
    const response = await fetch(TUTOR_AUTH_URL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        action: 'api',
        method: 'verifyTutorSession',
        args: [tutorToken]
      })
    });

    if (!response.ok) return false;

    const payload = await response.json();
    const result = payload && payload.result;

    return Boolean(
      payload &&
      payload.ok === true &&
      result &&
      result.ok === true
    );
  } catch (_) {
    return false;
  }
}

async function verifyParentSession(phone10, parentSession) {
  if (!phone10) return false;
  try {
    const response = await fetch(TUTOR_AUTH_URL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        action: 'api',
        method: 'verifyParentSession',
        args: [phone10, String(parentSession || '')]
      })
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return Boolean(payload && payload.ok === true && payload.result && payload.result.ok === true);
  } catch (_) {
    return false;
  }
}

async function handleSubscribe(request, env) {
  const body = await readJson(request);
  const subscription = body && body.subscription;
  const endpoint = subscription && String(subscription.endpoint || '').trim();
  const role = normalizeRole(body && body.role);
  const phone10 = role === 'parent' ? last10(body && body.phone) : '';

  if (!env.PUSH_SUBSCRIPTIONS) {
    return jsonResponse({ ok: false, message: 'KV is not configured' }, 500);
  }

  if (!endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return jsonResponse({ ok: false, message: 'Bad subscription' }, 400);
  }

  if (role === 'parent' && !phone10) {
    return jsonResponse({ ok: false, message: 'Parent phone is required' }, 400);
  }

  if (role === 'parent') {
    const authorized = await verifyParentSession(phone10, body && body.parentSession);
    if (!authorized) {
      return jsonResponse({ ok: false, message: 'Parent authorization required' }, 401);
    }
  }

  if (role === 'educator') {
    const tutorToken = String(body && body.tutorToken || '').trim();
    const authorized = await verifyEducatorTutorToken(tutorToken);

    if (!authorized) {
      return jsonResponse({ ok: false, message: 'Educator authorization required' }, 401);
    }
  }

  const key = await subscriptionKey(endpoint);
  await env.PUSH_SUBSCRIPTIONS.put(`sub:${key}`, JSON.stringify({
    role,
    phone10,
    endpoint,
    subscription,
    userAgent: String(body && body.userAgent || ''),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    enabled: true
  }));

  return jsonResponse({ ok: true, key });
}

async function handleUnsubscribe(request, env) {
  const body = await readJson(request);
  const endpoint = body && String(body.endpoint || '').trim();

  if (!endpoint) return jsonResponse({ ok: false, message: 'Endpoint is required' }, 400);

  const key = await subscriptionKey(endpoint);
  await env.PUSH_SUBSCRIPTIONS.delete(`sub:${key}`);
  return jsonResponse({ ok: true });
}

async function listSubscriptions(env) {
  const out = [];
  let cursor;

  do {
    const page = await env.PUSH_SUBSCRIPTIONS.list({ prefix: 'sub:', cursor });
    cursor = page.cursor;

    for (const key of page.keys) {
      const raw = await env.PUSH_SUBSCRIPTIONS.get(key.name);
      if (!raw) continue;

      try {
        out.push({ key: key.name, value: JSON.parse(raw) });
      } catch (e) {}
    }
  } while (cursor);

  return out;
}

async function handleNotify(request, env) {
  if (!isNotifyAuthorized(request, env)) {
    return jsonResponse({ ok: false, message: 'Unauthorized' }, 401);
  }

  if (!env.PUSH_SUBSCRIPTIONS) {
    return jsonResponse({ ok: false, message: 'KV is not configured' }, 500);
  }

  configureWebPush(env);

  const body = await readJson(request);
  const role = normalizeRole(body && body.role);
  const phone10 = role === 'parent' ? last10(body && body.phone) : '';
  const notification = normalizeNotification(body && body.notification);
  const result = await sendNotificationToSubscribers(env, role, phone10, notification);

  return jsonResponse(result);
}

async function sendNotificationToSubscribers(env, role, phone10, notification) {
  configureWebPush(env);

  const all = await listSubscriptions(env);

  const targets = all.filter(item => {
    const sub = item.value || {};
    if (!sub.enabled || sub.role !== role) return false;
    if (role === 'parent') return sub.phone10 === phone10;
    return true;
  });

  let sent = 0;
  let failed = 0;

  for (const item of targets) {
    try {
      await webpush.sendNotification(item.value.subscription, JSON.stringify(notification));
      sent += 1;
    } catch (error) {
      failed += 1;
      if (error && (error.statusCode === 404 || error.statusCode === 410)) {
        await env.PUSH_SUBSCRIPTIONS.delete(item.key);
      }
    }
  }

  const eventWrite = await writeNotifyEvent(env, {
    role,
    phone10,
    title: notification.title,
    url: notification.url,
    body: notification.body,
    tag: notification.tag,
    total: targets.length,
    sent,
    failed
  });

  return { ok: true, sent, failed, total: targets.length, eventWrite };
}

async function handleNotifyClient(request, env) {
  if (!env.MEDSI_PUSH_SECRET) {
    return jsonResponse({ ok: false, message: 'Worker secret is not configured' }, 500);
  }

  if (!env.PUSH_SUBSCRIPTIONS) {
    return jsonResponse({ ok: false, message: 'KV is not configured' }, 500);
  }

  const body = await readJson(request);
  const role = normalizeRole(body && body.role);
  const phone10 = role === 'parent' ? last10(body && body.phone) : '';
  const notification = normalizeNotification(body && body.notification);
  const ts = Number(body && body.ts);
  const sig = String(body && body.sig || '');
  const now = Date.now();

  if (!ts || Math.abs(now - ts) > 10 * 60 * 1000) {
    return jsonResponse({ ok: false, message: 'Expired signature' }, 401);
  }

  const expected = await signPayload(
    env.MEDSI_PUSH_SECRET,
    notificationSignaturePayload(role, phone10, notification, String(ts))
  );

  if (!timingSafeEqual(sig, expected)) {
    return jsonResponse({ ok: false, message: 'Bad signature' }, 401);
  }

  const result = await sendNotificationToSubscribers(env, role, phone10, notification);
  return jsonResponse(result);
}

async function handleDebugNotifies(request, env) {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ ok: false, message: 'Unauthorized' }, 401);
  }

  if (!env.PUSH_SUBSCRIPTIONS) {
    return jsonResponse({ ok: false, message: 'KV is not configured' }, 500);
  }

  const names = [];
  let cursor;

  do {
    const page = await env.PUSH_SUBSCRIPTIONS.list({ prefix: 'event:', cursor });
    names.push(...page.keys.map(key => key.name));
    cursor = page.cursor;
  } while (cursor);

  const keys = names.sort().slice(-25).reverse();

  const events = [];
  for (const key of keys) {
    const raw = await env.PUSH_SUBSCRIPTIONS.get(key);
    if (!raw) continue;

    try {
      events.push(JSON.parse(raw));
    } catch (e) {}
  }

  return jsonResponse({ ok: true, events });
}

async function handleClientDebug(request, env) {
  if (!env.PUSH_SUBSCRIPTIONS) {
    return jsonResponse({ ok: false, message: 'KV is not configured' }, 500);
  }

  const body = await readJson(request);
  const eventWrite = await writeNotifyEvent(env, {
    source: 'client',
    role: String(body && body.role || '').slice(0, 30),
    phone10: last10(body && body.phone),
    title: String(body && body.title || '').slice(0, 80),
    body: String(body && body.body || '').slice(0, 240),
    tag: String(body && body.tag || '').slice(0, 80),
    total: body && body.total,
    sent: body && body.sent,
    failed: body && body.failed,
    code: body && body.code,
    ok: body && body.ok,
    debug: body && body.debug ? JSON.stringify(body.debug).slice(0, 800) : '',
    userAgent: request.headers.get('user-agent') || ''
  });

  return jsonResponse({ ok: !!eventWrite.ok, eventWrite });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return jsonResponse({ ok: true });

    if (request.method === 'GET' && url.pathname === '/') {
      return jsonResponse({ ok: true, service: 'medsi-push-worker' });
    }

    if (request.method === 'POST' && url.pathname === '/subscribe') {
      return handleSubscribe(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/unsubscribe') {
      return handleUnsubscribe(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/notify') {
      return handleNotify(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/notify-client') {
      return handleNotifyClient(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/debug/notifies') {
      return handleDebugNotifies(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/debug/client') {
      return handleClientDebug(request, env);
    }

    return jsonResponse({ ok: false, message: 'Not found' }, 404);
  }
};
