const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const createSimaLand = require('../sima-land');

// Скрипт таблицы (google-sheets/sima-land/sima-sheets.gs) — в песочнице с заглушками Google: в сеть он не ходит.
function sheetScript(globals = {}) {
  const context = vm.createContext({ Utilities: { sleep() {} }, ...globals });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-sheets', 'sima-land', 'sima-sheets.gs'), 'utf8'), context);
  return context;
}
const plain = value => JSON.parse(JSON.stringify(value));
// Лист из массива строк (первая — заголовок): getLastRow и getRange(…).getValues() / getValue(), как у Google Таблиц.
const fakeSheet = rows => ({ getLastRow: () => rows.length, getRange: (row, column, count = 1, width = 1) => ({
  getValues: () => rows.slice(row - 1, row - 1 + count).map(line => line.slice(column - 1, column - 1 + width)), getValue: () => rows[row - 1][column - 1] }) });

test('таблица Сималенда: артикулы с листа — числа без повторов, мусор пропускается', () => {
  const script = sheetScript();
  const list = script.readArticles(fakeSheet([['Артикул Сималенда'], [7011032], [' 5697360 '], ['abc'], [''], [7011032], ['12,5'], ['0042']]));
  assert.deepEqual(plain(list), { sids: ['7011032', '5697360', '42'], skipped: 2 });
});

test('таблица Сималенда: первое обновление без истории, дальше — изменения цен, пропажи, добавленные и убранные артикулы', () => {
  const script = sheetScript(), now = new Date('2026-11-10T10:00:00Z'), later = new Date('2026-11-10T11:00:00Z');
  const good = (sid, price, wholesale, balance = 5, name = `Товар ${sid}`) => ({ sid, name, price, wholesale_price: wholesale, balance, isEnough: false });
  // Первое обновление: сравнивать не с чем — строки есть, истории нет. Цена 0 — «нет цены», копейки округляются.
  // Остаток скрыт (товара много) — «В наличии» по isEnough.
  const first = script.priceChanges(['1', '2', '3', '4', '5'], { 1: good(1, 100, 90), 2: { ...good(2, 0.14000000000000001, 0.11), balance: null, isEnough: true }, 3: good(3, 0, 0, 0), 4: good(4, 50, 45) }, {}, [], now);
  assert.equal(first.history.length, 0);
  assert.deepEqual(plain(first.rows.map(row => row.slice(0, 5))), [[1, 'Товар 1', 100, 90, 'В наличии'], [2, 'Товар 2', 0.14, 0.11, 'В наличии'], [3, 'Товар 3', '', '', 'Нет в наличии'], [4, 'Товар 4', 50, 45, 'В наличии'], [5, '', '', '', 'Нет на Сималенде']]);
  // Второе: у 1 изменились обе цены, 2 не загрузился (строка прежняя), 3 без изменений, 4 пропал с Сималенда,
  // 5 так и не появился, 6 добавлен в список; один артикул убран из списка (его строки больше нет).
  const old = first.rows.concat([[7, 'Товар 7', 10, 9, 'В наличии', now]]);
  const second = script.priceChanges(['1', '2', '3', '4', '5', '6'], { 1: good(1, 110, 80), 3: good(3, 0, 0, 0), 6: good(6, 20, 18) }, { 2: true }, old, later);
  assert.deepEqual(plain(second.history.map(row => row.slice(1))), [
    [1, 'Товар 1', 'Цена, ₽', 100, 110], [1, 'Товар 1', 'Цена по акции «Опт», ₽', 90, 80],
    [4, 'Товар 4', 'Нет на Сималенде', 50, '—'], [6, 'Товар 6', 'Добавлен в список', '—', 20], [7, 'Товар 7', 'Убран из списка артикулов', 10, '—']]);
  assert.ok(second.history.every(row => row[0] === later));
  assert.equal(second.rows[1], old[1], 'не загрузившийся артикул остаётся прежней строкой');
  assert.deepEqual(plain(second.rows[3].slice(0, 5)), [4, 'Товар 4', '', '', 'Нет на Сималенде'], 'у пропавшего остаётся название');
  // Третье: 4 вернулся, 2 снова загрузился без изменений — в истории только возвращение; пропажа не повторяется.
  const third = script.priceChanges(['1', '2', '4', '5'], { 1: good(1, 110, 80), 2: good(2, 0.14, 0.11), 4: good(4, 55, 45) }, {}, second.rows, later);
  assert.deepEqual(plain(third.history.map(row => row.slice(1))), [[4, 'Товар 4', 'Снова есть на Сималенде', '—', 55], [3, 'Товар 3', 'Убран из списка артикулов', '—', '—'], [6, 'Товар 6', 'Убран из списка артикулов', 20, '—']]);
  // Артикул, по которому Сималенд ни разу не ответил, после первой удачной загрузки не пишется как изменение.
  const failedFirst = script.priceChanges(['8'], {}, { 8: true }, [[1, 'Товар 1', 100, 90, 'В наличии', now]], now);
  assert.deepEqual(plain(failedFirst.rows[0].slice(0, 5)), [8, '', '', '', 'Ошибка загрузки']);
  assert.equal(script.priceChanges(['8'], { 8: good(8, 5, 4) }, {}, failedFirst.rows, later).history.length, 0);
});

