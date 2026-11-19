'use strict';
// --- Детализация кампании: график по датам, флажки изменений, запуск и остановка ---

// --- «График по датам» — как вариант 2 «Фокус при наведении» (public/charts-lab.html) ---
// Легенда — кнопки: наведение выделяет линию (остальные гаснут), клик скрывает или показывает её. На графике выделяется
// линия, ближайшая к курсору; в подсказке — все линии дня, выделенная ярче. Справа у линий — подпись с последним значением.
// Над графиком — флажки изменений кампании из Google Таблицы (chartEvents ниже).
const CARD_COLORS = ['#b35b45', '#5a7d9a', '#8b6b3f', '#277a70', '#d77b28'];
function chartSeries() {
  const cards = [...new Map(state.productDaily.map(r => [String(r.nmId), r])).values()];
  return [
    ...chartMetrics.map(m => ({ ...m, hidden: !state.visibleMetrics.has(m.key) })),
    ...cards.map((c, i) => ({
      key: `card:${c.nmId}`,
      label: `Артикул ${c.nmId}`,
      color: CARD_COLORS[i % CARD_COLORS.length],
      card: c.nmId,
      hidden: !state.visibleCards.has(String(c.nmId))
    }))
  ];
}
function renderOptions() {
  $('#chartOptions').innerHTML = chartSeries()
    .map(
      s =>
        `<button type="button" class="chart-legend-item" data-series="${esc(s.key)}" aria-pressed="${!s.hidden}" title="${s.card ? 'Затраты по артикулу. ' : ''}Наведите — линия выделится, нажмите — скрыть или показать"><i style="background:${s.color}"></i>${esc(s.label)}</button>`
    )
    .join('');
}
$('#chartOptions').addEventListener('click', event => {
  const item = event.target.closest('[data-series]');
  if (!item) return;
  const key = item.dataset.series,
    set = key.startsWith('card:') ? state.visibleCards : state.visibleMetrics,
    id = key.startsWith('card:') ? key.slice(5) : key;
  set.has(id) ? set.delete(id) : set.add(id);
  item.setAttribute('aria-pressed', String(set.has(id)));
  renderChart();
  setChartFocus(set.has(id) ? key : null);
});
$('#chartOptions').addEventListener('pointerover', event => {
  const item = event.target.closest('[data-series]');
  setChartFocus(item && item.getAttribute('aria-pressed') === 'true' ? item.dataset.series : null);
});
$('#chartOptions').addEventListener('pointerleave', () => setChartFocus(null));
$('#chartOptions').addEventListener('focusin', event => {
  const item = event.target.closest('[data-series]');
  if (item) setChartFocus(item.dataset.series);
});
$('#chartOptions').addEventListener('focusout', () => setChartFocus(null));
function setChartFocus(key) {
  const wrap = $('.chart-wrap');
  wrap.classList.toggle('has-focus', Boolean(key));
  wrap.querySelectorAll('[data-series]').forEach(node => node.classList.toggle('is-focus', node.dataset.series === key));
  $('#chartOptions')
    .querySelectorAll('[data-series]')
    .forEach(node => node.classList.toggle('is-focus', node.dataset.series === key));
}
// Линии разных порядков (показы — тысячи, заказы — единицы) делятся на группы по величине: внутри группы максимумы
// отличаются меньше чем в 10 раз, и у группы общая шкала. Первая группа — левая ось, вторая — правая; остальные
// рисуются каждая со своей шкалой без оси, их значения видны в подсказке и в пометке под графиком.
const CHART_GROUP_RATIO = 10;
function chartNiceMax(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value)),
    step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(k => k * power >= value);
  return step * power;
}
function chartAxisNumber(value) {
  return Math.abs(value) >= 10000
    ? new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : number(value);
}
function chartGroups(series, maxOf) {
  const groups = [];
  for (const s of [...series].sort((a, b) => maxOf(b) - maxOf(a))) {
    const group = groups[groups.length - 1];
    if (group && maxOf(s) * CHART_GROUP_RATIO >= group.top) group.series.push(s);
    else groups.push({ top: maxOf(s), series: [s] });
  }
  return groups.map(group => ({ ...group, max: chartNiceMax(group.top) }));
}
// --- Флажки: изменения кампании из Google Таблицы ---
// «Реклама» — статус, название, места показа, состав товаров; «Ставки» — ставки товаров; «Ключевые слова» — минус-фразы;
// «Цены» — цены товаров кампании (цена до скидки, скидка, цена со скидкой; клубная — если отличается от цены со скидкой).
// Изменения одного вида за день — один флажок; день — по Москве, как дни статистики WB. Наведение — подробности.
const sheetEvents = { campaign: [], prices: [], since: null, loaded: false, key: '' };
// «Запуск и остановка» — цветом кампании, как флажки кампаний в детализации товара (первый цвет CAMPAIGN_COLORS в product.js).
const EVENT_KINDS = {
  activity: { color: '#7651e5', label: 'Запуск и остановка' },
  settings: { color: '#58716e', label: 'Настройки кампании' },
  bids: { color: '#d77b28', label: 'Ставки' },
  minus: { color: '#b5367f', label: 'Минус-фразы' },
  prices: { color: '#17211d', label: 'Цены товаров' }
};
const STATUS_WHATS = ['Статус', 'Появилось в списке', 'Пропало из списка'];
const EVENT_ORDER = Object.keys(EVENT_KINDS);
const PRICE_WHATS = ['Цена до скидки, ₽', 'Скидка продавца, %', 'Цена со скидкой, ₽', 'Цена в WB Клубе, ₽'];
const SETTING_LABELS = { Название: '✎ Название', 'Где показывается': '◎ Зоны показа', 'Артикулы WB': '▤ Товары' };
const mskDay = iso => {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time + 3 * 3_600_000).toISOString().slice(0, 10) : '';
};
const dayOf = row => String(row.date || '').slice(0, 10);
// Товары кампании — из статистики по артикулам и из настроек (ставки); WB отдаёт историю цен до 50 артикулов за запрос.
function loadChartEvents() {
  if (!window.SheetSync) return;
  const id = params.get('id') || '',
    nmIds = [...new Set([...state.productDaily.map(row => String(row.nmId)), ...(state.setupProducts?.keys() || [])])]
      .filter(value => /^\d+$/.test(value))
      .slice(0, 50),
    key = `${id}|${nmIds.join(',')}`;
  if (sheetEvents.key === key) return;
  Object.assign(sheetEvents, { key, campaign: [], prices: [], loaded: false });
  SheetSync.load(`/api/sheet-history?${new URLSearchParams({ id, sections: 'Реклама,Ставки,Ключевые слова' })}`, data => {
    if (sheetEvents.key !== key || !data?.configured) return;
    Object.assign(sheetEvents, { campaign: data.items || [], since: data.since || null, loaded: true });
    renderChart();
  });
  if (nmIds.length)
    SheetSync.load(`/api/sheet-history?${new URLSearchParams({ id: nmIds.join(','), sections: 'Цены' })}`, data => {
      if (sheetEvents.key !== key || !data?.configured) return;
      sheetEvents.prices = data.items || [];
      renderChart();
    });
}
const sheetValue = (item, value) => {
  if (value === '' || value == null || value === '—') return item.section === 'Ставки' ? 'выкл.' : '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value).length > 60 ? `${String(value).slice(0, 57)}…` : String(value);
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}${/₽/.test(item.what || '') ? ' ₽' : /%/.test(item.what || '') ? '%' : ''}`;
};
const shortValue = value => {
  const n = Number(value);
  return value === '' || value == null || value === '—'
    ? 'выкл.'
    : Number.isFinite(n)
      ? Math.round(n).toLocaleString('ru-RU')
      : String(value);
};
function productLabel(nmId) {
  const product = state.setupProducts?.get(String(nmId)) || state.productDaily.find(row => String(row.nmId) === String(nmId));
  return product?.vendorCode || product?.name || `арт. ${nmId}`;
}
function eventLine(item) {
  const what = String(item.what || '').replace(/, (₽|%)$/, ''),
    change = `${sheetValue(item, item.before)} → ${sheetValue(item, item.after)}`;
  const product = String(item.title || '')
    .split(' · ')
    .slice(1)
    .join(' · ');
  if (item.section === 'Ставки') return `${what}${product ? ` · ${product}` : ''}: ${change}`;
  if (item.section === 'Ключевые слова') {
    const text = what.length > 140 ? `${what.slice(0, 137)}…` : what;
    return `${text}${product ? ` · ${product}` : ''} (${item.before} → ${item.after})`;
  }
  if (item.section === 'Цены') return `${productLabel(item.id)} · ${what}: ${change}`;
  if (/^Артикулы WB/.test(item.what || ''))
    return `Товары: ${[item.before, item.after].filter(value => value && value !== '—').join('; ')}`;
  return `${what}: ${change}`;
}
function eventLabel(group) {
  const items = group.items,
    last = items[items.length - 1];
  if (group.kind === 'settings') {
    const kinds = [...new Set(items.map(item => String(item.what).split(':')[0]))];
    return kinds.length > 1 ? `⚙ Настройки · ${kinds.length}` : SETTING_LABELS[kinds[0]] || `⚙ ${kinds[0]}`;
  }
  if (group.kind === 'bids')
    return items.length === 1 ? `↕ Ставка ${shortValue(last.before)} → ${shortValue(last.after)}` : `↕ Ставки · ${items.length}`;
  if (group.kind === 'minus') {
    const diff = items.reduce((sum, item) => sum + (Number(item.after) || 0) - (Number(item.before) || 0), 0);
    return `⊘ Минус-фразы${diff ? ` ${diff > 0 ? '+' : '−'}${Math.abs(diff)}` : ''}`;
  }
  const main = items.filter(item => item.what === 'Цена со скидкой, ₽'),
    articles = new Set(items.map(item => String(item.id))).size;
  return articles === 1 && main.length === 1
    ? `₽ ${shortValue(main[0].before)} → ${shortValue(main[0].after)}`
    : `₽ Цены · ${articles} арт.`;
}
function chartEvents(days) {
  const index = new Map(days.map((day, i) => [day, i])),
    groups = new Map();
  const add = (kind, item) => {
    const day = mskDay(item.at);
    if (!index.has(day)) return;
    const key = `${day}|${kind}`;
    if (!groups.has(key)) groups.set(key, { kind, day: index.get(day), date: day, items: [] });
    groups.get(key).items.push(item);
  };
  // Смена статуса — не отдельные флажки: из неё (и из показов до начала отслеживания) сервер считает дни работы → activityEvents.
  for (const item of sheetEvents.campaign) {
    if (item.section === 'Реклама') {
      if (!STATUS_WHATS.includes(item.what)) add('settings', item);
    } else if (item.section === 'Ставки') add('bids', item);
    else if (item.section === 'Ключевые слова') add('minus', item);
  }
  const priceKey = item => [item.at, item.id, item.before, item.after].join('|'),
    discounted = new Set(sheetEvents.prices.filter(item => item.what === 'Цена со скидкой, ₽').map(priceKey));
  for (const item of sheetEvents.prices)
    if (PRICE_WHATS.includes(item.what) && !(item.what === 'Цена в WB Клубе, ₽' && discounted.has(priceKey(item)))) add('prices', item);
  return [
    ...activityEvents(days),
    ...[...groups.values()].map(group => {
      group.items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      return { ...group, text: eventLabel(group), color: EVENT_KINDS[group.kind].color };
    })
  ].sort((a, b) => a.day - b.day || EVENT_ORDER.indexOf(a.kind) - EVENT_ORDER.indexOf(b.kind));
}
// --- Запуск и остановка — как флажки кампаний в детализации товара (product.js, campaignEvents) ---
// Дни работы считает сервер (campaignActivity в server.js): до начала отслеживания Google Таблицы — 50 показов в день
// и больше, с начала — статус «Активна» хоть какое-то время дня (пауза и запуск внутри дня флажков не дают).
// ▶ первый день работы, ■ первый день без работы, ◆ работала всего один день, у левого края ↤ — работала уже на начало
// периода (▶, если кампания создана в этот день). В подсказке — точное время из таблицы.
const ACTIVITY_TEXT = { start: '▶ Запуск', stop: '■ Остановка', blip: '◆ Один день', ongoing: '↤ Работала' };
const ddmmOf = day => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
// Время перехода: местное (Душанбе), а если день по Москве другой (дни графика — московские, как у WB) — и МСК.
const stepTime = iso => {
  const local = new Date(iso)
      .toLocaleString('ru-RU', { timeZone: 'Asia/Dushanbe', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      .replace(',', ''),
    msk = new Date(Date.parse(iso) + 3 * 3_600_000).toISOString();
  return local.slice(0, 5) === `${msk.slice(8, 10)}.${msk.slice(5, 7)}`
    ? local
    : `${local} (МСК ${ddmmOf(msk.slice(0, 10))} ${msk.slice(11, 16)})`;
};
function activityEvents(days) {
  const activity = state.activity;
  if (!activity?.days?.length || !days.length) return [];
  const on = new Map(activity.days.map(day => [day.date, day.on])),
    count = days.length,
    events = [],
    runs = [];
  for (let i = 0; i < count; i++) {
    if (!on.get(days[i])) continue;
    if (runs.length && runs.at(-1).to === i - 1) runs.at(-1).to = i;
    else runs.push({ from: i, to: i });
  }
  const tracked = i => Boolean(activity.tracking) && days[i] >= activity.tracking.fromDate;
  const step = (isOn, day) => {
    const list = (activity.events || []).filter(event => event.on === isOn && event.date === day);
    return isOn ? list[0] : list.at(-1);
  };
  const created = String(state.campaignCreatedAt || '').slice(0, 10),
    boundary = 'по статусу на начало отслеживания в Google Таблице';
  // Включение после паузы — с временем, когда кампанию перед этим выключили (pausedAt от сервера): видно, что это не первый запуск.
  const switched = (isOn, at, when, pausedAt) =>
    `${isOn ? 'включена' : 'выключена'} ${at ? stepTime(at) : `${when} (${boundary})`}${isOn && at && pausedAt ? ` после паузы с ${stepTime(pausedAt)}` : ''}`;
  // run — период работы, к которому относится флажок: при наведении он заливается, как в детализации товара.
  let run;
  const flag = (kind, day, line) => ({
    kind: 'activity',
    sub: kind,
    day,
    date: days[day],
    text: ACTIVITY_TEXT[kind],
    color: EVENT_KINDS.activity.color,
    lines: [line],
    run
  });
  for (run of runs) {
    const startTracked = tracked(run.from),
      stopTracked = run.to < count - 1 && tracked(run.to + 1);
    const start = startTracked ? step(true, days[run.from]) : null,
      stop = stopTracked ? step(false, days[run.to]) : null,
      when = ddmmOf(days[run.from]);
    if (run.from === run.to && run.from > 0 && run.to < count - 1) {
      events.push(
        flag(
          'blip',
          run.from,
          startTracked
            ? `работала только ${when}: ${switched(true, start?.at, when, start?.pausedAt)},${stop ? switched(false, stop.at, when) : 'выключена в тот же день'}`
            : `50 показов и больше только ${when}`
        )
      );
      continue;
    }
    const edge = run.from === 0 && !start,
      kind = edge ? (created && created >= days[0] ? 'start' : 'ongoing') : 'start';
    events.push(
      flag(
        kind,
        run.from,
        kind === 'ongoing'
          ? 'работала уже на начало периода'
          : startTracked
            ? switched(true, start?.at, when, start?.pausedAt)
            : `первый день с 50 показами и больше ${when}`
      )
    );
    if (run.to < count - 1) {
      const stopDay = ddmmOf(days[run.to + 1]),
        lastOn = ddmmOf(days[run.to]);
      events.push(
        flag(
          'stop',
          run.to + 1,
          stopTracked
            ? stop
              ? switched(false, stop.at, stopDay)
              : `выключена, последний день работы ${lastOn} (${boundary})`
            : `первый день, когда показов меньше 50, ${stopDay}`
        )
      );
    }
  }
  return events;
}

// Шкалы — группы по величине (см. chartGroups): первая — левая ось, вторая — правая, остальные со своей шкалой без оси.
// График рисуется в настоящую ширину блока (не меньше 640 px — на телефоне прокручивается вбок).
const chartView = { rows: [], idx: null };
const endValue = (s, v) =>
  s.card || ['spend', 'revenue'].includes(s.key)
    ? `${chartAxisNumber(v)} ₽`
    : s.key === 'drr'
      ? percent(v)
      : s.key === 'avgPosition'
        ? Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
        : chartAxisNumber(v);
function renderChart() {
  const svg = $('#dailyChart'),
    wrap = $('.chart-wrap'),
    note = $('#chartScaleNote'),
    tip = $('#chartTooltip');
  const rows = [...state.rows].sort((a, b) => dayOf(a).localeCompare(dayOf(b))),
    series = chartSeries().filter(s => !s.hidden);
  const W = Math.max(640, Math.floor(wrap.clientWidth - 40)),
    wide = W >= 820,
    n = rows.length;
  tip.hidden = true;
  chartView.rows = [];
  svg.style.width = `${W}px`;
  if (!n || !series.length) {
    svg.setAttribute('viewBox', `0 0 ${W} 200`);
    svg.setAttribute('height', '200');
    svg.innerHTML = `<text x="${W / 2}" y="100" text-anchor="middle" class="chart-axis">${n ? 'Включите линии в легенде над графиком' : 'Нет данных за период'}</text>`;
    note.innerHTML = '';
    return;
  }
  const byDay = new Map(state.productDaily.map(r => [`${r.nmId}:${r.date}`, r]));
  const value = (s, r) => chartValue(s, r, byDay),
    maxOf = s => Math.max(0, ...rows.map(r => value(s, r)).filter(v => v != null));
  const groups = chartGroups(series, maxOf),
    scale = new Map(groups.flatMap(group => group.series.map(s => [s.key, group.max]))),
    [leftAxis, rightAxis] = groups;
  const left = 60,
    axisR = rightAxis ? 56 : 12,
    labelsW = wide ? 156 : 0,
    right = axisR + labelsW,
    pw = W - left - right,
    x = i => left + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  // Флажки — ряды над графиком: наезжающий флажок поднимается в следующий ряд.
  const events = chartEvents(rows.map(dayOf)),
    ends = [];
  for (const event of events) {
    event.width = event.text.length * 6.6 + 14;
    event.x = x(event.day);
    event.fx = Math.max(left, Math.min(event.x - 8, left + pw - event.width));
    let level = ends.findIndex(end => end < event.fx - 4);
    if (level < 0) {
      level = ends.length;
      ends.push(0);
    }
    ends[level] = event.fx + event.width;
    event.level = level;
  }
  const flagBand = ends.length ? ends.length * 20 + 4 : 0,
    top = flagBand + (rightAxis ? 26 : 12),
    ph = 250,
    bottom = top + ph,
    H = bottom + 34;
  const y = (s, v) => bottom - (Number(v || 0) / scale.get(s.key)) * ph;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', String(H));
  // Подписи оси — цветом её линии; если на оси несколько линий, цвет нейтральный, а линии перечислены над осью своими цветами.
  const axisColor = group => (group.series.length === 1 ? group.series[0].color : '#58716e');
  const caption = (group, side) =>
    `<text class="chart-axis-caption" x="${side === 'left' ? left : left + pw}" y="${top - 8}" text-anchor="${side === 'left' ? 'start' : 'end'}">${group.series.map(s => `<tspan style="fill:${s.color}">${esc(s.label)}</tspan>`).join('<tspan style="fill:#9aaba8"> · </tspan>')}</text>`;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(r => {
      const gy = bottom - r * ph;
      return (
        `<line class="${r ? 'chart-grid' : 'chart-baseline'}" x1="${left}" x2="${left + pw}" y1="${gy}" y2="${gy}"/><text class="chart-axis" x="${left - 8}" y="${gy + 4}" text-anchor="end" style="fill:${axisColor(leftAxis)}">${esc(chartAxisNumber(leftAxis.max * r))}</text>` +
        (rightAxis
          ? `<text class="chart-axis" x="${left + pw + 8}" y="${gy + 4}" style="fill:${axisColor(rightAxis)}">${esc(chartAxisNumber(rightAxis.max * r))}</text>`
          : '')
      );
    })
    .join('');
  const every = Math.max(1, Math.ceil(n / (W < 760 ? 5 : 8)));
  const labels = rows
    .map((r, i) =>
      (n - 1 - i) % every === 0
        ? `<text class="chart-axis" x="${x(i)}" y="${bottom + 20}" text-anchor="middle">${esc(date(dayOf(r)).slice(0, 5))}</text>`
        : ''
    )
    .join('');
  // Заливка периода работы — видна, пока наведён его флажок ▶, ■, ◆ или ↤ (как в детализации товара): от линии запуска до линии
  // остановки (■ стоит на первом дне без работы); если кампания работает до конца периода — до последнего дня. Один день — полоса
  // шириной в день вокруг его точки.
  const half = n > 1 ? pw / (n - 1) / 2 : pw / 2,
    runs = [...new Map(events.filter(event => event.run).map(event => [`${event.run.from}-${event.run.to}`, event.run])).entries()];
  const runFills = runs
    .map(([key, run]) => {
      const one = run.from === run.to,
        x0 = Math.max(left, one ? x(run.from) - half : x(run.from)),
        x1 = Math.min(left + pw, one ? x(run.to) + half : run.to < n - 1 ? x(run.to + 1) : x(run.to));
      return `<rect class="chart-run" data-run="${key}" x="${x0}" y="${top}" width="${x1 - x0}" height="${ph}" fill="${EVENT_KINDS.activity.color}"/>`;
    })
    .join('');
  const flags = events
    .map((event, i) => {
      const fy = 4 + event.level * 20;
      return `<g class="chart-flag" data-flag="${i}"${event.run ? ` data-run="${event.run.from}-${event.run.to}"` : ''} tabindex="0" role="button" aria-label="${esc(`${date(event.date)}: ${event.text}`)}"><line x1="${event.x}" x2="${event.x}" y1="${fy + 16}" y2="${bottom}" stroke="${event.color}" stroke-width="${event.kind === 'activity' ? 1.5 : 1.25}" stroke-dasharray="${event.kind === 'activity' ? '4 3' : event.kind === 'prices' ? '2 3' : '3 3'}"/><rect x="${event.fx}" y="${fy}" width="${event.width}" height="16" rx="${event.kind === 'prices' ? 8 : 4}" fill="${event.color}"/><text class="chart-flag-text" x="${event.fx + 7}" y="${fy + 12}">${esc(event.text)}</text></g>`;
    })
    .join('');
  // Дни без значения (null) рвут линию: отрезки рисуются отдельно, одиночная точка — кружком.
  const lines = series
    .map(s => {
      const parts = [];
      let part = [];
      rows.forEach((r, i) => {
        const v = value(s, r);
        if (v == null) {
          if (part.length) parts.push(part);
          part = [];
          return;
        }
        part.push([x(i), y(s, v)]);
      });
      if (part.length) parts.push(part);
      return `<g class="chart-series" data-series="${esc(s.key)}">${parts.map(points => (points.length === 1 ? `<circle class="chart-dot" cx="${points[0][0]}" cy="${points[0][1]}" r="3.5" fill="${s.color}"/>` : `<polyline class="chart-line" points="${points.map(p => p.join(',')).join(' ')}" stroke="${s.color}"/>`)).join('')}</g>`;
    })
    .join('');
  // Подписи на концах линий: название и последнее значение; наезжающие раздвигаются с выносной линией.
  let endLabels = '';
  if (wide) {
    const lx = left + pw + axisR + 10,
      items = series
        .map(s => {
          const li = rows.findLastIndex(r => value(s, r) != null);
          return li < 0 ? null : { s, li, y0: y(s, value(s, rows[li])), ly: y(s, value(s, rows[li])) };
        })
        .filter(Boolean)
        .sort((a, b) => a.y0 - b.y0);
    for (let i = 1; i < items.length; i++) items[i].ly = Math.max(items[i].ly, items[i - 1].ly + 16);
    if (items.length && items.at(-1).ly > bottom) {
      items.at(-1).ly = bottom;
      for (let i = items.length - 2; i >= 0; i--) items[i].ly = Math.min(items[i].ly, items[i + 1].ly - 16);
    }
    endLabels = items
      .map(item => {
        const ex = x(item.li),
          name = item.s.label.length > 16 ? `${item.s.label.slice(0, 15)}…` : item.s.label;
        return `<g class="chart-end" data-series="${esc(item.s.key)}">${Math.abs(item.ly - item.y0) > 2 || item.li < n - 1 ? `<path class="chart-leader" d="M${ex + 6},${item.y0}L${lx - 4},${item.ly}"/>` : ''}<circle class="chart-end-dot" cx="${ex}" cy="${item.y0}" r="4" fill="${item.s.color}"/><text x="${lx}" y="${item.ly + 4}">${esc(name)}<tspan class="v" dx="6">${esc(endValue(item.s, value(item.s, rows[item.li])))}</tspan></text></g>`;
      })
      .join('');
  }
  const dots = series.map(s => `<circle r="4.5" fill="${s.color}" visibility="hidden"/>`).join('');
  svg.innerHTML =
    `${runFills}${grid}${rightAxis ? caption(leftAxis, 'left') + caption(rightAxis, 'right') : ''}${labels}<g class="chart-flags">${flags}</g><g class="chart-lines">${lines}</g>${endLabels}` +
    `<g class="chart-hover" visibility="hidden"><line class="chart-hover-line" y1="${top}" y2="${bottom}"/>${dots}</g><rect class="chart-hit-area" x="${left}" y="${top}" width="${pw}" height="${ph + 24}" tabindex="0" aria-label="График по датам: стрелки влево и вправо — по дням"/>`;
  const own = groups
    .slice(2)
    .flatMap(group =>
      group.series.map(
        s =>
          `<span><i style="background:${s.color}"></i>${esc(s.label)} — до ${esc(chartAxisNumber(group.max))}${s.key === 'drr' ? '%' : ''}</span>`
      )
    );
  const since = sheetEvents.since ? ` (таблица следит с ${new Date(sheetEvents.since).toLocaleDateString('ru-RU')})` : '';
  note.innerHTML = [
    own.length ? `Со своей шкалой, без оси: ${own.join(' ')}` : '',
    sheetEvents.loaded
      ? `Флажки — изменения из Google Таблицы${since}: ${EVENT_ORDER.map(kind => `<span><i style="background:${EVENT_KINDS[kind].color}"></i>${EVENT_KINDS[kind].label.toLowerCase()}</span>`).join(' ')}`
      : ''
  ]
    .filter(Boolean)
    .join('<br>');
  Object.assign(chartView, { rows, series, events, value, byDay, x, y, n, W, top, bottom, left, pw, idx: null });
  // Перерисовка (догрузились изменения из таблицы, автообновление) сбрасывает выделение — иначе все линии остались бы бледными.
  setChartFocus(null);
}
// Подсказка: дата, значения всех линий (выделенная — ярко, остальные приглушены) и изменения этого дня.
function showChartDay(i, py) {
  const v = chartView,
    svg = $('#dailyChart'),
    tip = $('#chartTooltip');
  if (!v.rows.length) return;
  const idx = Math.max(0, Math.min(v.n - 1, i)),
    cx = v.x(idx),
    row = v.rows[idx],
    hover = svg.querySelector('.chart-hover'),
    dots = [...hover.querySelectorAll('circle')];
  v.idx = idx;
  hover.setAttribute('visibility', 'visible');
  const line = hover.querySelector('line');
  line.setAttribute('x1', cx);
  line.setAttribute('x2', cx);
  let focus = null,
    best = 22;
  v.series.forEach((s, k) => {
    const value = v.value(s, row),
      dot = dots[k];
    if (value == null) {
      dot.setAttribute('visibility', 'hidden');
      return;
    }
    const cy = v.y(s, value);
    dot.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    if (py != null && Math.abs(cy - py) < best) {
      best = Math.abs(cy - py);
      focus = s.key;
    }
  });
  if (py != null) setChartFocus(focus);
  const day = new Date(`${dayOf(row)}T00:00:00Z`).toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  });
  const dayEvents = v.events.filter(event => event.day === idx);
  tip.innerHTML =
    `<div class="t-date">${esc(day)}</div>` +
    v.series
      .map(s => {
        const value = v.value(s, row);
        return `<div class="t-row${focus && s.key !== focus ? ' dim' : ''}"><i style="background:${s.color}"></i><b>${value == null ? '—' : esc(fmt(s.card ? 'spend' : s.key, value))}</b><span>${esc(s.label)}${value == null && s.key === 'drr' ? ' — нет выручки' : ''}</span></div>`;
      })
      .join('') +
    (dayEvents.length
      ? `<div class="t-foot">${dayEvents.map(event => `<span><i style="background:${event.color}"></i>${esc(event.text)}</span>`).join('')}</div>`
      : '');
  placeChartTip(cx, v.top);
}
// Подсказка — в панели графика (вне прокрутки): координаты точки графика переводятся в координаты панели.
function placeChartTip(cx, top) {
  // offsetParent у скрытой подсказки — null: сначала показать, потом мерить.
  const svg = $('#dailyChart'),
    tip = $('#chartTooltip');
  tip.hidden = false;
  const panel = tip.offsetParent;
  const svgRect = svg.getBoundingClientRect(),
    panelRect = (panel || document.body).getBoundingClientRect(),
    width = tip.offsetWidth || 220;
  const at = svgRect.left - panelRect.left + cx,
    visibleRight = Math.min(svgRect.right, panelRect.right) - panelRect.left;
  tip.style.left = `${Math.max(8, at + 16 + width > visibleRight ? at - 16 - width : at + 16)}px`;
  tip.style.top = `${svgRect.top - panelRect.top + top}px`;
}
function hideChartDay() {
  const hover = $('#dailyChart').querySelector('.chart-hover');
  hover?.setAttribute('visibility', 'hidden');
  $('#chartTooltip').hidden = true;
  chartView.idx = null;
  setChartFocus(null);
}
// Флажок: что изменилось в этот день — по времени (местное), до 14 строк.
function showChartFlag(flag) {
  const event = chartView.events?.[Number(flag.dataset.flag)];
  if (!event) return;
  const tip = $('#chartTooltip');
  // Запуск и остановка — одна строка-пояснение, как подсказка флажка кампании в детализации товара.
  if (event.lines) {
    tip.innerHTML = `<div class="t-date"><i style="background:${event.color}"></i>${esc(event.text)} · ${esc(date(event.date))}</div>${event.lines.map(line => `<div class="t-line">Кампания: ${esc(line)}</div>`).join('')}`;
    placeChartTip(event.x, 4 + event.level * 20 + 20);
    return;
  }
  const lines = event.items
    .slice(0, 14)
    .map(
      item =>
        `<div class="t-event"><time>${esc(new Date(item.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))}</time><span>${esc(eventLine(item))}</span></div>`
    )
    .join('');
  tip.innerHTML = `<div class="t-date"><i style="background:${event.color}"></i>${esc(EVENT_KINDS[event.kind].label)} · ${esc(date(event.date))}</div>${lines}${event.items.length > 14 ? `<div class="t-more">и ещё ${event.items.length - 14}</div>` : ''}<div class="t-hint">Из Google Таблицы, время местное</div>`;
  placeChartTip(event.x, 4 + event.level * 20 + 20);
}
{
  const svg = $('#dailyChart'),
    pick = event => {
      const rect = svg.getBoundingClientRect(),
        v = chartView;
      return [Math.round(((event.clientX - rect.left - v.left) / v.pw) * (v.n - 1)), event.clientY - rect.top];
    };
  svg.addEventListener('pointermove', event => {
    if (!event.target.closest('.chart-hit-area') || !chartView.rows.length) return;
    const [i, py] = pick(event);
    showChartDay(i, py);
  });
  const showRun = key => svg.querySelectorAll('.chart-run').forEach(rect => rect.classList.toggle('on', rect.dataset.run === key));
  svg.addEventListener('pointerout', event => {
    if (event.target.closest('.chart-hit-area') && !event.relatedTarget?.closest?.('.chart-hit-area')) hideChartDay();
    const flag = event.target.closest('.chart-flag');
    if (flag && !flag.contains(event.relatedTarget)) {
      $('#chartTooltip').hidden = true;
      showRun(null);
    }
  });
  svg.addEventListener('pointerover', event => {
    const flag = event.target.closest('.chart-flag');
    if (flag) {
      showChartFlag(flag);
      showRun(flag.dataset.run || null);
    }
  });
  svg.addEventListener('focusin', event => {
    const flag = event.target.closest('.chart-flag');
    if (flag) {
      showChartFlag(flag);
      showRun(flag.dataset.run || null);
    }
  });
  svg.addEventListener('focusout', () => {
    hideChartDay();
    showRun(null);
  });
  svg.addEventListener('keydown', event => {
    if (!event.target.closest('.chart-hit-area') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    showChartDay((chartView.idx ?? (step < 0 ? chartView.n : -1)) + step);
  });
  let chartWidth = 0;
  new ResizeObserver(() => {
    const width = $('.chart-wrap').clientWidth;
    if (width && width !== chartWidth) {
      chartWidth = width;
      renderChart();
    }
  }).observe($('.chart-wrap'));
}
