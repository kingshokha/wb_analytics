/**
 * Сималенд → Google Таблица: оптовые цены товаров по вашему списку артикулов, раз в час, с историей изменений.
 *
 * Сималенд не пускает запросы с серверов Google (проверено 10.11.2026: любой адрес sima-land.ru, даже robots.txt,
 * из Apps Script — «Адрес недоступен» через 50 секунд). Поэтому цены загружает сервер сайта WB Pulse (sima-land.js)
 * со своего компьютера, раз в час: берёт отсюда список артикулов (GET ?articles=1), запрашивает API Сималенда и
 * присылает цены сюда (POST). Скрипт сравнивает их с листом «Цены» и пишет «Историю» — как если бы загружал сам.
 * Пока компьютер с сайтом выключен, цены не обновляются. Инструкция — google-sheets/sima-land/README.md.
 *
 * Листы:
 *   «Артикулы»          — ваш список: артикулы Сималенда в столбце A, со второй строки (остальные столбцы — для заметок);
 *   «Цены»              — текущие цены каждого артикула из списка (перезаписывается при обновлении);
 *   «История»           — строка на каждое изменение цены (новые сверху, старые строки не удаляются);
 *   «Журнал обновлений» — когда обновлялось и что ответил Сималенд.
 */

const SIMA_SHEETS = { articles: 'Артикулы', prices: 'Цены', history: 'История', log: 'Журнал обновлений' };
const ARTICLE_HEADERS = ['Артикул Сималенда', 'Заметка'];
const PRICE_HEADERS = ['Артикул', 'Товар', 'Цена, ₽', 'Цена по акции «Опт», ₽', 'Наличие', 'Обновлено'];
const HISTORY_HEADERS = ['Когда', 'Артикул', 'Товар', 'Что изменилось', 'Было', 'Стало'];
const LOG_HEADERS = ['Когда', 'Результат'];
// Сравниваемые столбцы «Цен» (с нуля): цена и цена по акции «Опт».
const PRICE_TRACKED = [2, 3];
// Наличие: «нет на Сималенде» — товара нет в ответе API; «ошибка загрузки» — Сималенд не ответил, цен ещё нет.
const STATUS = { inStock: 'В наличии', outOfStock: 'Нет в наличии', missing: 'Нет на Сималенде', failed: 'Ошибка загрузки' };
const DATE_FORMAT = 'dd.MM.yyyy HH:mm';

