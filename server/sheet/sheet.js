'use strict';
// --- Копия Google Таблицы на компьютере (data/Sheet): история изменений по кабинетам, дозагрузка из таблицы.
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { ROOT, apiError, publicCabinets, safeFolderName } = require('../core/base');

// --- История из Google Таблицы: копия на компьютере (data/Sheet) и дозагрузка ---
// Таблица (google-sheets/wb-sheets.gs) раз в час записывает изменения цен, статусов, ставок, минус-фраз и остатков.
// Сервер держит копию по кабинетам таблицы: data/Sheet/<кабинет>/<раздел>/<ГГГГ-ММ>.json (в «Остатки FBW / FBS» ещё
// current.json — текущие остатки), в sync.json — до какого момента скачано (одно на всю таблицу). Дозагружается только
// новое (?sync=1&after=…), повторы отбрасываются. Копия хранит всю историю (до 02.11.2026 таблица обрезала «Историю»
// до 20 000 строк). До 10.11.2026 кабинеты лежали вместе в data/Sheet/<раздел>/ — см. splitSheetByCabinet.
// Окна истории на сайте сначала берут данные с компьютера (source=local), потом просят дозагрузку (source=sheet).
// Адрес веб-приложения и ключ — WB_SHEET_URL и WB_SHEET_KEY в .env; без них — configured: false.
// WB_SHEET_DIR — другая папка для копии (для тестов, чтобы не трогать data/).
const SHEET_SECTIONS = ['Цены', 'Реклама', 'Ставки', 'Ключевые слова', 'Остатки FBW', 'Остатки FBS'];
const SHEET_DIR = process.env.WB_SHEET_DIR ? path.resolve(process.env.WB_SHEET_DIR) : path.join(ROOT, 'data', 'Sheet');
const SHEET_SYNC_EVERY = 60 * 60_000;
const sheetSyncState = { running: null };
const sheetConfigured = () => Boolean(String(process.env.WB_SHEET_URL || '').trim() && String(process.env.WB_SHEET_KEY || '').trim());
// Ключ строки для отбрасывания повторов. Подпись (title) обязательна: у ставок и минус-фраз ID — номер кампании,
// а артикул — только в подписи, и одинаковое изменение у двух артикулов иначе сливалось бы в одну строку.
const sheetRowKey = item =>
  [item.at, item.cabinet, item.section, item.id, item.title, item.what, item.before, item.after]
    .map(value => String(value ?? ''))
    .join('|');
