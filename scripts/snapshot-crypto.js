'use strict';
// Шифрование снимков для публичного репозитория. Снимок шифруется случайным ключом AES-256-GCM, а этот ключ —
// открытым ключом RSA (scripts/snapshot-public-key.pem, лежит в репозитории). Расшифровать может только тот,
// у кого закрытый ключ (data/snapshot-key.pem — только на компьютере владельца, в .gitignore).
const crypto = require('crypto');

const FORMAT = 'wb-snapshot-v1';

function encryptSnapshot(value, publicKeyPem) {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const wrappedKey = crypto.publicEncrypt({ key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  return JSON.stringify({ format: FORMAT, key: wrappedKey.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decryptSnapshot(text, privateKeyPem) {
  const box = JSON.parse(text);
  if (box.format !== FORMAT) throw new Error('Неизвестный формат снимка');
  const key = crypto.privateDecrypt({ key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(box.key, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8'));
}

function generateSnapshotKeys() {
  return crypto.generateKeyPairSync('rsa', { modulusLength: 4096, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
}

module.exports = { encryptSnapshot, decryptSnapshot, generateSnapshotKeys };
