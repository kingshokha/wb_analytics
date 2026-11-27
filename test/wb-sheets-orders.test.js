const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Поддельный лист Google: сетка значений, вставка строк после заголовка, удаление пустых столбцов и строк.
function fakeSheet() {
  const sheet = { rows: [], maxColumns: 26, maxRows: 1000, frozen: 0, formats: [] };
  const width = () => sheet.maxColumns;
  const range = (row, column, rowCount = 1, columnCount = 1) => ({
    getValues: () =>
      Array.from({ length: rowCount }, (_, r) =>
        Array.from({ length: columnCount }, (_, c) => (sheet.rows[row - 1 + r] || [])[column - 1 + c] ?? '')
      ),
    setValues(values) {
      values.forEach((line, r) => {
        const target = (sheet.rows[row - 1 + r] = sheet.rows[row - 1 + r] || []);
        line.forEach((value, c) => (target[column - 1 + c] = value));
      });
      return this;
    },
    setNumberFormat(format) {
      sheet.formats.push({ row, column, rowCount, format });
      return this;
    },
    setFontWeight() {
      return this;
    },
    setBackground() {
      return this;
    }
  });
  Object.assign(sheet, {
    getRange: range,
    getLastRow: () => {
      for (let i = sheet.rows.length; i > 0; i--)
        if ((sheet.rows[i - 1] || []).some(value => value !== '' && value !== undefined)) return i;
      return 0;
    },
    getMaxColumns: width,
    getMaxRows: () => sheet.maxRows,
    deleteColumns: (from, count) => (sheet.maxColumns -= count),
    deleteRows: (from, count) => (sheet.maxRows -= count),
    insertRowsAfter: (after, count) => {
      sheet.rows.splice(after, 0, ...Array.from({ length: count }, () => []));
      sheet.maxRows += count;
    },
    setFrozenRows: count => (sheet.frozen = count)
  });
  return sheet;
}

