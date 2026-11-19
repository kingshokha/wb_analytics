// --- Главная страница: меню разделов, общие обработчики и запуск ---
// Подключается последним из скриптов главной страницы: init() в конце файла вызывается, когда все разделы уже загружены.

function loadCurrentPage(force = false) {
  if (state.activePage === 'summary') return loadSummary(force);
  if (state.activePage === 'ads') return loadAds(force);
  if (state.activePage === 'stocks') return loadStocks(force);
  if (state.activePage === 'fbw-stocks') return loadFbwStocks(force);
  if (state.activePage === 'prices') return loadPrices(force);
  if (state.activePage === 'fbs-orders') return loadFbsOrders(force);
  if (state.activePage === 'funnel') return loadFunnelDetails(false, force);
  if (state.activePage === 'ratings') return loadRatings(force);
  if (state.activePage === 'returns') return loadReturns(force);
  if (state.activePage === 'todo') return loadTodos();
  if (state.activePage === 'history') return loadChangeHistory(force);
  if (state.activePage === 'sima') return loadSimaHistory(force);
  if (state.activePage === 'sima-profit') return loadSimaProfit(force);
  if (state.activePage === 'cards') return loadCards(force);
  if (state.activePage === 'messages') return loadMessages(force);
  if (state.activePage === 'orders') loadOrdersHourly();
  return loadDashboard();
}
document.addEventListener('click', event => {
  if (!event.target.closest('.multi-filter'))
    $$('.multi-filter[open]').forEach(filter => {
      filter.removeAttribute('open');
    });
});
document.addEventListener('click', event => {
  const option = event.target.closest('.cab-option');
  if (option) {
    const cabinet = $('#cabinetButton');
    cabinet.classList.remove('switching');
    void cabinet.offsetWidth;
    cabinet.classList.add('switching');
    setTimeout(() => cabinet.classList.remove('switching'), 650);
  }
});