test('цены Сималенда на сайте: запросы по 100 артикулов, при 429 и обрыве — повтор, при 422 — артикулы сотни не загружены', async () => {
  const calls = [];
  let limited = true, dropped = true;
  const { module, cleanup } = serverModule([], async (target, options) => {
    const address = new URL(target), sids = address.searchParams.get('sid').split(',');
    calls.push({ address, options });
    if (sids.includes('150') && limited) { limited = false; return { status: 429, json: async () => ({ message: 'Too many' }) }; }
    if (sids.includes('20') && dropped) { dropped = false; throw new Error('socket hang up'); }
    if (sids.includes('250')) return { status: 422, json: async () => ({ message: '«Артикул» может содержать только натуральные числа' }) };
    return { status: 200, json: async () => ({ items: sids.filter(sid => sid !== '7').map(sid => ({ sid: Number(sid), name: `Товар ${sid}`, price: 1, wholesale_price: 0.9, balance: 3, isEnough: false, extra: 'лишнее' })) }) };
  }, { token: 'секрет' });
  try {
    const result = await module.loadItems(Array.from({ length: 260 }, (_, index) => String(index + 1)));
    assert.equal(calls.length, 5, 'три сотни и два повтора');
    assert.ok(calls.every(({ address, options }) => options.headers['x-api-key'] === 'секрет' && address.searchParams.get('per-page') === '100' && address.searchParams.get('fields') === 'id,sid,name,price,wholesale_price,balance,isEnough'));
    assert.equal(Object.keys(result.found).length, 99 + 100);
    assert.deepEqual(result.found['1'], { name: 'Товар 1', price: 1, wholesale_price: 0.9, balance: 3, isEnough: false }, 'в таблицу — только нужные поля');
    assert.equal(result.failed.length, 60);
    assert.equal(result.found['7'], undefined, 'артикула нет в ответе — он не в failed, а «нет на Сималенде»');
    assert.ok(!result.failed.includes('7'));
    assert.match(result.errors.join(), /Сималенд ответил 422/);
  } finally { cleanup(); }
});

test('цены Сималенда на сайте: загрузка — артикулы из таблицы, цены с Сималенда, отправка в таблицу, дозагрузка истории', async () => {
  const sheetCalls = [], recent = new Date(Date.now() - 10 * 60_000).toISOString(), old = new Date(Date.now() - 2 * 3_600_000).toISOString(), changedAt = new Date(Date.now() - 60_000).toISOString();
  let updatedAt = recent;
  const { module, dir, cleanup } = serverModule([], async (target, options = {}) => {
    const address = new URL(target);
    if (address.hostname === 'www.sima-land.ru') return { status: 200, json: async () => ({ items: [{ sid: 11, name: 'Кружка', price: 120, wholesale_price: 100, balance: 0, isEnough: false }] }) };
    sheetCalls.push({ address, options });
    if (address.searchParams.get('articles')) return { json: async () => ({ sids: ['11', '12'], skipped: 1, updatedAt }) };
    if (options.method === 'POST') return { json: async () => ({ ok: true, result: 'артикулов 2, изменений 1', changes: 1, first: false }) };
    return { json: async () => ({ items: [{ at: changedAt, id: '11', title: 'Кружка', what: 'Цена, ₽', before: 110, after: 120 }], more: false, articles: 2, updatedAt: changedAt, lastResult: 'артикулов 2, изменений 1' }) };
  });
  try {
    // Таблица обновлялась 10 минут назад, но цен на компьютере ещё нет — загрузка всё равно идёт (они нужны «Прибыли»).
    assert.notEqual((await module.refresh()).skipped, true);
    assert.deepEqual(module.prices().found, { 11: { name: 'Кружка', price: 120, wholesale_price: 100, balance: 0, isEnough: false } });
    assert.deepEqual(module.prices().sids, ['11', '12']);
    sheetCalls.length = 0;
    // Цены есть и таблица свежая — плановая загрузка пропускается, только дозагрузка истории.
    assert.equal((await module.refresh()).skipped, true);
    assert.ok(!sheetCalls.some(call => call.options.method === 'POST'));
    updatedAt = old;
    const result = await module.refresh();
    assert.deepEqual({ ok: result.ok, result: result.result, changes: result.changes, articles: result.articles, failed: result.failed }, { ok: true, result: 'артикулов 2, изменений 1', changes: 1, articles: 2, failed: 0 });
    const post = sheetCalls.find(call => call.options.method === 'POST'), body = JSON.parse(post.options.body);
    assert.deepEqual({ ...body, key: body.key === 'k' }, { sids: ['11', '12'], found: { 11: { name: 'Кружка', price: 120, wholesale_price: 100, balance: 0, isEnough: false } }, failed: [], errors: [], skipped: 1, key: true });
    assert.equal(post.options.redirect, 'follow');
    assert.deepEqual(module.readHistory(0).map(item => item.after), [120], 'после загрузки история дозагружена в копию');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'refresh.json'), 'utf8')).ok, true);
    assert.equal((await module.history(0, 'local')).refresh.result, 'артикулов 2, изменений 1');
    // «Загрузить цены сейчас» — без оглядки на время последнего обновления.
    updatedAt = new Date().toISOString();
    const res = {};
    assert.equal(await module.handle({ method: 'POST' }, res, new URL('http://local/api/sima/refresh')), true);
    assert.equal(res.payload.ok, true);
    assert.equal(sheetCalls.filter(call => call.options.method === 'POST').length, 2);
  } finally { cleanup(); }
});