// ---------- Меню ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Сималенд')
    .addItem('Как обновляются цены', 'showStatus')
    .addSeparator()
    .addItem('Ключ для сайта', 'showSiteKey')
    .addToUi();
  articlesSheet(SpreadsheetApp.getActive());
}
function showStatus() {
  const log = SpreadsheetApp.getActive().getSheetByName(SIMA_SHEETS.log), last = log && log.getLastRow() > 1 ? log.getRange(2, 1, 1, 2).getValues()[0] : null;
  SpreadsheetApp.getUi().alert('Как обновляются цены',
    'Сималенд не пускает запросы с серверов Google, поэтому сама таблица цены загрузить не может. Их раз в час загружает компьютер с сайтом WB Pulse и записывает сюда. ' +
    'Пока компьютер выключен, цены не обновляются. Загрузить сразу — кнопкой «Загрузить цены сейчас» в разделе «Цены Сималенда» на сайте.\n\n' +
    (last ? 'Последнее обновление: ' + Utilities.formatDate(last[0], SpreadsheetApp.getActive().getSpreadsheetTimeZone(), DATE_FORMAT) + ' — ' + last[1] : 'Обновлений ещё не было.'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}
// Прежние версии загружали цены сами — по расписанию и из меню. Расписание, если его включали, убирает себя
// при первом срабатывании; старый пункт меню в открытой вкладке показывает, как цены обновляются теперь.
function refreshSima() { ScriptApp.getProjectTriggers().forEach(function (trigger) { if (trigger.getHandlerFunction() === 'refreshSima') ScriptApp.deleteTrigger(trigger); }); }
function refreshFromMenu() { refreshSima(); showStatus(); }

// ---------- Обмен с сайтом WB Pulse (веб-приложение) ----------
// Все запросы — с ключом (пункт меню «Ключ для сайта», хранится в свойствах скрипта); без верного ключа — ошибка.
//   GET  ?key=…&articles=1 — артикулы с листа «Артикулы»: { sids, skipped, updatedAt } (updatedAt — последнее обновление);
//   POST { key, sids, found: { артикул: { name, price, wholesale_price, balance, isEnough } }, failed: [артикулы], errors, skipped }
//        — цены, которые сайт загрузил с Сималенда: записываются как обновление таблицы, ответ — { ok, result, changes };
//   GET  ?key=…&sync=1&after=<ISO>&offset=0&limit=20000 — «История» для копии на компьютере (см. syncExport).
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (!keyMatches(params.key)) return jsonOutput({ error: 'Неверный ключ доступа к таблице' });
  if (params.articles) {
    const book = SpreadsheetApp.getActive(), listed = readArticles(articlesSheet(book)), log = book.getSheetByName(SIMA_SHEETS.log);
    return jsonOutput({ sids: listed.sids, skipped: listed.skipped, updatedAt: log && log.getLastRow() > 1 ? isoDate(log.getRange(2, 1).getValue()) : null });
  }
  return jsonOutput(syncExport(params));
}
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (error) { return jsonOutput({ error: 'Не удалось прочитать присланные цены' }); }
  if (!keyMatches(body.key)) return jsonOutput({ error: 'Неверный ключ доступа к таблице' });
  try { return jsonOutput(applyPrices(body)); } catch (error) { return jsonOutput({ error: error.message }); }
}
function keyMatches(value) { const key = PropertiesService.getScriptProperties().getProperty('SIMA_SITE_KEY'); return Boolean(key) && value === key; }
// Выгрузка «Истории» для копии на компьютере: строки не старше after (включительно — строки одного обновления
// пишутся в одно время, сайт сам убирает повторы), от новых к старым, как на листе; offset — сколько таких строк уже
// отдано. Лист читается сверху кусками и только до первой строки старше after. Новые строки встают наверх, поэтому
// между порциями строки только повторяются, но не теряются. more — есть ли следующая порция. articles — сколько
// артикулов на листе «Цены», updatedAt и lastResult — последнее обновление из «Журнала», since — первое обновление
// (раньше изменений не видно). listed и skipped — сколько артикулов и мусора сейчас на листе «Артикулы», sheets — листы
// таблицы: по ним видно, куда вписаны артикулы.
function syncExport(params) {
  const book = SpreadsheetApp.getActive(), history = book.getSheetByName(SIMA_SHEETS.history), log = book.getSheetByName(SIMA_SHEETS.log), prices = book.getSheetByName(SIMA_SHEETS.prices);
  const after = params.after ? new Date(params.after).getTime() : 0, offset = Math.max(0, Number(params.offset) || 0), limit = Math.min(30000, Math.max(1, Number(params.limit) || 20000));
  const items = [], last = history ? history.getLastRow() : 0, chunk = 5000;
  let skipped = 0, more = false;
  scan: for (let start = 2; start <= last; start += chunk) {
    const rows = history.getRange(start, 1, Math.min(chunk, last - start + 1), HISTORY_HEADERS.length).getValues();
    for (const row of rows) {
      if (!(row[0] instanceof Date)) continue;
      if (after && row[0].getTime() < after) break scan;
      if (skipped < offset) { skipped++; continue; }
      if (items.length >= limit) { more = true; break scan; }
      items.push({ at: isoDate(row[0]), id: String(row[1]), title: String(row[2]), what: String(row[3]), before: row[4], after: row[5] });
    }
  }
  const logLast = log ? log.getLastRow() : 0, articleSheet = book.getSheetByName(SIMA_SHEETS.articles), listed = articleSheet ? readArticles(articleSheet) : { sids: [], skipped: 0 };
  return { items: items, more: more, articles: prices ? Math.max(0, prices.getLastRow() - 1) : 0,
    listed: listed.sids.length, skipped: listed.skipped, sheets: book.getSheets ? book.getSheets().map(function (item) { return item.getName(); }) : [],
    since: logLast > 1 ? isoDate(log.getRange(logLast, 1).getValue()) : null,
    updatedAt: logLast > 1 ? isoDate(log.getRange(2, 1).getValue()) : null, lastResult: logLast > 1 ? String(log.getRange(2, 2).getValue()) : '',
    now: new Date().toISOString() };
}
function jsonOutput(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function isoDate(value) { return value instanceof Date ? value.toISOString() : (value ? String(value) : null); }
function showSiteKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('SIMA_SITE_KEY');
  if (!key) { key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); props.setProperty('SIMA_SITE_KEY', key); }
  SpreadsheetApp.getUi().alert('Ключ для сайта WB Pulse',
    'Впишите в файл .env сайта строку и перезапустите сервер:\n\nSIMA_SHEET_KEY=' + key +
    '\n\nКлюч даёт доступ к артикулам и «Истории» цен этой таблицы — никому его не пересылайте и не публикуйте.', SpreadsheetApp.getUi().ButtonSet.OK);
}

