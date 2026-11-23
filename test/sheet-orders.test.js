const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Копия во временной папке: data/ не трогается. Адрес и ключ таблицы — выдуманные, запросы перехватывает fetch ниже.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-orders-'));
process.env.WB_SHEET_DIR = dir;
process.env.WB_SHEET_URL = 'https://script.google.com/macros/s/test/exec';
process.env.WB_SHEET_KEY = 'test-key';
const { saveSheetOrders, syncSheetOrders } = require('../server/sheet/sheet');

const order = (srid, status, updatedAt, extra = {}) => ({
  cabinet: 'Samiri',
  srid,
  nmId: 100,
  createdAt: '2026-11-01T07:00:00.000Z',
  status,
  statusAt: updatedAt,
  updatedAt,
  ...extra
});
const read = (cabinet, month) => JSON.parse(fs.readFileSync(path.join(dir, cabinet, 'Заказы', `${month}.json`), 'utf8')).items;

test('копия «Заказов»: новые дописываются, свежие заменяют, старые не удаляются', () => {
  assert.deepEqual(
    saveSheetOrders([
      order('1', 'Оформлен', '2026-11-01T07:00:00.000Z'),
      order('2', 'Отменён', '2026-11-01T09:00:00.000Z', { cancelType: 'Отказ при получении' }),
      order('3', 'Оформлен', '2026-10-30T07:00:00.000Z', { createdAt: '2026-10-30T07:00:00.000Z' })
    ]),
    { added: 3, updated: 0 }
  );
  assert.equal(read('Samiri', '2026-11').length, 2);
  assert.equal(read('Samiri', '2026-10').length, 1);
  // Заказ 1 выкуплен; устаревшая строка заказа 2 не затирает свежую; заказа 3 в порции нет — он остаётся.
  assert.deepEqual(
    saveSheetOrders([
      order('1', 'Выкуплен', '2026-11-03T12:00:00.000Z', { buyoutAt: '2026-11-03T12:00:00.000Z' }),
      order('2', 'Оформлен', '2026-11-01T07:00:00.000Z')
    ]),
    { added: 0, updated: 1 }
  );
  const november = Object.fromEntries(read('Samiri', '2026-11').map(item => [item.srid, item]));
  assert.equal(november['1'].status, 'Выкуплен');
  assert.equal(november['1'].buyoutAt, '2026-11-03T12:00:00.000Z');
  assert.equal(november['2'].status, 'Отменён');
  assert.equal(read('Samiri', '2026-10').length, 1);
  // Повтор той же строки — без изменений.
  assert.deepEqual(saveSheetOrders([november['1']]), { added: 0, updated: 0 });
});

test('дозагрузка «Заказов»: порции, отметка, ответ старой версии скрипта', async () => {
  const asked = [];
  global.fetch = async url => {
    const target = new URL(url);
    asked.push(Object.fromEntries(target.searchParams));
    const offset = Number(target.searchParams.get('offset'));
    const pages = [
      { orders: [order('10', 'Оформлен', '2026-11-20T10:00:00.000Z')], more: true },
      { orders: [order('11', 'Возвращён (брак)', '2026-11-21T10:00:00.000Z')], more: false }
    ];
    return { json: async () => pages[offset ? 1 : 0] };
  };
  let result = await syncSheetOrders();
  assert.equal(result.lastError, '');
  assert.equal(result.added, 2);
  assert.equal(result.cursor, '2026-11-21T10:00:00.000Z');
  assert.deepEqual(
    asked.map(item => [item.orders, item.offset, item.after]),
    [
      ['1', '0', undefined],
      ['1', '1', undefined]
    ]
  );
  // Следующая дозагрузка — с after (минус минута от отметки).
  asked.length = 0;
  result = await syncSheetOrders();
  assert.equal(asked[0].after, '2026-11-21T09:59:00.000Z');
  // Старая версия скрипта отдаёт историю (items), а не orders — ошибка, отметка прежняя.
  global.fetch = async () => ({ json: async () => ({ items: [{ at: '2026-11-21T10:00:00.000Z' }], current: null }) });
  result = await syncSheetOrders();
  assert.match(result.lastError, /обновите развёртывание/);
  assert.equal(result.cursor, '2026-11-21T10:00:00.000Z');
  fs.rmSync(dir, { recursive: true, force: true });
});
