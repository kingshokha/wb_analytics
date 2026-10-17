/**
 * WB Pulse → Google Таблица: цены товаров и статусы рекламных кампаний из API Wildberries.
 *
 * Скрипт живёт внутри таблицы (Расширения → Apps Script) и сам ходит в API WB с вашим токеном,
 * поэтому работает, даже когда компьютер с сайтом выключен. Инструкция — google-sheets/README.md.
 *
 * Листы:
 *   «Цены»              — текущие цены и скидки всех товаров;
 *   «Реклама»           — текущие статусы и настройки всех рекламных кампаний;
 *   «История»           — строка на каждое изменение: цена, скидка, статус кампании и т. п. (новые сверху);
 *   «Журнал обновлений» — когда обновлялось и что вернул WB по каждому кабинету.
 * Токены хранятся в свойствах скрипта (не в ячейках). Меню «WB» появляется после открытия таблицы.
 */

const WB_URLS = {
  prices: 'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter',
  cards: 'https://content-api.wildberries.ru/content/v2/get/cards/list',
  adverts: 'https://advert-api.wildberries.ru/api/advert/v2/adverts?statuses=4,7,8,9,11'
};
const SHEET_NAMES = { prices: 'Цены', ads: 'Реклама', history: 'История', log: 'Журнал обновлений' };
const PRICE_HEADERS = ['Кабинет', 'Артикул WB', 'Артикул продавца', 'Название', 'Цена до скидки, ₽', 'Скидка продавца, %', 'Цена со скидкой, ₽', 'Скидка WB Клуба, %', 'Цена в WB Клубе, ₽', 'Цены по размерам', 'Обновлено'];
const AD_HEADERS = ['Кабинет', 'ID кампании', 'Название', 'Статус', 'Ставка', 'Оплата', 'Где показывается', 'Товаров', 'Создана', 'Запущена', 'Изменена', 'Обновлено'];
const HISTORY_HEADERS = ['Когда', 'Кабинет', 'Раздел', 'ID', 'Товар или кампания', 'Что изменилось', 'Было', 'Стало'];
const LOG_HEADERS = ['Когда', 'Кабинет', 'Результат'];
// Какие столбцы сравниваются с прошлым обновлением (номера столбцов с нуля).
const PRICE_TRACKED = [4, 5, 6, 7, 8];
const AD_TRACKED = [2, 3, 4, 5, 6, 7];
const AD_STATUSES = { '-1': 'Удаляется', 4: 'Готова к запуску', 7: 'Завершена', 8: 'Отменена', 9: 'Активна', 11: 'На паузе' };
const AD_STATUS_ORDER = { 'Активна': 0, 'На паузе': 1, 'Готова к запуску': 2, 'Завершена': 3, 'Отменена': 4, 'Удаляется': 5 };
const BID_TYPES = { unified: 'Единая', manual: 'Ручная' };
const PAYMENT_TYPES = { cpm: 'За показы (CPM)', cpc: 'За клики (CPC)' };
const HISTORY_LIMIT = 20000, LOG_LIMIT = 1000;
const DATE_FORMAT = 'dd.MM.yyyy HH:mm';

// ---------- Меню ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('WB')
    .addItem('Обновить сейчас', 'refreshAll')
    .addSeparator()
    .addItem('Добавить кабинет (токен)', 'addCabinet')
    .addItem('Список кабинетов', 'listCabinets')
    .addItem('Удалить кабинет', 'removeCabinet')
    .addSeparator()
    .addItem('Включить обновление раз в час', 'enableHourly')
    .addItem('Выключить автообновление', 'disableHourly')
    .addToUi();
}

// ---------- Кабинеты: [{ name, token }] в свойствах скрипта ----------
function getCabinets() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('WB_CABINETS') || '[]'); } catch (error) { return []; }
}
function saveCabinets(list) { PropertiesService.getScriptProperties().setProperty('WB_CABINETS', JSON.stringify(list)); }