// ---------- Обновление цен присланными с сайта ----------
// Одно обновление за раз: если предыдущее ещё пишется, ждём до 30 секунд. Итог — и ошибка тоже — в «Журнал обновлений»:
// по нему сайт видит, что таблица обновлялась и чем это кончилось.
function applyPrices(body) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Таблица занята предыдущим обновлением — попробуйте позже');
  const book = SpreadsheetApp.getActive(), now = new Date();
  const log = function (text) { prependRows(sheet(book, SIMA_SHEETS.log), LOG_HEADERS, [[now, text]], { 1: DATE_FORMAT }); };
  try {
    const seen = {}, sids = (body.sids || []).map(String).filter(function (sid) { if (!/^\d{1,12}$/.test(sid) || seen[sid]) return false; seen[sid] = true; return true; });
    const skipped = Number(body.skipped) || 0, errors = (body.errors || []).map(String);
    if (!sids.length) {
      const text = 'на листе «Артикулы» нет артикулов: впишите их в столбец A, со второй строки' + (skipped ? ' (значений, не похожих на артикул: ' + skipped + ')' : '');
      log(text);
      return { ok: true, result: text, changes: 0 };
    }
    const found = body.found || {}, failed = {};
    (body.failed || []).forEach(function (sid) { failed[String(sid)] = true; });
    const target = sheet(book, SIMA_SHEETS.prices), lastColumn = Math.max(1, target.getLastColumn());
    const sameLayout = target.getLastRow() > 0 && target.getRange(1, 1, 1, lastColumn).getValues()[0].filter(String).join('|') === PRICE_HEADERS.join('|');
    const old = sameLayout && target.getLastRow() > 1 ? target.getRange(2, 1, target.getLastRow() - 1, PRICE_HEADERS.length).getValues() : [];
    const result = priceChanges(sids, found, failed, old, now);
    writeSheet(target, PRICE_HEADERS, result.rows, { 3: '#,##0.00', 4: '#,##0.00', 6: DATE_FORMAT });
    prependRows(sheet(book, SIMA_SHEETS.history), HISTORY_HEADERS, result.history, { 1: DATE_FORMAT, 2: '0' });
    const missing = result.rows.filter(function (row) { return row[4] === STATUS.missing; }).length, failedCount = Object.keys(failed).length;
    const notes = ['артикулов ' + sids.length, 'изменений ' + result.history.length];
    if (missing) notes.push('нет на Сималенде ' + missing);
    if (failedCount) notes.push('не загружено ' + failedCount + ' (строки остались прежними)');
    if (skipped) notes.push('пропущено значений, не похожих на артикул: ' + skipped);
    if (errors.length) notes.push('ошибки: ' + errors.join('; '));
    log(notes.join(', '));
    return { ok: true, result: notes.join(', '), changes: result.history.length, first: !old.length };
  } catch (error) {
    try { log('ошибка: ' + error.message); } catch (ignored) { /* записать в журнал не удалось — ошибка уйдёт сайту */ }
    throw error;
  } finally { lock.releaseLock(); }
}

// Артикулы со листа «Артикулы»: столбец A со второй строки, без повторов, по порядку. skipped — сколько непустых
// значений не похожи на артикул (буквы, дробь): такой артикул сломал бы запрос всей сотни (ответ 422).
function readArticles(target) {
  const last = target.getLastRow(), seen = {}, sids = [];
  let skipped = 0;
  if (last > 1) target.getRange(2, 1, last - 1, 1).getValues().forEach(function (row) {
    const value = String(row[0] === null || row[0] === undefined ? '' : row[0]).replace(/\s/g, '');
    if (!value) return;
    if (!/^\d{1,12}$/.test(value)) { skipped++; return; }
    const sid = String(Number(value));
    if (!seen[sid]) { seen[sid] = true; sids.push(sid); }
  });
  return { sids: sids, skipped: skipped };
}
function articlesSheet(book) {
  const target = book.getSheetByName(SIMA_SHEETS.articles);
  if (target) return target;
  const created = book.insertSheet(SIMA_SHEETS.articles, 0);
  header(created, ARTICLE_HEADERS);
  created.getRange('A:A').setNumberFormat('0');
  created.setColumnWidth(1, 160); created.setColumnWidth(2, 320);
  return created;
}

