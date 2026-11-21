'use strict';
// --- «Заблокировать цену» в «Ценах и скидках»: файл Excel для загрузки в кабинет WB ---
// Минимальную цену для автоакций и блокировку скидки по автоакции WB принимает файлом: шаблон «Шаблон обновления
// минимальной цены и блокировки автоакций …xlsx» из кабинета продавца. Файл собирается по этому шаблону
// (server/prices/min-price-template.xlsx — шаблон WB без строк товаров): те же лист, колонки, стили, список
// значений блокировки и условное форматирование. Строки — выбранные товары, как в образце, который заполнил
// пользователь: бренд, категория (предмет), артикул WB, артикул продавца, последний баркод, новая минимальная
// цена (K) и новая блокировка (M). Остальные колонки WB заполняет сам, они остаются пустыми.
// POST /api/prices/min-price-file { cabinet, lock, items: [{ nmId, price, brand, category, vendorCode }] } → xlsx.
const fs = require('node:fs');
const path = require('node:path');
const { apiError, cabinets, tokenFor } = require('../core/base');
const { productCards } = require('../core/product-cards');
const { unzip, zip } = require('../core/zip');

const TEMPLATE_FILE = path.join(__dirname, 'min-price-template.xlsx');
const SHEET = 'xl/worksheets/sheet1.xml',
  STRINGS = 'xl/sharedStrings.xml',
  WORKBOOK = 'xl/workbook.xml';
// Значения колонки M из списка шаблона: «Нет,7 дней,30 дней,Бессрочно». «Нет» снимает блокировку — в окне сайта
// его нет: окно ставит блокировку.
const LOCK_TERMS = ['7 дней', '30 дней', 'Бессрочно'];
// В шаблоне WB оформлены строки до 161-й (стили колонок J, K, M, проверка значений M, фильтр).
const TEMPLATE_LAST_ROW = 161;

const xmlText = value =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// rows — [{ brand, category, nmId, vendorCode, barcode, price, lock }]
function buildMinPriceXlsx(template, rows, date = new Date()) {
  const files = unzip(template);
  const sheet = files.get(SHEET).toString('utf8'),
    strings = files.get(STRINGS).toString('utf8');
  const header = sheet.match(/<row r="1"[\s\S]*?<\/row>/)[0];
  // Строки заголовка — первые 13 в общей таблице строк шаблона.
  const table = [...strings.matchAll(/<si>[\s\S]*?<\/si>/g)].slice(0, 13).map(match => match[0]);
  const index = new Map();
  let stringCells = 13;
  const shared = value => {
    const text = String(value ?? '');
    if (!index.has(text)) {
      index.set(text, table.length);
      table.push(text === '' ? '<si><t/></si>' : `<si><t${/^\s|\s$/.test(text) ? ' xml:space="preserve"' : ''}>${xmlText(text)}</t></si>`);
    }
    stringCells++;
    return index.get(text);
  };
  const str = (ref, style, value) => `<c r="${ref}" s="${style}" t="s"><v>${shared(value)}</v></c>`;
  const num = (ref, style, value) => `<c r="${ref}" s="${style}"><v>${Number(value)}</v></c>`;
  const rowTag = (r, spans) => `<row r="${r}" spans="${spans}" s="6" customFormat="1" ht="15" customHeight="1" x14ac:dyDescent="0.25">`;
  const last = Math.max(TEMPLATE_LAST_ROW, rows.length + 1);
  const body = [header];
  rows.forEach((row, i) => {
    const r = i + 2;
    body.push(
      rowTag(r, '1:13') +
        str(`A${r}`, 6, row.brand) +
        str(`B${r}`, 6, row.category) +
        num(`C${r}`, 6, row.nmId) +
        str(`D${r}`, 6, row.vendorCode) +
        str(`E${r}`, 6, row.barcode) +
        num(`K${r}`, 1, row.price) +
        str(`M${r}`, 2, row.lock) +
        '</row>'
    );
  });
  for (let r = rows.length + 2; r <= last; r++)
    body.push(`${rowTag(r, '10:13')}<c r="J${r}" s="3"/><c r="K${r}" s="1"/><c r="M${r}" s="2"/></row>`);
  // Диапазоны фильтра, условного форматирования и списка значений M — до последней строки.
  const ranges = xml => xml.replace(/(\$?[A-M]\$?)161\b/g, `$1${last}`);
  const [before, after] = sheet.split(/<sheetData>[\s\S]*<\/sheetData>/);
  const newSheet = ranges(before).replace(' topLeftCell="D1"', '') + `<sheetData>${body.join('')}</sheetData>` + ranges(after);
  const newStrings =
    strings
      .slice(0, strings.indexOf('<si>'))
      .replace(/count="\d+"/, `count="${stringCells}"`)
      .replace(/uniqueCount="\d+"/, `uniqueCount="${table.length}"`) +
    table.join('') +
    '</sst>';
  const output = [];
  for (const [name, content] of files) {
    if (name === SHEET) output.push([name, newSheet]);
    else if (name === STRINGS) output.push([name, newStrings]);
    else if (name === WORKBOOK) output.push([name, ranges(content.toString('utf8'))]);
    else if (name === 'docProps/core.xml')
      output.push([
        name,
        content.toString('utf8').replace(/(<dcterms:modified[^>]*>)[^<]*/, `$1${date.toISOString().replace(/\.\d+Z$/, 'Z')}`)
      ]);
    else output.push([name, content]);
  }
  return zip(output, date);
}

// Последний баркод товара — последний баркод последнего размера карточки.
const lastBarcode = card => {
  const skus = (card?.sizes || []).flatMap(size => size.skus || []);
  return skus.length ? String(skus[skus.length - 1]) : '';
};

async function minPriceFile(body) {
  const lock = String(body.lock || '');
  if (!LOCK_TERMS.includes(lock)) throw apiError(400, `Срок блокировки — ${LOCK_TERMS.join(', ')}`);
  const seen = new Set();
  const items = (Array.isArray(body.items) ? body.items : [])
    .map(item => ({ ...item, nmId: Number(item.nmId), price: Number(item.price) }))
    .filter(item => Number.isInteger(item.nmId) && item.nmId > 0 && !seen.has(item.nmId) && seen.add(item.nmId));
  if (!items.length) throw apiError(400, 'Выберите товары');
  const wrong = items.filter(item => !Number.isInteger(item.price) || item.price < 1).length;
  if (wrong) throw apiError(400, `Укажите цену целым числом рублей больше нуля — не указана у товаров: ${wrong}`);
  const id = String(body.cabinet || 'demo');
  const demo = id === 'demo' || !cabinets().length;
  // Карточки обычно уже загружены (раздел цен берёт из них названия); пока их нет — данные из строк таблицы цен.
  const cards = demo ? [] : await productCards(id, tokenFor(id), { wait: false });
  const byNmId = new Map((cards || []).map(card => [Number(card.nmID), card]));
  const rows = items.map(item => {
    const card = byNmId.get(item.nmId);
    return {
      brand: card ? card.brand || '' : String(item.brand || ''),
      category: card?.subjectName || String(item.category || ''),
      nmId: item.nmId,
      vendorCode: card?.vendorCode || String(item.vendorCode || ''),
      barcode: lastBarcode(card),
      price: item.price,
      lock
    };
  });
  return buildMinPriceXlsx(fs.readFileSync(TEMPLATE_FILE), rows);
}

module.exports = { LOCK_TERMS, buildMinPriceXlsx, minPriceFile };