test('цены Сималенда на сайте: таблица отвечает ошибкой при загрузке — итог с ошибкой сохраняется и виден разделу', async () => {
  const { module, cleanup } = serverModule([], async target => {
    const address = new URL(target);
    if (address.searchParams.get('articles')) return { json: async () => ({ error: 'Неверный ключ доступа к таблице' }) };
    return { json: async () => ({ items: [], more: false }) };
  });
  try {
    const result = await module.refresh(true);
    assert.equal(result.ok, false);
    assert.match(result.error, /Google Таблица: Неверный ключ/);
    assert.match((await module.history(0, 'local')).refresh.error, /Неверный ключ/);
  } finally { cleanup(); }
});

test('таблица Сималенда: выгрузка для сайта — сверху до строки старше after, порциями', () => {
  // Даты — из песочницы: Google отдаёт ячейки с датой как Date самого скрипта (instanceof Date).
  const sheets = {}, script = sheetScript({ SpreadsheetApp: { getActive: () => ({ getSheetByName: name => sheets[name] || null }) } });
  const SheetDate = vm.runInContext('Date', script), at = hour => new SheetDate(Date.UTC(2026, 10, 10, hour));
  const history = [['Когда', 'Артикул', 'Товар', 'Что изменилось', 'Было', 'Стало'],
    [at(12), 1, 'А', 'Цена, ₽', 10, 11], [at(12), 2, 'Б', 'Цена, ₽', 20, 21], [at(11), 3, 'В', 'Цена, ₽', 30, 31], [at(9), 4, 'Г', 'Цена, ₽', 40, 41]];
  const log = [['Когда', 'Результат'], [at(12), 'артикулов 4, изменений 2'], [at(9), 'артикулов 4, изменений 0']];
  Object.assign(sheets, { 'История': fakeSheet(history), 'Журнал обновлений': fakeSheet(log), 'Цены': fakeSheet([['Артикул'], [1], [2], [3], [4]]) });
  const page1 = plain(script.syncExport({ after: at(11).toISOString(), offset: '0', limit: '2' }));
  assert.deepEqual(page1.items.map(item => item.id), ['1', '2']);
  assert.equal(page1.more, true);
  assert.deepEqual(page1.items[0], { at: at(12).toISOString(), id: '1', title: 'А', what: 'Цена, ₽', before: 10, after: 11 });
  assert.deepEqual({ articles: page1.articles, since: page1.since, updatedAt: page1.updatedAt, lastResult: page1.lastResult },
    { articles: 4, since: at(9).toISOString(), updatedAt: at(12).toISOString(), lastResult: 'артикулов 4, изменений 2' });
  const page2 = plain(script.syncExport({ after: at(11).toISOString(), offset: '2', limit: '2' }));
  assert.deepEqual(page2.items.map(item => item.id), ['3']);
  assert.equal(page2.more, false);
  assert.equal(plain(script.syncExport({})).items.length, 4, 'без after — вся история');
});

