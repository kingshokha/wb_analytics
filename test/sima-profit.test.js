const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const createSimaProfit = require('../sima-profit');
const { simaSid, boxTariff, profitRows } = createSimaProfit;

// public/sima-profit.js — скрипт страницы: запускается в отдельном контексте, из него берутся функции расчёта.
function pageScript() {
  const context = vm.createContext({ document: { addEventListener() {} }, localStorage: { getItem: () => null }, pageSizeFor: () => 50 });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'sima-profit.js'), 'utf8'), context);
  return context;
}
const TARIFF = { base: 78.2, liter: 23.8, coef: 170, small: [[0.2, 23], [0.4, 26], [0.6, 29], [0.8, 30], [1, 32]] };
const SETTINGS = { target: 20, tax: 6, assembly: 50, cost: 'wholesale' };
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.01, `${label}: ${actual} ≠ ${expected}`);

test('прибыль Сималенда: артикул Сималенда из артикула продавца, тариф склада из ответа WB', () => {
  assert.equal(simaSid('6938164/125/ШДФ'), '6938164');
  assert.equal(simaSid('10065885/1250,5/ШДФ'), '10065885');
  assert.equal(simaSid('271317'), '271317');
  assert.equal(simaSid('205-132/L'), '');
  assert.equal(simaSid(''), '');
  const response = { response: { data: { warehouseList: [
    { warehouseName: 'Свой склад СГТ РФ', boxDeliveryMarketplaceBase: '46', boxDeliveryMarketplaceLiter: '14', boxDeliveryMarketplaceCoefExpr: '100' },
    { warehouseName: 'Свой склад РФ', boxDeliveryMarketplaceBase: '78,2', boxDeliveryMarketplaceLiter: '23,8', boxDeliveryMarketplaceCoefExpr: '170' }] } } };
  assert.deepEqual(boxTariff(response), { base: 78.2, liter: 23.8, coef: 170 });
  assert.equal(boxTariff({ response: { data: { warehouseList: [{ warehouseName: 'Свой склад РФ', boxDeliveryMarketplaceBase: '-', boxDeliveryMarketplaceLiter: '-', boxDeliveryMarketplaceCoefExpr: '-' }] } } }), null);
  assert.equal(boxTariff(null), null);
});

test('прибыль Сималенда: строки — цена WB, комиссия FBS предмета, объём упаковки и состояние цены Сималенда', () => {
  const card = (nmID, vendorCode, subjectID = 7) => ({ nmID, vendorCode, subjectID, subjectName: 'Кружки', title: `Товар ${nmID}`, dimensions: { length: 11, width: 12, height: 7 } });
  const cards = [card(1, '1011/105/ШДФ'), card(2, '1012/90/ШДФ'), card(3, '1013/1/ШДФ'), card(4, '1014/1/ШДФ'), card(5, '1015/1/ШДФ', 99), card(6, '205-132/L')];
  const goods = [{ nmID: 1, sizes: [{ price: 2000, discountedPrice: 1744 }] }, { nmID: 2, sizes: [{ discountedPrice: 500 }] }];
  const sima = { sids: ['1011', '1012', '1013', '1014'], failed: ['1013'], found: { 1011: { name: 'Кружка', price: 140, wholesale_price: 105, balance: null, isEnough: true }, 1012: { name: 'Нет', price: 0, wholesale_price: 0, balance: 0 } } };
  const rows = profitRows(cards, goods, [{ subjectID: 7, kgvpMarketplace: 39, paidStorageKgvp: 33.5 }], sima, value => `photo-${value.nmID}`);
  assert.deepEqual(rows.map(row => row.sid), ['1011', '1012', '1013', '1014', '1015'], 'товар без артикула Сималенда не попадает');
  assert.deepEqual({ ...rows[0], sima: { ...rows[0].sima } }, { nmId: 1, name: 'Товар 1', photo: 'photo-1', subject: 'Кружки', vendorCode: '1011/105/ШДФ', sid: '1011', price: 1744, commission: 39, volume: 0.924,
    sima: { status: 'ok', name: 'Кружка', wholesale: 105, retail: 140, inStock: true } });
  assert.deepEqual(rows.map(row => row.sima.status), ['ok', 'noPrice', 'failed', 'missing', 'notListed']);
  assert.equal(rows[1].sima.inStock, false);
  assert.equal(rows[2].price, null, 'нет в ценах WB');
  assert.equal(rows[4].commission, null, 'нет комиссии предмета');
  assert.equal(profitRows([card(1, '1011/1/ШДФ')], [], [], null)[0].sima.status, 'notLoaded');
});

