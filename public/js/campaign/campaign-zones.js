'use strict';

// --- Статистика по дням и зонам показов: поиск, полки, каталог ---
// В открытом API WB её нет: данные присылает расширение Chrome из кабинета WB, сайт хранит их в zones.json папки кампании.
// WB отдаёт «поиск + каталог» одной строкой, каталог по дням — отдельно, поиск — разница. По отдельному артикулу каталог
// есть только итогом за период, поэтому у артикула по дням поиск и каталог идут одной строкой.
const zones = { data: null, product: '', collapsed: false, toggled: new Set(), request: 0, ext: { tone: '', text: '' }, fetching: null };
const ZONE_FIELDS = ['views', 'clicks', 'atbs', 'orders', 'shks', 'sum_price', 'spend'],
  ZONE_OTHER = 'other';
const ZONE_NAMES = { search: 'поиск', shelves: 'полки', catalog: 'каталог', searchCatalog: 'поиск + каталог' };
const ZONE_COLUMNS = [
  { key: 'views', label: 'Показы' },
  { key: 'cpm', label: 'CPM', title: 'Затраты на 1000 показов' },
  { key: 'clicks', label: 'Переходы' },
  { key: 'ctr', label: 'CTR', title: 'Переходы ÷ показы' },
  { key: 'cpc', label: 'CPC', title: 'Затраты ÷ переходы' },
  { key: 'spend', label: 'Затраты' },
  { key: 'atbs', label: 'Корзины', title: 'Мелкая цифра — доля корзин от переходов' },
  { key: 'cpl', label: 'CPL', title: 'Затраты ÷ корзины' },
  { key: 'orders', label: 'Заказы', title: 'Мелкая цифра — доля заказов от корзин' },
  { key: 'cpo', label: 'CPO', title: 'Затраты ÷ заказы' },
  { key: 'sum_price', label: 'Сумма', title: 'Сумма заказов' },
  { key: 'cro', label: 'CRO', title: 'Заказы ÷ переходы' },
  { key: 'drr', label: 'ДРР', title: 'Затраты ÷ сумма заказов' }
];
const zoneEmpty = () => Object.fromEntries(ZONE_FIELDS.map(field => [field, 0]));
const zoneAdd = (target, src) => {
  ZONE_FIELDS.forEach(field => (target[field] += Number(src?.[field] || 0)));
  return target;
};
const zoneMinus = (a, b) =>
  Object.fromEntries(ZONE_FIELDS.map(field => [field, Math.max(0, Math.round((a[field] - b[field]) * 100) / 100)]));
