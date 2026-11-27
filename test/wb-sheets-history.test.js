const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Поддельный лист Google: сетка значений, вставка строк, сортировка диапазона; calls — какие операции были.
function fakeSheet(name, calls) {
  const sheet = { name, rows: [], maxRows: 1000, frozen: 0 };
  const range = (row, column, rowCount = 1, columnCount = 1) => ({
    getValues: () =>
      Array.from({ length: rowCount }, (_, r) =>
        Array.from({ length: columnCount }, (_, c) => (sheet.rows[row - 1 + r] || [])[column - 1 + c] ?? '')
      ),
    setValues(values) {
      calls.push(`${name}: запись строк ${row}–${row + values.length - 1}`);
      values.forEach((line, r) => {
        const target = (sheet.rows[row - 1 + r] = sheet.rows[row - 1 + r] || []);
        line.forEach((value, c) => (target[column - 1 + c] = value));
      });
      return this;
    },
    sort({ column: by, ascending }) {
      calls.push(`${name}: сортировка`);
      const part = sheet.rows.slice(row - 1, row - 1 + rowCount);
      part.sort((a, b) => (ascending ? 1 : -1) * (a[by - 1] - b[by - 1]));
      sheet.rows.splice(row - 1, rowCount, ...part);
      return this;
    },
    setNumberFormat() {
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
    getName: () => name,
    getRange: range,
    getLastRow: () => {
      for (let i = sheet.rows.length; i > 0; i--)
        if ((sheet.rows[i - 1] || []).some(value => value !== '' && value !== undefined)) return i;
      return 0;
    },
    getLastColumn: () => Math.max(0, ...sheet.rows.map(row => row.length)),
    getMaxRows: () => sheet.maxRows,
    insertRowsAfter: (after, count) => {
      calls.push(`${name}: вставка ${count} строк после ${after}`);
      sheet.rows.splice(after, 0, ...Array.from({ length: count }, () => []));
      sheet.maxRows += count;
    },
    clear: () => (sheet.rows = []),
    autoResizeColumns() {},
    setFrozenRows: count => (sheet.frozen = count)
  });
  return sheet;
}

function script() {
  const sheets = {},
    calls = [],
    props = {};
  const book = {
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = fakeSheet(name, calls))
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActive: () => book },
    Utilities: { sleep() {} },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: key => props[key] ?? null, setProperty: (key, value) => (props[key] = value) })
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-sheets', 'wb-sheets.gs'), 'utf8'), context);
  // Константы скрипта объявлены через const — свойствами контекста они не становятся, читаем их выражением.
  const value = name => vm.runInContext(name, context);
  return { context, book, sheets, calls, props, value };
}

// Остатки: кабинет | тип | склад | артикул | артикул продавца | название | остаток | обновлено.
const stock = (quantity, at) => ['Samiri', 'FBS', 'Коледино', 305722141, 'дж', 'Геймпад', quantity, at];
const writeStocks = ({ context, book, value }, rows, now) =>
  context.writeWithHistory(book, [], now, {
    name: 'Остатки',
    headers: value('STOCK_HEADERS'),
    rows,
    failed: {},
    tracked: [6],
    key: row => row.slice(0, 4).join('|'),
    absent: { column: 6, value: 0 },
    section: row => row[1],
    id: row => row[3],
    label: row => row[2],
    title: row => row[5],
    log: { name: 'История остатков', headers: value('STOCK_HISTORY_HEADERS') }
  });

test('история остатков: новые строки — в конец листа, история пишется раньше самого листа', () => {
  const env = script(),
    { sheets, calls } = env;
  const t1 = new Date('2026-11-25T09:18:00Z'),
    t2 = new Date('2026-11-25T10:18:00Z'),
    t3 = new Date('2026-11-25T11:18:00Z');
  writeStocks(env, [stock(2, t1)], t1); // первое обновление кабинета — без истории
  writeStocks(env, [stock(1, t2)], t2);
  calls.length = 0;
  writeStocks(env, [stock(10, t3)], t3);
  const history = sheets['История остатков'].rows.slice(1).map(row => [row[0].toISOString(), row[6], row[7]]);
  assert.deepEqual(history, [
    [t2.toISOString(), 2, 1],
    [t3.toISOString(), 1, 10]
  ]);
  // Дописано в конец (строка 3), без вставки в начало, и до перезаписи листа «Остатки».
  const historyWrite = calls.findIndex(line => line === 'История остатков: запись строк 3–3'),
    stockWrite = calls.findIndex(line => line.startsWith('Остатки: запись строк 2'));
  assert.ok(historyWrite >= 0, calls.join('\n'));
  assert.ok(historyWrite < stockWrite, 'история пишется раньше листа');
  assert.ok(!calls.some(line => line.startsWith('История остатков: вставка')), 'строк хватает — ничего не вставляется');
});

test('старая «История», где новые строки были сверху, один раз сортируется по времени — ничего не удаляется', () => {
  const { context, book, sheets, calls, props, value } = script();
  const sheet = book.insertSheet('История');
  const old = [3, 2, 1].map(day => [new Date(Date.UTC(2026, 10, day)), 'Samiri', 'Цены', 1, 'Товар', 'Цена', day, day + 1]);
  sheet.rows = [value('HISTORY_HEADERS').slice(), ...old];
  sheet.maxRows = 4;
  const now = new Date(Date.UTC(2026, 10, 4));
  context.appendRows(sheet, value('HISTORY_HEADERS'), [[now, 'Samiri', 'Цены', 1, 'Товар', 'Цена', 4, 5]]);
  assert.deepEqual(
    sheets['История'].rows.slice(1).map(row => row[0].getUTCDate()),
    [1, 2, 3, 4]
  );
  assert.equal(props['appendLayout:История'], '1');
  // Второй раз не сортируется; лист кончился — строки добавляются в конец листа, а не после заголовка.
  calls.length = 0;
  context.appendRows(sheet, value('HISTORY_HEADERS'), [[new Date(Date.UTC(2026, 10, 5)), 'Samiri', 'Цены', 1, 'Товар', 'Цена', 5, 6]]);
  assert.ok(!calls.includes('История: сортировка'));
  assert.ok(calls.includes('История: вставка 1 строк после 5'), calls.join('\n'));
  assert.equal(sheets['История'].rows.length, 6);
});

test('doGet по артикулу отдаёт самые свежие строки, хотя новые теперь внизу листа', () => {
  const { context, book, value } = script();
  const sheet = book.insertSheet('История');
  // Даты — из контекста скрипта: в Google Таблице ячейки дат — Date того же окружения (instanceof Date).
  const date = ms => vm.runInContext(`new Date(${ms})`, context);
  sheet.rows = [
    value('HISTORY_HEADERS').slice(),
    ...Array.from({ length: 3005 }, (_, i) => [date(Date.UTC(2026, 0, 1) + i * 3600000), 'Samiri', 'Цены', 7, 'Товар', 'Цена', i, i + 1])
  ];
  const props = { WB_SITE_KEY: 'k' };
  context.PropertiesService = { getScriptProperties: () => ({ getProperty: key => props[key] ?? null }) };
  context.ContentService = { createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }), MimeType: { JSON: 'json' } };
  const result = context.doGet({ parameter: { key: 'k', id: '7' } });
  assert.equal(result.items.length, 3000);
  assert.equal(result.items[0].before, 3004, 'первая — самая свежая');
});
