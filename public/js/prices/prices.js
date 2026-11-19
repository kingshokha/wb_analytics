// --- «Цены и скидки»: таблица цен, «Задать цену и скидку», остатки у цен ---

async function loadPrices(force = false) {
  if (!force && state.pricesKey === state.cabinet && state.prices && !state.prices.partial) {
    renderPrices();
    return state.prices;
  }
  try {
    return await loadProgressive('prices', '/api/prices', force, (data, first) => {
      const sameCabinet = state.pricesKey === state.cabinet;
      state.prices = data;
      state.pricesKey = state.cabinet;
      if (first) {
        state.priceSelected = new Set();
        if (!sameCabinet) {
          state.priceFilters = { categories: new Set(), brands: new Set(), discounts: new Set() };
          resetPricePage();
        }
        loadPriceStocks(force);
      }
      state.demo = data.demo;
      renderPrices();
      setNotices('prices', 'load', data.warnings);
    });
  } catch (e) {
    toast(e.message);
    addNotice('prices', `Ошибка загрузки цен: ${e.message}`);
  }
}
function priceFilterOptions() {
  const data = state.prices || {};
  for (const [id, items, key] of [
    ['priceCategoryOptions', data.categories || [], 'categories'],
    ['priceBrandOptions', data.brands || [], 'brands']
  ]) {
    $(`#${id}`).innerHTML =
      items
        .map(
          value =>
            `<label><input type="checkbox" value="${escapeHtml(value)}" ${state.priceFilters[key].has(String(value)) ? 'checked' : ''}> ${escapeHtml(value)}</label>`
        )
        .join('') || '<span class="filter-empty">Нет вариантов</span>';
    $$(`#${id} input`).forEach(
      input =>
        (input.onchange = () => {
          input.checked ? state.priceFilters[key].add(input.value) : state.priceFilters[key].delete(input.value);
          resetPricePage();
          renderPrices();
        })
    );
  }
  $$('#priceDiscountOptions input').forEach(input => {
    input.checked = state.priceFilters.discounts.has(input.value);
    input.onchange = () => {
      input.checked ? state.priceFilters.discounts.add(input.value) : state.priceFilters.discounts.delete(input.value);
      resetPricePage();
      renderPrices();
    };
  });
  $('#priceCategoryLabel').textContent = state.priceFilters.categories.size
    ? `Категории (${state.priceFilters.categories.size})`
    : 'Категории';
  $('#priceBrandLabel').textContent = state.priceFilters.brands.size ? `Бренды (${state.priceFilters.brands.size})` : 'Бренды';
  $('#priceDiscountLabel').textContent = state.priceFilters.discounts.size ? `Скидки (${state.priceFilters.discounts.size})` : 'Скидки';
}
function priceRows() {
  const term = $('#priceSearch').value.toLowerCase(),
    f = state.priceFilters;
  return (state.prices?.rows || [])
    .filter(
      row =>
        (!f.categories.size || f.categories.has(row.category)) &&
        (!f.brands.size || f.brands.has(row.brand)) &&
        (!f.discounts.size ||
          (f.discounts.has('discounted') && row.discount > 0) ||
          (f.discounts.has('none') && row.discount === 0) ||
          (f.discounts.has('club') && row.clubDiscount > 0)) &&
        (!term || [row.name, row.vendorCode, row.nmId, row.category, row.brand].join(' ').toLowerCase().includes(term))
    )
    .sort((a, b) => {
      const key = state.priceSort.key,
        av = a[key] ?? '',
        bv = b[key] ?? '',
        result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru', { numeric: true });
      return state.priceSort.dir === 'asc' ? result : -result;
    });
}
function resetPricePage() {
  state.pricePage = 1;
}
function renderPricePagination(pageCount, total) {
  renderPager($('#pricePagination'), {
    page: state.pricePage,
    pageCount,
    total,
    sizeKey: 'prices',
    onPage: page => {
      state.pricePage = page;
      renderPrices();
      document.querySelector('#page-prices')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    onSize: size => {
      state.pricePageSize = size;
      state.pricePage = 1;
      renderPrices();
    }
  });
}
function renderPrices() {
  const data = state.prices || {};
  priceFilterOptions();
  const rows = priceRows(),
    pageCount = Math.ceil(rows.length / state.pricePageSize);
  state.pricePage = Math.min(Math.max(1, state.pricePage), Math.max(1, pageCount));
  const start = (state.pricePage - 1) * state.pricePageSize,
    pageRows = rows.slice(start, start + state.pricePageSize);
  $('#priceCount').textContent = `${rows.length} из ${(data.rows || []).length} товаров${progressNote(data)}`;
  $('#emptyPrices').classList.toggle('hidden', rows.length > 0);
  $('#priceSelectAll').checked = pageRows.length > 0 && pageRows.every(row => state.priceSelected.has(String(row.nmId)));
  $('#pricesBody').innerHTML = pageRows
    .map(
      row =>
        `<tr><td class="check-col"><input type="checkbox" data-price-row="${row.nmId}" ${state.priceSelected.has(String(row.nmId)) ? 'checked' : ''}></td><td class="price-product-cell" data-price-open="${row.nmId}" title="История цены и изменение">${row.photo ? `<img class="stock-product-photo" src="${escapeHtml(row.photo)}" alt="" loading="lazy">` : ''}<span><strong>${escapeHtml(row.name)}</strong><small>${row.editableSizePrice ? `Цены размеров · ${row.sizes}` : 'Единая цена'}</small></span></td><td><strong>${escapeHtml(row.vendorCode || '—')}</strong></td><td><strong>${row.nmId}</strong></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.brand)}</td><td><strong>${fmtRub(row.price)}</strong></td><td><strong>${fmtPercent(row.discount)}</strong></td><td><strong>${fmtRub(row.discountedPrice)}</strong></td><td>${fmtPercent(row.clubDiscount)}</td><td>${priceStockCell(row)}</td></tr>`
    )
    .join('');
  renderPricePagination(pageCount, rows.length);
  $$('#pricesBody .stock-product-photo').forEach(image => {
    if (image.dataset.previewBound) return;
    image.dataset.previewBound = '1';
    bindPhotoPreview(image);
  });
  $$('[data-price-row]').forEach(
    input =>
      (input.onchange = () => {
        inputSelection(state.priceSelected, input.dataset.priceRow, input.checked);
        renderPriceActions();
      })
  );
  $$('[data-price-sort]').forEach(
    header =>
      (header.onclick = () => {
        const key = header.dataset.priceSort;
        state.priceSort = state.priceSort.key === key ? { key, dir: state.priceSort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' };
        resetPricePage();
        renderPrices();
      })
  );
  $('#priceSelectAll').onchange = () => {
    pageRows.forEach(row => inputSelection(state.priceSelected, String(row.nmId), $('#priceSelectAll').checked));
    renderPrices();
  };
  renderPriceActions();
}
function renderPriceActions() {
  const count = state.priceSelected.size;
  $('#priceActions').classList.toggle('hidden', !count);
  $('#priceSelectedCount').textContent = `Выбрано: ${fmtNum(count)}`;
}
function openSetPrices() {
  if (state.demo) return toast('В демо-режиме изменение цен отключено');
  openModal(
    `<p class="eyebrow">Массовое изменение</p><h2>Задать цену и скидку</h2><p>Новые значения будут применены к товарам: ${state.priceSelected.size}. Для поразмерных карточек цена изменится у каждого размера.</p><label class="stock-modal-label">Цена, ₽<input id="newPriceInput" type="number" min="1" step="1"></label><label class="stock-modal-label">Скидка продавца, %<input id="newDiscountInput" type="number" min="0" max="99" step="1" value="0"></label><button class="primary" id="confirmSetPrices">Отправить в WB</button>`
  );
  $('#confirmSetPrices').onclick = async () => {
    const price = Number($('#newPriceInput').value),
      discount = Number($('#newDiscountInput').value);
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(discount) || discount < 0 || discount > 99)
      return toast('Проверьте цену и скидку от 0 до 99%');
    const items = (state.prices?.rows || [])
      .filter(row => state.priceSelected.has(String(row.nmId)))
      .map(row => ({ nmId: row.nmId, price, discount, editableSizePrice: row.editableSizePrice, sizeItems: row.sizeItems }));
    try {
      await api('/api/prices/update', { method: 'POST', body: JSON.stringify({ cabinet: state.cabinet, items, confirm: true }) });
      closeModal();
      toast('Загрузка цен создана в WB');
      await loadPrices(true);
    } catch (e) {
      toast(e.message);
    }
  };
}

// --- Общие остатки в ценах и скидках ---
function mergePriceStocks() {
  const byNmId = state.priceStocks?.byNmId || {},
    failed = !state.priceStocks || state.priceStocks.failed;
  for (const row of state.prices?.rows || []) {
    const totals = byNmId[String(row.nmId)];
    row.stock = failed ? undefined : Number(totals?.total || 0);
    row.stockFbs = Number(totals?.fbs || 0);
    row.stockFbw = Number(totals?.fbw || 0);
  }
}
async function loadPriceStocks(force = false) {
  const cabinet = state.cabinet;
  if (!force && state.priceStocksKey === cabinet && state.priceStocks) {
    mergePriceStocks();
    if (state.activePage === 'prices') renderPrices();
    return;
  }
  state.priceStocks = null;
  try {
    const data = await api(`/api/prices/stocks?cabinet=${encodeURIComponent(cabinet)}`);
    if (cabinet !== state.cabinet) return;
    state.priceStocks = data;
    state.priceStocksKey = cabinet;
    setNotices('prices', 'stocks', data.warnings || []);
  } catch (e) {
    if (cabinet !== state.cabinet) return;
    state.priceStocks = { byNmId: {}, failed: true };
    setNotices('prices', 'stocks', [`Остатки: ${e.message}`], 'error');
  }
  mergePriceStocks();
  if (state.activePage === 'prices') renderPrices();
}
function priceStockCell(row) {
  if (!state.priceStocks) return '<span class="stock-muted">Загрузка…</span>';
  if (row.stock == null) return '<span class="stock-muted">—</span>';
  return `<strong class="${row.stock > 0 ? 'in-stock' : 'out-stock'}">${fmtNum(row.stock)} шт</strong><small>FBS ${fmtNum(row.stockFbs)} · FBW ${fmtNum(row.stockFbw)}</small>`;
}
