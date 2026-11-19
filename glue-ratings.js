// --- Оценки склеек: общая оценка склейки и число оценок каждого товара, как их видит покупатель на WB ---
// Официальный API продавца этого не отдаёт: отчёт «Оценки товаров» (item-rating) даёт по товару только рейтинг и
// прирост оценок за период. Поэтому источник — открытые данные отзывов, которые страница товара на wildberries.ru
// грузит для покупателя: GET https://feedbacks1.wb.ru/feedbacks/v2/{imtID} (запасной — feedbacks2). Документации нет,
// формат проверен 19.11.2026 на склейках кабинетов; WB может поменять его без предупреждения — тогда правится этот файл.
// Отзывы на WB общие для всей склейки, поэтому запрос — по номеру склейки (imtID), один на склейку. В ответе:
//   valuation — оценка склейки строкой («4.1»), feedbackCount — всего оценок склейки,
//   valuationDistribution { "1": n, … "5": n } — оценки склейки по звёздам,
//   nmValuationDistribution [{ nm, valuationDistribution }] — то же по каждому товару склейки,
//   feedbacks — тексты последних отзывов (до ~1000; не используются, но приходят в том же ответе: до ~140 КБ сжатыми).
// Число оценок товара — сумма его оценок по звёздам, средняя — по ним же (рейтинг WB считает по своей формуле, он может
// немного отличаться). Хранится на диске: data/Cards/<кабинет>/Оценки склеек.json — по склейке с временем загрузки;
// обновляется в фоне раз в RATINGS_TTL, по CONCURRENCY запросов сразу, сначала — склейки, которые нужны странице.
// Склейки, которых больше нет, из файла не удаляются.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RATINGS_TTL = 6 * 60 * 60_000, ERROR_RETRY = 60 * 60_000, CONCURRENCY = 4, SAVE_EVERY = 40, TIMEOUT = 15_000;
const FILE = 'Оценки склеек.json';
const HOSTS = ['feedbacks1.wb.ru', 'feedbacks2.wb.ru'];
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Accept: 'application/json' };

// [1★, 2★, 3★, 4★, 5★] из { "1": n, … }.
const starsOf = distribution => [1, 2, 3, 4, 5].map(star => Math.max(0, Math.round(Number(distribution?.[star] ?? distribution?.[String(star)]) || 0)));
const countOf = stars => stars.reduce((sum, value) => sum + value, 0);
const averageOf = stars => { const count = countOf(stars); return count ? Math.round(stars.reduce((sum, value, index) => sum + value * (index + 1), 0) / count * 100) / 100 : null; };

// Ответ витрины → { rating, count, stars, items: { nmId: stars }, at }.
function parseGlue(data, at = Date.now()) {
  const stars = starsOf(data?.valuationDistribution);
  const items = {};
  for (const entry of Array.isArray(data?.nmValuationDistribution) ? data.nmValuationDistribution : []) {
    const nm = Number(entry?.nm);
    if (Number.isInteger(nm) && nm > 0) items[nm] = starsOf(entry.valuationDistribution);
  }
  const rating = Number(String(data?.valuation ?? '').replace(',', '.'));
  return { rating: rating > 0 ? rating : null, count: Math.max(Number(data?.feedbackCount) || 0, 0), stars, items, at };
}

