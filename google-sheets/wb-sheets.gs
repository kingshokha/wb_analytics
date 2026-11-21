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
 *   «Заказы»            — строка на заказ из «Ленты заказов»: время каждого статуса, тип отмены, текущий статус;
 *   «Журнал обновлений» — когда обновлялось и что вернул WB по каждому кабинету.
 * Токены хранятся в свойствах скрипта (не в ячейках). Меню «WB» появляется после открытия таблицы.
 */

const WB_URLS = {
  prices: 'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter',
  cards: 'https://content-api.wildberries.ru/content/v2/get/cards/list',
  adverts: 'https://advert-api.wildberries.ru/api/advert/v2/adverts?statuses=4,7,8,9,11',
  normqueryList: 'https://advert-api.wildberries.ru/adv/v0/normquery/list',
  stocksReport: 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/',
  orderFeed: 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/order-feed'
};
const SHEET_NAMES = { prices: 'Цены', ads: 'Реклама', bids: 'Ставки', minus: 'Минус-фразы', stocks: 'Остатки', history: 'История', stockHistory: 'История остатков', orders: 'Заказы', log: 'Журнал обновлений' };
// «Заказы»: строка на заказ (srid) из «Ленты заказов» WB (POST /api/analytics/v1/order-feed, категория токена «Аналитика»).
// WB отдаёт только текущий статус заказа и время, когда он установлен; при каждом обновлении строка заказа дополняется:
// время статуса пишется в его столбец («Выкуплен», «Отменён», «Возвращён», «Возвращён (брак)») один раз — когда статус
// замечен впервые, поэтому прошлые статусы остаются видны. «Текущий статус» и «Статус с» — последний статус.
// Если статус сменился дважды между обновлениями (раз в час), промежуточного WB не отдаёт — его столбец останется пустым.
// Лента — максимум за 31 день и 1 запрос в минуту (базовый токен — 1 раз в 3 часа); при отказе WB (429) заказы
// догрузятся при следующем обновлении: за 30 дней ничего не теряется. Строки не удаляются, новые заказы — сверху.
const ORDER_HEADERS = ['Кабинет', 'ID заказа', 'Артикул WB', 'Артикул продавца', 'Товар', 'ID размера', 'Склад', 'Тип склада', 'Регион склада',
  'Город доставки', 'Округ доставки', 'Тип продажи', 'Цена продавца, ₽', 'Оформлен', 'Выкуплен', 'Отменён', 'Тип отмены', 'Возвращён',
  'Возвращён (брак)', 'Текущий статус', 'Статус с', 'Обновлено'];
const ORDER_STATUSES = { created: 'Оформлен', buyout: 'Выкуплен', cancel: 'Отменён', return: 'Возвращён', returnDefective: 'Возвращён (брак)' };
// Столбец времени каждого статуса (номера с нуля).
const ORDER_STATUS_COLUMNS = { created: 13, buyout: 14, cancel: 15, return: 17, returnDefective: 18 };
const ORDER_CANCEL_TYPES = { app: 'Отказ до получения', receipt: 'Отказ при получении', expire: 'Истёк срок получения', other: 'Иное' };
const ORDER_COLUMNS = { cancelType: 16, status: 19, since: 20, updated: 21 };
const ORDER_FEED_LIMIT = 10000;
// «Минус-фразы»: строка на пару «кампания + артикул» — какие поисковые запросы исключены (normquery/list → excluded).
// Изменение списка попадает в «Историю» (раздел «Ключевые слова»): какие запросы исключили и какие вернули в работу.
const MINUS_HEADERS = ['Кабинет', 'ID кампании', 'Кампания', 'Статус', 'Артикул WB', 'Артикул продавца', 'Исключено запросов', 'Исключённые запросы', 'Обновлено'];
const MINUS_TRACKED = [7];
const MINUS_SEPARATOR = ' | ';
// «Остатки»: строка на «тип (FBW / FBS) + склад + артикул», размеры сложены; нулевые остатки не пишутся.
// Изменения — на отдельный лист «История остатков»: остатки меняются с каждым заказом и вытеснили бы остальную историю.
const STOCK_HEADERS = ['Кабинет', 'Тип', 'Склад', 'Артикул WB', 'Артикул продавца', 'Название', 'Остаток, шт', 'Обновлено'];
const STOCK_HISTORY_HEADERS = ['Когда', 'Кабинет', 'Тип', 'Артикул WB', 'Товар', 'Склад', 'Было, шт', 'Стало, шт'];
const STOCK_REPORTS = [['wb-warehouses', 'FBW'], ['seller-warehouses', 'FBS']];
// «Ставки»: строка на пару «кампания + артикул» — ставки в поиске и рекомендациях из nm_settings.bids_kopecks.
// Только кампании, которые могут показываться (активна, на паузе, готова к запуску): у завершённых ставки не меняются.
const BID_HEADERS = ['Кабинет', 'ID кампании', 'Кампания', 'Статус', 'Ставка', 'Артикул WB', 'Артикул продавца', 'Предмет', 'Ставка в поиске, ₽', 'Ставка в рекомендациях, ₽', 'Обновлено'];
const BID_TRACKED = [8, 9];
const BID_STATUSES = { 4: true, 9: true, 11: true };
const PRICE_HEADERS = ['Кабинет', 'Артикул WB', 'Артикул продавца', 'Название', 'Цена до скидки, ₽', 'Скидка продавца, %', 'Цена со скидкой, ₽', 'Скидка WB Клуба, %', 'Цена в WB Клубе, ₽', 'Цены по размерам', 'Обновлено'];
const AD_HEADERS = ['Кабинет', 'ID кампании', 'Название', 'Статус', 'Ставка', 'Оплата', 'Где показывается', 'Товаров', 'Артикулы WB', 'Артикулы продавца', 'Создана', 'Запущена', 'Изменена', 'Обновлено'];
const HISTORY_HEADERS = ['Когда', 'Кабинет', 'Раздел', 'ID', 'Товар или кампания', 'Что изменилось', 'Было', 'Стало'];
const LOG_HEADERS = ['Когда', 'Кабинет', 'Результат'];
// Какие столбцы сравниваются с прошлым обновлением (номера столбцов с нуля).
const PRICE_TRACKED = [4, 5, 6, 7, 8];
const AD_TRACKED = [2, 3, 4, 5, 6, 8];
// Состав кампании в «Истории» — не два длинных списка, а что добавили и что убрали.
const AD_LIST_COLUMN = 8;
const AD_STATUSES = { '-1': 'Удаляется', 4: 'Готова к запуску', 7: 'Завершена', 8: 'Отменена', 9: 'Активна', 11: 'На паузе' };
const AD_STATUS_ORDER = { 'Активна': 0, 'На паузе': 1, 'Готова к запуску': 2, 'Завершена': 3, 'Отменена': 4, 'Удаляется': 5 };
const BID_TYPES = { unified: 'Единая', manual: 'Ручная' };
const PAYMENT_TYPES = { cpm: 'За показы (CPM)', cpc: 'За клики (CPC)' };
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
    .addSeparator()
    .addItem('Ключ для сайта', 'showSiteKey')
    .addSeparator()
    .addItem('Заполненность таблицы', 'showTableSize')
    .addItem('Убрать пустые столбцы', 'trimEmptyColumns')
    .addToUi();
}

