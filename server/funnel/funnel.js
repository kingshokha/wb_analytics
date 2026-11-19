'use strict';
// --- Воронка продаж: данные по дням и периодам (хранение в data/Funnel), догрузка из WB по очереди, таблица товаров, продажи.
const fs = require('node:fs');
const path = require('node:path');
const {
  ROOT,
  addDays,
  apiError,
  cabinetFolderName,
  cabinets,
  cachedAnalytics,
  datesBetween,
  moscowDate,
  tokenFor,
  wait,
  wbRequest
} = require('../core/base');
const { productCards } = require('../core/product-cards');
const { cardPhoto } = require('../core/photos');

const FUNNEL_DIR = path.join(ROOT, 'data', 'Funnel');
// Порядок важен: по артикулам показатели хранятся массивами в этом порядке. Новые ключи — только в конец.
// cancelCount («Отменили и вернули товаров, шт.», statistic.cancelCount в sales-funnel/products) нужен для процента выкупа
// (выкупы ÷ (выкупы + отмены), как у WB). В днях, сохранённых до его появления, отмен нет — там он NaN (в ответе null),
// чтобы процент выкупа таких дней считался неизвестным, а не 100%.
const FUNNEL_COUNT_KEYS = [
  'openCount',
  'cartCount',
  'orderCount',
  'orderSum',
  'buyoutCount',
  'buyoutSum',
  'addToWishlistCount',
  'cancelCount'
];
const FUNNEL_OPTIONAL_KEYS = new Set(['cancelCount']);
const FUNNEL_PRODUCTS_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products';
const FUNNEL_BUCKET_SIZE = 3;
const FUNNEL_BUCKET_INTERVAL = 20_500;
const FUNNEL_FINAL_AFTER_DAYS = 7;
const FUNNEL_REFRESH_MINUTES = 60;
const FUNNEL_MAX_DEPTH_DAYS = 364;
const FUNNEL_RETRY_FAILED_MS = 10 * 60_000;
const funnelBuckets = new Map();
const funnelQueues = new Map();
const funnelJobs = new Map();
// Значение показателя из записи: пусто — 0, а у необязательного (отмены) пусто — неизвестно (NaN, в сумме тоже NaN).
function funnelCount(key, value) {
  if (FUNNEL_OPTIONAL_KEYS.has(key) && (value == null || Number.isNaN(Number(value)))) return NaN;
  return Number(value || 0);
}
// Без записи — нули (начало суммы); из записи — её показатели.
function pickFunnelCounts(point = null) {
  return Object.fromEntries(FUNNEL_COUNT_KEYS.map(key => [key, point ? funnelCount(key, point[key]) : 0]));
}

function funnelDir(cabinetId) {
  const target = path.join(FUNNEL_DIR, cabinetFolderName(cabinetId));
  if (fs.existsSync(target)) return target;
  let entries = [];
  try {
    entries = fs.readdirSync(FUNNEL_DIR, { withFileTypes: true });
  } catch {
    return target;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(FUNNEL_DIR, entry.name);
    try {
      if (String(JSON.parse(fs.readFileSync(path.join(dir, 'cabinet.json'), 'utf8')).id) === String(cabinetId)) {
        fs.renameSync(dir, target);
        break;
      }
    } catch {}
  }
  return target;
}

