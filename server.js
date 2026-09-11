'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 4173);
const DATA_FILE = path.join(ROOT, 'data', 'cabinets.json');
const STATISTICS_FILE = path.join(ROOT, 'statistics.json');
const BALANCE_HISTORY_FILE = path.join(ROOT, 'data', 'balance-history.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
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
const CARGO_TYPES = { 0: 'Не указан', 1: 'Обычный', 2: 'СГТ', 3: 'КГТ' };
const STOCK_PRESETS_FILE = path.join(ROOT, 'data', 'stock-presets.json');
const PRICE_PRESETS_FILE = path.join(ROOT, 'data', 'price-presets.json');
const PRESET_MAX_ITEMS = 200;
const PRESET_MAX_COUNT = 50;
const STOCK_PRESET_MAX_AMOUNT = 100_000;
const PRICE_PRESET_MAX_PRICE = 1_000_000;
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
      throw apiError(response.status, message, data);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw apiError(504, 'WB API не ответил за 25 секунд');
    throw error;
  } finally { clearTimeout(timeout); }
}

function dateDaysAgo(days) {
  const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString().slice(0, 10);
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function cachedAnalytics(key, loader, ttl = 60_000) {
  const cached = analyticsCache.get(key);
  if (cached && Date.now() - cached.savedAt < ttl) return cached.value;
  try {
    const value = await loader();
    analyticsCache.set(key, { value, savedAt: Date.now() });
    return value;
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
  return photo.c246x328 || photo.tm || photo.square || photo.big || '';
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

async function fbwStocks(id) {
  if (id === 'demo' || !cabinets().length) return demoFbwStocks();
  const token = tokenFor(id); const limit = 250000; const items = [];
  for (let offset = 0; ; offset += limit) {
    const response = await wbRequest(token, 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses',
      { method: 'POST', body: { nmIds: [], chrtIds: [], limit, offset } });
    const batch = Array.isArray(response?.data?.items) ? response.data.items : Array.isArray(response?.items) ? response.items : [];
    items.push(...batch);
    if (batch.length < limit) break;
    await wait(20_100);
  }
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

async function prices(id) {
  if (id === 'demo' || !cabinets().length) return demoPrices();
  const token = tokenFor(id); const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000); const goods = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const response = await wbRequest(token, `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=${offset}`);
    const batch = Array.isArray(response?.data?.listGoods) ? response.data.listGoods : []; goods.push(...batch);
    if (batch.length < 1000) break; await wait(650);
  }
  return { demo: false, ...normalizePrices(goods, cards), warnings: [] };
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
    status: order.status === 'buyout' ? 'complete' : order.status === 'cancel' ? 'cancel' : 'new',
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

function normalizeOrders(fbs, orderFeed) {
  const a = (fbs?.orders || []).map(o => ({
    id: o.id, nmId: o.nmId, article: o.article || o.vendorCode || `№ ${o.id}`, name: o.article || `Товар ${o.nmId}`,
    status: 'new', createdAt: o.createdAt || o.createdDate, price: o.convertedFinalPrice ?? o.finalPrice ?? o.convertedPrice ?? o.price,
    currencyCode: o.convertedCurrencyCode || o.currencyCode, warehouse: o.warehouseId ? `Склад ${o.warehouseId}` : '—', source: 'FBS'
  }));
  const b = normalizeOrderFeed(orderFeed);
  return [...a, ...b].sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
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
    cr: safeRatio(orders, clicks), drr: safeRatio(spend, revenue), roas: safeRatio(revenue, spend, 1)
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
    cpm: safeRatio(target.spend, target.views, 1000), cr: safeRatio(target.orders, target.clicks),
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
      updatedAt: campaign?.timestamps?.updated || '', nmIds, daily: (stat.days || []).map(day => ({ date: String(day.date || '').slice(0, 10), ...adMetrics(day) })), ...adMetrics(stat) });
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
      paymentType: campaign.settings?.payment_type || '', bidType: campaign.bid_type || '', updatedAt: campaign.timestamps?.updated || '', nmIds: campaignProductIds(campaign),
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
    { id: 101, status: 9, type: 9, bid_type: 'manual', settings: { name: 'Поиск · базовая коллекция', payment_type: 'cpm' } },
    { id: 102, status: 11, type: 8, bid_type: 'unified', settings: { name: 'Автокампания · хиты', payment_type: 'cpm' } },
    { id: 103, status: 7, type: 5, bid_type: 'manual', settings: { name: 'Карточка товара · новинки', payment_type: 'cpc' } }
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
  const safeFrom = pattern.test(from || '') ? from : dateDaysAgo(7);
  const days = Math.floor((new Date(`${safeTo}T00:00:00Z`) - new Date(`${safeFrom}T00:00:00Z`)) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1) throw apiError(400, 'Начало периода должно быть раньше окончания');
  if (days > 31) throw apiError(400, 'Для рекламы выберите период не более 31 дня — это ограничение WB API');
  return { from: safeFrom, to: safeTo };
}

function advertisingPeriod(months = 6) {
  const to = new Date(); to.setUTCHours(0, 0, 0, 0);
  const safeMonths = Math.min(6, Math.max(1, Number(months) || 6));
  const from = new Date(to); from.setUTCMonth(from.getUTCMonth() - safeMonths); from.setUTCDate(from.getUTCDate() + 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

async function advertisingCampaignHistory(id, campaignId, months = 6) {
  const whole = advertisingPeriod(months);
  const daily = new Map(); const productDaily = new Map(); let campaign = null;
  for (let cursor = new Date(`${whole.from}T00:00:00Z`); cursor <= new Date(`${whole.to}T00:00:00Z`); ) {
    const chunkFrom = cursor.toISOString().slice(0, 10);
    const chunkEnd = new Date(cursor); chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 30);
    const chunkTo = chunkEnd > new Date(`${whole.to}T00:00:00Z`) ? whole.to : chunkEnd.toISOString().slice(0, 10);
    const data = await advertising(id, chunkFrom, chunkTo);
    campaign = (data.campaigns || []).find(item => String(item.id) === String(campaignId)) || campaign;
    for (const row of (data.campaign?.id ? [data.campaign] : data.campaigns || [])) {
      if (String(row.id) !== String(campaignId)) continue;
      for (const day of row.daily || []) daily.set(day.date, day);
    }
    for (const row of campaignProductDaily(data.productDaily || [], campaignId, campaign?.nmIds || [])) {
      const key = `${row.nmId}:${row.date}`; if (!productDaily.has(key)) productDaily.set(key, row);
    }
    cursor = new Date(chunkEnd); cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor <= new Date(`${whole.to}T00:00:00Z`) && id !== 'demo') await wait(21_000);
  }
  if (!campaign) throw apiError(404, 'Кампания не найдена');
  const result = { generatedAt: new Date().toISOString(), cabinet: id, campaignId, period: whole,
    campaign: { ...campaign, daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)) },
    productDaily: [...productDaily.values()].sort((a, b) => (String(a.date)+":"+String(a.nmId)).localeCompare(String(b.date)+":"+String(b.nmId))) };
  fs.mkdirSync(path.dirname(STATISTICS_FILE), { recursive: true });
  fs.writeFileSync(STATISTICS_FILE, JSON.stringify(result, null, 2));
  return { ...result, file: 'statistics.json' };
}
async function advertisingCampaign(id, campaignId, from, to) {
  const summary = await advertising(id, from, to);
  const campaign = (summary.campaigns || []).find(item => String(item.id) === String(campaignId));
  if (!campaign) throw apiError(404, 'Кампания не найдена за выбранный период');
  const productDaily = campaignProductDaily(summary.productDaily || [], campaignId, campaign.nmIds || []);
  return { period: summary.period, campaign, productDaily };
}
async function advertising(id, from, to) {
  const period = validAdPeriod(from, to);
  if (id === 'demo' || !cabinets().length) return demoAds(period.from, period.to);
  const token = tokenFor(id); const warnings = [];
  const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token,
    'https://advert-api.wildberries.ru/api/advert/v2/adverts?statuses=7,9,11'), 3 * 60_000);
  const campaigns = Array.isArray(campaignData?.adverts) ? campaignData.adverts : [];
  const stats = [];
  for (let offset = 0; offset < campaigns.length; offset += 50) {
    if (offset) await wait(20_100);
    const ids = campaigns.slice(offset, offset + 50).map(item => item.id).join(',');
    if (!ids) continue;
    try {
      const chunk = await cachedAnalytics(`ad-stats:${id}:${period.from}:${period.to}:${ids}`, () => wbRequest(token,
        `https://advert-api.wildberries.ru/adv/v3/fullstats?ids=${ids}&beginDate=${period.from}&endDate=${period.to}`), 3 * 60_000);
      if (Array.isArray(chunk)) stats.push(...chunk);
    } catch (error) { warnings.push(`Статистика рекламы: ${error.message}`); }
  }
  const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000);
  const budgets = await advertBudgets(id, token, campaigns, warnings);
  const summary = enrichAdvertising(summarizeAdStats(campaigns, stats, period.from, period.to), cards);
  return { demo: false, ...summary, campaigns: withAdBudgets(summary.campaigns, budgets), warnings };
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

