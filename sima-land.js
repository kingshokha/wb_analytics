// --- Раздел «Цены Сималенда»: оптовые цены Сималенда в отдельной Google Таблице и их история ---
// Сималенд не пускает запросы с серверов Google, поэтому цены загружает этот сервер (со своего компьютера), раз в час:
//   1) берёт список артикулов с листа «Артикулы» таблицы (google-sheets/sima-land/sima-sheets.gs, GET ?articles=1);
//   2) запрашивает цены в API Сималенда;
//   3) отправляет их в таблицу (POST): она сравнивает с листом «Цены» и пишет изменения на лист «История»;
//   4) дозагружает «Историю» в копию на компьютере: data/Sima/История/<ГГГГ-ММ>.json — строки по месяцам,
//      data/Sima/sync.json — до какого момента скачано и что таблица сказала о последнем обновлении (повторы
//      отбрасываются, хранится всё). Итог последней загрузки цен — data/Sima/refresh.json, сами цены последней
//      загрузки — data/Sima/prices.json (по ним раздел «Прибыль Сималенда», модуль sima-profit.js, сравнивает с WB).
// Первая загрузка — через минуту после запуска сервера (если таблица не обновлялась последние 50 минут и цены на
// компьютере уже есть), дальше раз в час; «Загрузить цены сейчас» на сайте — сразу. Пока компьютер выключен, цены
// не обновляются.
// API Сималенда v3 (https://www.sima-land.ru/api/v3/help/, раздел «Товар»):
//   GET https://www.sima-land.ru/api/v3/item/?sid=<артикулы через запятую>&per-page=100&fields=<поля>
//   sid — артикул (несколько через запятую), per-page — 10, 20, 50 или 100; fields — только нужные поля (ответ
//   на 100 товаров — 4 КБ вместо 750 КБ). Нечисловой артикул — ответ 422 на весь запрос.
//   Поля: price — цена, wholesale_price — цена товара по акции «Опт», balance — остаток (поле не всегда доступно).
//   Лимит — не более 250 соединений за 10 секунд и 50 соединений с ошибками за 10 секунд.
//   Токен необязателен (SIMA_TOKEN в .env): без него цены — как у покупателя без входа. Создаётся на
//   https://www.sima-land.ru/cabinet/token/, передаётся в заголовке x-api-key, действует год; неверный — ответ 401.
// Расхождения с документацией (проверено 10.11.2026): по фильтру sid приходят и товары без остатка (has_balance
// действует только без sid); у части товаров без остатка price и wholesale_price равны 0 — таблица пишет «нет цены»;
// цены приходят с хвостом двоичной дроби (0.14000000000000001) — таблица округляет до копеек. Товара, удалённого или
// отключённого на Сималенде, в ответе нет совсем. balance пустой, когда товара на складе много: тогда isEnough = true
// (на 5925 артикулах 10.11.2026: остаток скрыт и isEnough — 4194, остаток > 0 и !isEnough — 1367, остаток 0 — 364).
// Адрес веб-приложения и ключ — SIMA_SHEET_URL и SIMA_SHEET_KEY в .env; без них — configured: false.
// SIMA_DIR — другая папка для копии (для тестов, чтобы не трогать data/).
// Маршруты: GET /api/sima/history?days=N&source=local|sheet — изменения за N последних дней (0 — за всё время),
// новые сверху; source=local — сразу с компьютера, source=sheet — сначала дозагрузка из таблицы.
// POST /api/sima/refresh — загрузить цены сейчас (ответ — когда цены записаны в таблицу).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SYNC_EVERY = 60 * 60_000;
const SIMA_API = 'https://www.sima-land.ru/api/v3/item/';
const SIMA_FIELDS = 'id,sid,name,price,wholesale_price,balance,isEnough';
const BATCH = 100;   // артикулов в запросе (per-page не больше 100)
const PARALLEL = 5;  // запросов за раз; с паузой в секунду — до 50 запросов за 10 секунд при лимите 250
// Плановая загрузка пропускается, если таблица обновлялась недавно (сервер перезапускали): раз в час, не чаще.
const FRESH_MS = 50 * 60_000;
// Предел только ответа (строки на диске остаются): за всё время у 10 000 артикулов строк может быть очень много.
const RESPONSE_LIMIT = 200_000;
const rowKey = item => [item.at, item.id, item.title, item.what, item.before, item.after].map(value => String(value ?? '')).join('|');

