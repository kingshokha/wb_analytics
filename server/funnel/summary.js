'use strict';
// --- Общая сводка: показатели за период, лучшие товары, просадки, реклама.
const { addDays, cabinets, datesBetween, moscowDate, tokenFor } = require('../core/base');
const { productCards } = require('../core/product-cards');
const { cardPhoto } = require('../core/photos');
const { addAdMetrics, demoAds, emptyAdMetrics, finalizeAdMetrics, summarizeAdStats } = require('../ads/stats');
const { loadAdStats } = require('../ads/campaign');
const {
  FUNNEL_COUNT_KEYS,
  FUNNEL_MAX_DEPTH_DAYS,
  FUNNEL_RETRY_FAILED_MS,
  SUMMARY_REFRESH_MS,
  demoFunnelHistory,
  fetchFunnelRanges,
  funnelCount,
  funnelHistory,
  funnelPeriods,
  funnelRangeNeedsFetch,
  pickFunnelCounts,
  readFunnelRanges,
  saveFunnelRanges
} = require('./funnel');

// --- Общая сводка ---
// Итоги выбранного и прошлого периода с разбивкой по артикулам приходят одним запросом воронки
// и сохраняются в periods.json рядом с отрезками графика; дневная динамика берётся из истории воронки.
const SUMMARY_TOP_PRODUCTS = 5;
const SUMMARY_DROP_LIMIT = 6;
const DROP_MIN_ORDERS = 3;
const DROP_MIN_OPENS = 100;
const DROP_RATIO = 0.7;

function funnelCountsFromValues(values = []) {
  return Object.fromEntries(FUNNEL_COUNT_KEYS.map((key, index) => [key, values ? funnelCount(key, values[index]) : 0]));
}

function summaryProducts(current = {}, previous = null, cards = []) {
  const byNmId = new Map(cards.map(card => [String(card.nmID), card]));
  const ids = new Set([...Object.keys(current?.products || {}), ...Object.keys(previous?.products || {})]);
  return [...ids].map(nmId => {
    const card = byNmId.get(nmId) || {};
    return {
      nmId: Number(nmId),
      name: card.title || `Товар ${nmId}`,
      vendorCode: card.vendorCode || '',
      subjectName: card.subjectName || '',
      photo: cardPhoto(card),
      current: funnelCountsFromValues(current?.products?.[nmId]),
      previous: funnelCountsFromValues(previous?.products?.[nmId])
    };
  });
}

function productBrief(product) {
  return { nmId: product.nmId, name: product.name, vendorCode: product.vendorCode, photo: product.photo };
}

// Лидеры по сумме заказов и «Прочие»; доля прошлого периода нужна, чтобы показать сдвиг в п.п.
function summaryTopProducts(products = [], limit = SUMMARY_TOP_PRODUCTS) {
  const total = products.reduce((sum, item) => sum + item.current.orderSum, 0);
  const previousTotal = products.reduce((sum, item) => sum + item.previous.orderSum, 0);
  const share = (value, base) => (base ? (value / base) * 100 : 0);
  const sorted = products
    .filter(item => item.current.orderSum > 0)
    .sort((a, b) => b.current.orderSum - a.current.orderSum || a.nmId - b.nmId);
  const items = sorted.slice(0, limit).map(item => ({
    ...productBrief(item),
    orderSum: item.current.orderSum,
    orderCount: item.current.orderCount,
    share: share(item.current.orderSum, total),
    previousShare: share(item.previous.orderSum, previousTotal)
  }));
  const rest = sorted.slice(limit);
  const restSum = rest.reduce((sum, item) => sum + item.current.orderSum, 0);
  const restPrevious = previousTotal - items.reduce((sum, item) => sum + products.find(p => p.nmId === item.nmId).previous.orderSum, 0);
  return {
    total,
    previousTotal,
    items,
    other: rest.length
      ? {
          count: rest.length,
          orderSum: restSum,
          orderCount: rest.reduce((sum, item) => sum + item.current.orderCount, 0),
          share: share(restSum, total),
          previousShare: share(restPrevious, previousTotal)
        }
      : null
  };
}