function addCabinet() {
  const ui = SpreadsheetApp.getUi();
  const nameAnswer = ui.prompt('Новый кабинет', 'Название кабинета — так он будет подписан в таблице:', ui.ButtonSet.OK_CANCEL);
  const name = nameAnswer.getResponseText().trim();
  if (nameAnswer.getSelectedButton() !== ui.Button.OK || !name) return;
  const tokenAnswer = ui.prompt('Токен WB для «' + name + '»',
    'Вставьте токен API из личного кабинета WB (Настройки → Доступ к API). Нужны категории «Цены и скидки», «Продвижение» и «Контент»; достаточно «Только на чтение».',
    ui.ButtonSet.OK_CANCEL);
  const token = tokenAnswer.getResponseText().trim();
  if (tokenAnswer.getSelectedButton() !== ui.Button.OK || !token) return;
  // Проверяем токен одним лёгким запросом цен, чтобы не сохранить опечатку.
  try { wbFetch(WB_URLS.prices + '?limit=1&offset=0', token); }
  catch (error) { ui.alert('Токен не подошёл: ' + error.message + '\n\nКабинет не сохранён.'); return; }
  const list = getCabinets().filter(function (item) { return item.name !== name; });
  list.push({ name: name, token: token });
  saveCabinets(list);
  ui.alert('Кабинет «' + name + '» сохранён.\n\nТеперь: WB → Обновить сейчас. Чтобы обновлялось само — WB → Включить обновление раз в час.');
}
function listCabinets() {
  const list = getCabinets();
  SpreadsheetApp.getUi().alert(list.length ? 'Кабинеты:\n\n' + list.map(function (item) { return '• ' + item.name + ' (токен …' + item.token.slice(-6) + ')'; }).join('\n') : 'Кабинетов нет. WB → Добавить кабинет.');
}
function removeCabinet() {
  const ui = SpreadsheetApp.getUi(), list = getCabinets();
  if (!list.length) { ui.alert('Кабинетов нет.'); return; }
  const answer = ui.prompt('Удалить кабинет', 'Напишите название кабинета:\n' + list.map(function (item) { return '• ' + item.name; }).join('\n'), ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const name = answer.getResponseText().trim(), rest = list.filter(function (item) { return item.name !== name; });
  if (rest.length === list.length) { ui.alert('Кабинета «' + name + '» нет.'); return; }
  saveCabinets(rest);
  ui.alert('Кабинет «' + name + '» удалён. Его строки уйдут из листов при следующем обновлении.');
}

// ---------- Автообновление ----------
function enableHourly() {
  disableHourly(true);
  ScriptApp.newTrigger('refreshAll').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('Готово: таблица будет обновляться раз в час, даже когда она закрыта.');
}
function disableHourly(silent) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) { if (trigger.getHandlerFunction() === 'refreshAll') ScriptApp.deleteTrigger(trigger); });
  if (silent !== true) SpreadsheetApp.getUi().alert('Автообновление выключено. Обновить можно вручную: WB → Обновить сейчас.');
}

// ---------- Запросы к WB ----------
// При лимите WB (429) и сбоях сервера (5xx) ждём и повторяем до 4 раз.
function wbFetch(url, token, body) {
  const options = { method: body ? 'post' : 'get', headers: { Authorization: token }, muteHttpExceptions: true };
  if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = UrlFetchApp.fetch(url, options), code = response.getResponseCode();
    if (code === 429 || code >= 500) { Utilities.sleep(Math.min(30000, (code === 429 ? 6000 : 2000) * (attempt + 1))); continue; }
    const text = response.getContentText();
    if (code === 401) throw new Error('WB не принял токен (401): токен неверный, истёк или без нужной категории');
    if (code >= 400) throw new Error('WB ответил ' + code + ': ' + text.slice(0, 200));
    return text ? JSON.parse(text) : {};
  }
  throw new Error('WB не отвечает: лимит запросов или сбой, попробуйте позже');
}
function loadPrices(token) {
  const goods = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const response = wbFetch(WB_URLS.prices + '?limit=1000&offset=' + offset, token);
    const batch = (response.data && response.data.listGoods) || [];
    goods.push.apply(goods, batch);
    if (batch.length < 1000) break;
    Utilities.sleep(650);
  }
  return goods;
}
// Названия товаров — из карточек (API цен их не отдаёт). Без категории «Контент» столбец будет пустым.
function loadCardNames(token) {
  const names = {};
  let cursor = { limit: 100 };
  for (let page = 0; page < 200; page++) {
    const response = wbFetch(WB_URLS.cards, token, { settings: { sort: { ascending: false }, cursor: cursor, filter: { withPhoto: -1 } } });
    const cards = response.cards || [];
    cards.forEach(function (card) { names[card.nmID] = card.title || ''; });
    if (cards.length < 100 || !response.cursor || !response.cursor.nmID) break;
    cursor = { limit: 100, updatedAt: response.cursor.updatedAt, nmID: response.cursor.nmID };
    if ((page + 1) % 5 === 0) Utilities.sleep(700);
  }
  return names;
}
function loadAdverts(token) { return wbFetch(WB_URLS.adverts, token).adverts || []; }