function readJsonFile(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
  fs.renameSync(`${file}.tmp`, file);
}
// Склейка сохранённых строк с новыми: без повторов, по времени.
function mergeRows(existing = [], incoming = []) {
  const seen = new Set(existing.map(rowKey)), added = [];
  for (const item of incoming) {
    if (!item?.at || !/^\d+$/.test(String(item.id ?? ''))) continue;
    const key = rowKey(item); if (seen.has(key)) continue;
    seen.add(key); added.push(item);
  }
  return { rows: added.length ? [...existing, ...added].sort((a, b) => String(a.at).localeCompare(String(b.at))) : existing, added };
}

module.exports = function createSimaLand({ send, apiError, readJson, root, dir = process.env.SIMA_DIR ? path.resolve(process.env.SIMA_DIR) : path.join(root, 'data', 'Sima'),
  url = () => process.env.SIMA_SHEET_URL, key = () => process.env.SIMA_SHEET_KEY, token = () => process.env.SIMA_TOKEN, fetchImpl = (...args) => fetch(...args),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const historyDir = path.join(dir, 'История'), syncFile = path.join(dir, 'sync.json'), refreshFile = path.join(dir, 'refresh.json'), pricesFile = path.join(dir, 'prices.json');
  const configured = () => Boolean(String(url() || '').trim() && String(key() || '').trim());
  const months = () => { try { return fs.readdirSync(historyDir).filter(name => /^\d{4}-\d{2}\.json$/.test(name)).map(name => name.slice(0, 7)).sort(); } catch { return []; } };
  const state = { running: null, refreshing: null, timer: null };
  // Запрос к веб-приложению таблицы. POST Apps Script отвечает переадресацией на страницу с ответом — fetch идёт по ней.
  async function sheetRequest(params = {}, body = null) {
    const target = new URL(String(url()).trim());
    target.searchParams.set('key', String(key()).trim());
    for (const [name, value] of Object.entries(params)) target.searchParams.set(name, String(value));
    let data;
    try {
      const response = await fetchImpl(target, { redirect: 'follow', signal: AbortSignal.timeout(300_000),
        ...(body ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, key: String(key()).trim() }) } : {}) });
      data = await response.json();
    } catch (error) { throw new Error(`Google Таблица не ответила: ${error.message}`); }
    if (data?.error) throw new Error(`Google Таблица: ${data.error}`);
    return data;
  }
  // Цены с Сималенда: found — артикул → { name, price, wholesale_price, balance }, failed — артикулы, по которым
  // Сималенд так и не ответил, errors — тексты ошибок для журнала таблицы. При лимите (429), сбоях (5xx) и обрыве
  // сотня повторяется до двух раз через 5 секунд; 401 (неверный токен) и 422 — сразу ошибка этой сотни.
  async function loadItems(sids) {
    const found = {}, failed = [], errors = [], apiKey = String(token() || '').trim();
    const one = async batch => {
      const target = `${SIMA_API}?sid=${batch.join(',')}&per-page=${BATCH}&fields=${SIMA_FIELDS}`;
      for (let attempt = 0; ; attempt++) {
        let status = 0, data = null;
        try {
          const response = await fetchImpl(target, { headers: { Accept: 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) }, signal: AbortSignal.timeout(60_000) });
          status = response.status; data = await response.json().catch(() => null);
        } catch (error) { data = { message: error.message }; }
        if (status === 200 && Array.isArray(data?.items)) {
          for (const good of data.items) found[String(good.sid)] = { name: String(good.name || ''), price: good.price, wholesale_price: good.wholesale_price, balance: good.balance ?? null, isEnough: Boolean(good.isEnough) };
          return;
        }
        if ((!status || status === 429 || status >= 500) && attempt < 2) { await pause(5000); continue; }
        failed.push(...batch);
        const text = status === 401 || status === 403 ? `Сималенд не принял токен (${status}): токен неверный или истёк` : status ? `Сималенд ответил ${status}: ${String(data?.message || '').slice(0, 200)}` : `Сималенд не ответил: ${data?.message || 'нет связи'}`;
        if (!errors.includes(text)) errors.push(text);
        return;
      }
    };
    const batches = [];
    for (let index = 0; index < sids.length; index += BATCH) batches.push(sids.slice(index, index + BATCH));
    for (let index = 0; index < batches.length; index += PARALLEL) {
      if (index) await pause(1000);
      await Promise.all(batches.slice(index, index + PARALLEL).map(one));
    }
    return { found, failed, errors };
  }
  // Загрузка цен: артикулы из таблицы → Сималенд → таблица, потом дозагрузка «Истории» в копию. force — не смотреть,
  // когда таблица обновлялась. Одновременно идёт одна загрузка; остальные ждут её.
  function refresh(force = false) {
    if (!configured()) return Promise.resolve({ configured: false });
    if (state.refreshing) return state.refreshing;
    state.refreshing = (async () => {
      const startedAt = new Date().toISOString();
      let result;
      try {
        const list = await sheetRequest({ articles: 1 });
        if (!force && list.updatedAt && Date.now() - Date.parse(list.updatedAt) < FRESH_MS && fs.existsSync(pricesFile)) result = { ok: true, skipped: true, at: startedAt, result: 'таблица обновлялась меньше часа назад' };
        else {
          const sids = Array.isArray(list.sids) ? list.sids.map(String) : [], loaded = await loadItems(sids);
          // Цены — на компьютер до отправки в таблицу: разделу «Прибыль Сималенда» они нужны, даже если таблица не ответила.
          writeJsonFile(pricesFile, { at: new Date().toISOString(), sids, found: loaded.found, failed: loaded.failed });
          const answer = await sheetRequest({}, { sids, found: loaded.found, failed: loaded.failed, errors: loaded.errors, skipped: Number(list.skipped) || 0 });
          result = { ok: true, at: startedAt, finishedAt: new Date().toISOString(), result: String(answer.result || ''), changes: Number(answer.changes) || 0, first: Boolean(answer.first), articles: sids.length, failed: loaded.failed.length };
        }
      } catch (error) {
        result = { ok: false, at: startedAt, finishedAt: new Date().toISOString(), error: error.message };
        console.error('Цены Сималенда:', error.message);
      }
      if (!result.skipped) writeJsonFile(refreshFile, result);
      await sync();
      return result;
    })().finally(() => { state.refreshing = null; });
    return state.refreshing;
  }

  // Строки — в файлы своих месяцев; возвращает, сколько новых строк записано.
  function saveRows(items) {
    const byMonth = new Map();
    for (const item of items || []) {
      const month = String(item?.at || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push({ at: item.at, id: String(item.id ?? ''), title: String(item.title ?? ''), what: String(item.what ?? ''), before: item.before ?? '', after: item.after ?? '' });
    }
    let added = 0;
    for (const [month, rows] of byMonth) {
      const file = path.join(historyDir, `${month}.json`), merged = mergeRows(readJsonFile(file, { items: [] }).items || [], rows);
      if (merged.added.length) { writeJsonFile(file, { items: merged.rows }); added += merged.added.length; }
    }
    return added;
  }
  // Строки за последние days дней (0 — все), новые сверху.
  function readHistory(days = 0) {
    const fromIso = days ? new Date(Date.now() - days * 86_400_000).toISOString() : '', fromMonth = fromIso.slice(0, 7), items = [];
    for (const month of months()) {
      if (fromMonth && month < fromMonth) continue;
      for (const item of readJsonFile(path.join(historyDir, `${month}.json`), { items: [] }).items || []) if (!fromIso || String(item.at) >= fromIso) items.push(item);
    }
    return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  // Дозагрузка: всё не старше последней сохранённой строки минус минута (строки одного обновления таблицы пишутся
  // в одно время, а синхронизация могла попасть в середину записи — повторы отбросит склейка), порциями по 20 000.
  // Одновременно идёт одна дозагрузка; остальные ждут её.
  function sync() {
    if (!configured()) return Promise.resolve({ configured: false });
    if (state.running) return state.running;
    state.running = (async () => {
      const saved = readJsonFile(syncFile, {});
      let added = 0;
      try {
        const after = saved.cursor ? new Date(Date.parse(saved.cursor) - 60_000).toISOString() : '';
        let cursor = saved.cursor || '', info = {};
        for (let offset = 0, page = 0; page < 100; page++) {
          const target = new URL(String(url()).trim());
          target.searchParams.set('key', String(key()).trim()); target.searchParams.set('sync', '1');
          if (after) target.searchParams.set('after', after);
          target.searchParams.set('offset', String(offset)); target.searchParams.set('limit', '20000');
          let data;
          try { data = await (await fetchImpl(target, { redirect: 'follow', signal: AbortSignal.timeout(180_000) })).json(); }
          catch (error) { throw new Error(`Google Таблица не ответила: ${error.message}`); }
          if (data?.error) throw new Error(`Google Таблица: ${data.error}`);
          const items = Array.isArray(data?.items) ? data.items : [];
          added += saveRows(items);
          for (const item of items) if (String(item.at) > cursor) cursor = String(item.at);
          // Сведения о таблице — из первой порции; чего в ответе нет, остаётся от прошлой дозагрузки.
          if (!page) info = { since: data?.since || saved.since || null, articles: Number(data?.articles) || saved.articles || 0,
            updatedAt: data?.updatedAt || saved.updatedAt || null, lastResult: String(data?.lastResult || saved.lastResult || '') };
          if (!data?.more || !items.length) break;
          offset += items.length;
        }
        const result = { cursor, ...info, syncedAt: new Date().toISOString(), lastError: '', added };
        writeJsonFile(syncFile, result);
        return result;
      } catch (error) {
        const result = { ...saved, lastError: error.message, failedAt: new Date().toISOString() };
        writeJsonFile(syncFile, result);
        console.error('Таблица Сималенда:', error.message);
        return { ...result, added };
      } finally { state.running = null; }
    })();
    return state.running;
  }
  async function history(daysInput, source) {
    if (!configured()) return { configured: false, items: [] };
    const days = Math.min(3660, Math.max(0, Math.round(Number(daysInput) || 0)));
    const synced = source === 'sheet' ? await sync() : null;
    const saved = readJsonFile(syncFile, {}), items = readHistory(days), truncated = items.length > RESPONSE_LIMIT;
    return { configured: true, source: source === 'sheet' ? 'sheet' : 'local', items: truncated ? items.slice(0, RESPONSE_LIMIT) : items, truncated,
      since: saved.since || null, articles: saved.articles || 0, updatedAt: saved.updatedAt || null, lastResult: saved.lastResult || '',
      syncedAt: saved.syncedAt || null, added: synced?.added || 0, syncError: synced?.lastError || '',
      refresh: { ...readJsonFile(refreshFile, {}), running: Boolean(state.refreshing) } };
  }
  async function handle(req, res, target) {
    if (req.method === 'GET' && target.pathname === '/api/sima/history') {
      send(res, 200, await history(target.searchParams.get('days'), target.searchParams.get('source')));
      return true;
    }
    if (req.method === 'POST' && target.pathname === '/api/sima/refresh') {
      if (!configured()) throw apiError(400, 'Таблица Сималенда не подключена: впишите SIMA_SHEET_URL и SIMA_SHEET_KEY в .env');
      if (readJson) await readJson(req);
      send(res, 200, await refresh(true));
      return true;
    }
    if (target.pathname.startsWith('/api/sima/')) throw apiError(404, 'Нет такого метода');
    return false;
  }
  function start() {
    if (!configured() || state.timer) return;
    setTimeout(() => refresh(), 60_000);
    state.timer = setInterval(() => refresh(), SYNC_EVERY);
  }
  // Цены последней загрузки: { at, sids — артикулы таблицы, found — артикул → цены, failed } или null, если загрузок не было.
  const prices = () => readJsonFile(pricesFile, null);
  return { handle, start, sync, refresh, loadItems, saveRows, readHistory, history, configured, prices, refreshing: () => Boolean(state.refreshing) };
};
module.exports.mergeRows = mergeRows;
