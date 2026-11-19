'use strict';
// --- Детализация кампании (campaign.html): общее — состояние, форматы, столбцы-показатели, фото товаров ---
// Скрипты страницы подключаются по порядку (campaign-core.js первым, campaign.js последним); общие имена — из этого
// файла, остальные части берут их только внутри функций и обработчиков.

const params = new URLSearchParams(location.search);
const state = {
  rows: [],
  productDaily: [],
  sort: { key: 'date', direction: 'desc' },
  productSort: { key: 'spend', direction: 'desc' },
  visibleMetrics: new Set(['views', 'clicks', 'orders', 'spend', 'drr', 'avgPosition']),
  visibleCards: new Set(),
  positions: new Map()
};
const chartMetrics = [
  { key: 'views', label: 'Показы', color: '#277a70' },
  { key: 'clicks', label: 'Клики', color: '#d77b28' },
  { key: 'carts', label: 'Корзины', color: '#4d8f63' },
  { key: 'orders', label: 'Заказы', color: '#b35b45' },
  { key: 'spend', label: 'Затраты', color: '#5a7d9a' },
  { key: 'revenue', label: 'Сумма заказов', color: '#8b6b3f' },
  { key: 'drr', label: 'ДРР', color: '#7651e5' },
  { key: 'avgPosition', label: 'Ср. позиция', color: '#c35fb8' }
];
// Значение линии графика за день. ДРР без рекламной выручки не определён (расход есть, заказов нет) — на графике разрыв, а не 0.
// Средняя позиция приходит отдельно (статистика поисковых кластеров по дням); дни без неё — тоже разрыв.
function chartValue(s, row, byDay) {
  if (s.card) return Number(byDay.get(`${s.card}:${row.date}`)?.spend || 0);
  if (s.key === 'drr' && !Number(row.revenue)) return null;
  if (s.key === 'avgPosition') return state.positions.get(row.date) ?? null;
  return Number(row[s.key] || 0);
}
const $ = s => document.querySelector(s),
  number = v => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }),
  money = v => `${number(v)} ₽`,
  percent = v => `${number(v)}%`,
  date = v => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('ru-RU');
  },
  esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]),
  total = k => state.rows.reduce((s, r) => s + Number(r[k] || 0), 0),
  average = k => (state.rows.length ? total(k) / state.rows.length : 0);
const fmt = (k, v) =>
  k === 'date' ? date(v) : ['spend', 'revenue', 'cpc'].includes(k) ? money(v) : ['ctr', 'drr'].includes(k) ? percent(v) : number(v);
