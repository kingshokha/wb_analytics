// --- «Воронка продаж»: товары в воронке, тренд по периоду, продажи по товарам ---

// Таблица «Товары в воронке» собирается на сервере по 1000 товаров (лимит WB — 3 запроса в минуту): пока она не готова,
// сайт каждые 3 секунды берёт только новые строки (version + offset) и сразу показывает загруженные товары.
// Готовая таблица периода хранится на сервере: повторное открытие — сразу, свежая подтягивается в фоне (refreshing).
// Страница таблицы, фильтры и сортировка при догрузке не сбрасываются. force — кнопка «Обновить»: собрать заново.
const FUNNEL_POLL_MS = 3000;
async function loadFunnelDetails(silent = false, force = false) {
  const key = [state.cabinet, $('#dateFrom').value, $('#dateTo').value].join('|'),
    table = state.funnelTable || {},
    same = table.key === key && !force;
  clearTimeout(table.timer);
  const request = (state.funnelTableRequest || 0) + 1;
  state.funnelTableRequest = request;
  if (!funnelFiltersActive()) loadFunnelTrend(silent, silent);
  return pollFunnelTable(key, request, same ? table : null, silent, force);
}
async function pollFunnelTable(key, request, known, silent, force = false) {
  const [cabinet, from, to] = key.split('|');
  try {
    const q = new URLSearchParams({
      cabinet,
      from,
      to,
      ...(known?.version ? { version: known.version, offset: String(known.loaded || 0) } : {}),
      ...(force ? { force: '1' } : {})
    });
    const data = await api('/api/funnel?' + q);
    if (request !== state.funnelTableRequest) return false;
    const fresh = !known || data.offset === 0,
      firstOfKey = state.funnelTable?.key !== key;
    state.funnelProducts = fresh ? data.products || [] : [...state.funnelProducts, ...(data.products || [])];
    state.funnelPeriods = data.periods || null;
    state.funnelTable = {
      key,
      version: data.version,
      loaded: data.loaded,
      done: data.done,
      refreshing: data.refreshing,
      photosPending: data.photosPending,
      error: data.error || '',
      timer: 0
    };
    if (firstOfKey && !silent) state.funnelPage = 1;
    if (state.funnelArticlesCabinet !== state.cabinet) {
      state.funnelFilters.articles.clear();
      state.funnelArticlesCabinet = state.cabinet;
    }
    state.funnelHistory = data.history || [];
    state.funnelGroupedHistory = data.groupedHistory || [];
    if (state.funnelProducts.length)
      state.funnel = state.funnelProducts.reduce(
        (sum, item) => {
          const h = item.statistic?.selected || item;
          return {
            views: sum.views + Number(h.openCount || 0),
            cart: sum.cart + Number(h.cartCount || 0),
            orders: sum.orders + Number(h.orderCount || 0),
            sales: sum.sales + Number(h.buyoutCount || 0),
            revenue: sum.revenue + Number(h.buyoutSum || 0)
          };
        },
        { views: 0, cart: 0, orders: 0, sales: 0, revenue: 0 }
      );
    renderFunnel();
    renderFunnelDetails();
    renderFunnelArticleOptions();
    if (firstOfKey && funnelFiltersActive()) loadFunnelTrend(silent, silent);
    if (state.funnelTab === 'sales' && (firstOfKey || (data.done && !data.refreshing))) loadFunnelSales();
    if (data.error && !silent) addNotice('funnel', `Воронка: ${data.error}`, 'warning');
    // Пока таблица собирается — следующая порция, если пользователь всё ещё на воронке того же периода.
    if ((!data.done || data.refreshing || data.photosPending) && state.activePage === 'funnel')
      state.funnelTable.timer = setTimeout(() => {
        if (request === state.funnelTableRequest && state.activePage === 'funnel') pollFunnelTable(key, request, state.funnelTable, true);
      }, FUNNEL_POLL_MS);
    return true;
  } catch (e) {
    if (request === state.funnelTableRequest && !silent) toast(e.message);
    return false;
  }
}

function renderFunnel() {
  const f = state.funnel;
  const items = [
    ['Переходы', f.views, '#9d77ff'],
    ['Корзины', f.cart, '#7651e5'],
    ['Заказы', f.orders, '#5635bc'],
    ['Выкупы', f.sales, '#318f68']
  ];
  const max = Math.max(1, ...items.map(x => Number(x[1] || 0)));
  $('#funnelChart').innerHTML = items
    .map(
      x =>
        `<div class="funnel-row"><label>${x[0]}</label><div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${Math.max(2, (Number(x[1] || 0) / max) * 100)}%;background:${x[2]}">${Number(x[1] || 0) / max > 0.15 ? fmtNum(x[1]) : ''}</div></div><strong>${fmtNum(x[1])}</strong></div>`
    )
    .join('');
  const conv = [
    ['Карточка → корзина', pct(f.cart, f.views)],
    ['Корзина → заказ', pct(f.orders, f.cart)],
    ['Заказ → выкуп', pct(f.sales, f.orders)]
  ];
  $('#conversionList').innerHTML = conv
    .map(
      x =>
        `<div class="conversion"><div><span>${x[0]}</span><strong>${x[1]}%</strong></div><div class="progress"><i style="width:${Math.min(100, x[1])}%"></i></div></div>`
    )
    .join('');
}

