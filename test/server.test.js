'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOrders, extractFunnel, WB_HOSTS } = require('../server');

test('объединяет и сортирует FBS и статистические заказы', () => {
  const result = normalizeOrders(
    { orders: [{ id: 1, nmId: 11, createdAt: '2026-08-12T10:00:00Z', price: 5000 }] },
    [{ srid: 's2', nmId: 12, date: '2026-08-13T10:00:00Z', totalPrice: 100 }]
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 's2');
  assert.equal(result[1].source, 'FBS');
});

test('суммирует показатели воронки разных товаров', () => {
  const result = extractFunnel({ data: { products: [
    { statistic: { selected: { openCardCount: 100, addToCartCount: 20, ordersCount: 5, buyoutsCount: 4, buyoutsSumRub: 2000 } } },
    { statistic: { selected: { openCardCount: 50, addToCartCount: 10, ordersCount: 3, buyoutsCount: 2, buyoutsSumRub: 1000 } } }
  ] } });
  assert.deepEqual(result, { views: 150, cart: 30, orders: 8, sales: 6, revenue: 3000, currency: 'RUB' });
});

test('разрешает только известные официальные хосты WB', () => {
  assert.equal(WB_HOSTS.has('marketplace-api.wildberries.ru'), true);
  assert.equal(WB_HOSTS.has('example.com'), false);
});
