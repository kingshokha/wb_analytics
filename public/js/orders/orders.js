// --- «Лента заказов»: заказы за период, баланс, уведомления о заказах FBS ---

// silent — фоновая загрузка для счётчика в меню, без оверлея и без смены статуса синхронизации.
async function loadDashboard(silent = false) {
  const btn = $('#refresh');
  if (!silent) {
    btn.classList.add('loading');
  }
  try {
    const q = new URLSearchParams({ cabinet: state.cabinet, from: $('#dateFrom').value, to: $('#dateTo').value });
    const data = await api('/api/dashboard?' + q);
    state.dashboardKey = [...q.values()].join(':');
    state.orders = data.orders || [];
    state.fbsNew = data.fbsNew;
    state.funnel = data.funnel || {};
    state.balance = data.balance || null;
    state.demo = data.demo;
    renderAll();
    $('#cabinetMode').textContent = data.demo ? 'Демо-данные' : 'Единый токен активен';
    state.dashboardAlerts = [
      data.demo ? 'Сейчас показаны демо-данные. Добавьте <b>WB_TOKEN_1</b> в файл .env и перезапустите сервер.' : '',
      ...(data.warnings || [])
    ].filter(Boolean);
    state.dashboardDemo = Boolean(data.demo);
    renderDashboardAlerts();
  } catch (e) {
    if (silent) return;
    toast(e.message);
    addNotice('orders', `Ошибка загрузки ленты заказов: ${e.message}`);
  } finally {
    if (!silent) btn.classList.remove('loading');
  }
}
function renderAll() {
  renderBalance();
  renderOrders();
  renderFunnel();
  $('#fbsBadge').textContent = fmtNum(fbsNewCount());
}
// Новые FBS-задания сервер считает отдельно (в строки ленты они не входят); в демо — по строкам.
function fbsNewCount() {
  return state.fbsNew ?? state.orders.filter(o => o.source === 'FBS' && o.status === 'new').length;
}

