'use strict';
// --- Детализация кампании: бюджет, сводка, статистика по дням и по товарам, окно товара ---

// --- Остаток бюджета (/api/advertising/campaign/budget) — перед кнопкой паузы, с кнопкой «+» для пополнения ---
// WB даёт бюджет только кампаниям, которые готовы к запуску, идут или на паузе; у остальных плашки нет.
// «Хватит примерно на …» — по средним затратам за последние 7 полных дней (сегодняшний день ещё не закончился),
// если они входят в выгруженный период; меньше чем на день — сумма красная.
function avgDailySpend() {
  const loaded = exportState.loaded;
  if (!loaded) return null;
  const today = new Date().toLocaleDateString('sv-SE'),
    spend = new Map(state.rows.map(row => [String(row.date || '').slice(0, 10), Number(row.spend || 0)]));
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const day = new Date(Date.now() - i * 86400000).toLocaleDateString('sv-SE');
    if (day < today && day >= loaded.from && day <= loaded.to) days.push(day);
  }
  return days.length ? { avg: days.reduce((sum, day) => sum + (spend.get(day) || 0), 0) / days.length, days: days.length } : null;
}
function budgetChip() {
  const budget = state.budget?.budget;
  if (budget == null || ![4, 9, 11].includes(state.campaignStatus)) return '';
  const spend = avgDailySpend(),
    left = spend?.avg > 0 ? budget / spend.avg : null,
    low = left != null && left < 1;
  const hint =
    left == null
      ? spend
        ? 'Затрат за последние дни не было — на сколько хватит бюджета, оценить нельзя'
        : 'Оценка на сколько хватит — когда выгружены последние дни'
      : `${left < 1 ? 'Хватит меньше чем на день' : `Хватит примерно на ${number(Math.floor(left))} ${plural(Math.floor(left), ['день', 'дня', 'дней'])}`}: в среднем ${money(Math.round(spend.avg))} в день за последние ${number(spend.days)} ${plural(spend.days, ['день', 'дня', 'дней'])}`;
  return `<span class="campaign-budget${low ? ' low' : ''}" title="${esc(hint)}">Бюджет <strong>${money(budget)}</strong><button type="button" class="budget-add" data-budget-add aria-label="Пополнить бюджет кампании" title="Пополнить бюджет">+</button></span>`;
}
async function loadBudget() {
  const cabinet = params.get('cabinet') || 'demo',
    id = params.get('id') || '';
  try {
    const response = await fetch(`/api/advertising/campaign/budget?cabinet=${encodeURIComponent(cabinet)}&id=${encodeURIComponent(id)}`),
      data = await response.json();
    if (!response.ok) throw new Error(data.error);
    state.budget = data;
  } catch {
    state.budget = null;
  }
  if (state.campaignMeta) renderMeta(state.campaignMeta);
}
// Окно пополнения: сумма (не меньше минимума WB) и источник списания с его остатком.
// Кампания на паузе или готовая к запуску после пополнения сама не запускается, поэтому у неё кнопка «Пополнить и запустить»:
// сначала пополнение, потом запуск. У идущей кампании — просто «Пополнить».
// WB может применить пополнение не мгновенно и ответить на запуск «мало бюджета» — тогда запуск повторяется через 3 с, до двух раз.
// Если запуск так и не прошёл, деньги уже на бюджете кампании: окно говорит об этом и предлагает запустить ещё раз.
async function startAfterDeposit() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postCampaignAction('status', { action: 'start' });
    } catch (e) {
      if (attempt >= 2 || !/бюджет/i.test(e.message)) throw e;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}