// Товар попадает в просадки, если заказы, переходы или конверсия в заказ упали на 30% и больше.
// Пороги по количеству отсекают шум: падение с 2 заказов до 1 ничего не значит.
function summaryDrops(products = [], limit = SUMMARY_DROP_LIMIT) {
  const change = (from, to) => (from ? ((to - from) / from) * 100 : 0);
  const drops = [];
  for (const product of products) {
    const now = product.current,
      before = product.previous,
      reasons = [];
    if (before.orderCount >= DROP_MIN_ORDERS && now.orderCount <= before.orderCount * DROP_RATIO) {
      reasons.push({
        metric: 'orderCount',
        label: 'Заказы',
        from: before.orderCount,
        to: now.orderCount,
        change: change(before.orderCount, now.orderCount)
      });
    }
    if (before.openCount >= DROP_MIN_OPENS && now.openCount <= before.openCount * DROP_RATIO) {
      reasons.push({
        metric: 'openCount',
        label: 'Переходы',
        from: before.openCount,
        to: now.openCount,
        change: change(before.openCount, now.openCount)
      });
    }
    if (before.openCount >= DROP_MIN_OPENS && now.openCount >= DROP_MIN_OPENS && before.orderCount >= DROP_MIN_ORDERS) {
      const was = (before.orderCount / before.openCount) * 100,
        is = (now.orderCount / now.openCount) * 100;
      if (is <= was * DROP_RATIO)
        reasons.push({ metric: 'orderConversion', label: 'Конв. в заказ', from: was, to: is, change: change(was, is), unit: '%' });
    }
    if (!reasons.length) continue;
    const worst = Math.min(...reasons.map(reason => reason.change));
    drops.push({
      ...productBrief(product),
      severity: worst <= -60 ? 'high' : worst <= -45 ? 'medium' : 'low',
      worst,
      lostSum: Math.max(0, before.orderSum - now.orderSum),
      reasons: reasons.sort((a, b) => a.change - b.change)
    });
  }
  drops.sort((a, b) => b.lostSum - a.lostSum || a.worst - b.worst);
  return { total: drops.length, items: drops.slice(0, limit) };
}

// Итоги воронки за период по всем товарам: WB отдаёт их по 1000 товаров не чаще 3 запросов в минуту, поэтому у кабинета
// с 15 000 товаров это ~15 запросов и 5 минут (а если в очереди догрузка дней воронки — дольше). Сохранённые итоги
// показываются сразу, даже устаревшие, а свежие грузятся в фоне (refreshing: true — страница переспросит и подменит).
// Ждать приходится только в первый раз, когда сохранённых нет. Одна фоновая загрузка на кабинет и период.
const summaryRangeJobs = new Map(),
  summaryRangeErrors = new Map();
const summaryRangeKey = (id, periods, withPrevious) =>
  `${id}:${periods.current.from}_${periods.current.to}:${withPrevious ? periods.previous.from : ''}`;