async function fetchGlue(imtID) {
  let failure;
  for (const host of HOSTS) {
    try {
      const response = await fetch(`https://${host}/feedbacks/v2/${imtID}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseGlue(await response.json());
    } catch (error) { failure = error; }
  }
  throw failure || new Error('нет ответа');
}

module.exports = function createGlueRatings({ dirFor }) {
  const stores = new Map();
  function store(id) {
    let entry = stores.get(id);
    if (!entry) {
      let groups = {};
      try { groups = JSON.parse(fs.readFileSync(path.join(dirFor(id), FILE), 'utf8')).groups || {}; } catch { /* файла ещё нет */ }
      entry = { groups, job: null, dirty: 0 };
      stores.set(id, entry);
    }
    return entry;
  }
  function save(id) {
    const entry = store(id), dir = dirFor(id), target = path.join(dir, FILE);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${target}.tmp`, JSON.stringify({ cabinet: id, savedAt: new Date().toISOString(), groups: entry.groups }));
      fs.renameSync(`${target}.tmp`, target);
      entry.dirty = 0;
    } catch (error) { console.error(`Не удалось сохранить оценки склеек кабинета ${id}: ${error.message}`); }
  }
  const fresh = group => group && Date.now() - group.at < (group.error ? ERROR_RETRY : RATINGS_TTL);
  async function loadOne(id, imtID) {
    const entry = store(id);
    try { entry.groups[imtID] = await fetchGlue(imtID); }
    catch (error) { entry.groups[imtID] = { ...(entry.groups[imtID] || {}), error: error.message, at: Date.now() }; }
    if (++entry.dirty >= SAVE_EVERY) save(id);
    return entry.groups[imtID];
  }
  // Фоновое обновление: устаревшие и новые склейки; priority — номера склеек, которые нужны странице сейчас.
  function refresh(id, imtIDs, priority = []) {
    const entry = store(id), wanted = [...new Set([...priority, ...imtIDs].map(Number).filter(imt => Number.isInteger(imt) && imt > 0))];
    const queue = wanted.filter(imt => !fresh(entry.groups[imt]));
    if (entry.job) {
      // Уже идёт — нужное странице переставляем в начало очереди.
      const first = priority.map(Number).filter(imt => queue.includes(imt) && !entry.job.taken.has(imt));
      entry.job.queue = [...new Set([...first, ...entry.job.queue])];
      return;
    }
    if (!queue.length) return;
    // Сначала — то, чего нет совсем, потом — самые старые.
    const order = imt => entry.groups[imt]?.at || 0;
    const prioritySet = new Set(priority.map(Number));
    queue.sort((a, b) => (prioritySet.has(b) - prioritySet.has(a)) || order(a) - order(b));
    const job = entry.job = { queue, taken: new Set(), total: queue.length, done: 0 };
    const worker = async () => {
      for (let imt = job.queue.shift(); imt != null; imt = job.queue.shift()) {
        if (job.taken.has(imt)) continue;
        job.taken.add(imt);
        await loadOne(id, imt);
        job.done++;
      }
    };
    Promise.all(Array.from({ length: CONCURRENCY }, worker)).finally(() => { entry.job = null; if (entry.dirty) save(id); });
  }
  // После склейки и отсоединения оценки затронутых склеек перечитываются сразу, а не через RATINGS_TTL, и ещё раз через
  // RECHECK_LATER: WB переносит отзывы между склейками с задержкой (19.11.2026: новая склейка из 9 карточек сразу после
  // объединения показывала на витрине 0 оценок, хотя у перенесённой карточки оценки были). Прежние данные склейки
  // видны, пока не придут новые.
  const RECHECK_LATER = [15 * 60_000, 60 * 60_000];
  function recheck(id, imtIDs) {
    const list = [...new Set(imtIDs.map(Number).filter(imt => Number.isInteger(imt) && imt > 0))];
    if (!list.length) return;
    const mark = () => { const entry = store(id); for (const imt of list) if (entry.groups[imt]) entry.groups[imt].at = 0; refresh(id, [], list); };
    mark();
    for (const delay of RECHECK_LATER) setTimeout(mark, delay).unref?.();
  }
  return {
    recheck,
    // Склейка сейчас (страница карточки): из файла, а если её нет или она устарела — загрузить и подождать.
    async glueNow(id, imtID) {
      const entry = store(id), group = entry.groups[imtID];
      if (fresh(group) && !group.error) return group;
      const loaded = await loadOne(id, imtID);
      if (entry.dirty) save(id);
      return loaded.error && group?.stars ? group : loaded;
    },
    refresh,
    glue: (id, imtID) => { const group = store(id).groups[imtID]; return group?.stars ? group : null; },
    // Товар: { count, avg, stars } — из склейки, где он сейчас; null — данных ещё нет.
    item(id, imtID, nmId) {
      const group = store(id).groups[imtID];
      if (!group?.stars) return null;
      const stars = group.items?.[nmId] || [0, 0, 0, 0, 0];
      return { count: countOf(stars), avg: averageOf(stars), stars };
    },
    status(id) { const job = store(id).job; return job ? { loading: true, done: job.done, total: job.total } : { loading: false }; }
  };
};
module.exports.parseGlue = parseGlue;
module.exports.averageOf = averageOf;
