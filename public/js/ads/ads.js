// --- «Аналитика рекламы»: кампании, товары в рекламе, графики расходов и показателей, столбцы таблицы ---

// Сначала приходят действующие и приостановленные кампании (part=active) — вкладка открывается без ожидания;
// завершённые кампании и остатки бюджета догружаются следом в фоне, и таблицы перерисовываются.
async function loadAds(force = false) {
  const key = [state.cabinet, $('#dateFrom').value, $('#dateTo').value].join(':');
  if (!force && state.adsKey === key && state.ads) {
    renderAds();
    return;
  }
  const btn = $('#refresh'),
    request = (state.adsRequest = (state.adsRequest || 0) + 1);
  btn.classList.add('loading');
  try {
    const q = new URLSearchParams({ cabinet: state.cabinet, from: $('#dateFrom').value, to: $('#dateTo').value });
    const first = await api('/api/advertising?' + q + '&part=active');
    if (request !== state.adsRequest) return;
    state.ads = first;
    state.adsKey = key;
    state.adsPrev = { loading: true };
    state.demo = state.ads.demo;
    renderAds();
    $('#cabinetMode').textContent = state.ads.demo ? 'Демо-данные' : 'Единый токен активен';
    renderAdWarnings();
    loadAdFunnelOrders(q, key);
    if (state.ads.partial) loadAdsRest(q, request);
    else loadAdsPrevious(q, request);
  } catch (e) {
    toast(e.message);
    addNotice('ads', `Ошибка загрузки рекламы: ${e.message}`);
  } finally {
    btn.classList.remove('loading');
  }
}
// Автообновление (auto-refresh.js): без экрана загрузки, сразу полный список; при ошибке остаются прежние данные.
async function refreshAdsSilently() {
  const key = [state.cabinet, $('#dateFrom').value, $('#dateTo').value].join(':');
  if (state.adsKey !== key || !state.ads) return false;
  const request = (state.adsRequest = (state.adsRequest || 0) + 1),
    q = new URLSearchParams({ cabinet: state.cabinet, from: $('#dateFrom').value, to: $('#dateTo').value });
  try {
    const full = await api('/api/advertising?' + q);
    if (request !== state.adsRequest) return false;
    state.ads = full;
    renderAds();
    renderAdWarnings();
    loadAdFunnelOrders(q, key);
    loadAdsPrevious(q, request);
    return true;
  } catch {
    return false;
  }
}
async function loadAdsRest(q, request) {
  try {
    const full = await api('/api/advertising?' + q);
    if (request !== state.adsRequest) return;
    state.ads = full;
    renderAds();
    renderAdWarnings();
  } catch (e) {
    if (request !== state.adsRequest) return;
    state.ads.partialError = e.message;
    renderAdPartialNote();
  }
  if (request === state.adsRequest) loadAdsPrevious(q, request);
}
// Третий фоновый шаг: кампании за прошлый период той же длины — для изменений в процентах в «Рекламных кампаниях».
async function loadAdsPrevious(q, request) {
  try {
    const data = await api('/api/advertising/previous?' + q);
    if (request !== state.adsRequest) return;
    state.adsPrev = { period: data.period, totals: data.totals || null, byId: new Map((data.campaigns || []).map(c => [String(c.id), c])) };
  } catch (e) {
    if (request !== state.adsRequest) return;
    state.adsPrev = { error: e.message };
  }
  renderAds();
}
// Изменение итога к прошлому периоду в карточках вкладки «Реклама»; цвет — по смыслу показателя (AD_DELTA_TONE).
function adMetricDelta(key, value) {
  const prev = state.adsPrev,
    before = Number(prev?.totals?.[key] || 0),
    now = Number(value || 0),
    better = AD_DELTA_TONE[key];
  if (!prev?.totals || !better)
    return prev?.loading ? '<small class="sales-delta flat metric-delta" title="Загружаем прошлый период">…</small>' : '';
  const title = `к ${trendFullDate(prev.period.from)} – ${trendFullDate(prev.period.to)}`;
  if (!before) return now ? `<small class="sales-delta flat metric-delta" title="${title}">новое</small>` : '';
  const change = Math.round(((now - before) / before) * 100),
    tone = !change || better === 'neutral' ? 'flat' : change > 0 === (better === 'up') ? 'up' : 'down';
  return `<small class="sales-delta ${tone} metric-delta" title="${title}">${change ? `${change > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(change))}%` : '0%'} <span>к прошлому периоду</span></small>`;
}
// Изменение метрики кампании к прошлому периоду, как в «Товарах в воронке». Для стоимостей (CPC, CPM, CPO, ДРР) рост — красный,
// расход — нейтральный серый: его рост сам по себе не плох и не хорош.
const AD_DELTA_TONE = {
  spend: 'neutral',
  views: 'up',
  clicks: 'up',
  ctr: 'up',
  cpc: 'down',
  cpm: 'down',
  carts: 'up',
  orders: 'up',
  cr: 'up',
  cpo: 'down',
  revenue: 'up',
  drr: 'down',
  roas: 'up'
};
function adDelta(key, x) {
  const better = AD_DELTA_TONE[key],
    byId = state.adsPrev?.byId;
  if (!better || !byId) return '';
  if ((key === 'cpo' && !Number(x.orders)) || (key === 'drr' && !Number(x.revenue))) return '';
  const before = byId.get(String(x.id)),
    value = Number(x[key] || 0),
    old = before ? Number(before[key] || 0) : 0;
  if (!old) return value ? '<small class="sales-delta flat">новое</small>' : '';
  const change = Math.round(((value - old) / old) * 100);
  if (!change) return '<small class="sales-delta flat">0%</small>';
  const tone = better === 'neutral' ? 'flat' : change > 0 === (better === 'up') ? 'up' : 'down';
  return `<small class="sales-delta ${tone}">${change > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(change))}%</small>`;
}
function adCompareNote() {
  const p = state.adsPrev;
  if (!p) return '';
  if (p.loading) return ' · сравнение с прошлым периодом загружается…';
  if (p.error) return ' · сравнение с прошлым периодом не загрузилось';
  return ` · изменения к ${trendFullDate(p.period.from)} – ${trendFullDate(p.period.to)}`;
}
function renderAdWarnings() {
  setNotices('ads', 'load', state.ads?.warnings || []);
}
function renderAdPartialNote() {
  const note = $('#adPartialNote'),
    a = state.ads;
  if (!note) return;
  note.classList.toggle('hidden', !a?.partial);
  if (a?.partial)
    note.innerHTML = a.partialError
      ? `<span>Не догрузилось</span><p>Завершённые кампании и остатки бюджета: ${escapeHtml(a.partialError)}. Нажмите «Обновить».</p>`
      : '<span>Догружаем</span><p>Статистика завершённых кампаний и остатки бюджета подгружаются в фоне — итоги и таблицы обновятся сами.</p>';
}
const AD_BID_TYPES = { unified: 'единая', manual: 'ручная' };
function adBidType(type) {
  return AD_BID_TYPES[type] || type || '';
}
// WB отдаёт дату создания по Москве; берём её из строки, чтобы часовой пояс браузера не сдвигал день.
function adCreatedDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '—';
}
function adStatus(status) {
  return (
    { 7: ['Завершена', 'status-complete'], 9: ['Активна', 'status-new'], 11: ['На паузе', 'status-confirm'] }[status] || [
      `Статус ${status ?? '—'}`,
      ''
    ]
  );
}
// --- «Заказы, воронка» в обеих таблицах рекламы: все заказы артикулов по воронке продаж за тот же период ---
// У кампании — сумма по всем её артикулам, у товара — заказы этого артикула. Догружается после рекламы (/api/funnel/orders).
function applyAdFunnelOrders() {
  const a = state.ads,
    f = state.adFunnel;
  if (!a) return;
  const ready = Boolean(f && f.key === state.adsKey && f.orders);
  (a.campaigns || []).forEach(c => {
    c.funnelOrders = ready ? (c.nmIds || []).reduce((sum, id) => sum + Number(f.orders[id] || 0), 0) : null;
  });
  (a.products || []).forEach(p => {
    p.funnelOrders = ready ? Number(f.orders[p.nmId] || 0) : null;
  });
}
// Под числом — доля рекламных заказов во всех заказах по воронке.
function adFunnelCell(x) {
  if (x.funnelOrders == null) {
    const f = state.adFunnel;
    return f?.key === state.adsKey && f.error
      ? `<span title="${escapeHtml(f.error)}">—</span>`
      : '<span title="Загружаем заказы из воронки продаж">…</span>';
  }
  const share = x.funnelOrders ? Math.round((Number(x.orders || 0) / x.funnelOrders) * 100) : null;
  return `${fmtNum(x.funnelOrders)}${share != null ? `<small class="ad-funnel-share" title="Доля рекламных заказов во всех заказах">реклама ${fmtNum(share)}%</small>` : ''}`;
}
async function loadAdFunnelOrders(q, key) {
  state.adFunnel = { key, orders: null, error: '' };
  try {
    const data = await api('/api/funnel/orders?' + q);
    if (state.adsKey !== key) return;
    state.adFunnel = { key, orders: data.orders || {}, error: '' };
  } catch (e) {
    if (state.adsKey !== key) return;
    state.adFunnel = { key, orders: null, error: e.message };
  }
  renderAds();
}
function renderAds() {
  const a = state.ads;
  if (!a) return;
  applyAdFunnelOrders();
  renderAdPartialNote();
  const t = a.totals || {};
  const metrics = [
    ['Расходы', fmtRub(t.spend), 'за выбранный период', '#7651e5', 'spend'],
    ['Выручка с рекламы', fmtRub(t.revenue), `${fmtNum(t.orders)} рекламных заказов`, '#318f68', 'revenue'],
    ['ДРР', fmtPercent(t.drr), 'расходы / рекламная выручка', '#e76464', 'drr'],
    ['CTR', fmtPercent(t.ctr), `${fmtNum(t.clicks)} кликов из ${fmtNum(t.views)} показов`, '#f0a04b', 'ctr'],
    ['CPC', fmtRub(t.cpc), 'средняя цена клика', '#9d77ff', 'cpc'],
    ['ROAS', `${Number(t.roas || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}×`, 'выручка на 1 ₽ расходов', '#318f68', 'roas']
  ];
  $('#adMetrics').innerHTML = metrics
    .map(
      x =>
        `<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${x[1]}</div>${adMetricDelta(x[4], t[x[4]])}<div class="metric-note">${x[2]}</div></article>`
    )
    .join('');
  renderAdMoneyChart(a.daily || []);
  renderAdRateChart(a.daily || []);
  renderAdPlatforms(a.platforms || []);
  renderAdDetails(t);
  renderAdCampaigns();
  renderAdProducts(a.products || []);
}
function chartEmpty() {
  return '<div class="chart-empty">Нет данных за выбранный период</div>';
}
function chartLabels(data, width, height, left, bottom) {
  const step = Math.max(1, Math.ceil(data.length / 6));
  return data
    .map((d, i) =>
      i % step === 0 || i === data.length - 1
        ? `<text x="${left + (i * (width - left - 18)) / Math.max(1, data.length - 1)}" y="${height - bottom + 19}" text-anchor="middle">${new Date(d.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</text>`
        : ''
    )
    .join('');
}
function bindChartHover(el, data, { width, pointX, pointY, tooltipRows }) {
  const svg = el.querySelector('svg'),
    hover = svg?.querySelector('.chart-hover');
  if (!svg || !hover) return;
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip hidden';
  el.appendChild(tooltip);
  const move = event => {
    const rect = svg.getBoundingClientRect(),
      viewX = ((event.clientX - rect.left) / rect.width) * width;
    let nearest = 0,
      distance = Infinity;
    data.forEach((item, index) => {
      const current = Math.abs(pointX(index) - viewX);
      if (current < distance) {
        distance = current;
        nearest = index;
      }
    });
    const item = data[nearest],
      x = pointX(nearest),
      ys = pointY(item);
    hover.classList.remove('hidden');
    hover.querySelector('.hover-line').setAttribute('x1', x);
    hover.querySelector('.hover-line').setAttribute('x2', x);
    hover.querySelectorAll('.hover-point').forEach((dot, index) => {
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', ys[index] ?? ys[0]);
    });
    tooltip.innerHTML = `<strong>${new Date(item.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>${tooltipRows(
      item
    )
      .map(row => `<span><i style="--dot:${row[2]}"></i>${row[0]}<b>${row[1]}</b></span>`)
      .join('')}`;
    tooltip.classList.remove('hidden');
    const localX = rect.left - el.getBoundingClientRect().left + (x / width) * rect.width;
    tooltip.style.left = `${Math.max(105, Math.min(el.clientWidth - 105, localX))}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => {
    hover.classList.add('hidden');
    tooltip.classList.add('hidden');
  });
}
function renderAdMoneyChart(data) {
  const el = $('#adMoneyChart');
  if (!data.length) {
    el.innerHTML = chartEmpty();
    return;
  }
  const w = 760,
    h = 270,
    l = 56,
    b = 38,
    top = 18,
    plotH = h - b - top,
    step = (w - l - 22) / Math.max(1, data.length),
    maxSpend = Math.max(1, ...data.map(x => x.spend)),
    maxRevenue = Math.max(1, ...data.map(x => x.revenue));
  const x = i => l + i * step + step * 0.43,
    spendY = d => top + plotH - (d.spend / maxSpend) * plotH,
    revenueY = d => top + plotH - (d.revenue / maxRevenue) * plotH;
  const bars = data
    .map((d, i) => {
      const bh = (d.spend / maxSpend) * plotH;
      return `<rect x="${l + i * step + step * 0.16}" y="${spendY(d)}" width="${Math.max(3, step * 0.55)}" height="${bh}" rx="3"/>`;
    })
    .join('');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Расходы и выручка по дням"><g class="grid"><line x1="${l}" y1="${top + plotH}" x2="${w - 18}" y2="${top + plotH}"/><line x1="${l}" y1="${top + plotH / 2}" x2="${w - 18}" y2="${top + plotH / 2}"/><line x1="${l}" y1="${top}" x2="${w - 18}" y2="${top}"/></g><g class="money-bars">${bars}</g><polyline class="revenue-line" points="${data.map((d, i) => `${x(i)},${revenueY(d)}`).join(' ')}"/>${data.map((d, i) => `<circle class="revenue-dot" cx="${x(i)}" cy="${revenueY(d)}" r="3"/>`).join('')}<g class="chart-hover hidden"><line class="hover-line" y1="${top}" y2="${top + plotH}"/><circle class="hover-point spend-hover" r="5"/><circle class="hover-point revenue-hover" r="5"/></g><g class="axis-labels">${chartLabels(data, w, h, l, b)}<text x="5" y="${top + 5}">${shortMoney(maxSpend)} расход</text><text x="${w - 5}" y="${top + 5}" text-anchor="end">${shortMoney(maxRevenue)} выручка</text></g></svg>`;
  bindChartHover(el, data, {
    width: w,
    pointX: x,
    pointY: d => [spendY(d), revenueY(d)],
    tooltipRows: d => [
      ['Расходы', fmtRub(d.spend), '#8f6bea'],
      ['Выручка', fmtRub(d.revenue), '#40a879'],
      ['Клики', fmtNum(d.clicks), '#7651e5'],
      ['Заказы', fmtNum(d.orders), '#f0a04b']
    ]
  });
}
function renderAdRateChart(data) {
  const el = $('#adRateChart');
  if (!data.length) {
    el.innerHTML = chartEmpty();
    return;
  }
  const w = 760,
    h = 270,
    l = 48,
    b = 38,
    top = 18,
    plotH = h - b - top,
    step = (w - l - 22) / Math.max(1, data.length - 1),
    max = Math.max(1, ...data.flatMap(x => [x.ctr, x.drr])) * 1.1,
    x = i => l + i * step,
    y = (d, key) => top + plotH - (d[key] / max) * plotH,
    points = key => data.map((d, i) => `${x(i)},${y(d, key)}`).join(' ');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="CTR и ДРР по дням"><g class="grid"><line x1="${l}" y1="${top + plotH}" x2="${w - 18}" y2="${top + plotH}"/><line x1="${l}" y1="${top + plotH / 2}" x2="${w - 18}" y2="${top + plotH / 2}"/><line x1="${l}" y1="${top}" x2="${w - 18}" y2="${top}"/></g><polyline class="ctr-line" points="${points('ctr')}"/><polyline class="drr-line" points="${points('drr')}"/>${data.map((d, i) => `<circle class="ctr-dot" cx="${x(i)}" cy="${y(d, 'ctr')}" r="3"/><circle class="drr-dot" cx="${x(i)}" cy="${y(d, 'drr')}" r="3"/>`).join('')}<g class="chart-hover hidden"><line class="hover-line" y1="${top}" y2="${top + plotH}"/><circle class="hover-point ctr-hover" r="5"/><circle class="hover-point drr-hover" r="5"/></g><g class="axis-labels">${chartLabels(data, w, h, l, b)}<text x="5" y="${top + 5}">${fmtPercent(max)}</text></g><g class="rate-legend"><text x="${w - 155}" y="14">● CTR</text><text x="${w - 82}" y="14">● ДРР</text></g></svg>`;
  bindChartHover(el, data, {
    width: w,
    pointX: x,
    pointY: d => [y(d, 'ctr'), y(d, 'drr')],
    tooltipRows: d => [
      ['CTR', fmtPercent(d.ctr), '#7651e5'],
      ['ДРР', fmtPercent(d.drr), '#e76464'],
      ['CPC', fmtRub(d.cpc), '#9d77ff'],
      ['CR', fmtPercent(d.cr), '#f0a04b']
    ]
  });
}
function shortMoney(value) {
  return new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value) + ' ₽';
}
function renderAdPlatforms(items) {
  const total = Math.max(1, ...items.map(x => x.spend));
  $('#adPlatforms').innerHTML = items
    .map(
      x =>
        `<div class="platform-row"><div><strong>${escapeHtml(x.name)}</strong><span>${fmtPercent((x.spend / (state.ads.totals.spend || 1)) * 100)} расходов</span></div><div class="platform-bar"><i style="width:${(x.spend / total) * 100}%"></i></div><b>${fmtRub(x.spend)}</b><small>${fmtNum(x.clicks)} кликов · ${fmtNum(x.orders)} заказов</small></div>`
    )
    .join('');
}
function renderAdDetails(t) {
  const items = [
    ['Показы', fmtNum(t.views)],
    ['Клики', fmtNum(t.clicks)],
    ['Добавления в корзину', fmtNum(t.carts)],
    ['Рекламные заказы', fmtNum(t.orders)],
    ['Продажи, шт.', fmtNum(t.sales)],
    ['Технические отмены', fmtNum(t.canceled)],
    ['Конверсия клика в заказ', fmtPercent(t.cr)],
    ['CPM', fmtRub(t.cpm)]
  ];
  $('#adDetails').innerHTML = items.map(x => `<div class="ad-detail"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('');
}
// --- Таблица «Рекламные кампании»: набор и порядок столбцов выбираются в фильтре «Столбцы» и запоминаются в браузере ---
// Подсказки к метрикам рекламы — общие для «Рекламных кампаний» и «Товаров в рекламе».
const AD_TIPS = {
  cpo: 'Средняя стоимость одного заказа.\nРассчитываем по формуле: затраты ÷ количество заказов.',
  cr: 'Доля кликов, после которых покупатели заказали товар.\nРассчитываем по формуле: заказы ÷ клики × 100%',
  cpm: 'Стоимость тысячи показов.\nРассчитываем по формуле: затраты ÷ показы × 1000.'
};
// Страница кампании в кабинете продвижения WB с текущим периодом сайта (формат ссылки взят из кабинета).
function adWbCampaignUrl(id) {
  const from = $('#dateFrom').value,
    to = $('#dateTo').value,
    period = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? `?from=${from}T00:00:00Z&to=${to}T00:00:00Z` : '';
  return `https://cmp.wildberries.ru/campaigns/edit/${encodeURIComponent(id)}${period}`;
}
// Без заказов стоимость заказа не определена — показываем прочерк, а не 0 ₽.
function adCpo(x) {
  return Number(x.orders) ? fmtRub(x.cpo) : '—';
}
// «Артикулы»: сколько товаров в кампании сейчас и сколько из них с показами или кликами за период. Товары, которые
// за период показывались, но из кампании уже убраны, считаются отдельно. В подсказке — списки с артикулами продавца.
function adArticlesCell(x) {
  const total = Number(x.nmCount || 0),
    active = Number(x.nmActive || 0),
    removed = Number(x.nmRemovedActive || 0),
    codes = x.nmVendorCodes || {};
  if (!total && !active && !removed) return '—';
  const activeIds = new Set((x.activeNmIds || []).map(String)),
    inside = (x.nmInCampaign?.length ? x.nmInCampaign : x.nmIds || []).map(String),
    insideSet = new Set(inside);
  const line = (id, mark) => `${mark} ${id}${codes[id] ? ` — ${codes[id]}` : ''}`;
  const list = inside
    .slice(0, 100)
    .map(id => line(id, activeIds.has(id) ? '✓' : '·'))
    .join('\n');
  const gone = [...activeIds]
    .filter(id => !insideSet.has(id))
    .slice(0, 50)
    .map(id => line(id, '×'))
    .join('\n');
  const title = `В кампании: ${total}, с показами за период: ${active}${list ? `\n${list}` : ''}${inside.length > 100 ? '\n…' : ''}${gone ? `\n\nУбраны из кампании, но показывались за период: ${removed}\n${gone}` : ''}`;
  return `<span class="ad-articles" title="${escapeHtml(title)}"><strong>${fmtNum(total)}</strong><small class="${active ? '' : 'muted'}">${active ? `с показами ${fmtNum(active)}` : 'без показов'}</small>${removed ? `<small class="muted">+${fmtNum(removed)} убран${removed === 1 ? '' : 'о'} из РК</small>` : ''}</span>`;
}
function adDateTime(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return match ? `<strong>${match[3]}.${match[2]}.${match[1]}</strong>${match[4] ? `<small>${match[4]}:${match[5]}</small>` : ''}` : '—';
}
const AD_CAMPAIGN_COLUMNS = [
  // Детализация открывается иконкой слева, название ведёт в кампанию в кабинете WB, клик по ID копирует его (общий обработчик [data-copy]).
  {
    key: 'name',
    label: 'Кампания',
    fixed: true,
    width: 295,
    cell: x => {
      const photo = x.photo ? `<img class="ad-product-photo" src="${escapeHtml(x.photo)}" alt="" loading="lazy">` : '',
        query = new URLSearchParams({ cabinet: state.cabinet, id: x.id, from: $('#dateFrom').value, to: $('#dateTo').value });
      return `<div class="ad-product-name"><a class="campaign-open" href="/campaign.html?${query}" target="_blank" rel="noopener noreferrer" title="Открыть детализацию кампании" aria-label="Открыть детализацию кампании «${escapeHtml(x.name)}»"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3"/><path d="M6.25 9.75l3.5-3.5M6.75 6.25h3v3"/></svg></a>${photo}<span><strong><a class="campaign-wb-link" href="${escapeHtml(adWbCampaignUrl(x.id))}" target="_blank" rel="noopener noreferrer" title="Открыть кампанию в кабинете WB">${escapeHtml(x.name)}</a></strong><small><button type="button" class="copy-article" data-copy="${escapeHtml(x.id)}" title="Скопировать ID">ID ${escapeHtml(x.id)}</button> · ${escapeHtml((x.paymentType || '—').toUpperCase())} · ${escapeHtml(adBidType(x.bidType))}</small></span></div>`;
    }
  },
  {
    key: 'status',
    width: 110,
    label: 'Статус',
    cell: x => {
      const s = adStatus(x.status);
      return `<span class="status ${s[1]}">${s[0]}</span>`;
    }
  },
  { key: 'nmCount', width: 115, label: 'Артикулы', hint: 'в кампании и с показами за период', cell: x => adArticlesCell(x) },
  { key: 'createdAt', width: 105, label: 'Создана', hint: 'дата создания', cell: x => adCreatedDate(x.createdAt) },
  { key: 'startedAt', width: 105, label: 'Запуск', hint: 'последний запуск', cell: x => adDateTime(x.startedAt) },
  { key: 'updatedAt', width: 105, label: 'Изменена', hint: 'последнее изменение', cell: x => adDateTime(x.updatedAt) },
  {
    key: 'budget',
    width: 115,
    label: 'Остаток',
    hint: 'остаток бюджета',
    cell: x =>
      x.budget == null
        ? state.ads?.partial && !state.ads.partialError && [9, 11].includes(Number(x.status))
          ? '<span title="Остаток бюджета догружается">…</span>'
          : '—'
        : `<strong class="${Number(x.budget) <= 0 ? 'bad-rate' : ''}">${fmtRub(x.budget)}</strong>`
  },
  { key: 'spend', width: 120, label: 'Расход', cell: x => `<strong>${fmtRub(x.spend)}</strong>` },
  { key: 'views', width: 100, label: 'Показы', cell: x => fmtNum(x.views) },
  { key: 'clicks', width: 90, label: 'Клики', cell: x => fmtNum(x.clicks) },
  { key: 'ctr', width: 80, label: 'CTR', cell: x => fmtPercent(x.ctr) },
  { key: 'cpc', width: 95, label: 'CPC', cell: x => fmtRub(x.cpc) },
  { key: 'cpm', width: 95, label: 'CPM', tip: AD_TIPS.cpm, cell: x => fmtRub(x.cpm) },
  { key: 'carts', width: 110, label: 'Корзины', hint: 'добавления в корзину', cell: x => fmtNum(x.carts) },
  { key: 'orders', width: 90, label: 'Заказы', cell: x => fmtNum(x.orders) },
  {
    key: 'funnelOrders',
    width: 145,
    label: 'Заказы, воронка',
    hint: 'все заказы артикулов кампании по воронке продаж — не только с рекламы',
    cell: x => adFunnelCell(x)
  },
  { key: 'cr', width: 80, label: 'CR', tip: AD_TIPS.cr, cell: x => fmtPercent(x.cr) },
  { key: 'cpo', width: 100, label: 'CPO', tip: AD_TIPS.cpo, cell: x => adCpo(x) },
  { key: 'revenue', width: 130, label: 'Выручка', cell: x => `<strong>${fmtRub(x.revenue)}</strong>` },
  { key: 'drr', width: 80, label: 'ДРР', cell: x => `<strong class="${x.drr > 30 ? 'bad-rate' : ''}">${fmtPercent(x.drr)}</strong>` },
  { key: 'roas', width: 80, label: 'ROAS', cell: x => `${Number(x.roas || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}×` }
];
const AD_COLUMNS_STORAGE = 'wb-ad-campaign-columns';
// «Кампания» всегда первая; остальные хранятся как [{key,visible}], новые столбцы дописываются в конец видимыми.
function adDefaultColumns() {
  return AD_CAMPAIGN_COLUMNS.filter(c => !c.fixed).map(c => ({ key: c.key, visible: true }));
}
function adColumns() {
  if (state.adColumns) return state.adColumns;
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(AD_COLUMNS_STORAGE) || '[]');
  } catch {}
  const defaults = adDefaultColumns(),
    known = new Set(defaults.map(c => c.key));
  const layout = (Array.isArray(saved) ? saved : [])
    .filter(item => known.has(item?.key))
    .map(item => ({ key: item.key, visible: item.visible !== false }));
  // Столбцы, которых не было в сохранённом наборе, встают после своего соседа по умолчанию, а не в конец.
  defaults.forEach((item, index) => {
    if (layout.some(c => c.key === item.key)) return;
    const before = defaults
        .slice(0, index)
        .reverse()
        .find(c => layout.some(l => l.key === c.key)),
      at = before ? layout.findIndex(l => l.key === before.key) + 1 : 0;
    layout.splice(at, 0, item);
  });
  return (state.adColumns = layout);
}
function saveAdColumns() {
  try {
    localStorage.setItem(AD_COLUMNS_STORAGE, JSON.stringify(state.adColumns));
  } catch {}
}
function adVisibleColumns() {
  return [
    AD_CAMPAIGN_COLUMNS[0],
    ...adColumns()
      .filter(c => c.visible)
      .map(c => AD_CAMPAIGN_COLUMNS.find(x => x.key === c.key))
  ];
}
function renderAdColumnOptions() {
  const box = $('#adColumnOptions');
  if (!box) return;
  box.innerHTML =
    adColumns()
      .map(item => {
        const c = AD_CAMPAIGN_COLUMNS.find(x => x.key === item.key);
        return `<label class="column-option" draggable="true" data-ad-column="${c.key}"><span class="column-grip" aria-hidden="true" title="Перетащите, чтобы изменить порядок">⋮⋮</span><input type="checkbox" value="${c.key}" ${item.visible ? 'checked' : ''}><span class="column-name">${escapeHtml(c.label)}${c.hint ? `<small>${escapeHtml(c.hint)}</small>` : ''}</span><span class="column-move"><button type="button" data-ad-column-move="-1" aria-label="Выше">↑</button><button type="button" data-ad-column-move="1" aria-label="Ниже">↓</button></span></label>`;
      })
      .join('') + '<button type="button" class="column-reset" data-ad-column-reset>Вернуть столбцы по умолчанию</button>';
  syncAdColumnOptions();
}
// Порядок пунктов меняется перестановкой узлов, а не перерисовкой: иначе клик «теряет» меню и оно закрывается.
function syncAdColumnOptions() {
  const box = $('#adColumnOptions');
  if (!box) return;
  const list = adColumns(),
    reset = box.querySelector('[data-ad-column-reset]');
  list.forEach((item, index) => {
    const label = box.querySelector(`[data-ad-column="${item.key}"]`);
    if (!label) return;
    box.insertBefore(label, reset);
    label.querySelector('input').checked = item.visible;
    label.querySelector('[data-ad-column-move="-1"]').disabled = index === 0;
    label.querySelector('[data-ad-column-move="1"]').disabled = index === list.length - 1;
  });
  $('#adColumnsLabel').textContent = `Столбцы (${list.filter(c => c.visible).length + 1}/${list.length + 1})`;
}
function placeAdColumn(key, targetKey, after) {
  if (key === targetKey) return;
  const item = adColumns().find(c => c.key === key);
  if (!item) return;
  const list = state.adColumns.filter(c => c.key !== key),
    index = list.findIndex(c => c.key === targetKey);
  if (index < 0) return;
  list.splice(index + (after ? 1 : 0), 0, item);
  state.adColumns = list;
  saveAdColumns();
  syncAdColumnOptions();
  renderAdCampaigns();
}
function renderAdCampaignsHead() {
  const table = $('#adCampaignsTable'),
    columns = adVisibleColumns(),
    key = columns.map(c => c.key).join(',');
  if (!table || table.dataset.columns === key) return;
  if (!$('#adColumnOptions').children.length) renderAdColumnOptions();
  table.dataset.columns = key;
  table.dataset.widthKey = 'adCampaigns';
  $('#adCampaignsHead').innerHTML = columns
    .map(c => {
      const title = c.tip || (c.hint ? c.hint[0].toUpperCase() + c.hint.slice(1) : '');
      return `<th data-ad-sort="${c.key}" data-col-key="${c.key}" data-col-width="${c.width}"${title ? ` title="${escapeHtml(title)}"` : ''}${c.tip ? ' class="has-tip"' : ''}>${escapeHtml(c.label)} ↕</th>`;
    })
    .join('');
  initColumnWidths(table);
}
function renderAdCampaigns() {
  renderAdCampaignsHead();
  const columns = adVisibleColumns(),
    items = state.ads?.campaigns || [],
    term = $('#adSearch').value.toLowerCase();
  const rows = items
    .filter(
      x => (!state.adStatuses.size || state.adStatuses.has(String(x.status))) && (!term || `${x.name} ${x.id}`.toLowerCase().includes(term))
    )
    .sort((a, b) => {
      const key = state.adSort.key,
        av = a[key] ?? '',
        bv = b[key] ?? '',
        result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru', { numeric: true });
      return state.adSort.dir === 'asc' ? result : -result;
    });
  $('#adCampaignCount').textContent = `${rows.length} из ${items.length} кампаний${adCompareNote()}`;
  $('#emptyAds').classList.toggle('hidden', rows.length > 0);
  $('#adCampaignsBody').innerHTML = rows
    .map(x => `<tr data-campaign-id="${escapeHtml(x.id)}">${columns.map(c => `<td>${c.cell(x)}${adDelta(c.key, x)}</td>`).join('')}</tr>`)
    .join('');
  bindAdPhotoPreviews('#adCampaignsBody');
  $$('[data-ad-sort]').forEach(
    header =>
      (header.onclick = () => {
        const key = header.dataset.adSort;
        state.adSort = state.adSort.key === key ? { key, dir: state.adSort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' };
        renderAdCampaigns();
      })
  );
}
document.addEventListener('change', event => {
  const input = event.target.closest?.('#adColumnOptions input[type="checkbox"]');
  if (!input) return;
  const item = adColumns().find(c => c.key === input.value);
  if (!item) return;
  item.visible = input.checked;
  saveAdColumns();
  syncAdColumnOptions();
  renderAdCampaigns();
});
document.addEventListener('click', event => {
  const move = event.target.closest('[data-ad-column-move]');
  if (move) {
    event.preventDefault();
    const list = adColumns(),
      key = move.closest('[data-ad-column]').dataset.adColumn,
      index = list.findIndex(c => c.key === key),
      step = Number(move.dataset.adColumnMove),
      target = list[index + step];
    if (target) placeAdColumn(key, target.key, step > 0);
    return;
  }
  if (event.target.closest('[data-ad-column-reset]')) {
    state.adColumns = adDefaultColumns();
    saveAdColumns();
    syncAdColumnOptions();
    renderAdCampaigns();
  }
});
// Перетаскивание пунктов в фильтре «Столбцы»: линия показывает, куда встанет столбец.
const adColumnDrag = { key: '' };
function clearAdColumnDrop() {
  $$('.column-option').forEach(item => item.classList.remove('dragging', 'drop-before', 'drop-after'));
}
document.addEventListener('dragstart', event => {
  const item = event.target.closest?.('[data-ad-column]');
  if (!item) return;
  adColumnDrag.key = item.dataset.adColumn;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', adColumnDrag.key);
  item.classList.add('dragging');
});
document.addEventListener('dragover', event => {
  const item = event.target.closest?.('[data-ad-column]');
  if (!item || !adColumnDrag.key) return;
  event.preventDefault();
  const rect = item.getBoundingClientRect(),
    after = event.clientY > rect.top + rect.height / 2;
  $$('.column-option').forEach(option => option.classList.remove('drop-before', 'drop-after'));
  if (item.dataset.adColumn !== adColumnDrag.key) item.classList.add(after ? 'drop-after' : 'drop-before');
});
document.addEventListener('drop', event => {
  const item = event.target.closest?.('[data-ad-column]');
  if (!item || !adColumnDrag.key) return;
  event.preventDefault();
  const rect = item.getBoundingClientRect();
  placeAdColumn(adColumnDrag.key, item.dataset.adColumn, event.clientY > rect.top + rect.height / 2);
  clearAdColumnDrop();
  adColumnDrag.key = '';
});
document.addEventListener('dragend', () => {
  clearAdColumnDrop();
  adColumnDrag.key = '';
});
// Кампании каждого товара: строки productDaily (кампания × артикул × день) складываются по паре «артикул + кампания».
// Показываем только кампании, где у артикула за период были показы или расход; внутри товара — по убыванию расхода.
const adProductCampaignCache = new WeakMap();
function adProductCampaigns(ads) {
  if (!ads) return new Map();
  if (adProductCampaignCache.has(ads)) return adProductCampaignCache.get(ads);
  const campaigns = new Map((ads.campaigns || []).map(c => [String(c.id), c])),
    pairs = new Map();
  for (const row of ads.productDaily || []) {
    if (row.advertId === undefined) continue;
    const key = `${row.nmId}:${row.advertId}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { nmId: row.nmId, advertId: row.advertId, views: 0, clicks: 0, spend: 0, carts: 0, orders: 0, revenue: 0 };
      pairs.set(key, pair);
    }
    ['views', 'clicks', 'spend', 'carts', 'orders', 'revenue'].forEach(k => (pair[k] += Number(row[k] || 0)));
  }
  const byProduct = new Map();
  for (const pair of pairs.values()) {
    if (!pair.views && !pair.spend) continue;
    const c = campaigns.get(String(pair.advertId)) || {},
      ratio = (a, b, m = 100) => (b ? (a / b) * m : 0);
    const row = {
      ...pair,
      name: c.name || `Кампания #${pair.advertId}`,
      status: c.status,
      paymentType: c.paymentType,
      bidType: c.bidType,
      ctr: ratio(pair.clicks, pair.views),
      cpm: ratio(pair.spend, pair.views, 1000),
      cr: ratio(pair.orders, pair.clicks),
      cpo: ratio(pair.spend, pair.orders, 1),
      drr: ratio(pair.spend, pair.revenue)
    };
    const key = String(pair.nmId);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(row);
  }
  byProduct.forEach(list => list.sort((a, b) => b.spend - a.spend));
  adProductCampaignCache.set(ads, byProduct);
  return byProduct;
}
// nested — строка кампании внутри товара: заказы воронки относятся к товару целиком, у кампании их нет.
function adProductMetricCells(x, nested = false) {
  return `<td>${fmtRub(x.spend)}</td><td>${fmtNum(x.views)}</td><td>${fmtNum(x.clicks)}</td><td>${fmtPercent(x.ctr)}</td><td>${fmtRub(x.cpm)}</td><td>${fmtNum(x.carts)}</td><td>${fmtNum(x.orders)}</td><td>${nested ? '' : adFunnelCell(x)}</td><td>${fmtPercent(x.cr)}</td><td>${adCpo(x)}</td><td>${fmtRub(x.revenue)}</td><td>${fmtPercent(x.drr)}</td>`;
}
function adProductCampaignRow(x) {
  const s = adStatus(x.status),
    query = new URLSearchParams({ cabinet: state.cabinet, id: x.advertId, from: $('#dateFrom').value, to: $('#dateTo').value });
  return `<tr class="ad-product-campaign"><td><div class="ad-product-campaign-name"><span><strong><a href="/campaign.html?${query}" target="_blank" rel="noopener noreferrer" title="Открыть детализацию кампании">${escapeHtml(x.name)}</a></strong><small><button type="button" class="copy-article" data-copy="${escapeHtml(x.advertId)}" title="Скопировать ID">ID ${escapeHtml(x.advertId)}</button> · <span class="status ${s[1]}">${s[0]}</span>${x.paymentType ? ` · ${escapeHtml(x.paymentType.toUpperCase())}` : ''}</small></span></div></td>${adProductMetricCells(x, true)}</tr>`;
}
function renderAdProducts(items) {
  const rows = [...items].sort((a, b) => {
    const key = state.adProductSort.key,
      av = a[key] ?? '',
      bv = b[key] ?? '',
      result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru', { numeric: true });
    return state.adProductSort.dir === 'asc' ? result : -result;
  });
  const byProduct = adProductCampaigns(state.ads);
  $('#adProductsBody').innerHTML = rows.length
    ? rows
        .map(x => {
          const photo = x.photo ? `<img class="ad-product-photo" src="${escapeHtml(x.photo)}" alt="" loading="lazy">` : '',
            key = String(x.nmId),
            campaigns = byProduct.get(key) || [],
            open = campaigns.length && state.adProductOpen.has(key);
          const toggle = campaigns.length
            ? `<button type="button" class="ad-product-toggle" data-ad-product-toggle="${escapeHtml(key)}" aria-expanded="${open ? 'true' : 'false'}" title="Кампании с этим товаром: ${campaigns.length}" aria-label="Кампании с товаром ${escapeHtml(key)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5l4.5 4.5L6 12.5"/></svg></button>`
            : '<i class="ad-product-toggle-stub"></i>';
          const detail = x.nmId
              ? `<a class="campaign-open" href="/product.html?${new URLSearchParams({ cabinet: state.cabinet, nmId: x.nmId, from: $('#dateFrom').value, to: $('#dateTo').value })}" target="_blank" rel="noopener noreferrer" title="Открыть детализацию товара: органика и реклама по дням" aria-label="Открыть детализацию товара «${escapeHtml(x.name)}»"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3"/><path d="M6.25 9.75l3.5-3.5M6.75 6.25h3v3"/></svg></a>`
              : '',
            name = x.nmId
              ? `<a class="campaign-wb-link" href="https://www.wildberries.ru/catalog/${encodeURIComponent(x.nmId)}/detail.aspx" target="_blank" rel="noopener noreferrer" title="Открыть товар на WB">${escapeHtml(x.name)}</a>`
              : escapeHtml(x.name);
          return `<tr${open ? ' class="ad-product-open"' : ''}><td><div class="ad-product-name">${toggle}${detail}${photo}<span><strong>${name}</strong><small><button class="copy-article" data-copy="${escapeHtml(x.nmId || '')}">Арт. WB ${escapeHtml(x.nmId || '—')}</button>${x.vendorCode ? ` · <button class="copy-article" data-copy="${escapeHtml(x.vendorCode)}">${escapeHtml(x.vendorCode)}</button>` : ''}${x.barcode ? ` · <button class="copy-article" data-copy="${escapeHtml(x.barcode)}">${escapeHtml(x.barcode)}</button>` : ''}</small></span></div></td>${adProductMetricCells(x)}</tr>${open ? campaigns.map(adProductCampaignRow).join('') : ''}`;
        })
        .join('')
    : '<tr><td colspan="13" class="empty-row">WB не вернул детализацию по товарам за этот период</td></tr>';
  bindAdPhotoPreviews('#adProductsBody');
  $('#adProductsBody').onclick = event => {
    const button = event.target.closest('[data-ad-product-toggle]');
    if (!button) return;
    const key = button.dataset.adProductToggle;
    if (state.adProductOpen.has(key)) state.adProductOpen.delete(key);
    else state.adProductOpen.add(key);
    renderAdProducts(items);
  };
  $$('[data-ad-product-sort]').forEach(header => {
    const tip = AD_TIPS[header.dataset.adProductSort];
    if (tip) {
      header.title = tip;
      header.classList.add('has-tip');
    }
  });
  $$('[data-ad-product-sort]').forEach(
    header =>
      (header.onclick = () => {
        const key = header.dataset.adProductSort;
        state.adProductSort =
          state.adProductSort.key === key ? { key, dir: state.adProductSort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' };
        renderAdProducts(items);
      })
  );
}
