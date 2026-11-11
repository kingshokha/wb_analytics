const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const createSimaProfit = require('../sima-profit');
const { listPrice, nextPrice } = createSimaProfit;

test('применение цен: цена до скидки — целая, со скидкой не ниже нужной; снижение — не больше 30% за загрузку', () => {
  assert.equal(listPrice(598.29, 0), 599);
  assert.equal(listPrice(1000, 50), 2000, 'ровно — без лишнего рубля');
  assert.equal(listPrice(43179.66, 49), 84666);
  assert.ok(listPrice(777.77, 47) * 0.53 >= 777.77);
  assert.equal(nextPrice(1000, 400), 700);
  assert.equal(nextPrice(700, 400), 490);
  assert.equal(nextPrice(490, 400), 400);
  assert.equal(nextPrice(1000, 800), 800);
  assert.equal(nextPrice(500, 2000), 2000, 'повышение — сразу');
});

// WB подменён: цены кабинета, загрузки, их состояние и детализация. Товар 1 снижается ступенями 1000 → 700 → 490 → 400,
// товар 2 повышается сразу, товар 3 WB отправляет в карантин, товару 4 цена уже нужная, товара 5 нет в WB.
test('применение цен: ступени, карантин, файл отката, ход и итог задачи', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-sima-apply-')), uploads = [], changed = [];
  const goods = [
    { nmID: 1, vendorCode: '1011/1/ШДФ', discount: 0, sizes: [{ price: 1000, discountedPrice: 1000 }] },
    { nmID: 2, vendorCode: '1012/1/ШДФ', discount: 50, sizes: [{ price: 1000, discountedPrice: 500 }] },
    { nmID: 3, vendorCode: '1013/1/ШДФ', discount: 0, sizes: [{ price: 1000, discountedPrice: 1000 }] },
    { nmID: 4, vendorCode: '1014/1/ШДФ', discount: 0, sizes: [{ price: 300, discountedPrice: 300 }] }];
  let polls = 0;
  const wbRequest = async (token, url, options = {}) => {
    if (url.endsWith('/api/v2/upload/task')) { uploads.push(options.body.data); return { data: { id: uploads.length, alreadyExists: false }, error: false }; }
    const id = Number(new URL(url).searchParams.get('uploadID'));
    if (url.includes('/history/tasks')) { polls++; if (polls === 1) throw Object.assign(new Error('not found'), { status: 400 }); return { data: { uploadID: id, status: id === 1 ? 5 : 3 } }; }
    if (url.includes('/history/goods/task')) return { data: { uploadID: id, historyGoods: [{ nmID: 1, status: 2 }, { nmID: 3, status: 3, errorText: 'New price is several times lower than the current price. Item has been moved to Price Quarantine' }] } };
    throw new Error(`лишний запрос ${url}`);
  };
  const module = createSimaProfit({ send: (res, status, payload) => Object.assign(res, { status, payload }), apiError: (status, message) => Object.assign(new Error(message), { status }),
    readJson: async req => req.body, cabinets: () => [{ id: '1', name: 'ИП Тест' }], tokenFor: () => 't', wbRequest, analyticsCache: new Map(), loadPriceGoods: async () => goods,
    pricesChanged: id => changed.push(id), dir, root: dir, pause: async () => {} });
  try {
    const res = {};
    await module.handle({ method: 'POST', body: { cabinet: '1', confirm: true, items: [{ nmId: 1, target: 400 }, { nmId: 2, target: 800 }, { nmId: 3, target: 900 }, { nmId: 4, target: 300 }, { nmId: 5, target: 100 }, { nmId: 'x', target: 1 }] } }, res, new URL('http://local/api/sima-profit/apply'));
    assert.equal(res.payload.job.running, true);
    assert.equal(res.payload.job.total, 5, 'неверная строка отброшена');
    await assert.rejects(Promise.resolve().then(() => module.apply({ cabinet: '1', confirm: true, items: [{ nmId: 1, target: 1 }] })), /уже меняются/);
    for (let i = 0; i < 100 && module.job('1').running; i++) await new Promise(resolve => setImmediate(resolve));
    const job = module.job('1');
    assert.equal(job.running, false, job.error);
    assert.deepEqual(uploads, [
      [{ nmID: 1, price: 700, discount: 0 }, { nmID: 2, price: 1600, discount: 50 }, { nmID: 3, price: 900, discount: 0 }],
      [{ nmID: 1, price: 490, discount: 0 }],
      [{ nmID: 1, price: 400, discount: 0 }]]);
    assert.deepEqual({ raised: job.raised, lowered: job.lowered, unchanged: job.unchanged, steps: job.steps, planned: job.planned }, { raised: 1, lowered: 1, unchanged: 1, steps: 3, planned: 3 });
    assert.deepEqual(job.errors.map(item => item.nmId), [5, 3]);
    assert.match(job.errors[1].text, /Карантин цен/);
    assert.deepEqual(changed, ['1'], 'список цен кабинета сброшен');
    const rollback = fs.readFileSync(path.join(dir, job.rollback), 'utf8');
    assert.match(job.rollback, /^Откаты цен[\\/]Откат цен ИП Тест \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.csv$/);
    assert.equal(rollback, '﻿Арт. WB;Арт. продавца;Цена до скидки;Скидка, %;Цена со скидкой;Новая цена до скидки\n1;"1011/1/ШДФ";1000;0;1000;400\n2;"1012/1/ШДФ";1000;50;500;1600\n3;"1013/1/ШДФ";1000;0;1000;900\n');
    const state = {};
    await module.handle({ method: 'GET' }, state, new URL('http://local/api/sima-profit/apply?cabinet=1'));
    assert.equal(state.payload.job.lowered, 1);
    await assert.rejects(Promise.resolve().then(() => module.apply({ cabinet: 'demo', confirm: true, items: [{ nmId: 1, target: 1 }] })), /демо/);
    await assert.rejects(Promise.resolve().then(() => module.apply({ cabinet: '1', items: [{ nmId: 1, target: 1 }] })), /подтверждение/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
