'use strict';

const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
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
      'x-content-type-options'
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

app.all(/^\/lab(?:\/.*)?$/, (req, res) => {
  proxy(req, res, CHAT_UPSTREAM + req.originalUrl);
});

app.all(/^\/media(?:\/.*)?$/, (req, res) => {
  proxy(req, res, CHAT_UPSTREAM + req.originalUrl);
});

app.all('/chat-upload', (req, res) => {
  proxy(req, res, UPLOAD_UPSTREAM + '/chat-upload');
});

app.get('/__health', (_req, res) => {
  res.json({ ok: true, service: 'medsi-timeweb-gateway' });
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