async function funnelDetails(id, from, to) {
  if (id === 'demo' || !cabinets().length) return { products: [], history: [], groupedHistory: [] };
  const token = tokenFor(id); const start = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : dateDaysAgo(7); const end = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : dateDaysAgo(0);
  const body = { selectedPeriod: { start, end }, nmIds: [], skipDeletedNm: true, orderBy: { field: 'openCard', mode: 'desc' }, limit: 1000, offset: 0 };
  const response = await wbRequest(token, 'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products', { method: 'POST', body });
  const products = enrichFunnelProducts(response?.data?.products || response?.products || [],
    await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000).catch(() => []));
  let groupedHistory = [];
  try {
    const groupedResponse = await wbRequest(token, 'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/grouped/history', { method: 'POST', body: { selectedPeriod: { start, end }, brandNames: [], subjectIds: [], tagIds: [], skipDeletedNm: true, aggregationLevel: 'day' } });
    groupedHistory = Array.isArray(groupedResponse) ? groupedResponse : groupedResponse?.data || [];
  } catch { groupedHistory = []; }
  return { products, history: groupedHistory, groupedHistory };
}

async function dashboard(id, from, to) {
  if (id === 'demo' || !cabinets().length) return demoDashboard();
  const token = tokenFor(id); const warnings = [];
  const safeFrom = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : dateDaysAgo(7);
  const safeTo = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : dateDaysAgo(0);
  const jobs = [
    wbRequest(token, 'https://marketplace-api.wildberries.ru/api/v3/orders/new').catch(e => (warnings.push(`FBS: ${e.message}`), { orders: [] })),
    cachedAnalytics(`order-feed:${id}:${safeFrom}:${safeTo}`, () => wbRequest(token, 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/order-feed', { method: 'POST', body: {
      selectedPeriod: { start: `${safeFrom}T00:00:00Z`, end: `${safeTo}T23:59:59Z` }
    }})).catch(e => (warnings.push(`Лента заказов: ${e.message}`), { data: { orders: [] } })),
    cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000)
      .catch(e => (warnings.push(`Карточки товаров: ${e.message}`), [])),
    cachedAnalytics(`balance:${id}`, () => wbRequest(token, 'https://finance-api.wildberries.ru/api/v1/account/balance'), 60_000)
      .catch(e => (warnings.push(`Баланс: ${e.message}`), null))
  ];
  const [fbs, orderFeed, cards, balance] = await Promise.all(jobs);
  const balanceHistory = balance ? saveBalanceSnapshot(id, balance) : (readBalanceHistory()[id] || []);
  return { demo: false, orders: enrichOrders(normalizeOrders(fbs, orderFeed), cards), funnel: extractFunnel({ data: { products: [] } }), funnelProducts: [], funnelHistory: [], funnelGroupedHistory: [],
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
  return trbxes.map(trbx => ({ id: trbx.id || '', orderIds: (Array.isArray(trbx.orderIds) ? trbx.orderIds : []).map(Number).filter(Number.isInteger) }))
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
  const ordersResponse = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(supplyId)}/orders`)
    .catch(error => (warnings.push(`Задания поставки: ${error.message}`), { orders: [] }));
  const trbxResponse = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(supplyId)}/trbx`)
    .catch(error => (warnings.push(`Грузоместа: ${error.message}`), { trbxes: [] }));
  const cards = await cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000).catch(() => []);
  const orders = normalizeNewOrders(Array.isArray(ordersResponse?.orders) ? ordersResponse.orders : [], cards).rows;
  return { demo: false, supply: summarizeSupplies([supply]).rows[0], orders,
    trbxes: normalizeTrbxes(Array.isArray(trbxResponse?.trbxes) ? trbxResponse.trbxes : []), warnings };
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
  const failed = []; let added = 0;
  for (const [index, orderId] of orders.entries()) {
    if (index && index % 50 === 0) await wait(400);
    try {
      await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(supplyId)}/orders/${orderId}`, { method: 'PATCH' });
      added++;
    } catch (error) { failed.push({ orderId, message: error.message }); }
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
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign') {
    return send(res, 200, await advertisingCampaign(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id'), url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign/history') {
    return send(res, 200, await advertisingCampaignHistory(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id'), url.searchParams.get('months')));
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising') {
    return send(res, 200, await advertising(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to')));
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
  if (req.method === 'POST' && url.pathname === '/api/prices/update') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите изменение цен и скидок');
    return send(res, 200, await updatePrices(body));
  }
  if (req.method === 'GET' && url.pathname === '/api/stock-presets') {
    return send(res, 200, { presets: readPresets(STOCK_PRESETS_FILE)[url.searchParams.get('cabinet') || 'demo'] || [] });
  }
  if (req.method === 'POST' && url.pathname === '/api/stock-presets') {
    const body = await readJson(req);
    return send(res, 200, savePreset(STOCK_PRESETS_FILE, body.cabinet, body.preset, normalizeStockPreset));
  }
  if (req.method === 'DELETE' && url.pathname === '/api/stock-presets') {
    return send(res, 200, removePreset(STOCK_PRESETS_FILE, url.searchParams.get('cabinet') || '', url.searchParams.get('id') || ''));
  }
  if (req.method === 'GET' && url.pathname === '/api/price-presets') {
    return send(res, 200, { presets: readPresets(PRICE_PRESETS_FILE)[url.searchParams.get('cabinet') || 'demo'] || [] });
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
  if (req.method === 'POST' && url.pathname === '/api/orders/status') {
    const body = await readJson(req); const token = tokenFor(body.cabinet);
    return send(res, 200, await wbRequest(token, 'https://marketplace-api.wildberries.ru/api/v3/orders/status', { method: 'POST', body: { orders: body.orders } }));
  }
  const cancel = url.pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
  if (req.method === 'PATCH' && cancel) {
    const body = await readJson(req); const token = tokenFor(body.cabinet);
    await wbRequest(token, `https://marketplace-api.wildberries.ru/api/v3/orders/${cancel[1]}/cancel`, { method: 'PATCH', body: {} });
    return send(res, 200, { ok: true });
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
  if (req.method === 'POST' && url.pathname === '/api/proxy') {
    const body = await readJson(req); const token = tokenFor(body.cabinet);
    if (!body.confirm && !['GET'].includes(String(body.method).toUpperCase())) throw apiError(400, 'Подтвердите изменяющий запрос');
    return send(res, 200, await wbRequest(token, body.url, { method: body.method, body: body.body }));
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

if (require.main === module) server.listen(PORT, '127.0.0.1', () => console.log(`WB Analytics: http://127.0.0.1:${PORT}`));

module.exports = { server, cabinets, normalizeOrders, normalizeOrderFeed, enrichOrders, extractFunnel, summarizeAdStats, campaignProductDaily, withAdBudgets, normalizeStockPreset, normalizePricePreset, validAdPeriod, advertisingPeriod, normalizeFbsStocks, normalizeFbwStocks, normalizePrices, normalizeNewOrders, summarizeSupplies, normalizeTrbxes, chunkOrders, stickerType, WB_HOSTS };





