// --- Главная страница: общее для всех разделов — состояние, форматирование, запросы к серверу, окна, кабинеты ---
// Подключается первым из скриптов разделов (до js/main/app.js): разделы берут отсюда state, $, api, toast, escapeHtml,
// openModal, fmtNum и прочее — только внутри своих функций.

const state = {
  cabinets: [],
  cabinet: 'demo',
  orders: [],
  funnel: {},
  funnelProducts: [],
  funnelHistory: [],
  funnelGroupedHistory: [],
  funnelFilters: { categories: new Set(), articles: new Set(), availability: new Set() },
  funnelSort: { key: 'openCount', dir: 'desc' },
  balance: null,
  ads: null,
  stocks: null,
  fbwStocks: null,
  prices: null,
  demo: true,
  activePage: 'summary',
  dashboardKey: '',
  adsKey: '',
  stocksKey: '',
  fbwStocksKey: '',
  pricesKey: '',
  adSort: { key: 'spend', dir: 'desc' },
  adStatuses: new Set(['9', '11']),
  adProductSort: { key: 'spend', dir: 'desc' },
  adProductOpen: new Set(),
  stockSelected: new Set(),
  stockFilters: { warehouses: new Set(), categories: new Set(), availability: new Set(), trash: new Set() },
  stockSort: { key: 'amount', dir: 'desc' },
  stockPage: 1,
  stockPageSize: pageSizeFor('fbs-stocks'),
  funnelPage: 1,
  funnelPageSize: pageSizeFor('funnel'),
  funnelSalesPageSize: pageSizeFor('funnel-sales'),
  funnelTab: 'products',
  funnelArticlesCabinet: '',
  dashboardAlerts: [],
  dashboardDemo: false,
  priceStocks: null,
  priceStocksKey: '',
  fbwFilters: { warehouses: new Set(), categories: new Set(), availability: new Set(), trash: new Set() },
  fbwSort: { key: 'amount', dir: 'desc' },
  fbwPage: 1,
  fbwPageSize: pageSizeFor('fbw-stocks'),
  pricePage: 1,
  pricePageSize: pageSizeFor('prices'),
  priceSelected: new Set(),
  priceFilters: { categories: new Set(), brands: new Set(), discounts: new Set() },
  priceSort: { key: 'name', dir: 'desc' },
  fbsOrders: null,
  fbsOrdersKey: '',
  supplies: null,
  supplyDetail: null,
  fbsSelected: new Set(),
  fbsFilters: { warehouses: new Set(), categories: new Set(), assembly: new Set() },
  fbsSort: { key: 'createdAt', dir: 'desc' },
  fbsPage: 1,
  fbsPageSize: pageSizeFor('fbs-orders'),
  supplyOrderSelected: new Set()
};
const $ = s => document.querySelector(s),
  $$ = s => [...document.querySelectorAll(s)];
const fmtMoney = (n, c = 643) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: c === 933 ? 'BYN' : c === 398 ? 'KZT' : 'RUB',
    maximumFractionDigits: 0
  }).format(Number(n || 0) / 100);
