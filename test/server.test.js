'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOrders, normalizeOrderFeed, enrichOrders, extractFunnel, summarizeAdStats, campaignProductDaily, withAdBudgets, normalizeStockPreset, validAdPeriod, normalizeFbsStocks, normalizeFbwStocks, normalizePrices, normalizeNewOrders, summarizeSupplies, normalizeTrbxes, chunkOrders, stickerType, WB_HOSTS } = require('../server');

test('объединяет и сортирует FBS и события ленты WB', () => {
  const result = normalizeOrders(
    { orders: [{ id: 1, nmId: 11, createdAt: '2026-08-12T10:00:00Z', price: 5000 }] },
    { data: { currency: 'RUB', orders: [{ srid: 's2', nmId: 12, chrtId: 22, createdAt: '2026-08-11T10:00:00Z', updatedAt: '2026-08-13T10:00:00Z', status: 'buyout', sellerPrice: 100 }] } }
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 's2');
  assert.equal(result[1].source, 'FBS');
});

test('преобразует актуальный ответ order-feed и использует время обновления события', () => {
  const result = normalizeOrderFeed({ data: { currency: 'RUB', orders: [{
    nmId: 938594007, chrtId: 1413756489, srid: 'order.1', createdAt: '2026-08-06T08:37:34Z',
    updatedAt: '2026-08-12T16:02:24Z', status: 'cancel', cancelType: 'receipt',
    warehouseName: 'Коледино', warehouseRegion: 'Центральный', destinationCity: 'Санкт-Петербург',
    destinationDistrict: 'Северо-Западный', sellerPrice: 970.09, isMp: false, isB2b: false
  }] } });
  assert.equal(result[0].id, 'order.1');
  assert.equal(result[0].createdAt, '2026-08-12T16:02:24Z');
  assert.equal(result[0].orderedAt, '2026-08-06T08:37:34Z');
  assert.equal(result[0].status, 'cancel');
  assert.equal(result[0].price, 97009);
  assert.equal(result[0].source, 'Лента WB');
});

test('добавляет к заказу название, бренд, артикул и главное фото карточки', () => {
  const result = enrichOrders([{ nmId: 123, name: 'Товар WB 123', article: 'chrtID 1' }], [{
    nmID: 123, title: 'Кроссовки Urban', vendorCode: 'URBAN-01', brand: 'Example', subjectName: 'Кроссовки',
    photos: [{ c246x328: 'https://basket.example/card.webp', big: 'https://basket.example/big.webp' }]
  }]);
  assert.equal(result[0].name, 'Кроссовки Urban');
  assert.equal(result[0].article, 'URBAN-01');
  assert.equal(result[0].brand, 'Example');
  assert.equal(result[0].photo, 'https://basket.example/card.webp');
});

test('суммирует показатели воронки разных товаров', () => {
  const result = extractFunnel({ data: { products: [
    { statistic: { selected: { openCardCount: 100, addToCartCount: 20, ordersCount: 5, buyoutsCount: 4, buyoutsSumRub: 2000 } } },
    { statistic: { selected: { openCardCount: 50, addToCartCount: 10, ordersCount: 3, buyoutsCount: 2, buyoutsSumRub: 1000 } } }
  ] } });
  assert.deepEqual(result, { views: 150, cart: 30, orders: 8, sales: 6, revenue: 3000, currency: 'RUB' });
});

test('понимает актуальные поля воронки WB API v3', () => {
  const result = extractFunnel({ data: { currency: 'RUB', products: [
    { statistic: { selected: { openCount: 120, cartCount: 24, orderCount: 9, buyoutCount: 7, buyoutSum: 4900 } } },
    { statistic: { selected: { openCount: 30, cartCount: 6, orderCount: 2, buyoutCount: 1, buyoutSum: 700 } } }
  ] } });
  assert.deepEqual(result, { views: 150, cart: 30, orders: 11, sales: 8, revenue: 5600, currency: 'RUB' });
});

test('разрешает только известные официальные хосты WB', () => {
  assert.equal(WB_HOSTS.has('marketplace-api.wildberries.ru'), true);
  assert.equal(WB_HOSTS.has('example.com'), false);
});

