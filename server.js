'use strict';

const express = require('express');
const path = require('path');
const database = require('./lib/database');
const storage = require('./lib/s3-storage');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024);
const CHAT_UPSTREAM = String(
  process.env.CHAT_UPSTREAM || 'https://medsi-chat-worker.medsi-children.workers.dev'
).replace(/\/$/, '');
const UPLOAD_UPSTREAM = String(
  process.env.UPLOAD_UPSTREAM || 'https://medsi-chat-upload-test.medsi-children.workers.dev'
).replace(/\/$/, '');

function forwardedHeaders(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (value == null) continue;
    const lower = name.toLowerCase();
    if (['host', 'connection', 'content-length', 'accept-encoding'].includes(lower)) continue;
    if (Array.isArray(value)) value.forEach(v => headers.append(name, String(v)));
    else headers.set(name, String(value));
  }
  return headers;
}

async function proxy(req, res, target) {
  try {
    const method = String(req.method || 'GET').toUpperCase();
    const options = {
      method,
      headers: forwardedHeaders(req),
      redirect: 'manual'
    };

    if (!['GET', 'HEAD'].includes(method)) {
      options.body = req;
      options.duplex = 'half';
    }

    const upstream = await fetch(target, options);
    res.status(upstream.status);

    for (const name of [
      'content-type',
      'content-disposition',
      'cache-control',
      'etag',
      'last-modified',
      'x-content-type-options',
      'accept-ranges',
      'content-range',
      'content-length',
      'location'
    ]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    if (!upstream.body || method === 'HEAD') {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise(resolve => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (error) {
    console.error('UPSTREAM_PROXY_FAILED', target, error);
    if (!res.headersSent) {
      res.status(502).json({ ok: false, code: 'UPSTREAM_UNAVAILABLE', message: 'Временная ошибка связи с сервером чата.' });
    } else {
      res.end();
    }
  }
}

async function probe(url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000)
    });
    try { await response.body?.cancel(); } catch (_) {}
    return {
      ok: true,
      status: response.status,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      message: error.message
    };
  }
}

function sessionToken(req) {
  return String(req.get('X-Medsi-Chat-Session') || '').trim();
}

async function validateSessionForPhone(req, phone) {
  const token = sessionToken(req);
  if (!token || !phone) return false;
  try {
    const response = await fetch(
      CHAT_UPSTREAM + '/lab/threads/' + encodeURIComponent(String(phone)) + '?before=&limit=1',
      {
        method: 'GET',
        headers: { 'X-Medsi-Chat-Session': token },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000)
      }
    );
    try { await response.body?.cancel(); } catch (_) {}
    return response.ok;
  } catch (_) {
    return false;
  }
}

app.all(/^\/lab(?:\/.*)?$/, (req, res) => {
  proxy(req, res, CHAT_UPSTREAM + req.originalUrl);
});

app.get('/media/s3/:key', async (req, res) => {
  if (!storage.configured) {
    res.status(503).json({ ok: false, code: 'S3_NOT_CONFIGURED', message: 'Хранилище медиа ещё не подключено.' });
    return;
  }
  try {
    const object = await storage.getObject(req.params.key, req.headers.range);
    if (object.ContentType) res.setHeader('content-type', object.ContentType);
    if (object.ContentDisposition) res.setHeader('content-disposition', object.ContentDisposition);
    if (object.ContentLength != null) res.setHeader('content-length', String(object.ContentLength));
    if (object.ContentRange) res.setHeader('content-range', object.ContentRange);
    res.setHeader('accept-ranges', object.AcceptRanges || 'bytes');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.setHeader('x-content-type-options', 'nosniff');
    res.status(object.ContentRange ? 206 : 200);
    if (object.Body && typeof object.Body.pipe === 'function') {
      object.Body.pipe(res);
    } else {
      const bytes = await object.Body.transformToByteArray();
      res.end(Buffer.from(bytes));
    }
  } catch (error) {
    const status = error && (error.$metadata?.httpStatusCode || error.statusCode);
    if (status === 404 || error?.name === 'NoSuchKey') {
      res.status(404).end();
      return;
    }
    console.error('S3_MEDIA_READ_FAILED', error);
    res.status(502).json({ ok: false, code: 'MEDIA_READ_FAILED', message: 'Не удалось загрузить вложение.' });
  }
});

app.all(/^\/media(?:\/.*)?$/, (req, res) => {
  proxy(req, res, CHAT_UPSTREAM + req.originalUrl);
});

app.post('/chat-upload', async (req, res) => {
  if (!storage.configured) {
    proxy(req, res, UPLOAD_UPSTREAM + '/chat-upload');
    return;
  }

  const phone = String(req.get('X-Medsi-Phone') || '').replace(/\D+/g, '').slice(-10);
  const length = Number(req.headers['content-length'] || 0);
  if (length > MAX_UPLOAD_BYTES) {
    res.status(413).json({ ok: false, code: 'FILE_TOO_LARGE', message: 'Размер файла не должен превышать 100 МБ.' });
    return;
  }

  const allowed = await validateSessionForPhone(req, phone);
  if (!allowed) {
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Сессия чата истекла. Откройте чат заново.' });
    return;
  }

  try {
    const uploaded = await storage.uploadStream({
      body: req,
      contentType: req.get('content-type') || '',
      contentLength: length,
      fileName: req.get('X-File-Name') || 'attachment'
    });
    res.setHeader('cache-control', 'no-store');
    res.json({
      ok: true,
      type: uploaded.mediaType,
      fileId: 's3:' + uploaded.key,
      url: '/media/s3/' + encodeURIComponent(uploaded.key)
    });
  } catch (error) {
    console.error('S3_UPLOAD_FAILED', error);
    const unsupported = error && error.code === 'UNSUPPORTED_MEDIA';
    res.status(unsupported ? 415 : 502).json({
      ok: false,
      code: unsupported ? 'UNSUPPORTED_MEDIA' : 'UPLOAD_FAILED',
      message: unsupported ? error.message : 'Не удалось загрузить вложение.'
    });
  }
});

app.get('/__health', async (_req, res) => {
  const [db, media] = await Promise.all([database.health(), storage.health()]);
  const ok = db.ok && media.ok;
  res.status(ok ? 200 : 503).json({
    ok,
    service: 'medsi-timeweb-gateway',
    database: db,
    media
  });
});

app.get('/__diag/network', async (_req, res) => {
  const [chat, upload, db, media] = await Promise.all([
    probe(CHAT_UPSTREAM + '/'),
    probe(UPLOAD_UPSTREAM + '/'),
    database.health(),
    storage.health()
  ]);

  res.setHeader('cache-control', 'no-store');
  res.json({
    ok: true,
    measuredAt: new Date().toISOString(),
    timewebToCloudflare: { chat, upload },
    database: db,
    media
  });
});

app.use(express.static(path.resolve(__dirname), {
  dotfiles: 'ignore',
  index: 'index.html',
  maxAge: 0,
  etag: true
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Medsi Timeweb gateway listening on ${PORT}`);
});