const zoneSum = (map, nms) => {
  const out = zoneEmpty();
  for (const [nm, m] of Object.entries(map || {})) if (!nms || nms.has(nm)) zoneAdd(out, m);
  return out;
};
function zoneRates(m) {
  const ratio = (a, b, k = 1) => (b ? (a / b) * k : null);
  return {
    ...m,
    cpm: ratio(m.spend, m.views, 1000),
    ctr: ratio(m.clicks, m.views, 100),
    cpc: ratio(m.spend, m.clicks),
    cpl: ratio(m.spend, m.atbs),
    cpo: ratio(m.spend, m.orders),
    cro: ratio(m.orders, m.clicks, 100),
    drr: ratio(m.spend, m.sum_price, 100),
    cartRate: ratio(m.atbs, m.clicks, 100),
    orderRate: ratio(m.orders, m.atbs, 100)
  };
}
// Пусто вместо нуля и прочерка — как в кабинете WB: в строках зон так легче увидеть, где что было.
function zoneText(key, value) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n) || !n) return '';
  const num = digits => n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return key === 'cpc'
    ? `${num(1)} ₽`
    : ['cpm', 'spend', 'cpl', 'cpo', 'sum_price'].includes(key)
      ? `${num(0)} ₽`
      : ['ctr', 'cro', 'drr'].includes(key)
        ? `${num(2)}%`
        : num(0);
}
const zoneSup = value => (value == null || !Number.isFinite(value) ? '' : `<sup>${Math.round(value)}%</sup>`);
function zoneCells(m) {
  return ZONE_COLUMNS.map((column, index) => {
    const text = zoneText(column.key, m[column.key]),
      sup = text && column.key === 'atbs' ? zoneSup(m.cartRate) : text && column.key === 'orders' ? zoneSup(m.orderRate) : '';
    return `<td${index === 6 ? ' class="zones-split"' : ''}>${text}${sup}</td>`;
  }).join('');
}
// Артикулы кампании — с показами за период; остальные (только заказы после клика) — «Другие товары».
function zoneArticles(days) {
  const views = new Map(),
    all = new Set();
  for (const day of days)
    for (const [nm, m] of Object.entries(day.all || {})) {
      all.add(nm);
      views.set(nm, (views.get(nm) || 0) + Number(m.views || 0));
    }
  for (const day of days) for (const zone of ['searchCatalog', 'shelves']) Object.keys(day[zone] || {}).forEach(nm => all.add(nm));
  const own = [...views]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([nm]) => nm);
  return { own, others: [...all].filter(nm => !own.includes(nm)).sort() };
}
function zoneSelection(articles) {
  if (!zones.product) return null;
  return new Set(zones.product === ZONE_OTHER ? articles.others : [zones.product]);
}
// Зоны одного дня. Поиск и каталог раздельно — только по всей кампании и когда WB отдал каталог за этот день.
function zoneDay(day, nms) {
  const all = zoneSum(day.all, nms),
    shelves = zoneSum(day.shelves, nms),
    searchCatalog = zoneSum(day.searchCatalog, nms);
  if (!nms && day.catalog) {
    const catalog = zoneAdd(zoneEmpty(), day.catalog);
    return { all, parts: { search: zoneMinus(searchCatalog, catalog), shelves, catalog } };
  }
  return { all, parts: { searchCatalog, shelves } };
}
function zonePeriod(list, nms, entry) {
  const all = zoneEmpty(),
    parts = {};
  list.forEach(item => {
    zoneAdd(all, item.all);
    for (const [zone, m] of Object.entries(item.parts)) zoneAdd((parts[zone] ||= zoneEmpty()), m);
  });
  // Каталог есть не за все дни — за период поиск и каталог вместе, иначе сумма зон разошлась бы с «Все».
  if (parts.searchCatalog && (parts.search || parts.catalog)) {
    parts.searchCatalog = zoneAdd(zoneAdd(zoneAdd(zoneEmpty(), parts.searchCatalog), parts.search || {}), parts.catalog || {});
    delete parts.search;
    delete parts.catalog;
  }
  // У артикула каталог за период — если расширение присылало подходящий период (см. zoneCatalogEntry).
  if (nms && parts.searchCatalog) {
    if (entry) {
      const catalog = zoneSum(entry.items, nms);
      parts.search = zoneMinus(parts.searchCatalog, catalog);
      parts.catalog = catalog;
      delete parts.searchCatalog;
    }
  }
  return { all, parts };
}
// Зоны лежат на компьютере и грузятся сразу: до конца выгрузки из WB — за период из полей дат, потом — за выгруженный.
const zoneRange = () =>
  exportState.loaded ||
  ($('#exportFrom').value && $('#exportTo').value && $('#exportFrom').value <= $('#exportTo').value
    ? { from: $('#exportFrom').value, to: $('#exportTo').value }
    : null);