test('собирает рекламные метрики и рассчитывает CTR, CPC, ДРР и ROAS', () => {
  const result = summarizeAdStats([{ id: 77, status: 9, bid_type: 'manual', settings: { name: 'Поиск', payment_type: 'cpm' } }], [{
    advertId: 77, views: 1000, clicks: 40, sum: 800, orders: 8, sum_price: 8000, atbs: 12, shks: 6,
    days: [{ date: '2026-08-10T00:00:00Z', views: 1000, clicks: 40, sum: 800, orders: 8, sum_price: 8000,
      apps: [{ appType: 32, views: 1000, clicks: 40, sum: 800, orders: 8, sum_price: 8000,
        nms: [{ nmId: 123, name: 'Товар', views: 1000, clicks: 40, sum: 800, orders: 8, sum_price: 8000 }] }] }]
  }], '2026-08-10', '2026-08-11');
  assert.equal(result.totals.ctr, 4);
  assert.equal(result.totals.cpc, 20);
  assert.equal(result.totals.drr, 10);
  assert.equal(result.totals.roas, 10);
  assert.equal(result.daily.length, 2);
  assert.equal(result.campaigns[0].name, 'Поиск');
  assert.equal(result.platforms.find(item => item.id === 32).spend, 800);
  assert.equal(result.products[0].nmId, 123);
  assert.equal(result.productDaily.length, 1);
  assert.equal(result.productDaily[0].nmId, 123);
  assert.equal(result.productDaily[0].spend, 800);
});

test('не разрешает период рекламной статистики больше 31 дня', () => {
  assert.deepEqual(validAdPeriod('2026-08-01', '2026-08-31'), { from: '2026-08-01', to: '2026-08-31' });
  assert.throws(() => validAdPeriod('2026-07-01', '2026-08-01'), /не более 31 дня/);
});

test('объединяет остатки FBS с карточками и сохраняет артикулы продавца и WB', () => {
  const result = normalizeFbsStocks(
    [{ id: 10, name: 'Коледино', officeId: 15 }],
    [{ warehouse: { id: 10, name: 'Коледино', officeId: 15 }, stocks: [{ chrtId: 501, sku: '460000000001', amount: 12 }] }],
    [{ nmID: 123456, vendorCode: 'VENDOR-1', title: 'Товар', subjectName: 'Категория', sizes: [{ chrtID: 501, techSize: 'M', skus: ['460000000001'] }] }]
  );
  assert.equal(result.rows[0].vendorCode, 'VENDOR-1');
  assert.equal(result.rows[0].nmId, 123456);
  assert.equal(result.rows[0].warehouseName, 'Коледино');
  assert.equal(result.rows[0].amount, 12);
  assert.equal(result.totals.amount, 12);
  assert.deepEqual(result.categories, ['Категория']);
});

test('нормализует остатки FBW по складу и размеру', () => {
  const result = normalizeFbwStocks([
    { nmId: 123456, chrtId: 501, warehouseId: 507, warehouseName: 'Коледино', regionName: 'Центральный', quantity: 14, inWayToClient: 2, inWayFromClient: 1 }
  ], [{ nmID: 123456, vendorCode: 'VENDOR-1', title: 'Товар', subjectName: 'Категория', sizes: [{ chrtID: 501, techSize: 'M', skus: ['460000000001'] }] }]);
  assert.equal(result.rows[0].warehouseName, 'Коледино');
  assert.equal(result.rows[0].regionName, 'Центральный');
  assert.equal(result.rows[0].amount, 14);
  assert.equal(result.rows[0].inWayToClient, 2);
  assert.equal(result.totals.warehouses, 1);
});
test('объединяет цены с названиями, категориями и артикулами карточек', () => {
  const result = normalizePrices([{ nmID: 123, discount: 20, clubDiscount: 5, currencyIsoCode4217: 'RUB', sizes: [{ price: 1000, discountedPrice: 800, clubDiscountedPrice: 760 }] }], [{ nmID: 123, vendorCode: 'SELLER-1', title: 'Тестовый товар', subjectName: 'Категория', brand: 'Бренд' }]);
  assert.equal(result.rows[0].vendorCode, 'SELLER-1');
  assert.equal(result.rows[0].price, 1000);
  assert.equal(result.rows[0].discount, 20);
  assert.deepEqual(result.categories, ['Категория']);
});


test('связывает новые сборочные задания FBS с карточками и считает сборку', () => {
  const cards = [{ nmID: 100001, vendorCode: 'TSHIRT', title: 'Футболка', subjectName: 'Одежда', sizes: [{ chrtID: 501, techSize: 'M', skus: ['4600001'] }] }];
  const result = normalizeNewOrders([
    { id: 11, nmId: 100001, chrtId: 501, skus: ['4600001'], warehouseId: 7, createdAt: '2026-09-01T10:00:00Z', convertedPrice: 129900, convertedCurrencyCode: 643, cargoType: 1 },
    { id: 12, nmId: 100001, chrtId: 501, warehouseId: 7, createdAt: '2026-09-02T10:00:00Z', price: 100000, supplyId: 'WB-GI-1' }
  ], cards);
  assert.equal(result.rows[0].id, 12, 'свежие задания идут первыми');
  assert.equal(result.rows[1].name, 'Футболка');
  assert.equal(result.rows[1].vendorCode, 'TSHIRT');
  assert.equal(result.rows[1].size, 'M');
  assert.equal(result.rows[1].sku, '4600001');
  assert.equal(result.rows[1].cargoTypeName, 'Обычный');
  assert.equal(result.totals.orders, 2);
  assert.equal(result.totals.free, 1);
  assert.equal(result.totals.assembled, 1);
  assert.equal(result.totals.amount, 229900);
  assert.deepEqual(result.categories, ['Одежда']);
  assert.equal(result.warehouses.length, 1);
});