function script() {
  const sheets = {};
  const book = {
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = fakeSheet())
  };
  const context = vm.createContext({ SpreadsheetApp: { getActive: () => book }, Utilities: { sleep() {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-sheets', 'wb-sheets.gs'), 'utf8'), context);
  return { context, book, sheets };
}

const cards = { 100: { vendorCode: 'ART-1', title: 'Чайник' } };
const order = (srid, status, updatedAt, extra = {}) => ({
  srid,
  nmId: 100,
  chrtId: 5,
  createdAt: '2026-11-01T10:00:00+03:00',
  updatedAt,
  status,
  warehouseName: 'Склад WB',
  warehouseRegion: '',
  isMp: false,
  destinationCity: 'Казань',
  destinationDistrict: 'Приволжский',
  sellerPrice: 1500,
  isB2b: false,
  ...extra
});

test('лист «Заказы»: строка на заказ, статусы дописываются, прошлые не затираются', () => {
  const { context, book, sheets } = script();
  const first = new Date('2026-11-02T00:00:00Z');
  let result = context.writeOrders(
    book,
    [
      {
        cabinet: 'Samiri',
        cards,
        orders: [
          order('1.1.0', 'created', '2026-11-01T10:00:00+03:00'),
          order('2.1.0', 'cancel', '2026-11-01T12:00:00+03:00', { cancelType: 'receipt' })
        ]
      }
    ],
    first
  );
  assert.deepEqual({ ...result }, { added: 2, updated: 0 });
  const sheet = sheets['Заказы'];
  // Лист создан ровно под 22 столбца, без 1000 пустых строк.
  assert.equal(sheet.maxColumns, 22);
  assert.equal(sheet.frozen, 1);
  assert.equal(sheet.rows[0][1], 'ID заказа');
  const byId = () => Object.fromEntries(sheet.rows.slice(1).map(row => [row[1], row]));
  let rows = byId();
  assert.equal(rows['1.1.0'][3], 'ART-1');
  assert.equal(rows['1.1.0'][19], 'Оформлен');
  assert.equal(rows['2.1.0'][15].toISOString(), '2026-11-01T09:00:00.000Z');
  assert.equal(rows['2.1.0'][16], 'Отказ при получении');
  assert.equal(rows['2.1.0'][19], 'Отменён');

  // Через час: первый заказ выкуплен, второй не менялся.
  const second = new Date('2026-11-02T01:00:00Z');
  result = context.writeOrders(
    book,
    [
      {
        cabinet: 'Samiri',
        cards,
        orders: [
          order('1.1.0', 'buyout', '2026-11-03T15:00:00+03:00'),
          order('2.1.0', 'cancel', '2026-11-01T12:00:00+03:00', { cancelType: 'receipt' })
        ]
      }
    ],
    second
  );
  assert.deepEqual({ ...result }, { added: 0, updated: 1 });
  rows = byId();
  assert.equal(sheet.rows.length, 3);
  assert.equal(rows['1.1.0'][14].toISOString(), '2026-11-03T12:00:00.000Z');
  assert.equal(rows['1.1.0'][19], 'Выкуплен');
  assert.equal(rows['1.1.0'][21].getTime(), second.getTime());
  assert.equal(rows['2.1.0'][21].getTime(), first.getTime());

  // Потом возврат брака: время выкупа остаётся, текущий статус — возврат.
  context.writeOrders(
    book,
    [{ cabinet: 'Samiri', cards, orders: [order('1.1.0', 'returnDefective', '2026-11-10T09:00:00+03:00')] }],
    new Date('2026-11-10T07:00:00Z')
  );
  rows = byId();
  assert.equal(rows['1.1.0'][14].toISOString(), '2026-11-03T12:00:00.000Z');
  assert.equal(rows['1.1.0'][18].toISOString(), '2026-11-10T06:00:00.000Z');
  assert.equal(rows['1.1.0'][19], 'Возвращён (брак)');

  // Тот же ID в другом кабинете — другой заказ; новые строки — сверху.
  context.writeOrders(
    book,
    [{ cabinet: 'ИП Зикри', cards: {}, orders: [order('1.1.0', 'created', '2026-11-11T09:00:00+03:00')] }],
    new Date('2026-11-11T07:00:00Z')
  );
  assert.equal(sheet.rows.length, 4);
  assert.equal(sheet.rows[1][0], 'ИП Зикри');
  assert.equal(sheet.rows[1][3], '');
});

test('«Убрать пустые столбцы»: только пустые столбцы справа на листах скрипта и только после «ОК»', () => {
  const make = (name, rows, columns, lastColumn) => ({
    name,
    rows,
    columns,
    lastColumn,
    getName: () => name,
    getMaxRows() {
      return this.rows;
    },
    getMaxColumns() {
      return this.columns;
    },
    getLastColumn() {
      return this.lastColumn;
    },
    deleteColumns(from, count) {
      assert.ok(from > this.lastColumn, 'удаляются только столбцы правее данных');
      this.columns -= count;
    }
  });
  const sheets = [make('История', 252000, 26, 8), make('Цены', 17000, 11, 11), make('Мой лист', 100, 26, 3)];
  let answer = 'cancel';
  const alerts = [];
  const ui = {
    ButtonSet: { OK: 'ok', OK_CANCEL: 'ok-cancel' },
    Button: { OK: 'ok' },
    alert: (...args) => (alerts.push(args), args.length > 2 && args[2] === 'ok-cancel' ? answer : 'ok')
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActive: () => ({ getSheets: () => sheets }), getUi: () => ui },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { sleep() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-sheets', 'wb-sheets.gs'), 'utf8'), context);
  context.trimEmptyColumns();
  assert.equal(sheets[0].columns, 26, '«Отмена» — ничего не удаляется');
  assert.match(alerts[0][1], /История: удалить 18 пустых столбцов после столбца 8/);
  assert.doesNotMatch(alerts[0][1], /Мой лист|Цены/);
  answer = 'ok';
  context.trimEmptyColumns();
  assert.deepEqual(
    sheets.map(sheet => sheet.columns),
    [8, 11, 26]
  );
  assert.match(alerts[alerts.length - 1][1], /Всего: /);
});

test('запросы к WB: «Адрес недоступен» повторяется с паузами, потом ошибка с числом попыток', () => {
  const pauses = [];
  let failures = 2,
    calls = 0;
  const response = { getResponseCode: () => 200, getContentText: () => '{"ok":true}' };
  const context = vm.createContext({
    UrlFetchApp: {
      fetch: () => {
        calls++;
        if (failures-- > 0) throw new Error('Адрес недоступен: https://content-api.wildberries.ru/content/v2/get/cards/list');
        return response;
      }
    },
    Utilities: { sleep: ms => pauses.push(ms) }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-sheets', 'wb-sheets.gs'), 'utf8'), context);
  assert.deepEqual({ ...context.wbFetch('https://content-api.wildberries.ru/x', 'token', {}) }, { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [2000, 5000]);
  failures = 10;
  calls = 0;
  assert.throws(() => context.wbFetch('https://content-api.wildberries.ru/x', 'token'), /Адрес недоступен.*\(попыток: 4\)/);
  assert.equal(calls, 4);
});

test('лист «Заказы»: при чужих заголовках запись не идёт', () => {
  const { context, book } = script();
  const sheet = book.insertSheet('Заказы');
  sheet.getRange(1, 1, 1, 2).setValues([['Мой столбец', 'Ещё']]);
  assert.throws(
    () =>
      context.writeOrders(book, [{ cabinet: 'Samiri', cards, orders: [order('1', 'created', '2026-11-01T10:00:00+03:00')] }], new Date()),
    /заголовки листа «Заказы» не совпадают/
  );
  assert.equal(sheet.rows.length, 1);
});
