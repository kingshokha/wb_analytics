'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeHourlyOrders, orderFeedPeriod, itemRatingPeriods, normalizeItemRatings, campaignActivePeriod, mergeMinusList, summarizeKeywordDaily, summarizePositionDaily, normalizeOrders, normalizeOrderFeed, enrichOrders, extractFunnel, summarizeAdStats, campaignProductDaily, withAdBudgets, summarizeKeywords, normalizeStockPreset, normalizePricePreset, adCampaignMayHaveStats, validAdPeriod, historyPeriod, historyChunks, planAdFetch, datesBetween, safeFolderName, funnelDaysToFetch, pairFunnelDays, funnelPeriods, funnelRangeBuckets, funnelRecordCounts, funnelRangeValues, funnelSalesMatrix, summaryTopProducts, summaryDrops, summaryProducts, normalizeFbsStocks, normalizeFbwStocks, normalizePrices, summarizeStockTotals, normalizeNewOrders, summarizeSupplies, normalizeTrbxes, chunkOrders, stickerType, localPhoto, WB_HOSTS } = require('../server');

test('оценки товаров: период не позже вчера, прошлый период той же длины перед ним', () => {
  const yesterday = new Date(Date.now() + 3 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const periods = itemRatingPeriods('2026-01-01', today);
  assert.equal(periods.current.end, yesterday);
  assert.equal(periods.endClamped, true);
  const fixed = itemRatingPeriods(yesterday, yesterday);
  assert.deepEqual(fixed.current, { start: yesterday, end: yesterday });
  assert.equal(fixed.past.end, fixed.past.start);
  assert.ok(fixed.past.end < yesterday);
});

test('оценки товаров: dynamics — разница с прошлым периодом, звёзды и фото из карточек', () => {
  const result = normalizeItemRatings([{ sellerRating: { current: 4.31, dynamics: 0 },
    feedbackIncrease: { current: 22, total: 100, dynamics: 18, fiveStar: { current: 17, total: 80 }, oneStar: { current: 2, total: 5 } },
    items: [{ nmId: 1261663339, title: 'MagSafe', vendorCode: 'MS', rating: 10, feedbackRating: { current: 4.51, dynamics: -0.49, percentile: 44.4 },
      feedbackCount: { current: 22, dynamics: 18 }, fiveStar: { current: 17, dynamics: 13 }, oneStar: { current: 2, dynamics: 2 }, disqualified: 0, pinnedFeedback: false, isShadowed: true }] }],
    [{ nmID: 1261663339, photos: [{ tm: 'https://basket-01.wbbasket.ru/x.webp' }] }]);
  const item = result.items[0];
  assert.equal(item.feedbackRatingDelta, -0.49);
  assert.equal(item.newFeedbacks, 22);
  assert.equal(item.newFeedbacksDelta, 18);
  assert.deepEqual(item.stars[5], { count: 17, delta: 13 });
  assert.deepEqual(item.stars[3], { count: 0, delta: null });
  assert.equal(item.shadowed, true);
  assert.ok(item.photo);
  assert.equal(result.seller.stars[1].total, 5);
});

test('из общей ленты за 31 день список берёт события по времени текущего статуса в выбранном периоде', () => {
  const feed = { data: { currency: 'RUB', orders: [
    { srid: 'old', createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z' },
    { srid: 'in', createdAt: '2026-10-05T10:00:00Z' },
    { srid: 'out', createdAt: '2026-09-25T10:00:00Z' }
  ] } };
  const result = orderFeedPeriod(feed, '2026-10-02', '2026-10-08');
  assert.deepEqual(result.data.orders.map(order => order.srid), ['old', 'in']);
  assert.equal(result.data.currency, 'RUB');
});

test('заказы по часам — по московскому времени, каждый заказ один раз, «к этому часу» по времени суток', () => {
  const days = summarizeHourlyOrders([
    { id: 'a', orderedAt: '2026-10-08T06:30:00Z', price: 100000 },   // 09:30 МСК сегодня
    { id: 'a', orderedAt: '2026-10-08T06:30:00Z', price: 100000 },   // тот же заказ — не считается дважды
    { id: 'b', orderedAt: '2026-10-07T20:59:00Z', price: 50000 },    // 23:59 МСК 07.10 — вчера
    { id: 'c', orderedAt: '2026-10-07T21:10:00Z', price: 20000 },    // 00:10 МСК 08.10 — уже сегодня
    { id: 'd', orderedAt: '2026-10-07T06:00:00Z', price: 30000 },    // 09:00 МСК вчера — до «сейчас» (10:00)
    { id: 'e', orderedAt: '2026-09-20T06:00:00Z', price: 30000 }     // за пределами 8 дней
  ], '2026-10-08', 10 * 60);
  assert.equal(days.length, 8);
  assert.equal(days[0].date, '2026-10-01');
  const today = days[7], yesterday = days[6];
  assert.equal(today.date, '2026-10-08');
  assert.deepEqual(today.hours[9], { count: 1, sum: 1000 });
  assert.equal(today.hours[0].count, 1);
  assert.deepEqual(today.byNow, { count: 2, sum: 1200 });
  assert.equal(yesterday.hours[23].count, 1);
  assert.deepEqual(yesterday.byNow, { count: 1, sum: 300 });
});

test('лента заказов строится только из событий WB, отсортированных по времени', () => {
  const result = normalizeOrders(
    { orders: [{ id: 1, rid: 'not-in-feed', nmId: 11, createdAt: '2026-08-12T10:00:00Z', price: 5000 }] },
    { data: { currency: 'RUB', orders: [
      { srid: 's1', nmId: 12, createdAt: '2026-08-10T10:00:00Z', status: 'created', sellerPrice: 50 },
      { srid: 's2', nmId: 12, chrtId: 22, createdAt: '2026-08-11T10:00:00Z', updatedAt: '2026-08-13T10:00:00Z', status: 'buyout', sellerPrice: 100 }
    ] } }
  );
  assert.deepEqual(result.map(order => order.id), ['s2', 's1']);
  assert.ok(result.every(order => order.source === 'Лента WB'));
});

test('новое FBS-задание не дублирует строку ленты, а добавляет к ней сумму покупателя с СПП (rid = srid)', () => {
  const result = normalizeOrders(
    { orders: [
      { id: 5985992160, rid: 'eBG.re86.1.0', nmId: 221609260, createdAt: '2026-10-08T13:43:00Z', salePrice: 570400, finalPrice: 468800, convertedFinalPrice: 468800, currencyCode: 643, convertedCurrencyCode: 643, warehouseId: 2155961 },
      { id: 7, rid: 'other-currency', nmId: 1, createdAt: '2026-10-08T12:00:00Z', convertedFinalPrice: 9000, currencyCode: 933, convertedCurrencyCode: 933 }
    ] },
    { data: { currency: 'RUB', orders: [
      { srid: 'eBG.re86.1.0', nmId: 221609260, createdAt: '2026-10-08T13:43:00Z', status: 'created', sellerPrice: 5704, warehouseName: 'склад продавца Коледино', destinationCity: 'Минск', destinationDistrict: 'Беларусь' },
      { srid: 'other-currency', nmId: 1, createdAt: '2026-10-08T12:00:00Z', status: 'created', sellerPrice: 100 }
    ] } }
  );
  assert.equal(result.length, 2);
  const order = result.find(item => item.id === 'eBG.re86.1.0');
  assert.equal(order.source, 'Лента WB');
  assert.equal(order.price, 570400);
  assert.equal(order.buyerPrice, 468800);
  assert.equal(order.warehouse, 'склад продавца Коледино');
  assert.equal(order.destinationCity, 'Минск');
  // Сумма покупателя в другой валюте не подставляется.
  assert.equal(result.find(item => item.id === 'other-currency').buyerPrice, undefined);
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

test('фото с CDN WB отдаются через локальный кэш, остальные ссылки не меняются', () => {
  assert.equal(localPhoto('https://basket-47.wbbasket.ru/vol14523/part1452346/1452346227/images/c246x328/1.webp'),
    '/api/photo/basket-47.wbbasket.ru/vol14523/part1452346/1452346227/images/c246x328/1.webp');
  assert.equal(localPhoto('https://basket.example/card.webp'), 'https://basket.example/card.webp');
  assert.equal(localPhoto('https://evil.wbbasket.ru.example.com/a.webp'), 'https://evil.wbbasket.ru.example.com/a.webp');
  assert.equal(localPhoto('http://basket-1.wbbasket.ru/a.webp'), 'http://basket-1.wbbasket.ru/a.webp');
  assert.equal(localPhoto(''), '');
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

test('проверяет шаблон цен и отбрасывает некорректные позиции', () => {
  const preset = normalizePricePreset({ name: 'Распродажа', items: [
    { nmId: 100001, price: '1990', discount: '20', name: 'Футболка', vendorCode: 'TSHIRT' },
    { nmId: 100002, price: 0, discount: 10 },
    { nmId: 100003, price: 1290, discount: 120 },
    { nmId: 100004, price: 500, discount: 0 }] });
  assert.equal(preset.items.length, 2);
  assert.equal(preset.items[0].price, 1990);
  assert.equal(preset.items[0].discount, 20);
  assert.equal(preset.items[1].nmId, 100004);
});

test('не сохраняет шаблон цен без названия или позиций', () => {
  assert.throws(() => normalizePricePreset({ name: '', items: [{ nmId: 1, price: 100, discount: 0 }] }), /название/i);
  assert.throws(() => normalizePricePreset({ name: 'Тест', items: [] }), /товар/i);
});

test('делит период выгрузки кампании на блоки не длиннее 31 дня', () => {
  assert.deepEqual(historyChunks({ from: '2026-09-01', to: '2026-09-13' }), [{ from: '2026-09-01', to: '2026-09-13' }]);
  const chunks = historyChunks({ from: '2026-01-01', to: '2026-03-15' });
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[0], { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(chunks[2].to, '2026-03-15');
});

test('проверяет даты выгрузки кампании и ограничивает глубину годом', () => {
  assert.deepEqual(historyPeriod('2025-09-01', '2026-09-13', '2026-09-13'), { from: '2025-09-01', to: '2026-09-13' });
  assert.throws(() => historyPeriod('2025-08-31', '2026-09-13', '2026-09-13'), /не раньше/);
  assert.throws(() => historyPeriod('2026-09-10', '2026-09-01', '2026-09-13'), /не позже/);
  assert.throws(() => historyPeriod('2026-09-01', '2026-09-14', '2026-09-13'), /позже сегодняшнего/);
});

test('суммирует общие остатки товара по складам продавца и WB', () => {
  const totals = summarizeStockTotals(
    [{ nmId: 100, quantity: 5 }, { nmId: 100, quantity: 2 }, { nmId: 300, quantity: 0 }],
    [{ nmId: 100, quantity: 10 }, { nmId: 200, quantity: 4 }, { quantity: 99 }]);
  assert.deepEqual(totals['100'], { fbs: 10, fbw: 7, total: 17 });
  assert.deepEqual(totals['200'], { fbs: 4, fbw: 0, total: 4 });
  assert.equal(totals['300'].total, 0);
  assert.equal(Object.keys(totals).length, 3);
});

test('запрашивает у WB только несохранённые и свежие дни кампании', () => {
  const dates = datesBetween('2026-09-01', '2026-09-13');
  assert.equal(dates.length, 13);
  const empty = planAdFetch(dates, new Set(), '2026-09-13', 3);
  assert.deepEqual(empty.chunks, [{ from: '2026-09-01', to: '2026-09-13' }]);
  const saved = planAdFetch(dates, new Set(dates), '2026-09-13', 3);
  assert.deepEqual(saved.missing, ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
  assert.deepEqual(saved.chunks, [{ from: '2026-09-10', to: '2026-09-13' }]);
  const old = planAdFetch(datesBetween('2026-06-01', '2026-06-30'), new Set(datesBetween('2026-06-01', '2026-06-30')), '2026-09-13', 3);
  assert.deepEqual(old.chunks, []);
});

test('собирает пропуски в запросы не длиннее 31 дня', () => {
  const dates = datesBetween('2026-01-01', '2026-03-31');
  const stored = new Set(datesBetween('2026-01-06', '2026-01-19'));
  const plan = planAdFetch(dates, stored, '2026-09-13', 3);
  assert.deepEqual(plan.chunks[0], { from: '2026-01-01', to: '2026-01-31' });
  assert.ok(plan.chunks.every(chunk => datesBetween(chunk.from, chunk.to).length <= 31));
  assert.equal(plan.missing.length, dates.length - stored.size);
});

test('делает из названия кабинета допустимое имя папки', () => {
  assert.equal(safeFolderName('ИП Шамсиддинов', 'Кабинет 1'), 'ИП Шамсиддинов');
  assert.equal(safeFolderName('Мой: кабинет / тест?', 'Кабинет 1'), 'Мой кабинет тест');
  assert.equal(safeFolderName('  ', 'Кабинет 1'), 'Кабинет 1');
  assert.equal(safeFolderName('CON', 'Кабинет 1'), 'Кабинет 1');
  assert.equal(safeFolderName('123', 'Кабинет 1'), 'Кабинет 123');
});

test('перекачивает дни воронки, пока они не стали окончательными', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  const record = fetchedAt => ({ fetchedAt, products: {} });
  const fetched = new Map([
    ['2026-09-01', record('2026-09-09T10:00:00Z')],
    ['2026-09-02', { fetchedAt: '2026-09-12T10:00:00Z' }],
    ['2026-09-05', record('2026-09-10T10:00:00Z')],
    ['2026-09-13', record('2026-09-14T11:30:00Z')],
    ['2026-09-12', record('2026-09-14T09:00:00Z')]
  ]);
  const days = funnelDaysToFetch(['2026-09-01', '2026-09-02', '2026-09-05', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2025-01-01'], fetched, now, '2026-09-14');
  assert.deepEqual(days, ['2026-09-02', '2026-09-05', '2026-09-12', '2026-09-14']);
});

test('собирает дни воронки в пары для запроса, свежие первыми', () => {
  assert.deepEqual(pairFunnelDays(['2026-09-01', '2026-09-03', '2026-09-02']), [{ selected: '2026-09-03', past: '2026-09-02' }, { selected: '2026-09-01', past: '' }]);
  assert.deepEqual(pairFunnelDays([]), []);
});

test('считает прошлый период воронки той же длины перед текущим', () => {
  assert.deepEqual(funnelPeriods('2026-09-08', '2026-09-14'), { current: { from: '2026-09-08', to: '2026-09-14' }, previous: { from: '2026-09-01', to: '2026-09-07' } });
  assert.deepEqual(funnelPeriods('2026-08-01', '2026-08-31').previous, { from: '2026-07-01', to: '2026-07-31' });
  assert.notEqual(funnelPeriods('2026-09-01', '2099-01-01').current.to, '2099-01-01');
  assert.throws(() => funnelPeriods('2026-09-10', '2026-09-01'), /раньше окончания/);
});

test('понимает грузоместа с заданиями в поле orders из нового ответа WB', () => {
  const result = normalizeTrbxes([{ id: 'WB-MP-2', orders: [5758997110, { id: 7 }, 'x'] }, { id: 'WB-MP-1' }]);
  assert.deepEqual(result.map(item => item.id), ['WB-MP-1', 'WB-MP-2']);
  assert.deepEqual(result[1].orderIds, [5758997110, 7]);
  assert.deepEqual(result[0].orderIds, []);
});

test('делит период воронки на недели и месяцы с таким же прошлым отрезком', () => {
  const weeks = funnelRangeBuckets({ from: '2026-08-01', to: '2026-09-14' }, 'week');
  assert.equal(weeks.length, 8);
  assert.deepEqual([weeks[0].from, weeks[0].to], ['2026-08-01', '2026-08-02']);
  assert.deepEqual([weeks[1].from, weeks[1].to], ['2026-08-03', '2026-08-09']);
  assert.deepEqual([weeks[7].from, weeks[7].to], ['2026-09-14', '2026-09-14']);
  assert.deepEqual(weeks[1].previous, { from: '2026-06-19', to: '2026-06-25' });
  const months = funnelRangeBuckets({ from: '2026-08-01', to: '2026-09-14' }, 'month');
  assert.deepEqual(months.map(bucket => [bucket.from, bucket.to]), [['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-14']]);
});

test('считает воронку только по выбранным артикулам', () => {
  const day = { openCount: 30, cartCount: 6, orderCount: 2, orderSum: 3000, buyoutCount: 1, buyoutSum: 1500, addToWishlistCount: 4,
    products: { '100': [20, 4, 2, 3000, 1, 1500, 3], '200': [10, 2, 0, 0, 0, 0, 1] } };
  assert.equal(funnelRecordCounts(day).openCount, 30);
  assert.deepEqual(funnelRecordCounts(day, ['200']), { openCount: 10, cartCount: 2, orderCount: 0, orderSum: 0, buyoutCount: 0, buyoutSum: 0, addToWishlistCount: 1 });
  assert.equal(funnelRecordCounts(day, ['300']).openCount, 0);
  assert.equal(funnelRecordCounts({ openCount: 5 }, ['100']), null);
});

test('складывает отрезок воронки из дней с учётом фильтра артикулов', () => {
  const days = new Map([
    ['2026-09-01', { fetchedAt: '2026-09-10T00:00:00Z', openCount: 5, products: { '100': [3, 1, 0, 0, 0, 0, 0], '200': [2, 0, 0, 0, 0, 0, 0] } }],
    ['2026-09-02', { fetchedAt: '2026-09-10T00:00:00Z', openCount: 4, products: { '100': [4, 0, 1, 900, 0, 0, 0] } }]
  ]);
  const result = funnelRangeValues({ from: '2026-09-01', to: '2026-09-02' }, days, {}, ['100'], Date.parse('2026-09-15T00:00:00Z'));
  assert.equal(result.fresh, true);
  assert.equal(result.values.openCount, 7);
  assert.equal(result.values.orderSum, 900);
});

test('не запрашивает статистику кампаний, закончившихся до периода или созданных после него', () => {
  const campaign = (created, deleted, extra = {}) => ({ status: extra.status ?? 9, timestamps: { created, deleted, started: extra.started ?? null, updated: extra.updated ?? created } });
  assert.equal(adCampaignMayHaveStats(campaign('2023-05-06T17:01:19+03:00', '2023-06-24T06:12:49+03:00'), '2026-09-10', '2026-09-16'), false);
  assert.equal(adCampaignMayHaveStats(campaign('2026-08-01T10:00:00+03:00', '2100-01-01T00:00:00+03:00'), '2026-09-10', '2026-09-16'), true);
  assert.equal(adCampaignMayHaveStats(campaign(null, '2100-01-01T00:00:00+03:00'), '2026-09-10', '2026-09-16'), true);
  assert.equal(adCampaignMayHaveStats(campaign('2026-08-01T10:00:00+03:00', '2026-09-12T09:00:00+03:00'), '2026-09-10', '2026-09-16'), true);
  assert.equal(adCampaignMayHaveStats(campaign('2026-09-20T10:00:00+03:00', '2100-01-01T00:00:00+03:00'), '2026-09-10', '2026-09-16'), false);
  assert.equal(adCampaignMayHaveStats({}, '2026-09-10', '2026-09-16'), true);
  // Перезапуск после конца периода не отменяет показы внутри периода: started — последний запуск.
  assert.equal(adCampaignMayHaveStats(campaign('2026-08-01T10:00:00+03:00', '2100-01-01T00:00:00+03:00', { started: '2026-09-20T10:00:00+03:00' }), '2026-09-10', '2026-09-16'), true);
  // Завершённая кампания с заглушкой в deleted заканчивается датой последнего изменения.
  const finished = updated => campaign('2025-05-02T08:23:29+03:00', '2100-01-01T00:00:00+03:00', { status: 7, updated });
  assert.equal(adCampaignMayHaveStats(finished('2026-01-28T08:48:34+03:00'), '2026-09-10', '2026-09-16'), false);
  assert.equal(adCampaignMayHaveStats(finished('2026-09-12T08:48:34+03:00'), '2026-09-10', '2026-09-16'), true);
  // У действующей кампании updated меняется от любой правки и концом не считается.
  assert.equal(adCampaignMayHaveStats(campaign('2025-05-02T08:23:29+03:00', '2100-01-01T00:00:00+03:00', { updated: '2026-01-28T08:48:34+03:00' }), '2026-09-10', '2026-09-16'), true);
});

test('складывает поисковые запросы кампании по всем артикулам и по каждому отдельно', () => {
  const result = summarizeKeywords([
    { nm_id: 100, stats: [{ norm_query: 'чехол magsafe', views: 1000, clicks: 40, spend: 200, atbs: 8, orders: 4, shks: 2, avg_pos: 4 },
      { norm_query: 'чехол', views: 500, clicks: 10, spend: 90, atbs: 2, orders: 1, shks: 0, avg_pos: 10 }] },
    { nm_id: 200, stats: [{ norm_query: 'чехол magsafe', views: 1000, clicks: 60, spend: 300, atbs: 12, orders: 6, shks: 4, avg_pos: 6 }] }
  ]);
  assert.deepEqual(result.total.map(row => row.query), ['чехол magsafe', 'чехол']);
  const top = result.total[0];
  assert.equal(top.views, 2000);
  assert.equal(top.clicks, 100);
  assert.equal(top.ctr, 5);
  assert.equal(top.cpm, 250);
  assert.equal(top.avgPosition, 5);
  assert.equal(result.byNmId['200'].length, 1);
  assert.equal(result.byNmId['100'][1].query, 'чехол');
});

test('отмечает неактивные и архивные поисковые запросы', () => {
  const groups = [
    { nm_id: 100, stats: [{ norm_query: 'чехол', views: 100 }, { norm_query: 'чехол magsafe', views: 50 }, { norm_query: 'чехол кожаный', views: 10 }] },
    { nm_id: 200, stats: [{ norm_query: 'чехол', views: 80 }] }
  ];
  const statuses = new Map([
    ['100', { active: new Set(), excluded: new Set(['чехол', 'чехол magsafe']), archived: new Set(['чехол кожаный']) }],
    ['200', { active: new Set(['чехол']), excluded: new Set(), archived: new Set() }]
  ]);
  const result = summarizeKeywords(groups, statuses);
  const byQuery = Object.fromEntries(result.total.map(row => [row.query, row]));
  assert.equal(byQuery['чехол'].status, 'active');
  assert.equal(byQuery['чехол'].excludedIn, 1);
  assert.equal(byQuery['чехол magsafe'].status, 'excluded');
  assert.equal(byQuery['чехол кожаный'].status, 'archived');
  assert.equal(result.byNmId['100'].find(row => row.query === 'чехол').status, 'excluded');
  assert.equal(summarizeKeywords(groups).total[0].status, '');
});

test('добавляет выключенные кластеры без показов отдельными строками', () => {
  const groups = [{ nm_id: 100, stats: [{ norm_query: 'чехол', views: 120, clicks: 5 }] }];
  const statuses = new Map([['100', { active: new Set(['чехол']), excluded: new Set(['чехол кожаный']), archived: new Set(['чехол старый']) }]]);
  const result = summarizeKeywords(groups, statuses);
  assert.equal(result.total.length, 3);
  const off = result.total.find(row => row.query === 'чехол кожаный');
  assert.equal(off.status, 'excluded');
  assert.equal(off.views, 0);
  assert.equal(result.total.find(row => row.query === 'чехол старый').status, 'archived');
  assert.equal(result.total[0].query, 'чехол');
  assert.equal(result.byNmId['100'].length, 3);
});

test('по CPC-кампаниям показы, CTR и CPM ключевых запросов неизвестны, а не нулевые', () => {
  // Так WB отвечает по кампаниям с оплатой за клики: полей views, ctr и cpm в строках нет.
  const groups = [{ nm_id: 100, stats: [{ norm_query: 'утюжок', clicks: 52, spend: 529.13, atbs: 8, orders: 0, avg_pos: 32.9 }] }];
  const statuses = new Map([['100', { active: new Set(['утюжок']), excluded: new Set(['плойка']), archived: new Set() }]]);
  const result = summarizeKeywords(groups, statuses);
  const row = result.total.find(item => item.query === 'утюжок');
  assert.equal(row.views, null);
  assert.equal(row.ctr, null);
  assert.equal(row.cpm, null);
  assert.equal(row.clicks, 52);
  assert.equal(Math.round(row.cpc * 100) / 100, 10.18);
  assert.equal(result.total.find(item => item.query === 'плойка').views, null);
});

test('строит матрицу продаж по дням и артикулам', () => {
  const days = [
    { date: '2026-09-01', products: { '100': [10, 2, 3, 4500, 1, 1500, 0], '200': [5, 1, 1, 1500, 0, 0, 0] } },
    { date: '2026-09-02', products: { '100': [8, 1, 1, 1500, 1, 1500, 0] } }
  ];
  const dates = ['2026-09-01', '2026-09-02', '2026-09-03'];
  const matrix = funnelSalesMatrix(days, dates, null, 'orderCount');
  assert.deepEqual(matrix.products.map(product => product.nmId), ['100', '200']);
  assert.deepEqual(matrix.products[0].values, [3, 1, null]);
  assert.equal(matrix.products[0].total, 4);
  assert.deepEqual(matrix.totals, [4, 1, null]);
  assert.equal(matrix.total, 5);
  const filtered = funnelSalesMatrix(days, dates, ['200'], 'orderSum');
  assert.deepEqual(filtered.products.map(product => product.nmId), ['200']);
  assert.deepEqual(filtered.products[0].values, [1500, 0, null]);
});

test('возвраты в ленте заказов получают свой статус, а не «новый»', () => {
  const rows = normalizeOrderFeed({ data: { currency: 'RUB', orders: [
    { srid: 'a', status: 'return', createdAt: '2026-09-09T19:40:00Z', updatedAt: '2026-09-17T23:12:00Z' },
    { srid: 'b', status: 'returnDefective', createdAt: '2026-09-14T07:29:00Z', updatedAt: '2026-09-19T12:59:00Z' },
    { srid: 'c', status: 'created', createdAt: '2026-09-18T07:00:00Z', updatedAt: '2026-09-18T07:00:00Z' }
  ] } });
  const byId = Object.fromEntries(rows.map(row => [row.id, row]));
  assert.equal(byId.a.status, 'return');
  assert.equal(byId.b.status, 'return');
  assert.equal(byId.b.rawStatus, 'returnDefective');
  assert.equal(byId.c.status, 'new');
});

const summaryItem = (nmId, current, previous) => ({ nmId, name: `Товар ${nmId}`, vendorCode: `V-${nmId}`, photo: '',
  current: { openCount: 0, cartCount: 0, orderCount: 0, orderSum: 0, buyoutCount: 0, buyoutSum: 0, addToWishlistCount: 0, ...current },
  previous: { openCount: 0, cartCount: 0, orderCount: 0, orderSum: 0, buyoutCount: 0, buyoutSum: 0, addToWishlistCount: 0, ...previous } });

test('сводка собирает товары из разбивки воронки и подставляет карточки', () => {
  const products = summaryProducts({ products: { 11: [100, 10, 4, 4000, 2, 2000, 1] } }, { products: { 12: [50, 5, 2, 900, 1, 450, 0] } },
    [{ nmID: 11, title: 'Худи', vendorCode: 'H-1', photos: [{ c246x328: 'photo.webp' }] }]);
  const byId = Object.fromEntries(products.map(item => [item.nmId, item]));
  assert.equal(byId[11].name, 'Худи');
  assert.equal(byId[11].photo, 'photo.webp');
  assert.equal(byId[11].current.orderSum, 4000);
  assert.equal(byId[11].previous.orderCount, 0);
  assert.equal(byId[12].name, 'Товар 12');
  assert.equal(byId[12].previous.orderSum, 900);
});

test('структура заказов: лидеры, «Прочие» и доли прошлого периода', () => {
  const products = [1, 2, 3, 4, 5, 6, 7].map(nmId => summaryItem(nmId, { orderSum: nmId * 100, orderCount: nmId }, { orderSum: 100, orderCount: 1 }));
  products.push(summaryItem(8, {}, { orderSum: 300 }));
  const top = summaryTopProducts(products, 5);
  assert.equal(top.total, 2800);
  assert.equal(top.previousTotal, 1000);
  assert.deepEqual(top.items.map(item => item.nmId), [7, 6, 5, 4, 3]);
  assert.equal(Math.round(top.items[0].share * 100) / 100, 25);
  assert.equal(top.items[0].previousShare, 10);
  assert.equal(top.other.count, 2);
  assert.equal(top.other.orderSum, 300);
  assert.equal(top.other.previousShare, 50);
});

test('просадки: падение заказов, переходов и конверсии, без шума на малых числах', () => {
  const drops = summaryDrops([
    summaryItem(1, { openCount: 400, orderCount: 4, orderSum: 4000 }, { openCount: 420, orderCount: 12, orderSum: 12000 }),
    summaryItem(2, { openCount: 90, orderCount: 5, orderSum: 5000 }, { openCount: 300, orderCount: 5, orderSum: 5000 }),
    summaryItem(3, { openCount: 10, orderCount: 1, orderSum: 100 }, { openCount: 20, orderCount: 2, orderSum: 200 }),
    summaryItem(4, { openCount: 500, orderCount: 20, orderSum: 20000 }, { openCount: 480, orderCount: 21, orderSum: 21000 })
  ]);
  assert.equal(drops.total, 2);
  assert.deepEqual(drops.items.map(item => item.nmId), [1, 2]);
  assert.equal(drops.items[0].lostSum, 8000);
  assert.equal(drops.items[0].severity, 'high');
  assert.deepEqual(drops.items[0].reasons.map(reason => reason.metric).sort(), ['orderConversion', 'orderCount']);
  assert.deepEqual(drops.items[1].reasons.map(reason => reason.metric), ['openCount']);
  assert.equal(drops.items[1].severity, 'high');
});

test('выгрузка кампании обрезается по дате создания и настоящей дате удаления', () => {
  const period = { from: '2026-06-01', to: '2026-09-23' };
  const active = { timestamps: { created: '2026-07-13T23:40:00+03:00', deleted: '2100-01-01T00:00:00+03:00' } };
  assert.deepEqual(campaignActivePeriod(active, period), { from: '2026-07-13', to: '2026-09-23' });
  const finished = { timestamps: { created: '2026-05-10T10:00:00+03:00', deleted: '2026-08-04T08:45:00+03:00' } };
  assert.deepEqual(campaignActivePeriod(finished, period), { from: '2026-06-01', to: '2026-08-04' });
  assert.equal(campaignActivePeriod({ timestamps: { created: '2026-09-30T10:00:00+03:00' } }, period), null);
  assert.equal(campaignActivePeriod({ timestamps: { created: '2026-01-01T10:00:00+03:00', deleted: '2026-03-01T10:00:00+03:00' } }, period), null);
  assert.deepEqual(campaignActivePeriod({}, period), period);
});

test('рекламные кампании и товары получают CPO, CR, CPM и добавления в корзину', () => {
  const stats = [{ advertId: 1, views: 2000, clicks: 50, sum: 600, orders: 4, sum_price: 8000, atbs: 12,
    days: [{ date: '2026-09-20T00:00:00+03:00', views: 2000, clicks: 50, sum: 600, orders: 4, sum_price: 8000, atbs: 12,
      apps: [{ appType: 32, views: 2000, clicks: 50, sum: 600, orders: 4, sum_price: 8000, atbs: 12,
        nms: [{ nmId: 11, name: 'Товар', views: 2000, clicks: 50, sum: 600, orders: 4, sum_price: 8000, atbs: 12 }] }] }] }];
  const summary = summarizeAdStats([{ id: 1, status: 9, settings: { name: 'Кампания' } }], stats, '2026-09-20', '2026-09-20');
  for (const row of [summary.campaigns[0], summary.products[0]]) {
    assert.equal(row.cpo, 150);
    assert.equal(row.cr, 8);
    assert.equal(row.cpm, 300);
    assert.equal(row.carts, 12);
  }
  const empty = summarizeAdStats([{ id: 2, status: 9 }], [], '2026-09-20', '2026-09-20').campaigns[0];
  assert.equal(empty.cpo, 0);
});

test('минус-фразы: исключение добавляет к текущему списку, включение убирает только выбранные', () => {
  const before = ['расческа выпрямитель', 'плойка детская'];
  assert.deepEqual(mergeMinusList(before, ['плойки', 'расческа выпрямитель'], 'exclude'), ['расческа выпрямитель', 'плойка детская', 'плойки']);
  assert.deepEqual(mergeMinusList(before, ['плойка детская', 'фен'], 'include'), ['расческа выпрямитель']);
  assert.deepEqual(mergeMinusList([], ['фен'], 'include'), []);
});

test('статистика ключевого запроса по дням: суммирует товары, заполняет пустые дни, без показов у CPC', () => {
  const items = [
    { nmId: 1, dailyStats: [{ date: '2026-10-01', stat: { normQuery: 'фен', views: 100, clicks: 10, spend: 50, atbs: 2, orders: 1, avgPos: 4 } },
      { date: '2026-10-01', stat: { normQuery: 'утюжок', views: 999, clicks: 99 } }] },
    { nmId: 2, dailyStats: [{ date: '2026-10-01', stat: { normQuery: 'фен', views: 300, clicks: 20, spend: 70, atbs: 1, orders: 0, avgPos: 8 } }] }];
  const result = summarizeKeywordDaily(items, 'фен', ['2026-10-01', '2026-10-02']);
  assert.equal(result.days.length, 2);
  assert.deepEqual([result.days[0].views, result.days[0].clicks, result.days[0].spend, result.days[0].carts], [400, 30, 120, 3]);
  assert.equal(result.days[0].avgPosition, 7);
  assert.equal(result.days[1].clicks, 0);
  const cpc = summarizeKeywordDaily([{ dailyStats: [{ date: '2026-10-01', stat: { normQuery: 'фен', clicks: 5, spend: 40 } }] }], 'фен', ['2026-10-01']);
  assert.equal(cpc.viewsAvailable, false);
  assert.equal(cpc.days[0].views, null);
  assert.equal(cpc.days[0].cpc, 8);
});

test('средняя позиция кампании по дням взвешивается по показам кластеров, пустые дни — null', () => {
  const items = [{ dailyStats: [
    { date: '2026-10-01', stat: { normQuery: 'фен', views: 300, avgPos: 4 } },
    { date: '2026-10-01', stat: { normQuery: 'утюжок', views: 100, avgPos: 12 } },
    { date: '2026-10-01', stat: { normQuery: 'плойка', views: 50 } }] }];
  assert.deepEqual(summarizePositionDaily(items, ['2026-10-01', '2026-10-02']), [{ date: '2026-10-01', avgPosition: 6 }, { date: '2026-10-02', avgPosition: null }]);
  const cpc = [{ dailyStats: [{ date: '2026-10-01', stat: { normQuery: 'фен', avgPos: 3 } }, { date: '2026-10-01', stat: { normQuery: 'утюжок', avgPos: 9 } }] }];
  assert.equal(summarizePositionDaily(cpc, ['2026-10-01'])[0].avgPosition, 6);
});
