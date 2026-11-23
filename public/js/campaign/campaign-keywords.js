'use strict';
// --- Детализация кампании: ключевые запросы — таблица, фильтры, позиции ---

const keywords = {
  data: null,
  loading: false,
  error: '',
  product: '',
  search: '',
  statusFilter: 'all',
  sort: { key: 'views', direction: 'desc' },
  page: 1,
  pageSize: pageSizeFor('campaign-keywords'),
  selected: new Set(),
  busy: false,
  shown: [],
  ranges: {}
};
// Первые три столбца (галочка, запрос, статус) постоянные; показатели — из меню «Столбцы» (visibleColumns('keywords')).
const plural = (count, forms) => {
  const n = Math.abs(Number(count) || 0) % 100,
    d = n % 10;
  return forms[n > 10 && n < 20 ? 2 : d === 1 ? 0 : d > 1 && d < 5 ? 1 : 2];
};
// Исключать запросы (минус-фразы) WB позволяет только в кампаниях с оплатой за показы.
const keywordsCpc = () => state.paymentType === 'cpc' || keywords.data?.viewsAvailable === false;
// Строки текущего артикула (или всех) с долей расходов, ценой корзины и CPO.
function keywordView() {
  const data = keywords.data;
  if (!data) return { rows: [] };
  const base = keywords.product ? data.byNmId?.[keywords.product] || [] : data.total || [],
    spend = base.reduce((total, row) => total + Number(row.spend || 0), 0);
  // Частично исключён: у одних артикулов кампании запрос активен, у других исключён. Считаем и здесь —
  // в сохранённых раньше запросах у сервера такого статуса ещё не было.
  const rows = base.map(row => ({
    ...row,
    status: row.activeIn && row.excludedIn ? 'partial' : row.status,
    spendShare: spend ? (Number(row.spend || 0) / spend) * 100 : 0,
    cartCost: row.carts ? Number(row.spend || 0) / row.carts : null,
    cpo: row.orders ? Number(row.spend || 0) / row.orders : null
  }));
  return { rows };
}
const KEYWORD_STATUSES = { active: 'Активен', partial: 'Частично исключён', excluded: 'Неактивен', archived: 'В архиве' };
// Фильтр над таблицей: «Исключённые» — неактивные, частично исключённые и архивные.
const KEYWORD_FILTERS = {
  all: () => true,
  active: row => row.status === 'active',
  excluded: row => ['excluded', 'partial', 'archived'].includes(row.status)
};
const keywordStatusCell = row => {
  if (!row.status) return '<span class="keyword-status archived">Нет данных</span>';
  const total = Number(row.activeIn || 0) + Number(row.excludedIn || 0) + Number(row.archivedIn || 0);
  const title =
    row.status === 'partial' ? ` title="Исключён у ${number(row.excludedIn)} из ${number(total)} артикулов, у остальных активен"` : '';
  return `<span class="keyword-status ${row.status}"${title}>${KEYWORD_STATUSES[row.status]}${row.status === 'partial' ? ` · ${number(row.excludedIn)}/${number(total)}` : ''}</span>`;
};
// null — WB этот показатель не прислал (показы, CTR и CPM по CPC-кампаниям), поэтому прочерк, а не 0.
const keywordValue = (key, value) => (key === 'query' ? String(value ?? '') : metricText(key, value));
// Запрос в таблице — ссылка на поиск WB по нему: видно, кто и как стоит в выдаче.
const wbSearchUrl = query => `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(query)}`;
function keywordRows(view) {
  const data = keywords.data;
  if (!data) return [];
  const term = keywords.search.trim().toLowerCase();
  // Фильтры «от — до» над столбцами: строка без значения (прочерк) при заданной границе не проходит.
  const ranges = Object.entries(keywords.ranges).filter(([, range]) => range.min != null || range.max != null);
  const inRanges = row =>
    ranges.every(([key, range]) => {
      const value = row[key];
      if (value == null) return false;
      return (range.min == null || value >= range.min) && (range.max == null || value <= range.max);
    });
  const filtered = view.rows.filter(
    row =>
      (!term || row.query.toLowerCase().includes(term)) &&
      (KEYWORD_FILTERS[keywords.statusFilter] || KEYWORD_FILTERS.all)(row) &&
      inRanges(row)
  );
  // Без показов (CPC-кампании) сортировка по показам, CTR или CPM ничего не упорядочит — тогда сортируем по кликам.
  const unknown = data.viewsAvailable === false && ['views', 'ctr', 'cpm'].includes(keywords.sort.key),
    sort = unknown ? { key: 'clicks', direction: keywords.sort.direction } : keywords.sort;
  // Строки без значения (нет заказов для CPO, нет корзин для их цены) всегда в конце, в любом направлении.
  return [
    ...sorted(
      filtered.filter(row => row[sort.key] != null),
      sort
    ),
    ...filtered.filter(row => row[sort.key] == null)
  ];
}
function keywordStatusNote(rows) {
  const off = rows.filter(row => row.status === 'excluded').length,
    partial = rows.filter(row => row.status === 'partial').length,
    archived = rows.filter(row => row.status === 'archived').length;
  return [
    off ? `неактивных: ${number(off)}` : '',
    partial ? `частично исключённых: ${number(partial)}` : '',
    archived ? `в архиве: ${number(archived)}` : ''
  ].filter(Boolean);
}
function keywordTotals(rows) {
  const sum = key => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const viewsKnown = rows.some(row => row.views != null),
    views = viewsKnown ? sum('views') : null,
    clicks = sum('clicks'),
    spend = sum('spend'),
    orders = sum('orders');
  const carts = sum('carts');
  // Средняя позиция — только по запросам, у которых она есть (взвешенно по показам), как в остальных таблицах.
  return {
    views,
    clicks,
    spend,
    orders,
    carts,
    ctr: viewsKnown ? (views ? (clicks / views) * 100 : 0) : null,
    cpc: clicks ? spend / clicks : 0,
    cpm: viewsKnown ? (views ? (spend / views) * 1000 : 0) : null,
    cr: clicks ? (orders / clicks) * 100 : 0,
    avgPosition: weightedPosition(rows),
    spendShare: sum('spendShare'),
    cartCost: carts ? spend / carts : null,
    cpo: orders ? spend / orders : null
  };
}
// silent — автообновление: таблица не мигает «загрузкой», отмеченные галочками запросы остаются.
async function loadKeywords(period, refresh = false, silent = false) {
  if (!period) return;
  keywords.loading = true;
  keywords.error = '';
  if (!silent) renderKeywords();
  try {
    const q = new URLSearchParams({
      cabinet: params.get('cabinet') || 'demo',
      id: params.get('id') || '',
      from: period.from,
      to: period.to,
      ...(refresh ? { refresh: '1' } : {})
    });
    const response = await fetch(`/api/advertising/campaign/keywords?${q}`);
    if (!response.ok) throw new Error((await response.json()).error || 'Не удалось получить ключевые запросы');
    keywords.data = await response.json();
    if (!silent) keywords.selected.clear();
    if (!keywords.data.byNmId?.[keywords.product]) keywords.product = '';
  } catch (e) {
    keywords.error = e.message;
  } finally {
    // Средняя позиция артикулов в «Статистике по дням каждого артикула» берётся из ключевых запросов — перерисовываем и её.
    keywords.loading = false;
    renderKeywords();
    renderProductTable();
  }
}
function renderKeywords() {
  const note = $('#keywordsNote'),
    body = $('#keywordsBody');
  if (!note) return;
  const data = keywords.data;
  keywordProductFilter.setItems(
    (data?.products || []).map(product => ({
      value: product.nmId,
      label: product.vendorCode || product.name || String(product.nmId),
      hint: [product.nmId, product.vendorCode ? product.name : ''].filter(Boolean).join(' · ')
    }))
  );
  if (keywords.loading && !data) {
    note.textContent = 'Загрузка ключевых запросов…';
    body.innerHTML = '';
    renderKeywordPagination(0);
    return;
  }
  if (keywords.error && !data) {
    note.textContent = `Ошибка: ${keywords.error}`;
    body.innerHTML = '';
    renderKeywordPagination(0);
    return;
  }
  if (!data) {
    note.textContent = '';
    body.innerHTML = '';
    renderKeywordPagination(0);
    return;
  }
  const view = keywordView(),
    rows = keywordRows(view),
    totals = keywordTotals(rows);
  const pageCount = Math.ceil(rows.length / keywords.pageSize);
  keywords.page = Math.min(Math.max(1, keywords.page), Math.max(1, pageCount));
  const shown = rows.slice((keywords.page - 1) * keywords.pageSize, keywords.page * keywords.pageSize);
  // В CPC-кампаниях галочек и панели «Исключить/Включить» нет.
  const cpc = keywordsCpc();
  if (cpc) keywords.selected.clear();
  document.querySelector('.keywords-table').classList.toggle('no-select', cpc);
  const notes = [`${date(data.period.from)} — ${date(data.period.to)}`, `запросов: ${number(rows.length)}`, ...keywordStatusNote(rows)];
  if (keywords.product) notes.push('по одному артикулу');
  const rangeCount = Object.values(keywords.ranges).filter(range => range.min != null || range.max != null).length;
  if (rangeCount) notes.push(`фильтров по столбцам: ${number(rangeCount)}`);
  $('#keywordRangeReset').hidden = !rangeCount;
  // У кампаний с оплатой за клики WB не отдаёт показы по запросам — столбцы «Показы», «CTR» и «CPM» скрываются.
  document.querySelector('.keywords-table').classList.toggle('no-views', data.viewsAvailable === false);
  if (data.viewsAvailable === false)
    notes.push('кампания с оплатой за клики (CPC): показы, CTR и CPM по запросам WB не отдаёт, поэтому эти столбцы скрыты');
  if (cpc) notes.push('исключать запросы в CPC-кампаниях WB не позволяет');
  if (data.fromFile) notes.push('из сохранённого файла');
  if (keywords.loading) notes.push('обновляем…');
  if (keywords.error) notes.push(`ошибка обновления: ${keywords.error}`);
  (data.warnings || []).forEach(text => notes.push(text));
  note.textContent = notes.join(' · ');
  const empty =
    keywords.search.trim() || rangeCount
      ? 'Нет запросов по заданным фильтрам'
      : keywords.statusFilter === 'excluded'
        ? 'Исключённых запросов нет'
        : keywords.statusFilter === 'active'
          ? 'Активных запросов нет'
          : 'WB не вернул поисковые запросы за этот период';
  keywords.shown = shown;
  const rowClass = row =>
    [
      row.status === 'excluded' || row.status === 'archived' ? 'keyword-off' : '',
      keywords.selected.has(row.query) ? 'keyword-selected' : ''
    ]
      .filter(Boolean)
      .join(' ');
  const columns = visibleColumns('keywords'),
    cells = row =>
      columns.map(column => `<td class="c-metric c-${column.key}">${esc(keywordValue(column.key, row[column.key]))}</td>`).join('');
  body.innerHTML = rows.length
    ? `<tr class="total-row"><td></td><td>Итого · ${number(rows.length)} ${plural(rows.length, ['запрос', 'запроса', 'запросов'])}</td><td></td>${cells(totals)}</tr>` +
      shown
        .map(
          row =>
            `<tr class="${rowClass(row)}"><td><input type="checkbox" data-keyword-select="${esc(row.query)}" ${keywords.selected.has(row.query) ? 'checked' : ''} aria-label="Выбрать запрос «${esc(row.query)}»"></td><td><span class="keyword-query"><button type="button" class="keyword-chart-button" data-keyword-daily="${esc(row.query)}" title="Статистика по дням" aria-label="Статистика запроса «${esc(row.query)}» по дням"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3"/><path d="M4.5 10.5l2.5-3 2 2 2.5-4"/></svg></button>${keywordTagButton(row.query)}<a class="keyword-link" href="${esc(wbSearchUrl(row.query))}" target="_blank" rel="noopener noreferrer" title="Открыть поиск WB по запросу «${esc(row.query)}»">${esc(row.query)}</a>${keywordNoteButton(row.query)}</span></td><td>${keywordStatusCell(row)}</td>${cells(row)}</tr>`
        )
        .join('')
    : `<tr><td colspan="${columns.length + 3}" class="empty">${empty}</td></tr>`;
  renderKeywordPagination(pageCount, rows.length);
  renderKeywordActions();
}
// Пагинация — общая с основным сайтом (pager.js): число запросов на странице выбирается и запоминается.
function renderKeywordPagination(pageCount, total) {
  renderPager($('#keywordPagination'), {
    page: keywords.page,
    pageCount,
    total,
    sizeKey: 'campaign-keywords',
    onPage: page => {
      keywords.page = page;
      renderKeywords();
      $('#keywordsNote').closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    onSize: size => {
      keywords.pageSize = size;
      keywords.page = 1;
      renderKeywords();
    }
  });
}
// Сортировка по клику на заголовок; клики по полям «от — до», поиску и ручке ширины не сортируют.
$('#keywordHead').addEventListener('click', event => {
  if (event.target.closest('input,.keyword-range,.keyword-search,.column-resizer')) return;
  const header = event.target.closest('th[data-keyword-key]');
  if (!header) return;
  const key = header.dataset.keywordKey;
  keywords.sort =
    keywords.sort.key === key
      ? { key, direction: keywords.sort.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: key === 'query' ? 'asc' : 'desc' };
  keywords.page = 1;
  renderKeywords();
});
// Выбор артикула — общий компонент (js/common/multi-filter.js) в режиме одного значения, с поиском.
const keywordProductFilter = multiFilter('#keywordProduct', {
  single: true,
  label: 'Артикул',
  allLabel: 'Все артикулы',
  placeholder: 'Поиск по артикулу или названию',
  selected: () => keywords.product,
  onChange: value => {
    keywords.product = value;
    keywords.selected.clear();
    keywords.page = 1;
    renderKeywords();
  }
});
// Поля «От» и «До» в заголовках столбцов-показателей. Клик по ним не сортирует таблицу; ввод применяется с короткой задержкой.
// Проценты и рубли вводятся как в ячейках: «5» в CTR — это 5%, «150» в CPO — 150 ₽; запятая и точка равноценны.
// Заголовок перестраивается при смене столбцов — введённые границы берутся из keywords.ranges.
let keywordRangeTimer = 0;
function renderKeywordHead() {
  const head = $('#keywordHead'),
    columns = visibleColumns('keywords'),
    value = number => (number == null ? '' : String(number).replace('.', ','));
  [...head.children].slice(3).forEach(header => header.remove());
  head.insertAdjacentHTML(
    'beforeend',
    columns
      .map(column => {
        const range = keywords.ranges[column.key] || {};
        return (
          `<th data-keyword-key="${column.key}" class="c-metric c-${column.key}"${column.title ? ` title="${esc(column.title)}"` : ''}><span class="keyword-range">` +
          `<input type="text" inputmode="decimal" placeholder="От" data-range-key="${column.key}" data-range-side="min" aria-label="${esc(column.label)}: от" value="${value(range.min)}"${range.min != null ? ' class="filled"' : ''}>` +
          `<input type="text" inputmode="decimal" placeholder="До" data-range-key="${column.key}" data-range-side="max" aria-label="${esc(column.label)}: до" value="${value(range.max)}"${range.max != null ? ' class="filled"' : ''}></span>${esc(column.label)} ↕</th>`
        );
      })
      .join('')
  );
  resetResizable(head.closest('table'), `keywords:${columns.map(column => column.key).join(',')}`);
}
document.querySelector('.keywords-table thead').addEventListener('input', event => {
  const input = event.target.closest('[data-range-key]');
  if (!input) return;
  const raw = input.value.replace(/\s/g, '').replace(',', '.'),
    value = raw === '' ? null : Number(raw);
  input.classList.toggle('invalid', raw !== '' && !Number.isFinite(value));
  const range = keywords.ranges[input.dataset.rangeKey] || (keywords.ranges[input.dataset.rangeKey] = { min: null, max: null });
  range[input.dataset.rangeSide] = Number.isFinite(value) ? value : null;
  input.classList.toggle('filled', range[input.dataset.rangeSide] != null);
  clearTimeout(keywordRangeTimer);
  keywordRangeTimer = setTimeout(() => {
    keywords.page = 1;
    renderKeywords();
  }, 250);
});
$('#keywordRangeReset').onclick = () => {
  keywords.ranges = {};
  document.querySelectorAll('[data-range-key]').forEach(input => {
    input.value = '';
    input.classList.remove('filled', 'invalid');
  });
  keywords.page = 1;
  renderKeywords();
};
// Поиск стоит в заголовке столбца «Запрос»: клик по полю не сортирует таблицу.
$('#keywordSearch').addEventListener('click', event => event.stopPropagation());
// Средняя позиция по дням для графика — догружается после выгрузки, график перерисовывается.
let positionsRequest = 0;
async function loadPositions(period, silent = false) {
  if (!period) return;
  const request = ++positionsRequest;
  if (!silent) state.positions = new Map();
  try {
    const response = await fetch(
      `/api/advertising/campaign/positions?${new URLSearchParams({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '', from: period.from, to: period.to })}`
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '');
    if (request !== positionsRequest) return;
    state.positions = new Map((result.days || []).filter(day => day.avgPosition != null).map(day => [day.date, day.avgPosition]));
    renderChart();
    renderTable();
    renderCampaignMinis();
  } catch {
    /* без позиции график остаётся как есть */
  }
}