// Серверный модуль во временной папке; ответы таблицы и Сималенда подставляются, в сеть он не ходит, паузы мгновенные.
// pages — ответы таблицы по очереди (для дозагрузки истории); fetchImpl — свой ответ на любой запрос.
function serverModule(pages = [], fetchImpl = null, { token = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-sima-')), requests = [];
  const env = { url: 'https://script.example/exec', key: 'k' };
  const module = createSimaLand({ send: (res, status, payload) => { res.status = status; res.payload = payload; }, apiError: (status, message) => Object.assign(new Error(message), { status }), dir,
    url: () => env.url, key: () => env.key, token: () => token, pause: async () => {},
    fetchImpl: fetchImpl || (async target => { requests.push(new URL(target)); const page = pages.shift(); if (page instanceof Error) throw page; return { json: async () => page }; }) });
  return { module, dir, requests, env, pages, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('цены Сималенда на сайте: копия по месяцам без повторов, дозагрузка с последней строки, история за период', async () => {
  const day = 86_400_000, iso = ago => new Date(Date.now() - ago).toISOString(), old = iso(40 * day), fresh = iso(2 * day), now = iso(60_000);
  const { module, dir, requests, pages, cleanup } = serverModule([
    { items: [{ at: fresh, id: '1', title: 'А', what: 'Цена, ₽', before: 10, after: 11 }, { at: old, id: '2', title: 'Б', what: 'Цена, ₽', before: 20, after: 19 }], more: true, articles: 2, since: old, updatedAt: fresh, lastResult: 'артикулов 2' },
    { items: [{ at: old, id: '2', title: 'Б', what: 'Цена, ₽', before: 20, after: 19 }, { at: old, id: 'x', title: 'мусор', what: 'Цена, ₽' }], more: false }]);
  try {
    const first = await module.sync();
    assert.equal(first.added, 2, 'повтор со второй порции и строка без числового артикула отброшены');
    assert.equal(requests[0].searchParams.get('after'), null, 'первая дозагрузка — с самого начала');
    assert.equal(requests[1].searchParams.get('offset'), '2');
    assert.ok(fs.readdirSync(path.join(dir, 'История')).length >= 1);
    // Вторая дозагрузка — с последней сохранённой строки минус минута; та же строка повтором не записывается.
    pages.push({ items: [{ at: fresh, id: '1', title: 'А', what: 'Цена, ₽', before: 10, after: 11 }, { at: now, id: '3', title: 'В', what: 'Добавлен в список', before: '—', after: 5 }], more: false, articles: 3, updatedAt: now, lastResult: 'артикулов 3' });
    assert.equal((await module.sync()).added, 1);
    assert.equal(requests[2].searchParams.get('after'), new Date(Date.parse(fresh) - 60_000).toISOString());
    assert.deepEqual(module.readHistory(0).map(item => item.id), ['3', '1', '2'], 'новые сверху');
    assert.deepEqual(module.readHistory(7).map(item => item.id), ['3', '1']);
    const res = {};
    assert.equal(await module.handle({ method: 'GET' }, res, new URL('http://local/api/sima/history?days=7&source=local')), true);
    assert.deepEqual({ ...res.payload, items: res.payload.items.length, syncedAt: Boolean(res.payload.syncedAt) },
      { configured: true, source: 'local', items: 2, truncated: false, since: old, articles: 3, updatedAt: now, lastResult: 'артикулов 3', syncedAt: true, added: 0, syncError: '', refresh: { running: false } });
    assert.equal(await module.handle({ method: 'GET' }, {}, new URL('http://local/api/messages/x')), false);
    await assert.rejects(module.handle({ method: 'GET' }, {}, new URL('http://local/api/sima/nope')), /Нет такого метода/);
  } finally { cleanup(); }
});

test('цены Сималенда на сайте: таблица недоступна — копия остаётся, без настроек — configured: false', async () => {
  const { module, env, pages, cleanup } = serverModule([{ items: [{ at: '2026-11-01T10:00:00.000Z', id: '1', title: 'А', what: 'Цена, ₽', before: 1, after: 2 }], more: false }]);
  try {
    await module.sync();
    pages.push(new Error('timeout'));
    const failed = await module.history(0, 'sheet');
    assert.equal(failed.items.length, 1);
    assert.match(failed.syncError, /Google Таблица не ответила: timeout/);
    pages.push({ error: 'Неверный ключ доступа к таблице' });
    assert.match((await module.history(0, 'sheet')).syncError, /Неверный ключ/);
    env.key = '';
    assert.deepEqual(await module.history(0, 'sheet'), { configured: false, items: [] });
  } finally { cleanup(); }
});
