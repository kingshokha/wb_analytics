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
  const latest = b.history?.[0],
    history = (b.history || []).slice(0, 5);
  const delta = latest?.delta || 0;
  el.innerHTML = `<div class="balance-main"><p class="eyebrow">Баланс кабинета</p><strong>${balanceMoney(b.current, b.currency)}</strong><small class="balance-delta ${delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}">${delta ? `${delta > 0 ? '+' : ''}${balanceMoney(delta, b.currency)} с прошлого снимка` : 'Без изменений'}</small></div><div class="balance-withdraw"><span>Доступно к выводу</span><b>${balanceMoney(b.forWithdraw, b.currency)}</b></div><div class="balance-history"><span>Последние изменения</span><div>${history.length ? history.map((x, i) => `<button class="balance-event" data-balance-index="${i}"><i class="${x.delta > 0 ? 'up' : x.delta < 0 ? 'down' : ''}">${i === history.length - 1 && x.delta === 0 ? 'Первый снимок' : `${x.delta > 0 ? '+' : ''}${balanceMoney(x.delta, x.currency)}`}</i><small>${formatDate(x.timestamp)}</small></button>`).join('') : '<small>История начнёт заполняться после изменения баланса</small>'}</div></div>`;
}
function feedStatus(o) {
  if (o.source === 'Лента WB') {
    if (o.rawStatus === 'created') return ['Оформлен', 'status-new'];
    if (o.rawStatus === 'buyout') return ['Выкуплен', 'status-complete'];
    if (o.rawStatus === 'cancel') return [o.cancelType === 'expire' ? 'Отменён · срок истёк' : 'Отменён', 'status-cancel'];
    if (o.rawStatus === 'return') return ['Возврат', 'status-return'];
    if (o.rawStatus === 'returnDefective') return ['Возврат · брак', 'status-return'];
  }
  return statusMap[o.status] || [o.status || 'Неизвестно', ''];
}
function renderOrders() {
  const term = $('#search').value.toLowerCase(),
    status = $('#statusFilter').value;
  const rows = state.orders.filter(
    o =>
      (!status || o.status === status) &&
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