function balanceMoney(value, currency = 'RUB') {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0));
}
function renderBalance() {
  const el = $('#balanceStrip'),
    b = state.balance;
  if (!b) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML =
    `<div class="balance-main"><p class="eyebrow">Баланс кабинета</p><strong>${balanceMoney(b.current, b.currency)}</strong></div>` +
    `<div class="balance-withdraw"><span>Доступно к выводу</span><b>${balanceMoney(b.forWithdraw, b.currency)}</b></div>`;
}
// Типы отмены ленты заказов WB (cancelType при status = cancel), по документации order-feed.
const ORDER_CANCEL_TYPES = { app: 'отказ до получения', receipt: 'отказ при получении', expire: 'истёк срок получения', other: 'иное' };
function feedStatus(o) {
  if (o.source === 'Лента WB') {
    if (o.rawStatus === 'created') return ['Оформлен', 'status-new'];
    if (o.rawStatus === 'buyout') return ['Выкуплен', 'status-complete'];
    if (o.rawStatus === 'cancel') {
      const type = ORDER_CANCEL_TYPES[o.cancelType] || o.cancelType;
      return [type ? `Отменён · ${type}` : 'Отменён', 'status-cancel'];
    }
    if (o.rawStatus === 'return') return ['Возврат', 'status-return'];
    if (o.rawStatus === 'returnDefective') return ['Возврат · брак', 'status-return'];
  }
  return statusMap[o.status] || [o.status || 'Неизвестно', ''];
}
// Фильтры ленты — общий компонент (js/common/multi-filter.js). Статус заказа для фильтра: «new», «confirm», «complete»,
// «cancel:<тип отмены>» (без типа — «cancel:other»), «return:return» или «return:returnDefective».
const orderFilters = { statuses: new Set(), articles: new Set(), cabinet: '' };
const ORDER_STATUS_OPTIONS = [
  { value: 'new', label: 'Оформлены / новые FBS' },
  { value: 'confirm', label: 'На сборке' },
  { value: 'complete', label: 'Выкуплены / в доставке' },
  ...Object.entries(ORDER_CANCEL_TYPES).map(([type, label]) => ({
    value: `cancel:${type}`,
    label: label[0].toUpperCase() + label.slice(1),
    group: 'Отменены'
  })),
  { value: 'return:return', label: 'Обычные', group: 'Возвраты' },
  { value: 'return:returnDefective', label: 'Брак', group: 'Возвраты' }
];
function orderStatusKey(o) {
  if (o.status === 'cancel') return `cancel:${ORDER_CANCEL_TYPES[o.cancelType] ? o.cancelType : 'other'}`;
  if (o.status === 'return') return o.rawStatus === 'returnDefective' ? 'return:returnDefective' : 'return:return';
  return o.status;
}
const orderStatusFilter = multiFilter('#orderStatusFilter', {
  label: 'Статусы',
  allText: 'Все статусы',
  selected: () => orderFilters.statuses,
  onChange: () => renderOrders()
});
const orderArticleFilter = multiFilter('#orderArticleFilter', {
  label: 'Артикулы',
  placeholder: 'Поиск по арт. продавца, WB или названию',
  search: true,
  allText: 'Все артикулы',
  empty: 'В заказах за период нет товаров',
  selected: () => orderFilters.articles,
  onChange: () => renderOrders()
});
// Варианты фильтров — из заказов за период: статусы с числом заказов, артикулы — только те, что есть в заказах.
// Выбранные артикулы другого кабинета сбрасываются.
function renderOrderFilters() {
  if (orderFilters.cabinet !== state.cabinet) {
    orderFilters.articles.clear();
    orderFilters.cabinet = state.cabinet;
  }
  const counts = {};
  state.orders.forEach(o => (counts[orderStatusKey(o)] = (counts[orderStatusKey(o)] || 0) + 1));
  orderStatusFilter.setItems(ORDER_STATUS_OPTIONS.map(item => ({ ...item, count: fmtNum(counts[item.value] || 0) })));
  orderArticleFilter.setItems(
    articleFilterItems(
      state.orders.map(o => ({
        nmId: o.nmId,
        vendorCode: String(o.article || '').startsWith('chrtID') ? '' : o.article,
        title: String(o.name || '').startsWith('Товар WB') ? '' : o.name
      }))
    )
  );
}
function renderOrders() {
  renderOrderFilters();
  const term = $('#search').value.toLowerCase(),
    statuses = orderFilters.statuses,
    articles = orderFilters.articles;
  const rows = state.orders.filter(
    o =>
      (!statuses.size || statuses.has(orderStatusKey(o))) &&
      (!articles.size || articles.has(String(o.nmId))) &&
      (!term ||
        [o.id, o.srid, o.nmId, o.chrtId, o.article, o.name, o.brand, o.warehouse, o.destinationCity].join(' ').toLowerCase().includes(term))
  );
  $('#orderCount').textContent = `${rows.length} из ${state.orders.length} событий за выбранный период`;
  $('#emptyOrders').classList.toggle('hidden', rows.length > 0);
  $('#ordersBody').innerHTML = rows
    .map(o => {
      const s = feedStatus(o);
      const picture = o.photo ? `<img src="${escapeHtml(o.photo)}" alt="" loading="lazy">` : escapeHtml(String(o.name || 'Т')[0]);
      const ordered = o.orderedAt || o.createdAt;
      return `<tr><td><strong>${formatDate(ordered)}</strong><small>Оформление</small></td><td><strong>${formatDate(o.createdAt)}</strong><small>Текущий статус</small></td><td><div class="product"><span class="product-icon ${o.photo ? 'has-photo' : ''}">${picture}</span><span><strong>${escapeHtml(o.name || 'Товар')}</strong><small>${o.brand ? `${escapeHtml(o.brand)} · ` : ''}${escapeHtml(o.article || '')} · nmID ${escapeHtml(o.nmId || '—')}</small></span></div></td><td><strong>${escapeHtml(o.warehouse || '—')}</strong><small>${escapeHtml(o.warehouseRegion || '')}</small></td><td><strong>${escapeHtml(o.destinationCity || '—')}</strong><small>${escapeHtml(o.destinationDistrict || '')}</small></td><td><strong>${fmtMoney(o.price, o.currencyCode)}</strong>${o.buyerPrice != null && o.buyerPrice !== o.price ? `<small title="Сколько платит покупатель с учётом скидки WB (СПП)">покупатель ${fmtMoney(o.buyerPrice, o.currencyCode)}</small>` : ''}</td><td><span class="status ${s[1]}">${s[0]}</span></td><td class="order-id"><small title="${escapeHtml(o.id)}">${escapeHtml(o.id)}</small></td></tr>`;
    })
    .join('');
}

// Предупреждения общей загрузки (лента заказов, баланс, новые задания) — в уведомлениях ленты заказов;
// подсказка демо-режима (первая строка) — во всех разделах.
function renderDashboardAlerts() {
  const alerts = state.dashboardAlerts || [];
  setNotices('*', 'demo', state.dashboardDemo ? alerts.slice(0, 1) : [], 'info');
  setNotices('orders', 'dashboard', state.dashboardDemo ? alerts.slice(1) : alerts);
}