const articleObserver = new MutationObserver(() => {
  $$('#pricesBody tr').forEach(row => {
    if (row.dataset.copyReady) return;
    row.dataset.copyReady = '1';
    [row.children[2], row.children[3]].forEach(cell => {
      if (!cell) return;
      const value = cell.textContent.trim();
      cell.innerHTML = `<button class="copy-article" data-copy="${escapeHtml(value)}">${escapeHtml(value)}</button>`;
    });
  });
  $$('#ordersBody tr').forEach(row => {
    if (row.dataset.copyReady) return;
    const id = row.querySelector('.order-id small')?.textContent,
      data = state.orders.find(item => String(item.id) === id),
      small = row.children[2]?.querySelector('.product small');
    if (!data || !small) return;
    row.dataset.copyReady = '1';
    small.innerHTML = `${data.brand ? `${escapeHtml(data.brand)} · ` : ''}<button class="copy-article" data-copy="${escapeHtml(data.article || '')}">${escapeHtml(data.article || '—')}</button> · <button class="copy-article" data-copy="${escapeHtml(data.nmId || '')}">Арт. WB ${escapeHtml(data.nmId || '—')}</button>${data.barcode ? ` · <button class="copy-article" data-copy="${escapeHtml(data.barcode)}">${escapeHtml(data.barcode)}</button>` : ''}`;
  });
});
setTimeout(() => {
  ['pricesBody', 'ordersBody'].forEach(id => {
    const body = $(`#${id}`);
    if (body) articleObserver.observe(body, { childList: true });
  });
}, 0);
document.addEventListener('click', event => {
  const button = event.target.closest('[data-copy]');
  if (button) navigator.clipboard.writeText(button.dataset.copy).then(() => toast('Скопировано в буфер обмена'));
});
// defaultPrevented — признак перехода внутри страницы: при открытии пункта в новой вкладке текущая вкладка ничего не грузит.
document.addEventListener('click', event => {
  if (event.defaultPrevented && event.target.closest('.nav-item[data-page="funnel"]')) setTimeout(loadFunnelDetails, 50);
});
const refreshObserver = new MutationObserver(() =>
  $('#loadingOverlay')?.classList.toggle('visible', $('#refresh')?.classList.contains('loading'))
);
setTimeout(() => {
  const refresh = $('#refresh');
  if (refresh) refreshObserver.observe(refresh, { attributes: true, attributeFilter: ['class'] });
}, 0);
setTimeout(() => {
  const from = $('#dateFrom'),
    to = $('#dateTo'),
    month = $('#adMonth');
  from.onchange = to.onchange = () => {
    state.adsKey = '';
  };
  month.onchange = () => {
    if (!month.value) return;
    if (month.value === 'last31') {
      from.value = mskDate(-30);
      to.value = mskDate(0);
    } else {
      const [year, number] = month.value.split('-').map(Number),
        last = new Date(year, number, 0);
      from.value = `${year}-${String(number).padStart(2, '0')}-01`;
      to.value = `${year}-${String(number).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
    }
    state.adsKey = '';
    loadAds(true);
  };
  $$('#adStatusOptions input').forEach(
    input =>
      (input.onchange = () => {
        input.checked ? state.adStatuses.add(input.value) : state.adStatuses.delete(input.value);
        $('#adStatusLabel').textContent = `Статусы (${state.adStatuses.size})`;
        renderAdCampaigns();
      })
  );
  document.addEventListener('click', event => {
    const nav = event.target.closest('.nav-item');
    if (nav && event.defaultPrevented) month.classList.toggle('hidden', nav.dataset.page !== 'ads');
  });
}, 0);

// Обычный клик по пункту меню переключает вкладку без перезагрузки и записывает её в адрес (обновление страницы её сохранит).
// Ctrl/Shift/Cmd+клик браузер открывает сам в новой вкладке или окне; колесо мыши click вообще не вызывает.
function bind() {
  $$('.nav-item,[data-nav-page]').forEach(
    b =>
      (b.onclick = event => {
        if (event && (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
        event?.preventDefault();
        history.replaceState(null, '', `?page=${b.dataset.page}`);
        switchChangePeriod(state.activePage, b.dataset.page);
        state.activePage = b.dataset.page;
        toggleNotices(false);
        $$('.nav-item,[data-nav-page]').forEach(x => x.classList.toggle('active', x === b));
        $$('.page').forEach(x => x.classList.toggle('active', x.id === `page-${b.dataset.page}`));
        $('#pageTitle').textContent = {
          summary: 'Общая сводка',
          orders: 'Лента заказов',
          'fbs-orders': 'Новые заказы FBS',
          stocks: 'Остатки FBS',
          'fbw-stocks': 'Остатки FBW',
          prices: 'Цены и скидки',
          funnel: 'Воронка продаж',
          ratings: 'Оценки товаров',
          returns: 'Возвраты и перемещения',
          ads: 'Аналитика рекламы',
          todo: 'Список дел',
          history: 'История изменений',
          sima: 'Цены Сималенда',
          'sima-profit': 'Прибыль Сималенда',
          cards: 'Карточки товаров',
          messages: 'Сообщения покупателей'
        }[b.dataset.page];
        document.title = `${$('#pageTitle').textContent} — WB Pulse`;
        const noPeriod = ['stocks', 'fbw-stocks', 'fbs-orders', 'prices', 'todo', 'cards', 'messages', 'sima', 'sima-profit'].includes(
          b.dataset.page
        );
        $('.date').classList.toggle('hidden', noPeriod);
        $('#funnelRefetch').classList.toggle('hidden', b.dataset.page !== 'funnel');
        $('#stockHistoryButton').classList.toggle('hidden', b.dataset.page !== 'stocks');
        if (b.dataset.page === 'summary') loadSummary();
        if (b.dataset.page === 'orders') {
          loadOrdersHourly();
          if (state.dashboardKey !== [state.cabinet, $('#dateFrom').value, $('#dateTo').value].join(':')) loadDashboard();
        }
        if (b.dataset.page === 'ads') loadAds();
        if (b.dataset.page === 'ratings') loadRatings();
        if (b.dataset.page === 'returns') loadReturns();
        if (b.dataset.page === 'stocks') loadStocks();
        if (b.dataset.page === 'fbw-stocks') loadFbwStocks();
        if (b.dataset.page === 'prices') loadPrices();
        if (b.dataset.page === 'fbs-orders') loadFbsOrders();
        if (b.dataset.page === 'todo') loadTodos();
        if (b.dataset.page === 'history') loadChangeHistory();
        if (b.dataset.page === 'sima') loadSimaHistory();
        if (b.dataset.page === 'sima-profit') loadSimaProfit();
        if (b.dataset.page === 'cards') loadCards();
        if (b.dataset.page === 'messages') loadMessages();
      })
  );
  $('#refresh').onclick = () => loadCurrentPage(true);
  $('#funnelRefetch').onclick = openFunnelRefetch;
  $('#dateFrom').onchange = () => {
    state.adsKey = '';
    loadCurrentPage();
  };
  $('#dateTo').onchange = () => {
    state.adsKey = '';
    loadCurrentPage();
  };
  $('#search').oninput = renderOrders;
  $('#statusFilter').onchange = renderOrders;
  $('#adSearch').oninput = renderAdCampaigns;
  $('#adStatus').onchange = renderAdCampaigns;
  $('#stockSearch').oninput = () => {
    resetStockPage();
    renderStocks();
  };
  $('#fbwStockSearch').oninput = () => {
    state.fbwPage = 1;
    renderFbwStocks();
  };
  $('#setStockButton').onclick = openSetStock;
  $('#stockPresetsButton').onclick = openStockPresets;
  $('#copyStockButton').onclick = openCopyStock;
  $('#clearStockSelection').onclick = () => {
    state.stockSelected.clear();
    renderStocks();
  };
  $('#priceSearch').oninput = () => {
    resetPricePage();
    renderPrices();
  };
  $('#setPriceButton').onclick = openSetPrices;
  $('#pricePresetsButton').onclick = openPricePresets;
  $('#clearPriceSelection').onclick = () => {
    state.priceSelected.clear();
    renderPrices();
  };
  $('#cabinetButton').onclick = () => $('#cabinetMenu').classList.toggle('open');
  $('#renameCabinet').onclick = () => {
    const c = state.cabinets.find(x => x.id === state.cabinet);
    if (!c.configured) return toast('Демо-кабинет переименовать нельзя');
    openModal(
      `<p class="eyebrow">Настройки кабинета</p><h2>Новое название</h2><input id="renameInput" maxlength="60" value="${escapeHtml(c.name)}"><button class="primary" id="saveName">Сохранить</button>`
    );
    setTimeout(() => $('#renameInput').focus(), 0);
    $('#saveName').onclick = async () => {
      try {
        const name = $('#renameInput').value.trim();
        await api(`/api/cabinets/${c.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        c.name = name;
        renderCabinets();
        closeModal();
        toast('Название сохранено');
      } catch (e) {
        toast(e.message);
      }
    };
  };
  $('#modalClose').onclick = closeModal;
  $('#modal').onpointerdown = e => {
    state.modalPressOnBackdrop = e.target === $('#modal');
  };
  $('#modal').onclick = e => {
    /* Закрывать, только если и нажали, и отпустили на фоне: при выделении текста кнопку отпускают за краем окна — браузер засчитывает такой клик фону */ if (
      e.target === $('#modal') &&
      state.modalPressOnBackdrop
    )
      closeModal();
    state.modalPressOnBackdrop = false;
  };
  bindFbsOrders();
}

// Ширина столбцов всех таблиц — общий модуль public/column-widths.js.
async function init() {
  setDates();
  bind();
  try {
    await loadCabinets();
    loadMessagesSummary();
    const page = new URLSearchParams(location.search).get('page');
    if (page !== 'orders') loadDashboard(true);
    if (
      [
        'orders',
        'funnel',
        'fbs-orders',
        'stocks',
        'fbw-stocks',
        'prices',
        'ratings',
        'returns',
        'ads',
        'todo',
        'history',
        'sima',
        'sima-profit',
        'cards',
        'messages'
      ].includes(page)
    )
      $(`.nav-item[data-page="${page}"],[data-nav-page][data-page="${page}"]`).click();
    else loadSummary();
  } catch (e) {
    toast(e.message);
  }
}

init();