// Версия ключа: при смене копия один раз перекачивает всю историю из таблицы и дописывает пропущенные строки.
const SHEET_KEY_VERSION = 2;
// Склейка сохранённых строк с новыми: без повторов, по времени.
function mergeSheetRows(existing = [], incoming = []) {
  const seen = new Set(existing.map(sheetRowKey)),
    added = [];
  for (const item of incoming) {
    if (!item?.at || !SHEET_SECTIONS.includes(item.section)) continue;
    const key = sheetRowKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(item);
  }
  return { rows: added.length ? [...existing, ...added].sort((a, b) => String(a.at).localeCompare(String(b.at))) : existing, added };
}
function readSheetJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeSheetJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
  fs.renameSync(`${file}.tmp`, file);
}
function sheetMonths(folder) {
  try {
    return fs
      .readdirSync(folder)
      .filter(name => /^\d{4}-\d{2}\.json$/.test(name))
      .map(name => name.slice(0, 7))
      .sort();
  } catch {
    return [];
  }
}
// Папка кабинета — его название из таблицы (как в строках: поле cabinet) без знаков, запрещённых в именах папок.
// Папки с «_» в начале и с названиями разделов — не кабинеты: это старая раскладка и её архив.
const SHEET_OLD_DIR = '_Все кабинеты вместе (до разделения)';
function sheetCabinetFolder(name) {
  const folder = safeFolderName(String(name ?? '').replace(/^_+/, ''), 'Без кабинета');
  return SHEET_SECTIONS.includes(folder) ? `Кабинет ${folder}` : folder;
}
// Папки кабинетов в копии и названия кабинетов таблицы в каждой. Название обычно равно папке; если отличается
// (запрещённые знаки, другой регистр), оно записано в cabinets.json: { папка строчными: [названия] }.
function sheetCabinetFolders(dir = SHEET_DIR) {
  const other = readSheetJson(path.join(dir, 'cabinets.json'), {});
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && !SHEET_SECTIONS.includes(entry.name))
      .map(entry => ({ folder: entry.name, names: [entry.name, ...(other[entry.name.toLowerCase()] || [])] }));
  } catch {
    return [];
  }
}
// Название кабинета из строки → его папка. Регистр не различается (как в Windows): «samiri» попадёт в папку «Samiri».
function sheetFolderOf(dir) {
  const existing = new Map(sheetCabinetFolders(dir).map(item => [item.folder.toLowerCase(), item.folder])),
    known = new Map();
  return value => {
    const name = String(value ?? '');
    if (!known.has(name)) {
      const clean = sheetCabinetFolder(name),
        key = clean.toLowerCase(),
        folder = existing.get(key) || clean;
      existing.set(key, folder);
      known.set(name, folder);
      if (name && name !== folder) {
        const file = path.join(dir, 'cabinets.json'),
          names = readSheetJson(file, {});
        if (!(names[key] || []).includes(name)) writeSheetJson(file, { ...names, [key]: [...(names[key] || []), name] });
      }
    }
    return known.get(name);
  };
}
// Порция строк из таблицы → файлы по кабинетам, разделам и месяцам. Возвращает число новых строк.
function saveSheetRows(items = [], dir = SHEET_DIR) {
  splitSheetByCabinet(dir);
  const groups = new Map(),
    folderOf = sheetFolderOf(dir);
  for (const item of items) {
    if (!SHEET_SECTIONS.includes(item?.section) || !/^\d{4}-\d{2}/.test(String(item.at || ''))) continue;
    const group = `${folderOf(item.cabinet)}|${item.section}|${String(item.at).slice(0, 7)}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  let added = 0;
  for (const [group, list] of groups) {
    const [folder, section, month] = group.split('|'),
      file = path.join(dir, folder, section, `${month}.json`);
    const merged = mergeSheetRows(readSheetJson(file, { items: [] }).items || [], list);
    if (merged.added.length) {
      writeSheetJson(file, { items: merged.rows });
      added += merged.added.length;
      sheetSinceCache.delete(path.join(dir, folder));
    }
  }
  return added;
}
// С какого момента таблица ведёт разделы sections кабинета: самая ранняя строка этих разделов в его папке (у каждого
// раздела — в файле самого раннего месяца). Нужна графику цены: у товара без записи «Появилось в списке» история
// известна с этого момента, а не с начала всей таблицы — кабинеты добавлялись в неё в разное время, и разделы одного
// кабинета тоже (ИП Шамсиддинов: остатки с 22.10.2026, цены с 28.10.2026). Запоминается до новых строк в папке.
const sheetSinceCache = new Map();
function sheetCabinetSince(folder, sections = SHEET_SECTIONS) {
  if (!sheetSinceCache.has(folder)) sheetSinceCache.set(folder, new Map());
  const cache = sheetSinceCache.get(folder);
  let since = '';
  for (const section of sections) {
    if (!cache.has(section)) {
      const [month] = sheetMonths(path.join(folder, section));
      let first = '';
      if (month)
        for (const item of readSheetJson(path.join(folder, section, `${month}.json`), { items: [] }).items || [])
          if (item?.at && (!first || String(item.at) < first)) first = String(item.at);
      cache.set(section, first);
    }
    const first = cache.get(section);
    if (first && (!since || first < since)) since = first;
  }
  return since || null;
}
// С какого момента известны статусы кампаний: since из журнала таблицы (sync.json) или первая запись раздела «Реклама»
// кабинетов, к которым относятся строки rows, — что раньше. Журнал обновлений начинается позже истории: его первая запись
// (23.10.2026 02:18 UTC) на 5 часов позже первой записи того же обновления в истории, а статусы кампаний Samiri записаны
// ещё с 17.10.2026. По одному журналу включения до его начала отбрасывались, и флажок ▶ показывал не то время.
function sheetAdsTrackingSince(saved, rows = [], dir = SHEET_DIR) {
  const folderOf = sheetFolderOf(dir),
    folders = new Set(rows.map(row => folderOf(row.cabinet)));
  const firsts = [...folders].map(folder => sheetCabinetSince(path.join(dir, folder), ['Реклама'])).filter(Boolean);
  return [saved, ...firsts].filter(Boolean).sort()[0] || null;
}
// Текущие остатки — снимок, а не история: новый заменяет прежний целиком, как и раньше (изменения остатков — в файлах
// по месяцам). У кабинета, которого в новом снимке нет, текущие остатки становятся пустыми. keep — не трогать файлы,
// которые уже есть (перенос старой раскладки).
function saveSheetCurrent(current = [], dir = SHEET_DIR, keep = false) {
  splitSheetByCabinet(dir);
  const groups = new Map(),
    folderOf = sheetFolderOf(dir),
    fileOf = group => {
      const [folder, type] = group.split('|');
      return path.join(dir, folder, `Остатки ${type}`, 'current.json');
    };
  for (const row of current) {
    if (!['FBW', 'FBS'].includes(row?.type)) continue;
    const group = `${folderOf(row.cabinet)}|${row.type}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  if (!keep)
    for (const { folder } of sheetCabinetFolders(dir))
      for (const type of ['FBW', 'FBS']) {
        const group = `${folder}|${type}`;
        if (!groups.has(group) && fs.existsSync(fileOf(group))) groups.set(group, []);
      }
  for (const [group, items] of groups) if (!keep || !fs.existsSync(fileOf(group))) writeSheetJson(fileOf(group), { items });
}
// Старая раскладка (до 10.11.2026): data/Sheet/<раздел>/<файл> — все кабинеты в одном файле. Строки дописываются в файлы
// кабинетов (повторы отбрасываются, поэтому перенос можно повторять), а сам старый файл целиком переезжает в папку
// SHEET_OLD_DIR: ничего не удаляется. Файл, который не удалось прочитать или разложить, остаётся на месте.
const sheetSplitDone = new Set();
function splitSheetByCabinet(dir = SHEET_DIR) {
  if (sheetSplitDone.has(dir)) return;
  sheetSplitDone.add(dir);
  for (const section of SHEET_SECTIONS) {
    let files;
    try {
      files = fs.readdirSync(path.join(dir, section)).filter(name => name.endsWith('.json'));
    } catch {
      continue;
    }
    for (const name of files) {
      try {
        const file = path.join(dir, section, name),
          items = readSheetJson(file, null)?.items;
        if (!Array.isArray(items)) throw new Error('файл не читается');
        if (name === 'current.json') saveSheetCurrent(items, dir, true);
        else saveSheetRows(items, dir);
        let target = path.join(dir, SHEET_OLD_DIR, section, name);
        for (let copy = 2; fs.existsSync(target); copy++)
          target = path.join(dir, SHEET_OLD_DIR, section, `${name.slice(0, -5)} (${copy}).json`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(file, target);
        console.log(
          `Копия Google Таблицы: ${section}/${name} разложен по кабинетам (${items.length} строк), старый файл — в «${SHEET_OLD_DIR}»`
        );
      } catch (error) {
        console.error(`Копия Google Таблицы: ${section}/${name} не разложен по кабинетам:`, error.message);
      }
    }
    // Пустая папка раздела старой раскладки больше не нужна; непустую rmdir не тронет.
    try {
      fs.rmdirSync(path.join(dir, section));
    } catch {
      /* в папке остались файлы */
    }
  }
}
// Кабинет сайта по названию из таблицы. Названия заданы отдельно на сайте и в таблице («2 ИП Шамсиддинов» и «ИП Шамсиддинов»),
// поэтому сравниваются без номера в начале и без регистра: сначала точно, потом — одно содержит другое, если такой кабинет один.
const sheetCabinetKey = name =>
  String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/^[\s\d.,)№#-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
function sheetSiteCabinet(name, list = publicCabinets()) {
  const key = sheetCabinetKey(name),
    keys = list.map(item => ({ id: item.id, key: sheetCabinetKey(item.name) }));
  if (!key) return '';
  const exact = keys.filter(item => item.key === key);
  if (exact.length === 1) return exact[0].id;
  const near = keys.filter(item => item.key && (item.key.includes(key) || key.includes(item.key)));
  return near.length === 1 ? near[0].id : '';
}
// Проверка «строка этого кабинета сайта» — с запоминанием по названию: названий в таблице несколько, строк — десятки тысяч.
function sheetCabinetFilter(cabinetId, list = publicCabinets()) {
  const known = new Map();
  return name => {
    if (!known.has(name)) known.set(name, sheetSiteCabinet(name, list) === String(cabinetId));
    return known.get(name);
  };
}
// «Цена в WB Клубе» с теми же «было» и «стало», что у «Цены со скидкой» того же товара в то же время, — повтор (клубной скидки нет).
function withoutClubPriceRepeats(items) {
  const key = item => [item.at, item.cabinet, item.id, item.before, item.after].map(value => String(value ?? '')).join('|');
  const discounted = new Set(items.filter(item => item.section === 'Цены' && item.what === 'Цена со скидкой, ₽').map(key));
  return items.filter(item => !(item.section === 'Цены' && item.what === 'Цена в WB Клубе, ₽' && discounted.has(key(item))));
}
// Чтение копии: строки нужных разделов (по артикулам или кампаниям, за последние days дней, одного кабинета), новые сверху;
// для остатков — ещё текущие остатки. limit — сколько самых новых строк отдать. С cabinet читаются только папки этого
// кабинета, без него — всех кабинетов.
function readSheetHistory(
  { ids = [], sections = [], days = 0, limit = 0, current: withCurrent = true, cabinet = null } = {},
  dir = SHEET_DIR
) {
  splitSheetByCabinet(dir);
  const fromIso = days ? new Date(Date.now() - days * 86_400_000).toISOString() : '',
    fromMonth = fromIso.slice(0, 7),
    items = [];
  const folders = sheetCabinetFolders(dir)
    .filter(item => !cabinet || item.names.some(name => cabinet(name)))
    .map(item => path.join(dir, item.folder));
  for (const folder of folders)
    for (const section of sections)
      for (const month of sheetMonths(path.join(folder, section))) {
        if (fromMonth && month < fromMonth) continue;
        for (const item of readSheetJson(path.join(folder, section, `${month}.json`), { items: [] }).items || []) {
          if (
            (!ids.length || ids.includes(String(item.id))) &&
            (!fromIso || String(item.at) >= fromIso) &&
            (!cabinet || cabinet(item.cabinet))
          )
            items.push(item);
        }
      }
  const stockTypes = sections.filter(item => item.startsWith('Остатки ')).map(item => item.slice('Остатки '.length));
  const current =
    stockTypes.length && withCurrent
      ? folders.flatMap(folder =>
          stockTypes.flatMap(type =>
            (readSheetJson(path.join(folder, `Остатки ${type}`, 'current.json'), { items: [] }).items || []).filter(
              row => (!ids.length || ids.includes(String(row.nmId))) && (!cabinet || cabinet(row.cabinet))
            )
          )
        )
      : null;
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { items: items.slice(0, limit || (stockTypes.length ? 60_000 : 5_000)), current };
}
// Дозагрузка: всё новее последней сохранённой строки (минус минута: строки одного обновления таблицы пишутся в одно
// время, а синхронизация могла попасть между листами — повторы отбросит склейка), порциями по 20 000.
// Одновременно идёт одна дозагрузка; остальные ждут её.
function syncSheet() {
  if (!sheetConfigured()) return Promise.resolve({ configured: false });
  if (sheetSyncState.running) return sheetSyncState.running;
  sheetSyncState.running = (async () => {
    const syncFile = path.join(SHEET_DIR, 'sync.json'),
      saved = readSheetJson(syncFile, {});
    let added = 0;
    try {
      const full = saved.keyVersion !== SHEET_KEY_VERSION;
      const after = saved.cursor && !full ? new Date(Date.parse(saved.cursor) - 60_000).toISOString() : '';
      let cursor = full ? '' : saved.cursor || '',
        since = saved.since || null,
        currentSaved = false;
      for (let offset = 0, page = 0; page < 50; page++) {
        const target = new URL(String(process.env.WB_SHEET_URL).trim());
        target.searchParams.set('key', String(process.env.WB_SHEET_KEY).trim());
        target.searchParams.set('sync', '1');
        if (after) target.searchParams.set('after', after);
        target.searchParams.set('offset', String(offset));
        target.searchParams.set('limit', '20000');
        let data;
        try {
          data = await (await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(180_000) })).json();
        } catch (error) {
          throw new Error(`Google Таблица не ответила: ${error.message}`);
        }
        if (data?.error) throw new Error(`Google Таблица: ${data.error}`);
        const items = Array.isArray(data?.items) ? data.items : [];
        added += saveSheetRows(items);
        if (!currentSaved && Array.isArray(data?.current)) {
          saveSheetCurrent(data.current);
          currentSaved = true;
        }
        for (const item of items) if (String(item.at) > cursor) cursor = String(item.at);
        since = data?.since || since;
        if (!data?.more || !items.length) break;
        offset += items.length;
      }
      const result = { cursor, since, syncedAt: new Date().toISOString(), lastError: '', added, keyVersion: SHEET_KEY_VERSION };
      writeSheetJson(syncFile, result);
      return result;
    } catch (error) {
      const result = { ...saved, lastError: error.message, failedAt: new Date().toISOString() };
      writeSheetJson(syncFile, result);
      console.error('Google Таблица:', error.message);
      return { ...result, added };
    } finally {
      sheetSyncState.running = null;
    }
  })();
  return sheetSyncState.running;
}
// --- «Заказы» из таблицы: копия на компьютере ---
// Лист «Заказы» (google-sheets/wb-sheets.gs): строка на заказ, статусы дописываются в той же строке. Копия:
// data/Sheet/<кабинет>/Заказы/<ГГГГ-ММ>.json — месяц оформления заказа, { items: [заказ, …] }. Заказ, который уже
// есть в копии, заменяется более свежей строкой (по «Обновлено»); заказы из копии не удаляются никогда.
// Дозагрузка — ?orders=1&after=… (строки, изменённые после прошлой дозагрузки), отметка — data/Sheet/orders-sync.json.
const SHEET_ORDERS = 'Заказы';
const sheetOrderMonth = order => String(order.createdAt || order.statusAt || order.updatedAt || '').slice(0, 7);
function saveSheetOrders(orders = [], dir = SHEET_DIR) {
  const groups = new Map(),
    folderOf = sheetFolderOf(dir);
  for (const order of orders) {
    if (!order?.srid || !/^\d{4}-\d{2}$/.test(sheetOrderMonth(order))) continue;
    const group = `${folderOf(order.cabinet)}|${sheetOrderMonth(order)}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(order);
  }
  let added = 0,
    updated = 0;
  for (const [group, list] of groups) {
    const [folder, month] = group.split('|'),
      file = path.join(dir, folder, SHEET_ORDERS, `${month}.json`);
    const items = readSheetJson(file, { items: [] }).items || [],
      bySrid = new Map(items.map((item, index) => [String(item.srid), index]));
    let changed = false;
    for (const order of list) {
      const index = bySrid.get(String(order.srid));
      if (index === undefined) {
        bySrid.set(String(order.srid), items.length);
        items.push(order);
        added++;
        changed = true;
      } else if (
        String(order.updatedAt || '') >= String(items[index].updatedAt || '') &&
        JSON.stringify(order) !== JSON.stringify(items[index])
      ) {
        items[index] = order;
        updated++;
        changed = true;
      }
    }
    if (changed) {
      items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      writeSheetJson(file, { items });
    }
  }
  return { added, updated };
}
const sheetOrdersState = { running: null };
function syncSheetOrders() {
  if (!sheetConfigured()) return Promise.resolve({ configured: false });
  if (sheetOrdersState.running) return sheetOrdersState.running;
  sheetOrdersState.running = (async () => {
    const syncFile = path.join(SHEET_DIR, 'orders-sync.json'),
      saved = readSheetJson(syncFile, {});
    let added = 0,
      updated = 0;
    try {
      // Минус минута: строки одного обновления таблицы пишутся с одним временем — повторы безвредны (заказ заменяется).
      const after = saved.cursor ? new Date(Date.parse(saved.cursor) - 60_000).toISOString() : '';
      let cursor = saved.cursor || '';
      for (let offset = 0, page = 0; page < 100; page++) {
        const target = new URL(String(process.env.WB_SHEET_URL).trim());
        target.searchParams.set('key', String(process.env.WB_SHEET_KEY).trim());
        target.searchParams.set('orders', '1');
        if (after) target.searchParams.set('after', after);
        target.searchParams.set('offset', String(offset));
        target.searchParams.set('limit', '5000');
        let data;
        try {
          data = await (await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(180_000) })).json();
        } catch (error) {
          throw new Error(`Google Таблица не ответила: ${error.message}`);
        }
        if (data?.error) throw new Error(`Google Таблица: ${data.error}`);
        // Старая версия скрипта параметр orders не знает и отдаёт историю (items) — это не заказы.
        if (!Array.isArray(data?.orders))
          throw new Error('скрипт таблицы не отдаёт заказы — обновите развёртывание веб-приложения (google-sheets/README.md)');
        const result = saveSheetOrders(data.orders);
        added += result.added;
        updated += result.updated;
        for (const order of data.orders) if (String(order.updatedAt || '') > cursor) cursor = String(order.updatedAt);
        if (!data.more || !data.orders.length) break;
        offset += data.orders.length;
      }
      const result = { cursor, syncedAt: new Date().toISOString(), lastError: '', added, updated };
      writeSheetJson(syncFile, result);
      return result;
    } catch (error) {
      const result = { ...saved, lastError: error.message, failedAt: new Date().toISOString() };
      writeSheetJson(syncFile, result);
      console.error('Google Таблица, заказы:', error.message);
      return { ...result, added, updated };
    } finally {
      sheetOrdersState.running = null;
    }
  })();
  return sheetOrdersState.running;
}

// /api/sheet-history: source=local — сразу с компьютера; source=sheet — сначала дозагрузка из таблицы.
// added — сколько новых строк скачано за эту дозагрузку (по всей таблице), syncError — почему не получилось.
// all — раздел «История изменений»: все строки всех разделов (или выбранных) без текущих остатков, до 200 000 новых
// (предел только ответа, строки на диске остаются; за 14 дней в большом кабинете уже больше 50 000);
// с cabinet — только кабинета сайта с этим id (и в «Истории изменений» — без повторов клубной цены; у остатков — и текущие
// остатки только этого кабинета). truncated — за период изменений больше, отданы самые новые.
// cabinetSince — с какого момента таблица ведёт запрошенные разделы кабинета из cabinet (sheetCabinetSince);
// since — начало всей таблицы.
const SHEET_ALL_LIMIT = 200_000;
async function sheetHistory(idsInput, sectionsInput, daysInput, source = 'local', all = false, cabinetInput = '') {
  if (!sheetConfigured()) return { configured: false, items: [], current: null, since: null };
  const ids = [
    ...new Set(
      String(idsInput || '')
        .split(',')
        .map(id => id.trim())
        .filter(id => /^\d{1,15}$/.test(id))
    )
  ].slice(0, 50);
  const sections = String(sectionsInput || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => SHEET_SECTIONS.includes(item));
  const stocks = sections.some(item => item.startsWith('Остатки '));
  if (!ids.length && !stocks && !all) throw apiError(400, 'Не указан артикул или кампания');
  const days = Math.min(all ? 3660 : 365, Math.max(0, Math.round(Number(daysInput) || 0)));
  const sync = source === 'sheet' ? await syncSheet() : null;
  const saved = readSheetJson(path.join(SHEET_DIR, 'sync.json'), {});
  const asked = /^[\w-]{1,40}$/.test(String(cabinetInput || '')) ? sheetCabinetFilter(cabinetInput) : null;
  splitSheetByCabinet();
  const folders = asked ? sheetCabinetFolders().filter(item => item.names.some(name => asked(name))) : [];
  // История по артикулу или кампании: если кабинет сайта не нашёлся в таблице по названию, ищем по всем кабинетам,
  // как без cabinet, — артикул и номер кампании и так относятся к одному кабинету.
  const cabinet = asked && !folders.length && ids.length && !stocks && !all ? null : asked;
  const cabinetSince =
    folders
      .map(item => sheetCabinetSince(path.join(SHEET_DIR, item.folder), sections.length ? sections : SHEET_SECTIONS))
      .filter(Boolean)
      .sort()[0] || null;
  const history = all
    ? readSheetHistory({ ids, sections: sections.length ? sections : SHEET_SECTIONS, days, limit: Infinity, current: false, cabinet })
    : readSheetHistory({
        ids,
        sections: sections.length ? sections : SHEET_SECTIONS.filter(item => !item.startsWith('Остатки ')),
        days,
        cabinet
      });
  // Сначала без повторов клубной цены, потом предел: иначе повторы вытесняют из ответа старые дни периода.
  if (all && cabinet) history.items = withoutClubPriceRepeats(history.items);
  const truncated = all && history.items.length > SHEET_ALL_LIMIT;
  if (truncated) history.items = history.items.slice(0, SHEET_ALL_LIMIT);
  return {
    configured: true,
    source: source === 'sheet' ? 'sheet' : 'local',
    ...history,
    ...(all ? { truncated } : {}),
    since: saved.since || null,
    cabinetSince,
    syncedAt: saved.syncedAt || null,
    added: sync?.added || 0,
    syncError: sync?.lastError || ''
  };
}

module.exports = {
  SHEET_DIR,
  SHEET_SYNC_EVERY,
  mergeSheetRows,
  readSheetHistory,
  readSheetJson,
  saveSheetCurrent,
  saveSheetOrders,
  saveSheetRows,
  sheetAdsTrackingSince,
  sheetCabinetFilter,
  sheetCabinetSince,
  sheetConfigured,
  sheetHistory,
  sheetSiteCabinet,
  splitSheetByCabinet,
  syncSheet,
  syncSheetOrders,
  withoutClubPriceRepeats
};
