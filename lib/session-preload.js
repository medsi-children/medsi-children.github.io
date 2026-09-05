'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const APP_SCRIPT_URL = String(
  process.env.APP_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec'
).trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || process.env.S3_SECRET_KEY || '').trim();
const key = SESSION_SECRET ? crypto.createHash('sha256').update(SESSION_SECRET).digest() : null;
const ROOT = path.resolve(__dirname, '..');

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function wrapSession(session, role, phone) {
  if (!key || !session || !session.token) return session;
  const expiresAt = Number(session.expiresAt || 0) || (Date.now() + 24 * 60 * 60 * 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    role: String(role || ''),
    phone: String(phone || '').replace(/\D+/g, '').slice(-10),
    upstreamToken: String(session.token),
    upstreamExpiresAt: expiresAt,
    exp: expiresAt
  }));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ...session,
    token: 'tw1.' + b64url(Buffer.concat([iv, tag, encrypted])),
    expiresAt,
    provider: 'timeweb'
  };
}

function unwrapToken(token) {
  const raw = String(token || '').trim();
  if (!raw.startsWith('tw1.')) return null;
  if (!key) throw new Error('SESSION_SECRET_MISSING');
  const packed = fromB64url(raw.slice(4));
  if (packed.length < 29) throw new Error('BAD_SESSION');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decoded = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const payload = JSON.parse(decoded.toString('utf8'));
  if (!payload || !payload.upstreamToken || Number(payload.exp || 0) <= Date.now() + 1000) {
    throw new Error('SESSION_EXPIRED');
  }
  return payload;
}

function replaceSession(result, method, args) {
  if (!result || !key) return result;
  const role = method === 'getD1ChatSession' ? String(args && args[0] || '') : 'educator';
  const phone = method === 'getD1ChatSession' ? String(args && args[1] || '') : '';

  if (result.d1Session && result.d1Session.token) {
    return { ...result, d1Session: wrapSession(result.d1Session, role, phone) };
  }
  if (result.session && result.session.token) {
    return { ...result, session: wrapSession(result.session, role, phone) };
  }
  if (method === 'getD1ChatSession' && result.token) {
    return wrapSession(result, role, phone);
  }
  return result;
}

async function callAppsScript(payload) {
  const response = await fetch(APP_SCRIPT_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (_) { throw new Error('BAD_APPS_SCRIPT_RESPONSE'); }
  if (!response.ok || !parsed || parsed.ok !== true) {
    const error = new Error((parsed && parsed.message) || ('HTTP ' + response.status));
    error.status = response.status;
    throw error;
  }
  return parsed;
}

function serveCombinedTransport(res) {
  const client = fs.readFileSync(path.join(ROOT, 'chat-overlay', 'session-client.js'), 'utf8');
  const transport = fs.readFileSync(path.join(ROOT, 'chat-overlay', 'transport.js'), 'utf8');
  res.statusCode = 200;
  res.setHeader('content-type', 'application/javascript; charset=utf-8');
  res.setHeader('cache-control', 'no-store, max-age=0');
  res.end(client + '\n' + transport);
}

const originalExpress = express;
function patchedExpress() {
  const app = originalExpress();

  app.use(async (req, res, next) => {
    try {
      const incoming = String(req.headers['x-medsi-chat-session'] || '').trim();
      if (incoming.startsWith('tw1.')) {
        const session = unwrapToken(incoming);
        req.headers['x-medsi-chat-session'] = session.upstreamToken;
        req.medsiTimewebSession = session;
      }
    } catch (error) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, code: 'SESSION_EXPIRED', message: 'Сессия чата истекла. Откройте чат заново.' }));
      return;
    }

    if (req.method === 'GET' && req.url.split('?')[0] === '/chat-overlay/transport.js') {
      try { serveCombinedTransport(res); }
      catch (error) { next(error); }
      return;
    }

    if (req.method === 'GET' && req.url === '/__session/health') {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        ok: !!key,
        configured: !!key,
        provider: 'timeweb',
        secretSource: process.env.SESSION_SECRET ? 'dedicated' : (process.env.S3_SECRET_KEY ? 's3-derived' : 'missing')
      }));
      return;
    }

    if (req.method === 'POST' && req.url === '/__session/apps-script') {
      if (!key) {
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, message: 'Timeweb session service is not configured.' }));
        return;
      }
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 64 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
          chunks.push(chunk);
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const method = String(payload && payload.method || '');
        const allowed = new Set(['getD1ChatSession', 'verifyTutorSession', 'verifyTutorAccess']);
        if (payload.action !== 'api' || !allowed.has(method)) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, message: 'Unsupported session request.' }));
          return;
        }
        const upstream = await callAppsScript(payload);
        const result = replaceSession(upstream.result, method, payload.args || []);
        res.setHeader('cache-control', 'no-store');
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ...upstream, result }));
      } catch (error) {
        console.error('TIMEWEB_SESSION_BRIDGE_FAILED', error);
        res.statusCode = Number(error.status || 502);
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, message: 'Не удалось получить сессию чата.' }));
      }
      return;
    }

    next();
  });

  return app;
}

Object.assign(patchedExpress, originalExpress);
require.cache[require.resolve('express')].exports = patchedExpress;

module.exports = {
  configured: !!key,
  wrapSession,
  unwrapToken
};
