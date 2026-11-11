const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const createLenardi = require('../lenardi');
const { parseReport, readXlsx } = createLenardi;

// Небольшой xlsx: zip из файлов книги (один — сжатый, как обычно у Excel, остальные — без сжатия).
function zip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), deflate = name.endsWith('sheet1.xml'), data = deflate ? zlib.deflateRawSync(raw) : raw, nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(deflate ? 8 : 0, 10); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(nameBuffer.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, data); central.push(entry, nameBuffer);
    offset += 30 + nameBuffer.length + data.length;
  }
  const centralBuffer = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}
// Как отчёт «lenardi опт цены.xlsx»: заголовок, дата, пустая строка, таблица с «Артикул» и «Опт.»; строки — общие
// (sharedStrings) и встроенные (inlineStr), опт пустой у одного артикула.
const report = () => zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Сводка" sheetId="1" r:id="rId2"/><sheet name="Отчёт Leonardo" sheetId="2" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="ws" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Артикул</t></si><si><t>Опт.</t></si><si><r><t>305-</t></r><r><t>043</t></r></si><si><t>Дата: 11.11.2026 10:42</t></si><si><t>Чай &amp; кофе</t></si></sst>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Итого</t></is></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Отчёт Leonardo — ИП</t></is></c></row><row r="2"><c r="A2" t="s"><v>3</v></c></row>' +
    '<row r="7"><c r="A7" t="inlineStr"><is><t>№</t></is></c><c r="B7" t="s"><v>0</v></c><c r="C7" t="inlineStr"><is><t>Предмет</t></is></c><c r="D7" t="s"><v>1</v></c></row>' +
    '<row r="8"><c r="A8"><v>1</v></c><c r="B8" t="s"><v>2</v></c><c r="C8" t="s"><v>4</v></c><c r="D8"><v>1905</v></c></row>' +
    '<row r="9"><c r="A9"><v>2</v></c><c r="B9" t="inlineStr"><is><t>160-200</t></is></c><c r="D9"><v>80.5</v></c></row>' +
    '<row r="10"><c r="A10"><v>3</v></c><c r="B10" t="inlineStr"><is><t>205-132</t></is></c><c r="D10"/></row>' +
    '</sheetData></worksheet>'
});

test('опт Lenardi: чтение xlsx — общие и встроенные строки, числа, пропуски ячеек, лист по связи', () => {
  const sheets = readXlsx(report());
  assert.deepEqual(sheets.map(sheet => sheet.name), ['Сводка', 'Отчёт Leonardo']);
  assert.deepEqual(sheets[0].rows, [['Итого']]);
  const rows = sheets[1].rows;
  assert.deepEqual(rows[2], ['№', 'Артикул', 'Предмет', 'Опт.']);
  assert.deepEqual(rows[3], [1, '305-043', 'Чай & кофе', 1905]);
  assert.equal(rows[4][3], 80.5);
  assert.throws(() => readXlsx(Buffer.from('не zip')), /не файл xlsx/);
});

test('опт Lenardi: отчёт — артикулы и опт, дата отчёта; пустой опт — null', () => {
  assert.deepEqual(parseReport(report()), { sheet: 'Отчёт Leonardo', reportDate: '11.11.2026 10:42', prices: { '305-043': 1905, '160-200': 80.5, '205-132': null } });
  const noColumns = zip({ 'xl/workbook.xml': '<workbook><sheets><sheet name="Лист1" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Артикул</t></is></c><c r="B1" t="inlineStr"><is><t>Цена</t></is></c></row></sheetData></worksheet>' });
  assert.throws(() => parseReport(noColumns), /«Артикул» и «Опт\.»/);
});

test('опт Lenardi: загрузка — цены на компьютер, файл копией в архив, прежние копии не удаляются', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-lenardi-'));
  const module = createLenardi({ send: (res, status, payload) => Object.assign(res, { status, payload }), apiError: (status, message) => Object.assign(new Error(message), { status }), readJson: async req => req.body, dir });
  try {
    assert.equal(module.prices(), null);
    const res = {};
    await module.handle({ method: 'POST', body: { name: 'lenardi опт цены.xlsx', data: report().toString('base64') } }, res, new URL('http://local/api/lenardi/upload'));
    assert.deepEqual({ ...res.payload.lenardi, uploadedAt: Boolean(res.payload.lenardi.uploadedAt) }, { file: 'lenardi опт цены.xlsx', reportDate: '11.11.2026 10:42', uploadedAt: true, articles: 3, withPrice: 2 });
    assert.equal(module.prices().prices['305-043'], 1905);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'lenardi.json'), 'utf8')).prices['160-200'], 80.5);
    await new Promise(resolve => setTimeout(resolve, 1100));
    module.upload({ name: '../второй.xlsx', data: report().toString('base64') });
    const archive = fs.readdirSync(path.join(dir, 'Lenardi'));
    assert.equal(archive.length, 2);
    assert.ok(archive.every(name => /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2} (lenardi опт цены|второй)\.xlsx$/.test(name)), archive.join(', '));
    assert.throws(() => module.upload({ name: 'x.xlsx', data: Buffer.from('текст').toString('base64') }), /Не удалось прочитать файл: это не файл xlsx/);
    assert.throws(() => module.upload({ name: 'x.xlsx', data: '' }), /Выберите файл/);
    const info = {};
    await module.handle({ method: 'GET' }, info, new URL('http://local/api/lenardi'));
    assert.equal(info.payload.lenardi.file, 'второй.xlsx');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
