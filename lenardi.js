// --- Оптовые цены Lenardi для раздела «Прибыль Сималенда» (sima-profit.js) ---
// Источник — отчёт xlsx вида «lenardi опт цены.xlsx» (лист «Отчёт Leonardo»: над таблицей «Дата: 11.11.2026 10:42»,
// заголовки «Артикул» и «Опт.», артикулы вида 305-043). Товар кабинета — Lenardi, если артикул продавца — такой
// артикул с /L на конце (305-043/L). Файл загружается кнопкой на странице: POST /api/lenardi/upload { name, data —
// содержимое в base64 }. Сервер читает xlsx сам (пакетов у сайта нет: xlsx — zip, разжатие — встроенный zlib),
// находит лист с колонками «Артикул» и «Опт.» (или «Опт», «Опт. цена», «Опт Lenardi …»), сохраняет цены
// в data/Sima/lenardi.json, а сам файл — копией в data/Sima/Lenardi/ (прежние файлы не удаляются).
// GET /api/lenardi — что загружено сейчас.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const UPLOAD_LIMIT = 30_000_000; // base64 в JSON — до ~20 МБ файла
const lenardiArticle = vendorCode => String(vendorCode || '').trim().match(/^(\d{3}-\d{3})\/L$/i)?.[1] || '';

// Файлы zip: имя → содержимое. Хватает обычного zip без ZIP64 — такими xlsx и бывают.
function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('это не файл xlsx');
  const files = new Map();
  for (let index = 0, at = buffer.readUInt32LE(end + 16), count = buffer.readUInt16LE(end + 10); index < count; index++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('файл xlsx повреждён');
    const method = buffer.readUInt16LE(at + 10), size = buffer.readUInt32LE(at + 20), nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42), name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), data = buffer.subarray(start, start + size);
    if (method === 0 || method === 8) files.set(name, method ? zlib.inflateRawSync(data) : data);
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return files;
}
const unescapeXml = text => text.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([\da-f]+));/gi, (all, name, dec, hex) =>
  dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[name.toLowerCase()]);
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(([, name, value]) => [name, unescapeXml(value)]));
const texts = xml => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => unescapeXml(match[1])).join('');
// Листы книги: [{ name, rows: [[значение ячейки, …], …] }]; числа — числами, строки — строками.
function readXlsx(buffer) {
  const files = unzip(buffer), read = name => files.get(name)?.toString('utf8') || '';
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => texts(match[1]));
  const targets = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => attrs(tag)).map(rel => [rel.Id, rel.Target]));
  return [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => {
    const sheet = attrs(tag), target = String(targets[sheet['r:id']] || '').replace(/^\//, '');
    const xml = read(target.startsWith('xl/') ? target : `xl/${target}`), rows = [];
    for (const [, rowXml] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const [, cellTag, inner = ''] of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const cell = attrs(cellTag), column = String(cell.r || '').replace(/\d+$/, '');
        const index = column ? [...column].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1 : row.length;
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        row[index] = cell.t === 's' ? shared[Number(raw)] ?? '' : cell.t === 'inlineStr' ? texts(inner) : cell.t === 'str' || cell.t === 'e' ? unescapeXml(raw ?? '')
          : cell.t === 'b' ? raw === '1' : raw == null ? null : Number(raw);
      }
      rows.push(row);
    }
    return { name: sheet.name || '', rows };
  });
}
// Отчёт: лист с колонками «Артикул» и «Опт.»; дата — из строки «Дата: …» над таблицей. Опт пустой или 0 — null.
function parseReport(buffer) {
  const header = value => String(value ?? '').trim().toLowerCase();
  for (const sheet of readXlsx(buffer)) {
    for (let index = 0; index < sheet.rows.length; index++) {
      const row = sheet.rows[index].map(header), article = row.indexOf('артикул');
      const price = [/^опт\.?$/, /^опт\.? цена/, /^опт\.? lenardi/].map(test => row.findIndex(cell => test.test(cell))).find(found => found >= 0) ?? -1;
      if (article < 0 || price < 0) continue;
      const prices = {};
      for (const data of sheet.rows.slice(index + 1)) {
        const key = String(data[article] ?? '').trim(), value = Number(data[price]);
        if (key) prices[key] = Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
      }
      const date = sheet.rows.slice(0, index).flat().map(cell => String(cell ?? '').match(/^Дата:\s*(.+)$/)?.[1]).find(Boolean) || '';
      return { sheet: sheet.name, reportDate: date.trim(), prices };
    }
  }
  throw new Error('в файле нет листа с колонками «Артикул» и «Опт.»');
}

module.exports = function createLenardi({ send, apiError, readJson, root, dir = process.env.SIMA_DIR ? path.resolve(process.env.SIMA_DIR) : path.join(root, 'data', 'Sima') }) {
  const currentFile = path.join(dir, 'lenardi.json'), archiveDir = path.join(dir, 'Lenardi');
  let cache;
  // Текущие цены: { file, reportDate, uploadedAt, sheet, prices } или null, если файл ещё не загружали.
  function prices() {
    if (cache === undefined) { try { cache = JSON.parse(fs.readFileSync(currentFile, 'utf8')); } catch { cache = null; } }
    return cache;
  }
  const info = data => data ? { file: data.file, reportDate: data.reportDate, uploadedAt: data.uploadedAt, articles: Object.keys(data.prices).length,
    withPrice: Object.values(data.prices).filter(value => value != null).length } : null;
  function upload(body = {}) {
    const name = path.basename(String(body.name || 'lenardi.xlsx')).replace(/[\\/:*?"<>|]/g, ' ').slice(0, 120) || 'lenardi.xlsx';
    const buffer = Buffer.from(String(body.data || ''), 'base64');
    if (!buffer.length) throw apiError(400, 'Выберите файл xlsx с оптовыми ценами Lenardi');
    let report;
    try { report = parseReport(buffer); } catch (error) { throw apiError(400, `Не удалось прочитать файл: ${error.message}`); }
    if (!Object.keys(report.prices).length) throw apiError(400, 'В файле нет ни одного артикула');
    const uploadedAt = new Date(), two = value => String(value).padStart(2, '0');
    const stamp = `${uploadedAt.getFullYear()}-${two(uploadedAt.getMonth() + 1)}-${two(uploadedAt.getDate())} ${two(uploadedAt.getHours())}-${two(uploadedAt.getMinutes())}-${two(uploadedAt.getSeconds())}`;
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, `${stamp} ${name}`), buffer);
    const data = { file: name, reportDate: report.reportDate, uploadedAt: uploadedAt.toISOString(), sheet: report.sheet, prices: report.prices };
    fs.writeFileSync(`${currentFile}.tmp`, JSON.stringify(data));
    fs.renameSync(`${currentFile}.tmp`, currentFile);
    cache = data;
    return info(data);
  }
  async function handle(req, res, target) {
    if (req.method === 'GET' && target.pathname === '/api/lenardi') { send(res, 200, { lenardi: info(prices()) }); return true; }
    if (req.method === 'POST' && target.pathname === '/api/lenardi/upload') { send(res, 200, { lenardi: upload(await readJson(req, UPLOAD_LIMIT)) }); return true; }
    if (target.pathname.startsWith('/api/lenardi')) throw apiError(404, 'Нет такого метода');
    return false;
  }
  return { handle, prices, info: () => info(prices()), upload };
};
module.exports.lenardiArticle = lenardiArticle;
module.exports.readXlsx = readXlsx;
module.exports.parseReport = parseReport;