async function openBudgetDeposit() {
  $('#confirmTitle').textContent = 'Пополнение бюджета кампании';
  $('#confirmBody').innerHTML = '<p>Загружаем баланс кабинета продвижения…</p>';
  $('#confirmModal').hidden = false;
  let finance;
  try {
    const response = await fetch(`/api/advertising/finance?cabinet=${encodeURIComponent(params.get('cabinet') || 'demo')}`);
    finance = await response.json();
    if (!response.ok) throw new Error(finance.error || `Ошибка ${response.status}`);
  } catch (e) {
    $('#confirmBody').innerHTML =
      `<p class="confirm-error">Не удалось получить баланс: ${esc(e.message)}</p><div class="confirm-buttons"><button type="button" class="secondary" data-confirm-close>Понятно</button></div>`;
    return;
  }
  if ($('#confirmModal').hidden) return;
  // Источники — только те, на которых есть деньги (как в окне пополнения WB).
  const min = finance.minTopUp,
    sources = (finance.sources || []).filter(source => source.amount > 0),
    first = sources.find(source => source.amount >= min) || sources[0];
  const startAfter = [4, 11].includes(state.campaignStatus),
    label = startAfter ? 'Пополнить и запустить' : 'Пополнить';
  $('#confirmBody').innerHTML =
    `<form class="budget-form" id="budgetForm" novalidate>` +
    `<label class="budget-sum">Сумма пополнения, ₽<input id="budgetSum" type="number" min="${min}" step="1" value="${min}" inputmode="numeric"></label><small>Минимальная сумма — ${money(min)}</small>` +
    `<fieldset class="budget-sources"><legend>Источник списания</legend>${sources.map(source => `<label><input type="radio" name="budgetSource" value="${source.type}" ${source === first ? 'checked' : ''}><span>${esc(source.name)}</span><b>${money(source.amount)}</b></label>`).join('') || '<p class="confirm-error">На счетах продвижения нет денег — пополните счёт в кабинете WB.</p>'}</fieldset>` +
    `<p class="confirm-error" id="confirmError" hidden></p>` +
    `<div class="confirm-buttons"><button type="button" class="secondary" data-confirm-close>Отменить</button><button type="submit" class="include" id="confirmRun" ${sources.length ? '' : 'disabled'}>${label}</button></div></form>`;
  $('#budgetSum').focus();
  $('#budgetSum').select();
  $('#budgetForm').onsubmit = async event => {
    event.preventDefault();
    const sum = Number($('#budgetSum').value),
      type = Number(document.querySelector('input[name="budgetSource"]:checked')?.value),
      source = sources.find(item => item.type === type),
      error = $('#confirmError'),
      button = $('#confirmRun');
    const fail = text => {
      error.textContent = text;
      error.hidden = false;
    };
    if (!Number.isInteger(sum) || sum < min) return fail(`Введите целое число рублей не меньше ${money(min)}`);
    if (!source) return fail('Выберите источник списания');
    if (source.amount < sum) return fail(`На источнике «${source.name}» только ${money(source.amount)}`);
    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Пополняем бюджет…';
    let result;
    try {
      result = await postCampaignAction('budget/deposit', { sum, type });
    } catch (e) {
      fail(`Не удалось пополнить: ${e.message}`);
      button.disabled = false;
      button.textContent = label;
      return;
    }
    state.budget = { ...(state.budget || {}), budget: result.budget };
    if (state.campaignMeta) renderMeta(state.campaignMeta);
    const text = `Пополнено на ${money(sum)} из источника «${source.name}». Бюджет кампании — ${result.budget == null ? 'обновится чуть позже' : money(result.budget)}.`;
    if (!startAfter) return openActionConfirm({ title: 'Бюджет пополнен', text });
    const started = status => {
      renderMeta({ ...state.campaignMeta, status });
      if (state.setup) renderSetup(state.setup);
    };
    button.textContent = 'Запускаем кампанию…';
    try {
      const result = await startAfterDeposit();
      started(result.status);
      openActionConfirm({ title: 'Бюджет пополнен, кампания запущена', text });
    } catch (e) {
      openActionConfirm({
        title: 'Бюджет пополнен, но кампания не запустилась',
        text: `${text} Запуск не прошёл: ${e.message}`,
        note: 'Деньги уже на бюджете кампании — повторно пополнять не нужно.',
        button: 'Запустить кампанию',
        kind: 'include',
        run: async () => {
          const result = await postCampaignAction('status', { action: 'start' });
          started(result.status);
        }
      });
    }
  };
}
// Карточки с изменением к прошлому периоду той же длины (state.previous — /api/advertising/campaign/previous).
// CTR и CPC — за весь период (клики ÷ показы, затраты ÷ клики), а не среднее по дням: так они сравнимы с прошлым периодом.
// up — рост хорош (зелёный), down — рост плох (красный), neutral — затраты: рост сам по себе ни хорош, ни плох.
const SUMMARY_TONES = {
  views: 'up',
  clicks: 'up',
  orders: 'up',
  revenue: 'up',
  spend: 'neutral',
  drr: 'down',
  ctr: 'up',
  cpc: 'down',
  carts: 'up',
  canceled: 'down'
};
function summaryDelta(key, now, p = state.previous) {
  if (!p) return '';
  if (p.loading) return '<small class="metric-delta flat" title="Загружаем прошлый период">…</small>';
  if (!p.available || !p.campaign || p.campaign[key] == null) return '';
  const before = Number(p.campaign[key] || 0),
    value = Number(now || 0),
    title = `к ${date(p.period.from)} – ${date(p.period.to)}: ${['spend', 'revenue', 'cpc'].includes(key) ? money(before) : ['drr', 'ctr'].includes(key) ? percent(before) : number(before)}`;
  if (['drr', 'ctr', 'cpc'].includes(key) && (!value || !before)) return '';
  if (!before) return value ? `<small class="metric-delta flat" title="${esc(title)}">новое</small>` : '';
  const change = Math.round(((value - before) / before) * 100),
    tone = !change || SUMMARY_TONES[key] === 'neutral' ? 'flat' : change > 0 === (SUMMARY_TONES[key] === 'up') ? 'up' : 'down';
  return `<small class="metric-delta ${tone}" title="${esc(title)}">${change ? `${change > 0 ? '▲' : '▼'} ${number(Math.abs(change))}%` : '0%'}</small>`;
}
function renderSummary(c) {
  state.summaryCampaign = c;
  const zone = SUMMARY_ZONES[state.summaryZone] ? zoneSummary(state.summaryZone) : null;
  $('#summaryZoneNote').hidden = !zone;
  $('#summaryZoneNote').innerHTML = zone?.note || '';
  if (zone) c = zone.campaign;
  const ctr = c.ctr ?? average('ctr'),
    cpc = c.cpc ?? average('cpc'),
    drr = Number(c.revenue) ? (Number(c.spend || 0) / Number(c.revenue)) * 100 : 0,
    carts = c.carts ?? total('carts'),
    canceled = zone ? null : (c.canceled ?? total('canceled'));
  const cards = [
    ['Показы', number(c.views), 'views', c.views],
    ['Клики', number(c.clicks), 'clicks', c.clicks],
    ['Рекламные заказы', number(c.orders), 'orders', c.orders],
    ['Сумма заказов', money(c.revenue), 'revenue', c.revenue],
    ['Затраты', money(c.spend), 'spend', c.spend],
    ['ДРР за период', percent(drr), 'drr', drr],
    ['Средний CTR', percent(ctr), 'ctr', ctr],
    ['Средний CPC', money(cpc), 'cpc', cpc],
    ['Добавления в корзину', number(carts), 'carts', carts],
    ['Отмены', canceled == null ? '—' : number(canceled), 'canceled', canceled]
  ];
  const previous = zone ? zone.previous : state.previous;
  $('#summary').innerHTML = cards
    .map(
      x =>
        `<div class="metric"${zone && x[3] == null ? ' title="Отмен по местам показа WB не отдаёт"' : ''}><span>${x[0]}</span><strong>${x[1]}</strong>${x[3] == null ? '' : summaryDelta(x[2], x[3], previous)}</div>`
    )
    .join('');
}
// Карточки по месту показа («Поиск» — поиск вместе с каталогом, «Рекомендации» — полки): из данных расширения по зонам,
// по всем артикулам кампании. Если расширение прислало не все дни, сумма — по имеющимся, и над карточками сказано, каких нет.
// Прошлый период для сравнения — тоже из зон и только если там есть все дни жизни кампании.
const SUMMARY_ZONES = {
  search: { key: 'searchCatalog', name: 'Поиск (вместе с каталогом)' },
  shelves: { key: 'shelves', name: 'Рекомендации (полки)' }
};
function zoneSummary(view) {
  const range = zoneRange(),
    zone = SUMMARY_ZONES[view],
    days = zones.data?.days || {};
  const empty = { views: 0, clicks: 0, orders: 0, revenue: 0, spend: 0, carts: 0, ctr: 0, cpc: 0 };
  if (!range) return { campaign: empty, previous: null, note: 'Загрузка данных по зонам…' };
  const sum = (from, to) => {
    const m = zoneEmpty();
    let have = 0;
    for (const d of zoneDates(from, to))
      if (days[d]) {
        have++;
        zoneAdd(m, zoneSum(days[d][zone.key], null));
      }
    return {
      have,
      campaign: {
        views: m.views,
        clicks: m.clicks,
        orders: m.orders,
        revenue: m.sum_price,
        spend: m.spend,
        carts: m.atbs,
        ctr: m.views ? (m.clicks / m.views) * 100 : 0,
        cpc: m.clicks ? m.spend / m.clicks : 0
      }
    };
  };
  const now = sum(range.from, range.to);
  const life =
    state.period && state.period.from <= state.period.to
      ? {
          from: state.period.from > range.from ? state.period.from : range.from,
          to: state.period.to < range.to ? state.period.to : range.to
        }
      : range;
  const lifeDates = life.from <= life.to ? zoneDates(life.from, life.to) : [],
    lacking = lifeDates.filter(d => !days[d]).length,
    missing = zoneMissing(lifeDates, new Set(Object.keys(days)));
  const created = String(state.campaignCreatedAt || '').slice(0, 10),
    p = state.previous;
  let previous = null;
  if (p?.available && p.period) {
    const from = created > p.period.from ? created : p.period.from,
      before = from <= p.period.to ? zoneDates(from, p.period.to) : [];
    if (before.length && before.every(d => days[d]))
      previous = { available: true, period: p.period, campaign: sum(p.period.from, p.period.to).campaign };
  }
  const cmp = $('#campaignWbLink')?.href,
    wb = cmp ? `<a href="${esc(cmp)}" target="_blank" rel="noopener noreferrer">кабинета WB</a>` : 'кабинета WB';
  const note = !zones.data
    ? 'Загрузка данных по зонам…'
    : !now.have
      ? `${zone.name}: данных по зонам за этот период нет — их присылает расширение Chrome из ${wb}.`
      : `${zone.name}, по данным расширения${missing ? ` · по зонам есть ${lifeDates.length - lacking} из ${lifeDates.length} дн., нет: ${missing}` : ''}${previous ? '' : ' · сравнения с прошлым периодом нет: по зонам он загружен не весь'}. Отмен по местам показа WB не отдаёт.`;
  return { campaign: now.campaign, previous, note };
}
async function loadPrevious(period, campaign) {
  const request = (state.previousRequest = (state.previousRequest || 0) + 1);
  state.previous = { loading: true };
  renderSummary(campaign);
  try {
    const q = new URLSearchParams({
      cabinet: params.get('cabinet') || 'demo',
      id: params.get('id') || '',
      from: period.from,
      to: period.to
    });
    const response = await fetch(`/api/advertising/campaign/previous?${q}`),
      data = await response.json();
    if (!response.ok) throw new Error(data.error || 'не загрузилось');
    if (request !== state.previousRequest) return;
    state.previous = data;
  } catch (e) {
    if (request !== state.previousRequest) return;
    state.previous = null;
  }
  renderSummary(campaign);
}
// «Статистика по датам»: средняя позиция дня — из статистики кластеров по дням (state.positions).
function renderDailyHead() {
  const head = $('#dailyHead'),
    columns = visibleColumns('daily');
  head.innerHTML = '<th data-key="date">Дата ↕</th>' + columns.map(column => metricHead(column, 'data-key')).join('');
  resetResizable(head.closest('table'), `daily:${columns.map(column => column.key).join(',')}`);
}
const metricCell = (column, row) =>
  `<td class="c-metric c-${column.key}">${column.key === 'drr' && row.drr == null && Number(row.spend) ? '<span title="Нет рекламной выручки — ДРР не определён">—</span>' : esc(metricText(column.key, row[column.key]))}</td>`;
