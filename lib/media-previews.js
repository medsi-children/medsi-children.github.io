'use strict';

// Owns the S3 preview convention. D1 keeps only the original `s3:<key>`;
// previews are deterministic companion objects and can always be regenerated.
const crypto = require('crypto');
const sharp = require('sharp');
const storage = require('./s3-storage');

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40 * 1000 * 1000;
const pending = new Map();

function previewKey(sourceKey) {
  const digest = crypto.createHash('sha256').update(String(sourceKey || '')).digest('hex');
  return 'previews/' + digest + '.webp';
}

async function bodyToBuffer(body) {
  if (!body) throw new Error('S3_OBJECT_BODY_MISSING');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of body) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_SOURCE_BYTES) throw new Error('S3_PREVIEW_SOURCE_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function create(sourceKey) {
  if (!storage.configured || !sourceKey) return null;
  const targetKey = previewKey(sourceKey);
  if (await storage.hasObject(targetKey)) return targetKey;

  const source = await storage.getObject(sourceKey);
  const contentType = String(source.ContentType || '').toLowerCase();
  const contentLength = Number(source.ContentLength || 0);
  if (!contentType.startsWith('image/') || (contentLength && contentLength > MAX_SOURCE_BYTES)) {
    source.Body?.destroy();
    return null;
  }

  const input = await bodyToBuffer(source.Body);
  const preview = await sharp(input, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78, smartSubsample: true })
    .toBuffer();
  await storage.putBuffer(targetKey, preview, 'image/webp');
  return targetKey;
}

async function ensure(sourceKey) {
  if (pending.has(sourceKey)) return pending.get(sourceKey);
  const job = create(sourceKey).catch(error => {
    // A preview is optional. An unsupported image must remain available through
    // its original object instead of making the chat message fail.
    console.warn('S3_MEDIA_PREVIEW_SKIPPED', sourceKey, error && error.message);
    return null;
  }).finally(() => pending.delete(sourceKey));
  pending.set(sourceKey, job);
  return job;
}

module.exports = { previewKey, create, ensure };
