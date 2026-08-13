'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 4173);
const DATA_FILE = path.join(ROOT, 'data', 'cabinets.json');
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
      .catch(e => (warnings.push(`Карточки товаров: ${e.message}`), []))
  ];
  const [fbs, orderFeed, funnel, cards] = await Promise.all(jobs);
  return { demo: false, orders: enrichOrders(normalizeOrders(fbs, orderFeed), cards), funnel: extractFunnel(funnel), warnings };
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

module.exports = { server, cabinets, normalizeOrders, normalizeOrderFeed, enrichOrders, extractFunnel, WB_HOSTS };
