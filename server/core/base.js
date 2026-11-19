'use strict';
// --- Основа сервера: настройки из .env, кабинеты и их токены, запросы к WB API (только официальные домены, повтор на 429),
// кэш ответов, чтение тела запроса и ответ, даты по Москве, папки кабинетов.
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

// Корень проекта (папка с server.js): от него — data/, public/, .env.
const ROOT = path.join(__dirname, '..', '..');
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 4173);
const DATA_FILE = path.join(ROOT, 'data', 'cabinets.json');
const ADS_DIR = path.join(ROOT, 'data', 'Ads');
const WB_HOSTS = new Set([
  'content-api.wildberries.ru',
  'content-api-sandbox.wildberries.ru',
  'seller-analytics-api.wildberries.ru',
  'discounts-prices-api.wildberries.ru',
  'discounts-prices-api-sandbox.wildberries.ru',
  'marketplace-api.wildberries.ru',
  'statistics-api.wildberries.ru',
  'statistics-api-sandbox.wildberries.ru',
  'advert-api.wildberries.ru',
  'advert-api-sandbox.wildberries.ru',
  'feedbacks-api.wildberries.ru',
  'buyer-chat-api.wildberries.ru',
  'supplies-api.wildberries.ru',
  'returns-api.wildberries.ru',
  'documents-api.wildberries.ru',
  'finance-api.wildberries.ru',
  'common-api.wildberries.ru',
  'user-management-api.wildberries.ru'
]);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const analyticsCache = new Map();

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function readAliases() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function cabinets() {
  const aliases = readAliases();
  return Object.keys(process.env)
    .map(key => key.match(/^WB_TOKEN_(\d+)$/))
    .filter(Boolean)
    .map(match => Number(match[1]))
    .sort((a, b) => a - b)
    .filter(number => process.env[`WB_TOKEN_${number}`]?.trim())
    .map(number => ({
      id: String(number),
      name: aliases[number] || process.env[`WB_CABINET_${number}_NAME`] || `Кабинет ${number}`,
      token: process.env[`WB_TOKEN_${number}`].trim()
    }));
}

function publicCabinets() {
  const list = cabinets().map(({ id, name, token }) => ({ id, name, configured: Boolean(token) }));
  if (!list.length) list.push({ id: 'demo', name: 'Демо-кабинет', configured: false });
  return list;
}

function tokenFor(id) {
  const item = cabinets().find(c => c.id === String(id));
  if (!item) throw apiError(404, 'Кабинет не найден. Проверьте токены в .env');
  return item.token;
}

function apiError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

async function readJson(req, limit = 2_000_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw apiError(413, 'Слишком большой запрос');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw apiError(400, 'Некорректный JSON');
  }
}

function send(res, status, payload, headers = {}) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function wbRequest(token, url, options = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !WB_HOSTS.has(target.hostname)) throw apiError(400, 'Разрешены только официальные домены WB API');
  const method = String(options.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw apiError(400, 'HTTP-метод не поддерживается');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(target, {
      method,
      signal: controller.signal,
      headers: { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': 'wb-analytics/1.0' },
      body: ['GET', 'DELETE'].includes(method) || options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!response.ok) {
      const message = data?.detail || data?.message || `WB API вернул ${response.status}`;
      const error = apiError(response.status, message, data);
      error.retryAfter = Number(response.headers.get('x-ratelimit-retry')) || 0;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw apiError(504, 'WB API не ответил за 25 секунд');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Все даты по умолчанию считаются по Москве (UTC+3), как в кабинете WB.
function dateDaysAgo(days) {
  return moscowDate(-days);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Одновременные запросы с одним ключом ждут одну общую загрузку, а не идут в WB параллельно.
const analyticsPending = new Map();
async function cachedAnalytics(key, loader, ttl = 60_000) {
  const cached = analyticsCache.get(key);
  if (cached && Date.now() - cached.savedAt < ttl) return cached.value;
  if (!analyticsPending.has(key)) {
    analyticsPending.set(
      key,
      (async () => {
        try {
          const value = await loader();
          analyticsCache.set(key, { value, savedAt: Date.now() });
          return value;
        } finally {
          analyticsPending.delete(key);
        }
      })()
    );
  }
  try {
    return await analyticsPending.get(key);
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  }
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function datesBetween(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

// Имя папки из названия кабинета: без символов, запрещённых в Windows, и не только из цифр,
// чтобы не путать с папками кампаний.
function safeFolderName(name, fallback) {
  const clean = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80);
  if (!clean || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return fallback;
  return /^\d+$/.test(clean) ? `Кабинет ${clean}` : clean;
}

function cabinetFolderName(cabinetId) {
  const cabinet = cabinets().find(item => String(item.id) === String(cabinetId));
  return safeFolderName(cabinet?.name, `Кабинет ${cabinetId}`);
}

// --- История воронки продаж ---
// WB отдаёт историю воронки только за последние 7 дней, поэтому дни сохраняются
// в data/Funnel/<кабинет>/<месяц>.json и прошлые периоды берутся оттуда.
function moscowDate(offsetDays = 0) {
  const date = new Date(Date.now() + 3 * 3_600_000);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

module.exports = {
  ADS_DIR,
  DATA_FILE,
  PORT,
  ROOT,
  WB_HOSTS,
  addDays,
  analyticsCache,
  analyticsPending,
  apiError,
  cabinetFolderName,
  cabinets,
  cachedAnalytics,
  dateDaysAgo,
  datesBetween,
  moscowDate,
  publicCabinets,
  readAliases,
  readJson,
  safeFolderName,
  send,
  tokenFor,
  wait,
  wbRequest
};
