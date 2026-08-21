'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 4173);
const DATA_FILE = path.join(ROOT, 'data', 'cabinets.json');
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

function stockCardIndex(cards = []) {
  const index = new Map();
  for (const card of cards) for (const size of card.sizes || []) {
    const chrtId = String(size.chrtID || size.chrtId || '');
    if (!chrtId) continue;
    index.set(chrtId, { nmId: card.nmID, vendorCode: card.vendorCode || '', name: card.title || `Товар ${card.nmID}`,
      category: card.subjectName || 'Без категории', size: size.techSize || size.wbSize || '—', sku: (size.skus || [])[0] || '',
      photo: card.photos?.[0]?.c246x328 || card.photos?.[0]?.tm || card.photos?.[0]?.square || card.photos?.[0]?.big || '' });
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

function normalizePrices(goods = [], cards = []) {
  const byNmId = new Map(cards.map(card => [String(card.nmID), card]));
  const rows = goods.map(good => {
    const card = byNmId.get(String(good.nmID)) || {}; const sizes = Array.isArray(good.sizes) ? good.sizes : []; const firstSize = sizes[0] || {};
    return { nmId: Number(good.nmID), vendorCode: good.vendorCode || card.vendorCode || '', name: card.title || `Товар ${good.nmID}`,
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
    const photo = card.photos?.[0];
    return { ...order, name: card.title || order.name, article: card.vendorCode || order.article,
      brand: card.brand || '', subjectName: card.subjectName || '',
      photo: photo?.c246x328 || photo?.tm || photo?.square || photo?.big || '' };
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
  return { demo: true, orders, funnel: { views: 14840, cart: 3180, orders: 1246, sales: 982, revenue: 1762400, currency: 'RUB' }, warnings: [] };
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

function summarizeAdStats(campaigns = [], stats = [], from, to) {
  const campaignById = new Map(campaigns.map(item => [String(item.id), item]));
  const daily = new Map();
  for (let cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10); daily.set(date, emptyAdMetrics({ date }));
  }
  const platforms = new Map([[1, emptyAdMetrics({ id: 1, name: 'Сайт' })], [32, emptyAdMetrics({ id: 32, name: 'Android' })], [64, emptyAdMetrics({ id: 64, name: 'iOS' })]]);
  const products = new Map();
  const rows = [];
  for (const stat of stats) {
    const campaign = campaignById.get(String(stat.advertId));
    rows.push({ id: stat.advertId, name: campaign?.settings?.name || `Кампания #${stat.advertId}`,
      status: campaign?.status, paymentType: campaign?.settings?.payment_type || '', bidType: campaign?.bid_type || '',
      updatedAt: campaign?.timestamps?.updated || '', ...adMetrics(stat) });
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
        }
      }
    }
  }
  for (const campaign of campaigns) {
    if (!rows.some(row => String(row.id) === String(campaign.id))) rows.push({ id: campaign.id,
      name: campaign.settings?.name || `Кампания #${campaign.id}`, status: campaign.status,
      paymentType: campaign.settings?.payment_type || '', bidType: campaign.bid_type || '', updatedAt: campaign.timestamps?.updated || '',
      ...finalizeAdMetrics(emptyAdMetrics()) });
  }
  const total = emptyAdMetrics(); rows.forEach(row => addAdMetrics(total, row));
  return { period: { from, to }, totals: finalizeAdMetrics(total),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map(finalizeAdMetrics),
    campaigns: rows.map(finalizeAdMetrics).sort((a, b) => b.spend - a.spend),
    platforms: [...platforms.values()].map(finalizeAdMetrics).sort((a, b) => b.spend - a.spend),
    products: [...products.values()].map(finalizeAdMetrics).sort((a, b) => b.spend - a.spend).slice(0, 100) };
}

function demoAds(from, to) {
  const campaigns = [
    { id: 101, status: 9, bid_type: 'manual', settings: { name: 'Поиск · базовая коллекция', payment_type: 'cpm' } },
    { id: 102, status: 11, bid_type: 'unified', settings: { name: 'Автокампания · хиты', payment_type: 'cpm' } },
    { id: 103, status: 7, bid_type: 'manual', settings: { name: 'Карточка товара · новинки', payment_type: 'cpc' } }
  ];
  const stats = campaigns.map((campaign, campaignIndex) => {
    const days = [];
    for (let cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`), index = 0; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1), index++) {
      const views = 5200 + campaignIndex * 1700 + index * 260, clicks = Math.round(views * (0.025 + campaignIndex * .006));
      const spend = Math.round((clicks * (13 + campaignIndex * 4)) * 100) / 100, orders = Math.round(clicks * (.08 + campaignIndex * .015));
      const revenue = orders * (1750 + campaignIndex * 410);
      days.push({ date: cursor.toISOString(), views, clicks, sum: spend, orders, sum_price: revenue,
        atbs: Math.round(clicks * .23), shks: Math.round(orders * .78), canceled: campaignIndex === 2 && index % 4 === 0 ? 1 : 0,
        apps: [{ appType: 1, views: Math.round(views * .18), clicks: Math.round(clicks * .18), sum: spend * .18, orders: Math.round(orders * .18), sum_price: revenue * .18 },
          { appType: 32, views: Math.round(views * .52), clicks: Math.round(clicks * .52), sum: spend * .52, orders: Math.round(orders * .52), sum_price: revenue * .52 },
          { appType: 64, views: Math.round(views * .30), clicks: Math.round(clicks * .30), sum: spend * .30, orders: Math.round(orders * .30), sum_price: revenue * .30 }] });
    }
    const total = emptyAdMetrics(); days.forEach(day => addAdMetrics(total, day));
    return { advertId: campaign.id, sum: total.spend, sum_price: total.revenue, atbs: total.carts, shks: total.sales,
      views: total.views, clicks: total.clicks, orders: total.orders, canceled: total.canceled, days };
  });
  return { demo: true, ...summarizeAdStats(campaigns, stats, from, to), warnings: [] };
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
  return { demo: false, ...summarizeAdStats(campaigns, stats, period.from, period.to), warnings };
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
    cachedAnalytics(`sales-funnel:${id}:${safeFrom}:${safeTo}`, () => wbRequest(token, 'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products', { method: 'POST', body: {
      selectedPeriod: { start: safeFrom, end: safeTo }, nmIds: [], skipDeletedNm: true,
      orderBy: { field: 'openCard', mode: 'desc' }, limit: 1000, offset: 0
    }})).catch(e => (warnings.push(`Воронка: ${e.message}`), { data: { products: [] } })),
    cachedAnalytics(`product-cards:${id}`, () => loadProductCards(token), 10 * 60_000)
      .catch(e => (warnings.push(`Карточки товаров: ${e.message}`), [])),
    cachedAnalytics(`balance:${id}`, () => wbRequest(token, 'https://finance-api.wildberries.ru/api/v1/account/balance'), 60_000)
      .catch(e => (warnings.push(`Баланс: ${e.message}`), null))
  ];
  const [fbs, orderFeed, funnel, cards, balance] = await Promise.all(jobs);
  const balanceHistory = balance ? saveBalanceSnapshot(id, balance) : (readBalanceHistory()[id] || []);
  return { demo: false, orders: enrichOrders(normalizeOrders(fbs, orderFeed), cards), funnel: extractFunnel(funnel),
    balance: balance ? { currency: balance.currency || 'RUB', current: Number(balance.current || 0),
      forWithdraw: Number(balance.for_withdraw || 0), history: balanceHistory } : null, warnings };
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
  if (req.method === 'GET' && url.pathname === '/api/advertising') {
    return send(res, 200, await advertising(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && url.pathname === '/api/fbs-stocks') {
    return send(res, 200, await fbsStocks(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'GET' && url.pathname === '/api/prices') {
    return send(res, 200, await prices(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'POST' && url.pathname === '/api/prices/update') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите изменение цен и скидок');
    return send(res, 200, await updatePrices(body));
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
    const body = await readJson(req); const token = tokenFor(body.cabinet);
    const type = ['png', 'svg', 'zplv', 'zplh'].includes(body.type) ? body.type : 'png';
    const data = await wbRequest(token, `https://marketplace-api.wildberries.ru/api/v3/orders/stickers?type=${type}&width=58&height=40`, { method: 'POST', body: { orders: body.orders } });
    return send(res, 200, data);
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

module.exports = { server, cabinets, normalizeOrders, normalizeOrderFeed, enrichOrders, extractFunnel, summarizeAdStats, validAdPeriod, normalizeFbsStocks, normalizePrices, WB_HOSTS };