function sorted(rows, sort) {
  return [...rows].sort((a, b) => {
    const av = a[sort.key] ?? '',
      bv = b[sort.key] ?? '',
      r = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru', { numeric: true });
    return sort.direction === 'asc' ? r : -r;
  });
}
const AD_STATUSES = { 4: 'Готова к запуску', 7: 'Завершена', 8: 'Отказался', 9: 'Идут показы', 11: 'На паузе' };
const AD_BIDS = { manual: 'Ручные ставки', unified: 'Единая ставка', auto: 'Автоставка' };
const SUM_KEYS = ['views', 'clicks', 'carts', 'orders', 'canceled', 'revenue', 'spend'];
function totals(rows) {
  const t = {};
  SUM_KEYS.forEach(k => (t[k] = rows.reduce((sum, row) => sum + Number(row[k] || 0), 0)));
  t.ctr = t.views ? (t.clicks / t.views) * 100 : 0;
  t.cpc = t.clicks ? t.spend / t.clicks : 0;
  t.drr = t.revenue ? (t.spend / t.revenue) * 100 : 0;
  return t;
}
// --- Единый набор столбцов-показателей: «Статистика по датам», «по дням каждого артикула» и «Ключевые запросы» ---
// Порядок во всех трёх одинаковый; в каждой таблице его можно поменять и скрыть лишнее (меню «Столбцы», хранится в браузере).
// Отмен, суммы заказов и ДРР по поисковым запросам WB не отдаёт — в «Ключевых запросах» этих столбцов нет.
const METRIC_COLUMNS = [
  { key: 'views', label: 'Показы' },
  { key: 'clicks', label: 'Клики' },
  { key: 'ctr', label: 'CTR', title: 'Клики ÷ показы' },
  { key: 'cpm', label: 'CPM', title: 'Затраты на 1000 показов' },
  { key: 'cpc', label: 'CPC', title: 'Затраты ÷ клики' },
  { key: 'spend', label: 'Затраты' },
  { key: 'spendShare', label: 'Доля расходов', title: 'Доля в затратах за период' },
  { key: 'carts', label: 'Корзины' },
  { key: 'cartCost', label: 'Цена корзины', title: 'Затраты ÷ корзины' },
  { key: 'orders', label: 'Заказы' },
  { key: 'cr', label: 'CR', title: 'Заказы ÷ клики' },
  { key: 'cpo', label: 'CPO', title: 'Затраты ÷ заказы' },
  { key: 'canceled', label: 'Отмены' },
  { key: 'revenue', label: 'Сумма заказов' },
  { key: 'drr', label: 'ДРР, %', title: 'Затраты ÷ сумма заказов' },
  { key: 'avgPosition', label: 'Ср. позиция', title: 'Средняя позиция в поиске по кластерам, взвешенная по показам' }
];
const COLUMN_TABLES = {
  daily: METRIC_COLUMNS,
  product: METRIC_COLUMNS,
  keywords: METRIC_COLUMNS.filter(column => !['canceled', 'revenue', 'drr'].includes(column.key))
};
const MONEY_METRICS = ['spend', 'revenue', 'cpc', 'cpm', 'cartCost', 'cpo'],
  PERCENT_METRICS = ['ctr', 'drr', 'cr', 'spendShare'];
// null — показатель не определён (деление на ноль) или WB его не прислал: прочерк, а не 0.
const metricText = (key, value) =>
  value == null || !Number.isFinite(Number(value))
    ? '—'
    : MONEY_METRICS.includes(key)
      ? money(value)
      : PERCENT_METRICS.includes(key)
        ? percent(value)
        : key === 'avgPosition'
          ? Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
          : number(value);
function withMetrics(row, totalSpend) {
  const value = key => Number(row[key] || 0),
    spend = value('spend'),
    views = value('views'),
    clicks = value('clicks'),
    carts = value('carts'),
    orders = value('orders'),
    revenue = value('revenue');
  return {
    ...row,
    ctr: views ? (clicks / views) * 100 : 0,
    cpm: views ? (spend / views) * 1000 : null,
    cpc: clicks ? spend / clicks : 0,
    spendShare: totalSpend ? (spend / totalSpend) * 100 : 0,
    cartCost: carts ? spend / carts : null,
    cr: clicks ? (orders / clicks) * 100 : 0,
    cpo: orders ? spend / orders : null,
    drr: revenue ? (spend / revenue) * 100 : spend ? null : 0
  };
}
// Средняя позиция по строкам с позицией, взвешенная по показам (у CPC-кампаний показов нет — каждая строка с весом 1).
function weightedPosition(rows = []) {
  let weight = 0,
    sum = 0;
  for (const row of rows) {
    const position = Number(row.avgPosition);
    if (!position) continue;
    const w = Number(row.views) || 1;
    sum += position * w;
    weight += w;
  }
  return weight ? sum / weight : null;
}
// Сортировка с пустыми значениями в конце в любом направлении.
const sortedWithBlanks = (rows, sort) => [
  ...sorted(
    rows.filter(row => row[sort.key] != null),
    sort
  ),
  ...rows.filter(row => row[sort.key] == null)
];
const columnLayouts = {};
function columnLayout(table) {
  if (columnLayouts[table]) return columnLayouts[table];
  const defaults = COLUMN_TABLES[table].map(column => ({ key: column.key, visible: true })),
    known = new Set(defaults.map(column => column.key));
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(`wb-campaign-columns:${table}`) || '[]');
  } catch {}
  const layout = (Array.isArray(saved) ? saved : [])
    .filter(item => known.has(item?.key))
    .map(item => ({ key: item.key, visible: item.visible !== false }));
  // Столбцы, которых не было в сохранённом наборе, встают после своего соседа по умолчанию, а не в конец.
  defaults.forEach((item, index) => {
    if (layout.some(column => column.key === item.key)) return;
    const before = defaults
        .slice(0, index)
        .reverse()
        .find(column => layout.some(saved => saved.key === column.key)),
      at = before ? layout.findIndex(saved => saved.key === before.key) + 1 : 0;
    layout.splice(at, 0, item);
  });
  return (columnLayouts[table] = layout);
}
const visibleColumns = table =>
  columnLayout(table)
    .filter(item => item.visible)
    .map(item => COLUMN_TABLES[table].find(column => column.key === item.key));