// ---------- Строки листов ----------
function priceRow(cabinet, good, names, now) {
  const sizes = good.sizes || [], first = sizes[0] || {};
  const distinct = sizes.map(function (size) { return Number(size.discountedPrice); }).filter(function (value, index, all) { return all.indexOf(value) === index; });
  const bySize = distinct.length > 1 ? sizes.map(function (size) { return (size.techSizeName || size.sizeID) + ': ' + round2(size.discountedPrice); }).join(', ') : '';
  return [cabinet, Number(good.nmID), good.vendorCode || '', names[good.nmID] || '', round2(first.price), Number(good.discount || 0), round2(first.discountedPrice),
    Number(good.clubDiscount || 0), round2(first.clubDiscountedPrice), bySize, now];
}
function adRow(cabinet, advert, now) {
  const settings = advert.settings || {}, placements = settings.placements || {}, times = advert.timestamps || {};
  const where = [placements.search ? 'Поиск' : '', placements.recommendations ? 'Рекомендации' : ''].filter(String).join(', ');
  return [cabinet, Number(advert.id), settings.name || ('Кампания #' + advert.id), AD_STATUSES[advert.status] || ('Статус ' + advert.status),
    BID_TYPES[advert.bid_type] || advert.bid_type || '', PAYMENT_TYPES[settings.payment_type] || settings.payment_type || '', where || '—',
    (advert.nm_settings || []).length, toDate(times.created), toDate(times.started), toDate(times.updated), now];
}
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }
// Даты WB — строки с часовым поясом; «2100-01-01» и пустые означают «нет даты».
function toDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return isNaN(date.getTime()) || date.getFullYear() >= 2100 ? '' : date;
}

// ---------- Обновление ----------
function refreshAll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { notify('Обновление уже идёт — дождитесь его окончания'); return; }
  try {
    const cabinets = getCabinets();
    if (!cabinets.length) { notify('Сначала добавьте кабинет: WB → Добавить кабинет (токен)'); return; }
    notify('Обновляю цены и рекламу…');
    const book = SpreadsheetApp.getActive(), now = new Date();
    const priceRows = [], adRows = [], logRows = [], failedPrices = {}, failedAds = {};
    cabinets.forEach(function (cabinet) {
      const notes = [];
      try {
        const goods = loadPrices(cabinet.token);
        let names = {};
        try { names = loadCardNames(cabinet.token); } catch (error) { notes.push('названия товаров не получены: ' + error.message); }
        goods.forEach(function (good) { priceRows.push(priceRow(cabinet.name, good, names, now)); });
        notes.unshift('цены: ' + goods.length + ' товаров');
      } catch (error) { failedPrices[cabinet.name] = true; notes.unshift('цены: ошибка — ' + error.message); }
      try {
        const adverts = loadAdverts(cabinet.token);
        adverts.forEach(function (advert) { adRows.push(adRow(cabinet.name, advert, now)); });
        notes.push('реклама: ' + adverts.length + ' кампаний');
      } catch (error) { failedAds[cabinet.name] = true; notes.push('реклама: ошибка — ' + error.message); }
      logRows.push([now, cabinet.name, notes.join('; ')]);
    });
    priceRows.sort(function (a, b) { return String(a[0]).localeCompare(b[0]) || String(a[2]).localeCompare(b[2]) || a[1] - b[1]; });
    const statusOrder = function (row) { return row[3] in AD_STATUS_ORDER ? AD_STATUS_ORDER[row[3]] : 9; };
    adRows.sort(function (a, b) { return String(a[0]).localeCompare(b[0]) || statusOrder(a) - statusOrder(b) || String(a[2]).localeCompare(b[2]); });
    const history = [];
    writeWithHistory(book, SHEET_NAMES.prices, PRICE_HEADERS, priceRows, failedPrices, PRICE_TRACKED, 'Цены', function (row) { return [row[2], row[3]].filter(String).join(' · '); }, history, now,
      { 5: '#,##0', 6: '0', 7: '#,##0', 8: '0', 9: '#,##0', 11: DATE_FORMAT });
    writeWithHistory(book, SHEET_NAMES.ads, AD_HEADERS, adRows, failedAds, AD_TRACKED, 'Реклама', function (row) { return row[2]; }, history, now,
      { 9: DATE_FORMAT, 10: DATE_FORMAT, 11: DATE_FORMAT, 12: DATE_FORMAT });
    prependRows(sheet(book, SHEET_NAMES.history), HISTORY_HEADERS, history, HISTORY_LIMIT, { 1: DATE_FORMAT });
    prependRows(sheet(book, SHEET_NAMES.log), LOG_HEADERS, logRows, LOG_LIMIT, { 1: DATE_FORMAT });
    notify('Готово: товаров ' + priceRows.length + ', кампаний ' + adRows.length + ', изменений ' + history.length);
  } finally { lock.releaseLock(); }
}