function loadSummaryRanges(id, token, periods, withPrevious) {
  const key = summaryRangeKey(id, periods, withPrevious);
  if (!summaryRangeJobs.has(key)) {
    const job = (async () => {
      const [loaded, loadedPrevious = null] = await fetchFunnelRanges(id, token, periods.current, withPrevious ? periods.previous : null);
      saveFunnelRanges(id, [loaded, loadedPrevious].filter(Boolean));
      summaryRangeErrors.delete(key);
      return { current: loaded, previous: loadedPrevious, fetchedAt: new Date().toISOString() };
    })();
    job.catch(error => summaryRangeErrors.set(key, { message: error.message, at: Date.now() })).finally(() => summaryRangeJobs.delete(key));
    summaryRangeJobs.set(key, job);
  }
  return summaryRangeJobs.get(key);
}
async function summaryFunnelRanges(id, token, periods, refresh = false) {
  const now = Date.now();
  const stored = readFunnelRanges(id);
  const withPrevious = periods.previous.from >= addDays(moscowDate(0), -FUNNEL_MAX_DEPTH_DAYS);
  const pick = range => {
    const record = stored[`${range.from}_${range.to}`];
    return record?.products ? record : null;
  };
  const fresh = (record, range) =>
    Boolean(record) &&
    (refresh ? now - Date.parse(record.fetchedAt || '') < SUMMARY_REFRESH_MS : !funnelRangeNeedsFetch(range.to, record.fetchedAt, now));
  const current = pick(periods.current),
    previous = withPrevious ? pick(periods.previous) : null;
  // Свежие — без загрузки; но если фоновая загрузка этого периода ещё идёт (её начал «Обновить»), страница должна
  // переспрашивать, пока она не закончится.
  if (fresh(current, periods.current) && (!withPrevious || fresh(previous, periods.previous)))
    return {
      current,
      previous,
      fetchedAt: current.fetchedAt,
      refreshing: summaryRangeJobs.has(summaryRangeKey(id, periods, withPrevious))
    };
  // Сохранённых нет — ждём загрузку. Есть — сразу их, а свежие — в фоне; после неудачной фоновой загрузки следующая —
  // не раньше чем через FUNNEL_RETRY_FAILED_MS (страница переспрашивает каждые несколько секунд), с ошибкой в ответе.
  if (!current) return loadSummaryRanges(id, token, periods, withPrevious);
  const key = summaryRangeKey(id, periods, withPrevious),
    failed = summaryRangeErrors.get(key);
  const retry = !failed || now - failed.at >= FUNNEL_RETRY_FAILED_MS;
  if (retry) loadSummaryRanges(id, token, periods, withPrevious).catch(() => {});
  return {
    current,
    previous,
    fetchedAt: current.fetchedAt,
    refreshing: summaryRangeJobs.has(key),
    ...(failed && !summaryRangeJobs.has(key) ? { staleError: failed.message } : {})
  };
}

function summaryPayload(periods, current, previous, products, history) {
  const day = item => ({ date: item.date, ...pickFunnelCounts(item) });
  return {
    periods,
    totals: { current: pickFunnelCounts(current), previous: previous ? pickFunnelCounts(previous) : null },
    daily: { current: (history.current || []).map(day), previous: (history.previous || []).map(day) },
    sync: history.sync,
    top: summaryTopProducts(products),
    drops: previous ? summaryDrops(products) : { total: 0, items: [] },
    productCount: products.filter(item => item.current.orderCount || item.current.openCount).length
  };
}

const DEMO_SUMMARY_PRODUCTS = [
  ['Худи оверсайз с капюшоном', 'HOODIE-01', 0.26, 0.22],
  ['Футболка базовая хлопок', 'TEE-BASE', 0.19, 0.17],
  ['Свитшот с начёсом', 'SWEAT-02', 0.14, 0.1],
  ['Джоггеры утеплённые', 'JOG-05', 0.11, 0.09],
  ['Лонгслив в рубчик', 'LONG-11', 0.08, 0.15],
  ['Шорты спортивные', 'SHORT-07', 0.07, 0.06],
  ['Кепка с вышивкой', 'CAP-03', 0.06, 0.05],
  ['Носки, набор 5 пар', 'SOCKS-5', 0.05, 0.12],
  ['Панама хлопковая', 'PANAMA-1', 0.04, 0.04]
];

