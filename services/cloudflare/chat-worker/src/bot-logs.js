const PREFIX = 'botlog:v1:';
const RETENTION_SECONDS = 30 * 24 * 60 * 60;
const MAX_TEXT = 35000;
const MAX_TOTAL = 70000;

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,x-medsi-chat-session'
    }
  });
}

function equal(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) {
    crypto.subtle.timingSafeEqual(left, left);
    return false;
  }
  return crypto.subtle.timingSafeEqual(left, right);
}

async function readJsonLimited(request) {
  if (!request.body) return { bad: true };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 100000) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { return { bad: true }; }
}

export function botLogViewerAuthorized(request, env) {
  const token = String(env.BOT_LOG_VIEWER_TOKEN || '');
  return token.length >= 32 && equal(request.headers.get('authorization') || '', `Bearer ${token}`);
}

export async function saveBotLog(request, env, auth) {
  if (auth.role !== 'parent' || !auth.phone10) return reply({ ok: false }, 403);
  if (!env.CHAT_MEDIA) return reply({ ok: false, code: 'LOG_UNAVAILABLE' }, 503);
  if (Number(request.headers.get('content-length') || 0) > 100000) return reply({ ok: false, code: 'TOO_LARGE' }, 413);

  const parsed = await readJsonLimited(request);
  if (parsed.tooLarge) return reply({ ok: false, code: 'TOO_LARGE' }, 413);
  if (parsed.bad) return reply({ ok: false, code: 'BAD_JSON' }, 400);
  const payload = parsed.value;
  const sessionId = String(payload && payload.sessionId || '');
  const eventId = String(payload && payload.eventId || '');
  const at = Date.now();
  const entries = payload && payload.entries;
  const validId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (!validId.test(sessionId) || !validId.test(eventId)
      || !Array.isArray(entries) || !entries.length || entries.length > 12) {
    return reply({ ok: false, code: 'BAD_LOG' }, 400);
  }

  let total = 0;
  const cleanEntries = [];
  for (const item of entries) {
    const side = String(item && item.side || '');
    const text = String(item && item.text || '');
    if (!['user', 'bot'].includes(side) || !text || text.length > MAX_TEXT) return reply({ ok: false, code: 'BAD_ENTRY' }, 400);
    total += text.length;
    if (total > MAX_TOTAL) return reply({ ok: false, code: 'TOO_LARGE' }, 413);
    cleanEntries.push({ side, text });
  }

  const reverseTime = String(9999999999999 - at).padStart(13, '0');
  const key = `${PREFIX}${reverseTime}:${sessionId}:${eventId}`;
  await env.CHAT_MEDIA.put(key, JSON.stringify({ sessionId, eventId, at, entries: cleanEntries }), {
    expirationTtl: RETENTION_SECONDS
  });
  return reply({ ok: true });
}

export async function listBotLogs(request, env) {
  if (!botLogViewerAuthorized(request, env)) return reply({ ok: false }, 401);
  if (!env.CHAT_MEDIA) return reply({ ok: false, code: 'LOG_UNAVAILABLE' }, 503);
  const cursor = new URL(request.url).searchParams.get('cursor') || undefined;
  const page = await env.CHAT_MEDIA.list({ prefix: PREFIX, limit: 50, cursor });
  const records = await Promise.all(page.keys.map(async item => {
    const value = await env.CHAT_MEDIA.get(item.name, 'json');
    return value && Array.isArray(value.entries) ? value : null;
  }));
  return reply({ ok: true, records: records.filter(Boolean), cursor: page.list_complete ? '' : page.cursor });
}