// Пишет лист заново и складывает в history отличия от того, что было на листе до обновления.
// Строки кабинетов, по которым WB сейчас ответил ошибкой, остаются прежними — ошибка не стирает данные.
function writeWithHistory(book, name, headers, rows, failed, tracked, section, title, history, now, formats) {
  const target = sheet(book, name), old = target.getLastRow() > 1 ? target.getRange(2, 1, target.getLastRow() - 1, headers.length).getValues() : [];
  const key = function (row) { return row[0] + '|' + row[1]; }, oldByKey = {}, newKeys = {}, oldCabinets = {};
  old.forEach(function (row) { oldByKey[key(row)] = row; oldCabinets[row[0]] = true; });
  const kept = old.filter(function (row) { return failed[row[0]]; });
  rows.forEach(function (row) {
    newKeys[key(row)] = true;
    const before = oldByKey[key(row)];
    // Первое обновление кабинета — без истории: сравнивать не с чем.
    if (!before) { if (oldCabinets[row[0]]) history.push([now, row[0], section, row[1], title(row), 'Появилось в списке', '—', section === 'Реклама' ? row[3] : row[6]]); return; }
    tracked.forEach(function (index) {
      if (same(before[index], row[index])) return;
      history.push([now, row[0], section, row[1], title(row), headers[index], display(before[index]), display(row[index])]);
    });
  });
  old.forEach(function (row) {
    if (failed[row[0]] || newKeys[key(row)] || !rowsHaveCabinet(rows, row[0])) return;
    history.push([now, row[0], section, row[1], title(row), 'Пропало из списка', section === 'Реклама' ? row[3] : row[6], '—']);
  });
  writeSheet(target, headers, rows.concat(kept), formats);
}
function rowsHaveCabinet(rows, cabinet) { return rows.some(function (row) { return row[0] === cabinet; }); }
function same(a, b) { return normalize(a) === normalize(b); }
function normalize(value) { return typeof value === 'number' ? String(round2(value)) : value instanceof Date ? String(value.getTime()) : String(value === null || value === undefined ? '' : value).trim(); }
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
  target.clearContents();
  header(target, headers);
  if (rows.length) { target.getRange(2, 1, rows.length, headers.length).setValues(rows); applyFormats(target, 2, rows.length, formats); }
  if (target.getLastRow() < 200) target.autoResizeColumns(1, headers.length);
}
// Новые строки — сверху, сразу под заголовком; лист обрезается до limit строк.
function prependRows(target, headers, rows, limit, formats) {
  if (target.getLastRow() === 0) header(target, headers);
  if (!rows.length) return;
  target.insertRowsAfter(1, rows.length);
  target.getRange(2, 1, rows.length, headers.length).setValues(rows).setFontWeight('normal').setBackground(null);
  applyFormats(target, 2, rows.length, formats);
  const extra = target.getLastRow() - 1 - limit;
  if (extra > 0) target.deleteRows(limit + 2, extra);
}
// Всплывающая подсказка справа внизу; при запуске по расписанию её никто не видит — тогда просто пропускаем.
function notify(text) { try { SpreadsheetApp.getActive().toast(text, 'WB', 6); } catch (error) { /* запуск по расписанию */ } }
