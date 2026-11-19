'use strict';
// --- Новые заказы FBS: сборочные задания, поставки, короба, стикеры.
const { apiError, cabinets, tokenFor, wait, wbRequest } = require('../core/base');
const { productCards } = require('../core/product-cards');
const { stockCardIndex } = require('../stocks/stocks');

const MARKETPLACE_API = 'https://marketplace-api.wildberries.ru';
const STICKER_TYPES = new Set(['png', 'svg', 'zplv', 'zplh']);
const ORDER_STICKER_CHUNK = 100;
const SUPPLY_ORDERS_CHUNK = 100;
const ORDERS_LOOKUP_MAX_PAGES = 30;
const CARGO_TYPES = { 0: 'Не указан', 1: 'Обычный', 2: 'СГТ', 3: 'КГТ' };
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
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="219" height="151" viewBox="0 0 219 151">` +
    `<rect width="219" height="151" fill="#ffffff" stroke="#1b1b1f"/>` +
    `<text x="14" y="36" font-family="Arial, sans-serif" font-size="17" font-weight="bold">${title}</text>` +
    `<text x="14" y="58" font-family="Arial, sans-serif" font-size="11">${subtitle}</text>` +
    `<rect x="14" y="72" width="128" height="52" fill="#1b1b1f"/>` +
    `<text x="152" y="104" font-family="Arial, sans-serif" font-size="12">ДЕМО</text></svg>`;
  return Buffer.from(svg, 'utf8').toString('base64');
}

function normalizeNewOrders(orders = [], cards = []) {
  const byChrt = stockCardIndex(cards);
  const rows = orders
    .map(order => {
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
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id - a.id);
  const categories = [...new Set(rows.map(row => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const warehouses = [
    ...new Map(
      rows.filter(row => row.warehouseId).map(row => [String(row.warehouseId), { id: row.warehouseId, name: `Склад ${row.warehouseId}` }])
    ).values()
  ].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  return {
    rows,
    categories,
    warehouses,
    totals: {
      orders: rows.length,
      products: new Set(rows.map(row => String(row.nmId || row.chrtId))).size,
      amount: rows.reduce((sum, row) => sum + row.price, 0),
      assembled: rows.filter(row => row.supplyId).length,
      free: rows.filter(row => !row.supplyId).length
    }
  };
}

function demoNewOrders() {
  const now = Date.now();
  const cards = [
    {
      nmID: 100001,
      vendorCode: 'TSHIRT-BLACK',
      title: 'Футболка базовая',
      subjectName: 'Одежда',
      sizes: [{ chrtID: 501, techSize: 'M', skus: ['460000000001'] }]
    },
    {
      nmID: 100002,
      vendorCode: 'MUG-THERMO',
      title: 'Термокружка',
      subjectName: 'Посуда',
      sizes: [{ chrtID: 502, techSize: '500 мл', skus: ['460000000002'] }]
    },
    {
      nmID: 100003,
      vendorCode: 'HOODIE-GREEN',
      title: 'Худи Oversize',
      subjectName: 'Одежда',
      sizes: [{ chrtID: 503, techSize: 'L', skus: ['460000000003'] }]
    }
  ];
  const orders = Array.from({ length: 7 }, (_, index) => ({
    id: 9100500 + index,
    rid: `rid-demo-${index}`,
    orderUid: `uid-demo-${index}`,
    nmId: [100001, 100002, 100003][index % 3],
    chrtId: [501, 502, 503][index % 3],
    article: ['TSHIRT-BLACK', 'MUG-THERMO', 'HOODIE-GREEN'][index % 3],
    skus: [`46000000000${(index % 3) + 1}`],
    warehouseId: index % 2 ? 'demo-2' : 'demo-1',
    supplyId: index === 0 ? 'WB-GI-DEMO-1' : '',
    createdAt: new Date(now - index * 2_700_000).toISOString(),
    price: 129900 + index * 15000,
    convertedPrice: 129900 + index * 15000,
    currencyCode: 643,
    convertedCurrencyCode: 643,
    cargoType: 1
  }));
  return { demo: true, ...normalizeNewOrders(orders, cards), warnings: [] };
}

async function newFbsOrders(id) {
  if (id === 'demo' || !cabinets().length) return demoNewOrders();
  const token = tokenFor(id);
  const warnings = [];
  const response = await wbRequest(token, `${MARKETPLACE_API}/api/v3/orders/new`);
  const orders = Array.isArray(response?.orders) ? response.orders : [];
  const cards = await productCards(id, token).catch(error => (warnings.push(`Карточки товаров: ${error.message}`), []));
  return { demo: false, ...normalizeNewOrders(orders, cards), warnings };
}

function summarizeSupplies(supplies = []) {
  const rows = supplies
    .map(supply => ({
      id: supply.id || '',
      name: supply.name || 'Без названия',
      done: Boolean(supply.done),
      createdAt: supply.createdAt || '',
      closedAt: supply.closedAt || '',
      scanDt: supply.scanDt || '',
      cargoType: Number(supply.cargoType || 0),
      cargoTypeName: CARGO_TYPES[Number(supply.cargoType || 0)] || 'Не указан'
    }))
    .sort((a, b) => Number(a.done) - Number(b.done) || new Date(b.createdAt) - new Date(a.createdAt));
  return {
    rows,
    totals: { supplies: rows.length, open: rows.filter(row => !row.done).length, closed: rows.filter(row => row.done).length }
  };
}

function demoSupplies() {
  return {
    demo: true,
    ...summarizeSupplies([
      {
        id: 'WB-GI-DEMO-1',
        name: 'Поставка на сегодня',
        done: false,
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        cargoType: 1
      },
      {
        id: 'WB-GI-DEMO-2',
        name: 'Вчерашняя отгрузка',
        done: true,
        createdAt: new Date(Date.now() - 90_000_000).toISOString(),
        closedAt: new Date(Date.now() - 86_400_000).toISOString(),
        cargoType: 1
      }
    ])
  };
}

async function supplyList(id) {
  if (id === 'demo' || !cabinets().length) return demoSupplies();
  const token = tokenFor(id);
  const limit = 1000;
  const collected = [];
  let next = 0;
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
  return trbxes
    .map(trbx => {
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
    return {
      demo: true,
      supply,
      orders,
      trbxes: normalizeTrbxes([{ id: 'WB-TRBX-DEMO-1', orderIds: orders.map(order => order.id) }]),
      warnings: []
    };
  }
  const token = tokenFor(id);
  const warnings = [];
  const supply = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(supplyId)}`);
  // Старый метод списка заданий поставки WB удалил: теперь поставка отдаёт только номера заданий,
  // а сами задания ищутся в списке сборочных заданий за последние 30 дней.
  const orderIds = await wbRequest(token, `${MARKETPLACE_API}/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/order-ids`)
    .then(response => [...new Set((Array.isArray(response?.orderIds) ? response.orderIds : []).map(Number).filter(Number.isInteger))])
    .catch(error => (warnings.push(`Задания поставки: ${error.message}`), []));
  const foundOrders = orderIds.length
    ? await ordersByIds(token, orderIds).catch(error => (warnings.push(`Данные заданий: ${error.message}`), []))
    : [];
  const trbxResponse = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(supplyId)}/trbx`).catch(
    error => (warnings.push(`Грузоместа: ${error.message}`), { trbxes: [] })
  );
  const cards = await productCards(id, token).catch(() => []);
  const byId = new Map(foundOrders.map(order => [String(order.id), order]));
  const orders = normalizeNewOrders(
    orderIds.map(orderId => byId.get(String(orderId)) || { id: orderId, supplyId }),
    cards
  ).rows.map(row => (byId.has(String(row.id)) ? row : { ...row, name: `Задание ${row.id}`, detailsMissing: true }));
  if (orderIds.length > foundOrders.length)
    warnings.push(
      `Для ${orderIds.length - foundOrders.length} заданий WB не вернул данные: они старше 30 дней. Стикеры для них скачать можно.`
    );
  return {
    demo: false,
    supply: summarizeSupplies([supply]).rows[0],
    orders,
    trbxes: normalizeTrbxes(Array.isArray(trbxResponse?.trbxes) ? trbxResponse.trbxes : []),
    warnings
  };
}

async function ordersByIds(token, ids = []) {
  const wanted = new Set(ids.map(String));
  const found = [];
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
  const name = String(body.name || '')
    .trim()
    .slice(0, 128);
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
  const failed = [];
  let added = 0;
  for (let offset = 0; offset < orders.length; offset += SUPPLY_ORDERS_CHUNK) {
    if (offset) await wait(250);
    const chunk = orders.slice(offset, offset + SUPPLY_ORDERS_CHUNK);
    try {
      await wbRequest(token, `${MARKETPLACE_API}/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/orders`, {
        method: 'PATCH',
        body: { orders: chunk }
      });
      added += chunk.length;
    } catch (error) {
      chunk.forEach(orderId => failed.push({ orderId, message: error.message }));
    }
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
  const response = await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}/trbx`, {
    method: 'POST',
    body: { amount }
  });
  return { ok: true, trbxIds: Array.isArray(response?.trbxIds) ? response.trbxIds : [] };
}