function renderTable() {
  const columns = visibleColumns('daily'),
    spend = state.rows.reduce((sum, row) => sum + Number(row.spend || 0), 0);
  const all = state.rows.map(row => ({ ...withMetrics(row, spend), avgPosition: state.positions.get(row.date) ?? null })),
    rows = sortedWithBlanks(all, state.sort);
  const sum = { ...withMetrics(totals(state.rows), spend), avgPosition: weightedPosition(all) };
  $('#dailyBody').innerHTML = rows.length
    ? `<tr class="total-row"><td>Итого · ${number(state.rows.length)} дн.</td>${columns.map(column => metricCell(column, sum)).join('')}</tr>` +
      rows.map(row => `<tr><td>${esc(date(row.date))}</td>${columns.map(column => metricCell(column, row)).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length + 1}" class="empty">Нет дневных данных за выбранный период</td></tr>`;
}
function aggregateProducts() {
  const totals = new Map(),
    sumKeys = ['views', 'clicks', 'carts', 'orders', 'canceled', 'revenue', 'spend'];
  for (const row of state.productDaily) {
    const key = String(row.nmId || '');
    if (!key) continue;
    let total = totals.get(key);
    if (!total) {
      total = { nmId: row.nmId, name: '', photo: '', vendorCode: '' };
      sumKeys.forEach(k => (total[k] = 0));
      totals.set(key, total);
    }
    if (!total.name && row.name) total.name = row.name;
    if (!total.photo && row.photo) total.photo = row.photo;
    if (!total.vendorCode && row.vendorCode) total.vendorCode = row.vendorCode;
    sumKeys.forEach(k => (total[k] += Number(row[k] || 0)));
  }
  return [...totals.values()].map(row => ({
    ...row,
    name: row.name || `Товар ${row.nmId}`,
    ctr: row.views ? (row.clicks / row.views) * 100 : 0,
    cpc: row.clicks ? row.spend / row.clicks : 0,
    drr: row.revenue ? (row.spend / row.revenue) * 100 : 0
  }));
}
// Детализация артикула по дням открывается кнопкой со стрелкой слева от названия.
const productOpenButton = row =>
  `<button class="product-open" type="button" data-product-id="${esc(row.nmId)}" title="Статистика артикула по дням" aria-label="Статистика артикула ${esc(row.nmId)} по дням"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 10.5l5-5M6.5 5.5h4v4"/></svg></button>`;
// «Статистика по дням каждого артикула»: средняя позиция артикула — по его поисковым кластерам из «Ключевых запросов».
function renderProductHead() {
  const head = $('#productHead'),
    columns = visibleColumns('product');
  head.innerHTML =
    '<th data-product-key="name">Название ↕</th><th data-product-key="nmId" title="Артикул WB">Арт. WB ↕</th>' +
    columns.map(column => metricHead(column, 'data-product-key')).join('');
  resetResizable(head.closest('table'), `product:${columns.map(column => column.key).join(',')}`);
}
function renderProductTable() {
  const columns = visibleColumns('product'),
    base = aggregateProducts(),
    spend = base.reduce((sum, row) => sum + Number(row.spend || 0), 0);
  const all = base.map(row => ({ ...withMetrics(row, spend), avgPosition: weightedPosition(keywords.data?.byNmId?.[row.nmId] || []) })),
    rows = sortedWithBlanks(all, state.productSort);
  const sum = { ...withMetrics(totals(base), spend), avgPosition: weightedPosition(keywords.data?.total || []) };
  $('#productDailyBody').innerHTML = rows.length
    ? `<tr class="total-row"><td>Итого · ${number(rows.length)} ${plural(rows.length, ['артикул', 'артикула', 'артикулов'])}</td><td></td>${columns.map(column => metricCell(column, sum)).join('')}</tr>` +
      rows
        .map(
          row =>
            `<tr><td><div class="product-name-cell">${productOpenButton(row)}${photoCell(row)}</div></td><td>${esc(row.nmId || '—')}</td>${columns.map(column => metricCell(column, row)).join('')}</tr>`
        )
        .join('')
    : `<tr><td colspan="${columns.length + 2}" class="empty">Нет данных по артикулам за выбранный период</td></tr>`;
  $('#productDailyBody')
    .querySelectorAll('[data-product-id]')
    .forEach(button => (button.onclick = () => openProductModal(button.dataset.productId)));
  bindPhotoPreviews('#productDailyBody');
}
function openProductModal(nmId) {
  const rows = state.productDaily
    .filter(row => String(row.nmId) === String(nmId))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const first = rows.find(row => row.name) || rows[0] || {};
  $('#productModalTitle').textContent = `Артикул ${nmId} · ${first.name || 'Статистика по дням'}`;
  $('#productModalBody').innerHTML = rows.length
    ? `<tr class="total-row"><td>Итого · ${number(rows.length)} дн.</td>${['views', 'clicks', 'ctr', 'cpc', 'carts', 'orders', 'canceled', 'revenue', 'spend', 'drr'].map(k => `<td>${esc(fmt(k, totals(rows)[k]))}</td>`).join('')}</tr>` +
      rows
        .map(
          r =>
            `<tr>${['date', 'views', 'clicks', 'ctr', 'cpc', 'carts', 'orders', 'canceled', 'revenue', 'spend', 'drr'].map(k => `<td>${esc(fmt(k, r[k]))}</td>`).join('')}</tr>`
        )
        .join('')
    : '<tr><td colspan="11" class="empty">Нет дневных данных по этому артикулу</td></tr>';
  $('#productModal').hidden = false;
}
function closeProductModal() {
  $('#productModal').hidden = true;
}