// Каталог артикула WB даёт итогом за присланный период. Он подходит к таблице, если дни с показами или заказами
// в этом периоде — ровно те, что в таблице: пустые дни по краям не мешают. Из подходящих берётся самый свежий.
function zoneCatalogEntry(nms, list) {
  if (!nms) return null;
  const shown = new Set(list.map(item => item.date));
  const active = Object.entries(zones.data?.days || {})
    .filter(([, day]) => ZONE_FIELDS.some(field => zoneDay(day, nms).all[field]))
    .map(([d]) => d);
  return (
    Object.values(zones.data?.catalogByNm || {})
      .filter(entry => {
        const inside = active.filter(d => d >= entry.from && d <= entry.to);
        return inside.length === shown.size && inside.every(d => shown.has(d));
      })
      .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))[0] || null
  );
}
const zoneOpen = key => (zones.collapsed ? zones.toggled.has(key) : !zones.toggled.has(key));
function zoneRows(item, key) {
  if (!zoneOpen(key)) return '';
  return ['search', 'searchCatalog', 'shelves', 'catalog']
    .filter(zone => item.parts[zone])
    .map(zone => {
      const m = item.parts[zone],
        share = item.all.views ? `${Math.round((m.views / item.all.views) * 100)}%` : '';
      return `<tr class="zones-zone"><td>${ZONE_NAMES[zone]}<span class="zones-share">${share}</span></td>${zoneCells(zoneRates(m))}</tr>`;
    })
    .join('');
}
function zoneSparks(list) {
  const cell = column => {
    const values = list.map(item => zoneRates(item.all)[column.key]).map(v => (Number.isFinite(v) ? v : 0)),
      max = Math.max(...values, 0);
    if (!max) return '<td></td>';
    const w = 100 / values.length;
    return `<td><svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">${values.map((v, i) => `<rect x="${(i * w + w * 0.12).toFixed(2)}" y="${(32 - Math.max(1, (v / max) * 32)).toFixed(2)}" width="${(w * 0.76).toFixed(2)}" height="${Math.max(1, (v / max) * 32).toFixed(2)}"><title>${date(list[i].date)}: ${zoneText(column.key, v) || 0}</title></rect>`).join('')}</svg></td>`;
  };
  return `<tr class="zones-charts"><td>Графики</td>${ZONE_COLUMNS.map(cell).join('')}</tr>`;
}
const weekday = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' });
function zoneMissing(dates, have) {
  const ranges = [];
  for (const d of dates) {
    if (have.has(d)) continue;
    const last = ranges.at(-1);
    if (last && datesNext(last[1]) === d) last[1] = d;
    else ranges.push([d, d]);
  }
  return ranges.map(([a, b]) => (a === b ? ddmmOf(a) : `${ddmmOf(a)}–${ddmmOf(b)}`)).join(', ');
}
const datesNext = d => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};
function zoneDates(from, to) {
  const out = [];
  for (let d = from; d <= to; d = datesNext(d)) out.push(d);
  return out;
}
function renderZones() {
  const head = $('#zonesHead'),
    body = $('#zonesBody'),
    note = $('#zonesNote');
  head.innerHTML =
    `<tr class="zones-group"><th></th><th colspan="6">Статистика РК</th><th colspan="7" class="zones-split">Эффективность РК (товар + заказы других товаров после клика)</th></tr>` +
    `<tr><th>Дата</th>${ZONE_COLUMNS.map((column, index) => `<th${index === 6 ? ' class="zones-split"' : ''}${column.title ? ` title="${esc(column.title)}"` : ''}>${column.label}</th>`).join('')}</tr>`;
  const data = zones.data,
    loaded = zoneRange();
  if (!data || !loaded) {
    body.innerHTML = '';
    return;
  }
  const received = Object.entries(data.days || {})
    .filter(([d]) => d >= loaded.from && d <= loaded.to)
    .map(([d, day]) => ({ ...day, date: d }));
  const articles = zoneArticles(received);
  const label = nm => {
    const product = state.setupProducts?.get(nm) || state.productDaily.find(row => String(row.nmId) === nm);
    return [nm, product?.vendorCode, product?.name || data.names?.[nm]].filter(Boolean).join(' · ');
  };
  if (zones.product && zones.product !== ZONE_OTHER && !articles.own.includes(zones.product) && !articles.others.includes(zones.product))
    zones.product = '';
  zonesProductFilter.setItems([
    ...articles.own.map(nm => {
      const product = state.setupProducts?.get(nm) || state.productDaily.find(row => String(row.nmId) === nm);
      return {
        value: nm,
        label: product?.vendorCode || nm,
        hint: [nm, product?.name || data.names?.[nm]].filter(Boolean).join(' · '),
        title: label(nm)
      };
    }),
    ...(articles.others.length ? [{ value: ZONE_OTHER, label: `Другие товары (заказы после клика): ${articles.others.length}` }] : [])
  ]);
  const nms = zoneSelection(articles);
  const list = received
    .map(day => ({ date: day.date, ...zoneDay(day, nms) }))
    .filter(item => ZONE_FIELDS.some(field => item.all[field]))
    .sort((a, b) => a.date.localeCompare(b.date));
  const catalogEntry = zoneCatalogEntry(nms, list),
    period = zonePeriod(list, nms, catalogEntry);
  const cmp = $('#campaignWbLink')?.href,
    wb = cmp ? `<a href="${esc(cmp)}" target="_blank" rel="noopener noreferrer">кабинете WB</a>` : 'кабинете WB';
  const how = zonesExtension()
    ? 'Нажмите «Обновить зоны» — расширение возьмёт их в кабинете WB.'
    : `Чтобы дозагрузить: откройте кампанию в ${wb}, нажмите на расширение «WB: статистика по зонам показов», выберите период и «Загрузить» — данные придут сюда сами. С расширением 1.3.0 и новее зоны загружаются сами при открытии кампании.`;
  if (!received.length) {
    note.innerHTML = `${zoneExtNote()}За этот период данных по зонам пока нет: в открытом API WB их нет, их присылает расширение Chrome. ${how}`;
    body.innerHTML = '';
    return;
  }
  const active =
    state.period && state.period.from <= state.period.to
      ? zoneDates(state.period.from, state.period.to)
      : zoneDates(loaded.from, loaded.to);
  const missing = zoneMissing(active, new Set(received.map(day => day.date)));
  // Дни без отдельного каталога — диапазонами («17.11–23.11»), а не списком дат.
  const noCatalog = nms
    ? ''
    : zoneMissing(
        received.map(day => day.date).sort(),
        new Set(received.filter(day => day.catalog).map(day => day.date))
      );
  const when = data.updatedAt
    ? new Date(data.updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';
  note.innerHTML =
    zoneExtNote() +
    [
      data.demo ? 'Демо-данные.' : `Из расширения${when ? ` на ${when}` : ''}.`,
      missing ? `Нет данных за ${missing}. ${how}` : '',
      noCatalog ? `<span title="WB не отдал каталог отдельно — поиск и каталог одной строкой">За ${noCatalog} каталог вместе с поиском.</span>` : '',
      nms && zones.product !== ZONE_OTHER
        ? `По артикулу WB отдаёт каталог только итогом за период, поэтому по дням поиск и каталог — одной строкой${catalogEntry ? ', а в «За период» разделены' : ''}.`
        : ''
    ]
      .filter(Boolean)
      .join(' ');
  const dayRow = item =>
    `<tr class="zones-day${zoneOpen(item.date) ? '' : ' zones-shut'}" data-zone-day="${item.date}"><td>${date(item.date)} / ${weekday(item.date)}</td>${zoneCells(zoneRates(item.all))}</tr>${zoneRows(item, item.date)}`;
  body.innerHTML = list.length
    ? zoneSparks(list) +
      `<tr class="zones-total${zoneOpen('total') ? '' : ' zones-shut'}" data-zone-day="total"><td>За период</td>${zoneCells(zoneRates(period.all))}</tr>${zoneRows(period, 'total')}` +
      `<tr class="zones-days-head"><td>По дням</td>${ZONE_COLUMNS.map((column, index) => `<td${index === 6 ? ' class="zones-split"' : ''}>${column.label}</td>`).join('')}</tr>` +
      [...list].reverse().map(dayRow).join('')
    : `<tr><td colspan="14" class="empty">У выбранного артикула за период нет показов и заказов</td></tr>`;
  $('#zonesCollapse').textContent = zones.collapsed ? 'Развернуть все' : 'Свернуть все';
  $('#zonesCollapse').setAttribute('aria-pressed', String(zones.collapsed));
}
async function loadZones() {
  const loaded = zoneRange();
  if (!loaded) return;
  const request = ++zones.request,
    q = new URLSearchParams({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '', from: loaded.from, to: loaded.to });
  try {
    const response = await fetch(`/api/advertising/campaign/zones?${q}`),
      data = await response.json();
    if (request !== zones.request) return;
    if (!response.ok) throw new Error(data.error || 'Не удалось загрузить');
    zones.data = data;
    renderZones();
    if (state.summaryCampaign) renderSummary(state.summaryCampaign);
  } catch (error) {
    if (request === zones.request && !zones.data) $('#zonesNote').textContent = `Статистика по зонам: ${error.message}`;
  }
}
// «Все / Поиск / Рекомендации» слева от периода меняет только карточки сверху.
$('#summaryZoneSwitch').addEventListener('click', event => {
  const button = event.target.closest('[data-summary-zone]');
  if (!button) return;
  state.summaryZone = button.dataset.summaryZone;
  document
    .querySelectorAll('#summaryZoneSwitch [data-summary-zone]')
    .forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  if (state.summaryCampaign) renderSummary(state.summaryCampaign);
});
// Выбор артикула — общий компонент (js/common/multi-filter.js) в режиме одного значения, с поиском.
const zonesProductFilter = multiFilter('#zonesProduct', {
  single: true,
  label: 'Артикул',
  allLabel: 'Все артикулы',
  placeholder: 'Поиск по артикулу или названию',
  selected: () => zones.product,
  onChange: value => {
    zones.product = value;
    renderZones();
  }
});
$('#zonesCollapse').addEventListener('click', () => {
  zones.collapsed = !zones.collapsed;
  zones.toggled.clear();
  renderZones();
});
$('#zonesBody').addEventListener('click', event => {
  const row = event.target.closest('[data-zone-day]');
  if (!row) return;
  const key = row.dataset.zoneDay;
  if (zones.toggled.has(key)) zones.toggled.delete(key);
  else zones.toggled.add(key);
  renderZones();
});
// --- Загрузка зон без нажатий в кабинете WB: расширение 1.3.0+ (его site-bridge.js и background.js) ---
// Сайт просит расширение сообщением на странице; оно берёт данные в кабинете WB (в открытой вкладке кабинета, а если её нет —
// открывает страницу кампании в фоне и закрывает после загрузки) и присылает их на сервер, как из своего окна. После ответа
// блок перечитывается. Само — при открытии кампании и выгрузке нового периода; вручную — кнопкой «Обновить зоны».
// Нужен вход в кабинет продавца WB в этом же Chrome и выбранный в кабинете магазин этой кампании.
const zonesExtension = () => document.documentElement.dataset.wbZonesExtension || '';
function zoneExtNote() {
  return zones.ext.text ? `<span class="zones-ext ${zones.ext.tone}">${esc(zones.ext.text)}</span> ` : '';
}
function setZoneExt(tone, text) {
  zones.ext = { tone, text };
  const button = $('#zonesRefresh');
  button.disabled = tone === 'busy';
  button.textContent = tone === 'busy' ? 'Загружаем…' : 'Обновить зоны';
  renderZones();
}
function askExtension(message) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise(resolve => {
    const done = result => {
      clearTimeout(timer);
      window.removeEventListener('message', listen);
      resolve(result);
    };
    const listen = event => {
      const m = event.data;
      if (event.source === window && m && m.source === 'wb-zones-extension' && m.type === 'zones-result' && m.requestId === requestId)
        done(m);
    };
    const timer = setTimeout(() => done({ ok: false, error: 'Расширение не ответило за 2 минуты' }), 120000);
    window.addEventListener('message', listen);
    window.postMessage({ source: 'wb-pulse', type: 'zones-load', requestId, ...message }, location.origin);
  });
}
async function fetchZonesFromExtension(auto) {
  const loaded = zoneRange(),
    id = params.get('id') || '',
    cabinet = params.get('cabinet') || 'demo';
  if (zones.fetching || !loaded || !/^\d{1,15}$/.test(id) || cabinet === 'demo') return;
  if (!zonesExtension()) {
    if (!auto)
      setZoneExt(
        'error',
        'Расширение «WB: статистика по зонам показов» не найдено или старой версии: нужна 1.3.0 и новее. Установите его и обновите страницу.'
      );
    return;
  }
  setZoneExt('busy', 'Загружаем зоны из кабинета WB через расширение…');
  zones.fetching = askExtension({ campaignId: id, from: loaded.from, to: loaded.to });
  const result = await zones.fetching;
  zones.fetching = null;
  if (!result.ok) {
    setZoneExt('error', `Зоны не обновились: ${result.error || 'неизвестная ошибка'}`);
    return;
  }
  setZoneExt('ok', `Обновлено из кабинета WB в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`);
  await loadZones();
}
$('#zonesRefresh').addEventListener('click', () => fetchZonesFromExtension(false));
// Расширение присылает данные, пока пользователь в кабинете WB: при возврате на вкладку сайта блок перечитывается.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadZones();
});
window.addEventListener('focus', () => loadZones());
