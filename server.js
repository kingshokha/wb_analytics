'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { decryptSnapshot } = require('./scripts/snapshot-crypto');
const { compactGoods, moscowStamp } = require('./scripts/price-snapshot');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 4173);
const DATA_FILE = path.join(ROOT, 'data', 'cabinets.json');
const ADS_DIR = path.join(ROOT, 'data', 'Ads');
const FUNNEL_DIR = path.join(ROOT, 'data', 'Funnel');
const FUNNEL_COUNT_KEYS = ['openCount', 'cartCount', 'orderCount', 'orderSum', 'buyoutCount', 'buyoutSum', 'addToWishlistCount'];
const FUNNEL_PRODUCTS_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products';
const FUNNEL_BUCKET_SIZE = 3;
const FUNNEL_BUCKET_INTERVAL = 20_500;
const FUNNEL_FINAL_AFTER_DAYS = 7;
const FUNNEL_REFRESH_MINUTES = 60;
const FUNNEL_MAX_DEPTH_DAYS = 364;
const FUNNEL_RETRY_FAILED_MS = 10 * 60_000;
const funnelBuckets = new Map();
const funnelQueues = new Map();
const funnelJobs = new Map();
const AD_FRESH_DAYS = 7;
const BALANCE_HISTORY_FILE = path.join(ROOT, 'data', 'balance-history.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PHOTOS_DIR = path.join(ROOT, 'data', 'Photos');
const PHOTO_REFRESH_MS = 3 * 24 * 60 * 60_000;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const photoPending = new Map();
const WB_HOSTS = new Set([
  'content-api.wildberries.ru', 'content-api-sandbox.wildberries.ru',
  'seller-analytics-api.wildberries.ru', 'discounts-prices-api.wildberries.ru',
  'discounts-prices-api-sandbox.wildberries.ru', 'marketplace-api.wildberries.ru',
  'statistics-api.wildberries.ru', 'statistics-api-sandbox.wildberries.ru',
  'advert-api.wildberries.ru', 'advert-api-sandbox.wildberries.ru',
  'feedbacks-api.wildberries.ru', 'buyer-chat-api.wildberries.ru',
  'supplies-api.wildberries.ru', 'returns-api.wildberries.ru',
  'documents-api.wildberries.ru', 'finance-api.wildberries.ru',
  'common-api.wildberries.ru', 'user-management-api.wildberries.ru'
]);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MARKETPLACE_API = 'https://marketplace-api.wildberries.ru';
const STICKER_TYPES = new Set(['png', 'svg', 'zplv', 'zplh']);
const ORDER_STICKER_CHUNK = 100;
const ORDER_FEED_LIMIT = 10_000;
const SUPPLY_ORDERS_CHUNK = 100;
const ORDERS_LOOKUP_MAX_PAGES = 30;
const CARGO_TYPES = { 0: 'Не указан', 1: 'Обычный', 2: 'СГТ', 3: 'КГТ' };
const STOCK_PRESETS_FILE = path.join(ROOT, 'data', 'stock-presets.json');
const PRICE_PRESETS_FILE = path.join(ROOT, 'data', 'price-presets.json');
const KEYWORD_TAGS_FILE = path.join(ROOT, 'data', 'keyword-tags.json');
// Отметки ключевых запросов: одна основная отметка на запрос плюс независимая «Важный».
const KEYWORD_TAG_KEYS = ['target', 'nearTarget', 'nonTarget', 'promote', 'test', 'traffic', 'watch', 'unprofitable', 'profitable', 'investigate'];
const PRESET_MAX_ITEMS = 200;
const PRESET_MAX_COUNT = 50;
const STOCK_PRESET_MAX_AMOUNT = 100_000;
const PRICE_PRESET_MAX_PRICE = 1_000_000;
const STOCKS_REPORT_API = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report';
const NORMQUERY_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/stats';
const NORMQUERY_DAILY_URL = 'https://advert-api.wildberries.ru/adv/v1/normquery/stats';
const NORMQUERY_LIST_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/list';
const NORMQUERY_GET_MINUS_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/get-minus';
const NORMQUERY_SET_MINUS_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/set-minus';
const NORMQUERY_MINUS_LIMIT = 1000;
const NORMQUERY_LIST_INTERVAL = 250;
const NORMQUERY_CHUNK = 100;
const NORMQUERY_INTERVAL = 6_500;
const NORMQUERY_BURST = 10;
const normqueryBuckets = new Map();
const normqueryQueues = new Map();
const AD_CAMPAIGNS_URL = 'https://advert-api.wildberries.ru/api/advert/v2/adverts?statuses=7,9,11';
const FULLSTATS_INTERVAL = 20_500;
const HISTORY_MAX_MONTHS = 12;
const fullstatsQueues = new Map();
const fullstatsLastCall = new Map();
const AD_BUDGET_STATUSES = new Set([9, 11]);
const AD_BUDGET_CHUNK = 4;
const AD_BUDGET_LIMIT = 100;
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
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
}

function readBalanceHistory() {
  try { return JSON.parse(fs.readFileSync(BALANCE_HISTORY_FILE, 'utf8')); } catch { return {}; }
}

function readPresets(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// Шаблоны, сохранённые до локального кэша фото, хранят прямые ссылки на CDN WB — отдаём их тоже через кэш.
function cabinetPresets(file, cabinetId) {
  const list = readPresets(file)[cabinetId];
  return (Array.isArray(list) ? list : []).map(preset => ({ ...preset, items: (preset.items || []).map(item => ({ ...item, photo: localPhoto(item.photo || '') })) }));
}

function writePresets(file, presets) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(presets, null, 2));
}

function presetName(preset = {}) {
  const name = String(preset.name || '').trim().slice(0, 60);
  if (!name) throw apiError(400, 'Укажите название шаблона');
  return name;
}

function presetId(preset = {}) {
  return /^[\w-]{1,40}$/.test(String(preset.id || '')) ? String(preset.id) : `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function savePreset(file, cabinetId, preset, normalize) {
  const id = String(cabinetId || '');
  if (!id) throw apiError(400, 'Не указан кабинет');
  const normalized = normalize(preset);
  const all = readPresets(file);
  const list = Array.isArray(all[id]) ? all[id] : [];
  const index = list.findIndex(item => item.id === normalized.id);
  if (index >= 0) list[index] = normalized; else list.push(normalized);
  if (list.length > PRESET_MAX_COUNT) throw apiError(400, `Больше ${PRESET_MAX_COUNT} шаблонов хранить нельзя`);
  all[id] = list;
  writePresets(file, all);
  return { presets: list };
}

function removePreset(file, cabinetId, id) {
  const cabinet = String(cabinetId || '');
  const all = readPresets(file);
  all[cabinet] = (Array.isArray(all[cabinet]) ? all[cabinet] : []).filter(item => item.id !== String(id || ''));
  writePresets(file, all);
  return { presets: all[cabinet] };
}

function normalizePricePreset(preset = {}) {
  const name = presetName(preset);
  const items = (Array.isArray(preset.items) ? preset.items : []).map(item => ({
    nmId: Number(item.nmId), price: Math.round(Number(item.price)), discount: Math.round(Number(item.discount)),
    name: String(item.name || '').slice(0, 160), vendorCode: String(item.vendorCode || '').slice(0, 80),
    photo: String(item.photo || '').slice(0, 300)
  })).filter(item => Number.isInteger(item.nmId) && Number.isFinite(item.price) && item.price > 0 && item.price <= PRICE_PRESET_MAX_PRICE
    && Number.isInteger(item.discount) && item.discount >= 0 && item.discount <= 99);
  if (!items.length) throw apiError(400, 'Добавьте в шаблон хотя бы один товар с ценой и скидкой');
  if (items.length > PRESET_MAX_ITEMS) throw apiError(400, `В шаблоне не может быть больше ${PRESET_MAX_ITEMS} товаров`);
  return { id: presetId(preset), name, items, updatedAt: new Date().toISOString() };
}

function normalizeStockPreset(preset = {}) {
  const name = presetName(preset);
  const warehouseIds = [...new Set((Array.isArray(preset.warehouseIds) ? preset.warehouseIds : []).map(value => String(value || '')).filter(Boolean))];
  if (!warehouseIds.length) throw apiError(400, 'Выберите хотя бы один склад FBS');
  const items = (Array.isArray(preset.items) ? preset.items : []).map(item => ({
    chrtId: Number(item.chrtId), amount: Math.floor(Number(item.amount)),
    nmId: Number(item.nmId) || '', sku: String(item.sku || '').slice(0, 40),
    name: String(item.name || '').slice(0, 160), vendorCode: String(item.vendorCode || '').slice(0, 80),
    size: String(item.size || '').slice(0, 40), photo: String(item.photo || '').slice(0, 300)
  })).filter(item => Number.isInteger(item.chrtId) && Number.isInteger(item.amount) && item.amount >= 0 && item.amount <= STOCK_PRESET_MAX_AMOUNT);
  if (!items.length) throw apiError(400, 'Добавьте в шаблон хотя бы один артикул с количеством');
  if (items.length > PRESET_MAX_ITEMS) throw apiError(400, `В шаблоне не может быть больше ${PRESET_MAX_ITEMS} артикулов`);
  return { id: presetId(preset), name, warehouseIds, items, updatedAt: new Date().toISOString() };
}

function saveBalanceSnapshot(cabinetId, balance) {
  const history = readBalanceHistory();
  const list = Array.isArray(history[cabinetId]) ? history[cabinetId] : [];
  const current = Number(balance?.current || 0);
  const forWithdraw = Number(balance?.for_withdraw || 0);
  const previous = list[0];
  if (!previous || previous.current !== current || previous.forWithdraw !== forWithdraw || previous.currency !== balance.currency) {
    list.unshift({ timestamp: new Date().toISOString(), currency: balance.currency || 'RUB', current, forWithdraw,
      delta: previous ? current - previous.current : 0, withdrawDelta: previous ? forWithdraw - previous.forWithdraw : 0 });
    history[cabinetId] = list.slice(0, 20);
    fs.mkdirSync(path.dirname(BALANCE_HISTORY_FILE), { recursive: true });
    fs.writeFileSync(BALANCE_HISTORY_FILE, JSON.stringify(history, null, 2));
  }
  return history[cabinetId] || list;
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
  const error = new Error(message); error.status = status; error.details = details; return error;
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw apiError(413, 'Слишком большой запрос');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw apiError(400, 'Некорректный JSON'); }
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
      method, signal: controller.signal,
      headers: { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': 'wb-analytics/1.0' },
      body: ['GET', 'DELETE'].includes(method) || options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch {}
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
  } finally { clearTimeout(timeout); }
}

// Все даты по умолчанию считаются по Москве (UTC+3), как в кабинете WB.
function dateDaysAgo(days) {
  return moscowDate(-days);
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Одновременные запросы с одним ключом ждут одну общую загрузку, а не идут в WB параллельно.
const analyticsPending = new Map();
async function cachedAnalytics(key, loader, ttl = 60_000) {
  const cached = analyticsCache.get(key);
  if (cached && Date.now() - cached.savedAt < ttl) return cached.value;
  if (!analyticsPending.has(key)) {
    analyticsPending.set(key, (async () => {
      try {
        const value = await loader();
        analyticsCache.set(key, { value, savedAt: Date.now() });
        return value;
      } finally { analyticsPending.delete(key); }
    })());
  }
  try {
    return await analyticsPending.get(key);
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  }
}

async function loadProductCards(token) {
  const cards = [];
  let cursor = { limit: 100 };
  for (let page = 0; page < 50; page++) {
    const response = await wbRequest(token, 'https://content-api.wildberries.ru/content/v2/get/cards/list', {
      method: 'POST',
      body: { settings: { sort: { ascending: false }, cursor, filter: { withPhoto: -1 } } }
    });
    const batch = Array.isArray(response?.cards) ? response.cards : [];
    cards.push(...batch);
    if (batch.length < 100 || !response?.cursor?.updatedAt || !response?.cursor?.nmID) break;
    cursor = { limit: 100, updatedAt: response.cursor.updatedAt, nmID: response.cursor.nmID };
    if ((page + 1) % 5 === 0) await wait(650);
  }
  return cards;
}

function cardPhoto(card = {}) {
  const photo = card.photos?.[0] || {};
  return localPhoto(photo.c246x328 || photo.tm || photo.square || photo.big || '');
}

// Фото карточек с CDN WB идут через /api/photo/...: сервер один раз скачивает их в data/Photos
// и дальше отдаёт с диска, раз в PHOTO_REFRESH_MS тихо обновляя (продавец мог заменить фото под тем же адресом).
function isWbPhotoUrl(value) {
  try {
    const target = new URL(value);
    return target.protocol === 'https:' && /(^|\.)wbbasket\.ru$/.test(target.hostname) && Boolean(PHOTO_TYPES[path.extname(target.pathname).toLowerCase()]);
  } catch { return false; }
}

function localPhoto(url) {
  return isWbPhotoUrl(url) ? `/api/photo/${url.slice('https://'.length)}` : url;
}

function downloadPhoto(source, file) {
  if (!photoPending.has(file)) photoPending.set(file, (async () => {
    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'wb-analytics/1.0' } });
      if (!response.ok) throw apiError(response.status === 404 ? 404 : 502, `Фото WB не загрузилось (${response.status})`);
      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length || body.length > PHOTO_MAX_BYTES) throw apiError(502, 'Фото WB пустое или слишком большое');
      fs.mkdirSync(PHOTOS_DIR, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, body);
      // На Windows файл, который сейчас кто-то читает, заменить нельзя — тогда остаётся старая копия.
      try { fs.renameSync(temp, file); } catch (error) { fs.rmSync(temp, { force: true }); if (!fs.existsSync(file)) throw error; }
    } finally { photoPending.delete(file); }
  })());
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

function stockCardIndex(cards = []) {
  const index = new Map();
  for (const card of cards) for (const size of card.sizes || []) {
    const chrtId = String(size.chrtID || size.chrtId || '');
    if (!chrtId) continue;
    index.set(chrtId, { nmId: card.nmID, vendorCode: card.vendorCode || '', name: card.title || `Товар ${card.nmID}`,
      category: card.subjectName || 'Без категории', size: size.techSize || size.wbSize || '—', sku: (size.skus || [])[0] || '',
      photo: cardPhoto(card) });
  }
  return index;
}

function normalizeFbsStocks(warehouses = [], stockResponses = [], cards = []) {
  const byChrt = stockCardIndex(cards); const rows = [];
  stockResponses.forEach(({ warehouse, stocks }) => (stocks || []).forEach(stock => {
    const meta = byChrt.get(String(stock.chrtId)) || {};
    rows.push({ warehouseId: warehouse.id, warehouseName: warehouse.name || `Склад ${warehouse.id}`, officeId: warehouse.officeId,
      nmId: meta.nmId || '', vendorCode: meta.vendorCode || '', name: meta.name || `Размер ${stock.chrtId}`,
      category: meta.category || 'Без категории', size: meta.size || '—', sku: stock.sku || meta.sku || '', photo: meta.photo || '', chrtId: stock.chrtId,
      amount: Number(stock.amount || 0) });
  }));
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const categories = [...new Set(rows.map(row => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  return { rows: rows.sort((a, b) => b.amount - a.amount || String(a.name).localeCompare(String(b.name), 'ru')),
    warehouses: warehouses.map(item => ({ id: item.id, name: item.name || `Склад ${item.id}`, officeId: item.officeId })), categories,
    totals: { rows: rows.length, products: new Set(rows.map(row => String(row.nmId || row.chrtId))).size,
      warehouses: new Set(rows.map(row => String(row.warehouseId))).size, amount: totalAmount,
      zero: rows.filter(row => row.amount === 0).length, positive: rows.filter(row => row.amount > 0).length } };
}

function demoFbsStocks() {
  const warehouses = [{ id: 'demo-1', name: 'Основной FBS', officeId: 1 }, { id: 'demo-2', name: 'Резервный FBS', officeId: 2 }];
  const cards = [
    { nmID: 100001, vendorCode: 'TSHIRT-BLACK', title: 'Футболка базовая', subjectName: 'Одежда', sizes: [{ chrtID: 501, techSize: 'M', skus: ['460000000001'] }] },
    { nmID: 100002, vendorCode: 'MUG-THERMO', title: 'Термокружка', subjectName: 'Посуда', sizes: [{ chrtID: 502, techSize: '500 мл', skus: ['460000000002'] }] },
    { nmID: 100003, vendorCode: 'HOODIE-GREEN', title: 'Худи Oversize', subjectName: 'Одежда', sizes: [{ chrtID: 503, techSize: 'L', skus: ['460000000003'] }] }
  ];
  return { demo: true, ...normalizeFbsStocks(warehouses, [{ warehouse: warehouses[0], stocks: [{ chrtId: 501, sku: '460000000001', amount: 42 }, { chrtId: 502, sku: '460000000002', amount: 8 }] }, { warehouse: warehouses[1], stocks: [{ chrtId: 501, sku: '460000000001', amount: 15 }, { chrtId: 503, sku: '460000000003', amount: 0 }] }], cards), warnings: [] };
}

async function fbsStocks(id) {
  if (id === 'demo' || !cabinets().length) return demoFbsStocks();
  const token = tokenFor(id); const warnings = [];
  const warehousesResponse = await cachedAnalytics(`fbs-warehouses:${id}`, () => wbRequest(token, 'https://marketplace-api.wildberries.ru/api/v3/warehouses'), 2 * 60_000);
  const warehouses = (Array.isArray(warehousesResponse) ? warehousesResponse : []).filter(item => Number(item.deliveryType) === 1 && !item.isDeleting);
  const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000);
  const chrtIds = [...stockCardIndex(cards).keys()]; const responses = [];
  for (const warehouse of warehouses) {
    const stocks = [];
    for (let offset = 0; offset < chrtIds.length; offset += 1000) {
      if (offset) await wait(220);
      try {
        const result = await wbRequest(token, `https://marketplace-api.wildberries.ru/api/v3/stocks/${warehouse.id}`, { method: 'POST', body: { chrtIds: chrtIds.slice(offset, offset + 1000).map(Number) } });
        stocks.push(...(Array.isArray(result?.stocks) ? result.stocks : []));
      } catch (error) { warnings.push(`${warehouse.name || warehouse.id}: ${error.message}`); }
    }
    responses.push({ warehouse, stocks });
  }
  return { demo: false, ...normalizeFbsStocks(warehouses, responses, cards), warnings };
}

function normalizeFbwStocks(items = [], cards = []) {
  const byChrt = stockCardIndex(cards);
  const rows = items.map(item => {
    const meta = byChrt.get(String(item.chrtId)) || {};
    return { warehouseId: item.warehouseId, warehouseName: item.warehouseName || `Склад ${item.warehouseId || 'WB'}`,
      regionName: item.regionName || 'Без региона', nmId: Number(item.nmId || meta.nmId || 0) || '', chrtId: Number(item.chrtId || 0) || '',
      vendorCode: meta.vendorCode || '', name: meta.name || `Товар ${item.nmId || item.chrtId || ''}`,
      category: meta.category || 'Без категории', size: meta.size || '—', sku: meta.sku || '', photo: meta.photo || '',
      amount: Number(item.quantity || 0), inWayToClient: Number(item.inWayToClient || 0), inWayFromClient: Number(item.inWayFromClient || 0) };
  });
  const warehouses = [...new Map(rows.map(row => [String(row.warehouseId), { id: row.warehouseId, name: row.warehouseName }])).values()]
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  const categories = [...new Set(rows.map(row => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  return { rows: rows.sort((a, b) => b.amount - a.amount || String(a.name).localeCompare(String(b.name), 'ru')), warehouses, categories,
    totals: { rows: rows.length, products: new Set(rows.map(row => String(row.nmId || row.chrtId))).size,
      warehouses: new Set(rows.map(row => String(row.warehouseId))).size, amount: rows.reduce((sum, row) => sum + row.amount, 0),
      zero: rows.filter(row => row.amount === 0).length, positive: rows.filter(row => row.amount > 0).length } };
}

function demoFbwStocks() {
  const cards = [
    { nmID: 100001, vendorCode: 'TSHIRT-BLACK', title: 'Футболка базовая', subjectName: 'Одежда', sizes: [{ chrtID: 501, techSize: 'M', skus: ['460000000001'] }] },
    { nmID: 100002, vendorCode: 'MUG-THERMO', title: 'Термокружка', subjectName: 'Посуда', sizes: [{ chrtID: 502, techSize: '500 мл', skus: ['460000000002'] }] }
  ];
  const items = [
    { nmId: 100001, chrtId: 501, warehouseId: 507, warehouseName: 'Коледино', regionName: 'Центральный', quantity: 42, inWayToClient: 3, inWayFromClient: 1 },
    { nmId: 100002, chrtId: 502, warehouseId: 117986, warehouseName: 'Казань', regionName: 'Приволжский', quantity: 8, inWayToClient: 2, inWayFromClient: 0 }
  ];
  return { demo: true, ...normalizeFbwStocks(items, cards), warnings: [] };
}

// Отчёты остатков WB обновляются раз в 30 минут и ограничены 3 запросами в минуту,
// поэтому ответ кэшируется ненадолго и общий для вкладок FBW и цен.
async function loadInventoryReport(token, report) {
  const limit = 250000; const items = [];
  for (let offset = 0; ; offset += limit) {
    const response = await wbRequest(token, `${STOCKS_REPORT_API}/${report}`, { method: 'POST', body: { nmIds: [], chrtIds: [], limit, offset } });
    const batch = Array.isArray(response?.data?.items) ? response.data.items : Array.isArray(response?.items) ? response.items : [];
    items.push(...batch);
    if (batch.length < limit) break;
    await wait(20_100);
  }
  return items;
}

function inventoryReport(id, token, report) {
  return cachedAnalytics(`inventory:${report}:${id}`, () => loadInventoryReport(token, report), 2 * 60_000);
}

function summarizeStockTotals(wbItems = [], sellerItems = []) {
  const totals = {};
  const add = (items, key) => {
    for (const item of items) {
      const nmId = String(item.nmId || '');
      if (!nmId) continue;
      const row = totals[nmId] ||= { fbs: 0, fbw: 0, total: 0 };
      const quantity = Number(item.quantity || 0);
      row[key] += quantity; row.total += quantity;
    }
  };
  add(wbItems, 'fbw'); add(sellerItems, 'fbs');
  return totals;
}

async function priceStocks(id) {
  if (id === 'demo' || !cabinets().length) {
    return { demo: true, byNmId: summarizeStockTotals([{ nmId: 100001, quantity: 57 }, { nmId: 100002, quantity: 12 }],
      [{ nmId: 100001, quantity: 42 }, { nmId: 100001, quantity: 15 }, { nmId: 100002, quantity: 8 }]), warnings: [] };
  }
  const token = tokenFor(id); const warnings = [];
  const wb = await inventoryReport(id, token, 'wb-warehouses').catch(error => { warnings.push(`Остатки на складах WB: ${error.message}`); return null; });
  const seller = await inventoryReport(id, token, 'seller-warehouses').catch(error => { warnings.push(`Остатки на складах продавца: ${error.message}`); return null; });
  if (!wb && !seller) throw apiError(502, warnings.join('; '));
  return { demo: false, updatedAt: new Date().toISOString(), byNmId: summarizeStockTotals(wb || [], seller || []), warnings };
}

async function fbwStocks(id) {
  if (id === 'demo' || !cabinets().length) return demoFbwStocks();
  const token = tokenFor(id);
  const items = await inventoryReport(id, token, 'wb-warehouses');
  const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000);
  return { demo: false, ...normalizeFbwStocks(items, cards), warnings: [] };
}
function normalizePrices(goods = [], cards = []) {
  const byNmId = new Map(cards.map(card => [String(card.nmID), card]));
  const rows = goods.map(good => {
    const card = byNmId.get(String(good.nmID)) || {}; const sizes = Array.isArray(good.sizes) ? good.sizes : []; const firstSize = sizes[0] || {};
    return { nmId: Number(good.nmID), vendorCode: good.vendorCode || card.vendorCode || '', name: card.title || `Товар ${good.nmID}`,
      photo: cardPhoto(card),
      category: card.subjectName || 'Без категории', brand: card.brand || 'Без бренда', currency: good.currencyIsoCode4217 || 'RUB',
      price: Number(firstSize.price || good.price || 0), discountedPrice: Number(firstSize.discountedPrice || good.discountedPrice || 0),
      clubDiscountedPrice: Number(firstSize.clubDiscountedPrice || good.clubDiscountedPrice || 0), discount: Number(good.discount || 0),
      clubDiscount: Number(good.clubDiscount || 0), sizes: sizes.length, sizeItems: sizes.map(size => ({ sizeId: Number(size.sizeID), name: size.techSizeName || '' })).filter(size => Number.isInteger(size.sizeId)), editableSizePrice: Boolean(good.editableSizePrice), isBadTurnover: Boolean(good.isBadTurnover) };
  });
  const categories = [...new Set(rows.map(row => row.category))].sort((a, b) => a.localeCompare(b, 'ru'));
  const brands = [...new Set(rows.map(row => row.brand))].sort((a, b) => a.localeCompare(b, 'ru'));
  return { rows, categories, brands, totals: { products: rows.length, averagePrice: rows.length ? rows.reduce((sum, row) => sum + row.price, 0) / rows.length : 0,
    averageDiscount: rows.length ? rows.reduce((sum, row) => sum + row.discount, 0) / rows.length : 0, discounted: rows.filter(row => row.discount > 0).length,
    badTurnover: rows.filter(row => row.isBadTurnover).length } };
}

function demoPrices() {
  const cards = [{ nmID: 100001, vendorCode: 'TSHIRT-BLACK', title: 'Футболка базовая', subjectName: 'Одежда', brand: 'WB Pulse' }, { nmID: 100002, vendorCode: 'MUG-THERMO', title: 'Термокружка', subjectName: 'Посуда', brand: 'Home' }];
  const goods = [{ nmID: 100001, vendorCode: 'TSHIRT-BLACK', currencyIsoCode4217: 'RUB', discount: 20, clubDiscount: 5, sizes: [{ price: 1990, discountedPrice: 1592, clubDiscountedPrice: 1512 }] }, { nmID: 100002, vendorCode: 'MUG-THERMO', currencyIsoCode4217: 'RUB', discount: 10, clubDiscount: 0, sizes: [{ price: 1290, discountedPrice: 1161, clubDiscountedPrice: 1161 }] }];
  return { demo: true, ...normalizePrices(goods, cards), warnings: [] };
}

// Цены и скидки всех товаров кабинета — для таблицы цен и для снимка «Снять цены сейчас».
async function loadPriceGoods(token) {
  const goods = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const response = await wbRequest(token, `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=${offset}`);
    const batch = Array.isArray(response?.data?.listGoods) ? response.data.listGoods : []; goods.push(...batch);
    if (batch.length < 1000) break; await wait(650);
  }
  return goods;
}

async function prices(id) {
  if (id === 'demo' || !cabinets().length) return demoPrices();
  const token = tokenFor(id); const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000);
  return { demo: false, ...normalizePrices(await loadPriceGoods(token), cards), warnings: [] };
}