test('прибыль Сималенда: расчёт страницы совпадает с формулами таблицы «Артикулы … с логистикой»', () => {
  const { simaProfitCalc, simaLogistics } = pageScript();
  // Строки 2 и 3 таблицы: до литра — ступень × 1,7, больше литра — 78,2 + 23,8 за каждый следующий литр.
  const first = simaProfitCalc({ price: 1744, commission: 39, volume: 0.924, sima: { wholesale: 105, retail: 140 } }, SETTINGS, TARIFF);
  near(first.logistics, 54.4, 'логистика'); near(first.tax, 104.64, 'налог'); near(first.fee, 680.16, 'комиссия');
  near(first.profit, 749.8, 'чистая прибыль'); assert.equal(first.need, 598.29); near(first.diff, -65.694, 'отличие, %');
  const second = simaProfitCalc({ price: 2142, commission: 43, volume: 1.35, sima: { wholesale: 94.5 } }, SETTINGS, TARIFF);
  near(second.logistics, 86.53, 'логистика больше литра'); near(second.profit, 861.39, 'чистая прибыль'); assert.equal(second.need, 745.26);
  assert.deepEqual([0.2, 0.21, 0.4, 0.6, 0.8, 1].map(volume => Math.round(simaLogistics(volume, TARIFF) * 100) / 100), [39.1, 44.2, 44.2, 49.3, 51, 54.4]);
  assert.equal(simaLogistics(null, TARIFF), null);
  // Закупка по обычной цене; налог, комиссия и желаемая прибыль ≥ 100% — «недостижимо».
  assert.equal(simaProfitCalc({ price: 1744, commission: 39, volume: 0.924, sima: { wholesale: 105, retail: 140 } }, { ...SETTINGS, cost: 'retail' }, TARIFF).cost, 140);
  assert.equal(simaProfitCalc({ price: 1000, commission: 60, volume: 2, sima: { wholesale: 10 } }, { ...SETTINGS, target: 40 }, TARIFF).need, 'unreachable');
  // Без цены Сималенда — только налог и комиссия, прибыли нет.
  const noSima = simaProfitCalc({ price: 1000, commission: 30, volume: 2, sima: { wholesale: null } }, SETTINGS, TARIFF);
  assert.deepEqual([noSima.tax, noSima.fee, noSima.profit, noSima.need], [60, 300, null, null]);
});

test('прибыль Сималенда: маршрут — данные кабинета, запасной тариф логистики и предупреждения, демо-кабинет', async () => {
  const requests = [];
  const cache = new Map();
  const deps = { send: (res, status, payload) => Object.assign(res, { status, payload }), apiError: (status, message) => Object.assign(new Error(message), { status }),
    cabinets: () => [{ id: '1' }], tokenFor: () => 't', analyticsCache: cache, cachedAnalytics: async (key, loader) => loader(), cardPhoto: () => '',
    productCards: async () => [{ nmID: 1, vendorCode: '1011/1/ШДФ', subjectID: 7, dimensions: { length: 10, width: 10, height: 10 } }],
    loadPriceGoods: async () => [{ nmID: 1, sizes: [{ discountedPrice: 900 }] }],
    wbRequest: async (token, url) => { requests.push(url); if (url.includes('commission')) return { report: [{ subjectID: 7, kgvpMarketplace: 30 }] }; throw Object.assign(new Error('WB API вернул 429'), { status: 429 }); },
    simaLand: { configured: () => true, refreshing: () => false, prices: () => ({ at: '2026-11-11T10:00:00.000Z', sids: ['1011'], found: { 1011: { price: 120, wholesale_price: 100 } }, failed: [] }) },
    today: () => '2026-11-11' };
  const module = createSimaProfit(deps), res = {};
  assert.equal(await module.handle({ method: 'GET' }, res, new URL('http://local/api/sima-profit?cabinet=1')), true);
  assert.deepEqual(requests, ['https://common-api.wildberries.ru/api/v1/tariffs/commission?locale=ru', 'https://common-api.wildberries.ru/api/v1/tariffs/box?date=2026-11-11']);
  assert.deepEqual({ price: res.payload.rows[0].price, commission: res.payload.rows[0].commission, volume: res.payload.rows[0].volume, wholesale: res.payload.rows[0].sima.wholesale }, { price: 900, commission: 30, volume: 1, wholesale: 100 });
  assert.deepEqual([res.payload.tariff.base, res.payload.tariff.liter, res.payload.tariff.coef, res.payload.simaAt, res.payload.cards], [78.2, 23.8, 170, '2026-11-11T10:00:00.000Z', 1]);
  assert.match(res.payload.warnings.join(' | '), /Тарифы логистики WB не загрузились: WB API вернул 429 \| Логистика посчитана по тарифу 78,2 ₽/);
  const demo = createSimaProfit({ ...deps, cabinets: () => [] }), demoRes = {};
  await demo.handle({ method: 'GET' }, demoRes, new URL('http://local/api/sima-profit'));
  assert.equal(demoRes.payload.demo, true);
  await assert.rejects(module.handle({ method: 'GET' }, {}, new URL('http://local/api/sima-profit/x')), /Нет такого метода/);
});