function readFunnelMonth(cabinetId, month) {
  try {
    return JSON.parse(fs.readFileSync(path.join(funnelDir(cabinetId), `${month}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function saveFunnelDays(cabinetId, points = []) {
  if (!points.length) return;
  const dir = funnelDir(cabinetId);
  const fetchedAt = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cabinet.json'), JSON.stringify({ id: String(cabinetId) }, null, 2));
  const byMonth = new Map();
  for (const point of points) {
    if (!byMonth.has(point.date.slice(0, 7))) byMonth.set(point.date.slice(0, 7), []);
    byMonth.get(point.date.slice(0, 7)).push(point);
  }
  for (const [month, monthPoints] of byMonth) {
    const file = readFunnelMonth(cabinetId, month) || { cabinet: String(cabinetId), month, days: {} };
    for (const point of monthPoints)
      file.days[point.date] = { fetchedAt, ...pickFunnelCounts(point), ...(point.products ? { products: point.products } : {}) };
    file.days = Object.fromEntries(Object.entries(file.days).sort(([a], [b]) => a.localeCompare(b)));
    Object.assign(file, { name: cabinets().find(item => String(item.id) === String(cabinetId))?.name || '', updatedAt: fetchedAt });
    const target = path.join(dir, `${month}.json`);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(file, null, 2));
    fs.renameSync(`${target}.tmp`, target);
  }
}

function loadFunnelDays(cabinetId, from, to) {
  const days = [];
  for (const month of [...new Set(datesBetween(from, to).map(date => date.slice(0, 7)))]) {
    for (const [date, record] of Object.entries(readFunnelMonth(cabinetId, month)?.days || {})) {
      if (date >= from && date <= to)
        days.push({
          date,
          fetchedAt: record.fetchedAt || '',
          ...pickFunnelCounts(record),
          ...(record.products ? { products: record.products } : {})
        });
    }
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function funnelStoredFrom(cabinetId) {
  try {
    const months = fs
      .readdirSync(funnelDir(cabinetId))
      .filter(name => /^\d{4}-\d{2}\.json$/.test(name))
      .sort();
    return months.length ? Object.keys(readFunnelMonth(cabinetId, months[0].slice(0, 7))?.days || {}).sort()[0] || '' : '';
  } catch {
    return '';
  }
}

// Итоги недель и месяцев хранятся отдельно от дней, в periods.json папки кабинета.
function readFunnelRanges(cabinetId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(funnelDir(cabinetId), 'periods.json'), 'utf8')).ranges || {};
  } catch {
    return {};
  }
}

function saveFunnelRanges(cabinetId, ranges = []) {
  if (!ranges.length) return;
  const dir = funnelDir(cabinetId);
  const fetchedAt = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cabinet.json'), JSON.stringify({ id: String(cabinetId) }, null, 2));
  const stored = readFunnelRanges(cabinetId);
  for (const range of ranges)
    stored[`${range.from}_${range.to}`] = {
      fetchedAt,
      ...pickFunnelCounts(range),
      ...(range.products ? { products: range.products } : {})
    };
  const target = path.join(dir, 'periods.json');
  fs.writeFileSync(`${target}.tmp`, JSON.stringify({ cabinet: String(cabinetId), updatedAt: fetchedAt, ranges: stored }, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

// Метод статистики карточек ограничен 3 запросами в минуту со всплеском до 3 (документация WB, sales-funnel/products),
// поэтому таблица воронки и догрузка графика идут через общую очередь кабинета. Запросы таблицы (priority 'high') —
// их ждёт пользователь — встают перед фоновой дозагрузкой дней и отрезков графика ('low').
function funnelProductsRequest(id, token, body, priority = 'low') {
  return new Promise((resolve, reject) => {
    const queue = funnelQueues.get(id) || { high: [], low: [], running: false };
    funnelQueues.set(id, queue);
    queue[priority === 'high' ? 'high' : 'low'].push({ token, body, resolve, reject });
    if (!queue.running) pumpFunnelQueue(id, queue);
  });
}
async function pumpFunnelQueue(id, queue) {
  queue.running = true;
  try {
    while (queue.high.length || queue.low.length) {
      const item = (queue.high.length ? queue.high : queue.low).shift();
      try {
        item.resolve(await funnelBucketRequest(id, item.token, item.body));
      } catch (error) {
        item.reject(error);
      }
    }
  } finally {
    queue.running = false;
  }
}
async function funnelBucketRequest(id, token, body) {
  let retries = 0;
  for (;;) {
    const now = Date.now();
    const bucket = funnelBuckets.get(id) || { tokens: FUNNEL_BUCKET_SIZE, updatedAt: now };
    bucket.tokens = Math.min(FUNNEL_BUCKET_SIZE, bucket.tokens + Math.max(0, now - bucket.updatedAt) / FUNNEL_BUCKET_INTERVAL);
    bucket.updatedAt = now;
    funnelBuckets.set(id, bucket);
    if (bucket.tokens < 1) {
      await wait((1 - bucket.tokens) * FUNNEL_BUCKET_INTERVAL);
      continue;
    }
    bucket.tokens -= 1;
    try {
      return await wbRequest(token, FUNNEL_PRODUCTS_URL, { method: 'POST', body });
    } catch (error) {
      if (error.status !== 429 || retries >= 3) throw error;
      retries++;
      funnelBuckets.set(id, { tokens: 0, updatedAt: Date.now() });
      await wait(Math.max(FUNNEL_BUCKET_INTERVAL, (error.retryAfter || 0) * 1000));
    }
  }
}

function funnelStatisticValues(statistic = {}) {
  return FUNNEL_COUNT_KEYS.map(key =>
    Number((key === 'addToWishlistCount' ? (statistic?.addToWishlist ?? statistic?.addToWishlistCount) : statistic?.[key]) || 0)
  );
}

// Итог и разбивка по артикулам; артикулы без активности не сохраняются, чтобы файлы не разрастались.
function addFunnelStatistic(target, statistic = {}, nmId = '') {
  const values = funnelStatisticValues(statistic);
  FUNNEL_COUNT_KEYS.forEach((key, index) => {
    target[key] += values[index];
  });
  if (target.products && nmId && values.some(Boolean)) target.products[nmId] = values;
}

// Сумма показателей по выбранным артикулам; для записей без разбивки фильтр применить нельзя.
function funnelRecordCounts(record, nmIds = null) {
  if (!record) return null;
  if (!nmIds) return pickFunnelCounts(record);
  if (!record.products) return null;
  const total = pickFunnelCounts();
  for (const nmId of nmIds) {
    const values = record.products[nmId];
    if (values)
      FUNNEL_COUNT_KEYS.forEach((key, index) => {
        total[key] += funnelCount(key, values[index]);
      });
  }
  return total;
}

// Один запрос отдаёт два отрезка: выбранный и «прошлый период», который задаётся отдельно.
async function fetchFunnelRanges(id, token, selected, past = null) {
  const current = { from: selected.from, to: selected.to, ...pickFunnelCounts(), products: {} };
  const previous = past ? { from: past.from, to: past.to, ...pickFunnelCounts(), products: {} } : null;
  for (let offset = 0; ; offset += 1000) {
    const response = await funnelProductsRequest(id, token, {
      selectedPeriod: { start: selected.from, end: selected.to },
      ...(past ? { pastPeriod: { start: past.from, end: past.to } } : {}),
      nmIds: [],
      brandNames: [],
      subjectIds: [],
      tagIds: [],
      skipDeletedNm: true,
      orderBy: { field: 'openCard', mode: 'desc' },
      limit: 1000,
      offset
    });
    const products = response?.data?.products || response?.products || [];
    for (const item of products) {
      const nmId = String(item.product?.nmId ?? item.nmId ?? '');
      addFunnelStatistic(current, item.statistic?.selected, nmId);
      if (previous) addFunnelStatistic(previous, item.statistic?.past, nmId);
    }
    if (products.length < 1000) break;
  }
  return previous ? [current, previous] : [current];
}

async function fetchFunnelDays(id, token, selected, past = '') {
  const ranges = await fetchFunnelRanges(id, token, { from: selected, to: selected }, past ? { from: past, to: past } : null);
  return ranges.map(({ from, to, ...counts }) => ({ date: from, ...counts }));
}

// Отрезок окончательный, если скачан хотя бы через неделю после своего конца: WB догружает данные несколько дней.
// Неокончательные отрезки перекачиваются не чаще раза в час.
function funnelRangeNeedsFetch(to, fetchedAt, now = Date.now()) {
  const fetched = Date.parse(fetchedAt || '');
  if (!Number.isFinite(fetched)) return true;
  if (fetched >= Date.parse(`${addDays(to, FUNNEL_FINAL_AFTER_DAYS)}T00:00:00Z`)) return false;
  return now - fetched >= FUNNEL_REFRESH_MINUTES * 60_000;
}

// liveMs — для автообновления открытой вкладки: сегодняшний день перезапрашивается, если сохранён раньше liveMs назад,
// а не раз в FUNNEL_REFRESH_MINUTES. Прошлые дни это не трогает.
function funnelDaysToFetch(dates = [], records = new Map(), now = Date.now(), today = moscowDate(0), liveMs = 0) {
  const earliest = addDays(today, -FUNNEL_MAX_DEPTH_DAYS);
  return [...new Set(dates)].filter(date => {
    if (date > today || date < earliest) return false;
    const record = records.get(date);
    if (liveMs && record?.products && date === today && now - (Date.parse(record.fetchedAt || '') || 0) >= liveMs) return true;
    return !record?.products || funnelRangeNeedsFetch(date, record.fetchedAt, now);
  });
}

// Пары дней для запросов: сначала самые свежие, более ранний день идёт как прошлый период.
function pairFunnelDays(dates = []) {
  const sorted = [...new Set(dates)].sort().reverse();
  const pairs = [];
  for (let index = 0; index < sorted.length; index += 2) pairs.push({ selected: sorted[index], past: sorted[index + 1] || '' });
  return pairs;
}

function funnelWeekStart(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

// Недели (с понедельника) или календарные месяцы внутри периода; прошлый отрезок сдвинут на длину периода.
function funnelRangeBuckets(period, grouping) {
  const buckets = [];
  const index = new Map();
  const length = datesBetween(period.from, period.to).length;
  for (const date of datesBetween(period.from, period.to)) {
    const key = grouping === 'week' ? funnelWeekStart(date) : date.slice(0, 7);
    if (!index.has(key)) {
      const bucket = { key, from: date, to: date };
      index.set(key, bucket);
      buckets.push(bucket);
    }
    index.get(key).to = date;
  }
  return buckets.map(bucket => ({ ...bucket, previous: { from: addDays(bucket.from, -length), to: addDays(bucket.to, -length) } }));
}

// Итог отрезка: из сохранённых дней, если все дни есть и достаточно свежие, иначе из сохранённого итога отрезка.
function funnelRangeValues(range, daysByDate, storedRanges, nmIds = null, now = Date.now()) {
  const dates = datesBetween(range.from, range.to);
  if (dates.every(date => daysByDate.get(date)?.products && !funnelRangeNeedsFetch(date, daysByDate.get(date).fetchedAt, now))) {
    const total = pickFunnelCounts();
    for (const date of dates) {
      const counts = funnelRecordCounts(daysByDate.get(date), nmIds);
      for (const key of FUNNEL_COUNT_KEYS) total[key] += counts[key];
    }
    return { values: total, fresh: true };
  }
  const stored = storedRanges[`${range.from}_${range.to}`];
  if (!stored) return { values: null, fresh: false };
  return {
    values: funnelRecordCounts(stored, nmIds),
    fresh: Boolean(stored.products) && !funnelRangeNeedsFetch(range.to, stored.fetchedAt, now)
  };
}

// Кнопка «Перекачать» в воронке: дни выбранного периода (или его недели и месяцы, если график сгруппирован)
// ставятся в очередь заново и перезаписываются, даже если уже считаются окончательными.
// Дни сохраняются целиком, поэтому перекачка обновляет и итоги, и разбивку по артикулам.
function refetchFunnel(id, from, to, grouping = 'day') {
  if (id === 'demo' || !cabinets().length) throw apiError(400, 'В демо-режиме перекачивать нечего');
  tokenFor(id);
  const periods = funnelPeriods(from, to);
  const earliest = addDays(moscowDate(0), -FUNNEL_MAX_DEPTH_DAYS);
  const job = funnelJobs.get(id);
  if (grouping === 'week' || grouping === 'month') {
    const ranges = funnelRangeBuckets(periods.current, grouping)
      .filter(bucket => bucket.from >= earliest)
      .map(bucket => ({ ...bucket, previous: bucket.previous.from >= earliest ? bucket.previous : null }));
    // Недавние ошибки не должны откладывать явный запрос пользователя.
    ranges.forEach(range => job?.failedAt.delete(`${range.from}_${range.to}`));
    scheduleFunnelSync(id, [], ranges);
    const keys = ranges.map(range => `${range.from}_${range.to}`);
    return { grouping, scheduled: ranges.length, sync: funnelSyncStatus(id, [], keys) };
  }
  const dates = datesBetween(periods.current.from, periods.current.to).filter(date => date >= earliest);
  dates.forEach(date => job?.failedAt.delete(date));
  scheduleFunnelSync(id, dates);
  return { grouping: 'day', scheduled: dates.length, sync: funnelSyncStatus(id, dates) };
}

function scheduleFunnelSync(id, dates = [], ranges = []) {
  const job = funnelJobs.get(id) || {
    pending: new Set(),
    ranges: new Map(),
    current: [],
    currentRange: '',
    failedAt: new Map(),
    running: false,
    lastError: ''
  };
  funnelJobs.set(id, job);
  const now = Date.now();
  for (const date of dates) {
    if (job.current.includes(date) || now - (job.failedAt.get(date) || 0) < FUNNEL_RETRY_FAILED_MS) continue;
    job.pending.add(date);
  }
  for (const range of ranges) {
    const key = `${range.from}_${range.to}`;
    if (job.currentRange === key || now - (job.failedAt.get(key) || 0) < FUNNEL_RETRY_FAILED_MS) continue;
    job.ranges.set(key, range);
  }
  if (!job.running && (job.pending.size || job.ranges.size)) runFunnelSync(id, job);
  return job;
}

async function runFunnelSync(id, job) {
  job.running = true;
  job.lastError = '';
  try {
    const token = tokenFor(id);
    while (job.ranges.size || job.pending.size) {
      if (job.ranges.size) {
        // Недели и месяцы открытого графика идут первыми: их меньше и пользователь ждёт именно их.
        const [key, range] = job.ranges.entries().next().value;
        job.ranges.delete(key);
        job.currentRange = key;
        try {
          saveFunnelRanges(id, await fetchFunnelRanges(id, token, range, range.previous));
        } catch (error) {
          job.lastError = error.message;
          job.failedAt.set(key, Date.now());
          if ([401, 403].includes(error.status)) {
            job.ranges.clear();
            job.pending.clear();
          }
        }
        job.currentRange = '';
        continue;
      }
      const [pair] = pairFunnelDays([...job.pending]);
      job.current = [pair.selected, pair.past].filter(Boolean);
      job.current.forEach(date => job.pending.delete(date));
      try {
        saveFunnelDays(id, await fetchFunnelDays(id, token, pair.selected, pair.past));
      } catch (error) {
        job.lastError = error.message;
        job.current.forEach(date => job.failedAt.set(date, Date.now()));
        if ([401, 403].includes(error.status)) {
          job.ranges.clear();
          job.pending.clear();
        }
      }
      job.current = [];
    }
  } catch (error) {
    job.lastError = error.message;
    job.pending.clear();
    job.ranges.clear();
  } finally {
    job.running = false;
    job.current = [];
    job.currentRange = '';
  }
}

function funnelSyncStatus(id, dates = [], rangeKeys = []) {
  const job = funnelJobs.get(id);
  const inRange = new Set(dates);
  const keys = new Set(rangeKeys);
  const leftDays = job ? [...job.pending, ...job.current].filter(date => inRange.has(date)).length : 0;
  const leftRanges = job ? [...job.ranges.keys(), job.currentRange].filter(key => key && keys.has(key)).length : 0;
  const requests = job ? job.ranges.size + (job.currentRange ? 1 : 0) + Math.ceil((job.pending.size + job.current.length) / 2) : 0;
  const bucket = funnelBuckets.get(id);
  const tokens = bucket
    ? Math.min(FUNNEL_BUCKET_SIZE, bucket.tokens + (Date.now() - bucket.updatedAt) / FUNNEL_BUCKET_INTERVAL)
    : FUNNEL_BUCKET_SIZE;
  return {
    pending: rangeKeys.length ? leftRanges : leftDays,
    running: Boolean(job?.running),
    lastError: job?.lastError || '',
    etaSeconds: Math.ceil((Math.max(0, requests - Math.floor(tokens)) * FUNNEL_BUCKET_INTERVAL) / 1000 + requests * 2)
  };
}

function funnelPeriods(from, to) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  const today = moscowDate(0);
  const requestedTo = pattern.test(to || '') ? to : today;
  const currentTo = requestedTo > today ? today : requestedTo;
  const currentFrom = pattern.test(from || '') ? from : addDays(currentTo, -6);
  if (currentFrom > currentTo) throw apiError(400, 'Начало периода должно быть раньше окончания');
  const length = datesBetween(currentFrom, currentTo).length;
  if (length > 366) throw apiError(400, 'Для графика воронки выберите период не больше года');
  return { current: { from: currentFrom, to: currentTo }, previous: { from: addDays(currentFrom, -length), to: addDays(currentFrom, -1) } };
}

function demoFunnelHistory(periods, grouping = 'day') {
  const make = ({ from, to }, shift) =>
    datesBetween(from, to).map((date, index) => {
      const open = 900 + ((index * 37 + shift) % 11) * 45;
      const cart = Math.round(open * (0.05 + ((index + shift) % 4) * 0.006));
      const orders = Math.round(cart * 0.26);
      const buyouts = Math.round(orders * 0.62);
      return {
        date,
        openCount: open,
        cartCount: cart,
        orderCount: orders,
        orderSum: orders * 1490,
        buyoutCount: buyouts,
        buyoutSum: buyouts * 1490,
        addToWishlistCount: Math.round(open * 0.012),
        cancelCount: Math.round(buyouts * (0.12 + ((index + shift) % 5) * 0.04))
      };
    });
  const current = make(periods.current, 0);
  const previous = make(periods.previous, 5);
  const byDate = new Map([...current, ...previous].map(day => [day.date, { ...day, fetchedAt: '2100-01-01T00:00:00Z', products: {} }]));
  const buckets =
    grouping === 'day'
      ? []
      : funnelRangeBuckets(periods.current, grouping).map(bucket => ({
          ...bucket,
          values: funnelRangeValues(bucket, byDate, {}).values,
          previous: { ...bucket.previous, values: funnelRangeValues(bucket.previous, byDate, {}).values }
        }));
  return {
    demo: true,
    grouping,
    periods,
    current,
    previous,
    buckets,
    storedFrom: periods.previous.from,
    earliestAvailable: addDays(moscowDate(0), -FUNNEL_MAX_DEPTH_DAYS),
    sync: { pending: 0, running: false, lastError: '', etaSeconds: 0 },
    warnings: []
  };
}

function normalizeFunnelNmIds(nmIds) {
  if (!Array.isArray(nmIds)) return null;
  return [...new Set(nmIds.map(value => String(value)).filter(value => /^\d{1,15}$/.test(value)))].slice(0, 5000);
}

async function funnelHistory(id, from, to, grouping = 'day', nmIdsInput = null, live = false) {
  const safeGrouping = ['day', 'week', 'month'].includes(grouping) ? grouping : 'day';
  const nmIds = normalizeFunnelNmIds(nmIdsInput);
  const periods = funnelPeriods(from, to);
  if (id === 'demo' || !cabinets().length) return { ...demoFunnelHistory(periods, safeGrouping), filtered: Boolean(nmIds) };
  tokenFor(id);
  const dates = datesBetween(periods.previous.from, periods.current.to);
  const stored = loadFunnelDays(id, periods.previous.from, periods.current.to);
  const shown = stored
    .map(day => {
      const counts = funnelRecordCounts(day, nmIds);
      return counts ? { date: day.date, fetchedAt: day.fetchedAt, ...counts } : null;
    })
    .filter(Boolean);
  const inPeriod = ({ from: start, to: end }) => shown.filter(day => day.date >= start && day.date <= end);
  const base = {
    demo: false,
    grouping: safeGrouping,
    filtered: Boolean(nmIds),
    productCount: nmIds ? nmIds.length : null,
    periods,
    current: inPeriod(periods.current),
    previous: inPeriod(periods.previous),
    storedFrom: funnelStoredFrom(id),
    earliestAvailable: addDays(moscowDate(0), -FUNNEL_MAX_DEPTH_DAYS),
    folder: `data/Funnel/${cabinetFolderName(id)}`,
    warnings: []
  };
  if (safeGrouping === 'day') {
    scheduleFunnelSync(
      id,
      funnelDaysToFetch(dates, new Map(stored.map(day => [day.date, day])), Date.now(), moscowDate(0), live ? SUMMARY_REFRESH_MS : 0)
    );
    return { ...base, buckets: [], sync: funnelSyncStatus(id, dates) };
  }
  const byDate = new Map(stored.map(day => [day.date, day]));
  const storedRanges = readFunnelRanges(id);
  const earliest = base.earliestAvailable;
  const toFetch = [];
  const buckets = funnelRangeBuckets(periods.current, safeGrouping).map(bucket => {
    const current = funnelRangeValues(bucket, byDate, storedRanges, nmIds);
    const previous = funnelRangeValues(bucket.previous, byDate, storedRanges, nmIds);
    if ((!current.fresh || !previous.fresh) && bucket.from >= earliest)
      toFetch.push({ ...bucket, previous: bucket.previous.from >= earliest ? bucket.previous : null });
    return { ...bucket, values: current.values, previous: { ...bucket.previous, values: previous.values } };
  });
  scheduleFunnelSync(id, [], toFetch);
  return {
    ...base,
    buckets,
    sync: funnelSyncStatus(
      id,
      [],
      buckets.map(bucket => `${bucket.from}_${bucket.to}`)
    )
  };
}

// Матрица «товар × день» для вкладки продаж по дням: значения берутся из сохранённой разбивки по артикулам.
function funnelSalesMatrix(days = [], dates = [], nmIds = null, metric = 'orderCount') {
  const index = FUNNEL_COUNT_KEYS.indexOf(metric);
  if (index < 0) throw apiError(400, 'Неизвестный показатель');
  const byDate = new Map(days.map(day => [day.date, day]));
  const products = new Map();
  const addProduct = nmId => products.get(nmId) || products.set(nmId, { nmId, values: dates.map(() => null), total: 0 }).get(nmId);
  if (nmIds) nmIds.forEach(nmId => addProduct(String(nmId)));
  dates.forEach((date, column) => {
    const record = byDate.get(date);
    if (!record?.products) return;
    for (const [nmId, values] of Object.entries(record.products)) {
      if (nmIds && !products.has(nmId)) continue;
      const product = addProduct(nmId);
      const value = Number(values[index] || 0);
      product.values[column] = (product.values[column] || 0) + value;
      product.total += value;
    }
    for (const product of products.values()) if (product.values[column] === null) product.values[column] = 0;
  });
  const totals = dates.map((date, column) =>
    byDate.get(date)?.products ? [...products.values()].reduce((sum, product) => sum + Number(product.values[column] || 0), 0) : null
  );
  return {
    products: [...products.values()].sort((a, b) => b.total - a.total || String(a.nmId).localeCompare(String(b.nmId))),
    totals,
    total: totals.reduce((sum, value) => sum + Number(value || 0), 0)
  };
}

async function funnelSales(id, from, to, nmIdsInput = null, metric = 'orderCount') {
  const periods = funnelPeriods(from, to);
  const period = periods.current;
  const dates = datesBetween(period.from, period.to);
  const nmIds = normalizeFunnelNmIds(nmIdsInput);
  if (id === 'demo' || !cabinets().length) {
    const demo = demoFunnelHistory(periods, 'day');
    return {
      demo: true,
      period,
      dates,
      metric,
      ...funnelSalesMatrix([], dates, nmIds, metric),
      sync: { pending: 0, running: false, lastError: '', etaSeconds: 0 },
      warnings: ['В демо-режиме продажи по дням не заполняются'],
      days: demo.current.length
    };
  }
  tokenFor(id);
  const stored = loadFunnelDays(id, period.from, period.to);
  scheduleFunnelSync(id, funnelDaysToFetch(dates, new Map(stored.map(day => [day.date, day]))));
  return {
    demo: false,
    period,
    dates,
    metric,
    ...funnelSalesMatrix(stored, dates, nmIds, metric),
    ready: stored.filter(day => day.products).length,
    sync: funnelSyncStatus(id, dates),
    warnings: []
  };
}

// --- Таблица «Товары в воронке» ---
// WB отдаёт до 1000 товаров за запрос (3 запроса в минуту), отсортированных по переходам в карточку: при 5–6 тыс.
// артикулов таблица собирается из нескольких страниц за минуты. Поэтому:
//   • таблица собирается в фоне по странице, а /api/funnel отдаёт то, что уже пришло (version + offset — только новые строки),
//     и сайт показывает загруженные товары по ходу;
//   • готовая таблица периода хранится в памяти и в data/Funnel/<кабинет>/tables/<с>_<по>.json: повторное открытие —
//     сразу, а свежие данные подтягиваются в фоне (refreshing), пока на экране прежние;
//   • в браузер уходят только показатели, которые выводит сайт (без сравнения периодов, WB Клуба и прочего).
// Свежесть: отчёт WB обновляется раз в 2 часа — таблица периода, захватывающего последнюю неделю, перекачивается
// не чаще раза в 30 минут; более старые периоды окончательны и берутся с диска до недели.
const FUNNEL_TABLE_PAGE = 1000;
const FUNNEL_TABLE_TTL = 30 * 60_000;
const FUNNEL_TABLE_FINAL_TTL = 7 * 86_400_000;
const FUNNEL_TABLE_RETRY_MS = 60_000;
const FUNNEL_TABLE_FIRST_WAIT_MS = 25_000;
const funnelTables = new Map();

function slimFunnelStat(stat) {
  if (!stat) return null;
  const n = key => Number(stat[key] || 0),
    c = stat.conversions || {};
  return {
    openCount: n('openCount'),
    cartCount: n('cartCount'),
    orderCount: n('orderCount'),
    orderSum: n('orderSum'),
    buyoutCount: n('buyoutCount'),
    buyoutSum: n('buyoutSum'),
    cancelCount: n('cancelCount'),
    addToWishlist: Number(stat.addToWishlist ?? stat.addToWishlistCount ?? 0),
    conversions: {
      addToCartPercent: Number(c.addToCartPercent || 0),
      cartToOrderPercent: Number(c.cartToOrderPercent || 0),
      buyoutPercent: Number(c.buyoutPercent || 0)
    }
  };
}
function slimFunnelProduct(item, photos = null) {
  const product = item.product || item,
    nmId = product.nmId ?? product.nmID;
  return {
    product: {
      nmId,
      title: product.title || '',
      vendorCode: product.vendorCode || '',
      subjectName: product.subjectName || '',
      photo: photos?.get(String(nmId)) || '',
      stocks: { wb: Number(product.stocks?.wb || 0), mp: Number(product.stocks?.mp || 0) }
    },
    statistic: { selected: slimFunnelStat(item.statistic?.selected), past: slimFunnelStat(item.statistic?.past) }
  };
}
const funnelTableDir = id => path.join(funnelDir(id), 'tables');
const funnelTableFile = (id, period) => path.join(funnelTableDir(id), `${period.from}_${period.to}.json`);
function readFunnelTable(id, period) {
  // photosPending из файла не берём: после перезапуска сервера фото уже никто не подставит.
  try {
    const table = JSON.parse(fs.readFileSync(funnelTableFile(id, period), 'utf8'));
    return Array.isArray(table.products) ? { ...table, photosPending: false } : null;
  } catch {
    return null;
  }
}
function saveFunnelTable(id, period, table) {
  const dir = funnelTableDir(id),
    target = funnelTableFile(id, period);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(table));
  fs.renameSync(`${target}.tmp`, target);
}
function funnelTableFresh(table, period, now = Date.now()) {
  if (!table) return false;
  // «Сегодня» по Москве — от того же now, что и возраст таблицы (иначе проверка зависела от настоящей даты).
  const today = new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
  const age = now - (Date.parse(table.fetchedAt || '') || 0),
    final = period.to < addDays(today, -FUNNEL_FINAL_AFTER_DAYS);
  return age < (final ? FUNNEL_TABLE_FINAL_TTL : FUNNEL_TABLE_TTL);
}
function funnelTableEntry(id, periods) {
  const key = `${id}|${periods.current.from}|${periods.current.to}`;
  if (!funnelTables.has(key)) funnelTables.set(key, { cache: readFunnelTable(id, periods.current), job: null, failedAt: 0, error: '' });
  return funnelTables.get(key);
}
function startFunnelTableJob(id, periods, entry) {
  const token = tokenFor(id);
  // Прошлый период той же длины нужен для изменений в процентах; старше года WB его не отдаёт.
  const past = periods.previous.from >= addDays(moscowDate(0), -FUNNEL_MAX_DEPTH_DAYS) ? periods.previous : null;
  let firstPage;
  const job = {
    version: Date.now().toString(36),
    products: [],
    periods: { current: periods.current, previous: past },
    firstPage: new Promise(resolve => {
      firstPage = resolve;
    })
  };
  entry.job = job;
  entry.error = '';
  // Фото — из карточек товаров (свой лимит у Контента): не ждём их ради первой страницы. Пришли позже — фото
  // проставляются всем загруженным строкам, а новая version заставляет сайт взять список целиком.
  let photos = null;
  const cards = productCards(id, token)
    .catch(() => [])
    .then(list => {
      photos = new Map(list.map(card => [String(card.nmID), cardPhoto(card)]));
      if (job.products.length) {
        job.products.forEach(item => {
          item.product.photo = photos.get(String(item.product.nmId)) || '';
        });
        job.version = `${job.version}p`;
      }
    });
  job.promise = (async () => {
    try {
      for (let offset = 0; ; offset += FUNNEL_TABLE_PAGE) {
        const response = await funnelProductsRequest(
          id,
          token,
          {
            selectedPeriod: { start: periods.current.from, end: periods.current.to },
            ...(past ? { pastPeriod: { start: past.from, end: past.to } } : {}),
            nmIds: [],
            skipDeletedNm: true,
            orderBy: { field: 'openCard', mode: 'desc' },
            limit: FUNNEL_TABLE_PAGE,
            offset
          },
          'high'
        );
        const page = response?.data?.products || response?.products || [];
        job.products.push(...page.map(item => slimFunnelProduct(item, photos)));
        firstPage();
        if (page.length < FUNNEL_TABLE_PAGE) break;
      }
      // Строки готовы — таблица готова; фото, если карточки ещё грузятся (тысячи карточек — минута-две), подставятся следом:
      // photosPending держит сайт на опросе, новая version отдаст ему список с фото.
      const table = {
        version: job.version,
        fetchedAt: new Date().toISOString(),
        periods: job.periods,
        products: job.products,
        photosPending: !photos
      };
      const save = () => {
        try {
          saveFunnelTable(id, periods.current, table);
        } catch (error) {
          console.error('Воронка: таблица не сохранена', error.message);
        }
      };
      entry.cache = table;
      save();
      if (!photos)
        cards.then(() => {
          table.version = `${table.version}p`;
          table.photosPending = false;
          if (entry.cache === table) save();
        });
    } catch (error) {
      entry.error = error.message;
      entry.failedAt = Date.now();
    } finally {
      firstPage();
      entry.job = null;
    }
    return entry.cache;
  })();
  return job;
}
// /api/funnel: version и offset — что уже есть у сайта; при той же version отдаются только строки после offset.
// done — таблица собрана целиком; refreshing — на экране прежняя таблица, новая собирается в фоне.
async function funnelTable(id, from, to, { version = '', offset = 0, force = false } = {}) {
  const periods = funnelPeriods(from, to);
  if (id === 'demo' || !cabinets().length)
    return {
      demo: true,
      version: 'demo',
      offset: 0,
      loaded: 0,
      done: true,
      refreshing: false,
      products: [],
      periods,
      history: [],
      groupedHistory: []
    };
  tokenFor(id);
  const entry = funnelTableEntry(id, periods),
    now = Date.now();
  if (
    !entry.job &&
    (force || !funnelTableFresh(entry.cache, periods.current, now)) &&
    (force || now - entry.failedAt > FUNNEL_TABLE_RETRY_MS)
  )
    startFunnelTableJob(id, periods, entry);
  // Показать ещё нечего — ждём первую страницу, чтобы не отвечать пустой таблицей.
  if (!entry.cache && entry.job && !entry.job.products.length) await Promise.race([entry.job.firstPage, wait(FUNNEL_TABLE_FIRST_WAIT_MS)]);
  const shown = entry.cache || entry.job;
  if (!shown) throw apiError(502, entry.error || 'Не удалось загрузить воронку');
  const start = version && version === shown.version ? Math.max(0, Math.min(Number(offset) || 0, shown.products.length)) : 0;
  return {
    demo: false,
    version: shown.version,
    offset: start,
    loaded: shown.products.length,
    products: shown.products.slice(start),
    done: shown === entry.cache,
    refreshing: Boolean(entry.cache && entry.job),
    photosPending: Boolean(shown.photosPending),
    fetchedAt: entry.cache?.fetchedAt || null,
    error: entry.error || '',
    periods: shown.periods,
    history: [],
    groupedHistory: []
  };
}
// Вся таблица периода (для заказов воронки во вкладке «Реклама»): готовая — сразу, иначе ждём сборку.
async function funnelDetails(id, from, to) {
  if (id === 'demo' || !cabinets().length) return { products: [], history: [], groupedHistory: [] };
  const periods = funnelPeriods(from, to),
    entry = funnelTableEntry(id, periods);
  if (!funnelTableFresh(entry.cache, periods.current)) {
    const job = entry.job || startFunnelTableJob(id, periods, entry);
    await job.promise;
  }
  if (!entry.cache) throw apiError(502, entry.error || 'Не удалось загрузить воронку');
  return { periods: entry.cache.periods, products: entry.cache.products, history: [], groupedHistory: [] };
}

// Заказы из воронки продаж по артикулам за период — для столбца «Заказы, воронка» во вкладке «Реклама»:
// все заказы товара (не только с рекламы), чтобы видеть, какую долю дают рекламные заказы. Кэш 5 минут.
function funnelOrdersByNmId(products = []) {
  const orders = {};
  for (const item of products) {
    const product = item.product || item,
      stats = item.statistic?.selected || item.history?.[0] || item,
      nmId = product.nmId ?? product.nmID;
    if (nmId != null) orders[nmId] = (orders[nmId] || 0) + Number(stats.orderCount || 0);
  }
  return orders;
}
async function funnelOrders(id, from, to) {
  const periods = funnelPeriods(from, to);
  if (id === 'demo' || !cabinets().length) return { demo: true, period: periods.current, orders: { 4210000: 412, 4210001: 268 } };
  const details = await cachedAnalytics(
    `funnel-orders:${id}:${periods.current.from}:${periods.current.to}`,
    () => funnelDetails(id, from, to),
    5 * 60_000
  );
  return { demo: false, period: periods.current, orders: funnelOrdersByNmId(details.products) };
}

const SUMMARY_REFRESH_MS = 2 * 60_000;

module.exports = {
  FUNNEL_COUNT_KEYS,
  FUNNEL_MAX_DEPTH_DAYS,
  SUMMARY_REFRESH_MS,
  demoFunnelHistory,
  fetchFunnelRanges,
  funnelCount,
  funnelDaysToFetch,
  funnelHistory,
  funnelOrders,
  funnelOrdersByNmId,
  funnelPeriods,
  funnelRangeBuckets,
  funnelRangeNeedsFetch,
  funnelRangeValues,
  funnelRecordCounts,
  funnelSales,
  funnelSalesMatrix,
  funnelTable,
  funnelTableFresh,
  pairFunnelDays,
  pickFunnelCounts,
  readFunnelRanges,
  refetchFunnel,
  saveFunnelRanges,
  slimFunnelProduct
};