async function updatePrices(body) {
  const token = tokenFor(body.cabinet);
  const items = (body.items || []).map(item => ({ nmID: Number(item.nmId), price: Number(item.price), discount: Number(item.discount), editableSizePrice: Boolean(item.editableSizePrice), sizeItems: Array.isArray(item.sizeItems) ? item.sizeItems : [] }))
    .filter(item => Number.isInteger(item.nmID) && Number.isFinite(item.price) && item.price > 0 && Number.isInteger(item.discount) && item.discount >= 0 && item.discount <= 99);
  if (!items.length) throw apiError(400, 'Выберите товары и укажите корректные цену и скидку');
  const data = items.map(item => item.editableSizePrice ? { nmID: item.nmID, discount: item.discount } : { nmID: item.nmID, price: item.price, discount: item.discount });
  const sizeData = items.filter(item => item.editableSizePrice).flatMap(item => item.sizeItems.map(size => ({ nmID: item.nmID, sizeID: Number(size.sizeId), price: item.price })).filter(size => Number.isInteger(size.sizeID)));
  const uploads = [];
  for (let offset = 0; offset < data.length; offset += 1000) {
    if (offset) await wait(650);
    uploads.push(await wbRequest(token, 'https://discounts-prices-api.wildberries.ru/api/v2/upload/task', { method: 'POST', body: { data: data.slice(offset, offset + 1000) } }));
  }
  for (let offset = 0; offset < sizeData.length; offset += 1000) {
    await wait(650);
    uploads.push(await wbRequest(token, 'https://discounts-prices-api.wildberries.ru/api/v2/upload/task/size', { method: 'POST', body: { data: sizeData.slice(offset, offset + 1000) } }));
  }
  return { ok: true, updated: items.length, updatedSizes: sizeData.length, uploads };
}

function groupStockUpdates(items = []) {
  const grouped = new Map();
  for (const item of items) {
    const warehouseId = String(item.warehouseId || ''); const chrtId = Number(item.chrtId); const amount = Number(item.amount);
    if (!warehouseId || !Number.isInteger(chrtId) || !Number.isFinite(amount) || amount < 0) continue;
    if (!grouped.has(warehouseId)) grouped.set(warehouseId, []);
    grouped.get(warehouseId).push({ chrtId, amount: Math.floor(amount) });
  }
  return grouped;
}

async function updateFbsStocks(body) {
  const token = tokenFor(body.cabinet); const grouped = groupStockUpdates(body.items);
  if (!grouped.size) throw apiError(400, 'Выберите хотя бы один товар и укажите корректный остаток');
  const results = [];
  for (const [warehouseId, stocks] of grouped) {
    const response = await wbRequest(token, `https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`, { method: 'PUT', body: { stocks } });
    results.push({ warehouseId, count: stocks.length, response: response || null });
  }
  return { ok: true, updated: results.reduce((sum, item) => sum + item.count, 0), warehouses: results };
}

async function copyFbsStocks(body) {
  const token = tokenFor(body.cabinet);
  const targetWarehouseIds = [...new Set((Array.isArray(body.targetWarehouseIds) ? body.targetWarehouseIds : [body.targetWarehouseId]).map(value => String(value || '')).filter(Boolean))];
  const stocks = (body.items || []).map(item => ({ chrtId: Number(item.chrtId), amount: Math.floor(Number(item.amount)) }))
    .filter(item => Number.isInteger(item.chrtId) && Number.isFinite(item.amount) && item.amount >= 0);
  if (!targetWarehouseIds.length || !stocks.length) throw apiError(400, 'Выберите хотя бы один целевой склад и товары для копирования');
  const results = [];
  for (const targetWarehouseId of targetWarehouseIds) {
    const response = await wbRequest(token, `https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(targetWarehouseId)}`, { method: 'PUT', body: { stocks } });
    results.push({ targetWarehouseId, count: stocks.length, response: response || null });
  }
  return { ok: true, updated: stocks.length * results.length, warehouses: results, targetWarehouseIds };
}

function enrichOrders(orders, cards) {
  const byNmId = new Map((cards || []).map(card => [String(card.nmID), card]));
  return orders.map(order => {
    const card = byNmId.get(String(order.nmId));
    if (!card) return order;
    const size = (card.sizes || []).find(item => String(item.chrtID || item.chrtId) === String(order.chrtId)) || card.sizes?.[0];
    return { ...order, name: card.title || order.name, article: card.vendorCode || order.article, barcode: size?.skus?.[0] || '',
      brand: card.brand || '', subjectName: card.subjectName || '',
      photo: cardPhoto(card) };
  });
}

function demoDashboard() {
  const now = Date.now();
  const statuses = ['new', 'confirm', 'complete', 'cancel'];
  const names = ['Футболка базовая', 'Кроссовки Urban', 'Набор полотенец', 'Худи Oversize', 'Термокружка'];
  const orders = Array.from({ length: 18 }, (_, index) => ({
    id: 88422000 + index, nmId: 17540000 + index % 5, article: `WB-${1200 + index}`,
    name: names[index % names.length], status: statuses[index % statuses.length],
    createdAt: new Date(now - index * 3_600_000).toISOString(),
    price: 129900 + (index % 5) * 45000, currencyCode: 643,
    warehouse: ['Коледино', 'Казань', 'Электросталь'][index % 3], source: index < 6 ? 'FBS' : 'Статистика'
  }));
  return { demo: true, orders, funnel: { views: 14840, cart: 3180, orders: 1246, sales: 982, revenue: 1762400, currency: 'RUB' }, funnelProducts: [], funnelHistory: [], funnelGroupedHistory: [], warnings: [] };
}

function currencyCode(currency) {
  return ({ RUB: 643, BYN: 933, KZT: 398, AMD: 51, KGS: 417, UZS: 860 })[currency] || 643;
}

function normalizeOrderFeed(payload) {
  const data = payload?.data || payload || {};
  const code = currencyCode(data.currency);
  return (data.orders || []).map(order => ({
    id: order.srid,
    nmId: order.nmId,
    chrtId: order.chrtId,
    article: `chrtID ${order.chrtId}`,
    name: `Товар WB ${order.nmId}`,
    status: order.status === 'buyout' ? 'complete' : order.status === 'cancel' ? 'cancel'
      : ['return', 'returnDefective'].includes(order.status) ? 'return' : 'new',
    rawStatus: order.status,
    cancelType: order.cancelType,
    createdAt: order.updatedAt || order.createdAt,
    orderedAt: order.createdAt,
    price: Math.round(Number(order.sellerPrice || 0) * 100),
    currencyCode: code,
    warehouse: order.warehouseName || '—',
    warehouseRegion: order.warehouseRegion,
    destinationCity: order.destinationCity,
    destinationDistrict: order.destinationDistrict,
    isMp: Boolean(order.isMp),
    isB2b: Boolean(order.isB2b),
    source: 'Лента WB'
  }));
}

// Строки ленты — только события «Ленты заказов» WB: у них есть склад отгрузки и город покупателя.
// Новое FBS-задание — тот же заказ (rid задания = srid события), поэтому отдельной строкой не идёт; от него берётся только
// сумма покупателя с учётом СПП (buyerPrice). Задания, которых ещё нет в ленте, видны в разделе «Новые заказы».
function normalizeOrders(fbs, orderFeed) {
  const tasks = new Map((fbs?.orders || []).filter(o => o.rid).map(o => [String(o.rid), o]));
  return normalizeOrderFeed(orderFeed).map(order => {
    const task = tasks.get(String(order.id));
    if (!task) return order;
    // Сумма покупателя — в валюте продавца; если валюта события другая, не показываем её, чтобы не сравнивать разные валюты.
    const buyerPrice = task.convertedFinalPrice ?? task.finalPrice;
    const sameCurrency = !task.convertedCurrencyCode || !order.currencyCode || String(task.convertedCurrencyCode) === String(order.currencyCode);
    return buyerPrice != null && sameCurrency ? { ...order, buyerPrice } : order;
  }).sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
}

function extractFunnel(payload) {
  const products = payload?.data?.products || payload?.products || [];
  const total = { views: 0, cart: 0, orders: 0, sales: 0, revenue: 0, currency: payload?.data?.currency || payload?.currency || 'RUB' };
  for (const item of products) {
    const s = item.statistic?.selected || item.selected || item.metrics || item;
    total.views += Number(s.openCount ?? s.openCardCount ?? s.views ?? s.openCard ?? 0);
    total.cart += Number(s.cartCount ?? s.addToCartCount ?? s.addToCart ?? 0);
    total.orders += Number(s.orderCount ?? s.ordersCount ?? s.orders ?? 0);
    total.sales += Number(s.buyoutCount ?? s.buyoutsCount ?? s.buyouts ?? s.sales ?? 0);
    total.revenue += Number(s.buyoutSum ?? s.buyoutsSumRub ?? s.orderSum ?? s.revenue ?? 0);
    total.currency = s.currency || item.currency || total.currency;
  }
  return total;
}

function safeRatio(value, base, multiplier = 100) {
  return Number(base) ? Number(value || 0) / Number(base) * multiplier : 0;
}

function adMetrics(source = {}) {
  const views = Number(source.views || 0), clicks = Number(source.clicks || 0), spend = Number(source.sum || 0);
  const orders = Number(source.orders || 0), revenue = Number(source.sum_price || 0);
  return {
    views, clicks, spend, orders, revenue,
    carts: Number(source.atbs || 0), sales: Number(source.shks || 0), canceled: Number(source.canceled || 0),
    ctr: safeRatio(clicks, views), cpc: safeRatio(spend, clicks, 1), cpm: safeRatio(spend, views, 1000),
    cr: safeRatio(orders, clicks), cpo: safeRatio(spend, orders, 1), drr: safeRatio(spend, revenue), roas: safeRatio(revenue, spend, 1)
  };
}

function addAdMetrics(target, source = {}) {
  target.views += Number(source.views || 0); target.clicks += Number(source.clicks || 0);
  target.spend += Number(source.sum ?? source.spend ?? 0); target.orders += Number(source.orders || 0);
  target.revenue += Number(source.sum_price ?? source.revenue ?? 0); target.carts += Number(source.atbs ?? source.carts ?? 0);
  target.sales += Number(source.shks ?? source.sales ?? 0); target.canceled += Number(source.canceled || 0);
}

function finalizeAdMetrics(target) {
  return { ...target, ctr: safeRatio(target.clicks, target.views), cpc: safeRatio(target.spend, target.clicks, 1),
    cpm: safeRatio(target.spend, target.views, 1000), cr: safeRatio(target.orders, target.clicks), cpo: safeRatio(target.spend, target.orders, 1),
    drr: safeRatio(target.spend, target.revenue), roas: safeRatio(target.revenue, target.spend, 1) };
}

function emptyAdMetrics(extra = {}) {
  return { views: 0, clicks: 0, spend: 0, orders: 0, revenue: 0, carts: 0, sales: 0, canceled: 0, ...extra };
}

function campaignProductIds(campaign = {}) {
  const candidates = [campaign.nm_settings, campaign.nmSettings, campaign.settings?.nms, campaign.autoParams?.nms,
    Array.isArray(campaign.unitedParams) ? campaign.unitedParams.flatMap(item => item.nms || []) : []];
  return [...new Set(candidates.flatMap(list => Array.isArray(list) ? list : []).map(item => Number(item?.nm_id || item?.nmId || item?.nm || item)).filter(Number.isInteger))];
}

function summarizeAdStats(campaigns = [], stats = [], from, to) {
  const campaignById = new Map(campaigns.map(item => [String(item.id), item]));
  const daily = new Map();
  for (let cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10); daily.set(date, emptyAdMetrics({ date }));
  }
  const platforms = new Map([[1, emptyAdMetrics({ id: 1, name: 'Сайт' })], [32, emptyAdMetrics({ id: 32, name: 'Android' })], [64, emptyAdMetrics({ id: 64, name: 'iOS' })]]);
  const products = new Map();
  const productDaily = new Map();
  const rows = [];
  for (const stat of stats) {
    const campaign = campaignById.get(String(stat.advertId));
    const nmIds = [...new Set([...campaignProductIds(campaign), ...(stat.days || []).flatMap(day => (day.apps || []).flatMap(app => (app.nms || []).map(nm => Number(nm.nmId || nm.nm)).filter(Number.isInteger)))])];
    rows.push({ id: stat.advertId, name: campaign?.settings?.name || `Кампания #${stat.advertId}`,
      status: campaign?.status, type: campaign?.type ?? null, paymentType: campaign?.settings?.payment_type || '', bidType: campaign?.bid_type || '',
      createdAt: campaign?.timestamps?.created || '', startedAt: campaign?.timestamps?.started || '', updatedAt: campaign?.timestamps?.updated || '', nmIds, daily: (stat.days || []).map(day => ({ date: String(day.date || '').slice(0, 10), ...adMetrics(day) })), ...adMetrics(stat) });
    for (const day of stat.days || []) {
      const date = String(day.date || '').slice(0, 10);
      if (!daily.has(date)) daily.set(date, emptyAdMetrics({ date }));
      addAdMetrics(daily.get(date), day);
      for (const app of day.apps || []) {
        const appType = Number(app.appType || 0);
        if (!platforms.has(appType)) platforms.set(appType, emptyAdMetrics({ id: appType, name: appType === 0 ? 'Не определено WB' : `Платформа ${appType}` }));
        addAdMetrics(platforms.get(appType), app);
        for (const nm of app.nms || []) {
          const key = String(nm.nmId || nm.nm || 'unknown');
          if (!products.has(key)) products.set(key, emptyAdMetrics({ nmId: nm.nmId || nm.nm, name: nm.name || `Товар ${key}` }));
          addAdMetrics(products.get(key), nm);
          const productKey = `${stat.advertId}:${key}:${date}`;
          if (!productDaily.has(productKey)) productDaily.set(productKey, emptyAdMetrics({ advertId: stat.advertId, nmId: nm.nmId || nm.nm, name: nm.name || `Товар ${key}`, date }));
          addAdMetrics(productDaily.get(productKey), nm);
        }
      }
    }
  }
  for (const campaign of campaigns) {
    if (!rows.some(row => String(row.id) === String(campaign.id))) rows.push({ id: campaign.id,
      name: campaign.settings?.name || `Кампания #${campaign.id}`, status: campaign.status, type: campaign.type ?? null,
      paymentType: campaign.settings?.payment_type || '', bidType: campaign.bid_type || '', createdAt: campaign.timestamps?.created || '', startedAt: campaign.timestamps?.started || '', updatedAt: campaign.timestamps?.updated || '', nmIds: campaignProductIds(campaign),
      ...finalizeAdMetrics(emptyAdMetrics()) });
  }
  const total = emptyAdMetrics(); rows.forEach(row => addAdMetrics(total, row));
  return { period: { from, to }, totals: finalizeAdMetrics(total),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map(finalizeAdMetrics),
    campaigns: rows.map(finalizeAdMetrics).sort((a, b) => b.spend - a.spend),
    platforms: [...platforms.values()].map(finalizeAdMetrics).sort((a, b) => b.spend - a.spend),
    products: [...products.values()].map(finalizeAdMetrics).sort((a, b) => b.spend - a.spend).slice(0, 100),
    productDaily: [...productDaily.values()].map(finalizeAdMetrics).sort((a, b) => `${a.date}:${a.nmId}`.localeCompare(`${b.date}:${b.nmId}`)) };
}

function campaignProductDaily(rows = [], campaignId, nmIds = []) {
  const own = rows.filter(row => String(row.advertId) === String(campaignId));
  if (own.length || rows.some(row => row.advertId !== undefined)) return own;
  const allowed = new Set(nmIds.map(String));
  return rows.filter(row => !allowed.size || allowed.has(String(row.nmId)));
}

function enrichAdvertising(summary, cards = []) {
  const byNmId = new Map(cards.map(card => [String(card.nmID), { name: card.title || `Товар ${card.nmID}`, vendorCode: card.vendorCode || '',
    photo: cardPhoto(card),
    barcode: card.sizes?.[0]?.skus?.[0] || '' }]));
  const products = (summary.products || []).map(product => ({ ...product, ...(byNmId.get(String(product.nmId)) || {}) }));
  const campaigns = (summary.campaigns || []).map(campaign => ({ ...campaign, photo: (campaign.nmIds || []).map(nmId => byNmId.get(String(nmId))?.photo).find(Boolean) || '' }));
  const productDaily = (summary.productDaily || []).map(row => ({ ...row, ...(byNmId.get(String(row.nmId)) || {}) }));
  return { ...summary, products, campaigns, productDaily };
}

function demoAdProducts(campaignIndex, views, clicks, spend, orders, revenue) {
  return [.62, .38].map((share, index) => ({ nmId: 4210000 + campaignIndex * 10 + index, name: `Демо-товар ${campaignIndex + 1}.${index + 1}`,
    views: Math.round(views * share), clicks: Math.round(clicks * share), sum: Math.round(spend * share * 100) / 100,
    orders: Math.round(orders * share), sum_price: Math.round(revenue * share * 100) / 100,
    atbs: Math.round(clicks * share * .23), shks: Math.round(orders * share * .78) }));
}

