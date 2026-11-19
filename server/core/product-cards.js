'use strict';
// --- Карточки кабинета: полный список из WB (по 100, с добором изменённых за время загрузки), копия на диске
// data/Cards/<кабинет>/, правки списка на сайте, оценки склеек (server/cards/glue-ratings.js).
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, analyticsCache, analyticsPending, cabinetFolderName, safeFolderName, tokenFor, wait, wbRequest } = require('./base');

// Все карточки кабинета: по 100 за запрос (cursor updatedAt + nmID), до 30 000 карточек. Лимит категории «Контент» —
// 100 запросов в минуту, всплеск 5: после каждых 5 страниц пауза, а на 429 — повтор после паузы, которую назвал WB,
// иначе у кабинетов с тысячами карточек список обрывался и фото в таблицах пропадали.
const PRODUCT_CARDS_MAX_PAGES = 300;
// Карточки, которые ещё грузятся (по токену): списки, собираемые по частям (progressiveList), берут из них названия
// и фото, не дожидаясь всех карточек.
const productCardsLoading = new Map();
// Карточки кабинета нужны почти везде (названия, фото), а у кабинета с тысячами карточек полная загрузка — десятки
// запросов к WB и минута-две. Поэтому список хранится и на диске: data/Cards/<кабинет>/ — по файлу на каждый предмет
// («Худи (12).json», в скобках — сколько в нём карточек) и index.json с временем загрузки и списком файлов (там же номер
// предмета subjectID). Число карточек меняется — прежний файл предмета переименовывается, а не копится рядом.
// Читаются только файлы из index.json: файл предмета, в котором карточек больше нет, остаётся на диске, но в список
// не попадает. Если копия старше 10 минут или сервер
// перезапущен, сразу отдаётся сохранённая, а свежая грузится в фоне и заменяет её.
// После изменения карточки на сайте (productCardsChanged) копия поправляется на месте и сразу перечитывается в фоне.
const CARDS_DIR = path.join(ROOT, 'data', 'Cards');
const PRODUCT_CARDS_TTL = 10 * 60_000;
const productCardsGen = new Map();
// Правки списка, сделанные на сайте (patch из productCardsChanged), с номером поколения: их заново накладывают на список,
// который начал грузиться до них. Хранятся, пока не закончится загрузка, начатая после правки.
const productCardsPatches = new Map();
const productCardsKey = id => `product-cards:${id}`;
const productCardsDir = id => path.join(CARDS_DIR, cabinetFolderName(id));
// Оценки склеек и число оценок товаров с открытых данных отзывов WB (модуль glue-ratings.js), файл — рядом с карточками.
const glueRatings = require('../cards/glue-ratings')({ dirFor: productCardsDir });
function readProductCardsCopy(id) {
  const dir = productCardsDir(id);
  try {
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')),
      cards = [];
    for (const item of index.files || []) {
      const saved = JSON.parse(fs.readFileSync(path.join(dir, item.file), 'utf8'));
      if (!Array.isArray(saved?.cards)) return null;
      cards.push(...saved.cards);
    }
    return { value: cards, savedAt: Date.parse(index.savedAt) || 0 };
  } catch {}
  // Прежний формат — один файл cards.json на кабинет.
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'cards.json'), 'utf8'));
    if (Array.isArray(saved?.cards)) return { value: saved.cards, savedAt: Date.parse(saved.savedAt) || 0 };
  } catch {}
  return null;
}
function writeProductCardsCopy(id, cards, savedAt) {
  const dir = productCardsDir(id),
    groups = new Map();
  for (const card of cards) {
    const subjectID = card.subjectID ?? 0;
    if (!groups.has(subjectID)) groups.set(subjectID, { subjectID, subjectName: card.subjectName || '', cards: [] });
    groups.get(subjectID).cards.push(card);
  }
  // Имя файла — «Предмет (сколько карточек).json». Совпало с другим предметом — к числу добавляется номер предмета.
  const bySubject = new Map();
  for (const group of groups.values()) {
    const base = safeFolderName(group.subjectName, 'Без предмета');
    let file = `${base} (${group.cards.length}).json`;
    if (bySubject.has(file)) file = `${base} (${group.cards.length}, ${group.subjectID}).json`;
    bySubject.set(file, group);
  }
  fs.mkdirSync(dir, { recursive: true });
  // Прежний файл того же предмета (по index.json) переименовывается в новое имя — так он не остаётся лишним рядом.
  let previous = [];
  try {
    previous = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).files || [];
  } catch {}
  const oldFile = new Map(previous.map(item => [item.subjectID, item.file]));
  for (const [file, group] of bySubject) {
    const old = oldFile.get(group.subjectID);
    if (old && old !== file && !bySubject.has(old) && fs.existsSync(path.join(dir, old)) && !fs.existsSync(path.join(dir, file)))
      fs.renameSync(path.join(dir, old), path.join(dir, file));
  }
  const write = (file, data) => {
    const target = path.join(dir, file);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(data));
    fs.renameSync(`${target}.tmp`, target);
  };
  for (const [file, group] of bySubject) write(file, { cabinet: id, savedAt: new Date(savedAt).toISOString(), ...group });
  // Индекс — последним: пока все файлы предметов не записаны, читается прежний набор.
  write('index.json', {
    cabinet: id,
    savedAt: new Date(savedAt).toISOString(),
    count: cards.length,
    files: [...bySubject].map(([file, group]) => ({
      file,
      subjectID: group.subjectID,
      subjectName: group.subjectName,
      count: group.cards.length
    }))
  });
}
function productCardsCopy(id) {
  const key = productCardsKey(id);
  if (!analyticsCache.has(key)) {
    const saved = readProductCardsCopy(id);
    // Копии, сохранённые до исправления повторов (см. loadProductCardPages), могут содержать карточку дважды.
    if (saved) {
      const seen = new Set();
      saved.value = saved.value.filter(card => !seen.has(card.nmID) && seen.add(card.nmID));
      analyticsCache.set(key, saved);
    }
  }
  return analyticsCache.get(key) || null;
}
function refreshProductCards(id, token = tokenFor(id)) {
  const key = productCardsKey(id);
  if (!analyticsPending.has(key)) {
    const gen = productCardsGen.get(id) || 0;
    const job = (async () => {
      try {
        let value = await loadProductCards(token);
        const savedAt = Date.now(),
          changed = (productCardsGen.get(id) || 0) !== gen;
        // Карточку изменили на сайте, пока шла загрузка: список мог прочитать старые данные — он сразу считается устаревшим,
        // а правки, сделанные за время загрузки, накладываются на него заново. Иначе после склейки по 30 (десятки шагов,
        // пока у кабинета с 15 000 карточек идёт загрузка) часть склеенных карточек снова выглядела отдельными.
        const patches = productCardsPatches.get(id) || [];
        if (changed) for (const item of patches) if (item.gen > gen) value = item.patch(value) || value;
        productCardsPatches.set(
          id,
          patches.filter(item => item.gen > gen)
        );
        analyticsCache.set(key, { value, savedAt, stale: changed });
        try {
          writeProductCardsCopy(id, value, savedAt);
        } catch (error) {
          console.error(`Не удалось сохранить карточки кабинета ${id}: ${error.message}`);
        }
        return value;
      } finally {
        analyticsPending.delete(key);
      }
    })();
    job.catch(error => console.error(`Карточки кабинета ${id}: ${error.message}`));
    analyticsPending.set(key, job);
  }
  return analyticsPending.get(key);
}
// wait: false — при самой первой загрузке не ждать: вернуть то, что уже пришло (раздел «Карточки» показывает их по ходу).
async function productCards(id, token = tokenFor(id), { wait = true } = {}) {
  const copy = productCardsCopy(id);
  if (copy && !copy.stale && Date.now() - copy.savedAt < PRODUCT_CARDS_TTL) return copy.value;
  if (copy) {
    refreshProductCards(id, token);
    return copy.value;
  }
  const job = refreshProductCards(id, token);
  return wait ? job : [...(productCardsLoading.get(token) || [])];
}
// patch(list) — поправить сохранённый список сразу (например, imtID после объединения), не дожидаясь WB.
function productCardsChanged(id, patch) {
  const gen = (productCardsGen.get(id) || 0) + 1;
  productCardsGen.set(id, gen);
  if (patch) productCardsPatches.set(id, [...(productCardsPatches.get(id) || []), { gen, patch }]);
  const copy = productCardsCopy(id);
  if (copy) {
    if (patch) copy.value = patch(copy.value) || copy.value;
    copy.stale = true;
  }
  refreshProductCards(id);
}
function productCardsStatus(id) {
  const copy = analyticsCache.get(productCardsKey(id));
  return {
    savedAt: copy?.savedAt || 0,
    refreshing: analyticsPending.has(productCardsKey(id)),
    loaded: productCardsLoading.get(tokenFor(id))?.length || 0
  };
}
async function loadProductCards(token) {
  const cards = [];
  productCardsLoading.set(token, cards);
  try {
    return await loadProductCardPages(token, cards);
  } finally {
    productCardsLoading.delete(token);
  }
}
// По документации следующая страница — по cursor { updatedAt, nmID } из ответа. На деле, когда у сотен карточек одинаковое
// updatedAt (изменены одной пачкой), WB на стыке страниц присылает часть из них ещё раз — с другим порядком характеристик.
// Из-за повторов карточка выглядела «в склейке сама с собой», поэтому повтор по nmID не добавляется.
// Список идёт от недавно изменённых к давним. Карточка, которую изменили, пока он грузится (склейка, правка), перескакивает
// в уже пройденное начало и в этот проход не попадает: 19.11.2026 у кабинета ИП Шамсиддинов так выпали 172 карточки,
// склеенные во время загрузки (14 780 вместо 14 961, хотя ни одна не удалена). Поэтому после полного прохода начало списка
// читается ещё раз — до карточек, изменённых раньше начала загрузки (с запасом CATCH_UP_MARGIN на разницу часов), — и
// изменённые за это время заменяют или дополняют загруженные.
const CATCH_UP_MARGIN = 5 * 60_000,
  CATCH_UP_MAX_PAGES = 100;