// --- График этапов воронки продаж ---
const FUNNEL_TREND_METRICS = [
  { key: 'openCount', label: 'Переходы', unit: 'шт' },
  { key: 'cartCount', label: 'Корзины', unit: 'шт' },
  { key: 'cartConversion', label: 'Конв. в корзину', unit: '%' },
  { key: 'addToWishlistCount', label: 'Отложено', unit: 'шт' },
  { key: 'orderConversion', label: 'Конв. в заказ', unit: '%' },
  { key: 'orderCount', label: 'Заказы, шт', unit: 'шт' },
  { key: 'orderSum', label: 'Заказы, ₽', unit: '₽' },
  { key: 'buyoutCount', label: 'Выкупы, шт', unit: 'шт' },
  { key: 'buyoutSum', label: 'Выкупы, ₽', unit: '₽' },
  { key: 'buyoutPercent', label: 'Выкуп, %', unit: '%' }
];
// Производные показатели точки графика. Выкуп, % — как у WB: выкупы ÷ (выкупы + отмены и возвраты), а не выкупы ÷ заказы:
// выкупы дня — это заказы прошлых дней, поэтому делить их на заказы того же дня нельзя. У дней, сохранённых до того, как
// сервер стал хранить отмены, cancelCount = null — выкуп таких дней неизвестен (на графике разрыв).
function funnelTrendDerived(values) {
  values.cartConversion = values.openCount ? (values.cartCount / values.openCount) * 100 : 0;
  values.orderConversion = values.cartCount ? (values.orderCount / values.cartCount) * 100 : 0;
  const done = values.buyoutCount + values.cancelCount;
  values.buyoutPercent =
    values.cancelCount == null || Number.isNaN(values.cancelCount) ? null : done ? (values.buyoutCount / done) * 100 : null;
  return values;
}
const TREND_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const funnelTrend = {
  data: null,
  metric: 'orderCount',
  compare: true,
  grouping: 'day',
  loading: false,
  error: '',
  pollTimer: 0,
  filterTimer: 0,
  requestId: 0,
  nmIds: null
};
const trendShift = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const trendWeekStart = date => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const trendShortDate = date => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const trendFullDate = date => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
// Пока сервер догружает дни из WB, график переспрашивает его каждые 5 секунд и дорисовывается.
// Фильтры таблицы товаров сужают и график: на сервер уходят артикулы, которые прошли фильтры.
function funnelFiltersActive() {
  const f = state.funnelFilters;
  return Boolean(f.categories.size || f.articles.size || f.availability.size);
}
function funnelTrendNmIds() {
  return funnelFiltersActive() ? funnelProductRows().map(row => String(row.nmId)) : null;
}
function scheduleFunnelTrendReload() {
  clearTimeout(funnelTrend.filterTimer);
  funnelTrend.filterTimer = setTimeout(() => {
    loadFunnelTrend();
    if (state.funnelTab === 'sales') {
      funnelSales.page = 1;
      loadFunnelSales();
    }
  }, 400);
}
// live — автообновление: сервер перезапросит у WB сегодняшний день, если он сохранён больше 2 минут назад.
async function loadFunnelTrend(silent = false, live = false) {
  const cabinet = state.cabinet,
    from = $('#dateFrom').value,
    to = $('#dateTo').value,
    request = ++funnelTrend.requestId;
  clearTimeout(funnelTrend.pollTimer);
  if (!silent) {
    funnelTrend.loading = true;
    funnelTrend.error = '';
    renderFunnelTrend();
  }
  try {
    const grouping = funnelTrend.grouping,
      nmIds = funnelTrendNmIds();
    const data = await api('/api/funnel/history', { method: 'POST', body: JSON.stringify({ cabinet, from, to, grouping, nmIds, live }) });
    if (request !== funnelTrend.requestId || grouping !== funnelTrend.grouping || cabinet !== state.cabinet) return;
    funnelTrend.data = data;
    funnelTrend.error = '';
    funnelTrend.nmIds = nmIds;
    if (data.sync?.pending)
      funnelTrend.pollTimer = setTimeout(() => {
        if (
          request === funnelTrend.requestId &&
          state.activePage === 'funnel' &&
          state.cabinet === cabinet &&
          $('#dateFrom').value === from &&
          $('#dateTo').value === to
        )
          loadFunnelTrend(true);
      }, 5000);
    setNotices('funnel', 'trend', data.warnings || []);
  } catch (e) {
    funnelTrend.error = e.message;
    setNotices('funnel', 'trend', [`График воронки: ${e.message}`], 'error');
  } finally {
    if (request === funnelTrend.requestId) {
      funnelTrend.loading = false;
      renderFunnelTrend();
    }
  }
}
// Кнопка «Перекачать» в воронке: заново загружает выбранный период из WB и перезаписывает сохранённые данные,
// даже окончательные. Перед запуском показывает, сколько запросов и времени это займёт (WB даёт 3 запроса в минуту).
function openFunnelRefetch() {
  const from = $('#dateFrom').value,
    today = mskDate(0),
    to = $('#dateTo').value > today ? today : $('#dateTo').value,
    grouping = funnelTrend.grouping;
  if (!from || !to || from > to) return toast('Выберите период');
  const days = datesBetweenTrend(from, to),
    buckets = new Set();
  for (let date = from; date <= to; date = trendShift(date, 1)) buckets.add(grouping === 'week' ? trendWeekStart(date) : date.slice(0, 7));
  // Дни запрашиваются парами (выбранный + «прошлый» в одном запросе), недели и месяцы — по одному отрезку за запрос.
  const requests = grouping === 'day' ? Math.ceil(days / 2) : buckets.size,
    seconds = Math.max(0, requests - 3) * 20.5 + requests * 2;
  const eta = seconds >= 60 ? `примерно ${Math.ceil(seconds / 60)} мин` : 'меньше минуты';
  const unit = grouping === 'week' ? ` · ${buckets.size} нед.` : grouping === 'month' ? ` · ${buckets.size} мес.` : '';
  openModal(
    `<p class="eyebrow">Воронка продаж</p><h2>Перекачать данные из WB?</h2><p>Данные за ${trendFullDate(from)} – ${trendFullDate(to)} (${fmtNum(days)} дн.${unit}) будут заново загружены через API WB и перезапишут сохранённые, в том числе дни, которые уже считались окончательными.</p><p>Запросов к WB: ${fmtNum(requests)}, ${eta}. Прогресс виден под графиком; загрузка идёт на сервере, страницу можно закрыть.</p><button class="primary" id="funnelRefetchRun">Перекачать</button>`
  );
  $('#funnelRefetchRun').onclick = async () => {
    const button = $('#funnelRefetchRun');
    button.disabled = true;
    try {
      const result = await api('/api/funnel/refetch', {
        method: 'POST',
        body: JSON.stringify({ cabinet: state.cabinet, from, to, grouping })
      });
      closeModal();
      toast(`Перекачка запущена: ${fmtNum(result.scheduled)} ${grouping === 'day' ? 'дн.' : grouping === 'week' ? 'нед.' : 'мес.'}`);
      loadFunnelDetails();
    } catch (e) {
      button.disabled = false;
      toast(e.message);
    }
  };
}
function funnelTrendPoints(days = [], period, grouping) {
  const byDate = new Map(days.map(day => [day.date, day])),
    buckets = [],
    index = new Map();
  for (let date = period.from; date <= period.to; date = trendShift(date, 1)) {
    const key = grouping === 'week' ? trendWeekStart(date) : grouping === 'month' ? date.slice(0, 7) : date;
    if (!index.has(key)) {
      const bucket = { key, from: date, to: date, total: 0, rows: [] };
      index.set(key, bucket);
      buckets.push(bucket);
    }
    const bucket = index.get(key);
    bucket.to = date;
    bucket.total++;
    if (byDate.has(date)) bucket.rows.push(byDate.get(date));
  }
  return buckets.map(bucket => {
    if (!bucket.rows.length) return { ...bucket, values: null };
    const sum = key => bucket.rows.reduce((total, row) => total + Number(row[key] || 0), 0);
    // Отмены — только если они есть у всех дней отрезка, иначе выкуп за отрезок посчитался бы неверно.
    const cancels = bucket.rows.every(row => row.cancelCount != null) ? sum('cancelCount') : null;
    const values = {
      openCount: sum('openCount'),
      cartCount: sum('cartCount'),
      orderCount: sum('orderCount'),
      orderSum: sum('orderSum'),
      buyoutCount: sum('buyoutCount'),
      buyoutSum: sum('buyoutSum'),
      addToWishlistCount: sum('addToWishlistCount'),
      cancelCount: cancels
    };
    return { ...bucket, values: funnelTrendDerived(values) };
  });
}
function funnelBucketPoint(range) {
  const total = datesBetweenTrend(range.from, range.to);
  if (!range.values) return { key: range.key || range.from, from: range.from, to: range.to, total, rows: [], values: null };
  const values = funnelTrendDerived({ ...range.values });
  return { key: range.key || range.from, from: range.from, to: range.to, total, rows: Array(total).fill(null), values };
}
function datesBetweenTrend(from, to) {
  let count = 0;
  for (let date = from; date <= to; date = trendShift(date, 1)) count++;
  return count;
}
function trendBucketLabel(bucket, grouping) {
  if (!bucket) return '';
  if (bucket.shifted)
    return bucket.from === bucket.to ? trendShortDate(bucket.from) : `${trendShortDate(bucket.from)}–${trendShortDate(bucket.to)}`;
  if (grouping === 'month') {
    const [year, month] = bucket.key.split('-');
    return `${TREND_MONTHS[Number(month) - 1]} ${year}`;
  }
  if (grouping === 'week')
    return bucket.from === bucket.to ? trendShortDate(bucket.from) : `${trendShortDate(bucket.from)}–${trendShortDate(bucket.to)}`;
  return trendShortDate(bucket.from);
}
function trendValue(metric, value) {
  if (value == null) return 'нет данных';
  if (metric.unit === '%') return `${(Math.round(value * 10) / 10).toLocaleString('ru-RU')}%`;
  if (metric.unit === '₽') return `${fmtNum(Math.round(value))} ₽`;
  return fmtNum(Math.round(value));
}
function trendAxisValue(metric, value) {
  return metric.unit === '₽' ? shortMoney(value) : metric.unit === '%' ? `${fmtNum(Math.round(value))}%` : fmtNum(Math.round(value));
}
function niceTrendMax(value) {
  if (!(value > 0)) return 4;
  const raw = value / 4,
    power = 10 ** Math.floor(Math.log10(raw)),
    step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(k => k * power).find(k => k >= raw);
  return step * 4;
}
// Плавная линия без выбросов за пределы соседних значений (монотонный кубический сплайн).
function trendSmoothPath(points) {
  const n = points.length,
    dx = [],
    slopes = [],
    tangents = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    slopes[i] = (points[i + 1].y - points[i].y) / dx[i];
  }
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) tangents[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slopes[i],
      b = tangents[i + 1] / slopes[i],
      s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tangents[i] = k * a * slopes[i];
      tangents[i + 1] = k * b * slopes[i];
    }
  }
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3;
    d += ` C${points[i].x + c},${points[i].y + tangents[i] * c} ${points[i + 1].x - c},${points[i + 1].y - tangents[i + 1] * c} ${points[i + 1].x},${points[i + 1].y}`;
  }
  return d;
}
function renderFunnelTrend() {
  const metricList = $('#funnelMetricList');
  if (!metricList) return;
  const metric = FUNNEL_TREND_METRICS.find(item => item.key === funnelTrend.metric) || FUNNEL_TREND_METRICS[0];
  metricList.innerHTML = FUNNEL_TREND_METRICS.map(
    item =>
      `<button type="button" class="funnel-metric ${item.key === metric.key ? 'active' : ''}" data-trend-metric="${item.key}">${item.label}</button>`
  ).join('');
  metricList.querySelectorAll('[data-trend-metric]').forEach(
    button =>
      (button.onclick = () => {
        funnelTrend.metric = button.dataset.trendMetric;
        renderFunnelTrend();
      })
  );
  $('#funnelCompare').checked = funnelTrend.compare;
  $('#funnelGrouping').value = funnelTrend.grouping;
  const chart = $('#funnelTrendChart'),
    legend = $('#funnelTrendLegend'),
    note = $('#funnelTrendNote'),
    data = funnelTrend.data;
  if (!data) {
    legend.innerHTML = '';
    note.textContent = '';
    chart.innerHTML = `<div class="chart-empty">${funnelTrend.error ? escapeHtml(funnelTrend.error) : 'Загрузка истории воронки…'}</div>`;
    return;
  }
  const currentPeriod = data.periods.current,
    previousPeriod = data.periods.previous,
    grouping = funnelTrend.grouping;
  legend.innerHTML =
    `<span><i class="legend-solid"></i>${trendFullDate(currentPeriod.from)} - ${trendFullDate(currentPeriod.to)}</span>` +
    (funnelTrend.compare
      ? `<span><i class="legend-dashed"></i>${trendFullDate(previousPeriod.from)} - ${trendFullDate(previousPeriod.to)}</span>`
      : '');
  const ranged = grouping !== 'day' && data.grouping === grouping;
  const current = ranged ? (data.buckets || []).map(funnelBucketPoint) : funnelTrendPoints(data.current, currentPeriod, grouping);
  const previous = !funnelTrend.compare
    ? []
    : ranged
      ? (data.buckets || []).map(bucket => ({ ...funnelBucketPoint(bucket.previous), shifted: true }))
      : funnelTrendPoints(data.previous, previousPeriod, grouping);
  const notes = [];
  if (!data.demo) {
    const earliest = funnelTrend.compare ? previousPeriod.from : currentPeriod.from;
    const eta = seconds => (seconds >= 60 ? `${Math.ceil(seconds / 60)} мин` : `${Math.max(1, seconds)} сек`);
    if (data.sync?.pending)
      notes.push(
        `Загружаем из WB: осталось ${fmtNum(data.sync.pending)} ${grouping === 'week' ? 'нед.' : grouping === 'month' ? 'мес.' : 'дн.'}, примерно ${eta(data.sync.etaSeconds)}. WB разрешает 3 запроса в минуту, график дорисуется сам.`
      );
    if (data.sync?.lastError) notes.push(`Часть дней не загрузилась: ${data.sync.lastError}. Повторим позже.`);
    if (data.earliestAvailable && earliest < data.earliestAvailable)
      notes.push(`WB отдаёт воронку не раньше ${trendFullDate(data.earliestAvailable)}.`);
  }
  if (data.filtered) {
    const ids = funnelTrend.nmIds || [];
    const one =
      ids.length === 1 ? (state.funnelProducts || []).map(item => item.product || item).find(p => String(p.nmId) === ids[0]) : null;
    notes.unshift(
      ids.length
        ? one
          ? `График по артикулу ${one.vendorCode || one.nmId} (${one.nmId}).`
          : `График по ${fmtNum(ids.length)} ${pluralRu(ids.length, ['товару', 'товарам', 'товарам'])} из фильтров.`
        : 'Под фильтры не попал ни один товар.'
    );
  }
  if (funnelTrend.error) notes.push(`Не удалось обновить: ${funnelTrend.error}`);
  if (funnelTrend.loading) notes.push('Обновляем…');
  note.textContent = notes.join(' ');
  if (!current.some(point => point.values) && !previous.some(point => point.values)) {
    chart.innerHTML = '<div class="chart-empty">Нет сохранённых данных за выбранный период</div>';
    return;
  }
  const w = 900,
    h = 300,
    left = 14,
    right = 62,
    top = 24,
    bottom = 34,
    plotW = w - left - right,
    plotH = h - top - bottom,
    count = current.length;
  const x = i => left + (count <= 1 ? plotW / 2 : (i * plotW) / (count - 1));
  // Пустое значение показателя (выкуп без данных об отменах) — разрыв линии, а не ноль.
  const valuesOf = list => list.map(point => (point.values && point.values[metric.key] != null ? Number(point.values[metric.key]) : null));
  const currentValues = valuesOf(current),
    previousValues = valuesOf(previous).slice(0, count);
  // Отмены сервер хранит с 14.11.2026: у дней, скачанных раньше, выкупа нет, пока они не перекачаются из WB.
  if (
    metric.key === 'buyoutPercent' &&
    [...current, ...previous].some(point => point.values && point.values.buyoutPercent == null && point.values.buyoutCount)
  ) {
    notes.push(
      'Выкуп, % считается как у WB: выкупы ÷ (выкупы + отмены и возвраты). Отмены сайт сохраняет с 14.11.2026: дни за последнюю неделю дозагрузятся сами в течение часа, более ранние — кнопкой «Перекачать».'
    );
    note.textContent = notes.join(' ');
  }
  const max = niceTrendMax(Math.max(0, ...currentValues.filter(value => value != null), ...previousValues.filter(value => value != null)));
  const y = value => top + plotH - (value / max) * plotH;
  const segments = values => {
    const parts = [];
    let part = [];
    values.forEach((value, i) => {
      if (value == null) {
        if (part.length) parts.push(part);
        part = [];
        return;
      }
      part.push({ x: x(i), y: y(value) });
    });
    if (part.length) parts.push(part);
    return parts;
  };
  const lines = (values, kind) =>
    segments(values)
      .map(points =>
        points.length === 1
          ? `<circle class="trend-dot ${kind}" cx="${points[0].x}" cy="${points[0].y}" r="3.5"/>`
          : `<path class="trend-line ${kind}" d="${trendSmoothPath(points)}"/>`
      )
      .join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map(
      ratio =>
        `<line class="trend-grid" x1="${left}" x2="${w - right}" y1="${y(max * ratio)}" y2="${y(max * ratio)}"/><text class="trend-axis" x="${w - right + 10}" y="${y(max * ratio) + 4}">${trendAxisValue(metric, max * ratio)}</text>`
    )
    .join('');
  const verticals = current
    .map((point, i) => `<line class="trend-grid" x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${top + plotH}"/>`)
    .join('');
  const labelStep = Math.max(1, Math.ceil(count / (grouping === 'week' ? 5 : 8)));
  const labels = current
    .map((point, i) =>
      i % labelStep === 0 || i === count - 1
        ? `<text class="trend-axis" x="${x(i)}" y="${h - 10}" text-anchor="${count > 1 && i === 0 ? 'start' : count > 1 && i === count - 1 ? 'end' : 'middle'}">${trendBucketLabel(point, grouping)}</text>`
        : ''
    )
    .join('');
  chart.innerHTML =
    `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(metric.label)}">${verticals}${ticks}<text class="trend-axis" x="${w - right + 10}" y="${top - 10}">${metric.unit}</text>${labels}${lines(previousValues, 'previous')}${lines(currentValues, 'current')}` +
    `<g class="trend-hover hidden"><line class="hover-line" y1="${top}" y2="${top + plotH}"/><circle class="trend-hover-point previous" r="4.5"/><circle class="trend-hover-point current" r="5"/></g><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/></svg><div class="chart-tooltip hidden"></div>`;
  const svg = chart.querySelector('svg'),
    tip = chart.querySelector('.chart-tooltip'),
    hover = svg.querySelector('.trend-hover');
  const partial = bucket =>
    bucket?.values && bucket.rows.length < bucket.total ? ` (есть ${bucket.rows.length} из ${bucket.total} дн.)` : '';
  svg.onpointermove = event => {
    const rect = svg.getBoundingClientRect(),
      vx = ((event.clientX - rect.left) / rect.width) * w;
    let index = 0,
      best = Infinity;
    current.forEach((point, i) => {
      const distance = Math.abs(x(i) - vx);
      if (distance < best) {
        best = distance;
        index = i;
      }
    });
    const cv = currentValues[index],
      pv = previousValues[index];
    hover.classList.remove('hidden');
    const line = hover.querySelector('line');
    line.setAttribute('x1', x(index));
    line.setAttribute('x2', x(index));
    [
      ['current', cv],
      ['previous', funnelTrend.compare ? pv : null]
    ].forEach(([kind, value]) => {
      const dot = hover.querySelector(`.trend-hover-point.${kind}`);
      dot.style.display = value == null ? 'none' : '';
      if (value != null) {
        dot.setAttribute('cx', x(index));
        dot.setAttribute('cy', y(value));
      }
    });
    tip.innerHTML =
      `<strong>${escapeHtml(metric.label)}</strong><span style="--dot:var(--purple)"><i></i>${trendBucketLabel(current[index], grouping)}${partial(current[index])}<b>${trendValue(metric, cv)}</b></span>` +
      (funnelTrend.compare && previous[index]
        ? `<span style="--dot:#a78bfa"><i></i>${trendBucketLabel(previous[index], grouping)}${partial(previous[index])}<b>${trendValue(metric, pv)}</b></span>`
        : '');
    tip.classList.remove('hidden');
    // Подсказка лежит внутри прокручиваемого блока графика, поэтому координата считается от его левого края с учётом прокрутки.
    const chartRect = chart.getBoundingClientRect(),
      px = rect.left - chartRect.left + chart.scrollLeft + (x(index) / w) * rect.width,
      half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(px, chart.scrollLeft + half + 6), chart.scrollLeft + chart.clientWidth - half - 6)}px`;
    const highest = Math.min(...[cv, funnelTrend.compare ? pv : null].filter(value => value != null).map(value => y(value)), top + plotH);
    const pointTop = rect.top - chartRect.top + (highest / h) * rect.height;
    tip.style.top = `${pointTop < tip.offsetHeight + 34 ? Math.min(pointTop + 16, chart.clientHeight - tip.offsetHeight - 4) : 24}px`;
  };
  svg.onpointerleave = () => {
    hover.classList.add('hidden');
    tip.classList.add('hidden');
  };
}
document.addEventListener('change', event => {
  if (event.target.id === 'funnelCompare') {
    funnelTrend.compare = event.target.checked;
    renderFunnelTrend();
  }
  if (event.target.id === 'funnelGrouping') {
    funnelTrend.grouping = event.target.value;
    funnelTrend.data = null;
    loadFunnelTrend();
  }
});

// --- Таблица «Товары в воронке»: фильтры, столбцы этапов и пагинация ---
// Показатели воронки одного периода (выбранного или прошлого) в едином виде.
// «% выкупа» у WB — выкупы ÷ (выкупы + отмены), а не выкупы ÷ заказы; так же считается и итог.
function funnelStatValues(s = {}) {
  const c = s.conversions || {},
    n = key => Number(s[key] || 0);
  return {
    openCount: n('openCount'),
    cartCount: n('cartCount'),
    orderCount: n('orderCount'),
    orderSum: n('orderSum'),
    buyoutCount: n('buyoutCount'),
    buyoutSum: n('buyoutSum'),
    cancelCount: n('cancelCount'),
    addToWishlist: Number(s.addToWishlist ?? s.addToWishlistCount ?? 0),
    addToCartPercent: Number(c.addToCartPercent ?? s.addToCartConversion ?? 0),
    cartToOrderPercent: Number(c.cartToOrderPercent ?? s.cartToOrderConversion ?? 0),
    buyoutPercent: Number(c.buyoutPercent ?? s.buyoutPercent ?? 0)
  };
}
const FUNNEL_SUM_KEYS = ['openCount', 'cartCount', 'orderCount', 'orderSum', 'buyoutCount', 'buyoutSum', 'cancelCount', 'addToWishlist'];
function funnelTotalValues(list) {
  const t = Object.fromEntries(FUNNEL_SUM_KEYS.map(key => [key, list.reduce((sum, item) => sum + Number(item[key] || 0), 0)]));
  return {
    ...t,
    addToCartPercent: t.openCount ? (t.cartCount / t.openCount) * 100 : 0,
    cartToOrderPercent: t.cartCount ? (t.orderCount / t.cartCount) * 100 : 0,
    buyoutPercent: t.buyoutCount + t.cancelCount ? (t.buyoutCount / (t.buyoutCount + t.cancelCount)) * 100 : 0
  };
}
// Изменение к прошлому периоду той же длины — в процентах от прошлого значения, как в кабинете WB (и для конверсий тоже).
function funnelDelta(value, previous) {
  if (previous == null) return '';
  if (!previous) return value ? '<small class="sales-delta up">новое</small>' : '';
  const change = Math.round(((value - previous) / previous) * 100);
  if (!change) return '<small class="sales-delta flat">0%</small>';
  return `<small class="sales-delta ${change > 0 ? 'up' : 'down'}">${change > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(change))}%</small>`;
}
function funnelProductRows() {
  const f = state.funnelFilters;
  return (state.funnelProducts || [])
    .map(item => {
      const p = item.product || item,
        s = item.statistic?.selected || item.history?.[0] || item,
        past = item.statistic?.past,
        stocks = p.stocks || {};
      return {
        ...p,
        ...s,
        ...funnelStatValues(s),
        past: past ? funnelStatValues(past) : null,
        title: p.title || p.name || `Товар ${p.nmId}`,
        vendorCode: p.vendorCode || '',
        subjectName: p.subjectName || 'Без категории',
        nmId: p.nmId,
        stock: Number(stocks.wb || 0) + Number(stocks.mp || 0)
      };
    })
    .filter(
      row =>
        (!f.categories.size || f.categories.has(row.subjectName)) &&
        (!f.articles.size || f.articles.has(String(row.nmId))) &&
        (!f.availability.size || (f.availability.has('positive') && row.stock > 0) || (f.availability.has('zero') && row.stock === 0))
    )
    .sort((a, b) => {
      const key = state.funnelSort.key,
        av = a[key] ?? 0,
        bv = b[key] ?? 0,
        result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru', { numeric: true });
      return state.funnelSort.dir === 'asc' ? result : -result;
    });
}
function renderFunnelDetails() {
  const all = state.funnelProducts || [],
    rows = funnelProductRows(),
    f = state.funnelFilters;
  const categories = [...new Set(all.map(item => (item.product || item).subjectName || 'Без категории'))].sort((a, b) =>
    a.localeCompare(b, 'ru')
  );
  $('#funnelCategoryOptions').innerHTML =
    categories.map(category => `<label><input type="checkbox" value="${escapeHtml(category)}"> ${escapeHtml(category)}</label>`).join('') ||
    '<span class="filter-empty">Нет вариантов</span>';
  $$('#funnelCategoryOptions input').forEach(input => {
    input.checked = f.categories.has(input.value);
    input.onchange = () => {
      input.checked ? f.categories.add(input.value) : f.categories.delete(input.value);
      state.funnelPage = 1;
      renderFunnelDetails();
      scheduleFunnelTrendReload();
    };
  });
  $('#funnelCategoryLabel').textContent = f.categories.size ? `Категории (${f.categories.size})` : 'Категории';
  $$('#funnelAvailabilityOptions input').forEach(input => {
    input.checked = f.availability.has(input.value);
    input.onchange = () => {
      input.checked ? f.availability.add(input.value) : f.availability.delete(input.value);
      state.funnelPage = 1;
      renderFunnelDetails();
      scheduleFunnelTrendReload();
    };
  });
  $('#funnelAvailabilityLabel').textContent = f.availability.size ? `Наличие (${f.availability.size})` : 'Наличие';
  $('#funnelArticleLabel').textContent = f.articles.size ? `Артикулы (${f.articles.size})` : 'Артикулы';
  const table = state.funnelTable || {},
    progress = !table.done
      ? ` · загружено ${fmtNum(table.loaded || all.length)}, догружается…`
      : table.refreshing
        ? ' · обновляется…'
        : table.photosPending
          ? ' · загружаются фото…'
          : '';
  $('#funnelProductCount').textContent = `${fmtNum(rows.length)} из ${fmtNum(all.length)} товаров${progress}`;
  if (all.length) {
    state.funnel = rows.reduce(
      (sum, row) => ({
        views: sum.views + Number(row.openCount || 0),
        cart: sum.cart + Number(row.cartCount || 0),
        orders: sum.orders + Number(row.orderCount || 0),
        sales: sum.sales + Number(row.buyoutCount || 0),
        revenue: sum.revenue + Number(row.buyoutSum || 0)
      }),
      { views: 0, cart: 0, orders: 0, sales: 0, revenue: 0 }
    );
    renderFunnel();
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / state.funnelPageSize));
  state.funnelPage = Math.min(Math.max(1, state.funnelPage), pageCount);
  const pageRows = rows.slice((state.funnelPage - 1) * state.funnelPageSize, state.funnelPage * state.funnelPageSize);
  // Столбцы показателей: значение и под ним изменение к прошлому периоду.
  const metrics = [
    ['openCount', fmtNum],
    ['cartCount', fmtNum],
    ['addToCartPercent', fmtPercent],
    ['addToWishlist', fmtNum],
    ['orderCount', fmtNum],
    ['cartToOrderPercent', fmtPercent],
    ['orderSum', fmtRub],
    ['buyoutCount', fmtNum],
    ['buyoutSum', fmtRub],
    ['buyoutPercent', fmtPercent]
  ];
  const cells = (values, past) =>
    metrics.map(([key, format]) => `<td>${format(values[key])}${funnelDelta(values[key], past ? past[key] : null)}</td>`).join('');
  const total = funnelTotalValues(rows),
    totalPast = rows.some(row => row.past) ? funnelTotalValues(rows.map(row => row.past || {})) : null;
  const previous = state.funnelPeriods?.previous;
  const totalRow = rows.length
    ? `<tr class="funnel-total-row"><td><strong>Итого по товарам</strong>${previous ? `<small>к ${trendFullDate(previous.from)} – ${trendFullDate(previous.to)}</small>` : ''}</td><td></td><td></td><td></td>${cells(total, totalPast)}</tr>`
    : '';
  // Квадрат со стрелкой слева от товара — детализация товара (product.html) в новой вкладке за тот же период.
  const productLink = row =>
    `<a class="campaign-open funnel-product-open" href="/product.html?${new URLSearchParams({ cabinet: state.cabinet, nmId: row.nmId, from: $('#dateFrom').value, to: $('#dateTo').value })}" target="_blank" rel="noopener noreferrer" title="Открыть детализацию товара: органика и реклама по дням" aria-label="Открыть детализацию товара «${escapeHtml(row.title)}»"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3"/><path d="M6.25 9.75l3.5-3.5M6.75 6.25h3v3"/></svg></a>`;
  $('#funnelProductsBody').innerHTML =
    totalRow +
    (pageRows
      .map(
        row =>
          `<tr><td class="funnel-product-cell"><div class="funnel-product-name">${row.nmId ? productLink(row) : ''}${row.photo ? `<img class="stock-product-photo" src="${escapeHtml(row.photo)}" alt="" loading="lazy">` : ''}<strong>${escapeHtml(row.title)}</strong></div></td>` +
          `<td>${escapeHtml(row.vendorCode || '—')}</td><td>${escapeHtml(row.nmId || '—')}</td><td>${escapeHtml(row.subjectName)}</td>${cells(row, row.past)}</tr>`
      )
      .join('') ||
      `<tr><td colspan="14" class="empty-row">${all.length ? 'Нет товаров по выбранным фильтрам' : 'Нет данных по товарам за период'}</td></tr>`);
  renderFunnelPagination(pageCount, rows.length);
  $$('#funnelProductsBody .stock-product-photo').forEach(image => {
    if (image.dataset.previewBound) return;
    image.dataset.previewBound = '1';
    bindPhotoPreview(image);
  });
  $$('[data-funnel-sort]').forEach(
    header =>
      (header.onclick = () => {
        const key = header.dataset.funnelSort;
        state.funnelSort =
          state.funnelSort.key === key ? { key, dir: state.funnelSort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' };
        state.funnelPage = 1;
        renderFunnelDetails();
      })
  );
}
function renderFunnelPagination(pageCount, total) {
  renderPager($('#funnelPagination'), {
    page: state.funnelPage,
    pageCount,
    total,
    sizeKey: 'funnel',
    onPage: page => {
      state.funnelPage = page;
      renderFunnelDetails();
      document.querySelector('.funnel-products-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    onSize: size => {
      state.funnelPageSize = size;
      state.funnelPage = 1;
      renderFunnelDetails();
    }
  });
}
let funnelArticleTip = null;
function hideFunnelArticleTip() {
  funnelArticleTip?.remove();
  funnelArticleTip = null;
}
function renderFunnelArticleOptions() {
  const box = $('#funnelArticleOptions');
  if (!box) return;
  const term = ($('#funnelArticleSearch')?.value || '').trim().toLowerCase(),
    selected = state.funnelFilters.articles;
  const items = [
    ...new Map(
      (state.funnelProducts || []).map(item => {
        const p = item.product || item;
        return [String(p.nmId), { nmId: String(p.nmId), vendorCode: p.vendorCode || '', title: p.title || '' }];
      })
    ).values()
  ].sort((a, b) => String(a.vendorCode || a.title).localeCompare(String(b.vendorCode || b.title), 'ru', { numeric: true }));
  const found = term ? items.filter(item => `${item.vendorCode} ${item.nmId} ${item.title}`.toLowerCase().includes(term)) : items;
  box.innerHTML =
    found
      .map(
        item =>
          `<label class="article-option" data-tip="${escapeHtml(`${item.vendorCode || item.title} · ${item.nmId}`)}"><input type="checkbox" value="${escapeHtml(item.nmId)}" ${selected.has(item.nmId) ? 'checked' : ''}><span><b>${escapeHtml(item.vendorCode || item.title || 'Без артикула')}</b><small>${escapeHtml(item.nmId)}</small></span></label>`
      )
      .join('') || `<span class="filter-empty">${items.length ? 'Ничего не найдено' : 'Товары ещё не загружены'}</span>`;
  box.querySelectorAll('.article-option').forEach(label => {
    label.onmouseenter = () => {
      hideFunnelArticleTip();
      const tip = document.createElement('div');
      tip.className = 'article-tip';
      tip.textContent = label.dataset.tip;
      document.body.append(tip);
      const rect = label.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - tip.offsetWidth - 8))}px`;
      tip.style.top = `${Math.max(8, rect.top - tip.offsetHeight - 2)}px`;
      funnelArticleTip = tip;
    };
    label.onmouseleave = hideFunnelArticleTip;
  });
  box.querySelectorAll('input').forEach(
    input =>
      (input.onchange = () => {
        input.checked ? selected.add(input.value) : selected.delete(input.value);
        state.funnelPage = 1;
        updateFunnelArticleSummary();
        renderFunnelDetails();
        scheduleFunnelTrendReload();
      })
  );
  box.onscroll = hideFunnelArticleTip;
  updateFunnelArticleSummary();
}
function updateFunnelArticleSummary() {
  const size = state.funnelFilters.articles.size;
  const el = $('#funnelArticleSelected');
  if (el) el.textContent = size ? `Выбрано: ${fmtNum(size)}` : 'Все артикулы';
  $('#funnelArticleReset').disabled = !size;
}
document.addEventListener('input', event => {
  if (event.target.id === 'funnelArticleSearch') renderFunnelArticleOptions();
});
document.addEventListener('click', event => {
  if (event.target.id === 'funnelArticleReset') {
    state.funnelFilters.articles.clear();
    state.funnelPage = 1;
    renderFunnelArticleOptions();
    renderFunnelDetails();
    scheduleFunnelTrendReload();
  }
  if (!event.target.closest('.article-filter')) hideFunnelArticleTip();
});

// --- Вкладка «Продажи по дням» ---
const FUNNEL_SALES_METRICS = [
  { key: 'orderCount', label: 'Заказы, шт', unit: 'шт' },
  { key: 'orderSum', label: 'Заказы, ₽', unit: '₽' },
  { key: 'buyoutCount', label: 'Выкупы, шт', unit: 'шт' },
  { key: 'buyoutSum', label: 'Выкупы, ₽', unit: '₽' },
  { key: 'cartCount', label: 'Корзины', unit: 'шт' },
  { key: 'openCount', label: 'Переходы', unit: 'шт' }
];
const funnelSales = { data: null, metric: 'orderCount', page: 1, loading: false, error: '', pollTimer: 0, requestId: 0 };
function funnelSalesMetric() {
  return FUNNEL_SALES_METRICS.find(item => item.key === funnelSales.metric) || FUNNEL_SALES_METRICS[0];
}
function funnelSalesValue(value) {
  if (value == null) return '—';
  return funnelSalesMetric().unit === '₽' ? fmtRub(value) : fmtNum(value);
}
function funnelSalesDelta(value, previous) {
  if (value == null || previous == null) return '';
  if (!previous) return value ? '<small class="sales-delta up">новое</small>' : '';
  const change = Math.round(((value - previous) / previous) * 1000) / 10;
  if (!change) return '<small class="sales-delta flat">0%</small>';
  return `<small class="sales-delta ${change > 0 ? 'up' : 'down'}">${change > 0 ? '+' : '−'}${fmtNum(Math.abs(change))}%</small>`;
}
function switchFunnelTab(tab) {
  state.funnelTab = tab;
  $$('[data-funnel-tab]').forEach(button => button.classList.toggle('active', button.dataset.funnelTab === tab));
  $('.funnel-products-panel').classList.toggle('hidden', tab !== 'products');
  $('#funnelSalesPanel').classList.toggle('hidden', tab !== 'sales');
  if (tab === 'sales' && !funnelSales.data && !funnelSales.loading) loadFunnelSales();
}
async function loadFunnelSales() {
  const cabinet = state.cabinet,
    from = $('#dateFrom').value,
    to = $('#dateTo').value,
    request = ++funnelSales.requestId;
  clearTimeout(funnelSales.pollTimer);
  funnelSales.loading = true;
  funnelSales.error = '';
  renderFunnelSales();
  try {
    const nmIds = funnelProductRows().map(row => String(row.nmId));
    const data = await api('/api/funnel/sales', {
      method: 'POST',
      body: JSON.stringify({ cabinet, from, to, metric: funnelSales.metric, nmIds })
    });
    if (request !== funnelSales.requestId || cabinet !== state.cabinet) return;
    funnelSales.data = data;
    if (data.sync?.pending)
      funnelSales.pollTimer = setTimeout(() => {
        if (request === funnelSales.requestId && state.activePage === 'funnel' && state.funnelTab === 'sales') loadFunnelSales();
      }, 5000);
  } catch (e) {
    funnelSales.error = e.message;
  } finally {
    if (request === funnelSales.requestId) {
      funnelSales.loading = false;
      renderFunnelSales();
    }
  }
}
function renderFunnelSales() {
  const head = $('#funnelSalesHead'),
    body = $('#funnelSalesBody'),
    count = $('#funnelSalesCount');
  if (!head) return;
  $('#funnelSalesMetric').innerHTML = FUNNEL_SALES_METRICS.map(
    item => `<option value="${item.key}" ${item.key === funnelSales.metric ? 'selected' : ''}>${escapeHtml(item.label)}</option>`
  ).join('');
  const data = funnelSales.data;
  if (!data) {
    head.innerHTML = '';
    body.innerHTML = '';
    count.textContent = funnelSales.error ? `Ошибка: ${funnelSales.error}` : 'Загрузка продаж по дням…';
    return;
  }
  // Дни идут от свежих к старым, проценты сравнивают день с предыдущим.
  const order = data.dates.map((date, index) => index).reverse();
  const byNmId = new Map(
    (state.funnelProducts || []).map(item => {
      const p = item.product || item;
      return [String(p.nmId), p];
    })
  );
  const rows = data.products.map(product => ({ ...product, meta: byNmId.get(String(product.nmId)) || {} }));
  const pageCount = Math.max(1, Math.ceil(rows.length / state.funnelSalesPageSize));
  funnelSales.page = Math.min(Math.max(1, funnelSales.page), pageCount);
  const pageRows = rows.slice((funnelSales.page - 1) * state.funnelSalesPageSize, funnelSales.page * state.funnelSalesPageSize);
  const notes = [`${fmtNum(rows.length)} товаров`, `дней: ${fmtNum(data.dates.length)}`];
  if (data.sync?.pending) notes.push(`догружаем дни: осталось ${fmtNum(data.sync.pending)}`);
  if (funnelSales.loading) notes.push('обновляем…');
  if (funnelSales.error) notes.push(`ошибка: ${funnelSales.error}`);
  (data.warnings || []).forEach(text => notes.push(text));
  count.textContent = notes.join(' · ');
  // У столбцов фиксированная ширина: при длинном периоде таблица листается вбок, а не сжимает дни до нечитаемых.
  // Все дни делят одну ширину (ключ day): тянете один столбец дня — после перерисовки такими станут все.
  const dayWidth = funnelSalesMetric().unit === '₽' ? 108 : 84;
  head.innerHTML =
    `<th data-col-key="product" data-col-width="260">Товар</th><th data-col-key="vendorCode" data-col-width="140" title="Артикул продавца">Арт. продавца</th><th data-col-key="nmId" data-col-width="110" title="Артикул WB">Арт. WB</th><th data-col-key="total" data-col-width="${dayWidth + 16}">Итого</th>` +
    order
      .map(index => `<th data-col-key="day" data-col-width="${dayWidth}">${escapeHtml(formatShortDate(data.dates[index]))}</th>`)
      .join('');
  const table = head.closest('table');
  table.dataset.widthKey = 'funnelSales';
  initColumnWidths(table);
  const cell = (values, index) =>
    `<td>${funnelSalesValue(values[index])}${funnelSalesDelta(values[index], index > 0 ? values[index - 1] : null)}</td>`;
  const totalsRow =
    `<tr class="sales-total-row"><td><strong>Итого</strong></td><td>—</td><td>—</td><td><strong>${funnelSalesValue(data.total)}</strong></td>` +
    order.map(index => cell(data.totals, index)).join('') +
    '</tr>';
  body.innerHTML = rows.length
    ? totalsRow +
      pageRows
        .map(
          row =>
            `<tr><td class="funnel-product-cell">${row.meta.photo ? `<img class="stock-product-photo" src="${escapeHtml(row.meta.photo)}" alt="" loading="lazy">` : ''}<strong>${escapeHtml(row.meta.title || `Товар ${row.nmId}`)}</strong></td>` +
            `<td>${escapeHtml(row.meta.vendorCode || '—')}</td><td>${escapeHtml(row.nmId)}</td><td><strong>${funnelSalesValue(row.total)}</strong></td>` +
            order.map(index => cell(row.values, index)).join('') +
            '</tr>'
        )
        .join('')
    : `<tr><td colspan="${4 + data.dates.length}" class="empty-row">Нет данных за выбранный период</td></tr>`;
  renderFunnelSalesPagination(pageCount, rows.length);
  $$('#funnelSalesBody .stock-product-photo').forEach(image => {
    if (image.dataset.previewBound) return;
    image.dataset.previewBound = '1';
    bindPhotoPreview(image);
  });
}
function renderFunnelSalesPagination(pageCount, total) {
  renderPager($('#funnelSalesPagination'), {
    page: funnelSales.page,
    pageCount,
    total,
    sizeKey: 'funnel-sales',
    onPage: page => {
      funnelSales.page = page;
      renderFunnelSales();
    },
    onSize: size => {
      state.funnelSalesPageSize = size;
      funnelSales.page = 1;
      renderFunnelSales();
    }
  });
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-funnel-tab]');
  if (button) switchFunnelTab(button.dataset.funnelTab);
});
document.addEventListener('change', event => {
  if (event.target.id === 'funnelSalesMetric') {
    funnelSales.metric = event.target.value;
    funnelSales.page = 1;
    loadFunnelSales();
  }
});
