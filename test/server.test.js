'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOrders, normalizeOrderFeed, enrichOrders, extractFunnel, summarizeAdStats, validAdPeriod, WB_HOSTS } = require('../server');

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
});

test('не разрешает период рекламной статистики больше 31 дня', () => {
  assert.deepEqual(validAdPeriod('2026-08-01', '2026-08-31'), { from: '2026-08-01', to: '2026-08-31' });
  assert.throws(() => validAdPeriod('2026-07-01', '2026-08-01'), /не более 31 дня/);
});