function demoSummary(periods) {
  const history = demoFunnelHistory(periods, 'day');
  const sum = days => {
    const total = pickFunnelCounts();
    days.forEach(item =>
      FUNNEL_COUNT_KEYS.forEach(key => {
        total[key] += Number(item[key] || 0);
      })
    );
    return total;
  };
  const current = sum(history.current),
    previous = sum(history.previous);
  const part = (total, weight) => Object.fromEntries(FUNNEL_COUNT_KEYS.map(key => [key, Math.round(total[key] * weight)]));
  const products = DEMO_SUMMARY_PRODUCTS.map(([name, vendorCode, now, before], index) => ({
    nmId: 100001 + index,
    name,
    vendorCode,
    subjectName: '',
    photo: '',
    current: part(current, now),
    previous: part(previous, before)
  }));
  return {
    demo: true,
    ...summaryPayload(periods, current, previous, products, history),
    fetchedAt: new Date().toISOString(),
    warnings: []
  };
}

async function summary(id, from, to, refresh = false) {
  const periods = funnelPeriods(from, to);
  if (id === 'demo' || !cabinets().length) return demoSummary(periods);
  const token = tokenFor(id);
  const warnings = [];
  // Запрос итогов ставится в очередь воронки раньше догрузки дней, чтобы карточки появились первыми.
  const rangesJob = summaryFunnelRanges(id, token, periods, refresh);
  rangesJob.catch(() => {});
  const history = await funnelHistory(id, periods.current.from, periods.current.to, 'day', null, refresh);
  const cards = await productCards(id, token).catch(error => (warnings.push(`Карточки товаров: ${error.message}`), []));
  const ranges = await rangesJob;
  if (ranges.staleError) warnings.push(`Воронка: ${ranges.staleError}. Показаны сохранённые данные`);
  if (!ranges.previous) warnings.push('WB отдаёт воронку только за последний год, поэтому сравнения с прошлым периодом нет');
  const products = summaryProducts(ranges.current, ranges.previous, cards);
  return {
    demo: false,
    ...summaryPayload(periods, ranges.current, ranges.previous, products, history),
    fetchedAt: ranges.fetchedAt,
    refreshing: Boolean(ranges.refreshing),
    warnings
  };
}

function summaryAdPeriod(days = [], range) {
  const daily = days.filter(day => day.date >= range.from && day.date <= range.to);
  const total = emptyAdMetrics();
  daily.forEach(day => addAdMetrics(total, day));
  return { totals: finalizeAdMetrics(total), daily };
}

// Реклама идёт отдельным запросом: fullstats отвечает не чаще раза в 20 секунд и не дольше чем за 31 день.
// Текущий период запрашивается первым и теми же пачками, что и вкладка «Реклама»: открытая следом вкладка берёт их из кэша.
async function summaryAds(id, from, to) {
  const periods = funnelPeriods(from, to);
  const length = datesBetween(periods.current.from, periods.current.to).length;
  if (length > 31)
    return { available: false, periods, reason: 'Реклама в сводке доступна за период до 31 дня — это ограничение WB API', warnings: [] };
  const ranges = [periods.current, periods.previous];
  const demo = id === 'demo' || !cabinets().length;
  const warnings = [];
  const days = [];
  for (const range of ranges) {
    // Демо-реклама рассчитана на вкладку «Реклама» и крупнее демо-воронки, поэтому для сводки она уменьшена.
    if (demo) {
      days.push(
        ...demoAds(range.from, range.to).daily.map(day =>
          finalizeAdMetrics({
            ...day,
            ...Object.fromEntries(['views', 'clicks', 'spend', 'orders', 'revenue', 'carts', 'sales'].map(key => [key, day[key] * 0.08]))
          })
        )
      );
      continue;
    }
    const { campaigns, stats } = await loadAdStats(id, tokenFor(id), range, warnings);
    days.push(...summarizeAdStats(campaigns, stats, range.from, range.to).daily);
  }
  return {
    demo,
    available: true,
    periods,
    current: summaryAdPeriod(days, periods.current),
    previous: summaryAdPeriod(days, periods.previous),
    warnings
  };
}

module.exports = { summary, summaryAds, summaryDrops, summaryProducts, summaryTopProducts };
