'use strict';
// --- Фото карточек с CDN WB: через /api/photo/… сервер скачивает их в data/Photos и отдаёт с диска.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { ROOT, apiError } = require('./base');

const PHOTOS_DIR = path.join(ROOT, 'data', 'Photos');
const PHOTO_REFRESH_MS = 3 * 24 * 60 * 60_000;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const photoPending = new Map();
function cardPhoto(card = {}) {
  const photo = card.photos?.[0] || {};
  return localPhoto(photo.c246x328 || photo.tm || photo.square || photo.big || '');
}

// Фото карточек с CDN WB идут через /api/photo/...: сервер один раз скачивает их в data/Photos
// и дальше отдаёт с диска, раз в PHOTO_REFRESH_MS тихо обновляя (продавец мог заменить фото под тем же адресом).
function isWbPhotoUrl(value) {
  try {
    const target = new URL(value);
    return (
      target.protocol === 'https:' &&
      /(^|\.)wbbasket\.ru$/.test(target.hostname) &&
      Boolean(PHOTO_TYPES[path.extname(target.pathname).toLowerCase()])
    );
  } catch {
    return false;
  }
}

function localPhoto(url) {
  return isWbPhotoUrl(url) ? `/api/photo/${url.slice('https://'.length)}` : url;
}

function downloadPhoto(source, file) {
  if (!photoPending.has(file))
    photoPending.set(
      file,
      (async () => {
        try {
          const response = await fetch(source, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'wb-analytics/1.0' } });
          if (!response.ok) throw apiError(response.status === 404 ? 404 : 502, `Фото WB не загрузилось (${response.status})`);
          const body = Buffer.from(await response.arrayBuffer());
          if (!body.length || body.length > PHOTO_MAX_BYTES) throw apiError(502, 'Фото WB пустое или слишком большое');
          fs.mkdirSync(PHOTOS_DIR, { recursive: true });
          const temp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(temp, body);
          // На Windows файл, который сейчас кто-то читает, заменить нельзя — тогда остаётся старая копия.
          try {
            fs.renameSync(temp, file);
          } catch (error) {
            fs.rmSync(temp, { force: true });
            if (!fs.existsSync(file)) throw error;
          }
        } finally {
          photoPending.delete(file);
        }
      })()
    );
  return photoPending.get(file);
}

async function servePhoto(res, url) {
  const source = `https://${url.pathname.slice('/api/photo/'.length)}`;
  if (!isWbPhotoUrl(source)) throw apiError(400, 'Разрешены только фото карточек WB');
  const ext = path.extname(new URL(source).pathname).toLowerCase();
  const file = path.join(PHOTOS_DIR, crypto.createHash('sha1').update(source).digest('hex') + ext);
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat) await downloadPhoto(source, file);
  else if (Date.now() - stat.mtimeMs > PHOTO_REFRESH_MS) downloadPhoto(source, file).catch(() => {});
  res.writeHead(200, { 'Content-Type': PHOTO_TYPES[ext], 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' });
  fs.createReadStream(file).pipe(res);
}

module.exports = { cardPhoto, localPhoto, servePhoto };