function demoAds(from, to) {
  const campaigns = [
    { id: 101, status: 9, type: 9, bid_type: 'manual', timestamps: { created: '2026-03-12T09:15:00+03:00', started: '2026-09-01T10:00:00+03:00', updated: '2026-09-20T18:42:00+03:00' }, settings: { name: 'Поиск · базовая коллекция', payment_type: 'cpm' } },
    { id: 102, status: 11, type: 8, bid_type: 'unified', timestamps: { created: '2026-06-02T14:40:00+03:00', started: null, updated: '2026-09-18T09:05:00+03:00' }, settings: { name: 'Автокампания · хиты', payment_type: 'cpm' } },
    { id: 103, status: 7, type: 5, bid_type: 'manual', timestamps: { created: '2025-11-20T11:05:00+03:00', started: '2026-01-15T12:30:00+03:00', updated: '2026-08-30T21:10:00+03:00' }, settings: { name: 'Карточка товара · новинки', payment_type: 'cpc' } }
  ];
  const demoBudgets = new Map([['101', 18400], ['102', 7250]]);
  const stats = campaigns.map((campaign, campaignIndex) => {
    const days = [];
    for (let cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`), index = 0; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1), index++) {
      const views = 5200 + campaignIndex * 1700 + index * 260, clicks = Math.round(views * (0.025 + campaignIndex * .006));
      const spend = Math.round((clicks * (13 + campaignIndex * 4)) * 100) / 100, orders = Math.round(clicks * (.08 + campaignIndex * .015));
      const revenue = orders * (1750 + campaignIndex * 410);
      days.push({ date: cursor.toISOString(), views, clicks, sum: spend, orders, sum_price: revenue,
        atbs: Math.round(clicks * .23), shks: Math.round(orders * .78), canceled: campaignIndex === 2 && index % 4 === 0 ? 1 : 0,
        apps: [1, 32, 64].map((appType, appIndex) => {
          const share = [.18, .52, .30][appIndex];
          return { appType, views: Math.round(views * share), clicks: Math.round(clicks * share), sum: spend * share,
            orders: Math.round(orders * share), sum_price: revenue * share, nms: demoAdProducts(campaignIndex, views * share, clicks * share, spend * share, orders * share, revenue * share) };
        }) });
    }
    const total = emptyAdMetrics(); days.forEach(day => addAdMetrics(total, day));
    return { advertId: campaign.id, sum: total.spend, sum_price: total.revenue, atbs: total.carts, shks: total.sales,
      views: total.views, clicks: total.clicks, orders: total.orders, canceled: total.canceled, days };
  });
  const summary = summarizeAdStats(campaigns, stats, from, to);
  return { demo: true, ...summary, campaigns: withAdBudgets(summary.campaigns, demoBudgets), warnings: [] };
}

function validAdPeriod(from, to) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  const safeTo = pattern.test(to || '') ? to : dateDaysAgo(0);
  const safeFrom = pattern.test(from || '') ? from : dateDaysAgo(6);
  const days = Math.floor((new Date(`${safeTo}T00:00:00Z`) - new Date(`${safeFrom}T00:00:00Z`)) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1) throw apiError(400, 'Начало периода должно быть раньше окончания');
  if (days > 31) throw apiError(400, 'Для рекламы выберите период не более 31 дня — это ограничение WB API');
  return { from: safeFrom, to: safeTo };
}

function historyPeriod(from, to, today = moscowDate(0)) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(from || '') || !pattern.test(to || '')) throw apiError(400, 'Укажите даты начала и конца выгрузки');
  if (from > to) throw apiError(400, 'Дата начала должна быть не позже даты конца');
  if (to > today) throw apiError(400, 'Дата конца не может быть позже сегодняшнего дня');
  const [year, month] = today.split('-').map(Number);
  const earliest = new Date(Date.UTC(year, month - 1 - HISTORY_MAX_MONTHS, 1)).toISOString().slice(0, 10);
  if (from < earliest) throw apiError(400, `Выгрузка доступна не раньше ${earliest.split('-').reverse().join('.')}`);
  return { from, to };
}

function historyChunks({ from, to }) {
  const chunks = [];
  for (let cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); cursor <= end; ) {
    const chunkEnd = new Date(cursor); chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 30);
    chunks.push({ from: cursor.toISOString().slice(0, 10), to: (chunkEnd > end ? end : chunkEnd).toISOString().slice(0, 10) });
    cursor = chunkEnd; cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}

// Статистика кампаний у WB ограничена одним запросом примерно раз в 20 секунд на продавца,
// поэтому все обращения к ней идут через очередь кабинета.
function fullstatsRequest(id, token, ids, from, to, onWait = () => {}) {
  const key = `ad-stats:${id}:${from}:${to}:${ids}`;
  const fresh = () => { const cached = analyticsCache.get(key); return cached && Date.now() - cached.savedAt < 3 * 60_000 ? cached : null; };
  if (fresh()) return Promise.resolve(fresh().value);
  const task = async () => {
    if (fresh()) return fresh().value;
    for (let attempt = 0; ; attempt++) {
      const delay = (fullstatsLastCall.get(id) || 0) + FULLSTATS_INTERVAL - Date.now();
      if (delay > 0) { onWait(delay, attempt ? 'retry' : 'limit'); await wait(delay); }
      fullstatsLastCall.set(id, Date.now());
      try {
        const value = await wbRequest(token, `https://advert-api.wildberries.ru/adv/v3/fullstats?ids=${ids}&beginDate=${from}&endDate=${to}`);
        analyticsCache.set(key, { value, savedAt: Date.now() });
        return value;
      } catch (error) {
        if (error.status === 429 && attempt < 2) {
          fullstatsLastCall.set(id, Date.now() + Math.max(0, (error.retryAfter || 0) * 1000 - FULLSTATS_INTERVAL));
          continue;
        }
        const stale = analyticsCache.get(key);
        if (stale) return stale.value;
        throw error;
      }
    }
  };
  const run = (fullstatsQueues.get(id) || Promise.resolve()).then(task);
  fullstatsQueues.set(id, run.catch(() => {}));
  return run;
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function datesBetween(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

// Какие дни нужно запросить у WB: несохранённые и свежие (WB ещё пересчитывает их статистику).
// Соседние дни собираются в запросы не длиннее 31 дня, чтобы тратить меньше запросов.
function planAdFetch(dates = [], storedDates = new Set(), today = moscowDate(0), freshDays = AD_FRESH_DAYS) {
  const freshFrom = addDays(today, -freshDays);
  const missing = dates.filter(date => !storedDates.has(date) || date >= freshFrom);
  const chunks = [];
  for (let index = 0; index < missing.length; ) {
    const limit = addDays(missing[index], 30);
    let last = index;
    while (last + 1 < missing.length && missing[last + 1] <= limit) last++;
    chunks.push({ from: missing[index], to: missing[last] });
    index = last + 1;
  }
  return { missing, chunks };
}

// Имя папки из названия кабинета: без символов, запрещённых в Windows, и не только из цифр,
// чтобы не путать с папками кампаний.
function safeFolderName(name, fallback) {
  const clean = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
  if (!clean || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return fallback;
  return /^\d+$/.test(clean) ? `Кабинет ${clean}` : clean;
}

function cabinetFolderName(cabinetId) {
  const cabinet = cabinets().find(item => String(item.id) === String(cabinetId));
  return safeFolderName(cabinet?.name, `Кабинет ${cabinetId}`);
}

// Если кабинет переименовали или папка лежит по старой схеме прямо в data/Ads,
// папка кампании переносится на новое место, чтобы сохранённая статистика не терялась.
function campaignDir(cabinetId, campaignId) {
  const target = path.join(ADS_DIR, cabinetFolderName(cabinetId), String(campaignId));
  if (fs.existsSync(target)) return target;
  const candidates = [path.join(ADS_DIR, String(campaignId))];
  try {
    for (const entry of fs.readdirSync(ADS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && !/^\d+$/.test(entry.name)) candidates.push(path.join(ADS_DIR, entry.name, String(campaignId)));
    }
  } catch {}
  const source = candidates.find(dir => dir !== target && fs.existsSync(dir));
  if (source) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
    try { if (path.dirname(source) !== ADS_DIR && !fs.readdirSync(path.dirname(source)).length) fs.rmdirSync(path.dirname(source)); } catch {}
  }
  return target;
}

function adMonthFile(cabinetId, campaignId, month) {
  return path.join(campaignDir(cabinetId, campaignId), `${month}.json`);
}

function readAdMonth(cabinetId, campaignId, month) {
  try { return JSON.parse(fs.readFileSync(adMonthFile(cabinetId, campaignId, month), 'utf8')); } catch { return null; }
}

function loadStoredAdDays(cabinetId, campaignId, from, to) {
  const stored = new Map();
  for (const month of [...new Set(datesBetween(from, to).map(date => date.slice(0, 7)))]) {
    for (const [date, record] of Object.entries(readAdMonth(cabinetId, campaignId, month)?.days || {})) {
      if (date >= from && date <= to && record?.campaign) stored.set(date, record);
    }
  }
  return stored;
}

function emptyAdDay(date) {
  return { date, ...finalizeAdMetrics(emptyAdMetrics()) };
}

function saveAdDays(campaignId, cabinet, name, dates, daily, productsByDate) {
  const fetchedAt = new Date().toISOString();
  const byMonth = new Map();
  for (const date of dates) {
    if (!byMonth.has(date.slice(0, 7))) byMonth.set(date.slice(0, 7), []);
    byMonth.get(date.slice(0, 7)).push(date);
  }
  for (const [month, monthDates] of byMonth) {
    const file = readAdMonth(cabinet, campaignId, month) || { campaignId: Number(campaignId), month, days: {} };
    for (const date of monthDates) {
      file.days[date] = { fetchedAt, campaign: daily.get(date) || emptyAdDay(date),
        products: (productsByDate.get(date) || []).map(({ photo, vendorCode, barcode, ...item }) => item) };
    }
    file.days = Object.fromEntries(Object.entries(file.days).sort(([a], [b]) => a.localeCompare(b)));
    Object.assign(file, { cabinet, name, updatedAt: fetchedAt });
    const target = adMonthFile(cabinet, campaignId, month);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(file, null, 2));
    fs.renameSync(`${target}.tmp`, target);
  }
}

// Если вкладка рекламы только что скачала статистику всех кампаний за подходящий период,
// нужная кампания берётся из этого ответа без нового запроса к WB.
function cachedCampaignStats(id, campaignId, from, to) {
  const prefix = `ad-stats:${id}:`;
  for (const [key, entry] of analyticsCache) {
    if (!key.startsWith(prefix) || Date.now() - entry.savedAt >= 3 * 60_000) continue;
    const [cachedFrom, cachedTo, ids = ''] = key.slice(prefix.length).split(':');
    if (cachedFrom > from || cachedTo < to || !ids.split(',').includes(String(campaignId))) continue;
    const stat = (Array.isArray(entry.value) ? entry.value : []).find(item => String(item.advertId) === String(campaignId));
    if (!stat) return [];
    return [{ ...stat, days: (stat.days || []).filter(day => { const date = String(day.date || '').slice(0, 10); return date >= from && date <= to; }) }];
  }
  return null;
}

function hasAdActivity(day = {}) {
  return ['views', 'clicks', 'spend', 'orders', 'revenue', 'carts', 'canceled'].some(key => Number(day[key] || 0) > 0);
}

// --- Ключевые запросы кампании (поисковые кластеры WB) ---
// Метод отдаёт кластеры отдельно для каждой пары «кампания + артикул», до 100 пар в запросе,
// лимит 10 запросов в минуту, поэтому запросы идут через очередь кабинета и сохраняются в файл.
// Места размещения и ставки товаров из списка кампаний (/api/advert/v2/adverts): ставки WB хранит в копейках.
// Для CPM ставка — за 1000 показов, для CPC — за клик.
function campaignSetup(meta, cards = [], demo = false) {
  if (demo) return { paymentType: 'cpm', bidType: 'manual', placements: { search: true, recommendations: false },
    bids: [{ nmId: 4210000, name: 'Демо-товар 1.1', vendorCode: 'DEMO-1', photo: '', subject: 'Демо', search: 250, recommendations: 0 }] };
  if (!meta) return null;
  const byNmId = new Map(cards.map(card => [String(card.nmID), card]));
  const rub = value => value == null ? null : Number(value) / 100;
  return { paymentType: meta.settings?.payment_type || '', bidType: meta.bid_type || '', placements: meta.settings?.placements || null,
    bids: (Array.isArray(meta.nm_settings) ? meta.nm_settings : []).map(item => { const card = byNmId.get(String(item.nm_id)) || {};
      return { nmId: item.nm_id, name: card.title || `Товар ${item.nm_id}`, vendorCode: card.vendorCode || '', photo: cardPhoto(card), subject: item.subject?.name || '',
        search: rub(item.bids_kopecks?.search), recommendations: rub(item.bids_kopecks?.recommendations) }; }) };
}

// --- Статистика одного ключевого запроса по дням ---
// /adv/v1/normquery/stats отдаёт дневную статистику сразу по всем кластерам товаров кампании, поэтому ответ кэшируется:
// первый запрос ждёт WB (до 10 запросов в минуту), следующие ключевые запросы того же периода открываются мгновенно.
function emptyKeywordDay(date) { return { date, views: 0, clicks: 0, spend: 0, carts: 0, orders: 0, sales: 0, positionWeight: 0, positionBase: 0, viewsKnown: false }; }
function summarizeKeywordDaily(items = [], query, dates = []) {
  const byDate = new Map(dates.map(date => [date, emptyKeywordDay(date)]));
  for (const item of items) for (const day of item.dailyStats || []) {
    const stat = day.stat || {}; if (String(stat.normQuery || '').trim() !== query) continue;
    const date = String(day.date || '').slice(0, 10); if (!byDate.has(date)) byDate.set(date, emptyKeywordDay(date));
    const row = byDate.get(date), views = Number(stat.views || 0);
    if (stat.views !== undefined && stat.views !== null) row.viewsKnown = true;
    row.views += views; row.clicks += Number(stat.clicks || 0); row.spend += Number(stat.spend || 0);
    row.carts += Number(stat.atbs || 0); row.orders += Number(stat.orders || 0); row.sales += Number(stat.shks || 0);
    if (stat.avgPos) { row.positionWeight += Number(stat.avgPos) * (views || 1); row.positionBase += views || 1; }
  }
  const viewsAvailable = [...byDate.values()].some(row => row.viewsKnown);
  return { viewsAvailable, days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map(({ positionWeight, positionBase, viewsKnown, ...row }) => ({ ...row,
    views: viewsAvailable ? row.views : null, ctr: viewsAvailable ? safeRatio(row.clicks, row.views) : null, cpm: viewsAvailable ? safeRatio(row.spend, row.views, 1000) : null,
    cpc: safeRatio(row.spend, row.clicks, 1), cr: safeRatio(row.orders, row.clicks), avgPosition: positionBase ? Math.round(positionWeight / positionBase * 10) / 10 : null })) };
}
// Средняя позиция кампании по дням: из статистики поисковых кластеров (/adv/v1/normquery/stats), взвешенная по показам
// (у CPC-кампаний показов нет — тогда каждый кластер весит одинаково). Это позиция в поиске; дни без данных — null.
function summarizePositionDaily(items = [], dates = []) {
  const byDate = new Map(dates.map(date => [date, { weight: 0, base: 0 }]));
  for (const item of items) for (const day of item.dailyStats || []) {
    const stat = day.stat || {}; if (!stat.avgPos) continue;
    const date = String(day.date || '').slice(0, 10); if (!byDate.has(date)) byDate.set(date, { weight: 0, base: 0 });
    const weight = Number(stat.views) || 1, row = byDate.get(date);
    row.weight += Number(stat.avgPos) * weight; row.base += weight;
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => ({ date, avgPosition: row.base ? Math.round(row.weight / row.base * 10) / 10 : null }));
}
async function campaignPositions(id, campaignId, from, to) {
  const period = historyPeriod(from, to), dates = datesBetween(period.from, period.to);
  if (id === 'demo' || !cabinets().length) return { demo: true, period, days: dates.map((date, index) => ({ date, avgPosition: 6 + (index * 7) % 9 })) };
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const token = tokenFor(id);
  const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
  const meta = (Array.isArray(campaignData?.adverts) ? campaignData.adverts : []).find(item => String(item.id) === String(campaignId));
  if (!meta) throw apiError(404, 'Кампания не найдена');
  const nmIds = campaignProductIds(meta).map(String).slice(0, 100);
  if (!nmIds.length) return { demo: false, period, days: dates.map(date => ({ date, avgPosition: null })) };
  const response = await cachedAnalytics(`keyword-daily:${id}:${campaignId}:${period.from}:${period.to}:${nmIds.join(',')}`, () => normqueryRequest(id, token,
    { from: period.from, to: period.to, items: nmIds.map(nmId => ({ advertId: Number(campaignId), nmId: Number(nmId) })) }, NORMQUERY_DAILY_URL), 10 * 60_000);
  return { demo: false, period, days: summarizePositionDaily(response?.items || [], dates) };
}

// --- Отметки ключевых запросов (data/keyword-tags.json) ---
function readKeywordTags() {
  try { const data = JSON.parse(fs.readFileSync(KEYWORD_TAGS_FILE, 'utf8')); return { colors: data.colors || {}, campaigns: data.campaigns || {} }; } catch { return { colors: {}, campaigns: {} }; }
}
function writeKeywordTags(data) {
  fs.mkdirSync(path.dirname(KEYWORD_TAGS_FILE), { recursive: true });
  fs.writeFileSync(`${KEYWORD_TAGS_FILE}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${KEYWORD_TAGS_FILE}.tmp`, KEYWORD_TAGS_FILE);
}
function keywordTagsKey(cabinet, campaignId) {
  if (!/^[\w-]{1,40}$/.test(String(cabinet || '')) || !/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный кабинет или кампания');
  return `${cabinet}:${campaignId}`;
}
function keywordTags(cabinet, campaignId) {
  const data = readKeywordTags();
  return { tags: data.campaigns[keywordTagsKey(cabinet, campaignId)] || {}, colors: data.colors };
}
// У запроса — текущие отметки (tag, important) и история: смена отметок (с пояснением note), комментарии и смена статуса
// фразы через сайт. Новые события — в конце списка; хранится не больше KEYWORD_HISTORY_LIMIT последних.
const KEYWORD_HISTORY_LIMIT = 200;
const keywordEventId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
function keywordQuery(value) {
  const query = String(value || '').trim();
  if (!query || query.length > 300) throw apiError(400, 'Не указан ключевой запрос');
  return query;
}
function pushKeywordEvent(entry, event) {
  entry.history = [...(entry.history || []), { id: keywordEventId(), at: new Date().toISOString(), ...event }].slice(-KEYWORD_HISTORY_LIMIT);
}
// Запись без отметок и истории удаляется, чтобы файл не копил пустые записи.
function storeKeywordEntry(data, key, query, entry) {
  const campaign = data.campaigns[key] || {};
  if (entry.tag || entry.important || entry.history?.length) campaign[query] = entry; else delete campaign[query];
  if (Object.keys(campaign).length) data.campaigns[key] = campaign; else delete data.campaigns[key];
  writeKeywordTags(data);
  return campaign[query] || null;
}
function setKeywordTag(cabinet, campaignId, body = {}) {
  const key = keywordTagsKey(cabinet, campaignId), query = keywordQuery(body.query);
  if (body.tag != null && body.tag !== '' && !KEYWORD_TAG_KEYS.includes(body.tag)) throw apiError(400, 'Неизвестная отметка');
  const data = readKeywordTags(), before = data.campaigns[key]?.[query] || {};
  const current = { ...before, history: [...(before.history || [])] };
  if (body.clear) { delete current.tag; delete current.important; }
  if ('tag' in body) { if (body.tag) current.tag = body.tag; else delete current.tag; }
  if ('important' in body) { if (body.important) current.important = true; else delete current.important; }
  if ((before.tag || '') !== (current.tag || '')) pushKeywordEvent(current, { type: 'tag', from: before.tag || '', to: current.tag || '' });
  if (Boolean(before.important) !== Boolean(current.important)) pushKeywordEvent(current, { type: 'important', on: Boolean(current.important) });
  return { query, tag: storeKeywordEntry(data, key, query, current) };
}
// Пояснение к смене отметки (eventId события отметки) или комментарий (без eventId — новый); remove — удалить.
function setKeywordNote(cabinet, campaignId, body = {}) {
  const key = keywordTagsKey(cabinet, campaignId), query = keywordQuery(body.query), text = String(body.text || '').trim();
  if (!body.remove && !text) throw apiError(400, 'Пустой комментарий');
  if (text.length > 1000) throw apiError(400, 'Комментарий длиннее 1000 символов');
  const data = readKeywordTags(), current = { ...(data.campaigns[key]?.[query] || {}) };
  current.history = [...(current.history || [])];
  if (!body.eventId) {
    if (body.remove) throw apiError(400, 'Не указано, что удалить');
    pushKeywordEvent(current, { type: 'comment', text });
  } else {
    const index = current.history.findIndex(event => event.id === body.eventId);
    if (index < 0) throw apiError(404, 'Запись истории не найдена — обновите страницу');
    const event = { ...current.history[index] }, now = new Date().toISOString();
    if (event.type === 'comment') { if (body.remove) { current.history.splice(index, 1); return { query, tag: storeKeywordEntry(data, key, query, current) }; } event.text = text; event.editedAt = now; }
    else if (body.remove) { delete event.note; delete event.noteAt; }
    else { event.note = text; event.noteAt = now; }
    current.history[index] = event;
  }
  return { query, tag: storeKeywordEntry(data, key, query, current) };
}
// Исключение и включение фраз через сайт попадают в историю («Статус фразы»).
function recordKeywordStatus(cabinet, campaignId, action, queries = []) {
  if (!queries.length) return;
  const key = keywordTagsKey(cabinet, campaignId), data = readKeywordTags();
  for (const query of queries) {
    const entry = { ...(data.campaigns[key]?.[query] || {}) };
    pushKeywordEvent(entry, { type: 'status', action });
    data.campaigns[key] = { ...(data.campaigns[key] || {}), [query]: entry };
  }
  writeKeywordTags(data);
}
function setKeywordTagColors(colors = {}) {
  const data = readKeywordTags(), allowed = ['important', ...KEYWORD_TAG_KEYS];
  data.colors = Object.fromEntries(Object.entries(colors || {}).filter(([key, value]) => allowed.includes(key) && /^#[0-9a-f]{6}$/i.test(String(value))));
  writeKeywordTags(data);
  return { colors: data.colors };
}

async function campaignKeywordDaily(id, campaignId, from, to, queryInput, nmIdsInput) {
  const period = historyPeriod(from, to), query = String(queryInput || '').trim(), dates = datesBetween(period.from, period.to);
  if (!query) throw apiError(400, 'Не указан ключевой запрос');
  if (id === 'demo' || !cabinets().length) {
    const items = [{ dailyStats: dates.map((date, index) => ({ date, stat: { normQuery: query, views: 400 + (index * 53) % 300, clicks: 12 + (index * 7) % 15, spend: 90 + (index * 31) % 80, atbs: 2 + index % 4, orders: index % 3, shks: index % 2, avgPos: 4 + index % 5 } })) }];
    return { demo: true, period, query, ...summarizeKeywordDaily(items, query, dates) };
  }
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const token = tokenFor(id);
  let nmIds = [...new Set((Array.isArray(nmIdsInput) ? nmIdsInput : []).map(String).filter(nmId => /^\d{1,15}$/.test(nmId)))].slice(0, 100);
  if (!nmIds.length) {
    const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
    const meta = (Array.isArray(campaignData?.adverts) ? campaignData.adverts : []).find(item => String(item.id) === String(campaignId));
    if (!meta) throw apiError(404, 'Кампания не найдена');
    nmIds = campaignProductIds(meta).map(String).slice(0, 100);
  }
  if (!nmIds.length) throw apiError(400, 'В кампании нет товаров');
  const response = await cachedAnalytics(`keyword-daily:${id}:${campaignId}:${period.from}:${period.to}:${nmIds.join(',')}`, () => normqueryRequest(id, token,
    { from: period.from, to: period.to, items: nmIds.map(nmId => ({ advertId: Number(campaignId), nmId: Number(nmId) })) }, NORMQUERY_DAILY_URL), 10 * 60_000);
  return { demo: false, period, query, ...summarizeKeywordDaily(response?.items || [], query, dates) };
}

function normqueryRequest(id, token, body, url = NORMQUERY_URL) {
  const task = async () => {
    for (;;) {
      const now = Date.now();
      const bucket = normqueryBuckets.get(id) || { tokens: NORMQUERY_BURST, updatedAt: now };
      bucket.tokens = Math.min(NORMQUERY_BURST, bucket.tokens + Math.max(0, now - bucket.updatedAt) / NORMQUERY_INTERVAL);
      bucket.updatedAt = now;
      normqueryBuckets.set(id, bucket);
      if (bucket.tokens < 1) { await wait((1 - bucket.tokens) * NORMQUERY_INTERVAL); continue; }
      bucket.tokens -= 1;
      return wbRequest(token, url, { method: 'POST', body });
    }
  };
  const run = (normqueryQueues.get(id) || Promise.resolve()).then(task);
  normqueryQueues.set(id, run.catch(() => {}));
  return run;
}

// Списки активных, неактивных и архивных кластеров кампании по каждому артикулу.
// --- Исключение и включение ключевых запросов (минус-фразы WB) ---
// Новый список минус-фраз товара: set-minus у WB перезаписывает список целиком, поэтому к текущему списку
// добавляются выбранные запросы (исключить) или из него убираются (включить); остальные фразы не трогаются.
function mergeMinusList(before = [], queries = [], action = 'exclude') {
  const selected = new Set(queries);
  return action === 'exclude' ? [...new Set([...before, ...queries])] : before.filter(query => !selected.has(query));
}

async function readMinusList(token, campaignId, nmId) {
  const response = await wbRequest(token, NORMQUERY_GET_MINUS_URL, { method: 'POST', body: { items: [{ advert_id: Number(campaignId), nm_id: Number(nmId) }] } });
  const item = (response?.items || []).find(entry => String(entry.nm_id ?? entry.nmId) === String(nmId));
  return (item?.norm_queries || item?.normQueries || []).map(String);
}

// Для каждого товара: прочитать текущий список, объединить, записать и перечитать для проверки.
// WB отклоняет весь запрос, если в нём есть кластер, которого у товара нет, поэтому каждому товару уходят только его кластеры.
async function campaignMinus(id, campaignId, action, queriesInput, nmIdsInput) {
  if (id === 'demo' || !cabinets().length) throw apiError(400, 'В демо-режиме исключать запросы нельзя');
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  if (!['exclude', 'include'].includes(action)) throw apiError(400, 'Неизвестное действие');
  const queries = [...new Set((Array.isArray(queriesInput) ? queriesInput : []).map(query => String(query || '').trim()).filter(Boolean))].slice(0, 500);
  if (!queries.length) throw apiError(400, 'Не выбраны запросы');
  const token = tokenFor(id);
  const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
  const meta = (Array.isArray(campaignData?.adverts) ? campaignData.adverts : []).find(item => String(item.id) === String(campaignId));
  if (!meta) throw apiError(404, 'Кампания не найдена');
  if (String(meta.settings?.payment_type || '').toLowerCase() === 'cpc') throw apiError(400, 'В кампаниях с оплатой за клики (CPC) WB не позволяет исключать запросы');
  const campaignNms = campaignProductIds(meta).map(String);
  const requested = Array.isArray(nmIdsInput) && nmIdsInput.length ? nmIdsInput.map(String).filter(nmId => campaignNms.includes(nmId)) : campaignNms;
  if (!requested.length) throw apiError(400, 'В кампании нет выбранных товаров');
  const statuses = await fetchNormqueryStatuses(id, token, campaignId, requested);
  const results = [];
  for (const nmId of requested) {
    const lists = statuses.get(nmId);
    const own = new Set(lists ? [...lists.active, ...lists.excluded, ...lists.archived] : []);
    const mine = queries.filter(query => own.has(query));
    if (!mine.length) continue;
    if (results.length) await wait(NORMQUERY_LIST_INTERVAL);
    try {
      const before = await readMinusList(token, campaignId, nmId);
      const next = mergeMinusList(before, mine, action);
      if (next.length === before.length && next.every(query => before.includes(query))) { results.push({ nmId, ok: true, changed: 0, queries: mine }); continue; }
      if (next.length > NORMQUERY_MINUS_LIMIT) throw apiError(400, `у товара было бы больше ${NORMQUERY_MINUS_LIMIT} минус-фраз — это предел WB`);
      await wbRequest(token, NORMQUERY_SET_MINUS_URL, { method: 'POST', body: { advert_id: Number(campaignId), nm_id: Number(nmId), norm_queries: next } });
      const after = await readMinusList(token, campaignId, nmId);
      const ok = mine.every(query => action === 'exclude' ? after.includes(query) : !after.includes(query));
      results.push({ nmId, ok, changed: Math.abs(after.length - before.length), queries: mine, error: ok ? '' : 'WB принял запрос, но список минус-фраз не изменился' });
    } catch (error) { results.push({ nmId, ok: false, changed: 0, queries: mine, error: error.message }); }
  }
  if (!results.length) throw apiError(400, 'Выбранные запросы не относятся к товарам кампании');
  return { action, results };
}

async function fetchNormqueryStatuses(id, token, campaignId, nmIds = []) {
  const statuses = new Map();
  for (let offset = 0; offset < nmIds.length; offset += NORMQUERY_CHUNK) {
    if (offset) await wait(NORMQUERY_LIST_INTERVAL);
    const items = nmIds.slice(offset, offset + NORMQUERY_CHUNK).map(nmId => ({ advertId: Number(campaignId), nmId: Number(nmId) }));
    const response = await wbRequest(token, NORMQUERY_LIST_URL, { method: 'POST', body: { items } });
    for (const item of Array.isArray(response?.items) ? response.items : []) {
      const nmId = String(item.nmId ?? item.nm_id ?? '');
      if (!nmId) continue;
      const lists = item.normQueries || item.norm_queries || {};
      statuses.set(nmId, { active: new Set(lists.active || []), excluded: new Set(lists.excluded || []), archived: new Set(lists.archived || []) });
    }
  }
  return statuses;
}

function keywordStatus(statuses, nmId, query) {
  const lists = statuses.get(String(nmId));
  if (!lists) return '';
  if (lists.excluded.has(query)) return 'excluded';
  if (lists.archived.has(query)) return 'archived';
  if (lists.active.has(query)) return 'active';
  return '';
}

function emptyKeyword(query) {
  return { query, views: 0, clicks: 0, spend: 0, carts: 0, orders: 0, sales: 0, positionWeight: 0, activeIn: 0, excludedIn: 0, archivedIn: 0, viewsKnown: false };
}

// По кампаниям с оплатой за клики WB не присылает в статистике запросов показы (а значит, и CTR с CPM):
// поля views в строках просто нет. Такие показатели помечаются неизвестными, а не нулевыми.
function addKeyword(target, row = {}) {
  if (row.views !== undefined && row.views !== null) target.viewsKnown = true;
  const views = Number(row.views || 0);
  target.views += views; target.clicks += Number(row.clicks || 0); target.spend += Number(row.spend || 0);
  target.carts += Number(row.atbs || 0); target.orders += Number(row.orders || 0); target.sales += Number(row.shks || 0);
  target.positionWeight += Number(row.avg_pos || 0) * (views || 1);
  target.positionBase = (target.positionBase || 0) + (views || 1);
}

function finalizeKeyword(row) {
  const { positionWeight, positionBase, ...rest } = row;
  // Запрос считается неактивным, если он выключен у всех артикулов, где встречается.
  const status = rest.activeIn ? 'active' : rest.excludedIn ? 'excluded' : rest.archivedIn ? 'archived' : '';
  const known = rest.viewsKnown;
  return { ...rest, status, views: known ? rest.views : null, ctr: known ? safeRatio(row.clicks, row.views) : null, cpc: safeRatio(row.spend, row.clicks, 1),
    cpm: known ? safeRatio(row.spend, row.views, 1000) : null, cr: safeRatio(row.orders, row.clicks),
    avgPosition: positionBase ? Math.round((positionWeight / positionBase) * 10) / 10 : 0 };
}

// Складывает ответ WB в итог по кампании и в разбивку по артикулам.
function summarizeKeywords(groups = [], statuses = new Map()) {
  const total = new Map(); const byNmId = new Map();
  // Присылает ли WB показы по этой кампании вообще: тогда у выключенных кластеров показы — честный 0, иначе неизвестны.
  const viewsAvailable = groups.some(group => (group.stats || []).some(row => row.views !== undefined && row.views !== null));
  for (const group of groups) {
    const nmId = String(group.nm_id ?? group.nmId ?? '');
    for (const row of group.stats || []) {
      const query = String(row.norm_query || row.normQuery || '').trim();
      if (!query) continue;
      if (!total.has(query)) total.set(query, emptyKeyword(query));
      addKeyword(total.get(query), row);
      if (keywordStatus(statuses, nmId, query) === 'active') total.get(query).activeIn += 1;
      if (!nmId) continue;
      if (!byNmId.has(nmId)) byNmId.set(nmId, new Map());
      const product = byNmId.get(nmId);
      if (!product.has(query)) product.set(query, emptyKeyword(query));
      addKeyword(product.get(query), row);
      if (keywordStatus(statuses, nmId, query) === 'active') product.get(query).activeIn += 1;
    }
  }
  // Выключенные и архивные кластеры показов не набирают, поэтому в статистике их нет:
  // добавляем их отдельными строками с нулями, чтобы было видно, что они отключены.
  for (const [nmId, lists] of statuses) {
    for (const [status, queries] of [['excluded', lists.excluded], ['archived', lists.archived]]) {
      for (const value of queries) {
        const query = String(value || '').trim();
        if (!query) continue;
        if (!total.has(query)) total.set(query, emptyKeyword(query));
        total.get(query)[`${status}In`] += 1;
        if (viewsAvailable) total.get(query).viewsKnown = true;
        if (!byNmId.has(nmId)) byNmId.set(nmId, new Map());
        const product = byNmId.get(nmId);
        if (!product.has(query)) product.set(query, emptyKeyword(query));
        product.get(query)[`${status}In`] += 1;
        if (viewsAvailable) product.get(query).viewsKnown = true;
      }
    }
  }
  const finalize = map => [...map.values()].map(finalizeKeyword).sort((a, b) => b.views - a.views || a.query.localeCompare(b.query, 'ru'));
  return { total: finalize(total), byNmId: Object.fromEntries([...byNmId].map(([nmId, map]) => [nmId, finalize(map)])) };
}

// Версия формата сохранённых ключевых запросов: файлы старых версий перекачиваются.
// 2 — показы, CTR и CPM пустые (null), если WB их не прислал (кампании с оплатой за клики), а не 0.
const KEYWORDS_FORMAT = 2;

function keywordsFile(cabinetId, campaignId, from, to) {
  return path.join(campaignDir(cabinetId, campaignId), `keywords-${from}_${to}.json`);
}

function readCampaignKeywords(cabinetId, campaignId, from, to) {
  try { return JSON.parse(fs.readFileSync(keywordsFile(cabinetId, campaignId, from, to), 'utf8')); } catch { return null; }
}

function saveCampaignKeywords(cabinetId, campaignId, from, to, data) {
  const target = keywordsFile(cabinetId, campaignId, from, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

function demoCampaignKeywords(campaignId, from, to) {
  const queries = ['чехол на iphone 17 pro', 'чехол magsafe', 'чехол с кольцом', 'силиконовый чехол'];
  const groups = [{ nm_id: 4210000, stats: queries.map((query, index) => ({ norm_query: query, views: 4200 - index * 900, clicks: 180 - index * 40,
    spend: 900 - index * 180, atbs: 40 - index * 8, orders: 12 - index * 3, shks: 8 - index * 2, avg_pos: 3 + index })) },
  { nm_id: 4210001, stats: queries.slice(0, 2).map((query, index) => ({ norm_query: query, views: 2100 - index * 700, clicks: 90 - index * 30,
    spend: 480 - index * 140, atbs: 18 - index * 6, orders: 5 - index * 2, shks: 3 - index, avg_pos: 5 + index })) }];
  const demoStatuses = new Map([['4210000', { active: new Set(queries.slice(0, 2)), excluded: new Set(queries.slice(2, 3)), archived: new Set(queries.slice(3)) }],
    ['4210001', { active: new Set(queries.slice(0, 1)), excluded: new Set(queries.slice(1, 2)), archived: new Set() }]]);
  return { demo: true, campaignId, period: { from, to }, updatedAt: new Date().toISOString(), viewsAvailable: true, ...summarizeKeywords(groups, demoStatuses),
    products: [{ nmId: 4210000, name: 'Демо-товар 1.1', vendorCode: 'DEMO-1', photo: '' }, { nmId: 4210001, name: 'Демо-товар 1.2', vendorCode: 'DEMO-2', photo: '' }], warnings: [] };
}

async function campaignKeywords(id, campaignId, from, to, refresh = false) {
  const period = historyPeriod(from, to);
  if (id === 'demo' || !cabinets().length) return demoCampaignKeywords(campaignId, period.from, period.to);
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const stored = readCampaignKeywords(id, campaignId, period.from, period.to);
  if (stored?.format === KEYWORDS_FORMAT && !refresh && !funnelRangeNeedsFetch(period.to, stored.updatedAt)) return { ...stored, fromFile: true };
  const token = tokenFor(id); const warnings = [];
  const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
  const meta = (Array.isArray(campaignData?.adverts) ? campaignData.adverts : []).find(item => String(item.id) === String(campaignId));
  if (!meta) throw apiError(404, 'Кампания не найдена');
  const nmIds = campaignProductIds(meta);
  if (!nmIds.length) return { demo: false, campaignId, period, updatedAt: new Date().toISOString(), total: [], byNmId: {}, products: [],
    warnings: ['В кампании нет товаров, по которым WB отдаёт поисковые запросы'] };
  const groups = [];
  for (let offset = 0; offset < nmIds.length; offset += NORMQUERY_CHUNK) {
    const items = nmIds.slice(offset, offset + NORMQUERY_CHUNK).map(nmId => ({ advert_id: Number(campaignId), nm_id: Number(nmId) }));
    try {
      const response = await normqueryRequest(id, token, { from: period.from, to: period.to, items });
      groups.push(...(Array.isArray(response?.stats) ? response.stats : []));
    } catch (error) { warnings.push(`Ключевые запросы: ${error.message}`); }
  }
  const statuses = await fetchNormqueryStatuses(id, token, campaignId, nmIds)
    .catch(error => (warnings.push(`Статусы ключевых запросов: ${error.message}`), new Map()));
  const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000).catch(() => []);
  const byNmIdCard = new Map(cards.map(card => [String(card.nmID), { name: card.title || `Товар ${card.nmID}`, vendorCode: card.vendorCode || '', photo: cardPhoto(card) }]));
  const summary = summarizeKeywords(groups, statuses);
  const result = { demo: false, format: KEYWORDS_FORMAT, campaignId, period, updatedAt: new Date().toISOString(), ...summary,
    viewsAvailable: summary.total.some(row => row.viewsKnown),
    products: nmIds.map(nmId => ({ nmId, ...(byNmIdCard.get(String(nmId)) || { name: `Товар ${nmId}`, vendorCode: '', photo: '' }) }))
      .filter(product => summary.byNmId[String(product.nmId)]?.length), warnings };
  if (!warnings.length) { try { saveCampaignKeywords(id, campaignId, period.from, period.to, result); } catch (error) { warnings.push(`Не удалось сохранить ключевые запросы: ${error.message}`); } }
  return result;
}

// Дни, за которые у кампании может быть статистика: не раньше создания и не позже завершения (см. campaignEndStamp).
// Даты WB отдаёт по Москве, поэтому день берётся прямо из строки.
function campaignActivePeriod(campaign = {}, period) {
  const day = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? String(value).slice(0, 10) : '';
  const created = day(campaign.timestamps?.created), ended = day(campaignEndStamp(campaign));
  const from = created > period.from ? created : period.from;
  const to = ended && ended < period.to ? ended : period.to;
  return from <= to ? { from, to } : null;
}

async function advertisingCampaignHistory(id, campaignId, from, to, report = () => {}) {
  const whole = historyPeriod(from, to);
  const demo = id === 'demo' || !cabinets().length;
  if (!demo && !/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const token = demo ? null : tokenFor(id);
  let meta = null; let cardsPromise = Promise.resolve([]); let campaign = null;
  if (!demo) {
    // Карточки нужны только для названий и фото, поэтому грузятся параллельно и не задерживают запросы статистики.
    cardsPromise = cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000).catch(() => []);
    const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
    meta = (Array.isArray(campaignData?.adverts) ? campaignData.adverts : []).find(item => String(item.id) === String(campaignId));
    if (!meta) throw apiError(404, 'Кампания не найдена');
    campaign = summarizeAdStats([meta], [], whole.from, whole.to).campaigns[0];
  }
  // Запрашиваются только дни жизни кампании: до создания WB статистику не отдаёт, и запросы по ним — пустая трата лимита.
  const active = demo ? whole : campaignActivePeriod(meta, whole);
  const dates = active ? datesBetween(active.from, active.to) : [];
  const stored = demo || !active ? new Map() : loadStoredAdDays(id, campaignId, active.from, active.to);
  const plan = demo ? { missing: dates, chunks: historyChunks(whole) } : planAdFetch(dates, new Set(stored.keys()));
  const storedDays = dates.length - plan.missing.length;
  report({ type: 'start', chunks: plan.chunks.length, period: whole, activePeriod: active, createdAt: meta?.timestamps?.created || '', days: dates.length, storedDays });
  const daily = new Map(); const productsByDate = new Map(); const warnings = [];
  const missing = new Set(plan.missing);
  for (const [date, record] of stored) {
    if (missing.has(date)) continue;
    daily.set(date, record.campaign);
    productsByDate.set(date, (record.products || []).map(item => ({ ...item, date, advertId: Number(campaignId) })));
  }
  for (const [index, chunk] of plan.chunks.entries()) {
    report({ type: 'request', index, chunks: plan.chunks.length, ...chunk });
    let data;
    try {
      if (demo) data = demoAds(chunk.from, chunk.to);
      else {
        const stats = cachedCampaignStats(id, campaignId, chunk.from, chunk.to) || await fullstatsRequest(id, token, String(campaignId), chunk.from, chunk.to,
          (ms, reason) => report({ type: 'wait', index, chunks: plan.chunks.length, ms, reason }));
        data = summarizeAdStats([meta], Array.isArray(stats) ? stats : [], chunk.from, chunk.to);
      }
    } catch (error) {
      warnings.push(`${chunk.from} — ${chunk.to}: ${error.message}`);
      report({ type: 'chunk', index, chunks: plan.chunks.length, ok: false, error: error.message });
      continue;
    }
    const row = (data.campaigns || []).find(item => String(item.id) === String(campaignId));
    if (row) campaign = row;
    const chunkDates = datesBetween(chunk.from, chunk.to);
    const chunkDays = new Map((row?.daily || []).map(day => [day.date, day]));
    const chunkProducts = campaignProductDaily(data.productDaily || [], campaignId, row?.nmIds || []);
    for (const date of chunkDates) {
      daily.set(date, chunkDays.get(date) || emptyAdDay(date));
      productsByDate.set(date, chunkProducts.filter(item => item.date === date));
    }
    if (!demo) {
      try { saveAdDays(campaignId, id, meta.settings?.name || row?.name || '', chunkDates, daily, productsByDate); }
      catch (error) { warnings.push(`Не удалось сохранить статистику ${chunk.from} — ${chunk.to}: ${error.message}`); }
    }
    report({ type: 'chunk', index, chunks: plan.chunks.length, ok: true });
  }
  if (!campaign) throw apiError(warnings.length ? 502 : 404, warnings[0] || 'Кампания не найдена');
  report({ type: 'finalize' });
  const days = [...daily.values()].filter(hasAdActivity).sort((a, b) => a.date.localeCompare(b.date));
  const total = emptyAdMetrics(); days.forEach(day => addAdMetrics(total, day));
  const cards = await cardsPromise;
  const enriched = enrichAdvertising({ campaigns: [{ ...campaign, ...finalizeAdMetrics(total), daily: days }], products: [],
    productDaily: [...productsByDate.values()].flat() }, cards);
  return { generatedAt: new Date().toISOString(), cabinet: id, campaignId, period: whole, activePeriod: active, warnings, storedDays, requests: plan.chunks.length,
    folder: demo ? '' : `data/Ads/${cabinetFolderName(id)}/${campaignId}`, campaign: enriched.campaigns[0], setup: campaignSetup(meta, cards, demo),
    productDaily: enriched.productDaily.sort((a, b) => `${a.date}:${a.nmId}`.localeCompare(`${b.date}:${b.nmId}`)) };
}
async function advertisingCampaign(id, campaignId, from, to) {
  const summary = await advertising(id, from, to);
  const campaign = (summary.campaigns || []).find(item => String(item.id) === String(campaignId));
  if (!campaign) throw apiError(404, 'Кампания не найдена за выбранный период');
  const productDaily = campaignProductDaily(summary.productDaily || [], campaignId, campaign.nmIds || []);
  return { period: summary.period, campaign, productDaily };
}
// Момент, после которого у кампании не может быть статистики. У действующих WB ставит в deleted заглушку 2100-01-01,
// и у многих завершённых тоже; тогда для завершённой (статус 7) берётся updated: завершение само меняет эту дату.
function campaignEndStamp(campaign = {}) {
  const deleted = campaign.timestamps?.deleted || '';
  // Заглушка приходит как 2100-01-01T00:00:00+03:00, то есть в UTC это ещё 2099 год, поэтому граница с запасом.
  if (Date.parse(deleted) < Date.parse('2099-01-01T00:00:00Z')) return deleted;
  return Number(campaign.status) === 7 ? campaign.timestamps?.updated || '' : '';
}

// Начало берётся из created, а не из started: started — последний запуск, и кампания могла крутиться в периоде до перезапуска.
function adCampaignMayHaveStats(campaign = {}, from, to) {
  const ended = Date.parse(campaignEndStamp(campaign));
  if (Number.isFinite(ended) && ended < Date.parse(`${from}T00:00:00+03:00`)) return false;
  const created = Date.parse(campaign.timestamps?.created || '');
  return !(Number.isFinite(created) && created > Date.parse(`${to}T23:59:59+03:00`));
}

// part=active — быстрый первый ответ вкладки: статистика только действующих и приостановленных кампаний, без остатков бюджета.
// Полный ответ вкладка запрашивает следом в фоне; пачки действующих кампаний при этом берутся из кэша fullstats.
async function advertising(id, from, to, part = 'all') {
  const period = validAdPeriod(from, to);
  if (id === 'demo' || !cabinets().length) return demoAds(period.from, period.to);
  const token = tokenFor(id); const warnings = []; const partial = part === 'active';
  const { campaigns, stats } = await loadAdStats(id, token, period, warnings, partial ? 'running' : 'all');
  // Карточки нужны только для фото и названий товаров. Быстрый ответ их не ждёт: если в кэше их нет,
  // загрузка идёт в фоне, и фото с названиями приходят вместе с полным ответом.
  const cardsJob = cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000);
  const cards = partial ? (await Promise.race([cardsJob.catch(() => []), wait(0).then(() => null)]) ?? []) : await cardsJob;
  const budgets = partial ? new Map() : await advertBudgets(id, token, campaigns, warnings);
  const summary = enrichAdvertising(summarizeAdStats(campaigns, stats, period.from, period.to), cards);
  return { demo: false, partial, ...summary, campaigns: withAdBudgets(summary.campaigns, budgets), warnings };
}

// Статистика кампаний за прошлый период той же длины — для изменений в процентах в таблице «Рекламные кампании».
// Вкладка запрашивает её последней, в фоне: это ещё один проход по fullstats (раз в 20 секунд на пачку).
const AD_COMPARE_KEYS = ['spend', 'views', 'clicks', 'ctr', 'cpc', 'cpm', 'carts', 'orders', 'cr', 'cpo', 'revenue', 'drr', 'roas'];
async function advertisingPrevious(id, from, to) {
  const period = validAdPeriod(from, to);
  const length = datesBetween(period.from, period.to).length;
  const previous = { from: addDays(period.from, -length), to: addDays(period.from, -1) };
  const pick = campaign => ({ id: campaign.id, ...Object.fromEntries(AD_COMPARE_KEYS.map(key => [key, Number(campaign[key] || 0)])) });
  if (id === 'demo' || !cabinets().length) return { demo: true, period: previous, campaigns: demoAds(previous.from, previous.to).campaigns.map(pick), warnings: [] };
  const warnings = [];
  const { campaigns, stats } = await loadAdStats(id, tokenFor(id), previous, warnings);
  return { demo: false, period: previous, campaigns: summarizeAdStats(campaigns, stats, previous.from, previous.to).campaigns.map(pick), warnings };
}

async function loadAdStats(id, token, period, warnings = [], part = 'all') {
  const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
  const campaigns = Array.isArray(campaignData?.adverts) ? campaignData.adverts : [];
  const stats = [];
  // WB отдаёт статистику максимум по 50 кампаниям за запрос и не чаще раза в 20 секунд,
  // поэтому кампании, закончившиеся до начала периода, не запрашиваются: статистики у них быть не может.
  // Действующие и завершённые идут разными пачками: пачки одинаковы во всех вызовах за период
  // (вкладка, её фоновая догрузка, сводка) и повторно берутся из кэша fullstats.
  const statCampaigns = campaigns.filter(campaign => adCampaignMayHaveStats(campaign, period.from, period.to));
  const running = statCampaigns.filter(campaign => Number(campaign.status) !== 7);
  const finished = statCampaigns.filter(campaign => Number(campaign.status) === 7);
  for (const group of part === 'running' ? [running] : [running, finished]) {
    for (let offset = 0; offset < group.length; offset += 50) {
      const ids = group.slice(offset, offset + 50).map(item => item.id).join(',');
      if (!ids) continue;
      try {
        const chunk = await fullstatsRequest(id, token, ids, period.from, period.to);
        if (Array.isArray(chunk)) stats.push(...chunk);
      } catch (error) { warnings.push(`Статистика рекламы: ${error.message}`); }
    }
  }
  return { campaigns, stats };
}

function withAdBudgets(campaigns = [], budgets = new Map()) {
  return campaigns.map(campaign => ({ ...campaign, budget: budgets.has(String(campaign.id)) ? budgets.get(String(campaign.id)) : null }));
}

async function advertBudgets(id, token, campaigns = [], warnings = []) {
  const targets = campaigns.filter(item => AD_BUDGET_STATUSES.has(Number(item.status))).map(item => item.id).filter(Boolean);
  const budgets = new Map();
  let failed = 0;
  for (let offset = 0; offset < targets.length && offset < AD_BUDGET_LIMIT; offset += AD_BUDGET_CHUNK) {
    if (offset) await wait(1_100);
    const chunk = targets.slice(offset, offset + AD_BUDGET_CHUNK);
    const loaded = await Promise.all(chunk.map(advertId => cachedAnalytics(`ad-budget:${id}:${advertId}`, () => wbRequest(token,
      `https://advert-api.wildberries.ru/adv/v1/budget?id=${encodeURIComponent(advertId)}`), 60_000)
      .then(data => ({ advertId, total: data?.currency ? Number(data.total || 0) : null })).catch(() => { failed += 1; return null; })));
    for (const item of loaded) if (item && item.total !== null) budgets.set(String(item.advertId), item.total);
  }
  if (failed) warnings.push(`Остаток бюджета: WB не ответил по ${failed} кампаниям`);
  if (targets.length > AD_BUDGET_LIMIT) warnings.push(`Остаток бюджета показан для первых ${AD_BUDGET_LIMIT} кампаний из ${targets.length}`);
  return budgets;
}

function enrichFunnelProducts(products = [], cards = []) {
  const byNmId = new Map(cards.map(card => [String(card.nmID), cardPhoto(card)]));
  return products.map(item => {
    const photo = byNmId.get(String((item.product || item).nmId ?? (item.product || item).nmID)) || '';
    return item.product ? { ...item, product: { ...item.product, photo } } : { ...item, photo };
  });
}

// --- История воронки продаж ---
// WB отдаёт историю воронки только за последние 7 дней, поэтому дни сохраняются
// в data/Funnel/<кабинет>/<месяц>.json и прошлые периоды берутся оттуда.
function moscowDate(offsetDays = 0) {
  const date = new Date(Date.now() + 3 * 3_600_000); date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function pickFunnelCounts(point = {}) {
  return Object.fromEntries(FUNNEL_COUNT_KEYS.map(key => [key, Number(point[key] || 0)]));
}

function funnelDir(cabinetId) {
  const target = path.join(FUNNEL_DIR, cabinetFolderName(cabinetId));
  if (fs.existsSync(target)) return target;
  let entries = [];
  try { entries = fs.readdirSync(FUNNEL_DIR, { withFileTypes: true }); } catch { return target; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(FUNNEL_DIR, entry.name);
    try {
      if (String(JSON.parse(fs.readFileSync(path.join(dir, 'cabinet.json'), 'utf8')).id) === String(cabinetId)) { fs.renameSync(dir, target); break; }
    } catch {}
  }
  return target;
}

function readFunnelMonth(cabinetId, month) {
  try { return JSON.parse(fs.readFileSync(path.join(funnelDir(cabinetId), `${month}.json`), 'utf8')); } catch { return null; }
}

function saveFunnelDays(cabinetId, points = []) {
  if (!points.length) return;
  const dir = funnelDir(cabinetId); const fetchedAt = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cabinet.json'), JSON.stringify({ id: String(cabinetId) }, null, 2));
  const byMonth = new Map();
  for (const point of points) {
    if (!byMonth.has(point.date.slice(0, 7))) byMonth.set(point.date.slice(0, 7), []);
    byMonth.get(point.date.slice(0, 7)).push(point);
  }
  for (const [month, monthPoints] of byMonth) {
    const file = readFunnelMonth(cabinetId, month) || { cabinet: String(cabinetId), month, days: {} };
    for (const point of monthPoints) file.days[point.date] = { fetchedAt, ...pickFunnelCounts(point), ...(point.products ? { products: point.products } : {}) };
    file.days = Object.fromEntries(Object.entries(file.days).sort(([a], [b]) => a.localeCompare(b)));
    Object.assign(file, { name: cabinets().find(item => String(item.id) === String(cabinetId))?.name || '', updatedAt: fetchedAt });
    const target = path.join(dir, `${month}.json`);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(file, null, 2));
    fs.renameSync(`${target}.tmp`, target);
  }
}

function loadFunnelDays(cabinetId, from, to) {
  const days = [];
  for (const month of [...new Set(datesBetween(from, to).map(date => date.slice(0, 7)))]) {
    for (const [date, record] of Object.entries(readFunnelMonth(cabinetId, month)?.days || {})) {
      if (date >= from && date <= to) days.push({ date, fetchedAt: record.fetchedAt || '', ...pickFunnelCounts(record), ...(record.products ? { products: record.products } : {}) });
    }
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function funnelStoredFrom(cabinetId) {
  try {
    const months = fs.readdirSync(funnelDir(cabinetId)).filter(name => /^\d{4}-\d{2}\.json$/.test(name)).sort();
    return months.length ? Object.keys(readFunnelMonth(cabinetId, months[0].slice(0, 7))?.days || {}).sort()[0] || '' : '';
  } catch { return ''; }
}

// Итоги недель и месяцев хранятся отдельно от дней, в periods.json папки кабинета.
function readFunnelRanges(cabinetId) {
  try { return JSON.parse(fs.readFileSync(path.join(funnelDir(cabinetId), 'periods.json'), 'utf8')).ranges || {}; } catch { return {}; }
}

function saveFunnelRanges(cabinetId, ranges = []) {
  if (!ranges.length) return;
  const dir = funnelDir(cabinetId); const fetchedAt = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cabinet.json'), JSON.stringify({ id: String(cabinetId) }, null, 2));
  const stored = readFunnelRanges(cabinetId);
  for (const range of ranges) stored[`${range.from}_${range.to}`] = { fetchedAt, ...pickFunnelCounts(range), ...(range.products ? { products: range.products } : {}) };
  const target = path.join(dir, 'periods.json');
  fs.writeFileSync(`${target}.tmp`, JSON.stringify({ cabinet: String(cabinetId), updatedAt: fetchedAt, ranges: stored }, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

// Метод статистики карточек ограничен 3 запросами в минуту со всплеском до 3,
// поэтому таблица воронки и догрузка графика идут через общую очередь кабинета.
function funnelProductsRequest(id, token, body) {
  const task = async () => {
    let retries = 0;
    for (;;) {
      const now = Date.now();
      const bucket = funnelBuckets.get(id) || { tokens: FUNNEL_BUCKET_SIZE, updatedAt: now };
      bucket.tokens = Math.min(FUNNEL_BUCKET_SIZE, bucket.tokens + Math.max(0, now - bucket.updatedAt) / FUNNEL_BUCKET_INTERVAL);
      bucket.updatedAt = now;
      funnelBuckets.set(id, bucket);
      if (bucket.tokens < 1) { await wait((1 - bucket.tokens) * FUNNEL_BUCKET_INTERVAL); continue; }
      bucket.tokens -= 1;
      try { return await wbRequest(token, FUNNEL_PRODUCTS_URL, { method: 'POST', body }); }
      catch (error) {
        if (error.status !== 429 || retries >= 3) throw error;
        retries++;
        funnelBuckets.set(id, { tokens: 0, updatedAt: Date.now() });
        await wait(Math.max(FUNNEL_BUCKET_INTERVAL, (error.retryAfter || 0) * 1000));
      }
    }
  };
  const run = (funnelQueues.get(id) || Promise.resolve()).then(task);
  funnelQueues.set(id, run.catch(() => {}));
  return run;
}

function funnelStatisticValues(statistic = {}) {
  return FUNNEL_COUNT_KEYS.map(key => Number((key === 'addToWishlistCount' ? statistic?.addToWishlist ?? statistic?.addToWishlistCount : statistic?.[key]) || 0));
}

// Итог и разбивка по артикулам; артикулы без активности не сохраняются, чтобы файлы не разрастались.
function addFunnelStatistic(target, statistic = {}, nmId = '') {
  const values = funnelStatisticValues(statistic);
  FUNNEL_COUNT_KEYS.forEach((key, index) => { target[key] += values[index]; });
  if (target.products && nmId && values.some(Boolean)) target.products[nmId] = values;
}

// Сумма показателей по выбранным артикулам; для записей без разбивки фильтр применить нельзя.
function funnelRecordCounts(record, nmIds = null) {
  if (!record) return null;
  if (!nmIds) return pickFunnelCounts(record);
  if (!record.products) return null;
  const total = pickFunnelCounts();
  for (const nmId of nmIds) {
    const values = record.products[nmId];
    if (values) FUNNEL_COUNT_KEYS.forEach((key, index) => { total[key] += Number(values[index] || 0); });
  }
  return total;
}

// Один запрос отдаёт два отрезка: выбранный и «прошлый период», который задаётся отдельно.
async function fetchFunnelRanges(id, token, selected, past = null) {
  const current = { from: selected.from, to: selected.to, ...pickFunnelCounts(), products: {} };
  const previous = past ? { from: past.from, to: past.to, ...pickFunnelCounts(), products: {} } : null;
  for (let offset = 0; ; offset += 1000) {
    const response = await funnelProductsRequest(id, token, { selectedPeriod: { start: selected.from, end: selected.to },
      ...(past ? { pastPeriod: { start: past.from, end: past.to } } : {}), nmIds: [], brandNames: [], subjectIds: [], tagIds: [],
      skipDeletedNm: true, orderBy: { field: 'openCard', mode: 'desc' }, limit: 1000, offset });
    const products = response?.data?.products || response?.products || [];
    for (const item of products) {
      const nmId = String(item.product?.nmId ?? item.nmId ?? '');
      addFunnelStatistic(current, item.statistic?.selected, nmId);
      if (previous) addFunnelStatistic(previous, item.statistic?.past, nmId);
    }
    if (products.length < 1000) break;
  }
  return previous ? [current, previous] : [current];
}

async function fetchFunnelDays(id, token, selected, past = '') {
  const ranges = await fetchFunnelRanges(id, token, { from: selected, to: selected }, past ? { from: past, to: past } : null);
  return ranges.map(({ from, to, ...counts }) => ({ date: from, ...counts }));
}

// Отрезок окончательный, если скачан хотя бы через неделю после своего конца: WB догружает данные несколько дней.
// Неокончательные отрезки перекачиваются не чаще раза в час.
function funnelRangeNeedsFetch(to, fetchedAt, now = Date.now()) {
  const fetched = Date.parse(fetchedAt || '');
  if (!Number.isFinite(fetched)) return true;
  if (fetched >= Date.parse(`${addDays(to, FUNNEL_FINAL_AFTER_DAYS)}T00:00:00Z`)) return false;
  return now - fetched >= FUNNEL_REFRESH_MINUTES * 60_000;
}

function funnelDaysToFetch(dates = [], records = new Map(), now = Date.now(), today = moscowDate(0)) {
  const earliest = addDays(today, -FUNNEL_MAX_DEPTH_DAYS);
  return [...new Set(dates)].filter(date => {
    if (date > today || date < earliest) return false;
    const record = records.get(date);
    return !record?.products || funnelRangeNeedsFetch(date, record.fetchedAt, now);
  });
}

// Пары дней для запросов: сначала самые свежие, более ранний день идёт как прошлый период.
function pairFunnelDays(dates = []) {
  const sorted = [...new Set(dates)].sort().reverse(); const pairs = [];
  for (let index = 0; index < sorted.length; index += 2) pairs.push({ selected: sorted[index], past: sorted[index + 1] || '' });
  return pairs;
}

function funnelWeekStart(date) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return value.toISOString().slice(0, 10);
}

// Недели (с понедельника) или календарные месяцы внутри периода; прошлый отрезок сдвинут на длину периода.
function funnelRangeBuckets(period, grouping) {
  const buckets = []; const index = new Map(); const length = datesBetween(period.from, period.to).length;
  for (const date of datesBetween(period.from, period.to)) {
    const key = grouping === 'week' ? funnelWeekStart(date) : date.slice(0, 7);
    if (!index.has(key)) { const bucket = { key, from: date, to: date }; index.set(key, bucket); buckets.push(bucket); }
    index.get(key).to = date;
  }
  return buckets.map(bucket => ({ ...bucket, previous: { from: addDays(bucket.from, -length), to: addDays(bucket.to, -length) } }));
}

// Итог отрезка: из сохранённых дней, если все дни есть и достаточно свежие, иначе из сохранённого итога отрезка.
function funnelRangeValues(range, daysByDate, storedRanges, nmIds = null, now = Date.now()) {
  const dates = datesBetween(range.from, range.to);
  if (dates.every(date => daysByDate.get(date)?.products && !funnelRangeNeedsFetch(date, daysByDate.get(date).fetchedAt, now))) {
    const total = pickFunnelCounts();
    for (const date of dates) {
      const counts = funnelRecordCounts(daysByDate.get(date), nmIds);
      for (const key of FUNNEL_COUNT_KEYS) total[key] += counts[key];
    }
    return { values: total, fresh: true };
  }
  const stored = storedRanges[`${range.from}_${range.to}`];
  if (!stored) return { values: null, fresh: false };
  return { values: funnelRecordCounts(stored, nmIds), fresh: Boolean(stored.products) && !funnelRangeNeedsFetch(range.to, stored.fetchedAt, now) };
}

// Кнопка «Перекачать» в воронке: дни выбранного периода (или его недели и месяцы, если график сгруппирован)
// ставятся в очередь заново и перезаписываются, даже если уже считаются окончательными.
// Дни сохраняются целиком, поэтому перекачка обновляет и итоги, и разбивку по артикулам.
function refetchFunnel(id, from, to, grouping = 'day') {
  if (id === 'demo' || !cabinets().length) throw apiError(400, 'В демо-режиме перекачивать нечего');
  tokenFor(id);
  const periods = funnelPeriods(from, to);
  const earliest = addDays(moscowDate(0), -FUNNEL_MAX_DEPTH_DAYS);
  const job = funnelJobs.get(id);
  if (grouping === 'week' || grouping === 'month') {
    const ranges = funnelRangeBuckets(periods.current, grouping).filter(bucket => bucket.from >= earliest)
      .map(bucket => ({ ...bucket, previous: bucket.previous.from >= earliest ? bucket.previous : null }));
    // Недавние ошибки не должны откладывать явный запрос пользователя.
    ranges.forEach(range => job?.failedAt.delete(`${range.from}_${range.to}`));
    scheduleFunnelSync(id, [], ranges);
    const keys = ranges.map(range => `${range.from}_${range.to}`);
    return { grouping, scheduled: ranges.length, sync: funnelSyncStatus(id, [], keys) };
  }
  const dates = datesBetween(periods.current.from, periods.current.to).filter(date => date >= earliest);
  dates.forEach(date => job?.failedAt.delete(date));
  scheduleFunnelSync(id, dates);
  return { grouping: 'day', scheduled: dates.length, sync: funnelSyncStatus(id, dates) };
}

function scheduleFunnelSync(id, dates = [], ranges = []) {
  const job = funnelJobs.get(id) || { pending: new Set(), ranges: new Map(), current: [], currentRange: '', failedAt: new Map(), running: false, lastError: '' };
  funnelJobs.set(id, job);
  const now = Date.now();
  for (const date of dates) {
    if (job.current.includes(date) || now - (job.failedAt.get(date) || 0) < FUNNEL_RETRY_FAILED_MS) continue;
    job.pending.add(date);
  }
  for (const range of ranges) {
    const key = `${range.from}_${range.to}`;
    if (job.currentRange === key || now - (job.failedAt.get(key) || 0) < FUNNEL_RETRY_FAILED_MS) continue;
    job.ranges.set(key, range);
  }
  if (!job.running && (job.pending.size || job.ranges.size)) runFunnelSync(id, job);
  return job;
}

async function runFunnelSync(id, job) {
  job.running = true; job.lastError = '';
  try {
    const token = tokenFor(id);
    while (job.ranges.size || job.pending.size) {
      if (job.ranges.size) {
        // Недели и месяцы открытого графика идут первыми: их меньше и пользователь ждёт именно их.
        const [key, range] = job.ranges.entries().next().value;
        job.ranges.delete(key); job.currentRange = key;
        try { saveFunnelRanges(id, await fetchFunnelRanges(id, token, range, range.previous)); }
        catch (error) {
          job.lastError = error.message; job.failedAt.set(key, Date.now());
          if ([401, 403].includes(error.status)) { job.ranges.clear(); job.pending.clear(); }
        }
        job.currentRange = '';
        continue;
      }
      const [pair] = pairFunnelDays([...job.pending]);
      job.current = [pair.selected, pair.past].filter(Boolean);
      job.current.forEach(date => job.pending.delete(date));
      try { saveFunnelDays(id, await fetchFunnelDays(id, token, pair.selected, pair.past)); }
      catch (error) {
        job.lastError = error.message; job.current.forEach(date => job.failedAt.set(date, Date.now()));
        if ([401, 403].includes(error.status)) { job.ranges.clear(); job.pending.clear(); }
      }
      job.current = [];
    }
  } catch (error) { job.lastError = error.message; job.pending.clear(); job.ranges.clear(); }
  finally { job.running = false; job.current = []; job.currentRange = ''; }
}

function funnelSyncStatus(id, dates = [], rangeKeys = []) {
  const job = funnelJobs.get(id); const inRange = new Set(dates); const keys = new Set(rangeKeys);
  const leftDays = job ? [...job.pending, ...job.current].filter(date => inRange.has(date)).length : 0;
  const leftRanges = job ? [...job.ranges.keys(), job.currentRange].filter(key => key && keys.has(key)).length : 0;
  const requests = job ? job.ranges.size + (job.currentRange ? 1 : 0) + Math.ceil((job.pending.size + job.current.length) / 2) : 0;
  const bucket = funnelBuckets.get(id);
  const tokens = bucket ? Math.min(FUNNEL_BUCKET_SIZE, bucket.tokens + (Date.now() - bucket.updatedAt) / FUNNEL_BUCKET_INTERVAL) : FUNNEL_BUCKET_SIZE;
  return { pending: rangeKeys.length ? leftRanges : leftDays, running: Boolean(job?.running), lastError: job?.lastError || '',
    etaSeconds: Math.ceil(Math.max(0, requests - Math.floor(tokens)) * FUNNEL_BUCKET_INTERVAL / 1000 + requests * 2) };
}

function funnelPeriods(from, to) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  const today = moscowDate(0);
  const requestedTo = pattern.test(to || '') ? to : today;
  const currentTo = requestedTo > today ? today : requestedTo;
  const currentFrom = pattern.test(from || '') ? from : addDays(currentTo, -6);
  if (currentFrom > currentTo) throw apiError(400, 'Начало периода должно быть раньше окончания');
  const length = datesBetween(currentFrom, currentTo).length;
  if (length > 366) throw apiError(400, 'Для графика воронки выберите период не больше года');
  return { current: { from: currentFrom, to: currentTo }, previous: { from: addDays(currentFrom, -length), to: addDays(currentFrom, -1) } };
}

function demoFunnelHistory(periods, grouping = 'day') {
  const make = ({ from, to }, shift) => datesBetween(from, to).map((date, index) => {
    const open = 900 + ((index * 37 + shift) % 11) * 45; const cart = Math.round(open * (0.05 + ((index + shift) % 4) * 0.006));
    const orders = Math.round(cart * 0.26); const buyouts = Math.round(orders * 0.62);
    return { date, openCount: open, cartCount: cart, orderCount: orders, orderSum: orders * 1490, buyoutCount: buyouts, buyoutSum: buyouts * 1490, addToWishlistCount: Math.round(open * 0.012) };
  });
  const current = make(periods.current, 0); const previous = make(periods.previous, 5);
  const byDate = new Map([...current, ...previous].map(day => [day.date, { ...day, fetchedAt: '2100-01-01T00:00:00Z', products: {} }]));
  const buckets = grouping === 'day' ? [] : funnelRangeBuckets(periods.current, grouping).map(bucket => ({ ...bucket,
    values: funnelRangeValues(bucket, byDate, {}).values, previous: { ...bucket.previous, values: funnelRangeValues(bucket.previous, byDate, {}).values } }));
  return { demo: true, grouping, periods, current, previous, buckets, storedFrom: periods.previous.from,
    earliestAvailable: addDays(moscowDate(0), -FUNNEL_MAX_DEPTH_DAYS), sync: { pending: 0, running: false, lastError: '', etaSeconds: 0 }, warnings: [] };
}

function normalizeFunnelNmIds(nmIds) {
  if (!Array.isArray(nmIds)) return null;
  return [...new Set(nmIds.map(value => String(value)).filter(value => /^\d{1,15}$/.test(value)))].slice(0, 5000);
}

async function funnelHistory(id, from, to, grouping = 'day', nmIdsInput = null) {
  const safeGrouping = ['day', 'week', 'month'].includes(grouping) ? grouping : 'day';
  const nmIds = normalizeFunnelNmIds(nmIdsInput);
  const periods = funnelPeriods(from, to);
  if (id === 'demo' || !cabinets().length) return { ...demoFunnelHistory(periods, safeGrouping), filtered: Boolean(nmIds) };
  tokenFor(id);
  const dates = datesBetween(periods.previous.from, periods.current.to);
  const stored = loadFunnelDays(id, periods.previous.from, periods.current.to);
  const shown = stored.map(day => { const counts = funnelRecordCounts(day, nmIds); return counts ? { date: day.date, fetchedAt: day.fetchedAt, ...counts } : null; }).filter(Boolean);
  const inPeriod = ({ from: start, to: end }) => shown.filter(day => day.date >= start && day.date <= end);
  const base = { demo: false, grouping: safeGrouping, filtered: Boolean(nmIds), productCount: nmIds ? nmIds.length : null, periods, current: inPeriod(periods.current), previous: inPeriod(periods.previous),
    storedFrom: funnelStoredFrom(id), earliestAvailable: addDays(moscowDate(0), -FUNNEL_MAX_DEPTH_DAYS),
    folder: `data/Funnel/${cabinetFolderName(id)}`, warnings: [] };
  if (safeGrouping === 'day') {
    scheduleFunnelSync(id, funnelDaysToFetch(dates, new Map(stored.map(day => [day.date, day]))));
    return { ...base, buckets: [], sync: funnelSyncStatus(id, dates) };
  }
  const byDate = new Map(stored.map(day => [day.date, day])); const storedRanges = readFunnelRanges(id);
  const earliest = base.earliestAvailable; const toFetch = [];
  const buckets = funnelRangeBuckets(periods.current, safeGrouping).map(bucket => {
    const current = funnelRangeValues(bucket, byDate, storedRanges, nmIds); const previous = funnelRangeValues(bucket.previous, byDate, storedRanges, nmIds);
    if ((!current.fresh || !previous.fresh) && bucket.from >= earliest) toFetch.push({ ...bucket, previous: bucket.previous.from >= earliest ? bucket.previous : null });
    return { ...bucket, values: current.values, previous: { ...bucket.previous, values: previous.values } };
  });
  scheduleFunnelSync(id, [], toFetch);
  return { ...base, buckets, sync: funnelSyncStatus(id, [], buckets.map(bucket => `${bucket.from}_${bucket.to}`)) };
}

// Матрица «товар × день» для вкладки продаж по дням: значения берутся из сохранённой разбивки по артикулам.
function funnelSalesMatrix(days = [], dates = [], nmIds = null, metric = 'orderCount') {
  const index = FUNNEL_COUNT_KEYS.indexOf(metric);
  if (index < 0) throw apiError(400, 'Неизвестный показатель');
  const byDate = new Map(days.map(day => [day.date, day]));
  const products = new Map();
  const addProduct = nmId => products.get(nmId) || products.set(nmId, { nmId, values: dates.map(() => null), total: 0 }).get(nmId);
  if (nmIds) nmIds.forEach(nmId => addProduct(String(nmId)));
  dates.forEach((date, column) => {
    const record = byDate.get(date);
    if (!record?.products) return;
    for (const [nmId, values] of Object.entries(record.products)) {
      if (nmIds && !products.has(nmId)) continue;
      const product = addProduct(nmId);
      const value = Number(values[index] || 0);
      product.values[column] = (product.values[column] || 0) + value;
      product.total += value;
    }
    for (const product of products.values()) if (product.values[column] === null) product.values[column] = 0;
  });
  const totals = dates.map((date, column) => byDate.get(date)?.products
    ? [...products.values()].reduce((sum, product) => sum + Number(product.values[column] || 0), 0) : null);
  return { products: [...products.values()].sort((a, b) => b.total - a.total || String(a.nmId).localeCompare(String(b.nmId))),
    totals, total: totals.reduce((sum, value) => sum + Number(value || 0), 0) };
}

async function funnelSales(id, from, to, nmIdsInput = null, metric = 'orderCount') {
  const periods = funnelPeriods(from, to);
  const period = periods.current;
  const dates = datesBetween(period.from, period.to);
  const nmIds = normalizeFunnelNmIds(nmIdsInput);
  if (id === 'demo' || !cabinets().length) {
    const demo = demoFunnelHistory(periods, 'day');
    return { demo: true, period, dates, metric, ...funnelSalesMatrix([], dates, nmIds, metric),
      sync: { pending: 0, running: false, lastError: '', etaSeconds: 0 }, warnings: ['В демо-режиме продажи по дням не заполняются'], days: demo.current.length };
  }
  tokenFor(id);
  const stored = loadFunnelDays(id, period.from, period.to);
  scheduleFunnelSync(id, funnelDaysToFetch(dates, new Map(stored.map(day => [day.date, day]))));
  return { demo: false, period, dates, metric, ...funnelSalesMatrix(stored, dates, nmIds, metric),
    ready: stored.filter(day => day.products).length, sync: funnelSyncStatus(id, dates), warnings: [] };
}

async function funnelDetails(id, from, to) {
  if (id === 'demo' || !cabinets().length) return { products: [], history: [], groupedHistory: [] };
  const token = tokenFor(id); const periods = funnelPeriods(from, to);
  // Прошлый период той же длины нужен для изменений в процентах; старше года WB его не отдаёт.
  const past = periods.previous.from >= addDays(moscowDate(0), -FUNNEL_MAX_DEPTH_DAYS) ? periods.previous : null;
  const raw = [];
  // WB отдаёт до 1000 товаров за запрос: остальные догружаются следующими страницами, иначе итог по товарам неполный.
  for (let offset = 0; ; offset += 1000) {
    const response = await funnelProductsRequest(id, token, { selectedPeriod: { start: periods.current.from, end: periods.current.to },
      ...(past ? { pastPeriod: { start: past.from, end: past.to } } : {}), nmIds: [], skipDeletedNm: true,
      orderBy: { field: 'openCard', mode: 'desc' }, limit: 1000, offset });
    const page = response?.data?.products || response?.products || [];
    raw.push(...page);
    if (page.length < 1000) break;
  }
  const products = enrichFunnelProducts(raw, await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000).catch(() => []));
  return { periods: { current: periods.current, previous: past }, products, history: [], groupedHistory: [] };
}

// --- Общая сводка ---
// Итоги выбранного и прошлого периода с разбивкой по артикулам приходят одним запросом воронки
// и сохраняются в periods.json рядом с отрезками графика; дневная динамика берётся из истории воронки.
const SUMMARY_TOP_PRODUCTS = 5;
const SUMMARY_DROP_LIMIT = 6;
const SUMMARY_REFRESH_MS = 2 * 60_000;
const DROP_MIN_ORDERS = 3;
const DROP_MIN_OPENS = 100;
const DROP_RATIO = 0.7;

function funnelCountsFromValues(values = []) {
  return Object.fromEntries(FUNNEL_COUNT_KEYS.map((key, index) => [key, Number(values?.[index] || 0)]));
}

function summaryProducts(current = {}, previous = null, cards = []) {
  const byNmId = new Map(cards.map(card => [String(card.nmID), card]));
  const ids = new Set([...Object.keys(current?.products || {}), ...Object.keys(previous?.products || {})]);
  return [...ids].map(nmId => {
    const card = byNmId.get(nmId) || {};
    return { nmId: Number(nmId), name: card.title || `Товар ${nmId}`, vendorCode: card.vendorCode || '', subjectName: card.subjectName || '',
      photo: cardPhoto(card), current: funnelCountsFromValues(current?.products?.[nmId]), previous: funnelCountsFromValues(previous?.products?.[nmId]) };
  });
}

function productBrief(product) {
  return { nmId: product.nmId, name: product.name, vendorCode: product.vendorCode, photo: product.photo };
}

// Лидеры по сумме заказов и «Прочие»; доля прошлого периода нужна, чтобы показать сдвиг в п.п.
function summaryTopProducts(products = [], limit = SUMMARY_TOP_PRODUCTS) {
  const total = products.reduce((sum, item) => sum + item.current.orderSum, 0);
  const previousTotal = products.reduce((sum, item) => sum + item.previous.orderSum, 0);
  const share = (value, base) => base ? value / base * 100 : 0;
  const sorted = products.filter(item => item.current.orderSum > 0).sort((a, b) => b.current.orderSum - a.current.orderSum || a.nmId - b.nmId);
  const items = sorted.slice(0, limit).map(item => ({ ...productBrief(item), orderSum: item.current.orderSum, orderCount: item.current.orderCount,
    share: share(item.current.orderSum, total), previousShare: share(item.previous.orderSum, previousTotal) }));
  const rest = sorted.slice(limit);
  const restSum = rest.reduce((sum, item) => sum + item.current.orderSum, 0);
  const restPrevious = previousTotal - items.reduce((sum, item) => sum + products.find(p => p.nmId === item.nmId).previous.orderSum, 0);
  return { total, previousTotal, items, other: rest.length ? { count: rest.length, orderSum: restSum,
    orderCount: rest.reduce((sum, item) => sum + item.current.orderCount, 0), share: share(restSum, total), previousShare: share(restPrevious, previousTotal) } : null };
}

// Товар попадает в просадки, если заказы, переходы или конверсия в заказ упали на 30% и больше.
// Пороги по количеству отсекают шум: падение с 2 заказов до 1 ничего не значит.
function summaryDrops(products = [], limit = SUMMARY_DROP_LIMIT) {
  const change = (from, to) => from ? (to - from) / from * 100 : 0;
  const drops = [];
  for (const product of products) {
    const now = product.current, before = product.previous, reasons = [];
    if (before.orderCount >= DROP_MIN_ORDERS && now.orderCount <= before.orderCount * DROP_RATIO) {
      reasons.push({ metric: 'orderCount', label: 'Заказы', from: before.orderCount, to: now.orderCount, change: change(before.orderCount, now.orderCount) });
    }
    if (before.openCount >= DROP_MIN_OPENS && now.openCount <= before.openCount * DROP_RATIO) {
      reasons.push({ metric: 'openCount', label: 'Переходы', from: before.openCount, to: now.openCount, change: change(before.openCount, now.openCount) });
    }
    if (before.openCount >= DROP_MIN_OPENS && now.openCount >= DROP_MIN_OPENS && before.orderCount >= DROP_MIN_ORDERS) {
      const was = before.orderCount / before.openCount * 100, is = now.orderCount / now.openCount * 100;
      if (is <= was * DROP_RATIO) reasons.push({ metric: 'orderConversion', label: 'Конв. в заказ', from: was, to: is, change: change(was, is), unit: '%' });
    }
    if (!reasons.length) continue;
    const worst = Math.min(...reasons.map(reason => reason.change));
    drops.push({ ...productBrief(product), severity: worst <= -60 ? 'high' : worst <= -45 ? 'medium' : 'low', worst,
      lostSum: Math.max(0, before.orderSum - now.orderSum), reasons: reasons.sort((a, b) => a.change - b.change) });
  }
  drops.sort((a, b) => b.lostSum - a.lostSum || a.worst - b.worst);
  return { total: drops.length, items: drops.slice(0, limit) };
}

async function summaryFunnelRanges(id, token, periods, refresh = false) {
  const now = Date.now(); const stored = readFunnelRanges(id);
  const withPrevious = periods.previous.from >= addDays(moscowDate(0), -FUNNEL_MAX_DEPTH_DAYS);
  const pick = range => { const record = stored[`${range.from}_${range.to}`]; return record?.products ? record : null; };
  const fresh = (record, range) => Boolean(record) && (refresh ? now - Date.parse(record.fetchedAt || '') < SUMMARY_REFRESH_MS : !funnelRangeNeedsFetch(range.to, record.fetchedAt, now));
  const current = pick(periods.current), previous = withPrevious ? pick(periods.previous) : null;
  if (fresh(current, periods.current) && (!withPrevious || fresh(previous, periods.previous))) return { current, previous, fetchedAt: current.fetchedAt };
  try {
    const [loaded, loadedPrevious = null] = await fetchFunnelRanges(id, token, periods.current, withPrevious ? periods.previous : null);
    saveFunnelRanges(id, [loaded, loadedPrevious].filter(Boolean));
    return { current: loaded, previous: loadedPrevious, fetchedAt: new Date().toISOString() };
  } catch (error) {
    if (current) return { current, previous, fetchedAt: current.fetchedAt, staleError: error.message };
    throw error;
  }
}

function summaryPayload(periods, current, previous, products, history) {
  const day = item => ({ date: item.date, ...pickFunnelCounts(item) });
  return { periods, totals: { current: pickFunnelCounts(current), previous: previous ? pickFunnelCounts(previous) : null },
    daily: { current: (history.current || []).map(day), previous: (history.previous || []).map(day) }, sync: history.sync,
    top: summaryTopProducts(products), drops: previous ? summaryDrops(products) : { total: 0, items: [] },
    productCount: products.filter(item => item.current.orderCount || item.current.openCount).length };
}

const DEMO_SUMMARY_PRODUCTS = [
  ['Худи оверсайз с капюшоном', 'HOODIE-01', .26, .22], ['Футболка базовая хлопок', 'TEE-BASE', .19, .17], ['Свитшот с начёсом', 'SWEAT-02', .14, .10],
  ['Джоггеры утеплённые', 'JOG-05', .11, .09], ['Лонгслив в рубчик', 'LONG-11', .08, .15], ['Шорты спортивные', 'SHORT-07', .07, .06],
  ['Кепка с вышивкой', 'CAP-03', .06, .05], ['Носки, набор 5 пар', 'SOCKS-5', .05, .12], ['Панама хлопковая', 'PANAMA-1', .04, .04]
];

function demoSummary(periods) {
  const history = demoFunnelHistory(periods, 'day');
  const sum = days => { const total = pickFunnelCounts(); days.forEach(item => FUNNEL_COUNT_KEYS.forEach(key => { total[key] += Number(item[key] || 0); })); return total; };
  const current = sum(history.current), previous = sum(history.previous);
  const part = (total, weight) => Object.fromEntries(FUNNEL_COUNT_KEYS.map(key => [key, Math.round(total[key] * weight)]));
  const products = DEMO_SUMMARY_PRODUCTS.map(([name, vendorCode, now, before], index) => ({ nmId: 100001 + index, name, vendorCode, subjectName: '', photo: '',
    current: part(current, now), previous: part(previous, before) }));
  return { demo: true, ...summaryPayload(periods, current, previous, products, history), fetchedAt: new Date().toISOString(), warnings: [] };
}

async function summary(id, from, to, refresh = false) {
  const periods = funnelPeriods(from, to);
  if (id === 'demo' || !cabinets().length) return demoSummary(periods);
  const token = tokenFor(id); const warnings = [];
  // Запрос итогов ставится в очередь воронки раньше догрузки дней, чтобы карточки появились первыми.
  const rangesJob = summaryFunnelRanges(id, token, periods, refresh);
  rangesJob.catch(() => {});
  const history = await funnelHistory(id, periods.current.from, periods.current.to, 'day');
  const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000)
    .catch(error => (warnings.push(`Карточки товаров: ${error.message}`), []));
  const ranges = await rangesJob;
  if (ranges.staleError) warnings.push(`Воронка: ${ranges.staleError}. Показаны сохранённые данные`);
  if (!ranges.previous) warnings.push('WB отдаёт воронку только за последний год, поэтому сравнения с прошлым периодом нет');
  const products = summaryProducts(ranges.current, ranges.previous, cards);
  return { demo: false, ...summaryPayload(periods, ranges.current, ranges.previous, products, history), fetchedAt: ranges.fetchedAt, warnings };
}

function summaryAdPeriod(days = [], range) {
  const daily = days.filter(day => day.date >= range.from && day.date <= range.to);
  const total = emptyAdMetrics(); daily.forEach(day => addAdMetrics(total, day));
  return { totals: finalizeAdMetrics(total), daily };
}

// Реклама идёт отдельным запросом: fullstats отвечает не чаще раза в 20 секунд и не дольше чем за 31 день.
// Текущий период запрашивается первым и теми же пачками, что и вкладка «Реклама»: открытая следом вкладка берёт их из кэша.
async function summaryAds(id, from, to) {
  const periods = funnelPeriods(from, to);
  const length = datesBetween(periods.current.from, periods.current.to).length;
  if (length > 31) return { available: false, periods, reason: 'Реклама в сводке доступна за период до 31 дня — это ограничение WB API', warnings: [] };
  const ranges = [periods.current, periods.previous];
  const demo = id === 'demo' || !cabinets().length; const warnings = []; const days = [];
  for (const range of ranges) {
    // Демо-реклама рассчитана на вкладку «Реклама» и крупнее демо-воронки, поэтому для сводки она уменьшена.
    if (demo) { days.push(...demoAds(range.from, range.to).daily.map(day => finalizeAdMetrics({ ...day, ...Object.fromEntries(['views', 'clicks', 'spend', 'orders', 'revenue', 'carts', 'sales'].map(key => [key, day[key] * 0.08])) }))); continue; }
    const { campaigns, stats } = await loadAdStats(id, tokenFor(id), range, warnings);
    days.push(...summarizeAdStats(campaigns, stats, range.from, range.to).daily);
  }
  return { demo, available: true, periods, current: summaryAdPeriod(days, periods.current), previous: summaryAdPeriod(days, periods.previous), warnings };
}

// --- Снимки цен с GitHub Actions (.github/workflows/price-snapshots.yml) ---
// GitHub каждые 3 часа кладёт зашифрованные снимки в ветку snapshots. Сервер при запуске и раз в час скачивает их,
// расшифровывает закрытым ключом (data/snapshot-key.pem) в data/price-snapshots/<кабинет>/<время>.json и удаляет
// скачанное из ветки отдельным коммитом — рабочие файлы и текущая ветка не затрагиваются.
const SNAPSHOT_KEY_FILE = path.join(ROOT, 'data', 'snapshot-key.pem');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'price-snapshots');
const SNAPSHOT_FILE_RE = /^prices\/[\w-]+\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.json\.enc$/;
const snapshotSync = { running: false, lastRun: null, lastError: '', downloaded: 0, removed: 0 };
function git(args, extraEnv = {}) {
  return new Promise((resolve, reject) => execFile('git', args, { cwd: ROOT, timeout: 120_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    // Без окон с вводом пароля: сервер работает в фоне — если доступа нет, просто будет ошибка в статусе.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...extraEnv } },
  (error, stdout, stderr) => error ? reject(new Error((stderr || error.message).trim())) : resolve(stdout)));
}
async function removeFromSnapshotBranch(head, files) {
  const index = path.join(os.tmpdir(), `wb-snapshots-${process.pid}-${Date.now()}.index`), env = { GIT_INDEX_FILE: index };
  const author = { GIT_AUTHOR_NAME: 'wb-pulse', GIT_AUTHOR_EMAIL: 'wb-pulse@users.noreply.github.com', GIT_COMMITTER_NAME: 'wb-pulse', GIT_COMMITTER_EMAIL: 'wb-pulse@users.noreply.github.com' };
  try {
    await git(['read-tree', head], env);
    for (let offset = 0; offset < files.length; offset += 200) await git(['update-index', '--force-remove', '--', ...files.slice(offset, offset + 200)], env);
    const tree = (await git(['write-tree'], env)).trim();
    const commit = (await git(['commit-tree', tree, '-p', head, '-m', `Снимки скачаны на компьютер: ${files.length}`], { ...env, ...author })).trim();
    await git(['push', '--quiet', 'origin', `${commit}:refs/heads/snapshots`]);
    snapshotSync.removed += files.length;
  } catch (error) {
    // GitHub успел записать новый снимок — ветка ушла вперёд; скачанное уберём при следующей синхронизации.
    if (!/rejected|non-fast-forward|fetch first/i.test(error.message)) throw error;
  } finally { fs.rmSync(index, { force: true }); }
}
async function syncPriceSnapshots() {
  if (snapshotSync.running || !fs.existsSync(SNAPSHOT_KEY_FILE)) return snapshotSync;
  snapshotSync.running = true;
  try {
    try { await git(['fetch', '--quiet', 'origin', '+refs/heads/snapshots:refs/remotes/origin/snapshots']); }
    catch (error) { if (/couldn't find remote ref|could not find remote ref/i.test(error.message)) { snapshotSync.lastError = ''; return snapshotSync; } throw error; }
    const head = (await git(['rev-parse', 'refs/remotes/origin/snapshots'])).trim();
    const files = (await git(['ls-tree', '-r', '--name-only', head, '--', 'prices'])).split('\n').map(name => name.trim()).filter(name => SNAPSHOT_FILE_RE.test(name));
    const key = fs.readFileSync(SNAPSHOT_KEY_FILE, 'utf8');
    for (const file of files) {
      const [, cabinet, name] = file.split('/'), target = path.join(SNAPSHOT_DIR, cabinet, name.replace(/\.enc$/, ''));
      if (fs.existsSync(target)) continue;
      const snapshot = decryptSnapshot(await git(['show', `${head}:${file}`]), key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(`${target}.tmp`, JSON.stringify(snapshot));
      fs.renameSync(`${target}.tmp`, target);
      snapshotSync.downloaded += 1;
    }
    // Удаляем из ветки только то, что уже лежит на компьютере.
    if (files.length) await removeFromSnapshotBranch(head, files);
    snapshotSync.lastError = '';
  } catch (error) {
    snapshotSync.lastError = error.message;
    console.error('Снимки цен:', error.message);
  } finally {
    snapshotSync.running = false;
    snapshotSync.lastRun = new Date().toISOString();
  }
  return snapshotSync;
}
// История цены товара по скачанным снимкам. Артикул WB уникален, поэтому ищем во всех кабинетах.
// Индекс перечитывается, только когда меняется набор файлов (новые снимки приходят раз в час).
let priceHistoryIndex = { signature: '', byNmId: new Map(), first: null, count: 0 };
function snapshotFiles() {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  return fs.readdirSync(SNAPSHOT_DIR, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .flatMap(entry => fs.readdirSync(path.join(SNAPSHOT_DIR, entry.name)).filter(name => name.endsWith('.json')).map(name => path.join(SNAPSHOT_DIR, entry.name, name)));
}
function buildPriceHistory(snapshots = []) {
  const byNmId = new Map();
  for (const snapshot of snapshots.sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)))) {
    for (const good of snapshot.goods || []) {
      const key = String(good.nmId);
      if (!byNmId.has(key)) byNmId.set(key, []);
      byNmId.get(key).push({ takenAt: snapshot.takenAt, price: good.price, discount: good.discount, discountedPrice: good.discountedPrice, clubDiscount: good.clubDiscount, clubDiscountedPrice: good.clubDiscountedPrice, currency: good.currency });
    }
  }
  return byNmId;
}
function priceHistory(nmId) {
  if (!/^\d{1,12}$/.test(String(nmId || ''))) throw apiError(400, 'Некорректный артикул');
  const files = snapshotFiles(), signature = `${files.length}:${files.map(file => path.basename(file)).sort().at(-1) || ''}`;
  if (signature !== priceHistoryIndex.signature) {
    const snapshots = files.map(file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }).filter(Boolean);
    priceHistoryIndex = { signature, byNmId: buildPriceHistory(snapshots), count: snapshots.length,
      first: snapshots.map(snapshot => snapshot.takenAt).filter(Boolean).sort()[0] || null };
  }
  // История есть, если настроены снимки с GitHub (есть ключ) или уже сделан хоть один снимок с сайта.
  return { nmId: Number(nmId), points: priceHistoryIndex.byNmId.get(String(nmId)) || [], snapshots: priceHistoryIndex.count, firstSnapshot: priceHistoryIndex.first, enabled: fs.existsSync(SNAPSHOT_KEY_FILE) || files.length > 0 };
}
// «Снять цены сейчас»: снимок с сайта, без GitHub — сразу в data/price-snapshots/site-<кабинет>/ (на компьютере, без
// шифрования). История цены собирается по артикулу из всех папок, поэтому такие снимки встают в ту же историю.
// Не чаще раза в минуту на кабинет — двойной клик не делает двух снимков.
const localSnapshotTimes = new Map();
async function takePriceSnapshot(id) {
  if (id === 'demo' || !cabinets().length) throw apiError(400, 'В демо-режиме снимки цен не делаются');
  const token = tokenFor(id), since = Date.now() - (localSnapshotTimes.get(id) || 0);
  if (since < 60_000) throw apiError(429, `Снимок этого кабинета только что сделан — следующий через ${Math.ceil((60_000 - since) / 1000)} сек`);
  localSnapshotTimes.set(id, Date.now());
  let rawGoods;
  // Если WB ответил ошибкой — снимка нет, и повторить можно сразу.
  try { rawGoods = await loadPriceGoods(token); } catch (error) { localSnapshotTimes.delete(id); throw error; }
  const takenAt = new Date(), goods = compactGoods(rawGoods), cabinet = `site-${String(id).replace(/[^\w-]/g, '')}`;
  const dir = path.join(SNAPSHOT_DIR, cabinet), file = path.join(dir, `${moscowStamp(takenAt)}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, cabinet, source: 'site', takenAt: takenAt.toISOString(), goods }));
  fs.renameSync(`${file}.tmp`, file);
  return { ok: true, takenAt: takenAt.toISOString(), goods: goods.length, ...priceSnapshotsStatus() };
}
function priceSnapshotsStatus() {
  const cabinets = fs.existsSync(SNAPSHOT_DIR) ? fs.readdirSync(SNAPSHOT_DIR, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const files = fs.readdirSync(path.join(SNAPSHOT_DIR, entry.name)).filter(name => name.endsWith('.json')).sort();
    return { cabinet: entry.name, count: files.length, first: files[0]?.replace('.json', '') || null, last: files.at(-1)?.replace('.json', '') || null };
  }) : [];
  return { enabled: fs.existsSync(SNAPSHOT_KEY_FILE), cabinets, sync: { ...snapshotSync } };
}

// --- Оценки товаров: /api/analytics/v2/item-rating — рейтинг по отзывам, новые отзывы по звёздам, сравнение с конкурентами ---
// WB: период заканчивается не позже вчерашнего дня и начинается не раньше 364 суток от вчера; лимит — 3 запроса
// в минуту (интервал 20 сек); данные обновляются раз в час, поэтому кэш 30 минут.
// Поле dynamics — разница с прошлым периодом в тех же единицах, а не проценты, как сказано в документации:
// проверено на данных (22 отзыва при dynamics 18 — в прошлом периоде было ровно 4).
const ITEM_RATING_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v2/item-rating';
const ITEM_RATING_PAGE = 1000;
const ITEM_RATING_INTERVAL = 21_000;
const itemRatingAttempts = new Map();
function itemRatingPeriods(from, to) {
  const yesterday = moscowDate(-1), earliest = addDays(yesterday, -364), valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  const end = valid(to) && to < yesterday ? (to < earliest ? earliest : to) : yesterday;
  let start = valid(from) ? from : addDays(end, -6);
  if (start > end) start = end;
  if (start < earliest) start = earliest;
  const length = datesBetween(start, end).length, pastStart = addDays(start, -length);
  return { current: { start, end }, past: pastStart >= earliest ? { start: pastStart, end: addDays(start, -1) } : null, endClamped: valid(to) && to > end };
}
function normalizeItemRatings(pages = [], cards = []) {
  const byNmId = new Map(cards.map(card => [String(card.nmID), card])), first = pages[0] || {}, increase = first.feedbackIncrease || {};
  const delta = value => value == null ? null : Number(value);
  const STAR_KEYS = { 5: 'fiveStar', 4: 'fourStar', 3: 'threeStar', 2: 'twoStar', 1: 'oneStar' };
  const items = pages.flatMap(page => page.items || []).map(item => {
    const card = byNmId.get(String(item.nmId)) || {};
    return { nmId: item.nmId, title: item.title || card.title || `Товар ${item.nmId}`, vendorCode: item.vendorCode || card.vendorCode || '',
      subjectName: item.subjectName || '', brandName: item.brandName || '', photo: cardPhoto(card),
      cardRating: item.rating == null ? null : Number(item.rating),
      feedbackRating: item.feedbackRating?.current == null ? null : Number(item.feedbackRating.current), feedbackRatingDelta: delta(item.feedbackRating?.dynamics),
      percentile: item.feedbackRating?.percentile == null ? null : Number(item.feedbackRating.percentile),
      newFeedbacks: Number(item.feedbackCount?.current || 0), newFeedbacksDelta: delta(item.feedbackCount?.dynamics),
      stars: Object.fromEntries(Object.entries(STAR_KEYS).map(([star, key]) => [star, { count: Number(item[key]?.current || 0), delta: delta(item[key]?.dynamics) }])),
      disqualified: Number(item.disqualified || 0), pinned: Boolean(item.pinnedFeedback), shadowed: Boolean(item.isShadowed) };
  });
  return {
    seller: { rating: first.sellerRating?.current ?? null, ratingDelta: delta(first.sellerRating?.dynamics),
      newFeedbacks: Number(increase.current || 0), newFeedbacksDelta: delta(increase.dynamics), totalFeedbacks: Number(increase.total || 0),
      stars: Object.fromEntries(Object.entries(STAR_KEYS).map(([star, key]) => [star, { count: Number(increase[key]?.current || 0), delta: delta(increase[key]?.dynamics), total: Number(increase[key]?.total || 0) }])) },
    items
  };
}
function demoItemRatings() {
  const items = [
    ['Быстрая зарядка 67W Type-C', 4.23, 0.01, 7.7, 8.5, [48, 4, 1, 1, 4], 8, 2, false],
    ['Беспроводная зарядка MagSafe 20W', 4.51, -0.49, 44.4, 10, [17, 2, 1, 0, 2], 18, 0, false],
    ['Фен-стайлер с насадками', 4.71, 0, 32.6, 7.2, [12, 1, 0, 0, 1], 1, 0, false],
    ['Чехол для iPhone 17 Pro Max', 4.88, 0.02, 81.3, 9.1, [25, 2, 0, 0, 0], -3, 1, false],
    ['Кабель USB-C 2 м', 3.92, -0.12, 3.1, 6.4, [5, 1, 1, 2, 3], 4, 0, true]
  ].map(([title, rating, ratingDelta, percentile, cardRating, stars, countDelta, disqualified, shadowed], index) => ({
    nmId: 4210000 + index, title, vendorCode: `DEMO-${index + 1}`, subjectName: 'Демо', brandName: 'Demo', rating: cardRating,
    feedbackRating: { current: rating, dynamics: ratingDelta, percentile }, feedbackCount: { current: stars.reduce((sum, value) => sum + value, 0), dynamics: countDelta },
    fiveStar: { current: stars[0] }, fourStar: { current: stars[1] }, threeStar: { current: stars[2] }, twoStar: { current: stars[3] }, oneStar: { current: stars[4] },
    disqualified, pinnedFeedback: index === 0, isShadowed: shadowed }));
  return { sellerRating: { current: 4.31, dynamics: 0.02 }, feedbackIncrease: { current: 131, total: 40746, dynamics: 31,
    fiveStar: { current: 107, total: 29818 }, fourStar: { current: 10, total: 2400 }, threeStar: { current: 3, total: 1500 }, twoStar: { current: 3, total: 1487 }, oneStar: { current: 10, total: 5541 } }, items };
}
async function itemRatings(id, from, to) {
  const periods = itemRatingPeriods(from, to);
  if (id === 'demo' || !cabinets().length) return { demo: true, periods, ...normalizeItemRatings([demoItemRatings()]) };
  const token = tokenFor(id);
  const pages = await cachedAnalytics(`item-rating:${id}:${periods.current.start}:${periods.current.end}`, async () => {
    const result = [];
    for (let offset = 0; offset < 20 * ITEM_RATING_PAGE; offset += ITEM_RATING_PAGE) {
      // Не чаще одного запроса в 21 секунду на кабинет — лимит WB 3 в минуту.
      const wait = ITEM_RATING_INTERVAL - (Date.now() - (itemRatingAttempts.get(id) || 0));
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      itemRatingAttempts.set(id, Date.now());
      const response = await wbRequest(token, ITEM_RATING_URL, { method: 'POST', body: { currentPeriod: periods.current, ...(periods.past ? { pastPeriod: periods.past } : {}),
        orderBy: { field: 'feedbackCount', mode: 'desc' }, limit: ITEM_RATING_PAGE, offset } }).catch(error => {
        if (error.status === 429) throw apiError(429, `WB ограничил частоту запросов оценок (3 в минуту) — повторите через ${error.retryAfter || 20} сек`);
        throw error;
      });
      const data = response?.data || {};
      result.push(data);
      if ((data.items || []).length < ITEM_RATING_PAGE) break;
    }
    return result;
  }, 30 * 60_000);
  const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000).catch(() => []);
  return { demo: false, periods, ...normalizeItemRatings(pages, cards) };
}

// --- Лента заказов WB: один общий запрос на кабинет ---
// WB отдаёт ленту не чаще 1 раза в минуту на аккаунт и максимум за последние 31 день. Поэтому и список заказов,
// и график по часам берут данные из одного запроса за 31 день (кэш 90 сек): повторный запрос раньше минуты
// не отправляется, а при отказе WB отдаются последние полученные данные.
const ORDER_FEED_INTERVAL = 61_000;
const orderFeedAttempts = new Map();
async function orderFeedMonth(id, token) {
  const today = moscowDate();
  return cachedAnalytics(`order-feed-31:${id}`, async () => {
    const wait = ORDER_FEED_INTERVAL - (Date.now() - (orderFeedAttempts.get(id) || 0));
    if (wait > 0) throw apiError(429, `WB отдаёт ленту заказов не чаще 1 раза в минуту — повторите через ${Math.ceil(wait / 1000)} сек`);
    orderFeedAttempts.set(id, Date.now());
    try {
      const feed = await wbRequest(token, 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/order-feed', { method: 'POST', body: {
        // Без пагинации WB отдаёт только 50 последних событий, поэтому запрашиваем максимум за один раз.
        selectedPeriod: { start: `${addDays(today, -30)}T00:00:00Z`, end: `${today}T23:59:59Z` }, pagination: { limit: ORDER_FEED_LIMIT } } });
      return { feed, fetchedAt: new Date().toISOString() };
    } catch (error) {
      if (error.status === 429) throw apiError(429, `WB ограничил частоту запросов ленты заказов (1 в минуту) — повторите через ${error.retryAfter || 60} сек`);
      throw error;
    }
  }, 90_000);
}
// Период списка заказов — по времени текущего статуса события, как фильтрует сам WB.
function orderFeedPeriod(feed, from, to) {
  const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T23:59:59Z`);
  const orders = (feed?.data?.orders || []).filter(order => { const at = Date.parse(order.updatedAt || order.createdAt); return at >= start && at <= end; });
  return { ...feed, data: { ...(feed?.data || {}), orders } };
}

// --- Заказы по часам (Лента заказов): сегодня и 7 предыдущих дней по московскому времени ---
const HOURLY_DAYS = 8;
// Каждый заказ (srid) считается один раз — по времени оформления; отменённые и возвращённые тоже, как в заказах WB.
// Выкуп — событие со статусом «выкуплен», по времени этого статуса (когда покупатель забрал товар).
// byNow — заказы и выкупы дня до того же времени суток, что сейчас: честное сравнение «к этому часу».
function summarizeHourlyOrders(orders = [], today, nowMinutes) {
  const dates = Array.from({ length: HOURLY_DAYS }, (_, index) => addDays(today, index - HOURLY_DAYS + 1));
  const empty = () => ({ count: 0, sum: 0, buyoutCount: 0, buyoutSum: 0 });
  const days = new Map(dates.map(date => [date, { date, hours: Array.from({ length: 24 }, empty), byNow: empty() }]));
  const place = time => {
    const at = new Date(time);
    if (Number.isNaN(at.getTime())) return null;
    const msk = new Date(at.getTime() + 3 * 3_600_000), day = days.get(msk.toISOString().slice(0, 10));
    return day ? { day, hour: msk.getUTCHours(), beforeNow: msk.getUTCHours() * 60 + msk.getUTCMinutes() <= nowMinutes } : null;
  };
  const add = (slot, countKey, sumKey, price) => {
    if (!slot) return;
    slot.day.hours[slot.hour][countKey] += 1; slot.day.hours[slot.hour][sumKey] += price;
    if (slot.beforeNow) { slot.day.byNow[countKey] += 1; slot.day.byNow[sumKey] += price; }
  };
  const seen = new Set();
  for (const order of orders) {
    const id = String(order.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const price = Number(order.price || 0) / 100;
    add(place(order.orderedAt || order.createdAt), 'count', 'sum', price);
    if (order.rawStatus === 'buyout') add(place(order.createdAt), 'buyoutCount', 'buyoutSum', price);
  }
  return dates.map(date => days.get(date));
}
function demoHourlyOrders(today, nowMinutes) {
  const orders = [];
  for (let back = 0; back < HOURLY_DAYS; back++) {
    const date = addDays(today, -back);
    for (let hour = 0; hour < 24; hour++) {
      // Вечерний пик и ночной провал, как у типичного магазина.
      const count = Math.max(0, Math.round([0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 5, 6, 6, 4, 2][hour] * (1 + ((back * 7 + hour * 3) % 5 - 2) * 0.15)));
      for (let n = 0; n < count; n++) {
        const at = new Date(Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String((n * 13) % 60).padStart(2, '0')}:00Z`) - 3 * 3_600_000);
        if (back === 0 && hour * 60 + (n * 13) % 60 > nowMinutes) continue;
        // Часть заказов выкуплена примерно через сутки — в часы, когда забирают из пунктов выдачи.
        const bought = back > 0 && (n + hour) % 3 !== 0, boughtAt = new Date(at.getTime() + (20 + (hour * 5 + n) % 10) * 3_600_000);
        orders.push({ id: `demo-${date}-${hour}-${n}`, orderedAt: at.toISOString(), price: (900 + ((hour + n) % 4) * 350) * 100,
          ...(bought && boughtAt.getTime() <= Date.now() ? { rawStatus: 'buyout', createdAt: boughtAt.toISOString() } : { createdAt: at.toISOString() }) });
      }
    }
  }
  return orders;
}
async function hourlyOrders(id) {
  const now = new Date(Date.now() + 3 * 3_600_000), today = now.toISOString().slice(0, 10), nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const meta = { today, now: { hour: now.getUTCHours(), minute: now.getUTCMinutes() }, currency: 'RUB' };
  if (id === 'demo' || !cabinets().length) return { demo: true, ...meta, days: summarizeHourlyOrders(demoHourlyOrders(today, nowMinutes), today, nowMinutes) };
  // Та же лента за 31 день, что и у списка заказов; лишнее отсекается по времени оформления.
  const { feed, fetchedAt } = await orderFeedMonth(id, tokenFor(id));
  return { demo: false, ...meta, fetchedAt, currency: feed?.data?.currency || 'RUB', days: summarizeHourlyOrders(normalizeOrderFeed(feed), today, nowMinutes),
    warnings: (feed?.data?.orders || []).length >= ORDER_FEED_LIMIT ? [`WB отдал только первые ${ORDER_FEED_LIMIT} событий за 31 день — часть заказов могла не попасть`] : [] };
}

async function dashboard(id, from, to) {
  if (id === 'demo' || !cabinets().length) return demoDashboard();
  const token = tokenFor(id); const warnings = [];
  const safeFrom = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : dateDaysAgo(6);
  const safeTo = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : dateDaysAgo(0);
  const jobs = [
    wbRequest(token, 'https://marketplace-api.wildberries.ru/api/v3/orders/new').catch(e => (warnings.push(`FBS: ${e.message}`), { orders: [] })),
    orderFeedMonth(id, token).then(({ feed }) => feed).catch(e => (warnings.push(`Лента заказов: ${e.message}`), { data: { orders: [] } })),
    cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000)
      .catch(e => (warnings.push(`Карточки товаров: ${e.message}`), [])),
    cachedAnalytics(`balance:${id}`, () => wbRequest(token, 'https://finance-api.wildberries.ru/api/v1/account/balance'), 60_000)
      .catch(e => (warnings.push(`Баланс: ${e.message}`), null))
  ];
  const [fbs, orderFeed, cards, balance] = await Promise.all(jobs);
  if ((orderFeed?.data?.orders || []).length >= ORDER_FEED_LIMIT) {
    warnings.push(`Лента заказов: WB отдал только первые ${ORDER_FEED_LIMIT} событий за 31 день — часть заказов могла не попасть`);
  }
  if (safeFrom < addDays(moscowDate(), -30)) warnings.push('Лента заказов: WB отдаёт события только за последние 31 день — более ранних заказов в списке нет');
  const balanceHistory = balance ? saveBalanceSnapshot(id, balance) : (readBalanceHistory()[id] || []);
  // Новые FBS-задания в строки ленты не входят — для счётчика «Новые FBS» их число отдаётся отдельно.
  return { demo: false, orders: enrichOrders(normalizeOrders(fbs, orderFeedPeriod(orderFeed, safeFrom, safeTo)), cards), fbsNew: (fbs?.orders || []).length, funnel: extractFunnel({ data: { products: [] } }), funnelProducts: [], funnelHistory: [], funnelGroupedHistory: [],
    balance: balance ? { currency: balance.currency || 'RUB', current: Number(balance.current || 0),
      forWithdraw: Number(balance.for_withdraw || 0), history: balanceHistory } : null, warnings };
}

function stickerType(value) {
  return STICKER_TYPES.has(String(value || '')) ? String(value) : 'png';
}

function chunkOrders(orders = [], size = ORDER_STICKER_CHUNK) {
  const unique = [...new Set(orders.map(Number).filter(Number.isInteger))];
  const chunks = [];
  for (let offset = 0; offset < unique.length; offset += size) chunks.push(unique.slice(offset, offset + size));
  return chunks;
}

function demoStickerFile(title, subtitle) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="219" height="151" viewBox="0 0 219 151">` +
    `<rect width="219" height="151" fill="#ffffff" stroke="#1b1b1f"/>` +
    `<text x="14" y="36" font-family="Arial, sans-serif" font-size="17" font-weight="bold">${title}</text>` +
    `<text x="14" y="58" font-family="Arial, sans-serif" font-size="11">${subtitle}</text>` +
    `<rect x="14" y="72" width="128" height="52" fill="#1b1b1f"/>` +
    `<text x="152" y="104" font-family="Arial, sans-serif" font-size="12">ДЕМО</text></svg>`;
  return Buffer.from(svg, 'utf8').toString('base64');
}

function normalizeNewOrders(orders = [], cards = []) {
  const byChrt = stockCardIndex(cards);
  const rows = orders.map(order => {
    const meta = byChrt.get(String(order.chrtId)) || {};
    return {
      id: Number(order.id) || 0,
      rid: order.rid || '',
      orderUid: order.orderUid || '',
      nmId: Number(order.nmId || meta.nmId || 0) || '',
      chrtId: Number(order.chrtId || 0) || '',
      vendorCode: order.article || meta.vendorCode || '',
      name: meta.name || `Товар ${order.nmId || order.chrtId || ''}`,
      category: meta.category || 'Без категории',
      size: meta.size || '—',
      sku: (Array.isArray(order.skus) ? order.skus[0] : '') || meta.sku || '',
      photo: meta.photo || '',
      warehouseId: order.warehouseId || '',
      supplyId: order.supplyId || '',
      createdAt: order.createdAt || '',
      price: Number(order.convertedPrice ?? order.price ?? 0),
      currencyCode: Number(order.convertedCurrencyCode || order.currencyCode || 643),
      cargoType: Number(order.cargoType || 0),
      cargoTypeName: CARGO_TYPES[Number(order.cargoType || 0)] || 'Не указан',
      isZeroOrder: Boolean(order.isZeroOrder),
      isLargeVolume: Boolean(order.isLargeVolume),
      deliveryType: order.deliveryType || 'fbs'
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id - a.id);
  const categories = [...new Set(rows.map(row => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const warehouses = [...new Map(rows.filter(row => row.warehouseId)
    .map(row => [String(row.warehouseId), { id: row.warehouseId, name: `Склад ${row.warehouseId}` }])).values()]
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  return { rows, categories, warehouses,
    totals: { orders: rows.length, products: new Set(rows.map(row => String(row.nmId || row.chrtId))).size,
      amount: rows.reduce((sum, row) => sum + row.price, 0), assembled: rows.filter(row => row.supplyId).length,
      free: rows.filter(row => !row.supplyId).length } };
}

function demoNewOrders() {
  const now = Date.now();
  const cards = [
    { nmID: 100001, vendorCode: 'TSHIRT-BLACK', title: 'Футболка базовая', subjectName: 'Одежда', sizes: [{ chrtID: 501, techSize: 'M', skus: ['460000000001'] }] },
    { nmID: 100002, vendorCode: 'MUG-THERMO', title: 'Термокружка', subjectName: 'Посуда', sizes: [{ chrtID: 502, techSize: '500 мл', skus: ['460000000002'] }] },
    { nmID: 100003, vendorCode: 'HOODIE-GREEN', title: 'Худи Oversize', subjectName: 'Одежда', sizes: [{ chrtID: 503, techSize: 'L', skus: ['460000000003'] }] }
  ];
  const orders = Array.from({ length: 7 }, (_, index) => ({
    id: 9100500 + index, rid: `rid-demo-${index}`, orderUid: `uid-demo-${index}`,
    nmId: [100001, 100002, 100003][index % 3], chrtId: [501, 502, 503][index % 3],
    article: ['TSHIRT-BLACK', 'MUG-THERMO', 'HOODIE-GREEN'][index % 3], skus: [`46000000000${(index % 3) + 1}`],
    warehouseId: index % 2 ? 'demo-2' : 'demo-1', supplyId: index === 0 ? 'WB-GI-DEMO-1' : '',
    createdAt: new Date(now - index * 2_700_000).toISOString(), price: 129900 + index * 15000,
    convertedPrice: 129900 + index * 15000, currencyCode: 643, convertedCurrencyCode: 643, cargoType: 1
  }));
  return { demo: true, ...normalizeNewOrders(orders, cards), warnings: [] };
}

async function newFbsOrders(id) {
  if (id === 'demo' || !cabinets().length) return demoNewOrders();
  const token = tokenFor(id); const warnings = [];
  const response = await wbRequest(token, `${MARKETPLACE_API}/api/v3/orders/new`);
  const orders = Array.isArray(response?.orders) ? response.orders : [];
  const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000)
    .catch(error => (warnings.push(`Карточки товаров: ${error.message}`), []));
  return { demo: false, ...normalizeNewOrders(orders, cards), warnings };
}

function summarizeSupplies(supplies = []) {
  const rows = supplies.map(supply => ({
    id: supply.id || '', name: supply.name || 'Без названия', done: Boolean(supply.done),
    createdAt: supply.createdAt || '', closedAt: supply.closedAt || '', scanDt: supply.scanDt || '',
    cargoType: Number(supply.cargoType || 0), cargoTypeName: CARGO_TYPES[Number(supply.cargoType || 0)] || 'Не указан'
  })).sort((a, b) => Number(a.done) - Number(b.done) || new Date(b.createdAt) - new Date(a.createdAt));
  return { rows, totals: { supplies: rows.length, open: rows.filter(row => !row.done).length, closed: rows.filter(row => row.done).length } };
}

function demoSupplies() {
  return { demo: true, ...summarizeSupplies([
    { id: 'WB-GI-DEMO-1', name: 'Поставка на сегодня', done: false, createdAt: new Date(Date.now() - 3_600_000).toISOString(), cargoType: 1 },
    { id: 'WB-GI-DEMO-2', name: 'Вчерашняя отгрузка', done: true, createdAt: new Date(Date.now() - 90_000_000).toISOString(), closedAt: new Date(Date.now() - 86_400_000).toISOString(), cargoType: 1 }
  ]) };
}

async function supplyList(id) {
  if (id === 'demo' || !cabinets().length) return demoSupplies();
  const token = tokenFor(id); const limit = 1000; const collected = []; let next = 0;
  for (let page = 0; page < 20; page++) {
    const response = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies?limit=${limit}&next=${next}`);
    const batch = Array.isArray(response?.supplies) ? response.supplies : [];
    collected.push(...batch);
    if (batch.length < limit || response?.next === undefined || response.next === next) break;
    next = response.next;
  }
  return { demo: false, ...summarizeSupplies(collected) };
}

function normalizeTrbxes(trbxes = []) {
  return trbxes.map(trbx => {
    const list = Array.isArray(trbx.orderIds) ? trbx.orderIds : Array.isArray(trbx.orders) ? trbx.orders : [];
    return { id: trbx.id || '', orderIds: list.map(item => Number(item?.id ?? item)).filter(Number.isInteger) };
  })
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'ru', { numeric: true }));
}

async function supplyDetails(id, supplyId) {
  if (!supplyId) throw apiError(400, 'Не указана поставка');
  if (id === 'demo' || !cabinets().length) {
    const supply = demoSupplies().rows.find(row => row.id === supplyId) || { id: supplyId, name: 'Демо-поставка', done: false };
    const orders = demoNewOrders().rows.filter(row => row.supplyId === supplyId);
    return { demo: true, supply, orders, trbxes: normalizeTrbxes([{ id: 'WB-TRBX-DEMO-1', orderIds: orders.map(order => order.id) }]), warnings: [] };
  }
  const token = tokenFor(id); const warnings = [];
  const supply = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(supplyId)}`);
  // Старый метод списка заданий поставки WB удалил: теперь поставка отдаёт только номера заданий,
  // а сами задания ищутся в списке сборочных заданий за последние 30 дней.
  const orderIds = await wbRequest(token, `${MARKETPLACE_API}/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/order-ids`)
    .then(response => [...new Set((Array.isArray(response?.orderIds) ? response.orderIds : []).map(Number).filter(Number.isInteger))])
    .catch(error => (warnings.push(`Задания поставки: ${error.message}`), []));
  const foundOrders = orderIds.length ? await ordersByIds(token, orderIds).catch(error => (warnings.push(`Данные заданий: ${error.message}`), [])) : [];
  const trbxResponse = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(supplyId)}/trbx`)
    .catch(error => (warnings.push(`Грузоместа: ${error.message}`), { trbxes: [] }));
  const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000).catch(() => []);
  const byId = new Map(foundOrders.map(order => [String(order.id), order]));
  const orders = normalizeNewOrders(orderIds.map(orderId => byId.get(String(orderId)) || { id: orderId, supplyId }), cards).rows
    .map(row => byId.has(String(row.id)) ? row : { ...row, name: `Задание ${row.id}`, detailsMissing: true });
  if (orderIds.length > foundOrders.length) warnings.push(`Для ${orderIds.length - foundOrders.length} заданий WB не вернул данные: они старше 30 дней. Стикеры для них скачать можно.`);
  return { demo: false, supply: summarizeSupplies([supply]).rows[0], orders,
    trbxes: normalizeTrbxes(Array.isArray(trbxResponse?.trbxes) ? trbxResponse.trbxes : []), warnings };
}

async function ordersByIds(token, ids = []) {
  const wanted = new Set(ids.map(String)); const found = [];
  for (let next = 0, page = 0; wanted.size && page < ORDERS_LOOKUP_MAX_PAGES; page++) {
    if (page) await wait(250);
    const response = await wbRequest(token, `${MARKETPLACE_API}/api/v3/orders?limit=1000&next=${next}`);
    const batch = Array.isArray(response?.orders) ? response.orders : [];
    for (const order of batch) if (wanted.delete(String(order.id))) found.push(order);
    if (batch.length < 1000 || !response?.next) break;
    next = response.next;
  }
  return found;
}

async function createSupply(body) {
  const token = tokenFor(body.cabinet);
  const name = String(body.name || '').trim().slice(0, 128);
  if (!name) throw apiError(400, 'Введите название поставки');
  const response = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies`, { method: 'POST', body: { name } });
  return { ok: true, id: response?.id || '', name };
}

async function deleteSupply(body) {
  const token = tokenFor(body.cabinet);
  if (!body.supplyId) throw apiError(400, 'Не указана поставка');
  await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}`, { method: 'DELETE' });
  return { ok: true, supplyId: body.supplyId };
}

async function deliverSupply(body) {
  const token = tokenFor(body.cabinet);
  if (!body.supplyId) throw apiError(400, 'Не указана поставка');
  await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}/deliver`, { method: 'PATCH' });
  return { ok: true, supplyId: body.supplyId };
}

async function assembleOrders(body) {
  const token = tokenFor(body.cabinet);
  let supplyId = String(body.supplyId || '').trim();
  const created = !supplyId;
  if (created) supplyId = (await createSupply({ cabinet: body.cabinet, name: body.name })).id;
  if (!supplyId) throw apiError(400, 'Не удалось определить поставку');
  const orders = [...new Set((body.orders || []).map(Number).filter(Number.isInteger))];
  if (!orders.length) throw apiError(400, 'Выберите хотя бы одно сборочное задание');
  // WB принимает до 100 заданий за один запрос; старый метод по одному заданию удалён.
  const failed = []; let added = 0;
  for (let offset = 0; offset < orders.length; offset += SUPPLY_ORDERS_CHUNK) {
    if (offset) await wait(250);
    const chunk = orders.slice(offset, offset + SUPPLY_ORDERS_CHUNK);
    try {
      await wbRequest(token, `${MARKETPLACE_API}/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/orders`, { method: 'PATCH', body: { orders: chunk } });
      added += chunk.length;
    } catch (error) { chunk.forEach(orderId => failed.push({ orderId, message: error.message })); }
  }
  if (!added) throw apiError(400, `Ни одно задание не добавлено. ${failed[0]?.message || ''}`.trim());
  return { ok: true, supplyId, created, added, failed };
}

async function supplyBarcode(id, supplyId, type) {
  const safeType = stickerType(type);
  if (!supplyId) throw apiError(400, 'Не указана поставка');
  if (id === 'demo' || !cabinets().length) return { type: 'svg', barcode: supplyId, file: demoStickerFile(supplyId, 'QR-код поставки') };
  const token = tokenFor(id);
  const data = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(supplyId)}/barcode?type=${safeType}`);
  return { type: safeType, barcode: data?.barcode || supplyId, file: data?.file || '' };
}

async function createTrbx(body) {
  const token = tokenFor(body.cabinet);
  const amount = Number(body.amount);
  if (!body.supplyId) throw apiError(400, 'Не указана поставка');
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000) throw apiError(400, 'Количество грузомест — целое число от 1 до 1000');
  const response = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}/trbx`, { method: 'POST', body: { amount } });
  return { ok: true, trbxIds: Array.isArray(response?.trbxIds) ? response.trbxIds : [] };
}

async function deleteTrbx(body) {
  const token = tokenFor(body.cabinet);
  const trbxIds = (Array.isArray(body.trbxIds) ? body.trbxIds : []).map(String).filter(Boolean);
  if (!body.supplyId || !trbxIds.length) throw apiError(400, 'Выберите грузоместа для удаления');
  await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}/trbx`, { method: 'DELETE', body: { trbxIds } });
  return { ok: true, removed: trbxIds.length };
}

async function fillTrbx(body) {
  const token = tokenFor(body.cabinet);
  const orderIds = [...new Set((body.orders || []).map(Number).filter(Number.isInteger))];
  if (!body.supplyId || !body.trbxId) throw apiError(400, 'Не указано грузоместо');
  if (!orderIds.length) throw apiError(400, 'Выберите задания для грузоместа');
  await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}/trbx/${encodeURIComponent(body.trbxId)}`, { method: 'PATCH', body: { orderIds } });
  return { ok: true, trbxId: body.trbxId, added: orderIds.length };
}

async function removeOrderFromTrbx(body) {
  const token = tokenFor(body.cabinet);
  if (!body.supplyId || !body.trbxId || !Number.isInteger(Number(body.orderId))) throw apiError(400, 'Не указано задание');
  await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}/trbx/${encodeURIComponent(body.trbxId)}/orders/${Number(body.orderId)}`, { method: 'DELETE' });
  return { ok: true };
}

async function trbxStickers(body) {
  const type = stickerType(body.type);
  const trbxIds = (Array.isArray(body.trbxIds) ? body.trbxIds : []).map(String).filter(Boolean);
  if (!body.supplyId || !trbxIds.length) throw apiError(400, 'Выберите грузоместа');
  if (body.cabinet === 'demo' || !cabinets().length) {
    return { type: 'svg', stickers: trbxIds.map(trbxId => ({ trbxId, file: demoStickerFile(trbxId, 'QR-код грузоместа') })) };
  }
  const token = tokenFor(body.cabinet);
  const data = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}/trbx/stickers?type=${type}`, { method: 'POST', body: { trbxIds } });
  return { type, stickers: Array.isArray(data?.stickers) ? data.stickers : [] };
}

async function orderStickers(body) {
  const type = stickerType(body.type);
  const chunks = chunkOrders(body.orders);
  if (!chunks.length) throw apiError(400, 'Выберите хотя бы одно сборочное задание');
  if (body.cabinet === 'demo' || !cabinets().length) {
    return { type: 'svg', stickers: chunks.flat().map(orderId => ({ orderId, file: demoStickerFile(`Задание ${orderId}`, 'Стикер товара') })) };
  }
  const token = tokenFor(body.cabinet); const stickers = [];
  for (const [index, chunk] of chunks.entries()) {
    if (index) await wait(400);
    const data = await wbRequest(token, `${MARKETPLACE_API}/api/v3/orders/stickers?type=${type}&width=58&height=40`, { method: 'POST', body: { orders: chunk } });
    stickers.push(...(Array.isArray(data?.stickers) ? data.stickers : []));
  }
  return { type, stickers };
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname.startsWith('/api/photo/')) return servePhoto(res, url);
  if (req.method === 'GET' && url.pathname === '/api/cabinets') return send(res, 200, { cabinets: publicCabinets(), demo: !cabinets().length });
  if (req.method === 'PATCH' && /^\/api\/cabinets\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    if (!cabinets().some(c => c.id === id)) throw apiError(404, 'Кабинет не найден');
    const { name } = await readJson(req); const clean = String(name || '').trim().slice(0, 60);
    if (!clean) throw apiError(400, 'Введите название кабинета');
    const aliases = readAliases(); aliases[id] = clean;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(aliases, null, 2));
    return send(res, 200, { id, name: clean });
  }
  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    return send(res, 200, await dashboard(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && url.pathname === '/api/price-history') {
    return send(res, 200, priceHistory(url.searchParams.get('nmId')));
  }
  if (req.method === 'GET' && url.pathname === '/api/price-snapshots') {
    return send(res, 200, priceSnapshotsStatus());
  }
  if (req.method === 'POST' && url.pathname === '/api/price-snapshots/take') {
    const body = await readJson(req);
    return send(res, 200, await takePriceSnapshot(body.cabinet || 'demo'));
  }
  if (req.method === 'POST' && url.pathname === '/api/price-snapshots/sync') {
    await syncPriceSnapshots();
    return send(res, 200, priceSnapshotsStatus());
  }
  if (req.method === 'GET' && url.pathname === '/api/ratings') {
    return send(res, 200, await itemRatings(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && url.pathname === '/api/orders/hourly') {
    return send(res, 200, await hourlyOrders(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'GET' && url.pathname === '/api/summary') {
    return send(res, 200, await summary(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to'), url.searchParams.get('refresh') === '1'));
  }
  if (req.method === 'GET' && url.pathname === '/api/summary/ads') {
    return send(res, 200, await summaryAds(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign') {
    return send(res, 200, await advertisingCampaign(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id'), url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign/positions') {
    return send(res, 200, await campaignPositions(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id'), url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && url.pathname === '/api/keyword-tags') {
    return send(res, 200, keywordTags(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id')));
  }
  if (req.method === 'POST' && url.pathname === '/api/keyword-tags') {
    const body = await readJson(req);
    return send(res, 200, setKeywordTag(body.cabinet || 'demo', body.id, body));
  }
  if (req.method === 'POST' && url.pathname === '/api/keyword-tags/note') {
    const body = await readJson(req);
    return send(res, 200, setKeywordNote(body.cabinet || 'demo', body.id, body));
  }
  if (req.method === 'POST' && url.pathname === '/api/keyword-tags/colors') {
    const body = await readJson(req);
    return send(res, 200, setKeywordTagColors(body.colors));
  }
  if (req.method === 'POST' && url.pathname === '/api/advertising/campaign/keyword-daily') {
    const body = await readJson(req);
    return send(res, 200, await campaignKeywordDaily(body.cabinet || 'demo', body.id, body.from, body.to, body.query, body.nmIds));
  }
  if (req.method === 'POST' && url.pathname === '/api/advertising/campaign/minus') {
    const body = await readJson(req);
    const result = await campaignMinus(body.cabinet || 'demo', body.id, body.action, body.queries, body.nmIds);
    const changed = [...new Set(result.results.filter(item => item.ok && item.changed).flatMap(item => item.queries))];
    try { recordKeywordStatus(body.cabinet || 'demo', body.id, result.action, changed); } catch (error) { console.error('История статусов фраз не записалась:', error.message); }
    return send(res, 200, result);
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign/keywords') {
    return send(res, 200, await campaignKeywords(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id'),
      url.searchParams.get('from'), url.searchParams.get('to'), url.searchParams.get('refresh') === '1'));
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign/history') {
    // Ответ идёт построчно: события прогресса, затем итог или ошибка.
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    const write = event => res.write(`${JSON.stringify(event)}\n`);
    try {
      const result = await advertisingCampaignHistory(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id'),
        url.searchParams.get('from'), url.searchParams.get('to'), write);
      write({ type: 'result', ...result });
    } catch (error) {
      write({ type: 'error', error: error.message || 'Не удалось выгрузить статистику' });
    }
    return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/previous') {
    return send(res, 200, await advertisingPrevious(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising') {
    return send(res, 200, await advertising(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to'), url.searchParams.get('part') || 'all'));
  }
  if (req.method === 'POST' && url.pathname === '/api/funnel/sales') {
    const body = await readJson(req);
    return send(res, 200, await funnelSales(body.cabinet || 'demo', body.from, body.to, body.nmIds, body.metric));
  }
  if (req.method === 'POST' && url.pathname === '/api/funnel/history') {
    const body = await readJson(req);
    return send(res, 200, await funnelHistory(body.cabinet || 'demo', body.from, body.to, body.grouping, body.nmIds));
  }
  if (req.method === 'POST' && url.pathname === '/api/funnel/refetch') {
    const body = await readJson(req);
    return send(res, 200, refetchFunnel(body.cabinet || 'demo', body.from, body.to, body.grouping));
  }
  if (req.method === 'GET' && url.pathname === '/api/funnel/history') {
    return send(res, 200, await funnelHistory(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to'), url.searchParams.get('grouping')));
  }
  if (req.method === 'GET' && url.pathname === '/api/funnel') {
    return send(res, 200, await funnelDetails(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && url.pathname === '/api/fbs-stocks') {
    return send(res, 200, await fbsStocks(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'GET' && url.pathname === '/api/fbw-stocks') {
    return send(res, 200, await fbwStocks(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'GET' && url.pathname === '/api/prices') {
    return send(res, 200, await prices(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'GET' && url.pathname === '/api/prices/stocks') {
    return send(res, 200, await priceStocks(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'POST' && url.pathname === '/api/prices/update') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите изменение цен и скидок');
    return send(res, 200, await updatePrices(body));
  }
  if (req.method === 'GET' && url.pathname === '/api/stock-presets') {
    return send(res, 200, { presets: cabinetPresets(STOCK_PRESETS_FILE, url.searchParams.get('cabinet') || 'demo') });
  }
  if (req.method === 'POST' && url.pathname === '/api/stock-presets') {
    const body = await readJson(req);
    return send(res, 200, savePreset(STOCK_PRESETS_FILE, body.cabinet, body.preset, normalizeStockPreset));
  }
  if (req.method === 'DELETE' && url.pathname === '/api/stock-presets') {
    return send(res, 200, removePreset(STOCK_PRESETS_FILE, url.searchParams.get('cabinet') || '', url.searchParams.get('id') || ''));
  }
  if (req.method === 'GET' && url.pathname === '/api/price-presets') {
    return send(res, 200, { presets: cabinetPresets(PRICE_PRESETS_FILE, url.searchParams.get('cabinet') || 'demo') });
  }
  if (req.method === 'POST' && url.pathname === '/api/price-presets') {
    const body = await readJson(req);
    return send(res, 200, savePreset(PRICE_PRESETS_FILE, body.cabinet, body.preset, normalizePricePreset));
  }
  if (req.method === 'DELETE' && url.pathname === '/api/price-presets') {
    return send(res, 200, removePreset(PRICE_PRESETS_FILE, url.searchParams.get('cabinet') || '', url.searchParams.get('id') || ''));
  }
  if (req.method === 'POST' && url.pathname === '/api/fbs-stocks/update') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите изменение остатков');
    return send(res, 200, await updateFbsStocks(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/fbs-stocks/copy') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите копирование остатков');
    return send(res, 200, await copyFbsStocks(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/orders/stickers') {
    return send(res, 200, await orderStickers(await readJson(req)));
  }
  if (req.method === 'GET' && url.pathname === '/api/fbs-orders') {
    return send(res, 200, await newFbsOrders(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'GET' && url.pathname === '/api/supplies') {
    return send(res, 200, await supplyList(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'GET' && url.pathname === '/api/supplies/detail') {
    return send(res, 200, await supplyDetails(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id')));
  }
  if (req.method === 'GET' && url.pathname === '/api/supplies/barcode') {
    return send(res, 200, await supplyBarcode(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id'), url.searchParams.get('type')));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите создание поставки');
    return send(res, 200, await createSupply(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/delete') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите удаление поставки');
    return send(res, 200, await deleteSupply(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/deliver') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите передачу поставки в доставку');
    return send(res, 200, await deliverSupply(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/orders') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите сборку заданий');
    return send(res, 200, await assembleOrders(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/trbx') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите добавление грузомест');
    return send(res, 200, await createTrbx(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/trbx/delete') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите удаление грузомест');
    return send(res, 200, await deleteTrbx(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/trbx/orders') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите раскладку заданий по грузоместам');
    return send(res, 200, await fillTrbx(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/trbx/orders/remove') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите удаление задания из грузоместа');
    return send(res, 200, await removeOrderFromTrbx(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/trbx/stickers') {
    return send(res, 200, await trbxStickers(await readJson(req)));
  }
  throw apiError(404, 'Метод сайта не найден');
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.resolve(PUBLIC_DIR, '.' + decodeURIComponent(requested));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url); else serveStatic(req, res, url);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${url.pathname}: ${error.message}`);
    send(res, error.status || 500, { error: error.message || 'Внутренняя ошибка', details: error.details });
  }
});

if (require.main === module) server.listen(PORT, '127.0.0.1', () => {
  console.log(`WB Analytics: http://127.0.0.1:${PORT}`);
  // Снимки цен с GitHub: сразу после запуска и потом раз в час.
  setTimeout(syncPriceSnapshots, 5_000);
  setInterval(syncPriceSnapshots, 60 * 60_000);
});

module.exports = { server, cabinets, campaignActivePeriod, mergeMinusList, buildPriceHistory, summarizeHourlyOrders, orderFeedPeriod, itemRatingPeriods, normalizeItemRatings, summarizeKeywordDaily, summarizePositionDaily, normalizeOrders, normalizeOrderFeed, enrichOrders, extractFunnel, summarizeAdStats, campaignProductDaily, withAdBudgets, summarizeKeywords, normalizeStockPreset, normalizePricePreset, adCampaignMayHaveStats, validAdPeriod, historyPeriod, historyChunks, planAdFetch, datesBetween, safeFolderName, funnelDaysToFetch, pairFunnelDays, funnelPeriods, funnelRangeBuckets, funnelRecordCounts, funnelRangeValues, funnelSalesMatrix, summaryTopProducts, summaryDrops, summaryProducts, normalizeFbsStocks, normalizeFbwStocks, normalizePrices, summarizeStockTotals, normalizeNewOrders, summarizeSupplies, normalizeTrbxes, chunkOrders, stickerType, localPhoto, WB_HOSTS };