// Новые строки «Цен» (по порядку списка) и строки «Истории». old — лист «Цены» до обновления: при первом
// обновлении (или после смены столбцов) он пуст, и «История» не пишется — сравнивать не с чем.
//   Артикул не загрузился (failed) — строка остаётся прежней, без записи в «Историю».
//   Товара нет в ответе — «Нет на Сималенде» (один раз, пока он не вернётся), вернулся — «Снова есть на Сималенде».
//   Артикул добавлен в список — «Добавлен в список», убран из списка — «Убран из списка артикулов».
//   Цена или цена по акции «Опт» изменилась — строка на каждое из двух полей. Цена 0 — «нет цены» (пустая ячейка).
function priceChanges(sids, found, failed, old, now) {
  const oldBySid = {}, listed = {}, rows = [], history = [];
  old.forEach(function (row) { oldBySid[String(row[0])] = row; });
  const firstRun = !old.length;
  const record = function (row, what, before, after) { history.push([now, Number(row[0]), row[1], what, before, after]); };
  const price = function (value) { const number = Math.round(Number(value) * 100) / 100; return isFinite(number) && number > 0 ? number : ''; };
  const known = function (row) { return row && row[4] !== STATUS.failed; };
  const here = function (row) { return known(row) && row[4] !== STATUS.missing; };
  sids.forEach(function (sid) {
    listed[sid] = true;
    const before = oldBySid[sid], good = found[sid];
    if (failed[sid]) { rows.push(before || [Number(sid), '', '', '', STATUS.failed, now]); return; }
    if (!good) {
      const row = [Number(sid), before ? before[1] : '', '', '', STATUS.missing, now];
      if (here(before)) record(row, STATUS.missing, display(before[2]), '—');
      rows.push(row);
      return;
    }
    // Остаток Сималенд показывает, только когда его мало; когда много — balance пустой, а isEnough = true.
    const balance = good.balance === null || good.balance === undefined ? null : Number(good.balance);
    const stock = balance === null ? (good.isEnough ? STATUS.inStock : '') : balance > 0 ? STATUS.inStock : STATUS.outOfStock;
    const row = [Number(sid), String(good.name || ''), price(good.price), price(good.wholesale_price), stock, now];
    rows.push(row);
    if (firstRun) return;
    if (!before) { record(row, 'Добавлен в список', '—', display(row[2])); return; }
    if (!known(before)) return;
    if (before[4] === STATUS.missing) { record(row, 'Снова есть на Сималенде', '—', display(row[2])); return; }
    PRICE_TRACKED.forEach(function (index) { if (!same(before[index], row[index])) record(row, PRICE_HEADERS[index], display(before[index]), display(row[index])); });
  });
  if (!firstRun) old.forEach(function (row) { if (!listed[String(row[0])] && known(row)) record(row, 'Убран из списка артикулов', here(row) ? display(row[2]) : '—', '—'); });
  return { rows: rows, history: history };
}
function same(a, b) { return normalize(a) === normalize(b); }
function normalize(value) { return typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value === null || value === undefined ? '' : value).trim(); }
function display(value) { return value === '' || value === null || value === undefined ? '—' : value; }

// ---------- Листы ----------
function sheet(book, name) { return book.getSheetByName(name) || book.insertSheet(name); }
function header(target, headers) {
  target.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#eef1ee');
  target.setFrozenRows(1);
}
function applyFormats(target, startRow, count, formats) {
  Object.keys(formats || {}).forEach(function (column) { target.getRange(startRow, Number(column), count, 1).setNumberFormat(formats[column]); });
}
function writeSheet(target, headers, rows, formats) {
  target.clear();
  header(target, headers);
  if (rows.length) { target.getRange(2, 1, rows.length, headers.length).setValues(rows); applyFormats(target, 2, rows.length, formats); }
  if (target.getLastRow() < 200) target.autoResizeColumns(1, headers.length);
}
// Новые строки — сверху, сразу под заголовком. Старые строки не удаляются: история хранится вся.
function prependRows(target, headers, rows, formats) {
  if (target.getLastRow() === 0) header(target, headers);
  if (!rows.length) return;
  target.insertRowsAfter(1, rows.length);
  target.getRange(2, 1, rows.length, headers.length).setValues(rows).setFontWeight('normal').setBackground(null);
  applyFormats(target, 2, rows.length, formats);
}