async function deleteTrbx(body) {
  const token = tokenFor(body.cabinet);
  const trbxIds = (Array.isArray(body.trbxIds) ? body.trbxIds : []).map(String).filter(Boolean);
  if (!body.supplyId || !trbxIds.length) throw apiError(400, 'Выберите грузоместа для удаления');
  await wbRequest(token, `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}/trbx`, {
    method: 'DELETE',
    body: { trbxIds }
  });
  return { ok: true, removed: trbxIds.length };
}

async function fillTrbx(body) {
  const token = tokenFor(body.cabinet);
  const orderIds = [...new Set((body.orders || []).map(Number).filter(Number.isInteger))];
  if (!body.supplyId || !body.trbxId) throw apiError(400, 'Не указано грузоместо');
  if (!orderIds.length) throw apiError(400, 'Выберите задания для грузоместа');
  await wbRequest(
    token,
    `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}/trbx/${encodeURIComponent(body.trbxId)}`,
    { method: 'PATCH', body: { orderIds } }
  );
  return { ok: true, trbxId: body.trbxId, added: orderIds.length };
}

async function trbxStickers(body) {
  const type = stickerType(body.type);
  const trbxIds = (Array.isArray(body.trbxIds) ? body.trbxIds : []).map(String).filter(Boolean);
  if (!body.supplyId || !trbxIds.length) throw apiError(400, 'Выберите грузоместа');
  if (body.cabinet === 'demo' || !cabinets().length) {
    return { type: 'svg', stickers: trbxIds.map(trbxId => ({ trbxId, file: demoStickerFile(trbxId, 'QR-код грузоместа') })) };
  }
  const token = tokenFor(body.cabinet);
  const data = await wbRequest(
    token,
    `${MARKETPLACE_API}/api/v3/supplies/${encodeURIComponent(body.supplyId)}/trbx/stickers?type=${type}`,
    { method: 'POST', body: { trbxIds } }
  );
  return { type, stickers: Array.isArray(data?.stickers) ? data.stickers : [] };
}