const metricHead = (column, attr) =>
  `<th ${attr}="${column.key}" class="c-metric c-${column.key}"${column.title ? ` title="${esc(column.title)}"` : ''}>${esc(column.label)} ↕</th>`;
function saveColumnLayout(table, layout) {
  columnLayouts[table] = layout;
  try {
    localStorage.setItem(`wb-campaign-columns:${table}`, JSON.stringify(layout));
  } catch {}
  renderColumnsMenu(table);
  rerenderMetricTable(table);
}
function renderColumnsMenu(table) {
  const box = document.querySelector(`[data-columns-table="${table}"] .columns-options`);
  if (!box) return;
  const layout = columnLayout(table);
  box.innerHTML =
    layout
      .map((item, index) => {
        const column = COLUMN_TABLES[table].find(entry => entry.key === item.key);
        return (
          `<label class="column-row"><input type="checkbox" data-column-toggle="${column.key}" ${item.visible ? 'checked' : ''}><span>${esc(column.label)}${column.title ? `<small>${esc(column.title)}</small>` : ''}</span>` +
          `<button type="button" data-column-move="-1" data-column-key="${column.key}" aria-label="Выше" ${index ? '' : 'disabled'}>↑</button><button type="button" data-column-move="1" data-column-key="${column.key}" aria-label="Ниже" ${index < layout.length - 1 ? '' : 'disabled'}>↓</button></label>`
        );
      })
      .join('') + '<button type="button" class="columns-reset" data-columns-reset>Вернуть все столбцы и порядок по умолчанию</button>';
}
function rerenderMetricTable(table) {
  if (table === 'daily') {
    renderDailyHead();
    renderTable();
  } else if (table === 'product') {
    renderProductHead();
    renderProductTable();
  } else {
    renderKeywordHead();
    renderKeywords();
  }
}
// Заголовки перерисованы (другой набор столбцов): ширины применяются заново по каждому столбцу — общий модуль column-widths.js.
function resetResizable(table) {
  initColumnWidths(table);
}
document.addEventListener('change', event => {
  const toggle = event.target.closest('[data-column-toggle]');
  if (!toggle) return;
  const table = toggle.closest('[data-columns-table]').dataset.columnsTable,
    key = toggle.dataset.columnToggle;
  // Скрытый столбец не должен незаметно фильтровать запросы своим «от — до».
  if (table === 'keywords' && !toggle.checked) delete keywords.ranges[key];
  saveColumnLayout(
    table,
    columnLayout(table).map(item => (item.key === key ? { ...item, visible: toggle.checked } : item))
  );
});
document.addEventListener('click', event => {
  const move = event.target.closest('[data-column-move]'),
    reset = event.target.closest('[data-columns-reset]');
  if (!move && !reset) return;
  event.preventDefault();
  const table = event.target.closest('[data-columns-table]').dataset.columnsTable;
  if (reset) {
    try {
      localStorage.removeItem(`wb-campaign-columns:${table}`);
    } catch {}
    delete columnLayouts[table];
    return saveColumnLayout(table, columnLayout(table));
  }
  const layout = [...columnLayout(table)],
    index = layout.findIndex(item => item.key === move.dataset.columnKey),
    target = index + Number(move.dataset.columnMove);
  if (index < 0 || target < 0 || target >= layout.length) return;
  [layout[index], layout[target]] = [layout[target], layout[index]];
  saveColumnLayout(table, layout);
});
function photoCell(row) {
  const photo = row.photo
    ? `<img class="product-photo" src="${esc(row.photo)}" alt="" loading="lazy">`
    : '<i class="product-photo-stub"></i>';
  return `<div class="product-cell" title="${esc(row.name || `Товар ${row.nmId}`)}">${photo}<span><b>${esc(row.name || `Товар ${row.nmId}`)}</b>${row.vendorCode ? `<small>${esc(row.vendorCode)}</small>` : ''}</span></div>`;
}
// Увеличенное фото — одно окно на страницу, как в app.js: прячется и тогда, когда миниатюру убрали при перерисовке таблицы
// (автообновление раз в 2 минуты) — раньше окно в таком случае зависало.
const photoPreview = { el: null, owner: null };
function hidePhotoPreview() {
  photoPreview.el?.remove();
  photoPreview.el = null;
  photoPreview.owner = null;
}
function bindPhotoPreview(image) {
  image.addEventListener('mouseenter', () => {
    hidePhotoPreview();
    const rect = image.getBoundingClientRect(),
      preview = document.createElement('img');
    preview.className = 'product-photo-preview';
    preview.src = image.currentSrc || image.src;
    preview.alt = '';
    document.body.append(preview);
    const width = preview.offsetWidth,
      height = preview.offsetHeight;
    preview.style.left = `${Math.min(Math.max(8, rect.right + 10), window.innerWidth - width - 8)}px`;
    preview.style.top = `${Math.min(Math.max(8, rect.top + (rect.height - height) / 2), window.innerHeight - height - 8)}px`;
    photoPreview.el = preview;
    photoPreview.owner = image;
  });
  image.addEventListener('mouseleave', () => {
    if (photoPreview.owner === image) hidePhotoPreview();
  });
}
document.addEventListener(
  'mousemove',
  event => {
    if (photoPreview.owner && (event.target !== photoPreview.owner || !photoPreview.owner.isConnected)) hidePhotoPreview();
  },
  { passive: true }
);
['scroll', 'wheel', 'pointerdown'].forEach(type => document.addEventListener(type, hidePhotoPreview, { capture: true, passive: true }));
window.addEventListener('blur', hidePhotoPreview);
function bindPhotoPreviews(selector) {
  document.querySelectorAll(`${selector} .product-photo`).forEach(image => {
    if (image.dataset.previewBound) return;
    image.dataset.previewBound = '1';
    bindPhotoPreview(image);
  });
}
// Дата создания берётся из строки WB (время московское), чтобы часовой пояс браузера не сдвигал день.
const createdDate = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
};
// Идут показы — зеленоватая плашка, на паузе — красноватая.
const AD_STATUS_CLASSES = { 9: 'status-running', 11: 'status-paused' };
// Рядом со статусом — кнопка «Пауза» у активной кампании и «Запустить» у приостановленной или готовой к запуску.
const isDemoCabinet = () => (params.get('cabinet') || 'demo') === 'demo';
function statusActionButton(status) {
  if (isDemoCabinet()) return '';
  if (status === 9)
    return '<button type="button" class="status-action" data-campaign-status="pause" title="Поставить кампанию на паузу в WB">❚❚ Пауза</button>';
  if (status === 4 || status === 11)
    return '<button type="button" class="status-action" data-campaign-status="start" title="Запустить кампанию в WB">▶ Запустить</button>';
  return '';
}
function renderMeta(c) {
  state.campaignMeta = c;
  state.campaignStatus = Number(c.status);
  state.paymentType = String(c.paymentType || '').toLowerCase();
  const status = AD_STATUSES[Number(c.status)] || '',
    tags = [c.paymentType ? String(c.paymentType).toUpperCase() : '', AD_BIDS[String(c.bidType)] || c.bidType || ''],
    created = createdDate(c.createdAt);
  $('#campaignMeta').innerHTML =
    tags
      .filter(Boolean)
      .map(x => `<b>${esc(x)}</b>`)
      .join('') +
    (status ? `<b class="${AD_STATUS_CLASSES[Number(c.status)] || ''}">${esc(status)}</b>` : '') +
    budgetChip() +
    statusActionButton(Number(c.status)) +
    (created ? `<span class="campaign-created">Создана ${created}</span>` : '');
}