test('показывает открытые поставки раньше закрытых', () => {
  const result = summarizeSupplies([
    { id: 'WB-GI-2', name: 'Закрытая', done: true, createdAt: '2026-09-05T10:00:00Z', cargoType: 2 },
    { id: 'WB-GI-1', name: 'Открытая', done: false, createdAt: '2026-09-01T10:00:00Z', cargoType: 1 }
  ]);
  assert.equal(result.rows[0].id, 'WB-GI-1');
  assert.equal(result.rows[1].cargoTypeName, 'СГТ');
  assert.deepEqual(result.totals, { supplies: 2, open: 1, closed: 1 });
});

test('нормализует грузоместа и их состав', () => {
  const result = normalizeTrbxes([{ id: 'WB-TRBX-2', orderIds: [5, 'x'] }, { id: 'WB-TRBX-1' }]);
  assert.deepEqual(result.map(item => item.id), ['WB-TRBX-1', 'WB-TRBX-2']);
  assert.deepEqual(result[1].orderIds, [5]);
  assert.deepEqual(result[0].orderIds, []);
});

test('режет стикеры на пачки по 100 заданий без повторов', () => {
  const chunks = chunkOrders([...Array.from({ length: 150 }, (_, index) => index + 1), 1, 2]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 100);
  assert.equal(chunks[1].length, 50);
  assert.deepEqual(chunkOrders([]), []);
});

test('разрешает только поддерживаемые форматы стикеров', () => {
  assert.equal(stickerType('svg'), 'svg');
  assert.equal(stickerType('zplh'), 'zplh');
  assert.equal(stickerType('pdf'), 'png');
  assert.equal(stickerType(undefined), 'png');
});

test('делит статистику по артикулам между кампаниями', () => {
  const campaigns = [{ id: 77, status: 9, type: 9, bid_type: 'manual', settings: { name: 'Поиск', payment_type: 'cpm' } },
    { id: 88, status: 11, type: 8, bid_type: 'unified', settings: { name: 'Авто', payment_type: 'cpc' } }];
  const day = (advertId, views) => ({ advertId, days: [{ date: '2026-08-10T00:00:00Z', views, clicks: 10, sum: 100, orders: 1, sum_price: 1000,
    apps: [{ appType: 32, views, clicks: 10, sum: 100, orders: 1, sum_price: 1000,
      nms: [{ nmId: 123, name: 'Товар', views, clicks: 10, sum: 100, orders: 1, sum_price: 1000 }] }] }] });
  const result = summarizeAdStats(campaigns, [day(77, 500), day(88, 300)], '2026-08-10', '2026-08-10');
  assert.equal(result.productDaily.length, 2);
  assert.equal(result.campaigns.find(row => row.id === 77).type, 9);
  const own = campaignProductDaily(result.productDaily, 77, [123]);
  assert.equal(own.length, 1);
  assert.equal(own[0].views, 500);
});

test('подставляет остаток бюджета к кампаниям и оставляет null без данных', () => {
  const rows = withAdBudgets([{ id: 77 }, { id: 88 }], new Map([['77', 18400]]));
  assert.equal(rows[0].budget, 18400);
  assert.equal(rows[1].budget, null);
});

test('проверяет шаблон остатков и отбрасывает некорректные позиции', () => {
  const preset = normalizeStockPreset({ name: '  Утренние остатки  ', warehouseIds: ['12', '12', ''],
    items: [{ chrtId: 501, amount: '5', nmId: 100001, name: 'Футболка', vendorCode: 'TSHIRT', size: 'M', sku: '460000000001' },
      { chrtId: 502, amount: -1 }, { chrtId: 'нет', amount: 3 }, { chrtId: 503, amount: 0 }] });
  assert.equal(preset.name, 'Утренние остатки');
  assert.deepEqual(preset.warehouseIds, ['12']);
  assert.equal(preset.items.length, 2);
  assert.equal(preset.items[0].amount, 5);
  assert.equal(preset.items[1].chrtId, 503);
  assert.match(preset.id, /^preset-/);
});

test('не сохраняет шаблон остатков без названия, склада или позиций', () => {
  assert.throws(() => normalizeStockPreset({ name: '', warehouseIds: ['1'], items: [{ chrtId: 1, amount: 1 }] }), /название/i);
  assert.throws(() => normalizeStockPreset({ name: 'Тест', warehouseIds: [], items: [{ chrtId: 1, amount: 1 }] }), /склад/i);
  assert.throws(() => normalizeStockPreset({ name: 'Тест', warehouseIds: ['1'], items: [] }), /артикул/i);
});
