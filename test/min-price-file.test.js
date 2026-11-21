const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildMinPriceXlsx, minPriceFile } = require('../server/prices/min-price-file');
const { unzip } = require('../server/core/zip');

const template = fs.readFileSync(path.join(__dirname, '..', 'server', 'prices', 'min-price-template.xlsx'));

// Ячейки листа: адрес → значение (строки — из общей таблицы строк), стиль — отдельно.
function readSheet(buffer) {
  const files = unzip(buffer);
  const xml = files.get('xl/sharedStrings.xml').toString('utf8');
  const strings = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => (match[1].match(/<t[^>]*>([\s\S]*?)<\/t>/) || [, ''])[1]);
  const sheet = files.get('xl/worksheets/sheet1.xml').toString('utf8');
  const cells = {},
    styles = {};
  for (const [, ref, style, type, value] of sheet.matchAll(/<c r="(\w+)" s="(\d+)"(?: t="(\w+)")?(?:\/>|><v>([^<]*)<\/v><\/c>)/g)) {
    styles[ref] = style;
    if (value !== undefined) cells[ref] = type === 's' ? strings[Number(value)] : Number(value);
  }
  return { files, sheet, cells, styles, workbook: files.get('xl/workbook.xml').toString('utf8') };
}

test('файл блокировки цены: строки товаров в колонках шаблона WB', () => {
  const rows = [
    {
      brand: '',
      category: 'Планшеты',
      nmId: 2200305736,
      vendorCode: 'PLANSHET-A-9505',
      barcode: '2061220564701',
      price: 16900,
      lock: 'Бессрочно'
    },
    { brand: 'B & C', category: 'Планшеты', nmId: 2200305737, vendorCode: '<A>', barcode: '', price: 900, lock: '7 дней' }
  ];
  const { cells, styles, sheet, workbook } = readSheet(buildMinPriceXlsx(template, rows));
  assert.equal(cells.A1, 'Бренд');
  assert.equal(cells.K1, 'Новая минимальная цена для применения скидки по автоакции, RUB');
  assert.equal(cells.M1, 'Новая блокировка применения скидки по автоакции');
  assert.deepEqual(
    ['A2', 'B2', 'C2', 'D2', 'E2', 'K2', 'M2'].map(ref => cells[ref]),
    ['', 'Планшеты', 2200305736, 'PLANSHET-A-9505', '2061220564701', 16900, 'Бессрочно']
  );
  assert.deepEqual(
    ['A3', 'C3', 'D3', 'K3', 'M3'].map(ref => cells[ref]),
    ['B &amp; C', 2200305737, '&lt;A&gt;', 900, '7 дней']
  );
  assert.equal(cells.F2, undefined);
  assert.equal(cells.I2, undefined);
  assert.deepEqual([styles.A2, styles.K2, styles.M2], ['6', '1', '2']);
  // Пустые оформленные строки до 161-й, как в шаблоне; список значений срока — на месте.
  assert.deepEqual([styles.K161, styles.M161], ['1', '2']);
  assert.match(
    sheet,
    /<dataValidation type="list" allowBlank="1" sqref="M2:M161"[^>]*><formula1>"Нет,7 дней,30 дней,Бессрочно"<\/formula1>/
  );
  assert.match(workbook, /\$A\$1:\$M\$161/);
});

test('файл блокировки цены: больше 160 товаров — диапазоны листа растут', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    brand: '',
    category: 'Тест',
    nmId: 1000 + i,
    vendorCode: `V${i}`,
    barcode: '',
    price: 100 + i,
    lock: '30 дней'
  }));
  const { cells, sheet, workbook } = readSheet(buildMinPriceXlsx(template, rows));
  assert.equal(cells.C201, 1199);
  assert.equal(cells.M201, '30 дней');
  assert.match(sheet, /<dimension ref="A1:M201"\/>/);
  assert.match(sheet, /<autoFilter ref="A1:M201"/);
  assert.match(sheet, /sqref="M2:M201"/);
  assert.match(sheet, /<conditionalFormatting sqref="K2:K201">/);
  assert.match(workbook, /\$A\$1:\$M\$201/);
});

test('файл блокировки цены: проверка срока и цен (демо-кабинет — без WB)', async () => {
  await assert.rejects(minPriceFile({ cabinet: 'demo', lock: 'Нет', items: [{ nmId: 1, price: 10 }] }), /Срок блокировки/);
  await assert.rejects(minPriceFile({ cabinet: 'demo', lock: '7 дней', items: [] }), /Выберите товары/);
  await assert.rejects(
    minPriceFile({
      cabinet: 'demo',
      lock: '7 дней',
      items: [
        { nmId: 1, price: 10.5 },
        { nmId: 2, price: 0 }
      ]
    }),
    /не указана у товаров: 2/
  );
  const { cells } = readSheet(
    await minPriceFile({
      cabinet: 'demo',
      lock: '30 дней',
      items: [{ nmId: 100001, price: 1500, vendorCode: 'TSHIRT-BLACK', category: 'Одежда', brand: 'WB Pulse' }]
    })
  );
  assert.deepEqual(
    ['A2', 'B2', 'C2', 'D2', 'K2', 'M2'].map(ref => cells[ref]),
    ['WB Pulse', 'Одежда', 100001, 'TSHIRT-BLACK', 1500, '30 дней']
  );
});
