'use strict';

// --- Статистика ключевого запроса по дням (кнопка с графиком у запроса) ---
const KEYWORD_DAILY_METRICS = [
  { key: 'clicks', label: 'Клики' },
  { key: 'spend', label: 'Затраты', money: true },
  { key: 'carts', label: 'Корзины' },
  { key: 'orders', label: 'Заказы' },
  { key: 'views', label: 'Показы', views: true },
  { key: 'ctr', label: 'CTR', percent: true, views: true },
  { key: 'cpc', label: 'CPC', money: true },
  { key: 'avgPosition', label: 'Ср. позиция' }
];
const keywordDaily = { data: null, metric: 'clicks', query: '', request: 0 };
function closeKeywordDaily() {
  $('#keywordDailyModal').hidden = true;
}
async function openKeywordDaily(query) {
  const data = keywords.data;
  if (!data) return;
  const request = ++keywordDaily.request;
  keywordDaily.query = query;
  keywordDaily.data = null;
  $('#keywordDailyTitle').textContent = `«${query}» по дням`;
  $('#keywordDailyNote').textContent =
    `${date(data.period.from)} — ${date(data.period.to)} · загружаем из WB, первый запрос может занять до минуты…`;
  $('#keywordDailyMetrics').innerHTML = '';
  $('#keywordDailyChart').innerHTML = '';
  $('#keywordDailyBody').innerHTML = '';
  $('#keywordDailyModal').hidden = false;
  try {
    const response = await fetch('/api/advertising/campaign/keyword-daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cabinet: params.get('cabinet') || 'demo',
        id: params.get('id') || '',
        from: data.period.from,
        to: data.period.to,
        query,
        nmIds: keywords.product ? [keywords.product] : Object.keys(data.byNmId || {})
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'WB не вернул статистику');
    if (request !== keywordDaily.request) return;
    keywordDaily.data = result;
    if (!result.viewsAvailable && KEYWORD_DAILY_METRICS.find(m => m.key === keywordDaily.metric)?.views) keywordDaily.metric = 'clicks';
    renderKeywordDaily();
  } catch (e) {
    if (request === keywordDaily.request) $('#keywordDailyNote').textContent = `Не удалось загрузить: ${e.message}`;
  }
}
function renderKeywordDaily() {
  const result = keywordDaily.data;
  if (!result) return;
  const metrics = KEYWORD_DAILY_METRICS.filter(m => result.viewsAvailable || !m.views),
    metric = metrics.find(m => m.key === keywordDaily.metric) || metrics[0];
  const days = result.days,
    active = days.filter(day => day.clicks || day.spend || day.views).length;
  $('#keywordDailyNote').textContent =
    `${date(result.period.from)} — ${date(result.period.to)} · дней с активностью: ${number(active)} из ${number(days.length)}${keywords.product ? ' · по одному артикулу' : ''}${result.viewsAvailable ? '' : ' · кампания CPC: показы, CTR и CPM WB не отдаёт'}`;
  $('#keywordDailyMetrics').innerHTML = metrics
    .map(m => `<button type="button" class="${m.key === metric.key ? 'active' : ''}" data-kwday-metric="${m.key}">${m.label}</button>`)
    .join('');
  const format = (m, v) => (v == null ? '—' : m.money ? money(v) : m.percent ? percent(v) : number(v));
  // Линейный график выбранного показателя; дни без значения (нет позиции) — разрыв линии.
  const w = 900,
    h = 230,
    left = 56,
    right = 16,
    top = 14,
    bottom = 30,
    pw = w - left - right,
    ph = h - top - bottom,
    values = days.map(day => day[metric.key]);
  const max = chartNiceMax(Math.max(0, ...values.filter(v => v != null))),
    x = i => left + (days.length === 1 ? pw / 2 : (i * pw) / (days.length - 1)),
    y = v => top + ph - (v / max) * ph;
  const grid = [0, 0.5, 1]
    .map(
      r =>
        `<line class="chart-grid" x1="${left}" x2="${w - right}" y1="${y(max * r)}" y2="${y(max * r)}"/><text class="chart-axis" x="${left - 8}" y="${y(max * r) + 4}" text-anchor="end">${esc(chartAxisNumber(max * r))}</text>`
    )
    .join('');
  const step = Math.max(1, Math.ceil(days.length / 8)),
    labels = days
      .map((day, i) =>
        i % step === 0 || i === days.length - 1
          ? `<text class="chart-axis" x="${x(i)}" y="${h - 8}" text-anchor="${i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}">${esc(date(day.date).slice(0, 5))}</text>`
          : ''
      )
      .join('');
  const parts = [];
  let part = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (part.length) parts.push(part);
      part = [];
      return;
    }
    part.push([x(i), y(v), i]);
  });
  if (part.length) parts.push(part);
  const lines = parts
    .map(points =>
      points.length > 1 ? `<polyline class="chart-line" stroke="#7651e5" points="${points.map(p => `${p[0]},${p[1]}`).join(' ')}"/>` : ''
    )
    .join('');
  const dots = parts
    .flat()
    .map(
      ([px, py, i]) =>
        `<circle class="chart-dot" cx="${px}" cy="${py}" r="3.5" fill="#7651e5"><title>${esc(date(days[i].date))}: ${esc(format(metric, values[i]))}</title></circle>`
    )
    .join('');
  $('#keywordDailyChart').innerHTML = values.some(v => v != null)
    ? `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(metric.label)} по дням">${grid}${labels}${lines}${dots}</svg>`
    : '<div class="chart-empty">Нет данных по этому показателю</div>';
  const table = document.querySelector('.kwday-table');
  table.classList.toggle('no-views', !result.viewsAvailable);
  $('#keywordDailyBody').innerHTML = [...days]
    .reverse()
    .map(
      day =>
        `<tr><td>${esc(date(day.date))}</td><td class="views-col">${esc(format({}, day.views))}</td><td>${number(day.clicks)}</td><td class="views-col">${esc(format({ percent: true }, day.ctr))}</td><td class="views-col">${esc(format({ money: true }, day.cpm))}</td><td>${money(day.cpc)}</td><td>${money(day.spend)}</td><td>${number(day.carts)}</td><td>${number(day.orders)}</td><td>${percent(day.cr)}</td><td>${esc(format({}, day.avgPosition))}</td></tr>`
    )
    .join('');
}
$('#keywordsBody').addEventListener('click', event => {
  const button = event.target.closest('[data-keyword-daily]');
  if (button) openKeywordDaily(button.dataset.keywordDaily);
});
document.addEventListener('click', event => {
  const metric = event.target.closest('[data-kwday-metric]');
  if (metric) {
    keywordDaily.metric = metric.dataset.kwdayMetric;
    renderKeywordDaily();
  }
  if (event.target.closest('[data-kwday-close]')) closeKeywordDaily();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#keywordDailyModal').hidden) closeKeywordDaily();
});