const fmtNum = n => new Intl.NumberFormat('ru-RU').format(Number(n || 0));
const fmtRub = n => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(Number(n || 0));
const fmtPercent = n => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n || 0))}%`;
const statusMap = {
  new: ['Новый', 'status-new'],
  confirm: ['На сборке', 'status-confirm'],
  complete: ['В доставке / продан', 'status-complete'],
  cancel: ['Отменён', 'status-cancel'],
  return: ['Возврат', 'status-return']
};

async function api(url, options = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  let data = {};
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) throw new Error(data.error || `Ошибка ${r.status}`);
  return data;
}
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}
// Даты сайта считаются по Москве (UTC+3), как в кабинете WB: «сегодня» не зависит от часового пояса компьютера.
function mskDate(offsetDays = 0) {
  const d = new Date(Date.now() + 3 * 3_600_000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
// Период по умолчанию — последние 7 дней включая сегодня: 25.09–01.10, если сегодня 1 октября.
function setDates() {
  $('#dateTo').value = mskDate(0);
  $('#dateFrom').value = mskDate(-6);
  const [year, month0] = mskDate(0).split('-').map(Number),
    month = $('#adMonth');
  month.innerHTML =
    '<option value="">Выбрать период</option><option value="last31">Последние 31 день</option>' +
    Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(year, month0 - 1 - i, 1)),
        value = d.toISOString().slice(0, 7);
      return `<option value="${value}">${d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</option>`;
    }).join('');
}

async function loadCabinets() {
  const data = await api('/api/cabinets');
  state.cabinets = data.cabinets;
  state.demo = data.demo;
  const stored = localStorage.getItem('wb-cabinet');
  state.cabinet = state.cabinets.some(c => c.id === stored) ? stored : state.cabinets[0].id;
  renderCabinets();
}
function renderCabinets() {
  const selected = state.cabinets.find(c => c.id === state.cabinet);
  $('#cabinetName').textContent = selected.name;
  $('#cabinetAvatar').textContent = selected.name[0].toUpperCase();
  $('#cabinetMode').textContent = selected.configured ? 'Единый токен активен' : 'Демо-данные';
  $('#cabinetList').innerHTML = state.cabinets
    .map(
      c =>
        `<button class="cab-option ${c.id === state.cabinet ? 'active' : ''}" data-id="${c.id}">${escapeHtml(c.name)} ${c.configured ? '' : '· демо'}</button>`
    )
    .join('');
  $$('.cab-option').forEach(
    b =>
      (b.onclick = () => {
        state.cabinet = b.dataset.id;
        state.adsKey = '';
        state.stocksKey = '';
        state.fbwStocksKey = '';
        state.pricesKey = '';
        localStorage.setItem('wb-cabinet', state.cabinet);
        $('#cabinetMenu').classList.remove('open');
        renderCabinets();
        renderNoticeBell();
        loadMessagesSummary();
        loadCurrentPage();
      })
  );
}

// Цены, остатки FBS и FBW сервер собирает по частям (progressiveList в server.js): пока ответ partial, сайт раз в 2 секунды
// берёт новый снимок и перерисовывает таблицу с уже загруженными строками; выбор, фильтры и страница не сбрасываются.
// Промис — до полной загрузки (шаблоны остатков и цен ждут весь список); повторный вызов во время загрузки — тот же промис.
const PROGRESSIVE_POLL_MS = 2000,
  progressiveLoads = new Map();
function loadProgressive(name, url, force, apply) {
  const cabinet = state.cabinet,
    running = progressiveLoads.get(name);
  if (running && running.cabinet === cabinet && !force) return running.promise;
  const btn = $('#refresh');
  btn.classList.add('loading');
  const promise = (async () => {
    try {
      for (let first = true; ; first = false) {
        const data = await api(
          `${url}${url.includes('?') ? '&' : '?'}cabinet=${encodeURIComponent(cabinet)}${force && first ? '&force=1' : ''}`
        );
        if (state.cabinet !== cabinet || progressiveLoads.get(name)?.promise !== promise) return null;
        apply(data, first);
        if (first) btn.classList.remove('loading');
        if (!data.partial) return data;
        await new Promise(resolve => setTimeout(resolve, PROGRESSIVE_POLL_MS));
        if (state.cabinet !== cabinet) return null;
      }
    } finally {
      btn.classList.remove('loading');
      if (progressiveLoads.get(name)?.promise === promise) progressiveLoads.delete(name);
    }
  })();
  progressiveLoads.set(name, { cabinet, promise });
  return promise;
}
// Подпись к счётчику строк, пока список собирается: «загружено …, догружается» и «названия и фото догружаются».
function progressNote(data) {
  if (!data?.partial) return '';
  const p = data.progress || {};
  return p.cardsLoading ? ' · догружается: названия и фото подставляются по мере загрузки карточек…' : ' · догружается…';
}

function inputSelection(set, key, checked) {
  checked ? set.add(key) : set.delete(key);
}

function pct(a, b) {
  return b ? Math.round((Number(a || 0) / Number(b)) * 100) : 0;
}
function formatDate(v) {
  if (!v) return 'Дата неизвестна';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// wide — широкое окно (окно товара с графиком истории цены); остальные окна остаются обычной ширины.
function openModal(html, wide = false) {
  $('#modalContent').innerHTML = html;
  $('#modal .modal-card').classList.toggle('modal-wide', wide);
  $('#modal').classList.add('open');
}
function closeModal() {
  $('#modal').classList.remove('open');
}

// Увеличенное фото при наведении на миниатюру. Окно одно на страницу: показ у нового фото убирает прежнее.
// Прячется, когда указатель ушёл с фото, при прокрутке, нажатии и уходе с окна браузера. Раньше окно убиралось только
// по mouseleave: если таблицу перерисовывали под указателем (автообновление, фильтр, подгрузка строк), миниатюра пропадала
// со страницы без mouseleave, и окно зависало — их набиралось несколько.
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
    preview.alt = image.alt || '';
    document.body.append(preview);
    const width = preview.offsetWidth,
      height = preview.offsetHeight;
    const left = Math.min(Math.max(8, rect.right + 10), window.innerWidth - width - 8);
    const top = Math.min(Math.max(8, rect.top + (rect.height - height) / 2), window.innerHeight - height - 8);
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    photoPreview.el = preview;
    photoPreview.owner = image;
  });
  image.addEventListener('mouseleave', () => {
    if (photoPreview.owner === image) hidePhotoPreview();
  });
}
// Указатель уже не над тем фото (или его убрали со страницы при перерисовке) — окно прячется.
document.addEventListener(
  'mousemove',
  event => {
    if (photoPreview.owner && (event.target !== photoPreview.owner || !photoPreview.owner.isConnected)) hidePhotoPreview();
  },
  { passive: true }
);
['scroll', 'wheel', 'pointerdown'].forEach(type => document.addEventListener(type, hidePhotoPreview, { capture: true, passive: true }));
window.addEventListener('blur', hidePhotoPreview);
function bindAdPhotoPreviews(selector) {
  $$(`${selector} .ad-product-photo`).forEach(image => {
    if (image.dataset.previewBound) return;
    image.dataset.previewBound = '1';
    bindPhotoPreview(image);
  });
}

function pluralRu(count, forms) {
  const value = Math.abs(Number(count) || 0) % 100,
    digit = value % 10;
  if (value > 10 && value < 20) return forms[2];
  if (digit > 1 && digit < 5) return forms[1];
  if (digit === 1) return forms[0];
  return forms[2];
}

function formatShortDate(date) {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}