async function cardsListPage(token, cursor) {
  for (let retry = 0; ; retry++) {
    try {
      return await wbRequest(token, 'https://content-api.wildberries.ru/content/v2/get/cards/list', {
        method: 'POST',
        body: { settings: { sort: { ascending: false }, cursor, filter: { withPhoto: -1 } } }
      });
    } catch (error) {
      if (error.status !== 429 || retry >= 3) throw error;
      await wait(Math.max(1000, (error.retryAfter || 0) * 1000));
    }
  }
}
async function loadProductCardPages(token, cards) {
  const startedAt = Date.now();
  let cursor = { limit: 100 };
  const index = new Map();
  for (let page = 0; page < PRODUCT_CARDS_MAX_PAGES; page++) {
    const response = await cardsListPage(token, cursor);
    const batch = Array.isArray(response?.cards) ? response.cards : [];
    for (const card of batch)
      if (!index.has(card.nmID)) {
        index.set(card.nmID, cards.length);
        cards.push(card);
      }
    if (batch.length < 100 || !response?.cursor?.updatedAt || !response?.cursor?.nmID) break;
    cursor = { limit: 100, updatedAt: response.cursor.updatedAt, nmID: response.cursor.nmID };
    if ((page + 1) % 5 === 0) await wait(650);
  }
  // Добор изменённых за время загрузки.
  cursor = { limit: 100 };
  const since = startedAt - CATCH_UP_MARGIN;
  for (let page = 0; page < CATCH_UP_MAX_PAGES; page++) {
    if (page && page % 5 === 0) await wait(650);
    const response = await cardsListPage(token, cursor);
    const batch = Array.isArray(response?.cards) ? response.cards : [];
    let older = false;
    for (const card of batch) {
      if (Date.parse(card.updatedAt) < since) {
        older = true;
        continue;
      }
      if (index.has(card.nmID)) cards[index.get(card.nmID)] = card;
      else {
        index.set(card.nmID, cards.length);
        cards.push(card);
      }
    }
    if (older || batch.length < 100 || !response?.cursor?.updatedAt || !response?.cursor?.nmID) break;
    cursor = { limit: 100, updatedAt: response.cursor.updatedAt, nmID: response.cursor.nmID };
  }
  return cards;
}

module.exports = {
  glueRatings,
  loadProductCards,
  productCards,
  productCardsChanged,
  productCardsLoading,
  productCardsStatus,
  refreshProductCards
};