async function orderStickers(body) {
  const type = stickerType(body.type);
  const chunks = chunkOrders(body.orders);
  if (!chunks.length) throw apiError(400, 'Выберите хотя бы одно сборочное задание');
  if (body.cabinet === 'demo' || !cabinets().length) {
    return {
      type: 'svg',
      stickers: chunks.flat().map(orderId => ({ orderId, file: demoStickerFile(`Задание ${orderId}`, 'Стикер товара') }))
    };
  }
  const token = tokenFor(body.cabinet);
  const stickers = [];
  for (const [index, chunk] of chunks.entries()) {
    if (index) await wait(400);
    const data = await wbRequest(token, `${MARKETPLACE_API}/api/v3/orders/stickers?type=${type}&width=58&height=40`, {
      method: 'POST',
      body: { orders: chunk }
    });
    stickers.push(...(Array.isArray(data?.stickers) ? data.stickers : []));
  }
  return { type, stickers };
}

module.exports = {
  assembleOrders,
  chunkOrders,
  createSupply,
  createTrbx,
  deleteSupply,
  deleteTrbx,
  deliverSupply,
  fillTrbx,
  newFbsOrders,
  normalizeNewOrders,
  normalizeTrbxes,
  orderStickers,
  stickerType,
  summarizeSupplies,
  supplyBarcode,
  supplyDetails,
  supplyList,
  trbxStickers
};
