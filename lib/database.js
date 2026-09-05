'use strict';

const { Pool } = require('pg');

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const DATABASE_SSL = String(process.env.DATABASE_SSL || 'require').trim().toLowerCase();

let pool = null;

function isConfigured() {
  return Boolean(DATABASE_URL);
}

function getPool() {
  if (!isConfigured()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }
  return pool;
}

async function health() {
  if (!isConfigured()) return { configured: false, ok: true, mode: 'cloudflare-proxy' };
  const startedAt = Date.now();
  try {
    const client = await getPool().connect();
    try {
      await client.query('select 1 as ok');
    } finally {
      client.release();
    }
    return { configured: true, ok: true, latencyMs: Date.now() - startedAt, mode: 'postgres-ready' };
  } catch (error) {
    return { configured: true, ok: false, latencyMs: Date.now() - startedAt, message: error.message };
  }
}

module.exports = { isConfigured, getPool, health };