// ---------- Размер таблицы ----------
// Google ограничивает таблицу 10 млн ячеек и считает все ячейки листов — и пустые тоже. Новый лист создаётся
// с 26 столбцами (A–Z), поэтому у листов с 8 столбцами данных две трети ячеек пустые. Чем ближе к пределу, тем медленнее
// работает таблица (вплоть до ошибки «Сервис "Таблицы" слишком долго не может получить доступ к документу»).
const CELL_LIMIT = 10000000;
function tableSizes() {
  return SpreadsheetApp.getActive().getSheets().map(function (target) {
    const rows = target.getMaxRows(), columns = target.getMaxColumns(), lastColumn = Math.max(1, target.getLastColumn());
    return { sheet: target, name: target.getName(), rows: rows, columns: columns, lastColumn: lastColumn, cells: rows * columns, empty: Math.max(0, columns - lastColumn) * rows };
  });
}
function formatCount(value) { return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
// Только показывает размеры: ничего не меняет.
function showTableSize() {
  const sizes = tableSizes(), total = sizes.reduce(function (sum, item) { return sum + item.cells; }, 0);
  const empty = sizes.reduce(function (sum, item) { return sum + item.empty; }, 0);
  const lines = sizes.sort(function (a, b) { return b.cells - a.cells; }).map(function (item) {
    return item.name + ': ' + formatCount(item.rows) + ' строк × ' + item.columns + ' столбцов = ' + formatCount(item.cells) + ' ячеек' +
      (item.empty ? ' (пустые столбцы справа: ' + (item.columns - item.lastColumn) + ', это ' + formatCount(item.empty) + ' ячеек)' : '');
  });
  SpreadsheetApp.getUi().alert('Заполненность таблицы',
    'Всего: ' + formatCount(total) + ' ячеек из ' + formatCount(CELL_LIMIT) + ' — ' + Math.round(total / CELL_LIMIT * 1000) / 10 + '%.\n' +
    (empty ? 'Из них пустые столбцы справа от данных: ' + formatCount(empty) + ' ячеек — их можно убрать: WB → Убрать пустые столбцы.\n' : '') +
    '\n' + lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}
// Удаляет на листах скрипта столбцы справа от последнего столбца с данными — только после подтверждения.
// Данные, строки и столбцы с данными не трогаются; столбцы можно вернуть: правой кнопкой → «Вставить столбцы».
function trimEmptyColumns() {
  const ui = SpreadsheetApp.getUi(), names = Object.keys(SHEET_NAMES).map(function (key) { return SHEET_NAMES[key]; });
  const plan = tableSizes().filter(function (item) { return names.indexOf(item.name) >= 0 && item.empty > 0; });
  if (!plan.length) { ui.alert('Пустых столбцов справа от данных на листах скрипта нет.'); return; }
  const freed = plan.reduce(function (sum, item) { return sum + item.empty; }, 0);
  const text = plan.map(function (item) { return item.name + ': удалить ' + (item.columns - item.lastColumn) + ' пустых столбцов после столбца ' + item.lastColumn; }).join('\n');
  if (ui.alert('Убрать пустые столбцы', text + '\n\nОсвободится ' + formatCount(freed) + ' ячеек. Данные не удаляются. Продолжить?', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { ui.alert('Сейчас идёт обновление таблицы — попробуйте через несколько минут.'); return; }
  try {
    plan.forEach(function (item) {
      // Проверка ещё раз прямо перед удалением: вдруг в столбцы справа что-то вписали, пока было открыто окно.
      const lastColumn = Math.max(1, item.sheet.getLastColumn()), extra = item.sheet.getMaxColumns() - lastColumn;
      if (extra > 0) item.sheet.deleteColumns(lastColumn + 1, extra);
    });
  } finally { lock.releaseLock(); }
  showTableSize();
}

// ---------- Данные для сайта WB Pulse (веб-приложение) ----------
// Сайт берёт отсюда историю — для графика цены товара, истории кампании и истории остатков:
//   GET <адрес веб-приложения>?key=<ключ>&id=<артикул WB или ID кампании, через запятую>&sections=Цены,Ставки&days=30
// Разделы «Остатки FBW» и «Остатки FBS» читаются с листа «История остатков» (id не обязателен), к ним добавляются
// текущие остатки с листа «Остатки» (current). days — только изменения за последние N дней.
// Без верного ключа — ошибка. Ключ создаётся пунктом меню «WB → Ключ для сайта» и хранится в свойствах скрипта.
function doGet(e) {
  const params = (e && e.parameter) || {}, key = PropertiesService.getScriptProperties().getProperty('WB_SITE_KEY');
  if (!key || params.key !== key) return jsonOutput({ error: 'Неверный ключ доступа к таблице' });
  if (params.sync) return jsonOutput(syncExport(params));
  const book = SpreadsheetApp.getActive(), log = book.getSheetByName(SHEET_NAMES.log);
  const list = function (value) { return String(value || '').split(',').map(function (item) { return item.trim(); }).filter(String); };
  const ids = list(params.id), sections = list(params.sections), days = Number(params.days) || 0, fromTime = days > 0 ? Date.now() - days * 86400000 : 0;
  const stockTypes = sections.filter(function (item) { return item.indexOf('Остатки ') === 0; }).map(function (item) { return item.slice('Остатки '.length); });
  const mainSections = sections.filter(function (item) { return item.indexOf('Остатки ') !== 0; });
  const rowsOf = function (name, width) { const target = book.getSheetByName(name); return target && target.getLastRow() > 1 ? target.getRange(2, 1, target.getLastRow() - 1, width).getValues() : []; };
  const fresh = function (row) { return !fromTime || (row[0] instanceof Date && row[0].getTime() >= fromTime); };
  const byId = function (value) { return !ids.length || ids.indexOf(String(value)) >= 0; };
  let items = [], current = null;
  if (!sections.length || mainSections.length) {
    items = rowsOf(SHEET_NAMES.history, HISTORY_HEADERS.length).filter(function (row) { return byId(row[3]) && (!mainSections.length || mainSections.indexOf(String(row[2])) >= 0) && fresh(row); })
      .slice(0, 3000).map(function (row) { return { at: isoDate(row[0]), cabinet: row[1], section: row[2], id: String(row[3]), title: row[4], what: row[5], before: row[6], after: row[7] }; });
  }
  if (stockTypes.length) {
    // «История остатков»: Когда | Кабинет | Тип | Артикул WB | Товар | Склад | Было | Стало — склад отдаётся в what.
    items = items.concat(rowsOf(SHEET_NAMES.stockHistory, STOCK_HISTORY_HEADERS.length).filter(function (row) { return stockTypes.indexOf(String(row[2])) >= 0 && byId(row[3]) && fresh(row); })
      .slice(0, 40000).map(function (row) { return { at: isoDate(row[0]), cabinet: row[1], section: 'Остатки ' + row[2], id: String(row[3]), title: row[4], what: row[5], before: row[6], after: row[7] }; }));
    current = rowsOf(SHEET_NAMES.stocks, STOCK_HEADERS.length).filter(function (row) { return stockTypes.indexOf(String(row[1])) >= 0 && byId(row[3]); })
      .map(function (row) { return { cabinet: row[0], type: row[1], warehouse: row[2], nmId: String(row[3]), vendorCode: row[4], name: row[5], quantity: Number(row[6]) || 0, updatedAt: isoDate(row[7]) }; });
  }
  // since — первое обновление таблицы: раньше этого момента изменений не видно (журнал — новые сверху).
  const since = log && log.getLastRow() > 1 ? isoDate(log.getRange(log.getLastRow(), 1).getValue()) : null;
  return jsonOutput({ items: items, current: current, since: since, now: new Date().toISOString() });
}
// Выгрузка для копии на компьютере (сервер сайта, data/Sheet): ?sync=1&after=<ISO>&offset=0&limit=20000.
// Все строки «Истории» и «Истории остатков» не старше after (включительно — строки одного обновления пишутся
// в одно время, сайт сам убирает повторы), от старых к новым, порциями; more — есть ли следующая порция.
// current — текущие остатки с листа «Остатки» (только в первой порции).
function syncExport(params) {
  const book = SpreadsheetApp.getActive(), log = book.getSheetByName(SHEET_NAMES.log);
  const after = params.after ? new Date(params.after).getTime() : 0, offset = Math.max(0, Number(params.offset) || 0), limit = Math.min(30000, Math.max(1, Number(params.limit) || 20000));
  const rowsOf = function (name, width) { const target = book.getSheetByName(name); return target && target.getLastRow() > 1 ? target.getRange(2, 1, target.getLastRow() - 1, width).getValues() : []; };
  const fresh = function (row) { return row[0] instanceof Date && (!after || row[0].getTime() >= after); };
  const items = rowsOf(SHEET_NAMES.history, HISTORY_HEADERS.length).filter(fresh)
    .map(function (row) { return { at: isoDate(row[0]), cabinet: row[1], section: row[2], id: String(row[3]), title: row[4], what: row[5], before: row[6], after: row[7] }; })
    .concat(rowsOf(SHEET_NAMES.stockHistory, STOCK_HISTORY_HEADERS.length).filter(fresh)
      .map(function (row) { return { at: isoDate(row[0]), cabinet: row[1], section: 'Остатки ' + row[2], id: String(row[3]), title: row[4], what: row[5], before: row[6], after: row[7] }; }))
    .sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  const current = offset ? null : rowsOf(SHEET_NAMES.stocks, STOCK_HEADERS.length)
    .map(function (row) { return { cabinet: row[0], type: row[1], warehouse: row[2], nmId: String(row[3]), vendorCode: row[4], name: row[5], quantity: Number(row[6]) || 0, updatedAt: isoDate(row[7]) }; });
  const since = log && log.getLastRow() > 1 ? isoDate(log.getRange(log.getLastRow(), 1).getValue()) : null;
  return { items: items.slice(offset, offset + limit), total: items.length, more: offset + limit < items.length, current: current, since: since, now: new Date().toISOString() };
}
function jsonOutput(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function isoDate(value) { return value instanceof Date ? value.toISOString() : (value ? String(value) : null); }
function showSiteKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('WB_SITE_KEY');
  if (!key) { key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); props.setProperty('WB_SITE_KEY', key); }
  SpreadsheetApp.getUi().alert('Ключ для сайта WB Pulse',
    'Впишите в файл .env сайта строку и перезапустите сервер:\n\nWB_SHEET_KEY=' + key +
    '\n\nКлюч даёт доступ к «Истории» таблицы (цены, статусы, ставки) — никому его не пересылайте и не публикуйте.', SpreadsheetApp.getUi().ButtonSet.OK);
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
// При лимите WB (429) и сбоях сервера (5xx) ждём и повторяем до 4 раз (attempts — сколько попыток; у ленты заказов
// лимит 1 запрос в минуту, повторять её через секунды бесполезно).
function wbFetch(url, token, body, attempts) {
  const options = { method: body ? 'post' : 'get', headers: { Authorization: token }, muteHttpExceptions: true };
  if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
  const tries = attempts || 4;
  for (let attempt = 0; attempt < tries; attempt++) {
    const response = UrlFetchApp.fetch(url, options), code = response.getResponseCode();
    if (code === 429 || code >= 500) {
      if (attempt === tries - 1) break;
      Utilities.sleep(Math.min(30000, (code === 429 ? 6000 : 2000) * (attempt + 1)));
      continue;
    }
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
// Названия и артикулы продавца — из карточек (API цен и рекламы их не отдают): { nmID: { title, vendorCode } }.
// Без категории «Контент» названия и артикулы продавца будут пустыми.
function loadCards(token) {
  const cardsById = {};
  let cursor = { limit: 100 };
  for (let page = 0; page < 200; page++) {
    const response = wbFetch(WB_URLS.cards, token, { settings: { sort: { ascending: false }, cursor: cursor, filter: { withPhoto: -1 } } });
    const cards = response.cards || [];
    cards.forEach(function (card) { cardsById[card.nmID] = { title: card.title || '', vendorCode: card.vendorCode || '' }; });
    if (cards.length < 100 || !response.cursor || !response.cursor.nmID) break;
    cursor = { limit: 100, updatedAt: response.cursor.updatedAt, nmID: response.cursor.nmID };
    if ((page + 1) % 5 === 0) Utilities.sleep(700);
  }
  return cardsById;
}
function loadAdverts(token) { return wbFetch(WB_URLS.adverts, token).adverts || []; }
// Заказы, у которых статус менялся за последние 30 дней (WB отдаёт не дальше 31 дня). До 10 000 за запрос; дальше —
// следующая страница с тем же snapshotTime, но не раньше чем через минуту (лимит WB).
function loadOrderFeed(token, now) {
  const orders = [], start = new Date(now.getTime() - 30 * 86400000).toISOString();
  let snapshotTime = '';
  for (let page = 0; page < 3; page++) {
    if (page) Utilities.sleep(61000);
    const pagination = { offset: page * ORDER_FEED_LIMIT, limit: ORDER_FEED_LIMIT };
    if (snapshotTime) pagination.snapshotTime = snapshotTime;
    const response = wbFetch(WB_URLS.orderFeed, token, { selectedPeriod: { start: start, end: now.toISOString() }, pagination: pagination }, 1);
    const data = response.data || {}, batch = data.orders || [];
    if (!snapshotTime) snapshotTime = data.snapshotTime || '';
    orders.push.apply(orders, batch);
    if (batch.length < ORDER_FEED_LIMIT || !snapshotTime) break;
  }
  return orders;
}

// ---------- Строки листов ----------
function priceRow(cabinet, good, cards, now) {
  const sizes = good.sizes || [], first = sizes[0] || {};
  const distinct = sizes.map(function (size) { return Number(size.discountedPrice); }).filter(function (value, index, all) { return all.indexOf(value) === index; });
  const bySize = distinct.length > 1 ? sizes.map(function (size) { return (size.techSizeName || size.sizeID) + ': ' + round2(size.discountedPrice); }).join(', ') : '';
  return [cabinet, Number(good.nmID), good.vendorCode || '', (cards[good.nmID] || {}).title || '', round2(first.price), Number(good.discount || 0), round2(first.discountedPrice),
    Number(good.clubDiscount || 0), round2(first.clubDiscountedPrice), bySize, now];
}
// Артикулы кампании — из nm_settings: артикулы WB по возрастанию и артикулы продавца в том же порядке.
function adRow(cabinet, advert, cards, now) {
  const settings = advert.settings || {}, placements = settings.placements || {}, times = advert.timestamps || {};
  const where = [placements.search ? 'Поиск' : '', placements.recommendations ? 'Рекомендации' : ''].filter(String).join(', ');
  const nmIds = (advert.nm_settings || []).map(function (item) { return Number(item.nm_id); }).filter(function (id) { return id > 0; }).sort(function (a, b) { return a - b; });
  const vendorCodes = nmIds.map(function (id) { return (cards[id] || {}).vendorCode || '—'; });
  return [cabinet, Number(advert.id), settings.name || ('Кампания #' + advert.id), AD_STATUSES[advert.status] || ('Статус ' + advert.status),
    BID_TYPES[advert.bid_type] || advert.bid_type || '', PAYMENT_TYPES[settings.payment_type] || settings.payment_type || '', where || '—',
    nmIds.length, nmIds.join(', '), vendorCodes.join(', '), toDate(times.created), toDate(times.started), toDate(times.updated), now];
}
// Ставки кампании по артикулам. Если место показа выключено, ставки там нет — пустая ячейка, а не 0.
function bidRows(cabinet, advert, cards, now) {
  if (!BID_STATUSES[advert.status]) return [];
  const settings = advert.settings || {}, placements = settings.placements || {};
  return (advert.nm_settings || []).filter(function (item) { return Number(item.nm_id) > 0; }).map(function (item) {
    const bids = item.bids_kopecks || {}, nmId = Number(item.nm_id);
    return [cabinet, Number(advert.id), settings.name || ('Кампания #' + advert.id), AD_STATUSES[advert.status] || ('Статус ' + advert.status),
      BID_TYPES[advert.bid_type] || advert.bid_type || '', nmId, (cards[nmId] || {}).vendorCode || '', (item.subject || {}).name || '',
      placements.search ? round2(Number(bids.search || 0) / 100) : '', placements.recommendations ? round2(Number(bids.recommendations || 0) / 100) : '', now];
  });
}
// Исключённые запросы кампаний, которые могут показываться: normquery/list, до 100 пар «кампания + артикул» за запрос.
function minusRows(cabinet, token, adverts, cards, now) {
  const pairs = [];
  adverts.filter(function (advert) { return BID_STATUSES[advert.status]; }).forEach(function (advert) {
    (advert.nm_settings || []).forEach(function (item) { if (Number(item.nm_id) > 0) pairs.push({ advert: advert, nmId: Number(item.nm_id) }); });
  });
  const rows = [];
  for (let offset = 0; offset < pairs.length; offset += 100) {
    if (offset) Utilities.sleep(300);
    const chunk = pairs.slice(offset, offset + 100), excludedBy = {};
    const response = wbFetch(WB_URLS.normqueryList, token, { items: chunk.map(function (pair) { return { advertId: Number(pair.advert.id), nmId: pair.nmId }; }) });
    (response.items || []).forEach(function (item) { excludedBy[item.advertId + '|' + item.nmId] = ((item.normQueries || {}).excluded || []).map(String); });
    chunk.forEach(function (pair) {
      const settings = pair.advert.settings || {}, excluded = (excludedBy[pair.advert.id + '|' + pair.nmId] || []).sort(function (a, b) { return a.localeCompare(b, 'ru'); });
      // В ячейке Google Таблицы не больше 50 000 символов — очень длинный список обрезается.
      const text = excluded.join(MINUS_SEPARATOR);
      rows.push([cabinet, Number(pair.advert.id), settings.name || ('Кампания #' + pair.advert.id), AD_STATUSES[pair.advert.status] || ('Статус ' + pair.advert.status),
        pair.nmId, (cards[pair.nmId] || {}).vendorCode || '', excluded.length, text.length > 45000 ? text.slice(0, 45000) + '…' : text, now]);
    });
  }
  return rows;
}
// Остатки из отчётов WB (как вкладки «Остатки FBW / FBS» на сайте): по складу и артикулу, размеры сложены.
function stockRows(cabinet, token, cards, now) {
  const rows = [];
  STOCK_REPORTS.forEach(function (report) {
    const sums = {};
    for (let offset = 0; ; offset += 250000) {
      const response = wbFetch(WB_URLS.stocksReport + report[0], token, { nmIds: [], chrtIds: [], limit: 250000, offset: offset });
      const items = (response.data && response.data.items) || response.items || [];
      items.forEach(function (item) {
        const nmId = Number(item.nmId || 0), warehouse = item.warehouseName || ('Склад ' + (item.warehouseId || '')), key = warehouse + '|' + nmId;
        if (!nmId) return;
        sums[key] = sums[key] || { warehouse: warehouse, nmId: nmId, quantity: 0 };
        sums[key].quantity += Number(item.quantity || 0);
      });
      if (items.length < 250000) break;
      Utilities.sleep(20100);
    }
    Object.keys(sums).forEach(function (key) {
      const item = sums[key], card = cards[item.nmId] || {};
      if (item.quantity > 0) rows.push([cabinet, report[1], item.warehouse, item.nmId, card.vendorCode || '', card.title || '', item.quantity, now]);
    });
  });
  return rows;
}
// Новая строка заказа: неизменные поля — из ленты и карточек, статус — через applyOrderStatus.
function orderRow(cabinet, order, cards, now) {
  const card = cards[order.nmId] || {};
  const row = [cabinet, String(order.srid), Number(order.nmId) || '', card.vendorCode || '', card.title || '', Number(order.chrtId) || '',
    order.warehouseName || '', order.isMp ? 'Склад продавца (FBS)' : 'Склад WB (FBW)', order.warehouseRegion || '', order.destinationCity || '',
    order.destinationDistrict || '', order.isB2b ? 'B2B' : 'B2C', round2(order.sellerPrice), toDate(order.createdAt), '', '', '', '', '', '', '', now];
  applyOrderStatus(row, order, now);
  return row;
}
// Дополняет строку текущим статусом заказа; true — если что-то изменилось (тогда «Обновлено» = now).
// Время статуса пишется в его столбец только в первый раз: прошлые статусы не затираются.
function applyOrderStatus(row, order, now) {
  const status = String(order.status || ''), at = toDate(order.updatedAt) || toDate(order.createdAt), column = ORDER_STATUS_COLUMNS[status];
  let changed = false;
  const set = function (index, value) { if (!same(row[index], value)) { row[index] = value; changed = true; } };
  if (column !== undefined && row[column] === '' && at) set(column, at);
  if (status === 'cancel') set(ORDER_COLUMNS.cancelType, ORDER_CANCEL_TYPES[order.cancelType] || order.cancelType || '');
  set(ORDER_COLUMNS.status, ORDER_STATUSES[status] || status);
  set(ORDER_COLUMNS.since, at);
  if (changed) row[ORDER_COLUMNS.updated] = now;
  return changed;
}

// «1, 2, 3» → «2, 3, 4»: «убран 1, добавлен 4» — пишется в «Что изменилось»; «Было» и «Стало» — списки целиком.
// options: separator (по умолчанию «,»), words — подписи { removed: [одно, много], added: [одно, много] }, quote — «в кавычках».
const LIST_WORDS = { removed: ['убран', 'убраны'], added: ['добавлен', 'добавлены'] };
function listDiff(before, after, options) {
  const settings = options || {}, separator = settings.separator || ',', words = settings.words || LIST_WORDS;
  const split = function (value) { return String(value || '').split(separator).map(function (item) { return item.trim(); }).filter(String); };
  const show = function (list) { return list.map(function (item) { return settings.quote ? '«' + item + '»' : item; }).join(', '); };
  const was = split(before), now = split(after);
  const removed = was.filter(function (item) { return now.indexOf(item) < 0; }), added = now.filter(function (item) { return was.indexOf(item) < 0; });
  return [removed.length ? words.removed[removed.length > 1 ? 1 : 0] + ' ' + show(removed) : '', added.length ? words.added[added.length > 1 ? 1 : 0] + ' ' + show(added) : ''].filter(String).join(', ');
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
    notify('Обновляю цены, рекламу и остатки…');
    const book = SpreadsheetApp.getActive(), now = new Date();
    const priceRows = [], adRows = [], bidRowsAll = [], minusRowsAll = [], stockRowsAll = [], logRows = [], failedPrices = {}, failedAds = {}, failedMinus = {}, failedStocks = {};
    const orderFeeds = [];
    cabinets.forEach(function (cabinet) {
      const notes = [];
      // Карточки нужны обоим листам: названия — ценам, артикулы продавца — рекламе.
      let cards = {};
      try { cards = loadCards(cabinet.token); } catch (error) { notes.push('карточки (названия и артикулы продавца) не получены: ' + error.message); }
      try {
        const goods = loadPrices(cabinet.token);
        goods.forEach(function (good) { priceRows.push(priceRow(cabinet.name, good, cards, now)); });
        notes.unshift('цены: ' + goods.length + ' товаров');
      } catch (error) { failedPrices[cabinet.name] = true; notes.unshift('цены: ошибка — ' + error.message); }
      try {
        const adverts = loadAdverts(cabinet.token);
        adverts.forEach(function (advert) { adRows.push(adRow(cabinet.name, advert, cards, now)); bidRowsAll.push.apply(bidRowsAll, bidRows(cabinet.name, advert, cards, now)); });
        notes.push('реклама: ' + adverts.length + ' кампаний');
        try {
          const minus = minusRows(cabinet.name, cabinet.token, adverts, cards, now);
          minusRowsAll.push.apply(minusRowsAll, minus);
          notes.push('минус-фразы: ' + minus.length + ' пар «кампания + артикул»');
        } catch (error) { failedMinus[cabinet.name] = true; notes.push('минус-фразы: ошибка — ' + error.message); }
      } catch (error) { failedAds[cabinet.name] = true; failedMinus[cabinet.name] = true; notes.push('реклама: ошибка — ' + error.message); }
      try {
        const stocks = stockRows(cabinet.name, cabinet.token, cards, now);
        stockRowsAll.push.apply(stockRowsAll, stocks);
        notes.push('остатки: ' + stocks.length + ' строк «склад + артикул»');
      } catch (error) { failedStocks[cabinet.name] = true; notes.push('остатки: ошибка — ' + error.message); }
      try {
        const orders = loadOrderFeed(cabinet.token, now);
        orderFeeds.push({ cabinet: cabinet.name, orders: orders, cards: cards });
        notes.push('заказы: ' + orders.length + ' с изменением статуса за 30 дней');
      } catch (error) { notes.push('заказы: ошибка — ' + error.message + ' (догрузятся при следующем обновлении)'); }
      logRows.push([now, cabinet.name, notes.join('; ')]);
    });
    // Заказы пишутся первыми: лист небольшой, а запись больших листов («Цены», «История») при перегруженной таблице
    // иногда обрывается ошибкой Google «слишком долго не может получить доступ к документу» — заказы от неё не зависят.
    // Ошибка самих «Заказов» не мешает остальным листам: она пишется строкой в «Журнал».
    let orderResult = { added: 0, updated: 0 };
    if (orderFeeds.length) {
      try { orderResult = writeOrders(book, orderFeeds, now); } catch (error) { logRows.push([now, '—', 'лист «Заказы»: ошибка записи — ' + error.message]); }
    }
    priceRows.sort(function (a, b) { return String(a[0]).localeCompare(b[0]) || String(a[2]).localeCompare(b[2]) || a[1] - b[1]; });
    const statusOrder = function (row) { return row[3] in AD_STATUS_ORDER ? AD_STATUS_ORDER[row[3]] : 9; };
    adRows.sort(function (a, b) { return String(a[0]).localeCompare(b[0]) || statusOrder(a) - statusOrder(b) || String(a[2]).localeCompare(b[2]); });
    bidRowsAll.sort(function (a, b) { return String(a[0]).localeCompare(b[0]) || statusOrder(a) - statusOrder(b) || String(a[2]).localeCompare(b[2]) || String(a[6]).localeCompare(b[6]) || a[5] - b[5]; });
    const history = [];
    writeWithHistory(book, history, now, { name: SHEET_NAMES.prices, headers: PRICE_HEADERS, rows: priceRows, failed: failedPrices, tracked: PRICE_TRACKED, section: 'Цены',
      title: function (row) { return [row[2], row[3]].filter(String).join(' · '); }, summary: function (row) { return row[6]; },
      formats: { 5: '#,##0', 6: '0', 7: '#,##0', 8: '0', 9: '#,##0', 11: DATE_FORMAT } });
    writeWithHistory(book, history, now, { name: SHEET_NAMES.ads, headers: AD_HEADERS, rows: adRows, failed: failedAds, tracked: AD_TRACKED, section: 'Реклама',
      title: function (row) { return row[2]; }, summary: function (row) { return row[3]; }, listColumn: AD_LIST_COLUMN,
      formats: { 9: '@', 10: '@', 11: DATE_FORMAT, 12: DATE_FORMAT, 13: DATE_FORMAT, 14: DATE_FORMAT } });
    // Ставки: ключ — кабинет, кампания и артикул; появление и пропажа артикулов уже видны в «Реклама → Артикулы WB».
    writeWithHistory(book, history, now, { name: SHEET_NAMES.bids, headers: BID_HEADERS, rows: bidRowsAll, failed: failedAds, tracked: BID_TRACKED, section: 'Ставки',
      key: function (row) { return row[0] + '|' + row[1] + '|' + row[5]; }, presence: false,
      title: function (row) { return row[2] + ' · ' + row[5] + (row[6] ? ' (' + row[6] + ')' : ''); },
      formats: { 9: '#,##0.00', 10: '#,##0.00', 11: DATE_FORMAT } });
    // Минус-фразы: в «Историю» — какие запросы исключили и какие вернули в работу, по кампании и артикулу.
    minusRowsAll.sort(function (a, b) { return String(a[0]).localeCompare(b[0]) || statusOrder(a) - statusOrder(b) || String(a[2]).localeCompare(b[2]) || a[4] - b[4]; });
    writeWithHistory(book, history, now, { name: SHEET_NAMES.minus, headers: MINUS_HEADERS, rows: minusRowsAll, failed: failedMinus, tracked: MINUS_TRACKED, section: 'Ключевые слова',
      key: function (row) { return row[0] + '|' + row[1] + '|' + row[4]; }, presence: false, listColumn: 7,
      list: { separator: MINUS_SEPARATOR, quote: true, counts: true, words: { removed: ['возвращён в работу', 'возвращены в работу'], added: ['исключён', 'исключены'] } },
      label: function () { return 'Исключённые запросы'; },
      title: function (row) { return row[2] + ' · ' + row[4] + (row[5] ? ' (' + row[5] + ')' : ''); },
      formats: { 9: DATE_FORMAT } });
    // Остатки: строка «Истории остатков» на каждое изменение по складу и артикулу; появился остаток — «было 0»,
    // закончился (строки больше нет) — «стало 0».
    stockRowsAll.sort(function (a, b) { return String(a[0]).localeCompare(b[0]) || String(a[1]).localeCompare(b[1]) || String(a[2]).localeCompare(b[2]) || String(a[4]).localeCompare(b[4]) || a[3] - b[3]; });
    const stockHistory = [];
    writeWithHistory(book, stockHistory, now, { name: SHEET_NAMES.stocks, headers: STOCK_HEADERS, rows: stockRowsAll, failed: failedStocks, tracked: [6],
      key: function (row) { return row[0] + '|' + row[1] + '|' + row[2] + '|' + row[3]; }, absent: { column: 6, value: 0 },
      section: function (row) { return row[1]; }, id: function (row) { return row[3]; }, label: function (row) { return row[2]; },
      title: function (row) { return [row[4], row[5]].filter(String).join(' · '); },
      formats: { 7: '#,##0', 8: DATE_FORMAT } });
    prependRows(sheet(book, SHEET_NAMES.history), HISTORY_HEADERS, history, { 1: DATE_FORMAT });
    prependRows(sheet(book, SHEET_NAMES.stockHistory), STOCK_HISTORY_HEADERS, stockHistory, { 1: DATE_FORMAT });
    prependRows(sheet(book, SHEET_NAMES.log), LOG_HEADERS, logRows, { 1: DATE_FORMAT });
    notify('Готово: товаров ' + priceRows.length + ', кампаний ' + adRows.length + ', ставок ' + bidRowsAll.length + ', остатков ' + stockRowsAll.length +
      ', изменений ' + history.length + ', изменений остатков ' + stockHistory.length + ', новых заказов ' + orderResult.added + ', обновлено заказов ' + orderResult.updated);
  } finally { lock.releaseLock(); }
}

// Пишет лист заново и складывает в history отличия от того, что было на листе до обновления.
// Строки кабинетов, по которым WB сейчас ответил ошибкой, остаются прежними — ошибка не стирает данные.
// Если столбцы листа изменились (новая версия скрипта), старые строки не сравниваются и не сохраняются — иначе
// значения съехавших столбцов попали бы в «Историю» как изменения.
// Настройки листа: name, headers, rows, failed (кабинеты с ошибкой WB), tracked (сравниваемые столбцы),
// section — раздел «Истории» (строка или section(row)), id(row) — ID в «Истории» (по умолчанию второй столбец),
// title(row) — подпись, label(row, index) — «Что изменилось» (по умолчанию заголовок столбца),
// summary(row) — значение для «Появилось / Пропало», key(row) — по умолчанию кабинет + ID,
// presence: false — не писать «Появилось / Пропало», absent: { column, value } — вместо «Появилось / Пропало»
// писать изменение этого столбца от value и до value (остаток появился: 0 → 5, закончился: 5 → 0),
// listColumn и list — столбец-список и настройки listDiff, formats.
function writeWithHistory(book, history, now, options) {
  const headers = options.headers, rows = options.rows, failed = options.failed, title = options.title;
  const key = options.key || function (row) { return row[0] + '|' + row[1]; }, presence = options.presence !== false;
  const sectionOf = typeof options.section === 'function' ? options.section : function () { return options.section; };
  const idOf = options.id || function (row) { return row[1]; };
  const labelOf = options.label || function (row, index) { return headers[index]; };
  const record = function (row, what, before, after) { history.push([now, row[0], sectionOf(row), idOf(row), title(row), what, before, after]); };
  const absent = options.absent;
  const target = sheet(book, options.name), lastColumn = Math.max(1, target.getLastColumn ? target.getLastColumn() : headers.length);
  const sameLayout = target.getLastRow() > 0 && target.getRange(1, 1, 1, lastColumn).getValues()[0].filter(String).join('|') === headers.join('|');
  const old = sameLayout && target.getLastRow() > 1 ? target.getRange(2, 1, target.getLastRow() - 1, headers.length).getValues() : [];
  const oldByKey = {}, newKeys = {}, oldCabinets = {};
  old.forEach(function (row) { oldByKey[key(row)] = row; oldCabinets[row[0]] = true; });
  const kept = old.filter(function (row) { return failed[row[0]]; });
  rows.forEach(function (row) {
    newKeys[key(row)] = true;
    const before = oldByKey[key(row)];
    // Первое обновление кабинета — без истории: сравнивать не с чем.
    if (!before) {
      if (!presence || !oldCabinets[row[0]]) return;
      if (absent) record(row, labelOf(row, absent.column), absent.value, row[absent.column]);
      else record(row, 'Появилось в списке', '—', display(options.summary(row)));
      return;
    }
    options.tracked.forEach(function (index) {
      if (same(before[index], row[index])) return;
      const label = labelOf(row, index), isList = index === options.listColumn, list = options.list || {};
      // list.counts — в «Было / Стало» число элементов, а не списки целиком (минус-фраз бывают сотни).
      const value = function (cell) { return isList && list.counts ? String(cell || '').split(list.separator || ',').map(function (item) { return item.trim(); }).filter(String).length : display(cell); };
      record(row, isList ? label + ': ' + listDiff(before[index], row[index], list) : label, value(before[index]), value(row[index]));
    });
  });
  if (presence) old.forEach(function (row) {
    if (failed[row[0]] || newKeys[key(row)] || !rowsHaveCabinet(rows, row[0])) return;
    if (absent) record(row, labelOf(row, absent.column), row[absent.column], absent.value);
    else record(row, 'Пропало из списка', display(options.summary(row)), '—');
  });
  writeSheet(target, headers, rows.concat(kept), options.formats);
}
function rowsHaveCabinet(rows, cabinet) { return rows.some(function (row) { return row[0] === cabinet; }); }
function same(a, b) { return normalize(a) === normalize(b); }
function normalize(value) { return typeof value === 'number' ? String(round2(value)) : value instanceof Date ? String(value.getTime()) : String(value === null || value === undefined ? '' : value).trim(); }
function display(value) { return value === '' || value === null || value === undefined ? '—' : value; }

// ---------- Заказы ----------
// Лист «Заказы»: строки заказов, которые уже есть, дополняются на месте (меняются только их ячейки статуса), новые —
// сверху. Читаются все строки листа (чтобы найти заказ по кабинету и ID), пишутся только изменённые.
// feeds — [{ cabinet, orders, cards }]. Возвращает { added, updated }.
function writeOrders(book, feeds, now) {
  const target = orderSheet(book), width = ORDER_HEADERS.length, lastRow = target.getLastRow();
  const old = lastRow > 1 ? target.getRange(2, 1, lastRow - 1, width).getValues() : [];
  const byKey = {}, changed = {}, added = [];
  old.forEach(function (row, index) { byKey[row[0] + '|' + String(row[1])] = { row: row, index: index }; });
  feeds.forEach(function (feed) {
    feed.orders.forEach(function (order) {
      if (!order.srid) return;
      const key = feed.cabinet + '|' + String(order.srid), found = byKey[key];
      if (!found) {
        const row = orderRow(feed.cabinet, order, feed.cards, now);
        byKey[key] = { row: row, index: -1 };
        added.push(row);
        return;
      }
      const card = feed.cards[order.nmId] || {}, row = found.row;
      // Карточки могли не загрузиться в прошлый раз — артикул продавца и название дописываются, когда появятся.
      let filled = false;
      if (row[3] === '' && card.vendorCode) { row[3] = card.vendorCode; filled = true; }
      if (row[4] === '' && card.title) { row[4] = card.title; filled = true; }
      if ((applyOrderStatus(row, order, now) || filled) && found.index >= 0) changed[found.index] = true;
    });
  });
  // Изменённые строки — подряд идущими блоками; если блоков много — одним диапазоном от первой до последней.
  const indexes = Object.keys(changed).map(Number).sort(function (a, b) { return a - b; });
  const blocks = [];
  indexes.forEach(function (index) {
    const last = blocks[blocks.length - 1];
    if (last && index === last.to + 1) last.to = index; else blocks.push({ from: index, to: index });
  });
  const write = function (from, to) {
    const range = target.getRange(from + 2, 1, to - from + 1, width);
    range.setValues(old.slice(from, to + 1));
    applyFormats(target, from + 2, to - from + 1, ORDER_FORMATS);
  };
  if (blocks.length > 40) write(indexes[0], indexes[indexes.length - 1]);
  else blocks.forEach(function (block) { write(block.from, block.to); });
  if (added.length) {
    added.sort(function (a, b) { return (b[13] ? b[13].getTime() : 0) - (a[13] ? a[13].getTime() : 0); });
    target.insertRowsAfter(1, added.length);
    // ID заказа — текстом: иначе Таблица может превратить его в число.
    target.getRange(2, 2, added.length, 1).setNumberFormat('@');
    target.getRange(2, 1, added.length, width).setValues(added).setFontWeight('normal').setBackground(null);
    applyFormats(target, 2, added.length, ORDER_FORMATS);
  }
  return { added: added.length, updated: indexes.length };
}
// Форматы столбцов «Заказов» (номера с единицы): цена и даты статусов.
const ORDER_FORMATS = { 13: '#,##0.00', 14: DATE_FORMAT, 15: DATE_FORMAT, 16: DATE_FORMAT, 18: DATE_FORMAT, 19: DATE_FORMAT, 21: DATE_FORMAT, 22: DATE_FORMAT };
// Лист создаётся ровно под столбцы заказов (без пустых столбцов и строк: Google считает в лимит 10 млн и пустые ячейки).
// Если заголовки листа не совпадают с нужными (лист правили вручную), запись не идёт — иначе значения съедут.
function orderSheet(book) {
  let target = book.getSheetByName(SHEET_NAMES.orders);
  if (!target) {
    target = book.insertSheet(SHEET_NAMES.orders);
    const extraColumns = target.getMaxColumns() - ORDER_HEADERS.length, extraRows = target.getMaxRows() - 1;
    if (extraColumns > 0) target.deleteColumns(ORDER_HEADERS.length + 1, extraColumns);
    if (extraRows > 0) target.deleteRows(2, extraRows);
  }
  if (target.getLastRow() === 0) header(target, ORDER_HEADERS);
  const current = target.getRange(1, 1, 1, ORDER_HEADERS.length).getValues()[0].join('|');
  if (current !== ORDER_HEADERS.join('|')) throw new Error('заголовки листа «Заказы» не совпадают с нужными — верните их или переименуйте лист');
  return target;
}

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
// Всплывающая подсказка справа внизу; при запуске по расписанию её никто не видит — тогда просто пропускаем.
function notify(text) { try { SpreadsheetApp.getActive().toast(text, 'WB', 6); } catch (error) { /* запуск по расписанию */ } }
