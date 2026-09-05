'use strict';

const crypto = require('crypto');
const {
  S3Client,
  HeadBucketCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const bucket = String(process.env.S3_BUCKET || '').trim();
const endpoint = String(process.env.S3_ENDPOINT || 'https://s3.twcstorage.ru').replace(/\/$/, '');
const region = String(process.env.S3_REGION || 'ru-1');
const accessKeyId = String(process.env.S3_ACCESS_KEY || '').trim();
const secretAccessKey = String(process.env.S3_SECRET_KEY || '').trim();
const configured = Boolean(bucket && accessKeyId && secretAccessKey);

const client = configured ? new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey }
}) : null;

function decodeFileName(value) {
  const raw = String(value || 'attachment');
  try { return decodeURIComponent(raw); } catch (_) { return raw; }
}

function classify(contentType, fileName) {
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  const ext = String(fileName || '').toLowerCase().split('.').pop();
  if (['jpg','jpeg','png','webp','gif','heic','heif','avif'].includes(ext)) return 'image';
  if (['mp4','mov','m4v','webm','avi'].includes(ext)) return 'video';
  return '';
}

function extensionFor(contentType, fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]{2,8})$/i);
  if (match) return '.' + match[1];
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm'
  };
  return map[String(contentType || '').toLowerCase()] || '';
}

async function health() {
  if (!configured) return { configured: false, ok: true, mode: 'cloudflare-media' };
  const startedAt = Date.now();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return { configured: true, ok: true, mode: 'timeweb-s3', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { configured: true, ok: false, mode: 'timeweb-s3', latencyMs: Date.now() - startedAt, message: error.message };
  }
}

async function uploadStream({ body, contentType, contentLength, fileName }) {
  if (!configured) throw new Error('S3_NOT_CONFIGURED');
  const decodedName = decodeFileName(fileName);
  const mediaType = classify(contentType, decodedName);
  if (!mediaType) {
    const error = new Error('Можно прикреплять только фото или видео.');
    error.code = 'UNSUPPORTED_MEDIA';
    throw error;
  }
  const key = crypto.randomUUID() + extensionFor(contentType, decodedName);
  const uploader = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: String(contentType || 'application/octet-stream'),
      ContentDisposition: 'inline',
      Metadata: { originalname: encodeURIComponent(decodedName).slice(0, 900) },
      ...(Number(contentLength) > 0 ? { ContentLength: Number(contentLength) } : {})
    },
    queueSize: 3,
    partSize: 5 * 1024 * 1024,
    leavePartsOnError: false
  });
  await uploader.done();
  return { key, mediaType };
}

async function getObject(key, range) {
  if (!configured) throw new Error('S3_NOT_CONFIGURED');
  return client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: String(key || ''),
    ...(range ? { Range: String(range) } : {})
  }));
}

async function removeObject(key) {
  if (!configured) return false;
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: String(key || '') }));
  return true;
}

module.exports = {
  configured,
  bucket,
  health,
  uploadStream,
  getObject,
  removeObject
};
