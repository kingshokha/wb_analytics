// --- «Остатки FBS» и «Остатки FBW»: таблицы остатков, «Задать остаток», копирование на склады ---

async function loadStocks(force = false) {
  if (!force && state.stocksKey === state.cabinet && state.stocks && !state.stocks.partial) {
    renderStocks();
    return state.stocks;
  }
  try {
    return await loadProgressive('stocks', '/api/fbs-stocks', force, (data, first) => {
      const sameCabinet = state.stocksKey === state.cabinet;
      state.stocks = data;
      state.stocksKey = state.cabinet;
      if (first) state.stockSelected = new Set();
      if (!sameCabinet) {
        state.stockFilters = { warehouses: new Set(), categories: new Set(), availability: new Set() };
        resetStockPage();
      }
      state.demo = data.demo;
      renderStocks();
      $('#cabinetMode').textContent = data.demo ? 'Демо-данные' : 'Единый токен активен';
      setNotices('stocks', 'load', data.warnings);
    });
  } catch (e) {
    toast(e.message);
    addNotice('stocks', `Ошибка загрузки остатков FBS: ${e.message}`);
  }
}
async function loadFbwStocks(force = false) {
  if (!force && state.fbwStocksKey === state.cabinet && state.fbwStocks && !state.fbwStocks.partial) {
    renderFbwStocks();
    return state.fbwStocks;
  }
  try {
    return await loadProgressive('fbw-stocks', '/api/fbw-stocks', force, (data, first) => {
      const sameCabinet = state.fbwStocksKey === state.cabinet;
      state.fbwStocks = data;
      state.fbwStocksKey = state.cabinet;
      if (first && !sameCabinet) {
        state.fbwFilters = { warehouses: new Set(), categories: new Set(), availability: new Set() };
        state.fbwPage = 1;
      }
      state.demo = data.demo;
      renderFbwStocks();
      $('#cabinetMode').textContent = data.demo ? 'Демо-данные' : 'Единый токен активен';
      setNotices('fbw-stocks', 'load', data.warnings);
    });
  } catch (e) {
    toast(e.message);
    addNotice('fbw-stocks', `Ошибка загрузки остатков FBW: ${e.message}`);
  }
}
// Фильтры остатков FBW и FBS — общий компонент (js/common/multi-filter.js); выбранное — в state.fbwFilters / state.stockFilters.
const STOCK_AVAILABILITY = [
  { value: 'positive', label: 'В наличии' },
  { value: 'zero', label: 'Нулевые' }
];
function stockFilters(prefix, filters, changed) {
  const make = (label, key) =>
    multiFilter(`#${prefix}${label[1]}Filter`, { label: label[0], selected: () => state[filters][key], onChange: changed });
  return {
    warehouses: make(['Склады', 'Warehouse'], 'warehouses'),
    categories: make(['Категории', 'Category'], 'categories'),
    availability: make(['Наличие', 'Availability'], 'availability').setItems(STOCK_AVAILABILITY),
    set(data) {
      this.warehouses.setItems((data.warehouses || []).map(item => ({ value: item.id, label: item.name })));
      this.categories.setItems(data.categories || []);
      this.availability.refresh();
    }
  };
}
const fbwStockFilters = stockFilters('fbw', 'fbwFilters', () => {
  state.fbwPage = 1;
  renderFbwStocks();
});
function setFbwFilterOptions(data) {
  fbwStockFilters.set(data);
}
// Пагинация — общая (pager.js); число строк на странице у каждой таблицы своё и запоминается.
function renderFbwPagination(pageCount, total) {
  renderPager($('#fbwStockPagination'), {
    page: state.fbwPage,
    pageCount,
    total,
    sizeKey: 'fbw-stocks',
    onPage: page => {
      state.fbwPage = page;
      renderFbwStocks();
      document.querySelector('#page-fbw-stocks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    onSize: size => {
      state.fbwPageSize = size;
      state.fbwPage = 1;
      renderFbwStocks();
    }
  });
}
function renderFbwStocks() {
  const data = state.fbwStocks || {},
    rows = data.rows || [],
    t = data.totals || {};
  const metrics = [
    ['Всего единиц', fmtNum(t.amount), 'на складах WB', '#7651e5'],
    ['Позиций', fmtNum(t.rows), 'товарных позиций', '#9d77ff'],
    ['Товаров', fmtNum(t.products), 'уникальных товаров', '#318f68'],
    ['Складов', fmtNum(t.warehouses), 'складов WB', '#f0a04b'],
    ['В наличии', fmtNum(t.positive), 'позиций с количеством', '#318f68'],
    ['Нулевые', fmtNum(t.zero), 'позиций без остатка', '#e76464']
  ];
  if (document.querySelector('#fbwStockMetrics'))
    document.querySelector('#fbwStockMetrics').innerHTML = metrics
      .map(
        x =>
          `<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${x[1]}</div><div class="metric-note">${x[2]}</div></article>`
      )
      .join('');
  setFbwFilterOptions(data);
  const term = $('#fbwStockSearch').value.toLowerCase(),
    filtered = rows
      .filter(
        row =>
          (!state.fbwFilters.warehouses.size || state.fbwFilters.warehouses.has(String(row.warehouseId))) &&
          (!state.fbwFilters.categories.size || state.fbwFilters.categories.has(row.category)) &&
          (!state.fbwFilters.availability.size ||
            ([...state.fbwFilters.availability].includes('positive') && row.amount > 0) ||
            ([...state.fbwFilters.availability].includes('zero') && row.amount === 0)) &&
          (!term ||
            [row.name, row.vendorCode, row.nmId, row.sku, row.category, row.warehouseName, row.regionName, row.size]
              .join(' ')
              .toLowerCase()
              .includes(term))
      )
      .sort((a, b) => {
        const key = state.fbwSort.key,
          av = a[key] ?? '',
          bv = b[key] ?? '';
        const result =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv), 'ru', { numeric: true, sensitivity: 'base' });
        return state.fbwSort.dir === 'asc' ? result : -result;
      });
  const pageCount = Math.ceil(filtered.length / state.fbwPageSize);
  state.fbwPage = Math.min(Math.max(1, state.fbwPage), Math.max(1, pageCount));
  const start = (state.fbwPage - 1) * state.fbwPageSize,
    pageRows = filtered.slice(start, start + state.fbwPageSize);
  $('#fbwStockCount').textContent = `${filtered.length} из ${rows.length} позиций${progressNote(state.fbwStocks)}`;
  $('#emptyFbwStocks').classList.toggle('hidden', filtered.length > 0);
  $('#fbwStocksBody').innerHTML = pageRows
    .map(
      row =>
        `<tr><td class="fbw-product-cell">${row.photo ? `<img class="stock-product-photo" src="${escapeHtml(row.photo)}" alt="" loading="lazy">` : ''}<strong>${escapeHtml(row.name)}</strong></td><td><strong>${escapeHtml(row.vendorCode || '—')}</strong></td><td><strong>${escapeHtml(row.nmId || '—')}</strong></td><td>${escapeHtml(row.category || '—')}</td><td><strong>${escapeHtml(row.warehouseName || '—')}</strong><small>ID ${escapeHtml(row.warehouseId || '—')}</small></td><td><strong class="stock-amount ${row.amount > 0 ? 'in-stock' : 'out-stock'}">${fmtNum(row.amount)}</strong></td><td>${fmtNum(row.inWayToClient)}</td><td>${fmtNum(row.inWayFromClient)}</td></tr>`
    )
    .join('');
  renderFbwPagination(pageCount, filtered.length);
  $$('#fbwStocksBody .stock-product-photo').forEach(image => {
    if (!image.dataset.previewBound) {
      image.dataset.previewBound = '1';
      bindPhotoPreview(image);
    }
  });
  $$('[data-fbw-sort]').forEach(
    header =>
      (header.onclick = () => {
        const key = header.dataset.fbwSort;
        state.fbwSort =
          state.fbwSort.key === key
            ? { key, dir: state.fbwSort.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: key === 'amount' ? 'desc' : 'asc' };
        state.fbwPage = 1;
        renderFbwStocks();
      })
  );
}
function stockRowKey(row) {
  return `${row.warehouseId}:${row.chrtId}`;
}
function stockSelectedRows() {
  return (state.stocks?.rows || []).filter(row => state.stockSelected.has(stockRowKey(row)));
}
// После изменения остатков — не перезагрузка всего списка: сервер перечитал у WB только изменённые позиции (stocks:
// [{warehouseId,chrtId,amount}]), они подставляются в строки. Позиция, скопированная на новый склад, — новая строка с данными
// товара из строки того же размера. Итоги пересчитываются по строкам так же, как на сервере (normalizeFbsStocks).
// meta — сведения о размерах, которых ещё нет ни на одном складе (окно «Добавить вручную»): chrtId → { nmId, name, … }.
function applyStockChanges(result, cabinet, meta = null) {
  if (state.cabinet !== cabinet || state.stocksKey !== cabinet || !state.stocks) return;
  const data = state.stocks,
    rows = data.rows || (data.rows = []),
    byKey = new Map(rows.map(row => [stockRowKey(row), row])),
    bySize = new Map(rows.map(row => [String(row.chrtId), row]));
  for (const change of result?.stocks || []) {
    const row = byKey.get(`${change.warehouseId}:${change.chrtId}`);
    if (row) {
      row.amount = Number(change.amount) || 0;
      continue;
    }
    const source = bySize.get(String(change.chrtId)) || meta?.get(String(change.chrtId)),
      warehouse = (data.warehouses || []).find(item => String(item.id) === String(change.warehouseId));
    if (!source || !warehouse) continue;
    const added = {
      ...source,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      officeId: warehouse.officeId,
      amount: Number(change.amount) || 0
    };
    rows.push(added);
    byKey.set(stockRowKey(added), added);
  }
  data.totals = {
    rows: rows.length,
    products: new Set(rows.map(row => String(row.nmId || row.chrtId))).size,
    warehouses: new Set(rows.map(row => String(row.warehouseId))).size,
    amount: rows.reduce((sum, row) => sum + row.amount, 0),
    zero: rows.filter(row => row.amount === 0).length,
    positive: rows.filter(row => row.amount > 0).length
  };
  renderStocks();
  if (result?.warnings?.length) toast(result.warnings.join(' '));
}
const fbsStockFilters = stockFilters('stock', 'stockFilters', () => {
  resetStockPage();
  renderStocks();
});
function setStockFilterOptions(data) {
  fbsStockFilters.set(data);
}
function resetStockPage() {
  state.stockPage = 1;
}
function scrollStocksToTop() {
  document.querySelector('#page-stocks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderStockPagination(pageCount, total) {
  renderPager($('#stockPagination'), {
    page: state.stockPage,
    pageCount,
    total,
    sizeKey: 'fbs-stocks',
    onPage: page => {
      state.stockPage = page;
      renderStocks();
      scrollStocksToTop();
    },
    onSize: size => {
      state.stockPageSize = size;
      state.stockPage = 1;
      renderStocks();
    }
  });
}
function renderStocks() {
  const data = state.stocks || {},
    rows = data.rows || [],
    t = data.totals || {};
  const metrics = [
    ['Всего единиц', fmtNum(t.amount), 'по складам FBS', '#7651e5'],
    ['Позиций', fmtNum(t.rows), 'товарных позиций', '#9d77ff'],
    ['Товаров', fmtNum(t.products), 'уникальных товаров', '#318f68'],
    ['Складов', fmtNum(t.warehouses), 'с остатками', '#f0a04b'],
    ['В наличии', fmtNum(t.positive), 'позиций с количеством', '#318f68'],
    ['Нулевые', fmtNum(t.zero), 'позиций без остатка', '#e76464']
  ];
  $('#stockMetrics').innerHTML = metrics
    .map(
      x =>
        `<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${x[1]}</div><div class="metric-note">${x[2]}</div></article>`
    )
    .join('');
  setStockFilterOptions(data);
  const term = $('#stockSearch').value.toLowerCase(),
    filtered = rows
      .filter(
        row =>
          (!state.stockFilters.warehouses.size || state.stockFilters.warehouses.has(String(row.warehouseId))) &&
          (!state.stockFilters.categories.size || state.stockFilters.categories.has(row.category)) &&
          (!state.stockFilters.availability.size ||
            ([...state.stockFilters.availability].includes('positive') && row.amount > 0) ||
            ([...state.stockFilters.availability].includes('zero') && row.amount === 0)) &&
          (!term || [row.name, row.vendorCode, row.nmId, row.sku, row.category, row.warehouseName].join(' ').toLowerCase().includes(term))
      )
      .sort((a, b) => {
        const key = state.stockSort.key,
          av = a[key] ?? '',
          bv = b[key] ?? '';
        const result =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv), 'ru', { numeric: true, sensitivity: 'base' });
        return state.stockSort.dir === 'asc' ? result : -result;
      });
  const pageCount = Math.ceil(filtered.length / state.stockPageSize);
  state.stockPage = Math.min(Math.max(1, state.stockPage), Math.max(1, pageCount));
  const start = (state.stockPage - 1) * state.stockPageSize,
    pageRows = filtered.slice(start, start + state.stockPageSize);
  $('#stockCount').textContent = `${filtered.length} из ${rows.length} позиций${progressNote(state.stocks)}`;
  $('#emptyStocks').classList.toggle('hidden', filtered.length > 0);
  $('#stockSelectAll').checked = pageRows.length > 0 && pageRows.every(row => state.stockSelected.has(stockRowKey(row)));
  $('#stocksBody').innerHTML = pageRows
    .map(
      row =>
        `<tr><td class="check-col"><input type="checkbox" data-stock-row="${escapeHtml(stockRowKey(row))}" ${state.stockSelected.has(stockRowKey(row)) ? 'checked' : ''} aria-label="Выбрать ${escapeHtml(row.name)}"></td><td><strong>${escapeHtml(row.name)}</strong></td><td><strong>${escapeHtml(row.vendorCode || '—')}</strong></td><td><strong>${escapeHtml(row.nmId || '—')}</strong></td><td>${escapeHtml(row.category || '—')}</td><td><strong>${escapeHtml(row.warehouseName || '—')}</strong><small>ID ${escapeHtml(row.warehouseId || '—')}</small></td><td>${escapeHtml(row.sku || '—')}</td><td><strong class="stock-amount ${row.amount > 0 ? 'in-stock' : 'out-stock'}">${fmtNum(row.amount)}</strong></td></tr>`
    )
    .join('');
  renderStockPagination(pageCount, filtered.length);
  $$('[data-stock-row]').forEach(
    input =>
      (input.onchange = () => {
        input.checked ? state.stockSelected.add(input.dataset.stockRow) : state.stockSelected.delete(input.dataset.stockRow);
        renderStockActions();
      })
  );
  $$('[data-stock-sort]').forEach(
    header =>
      (header.onclick = () => {
        const key = header.dataset.stockSort;
        state.stockSort =
          state.stockSort.key === key
            ? { key, dir: state.stockSort.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: key === 'amount' ? 'desc' : 'asc' };
        resetStockPage();
        renderStocks();
      })
  );
  $('#stockSelectAll').onchange = () => {
    pageRows.forEach(row => inputSelection(state.stockSelected, stockRowKey(row), $('#stockSelectAll').checked));
    renderStocks();
  };
  renderStockActions();
}

function renderStockActions() {
  const count = state.stockSelected.size;
  $('#stockActions').classList.toggle('hidden', !count);
  $('#stockSelectedCount').textContent = `Выбрано: ${fmtNum(count)}`;
}
async function setSelectedStock() {
  if (state.demo) return toast('В демо-режиме изменение остатков отключено');
  const amount = Number($('#stockAmountInput').value);
  if (!Number.isInteger(amount) || amount < 0) return toast('Введите целое число не меньше нуля');
  const items = stockSelectedRows().map(row => ({ warehouseId: row.warehouseId, chrtId: row.chrtId, amount }));
  const cabinet = state.cabinet;
  try {
    const result = await api('/api/fbs-stocks/update', { method: 'POST', body: JSON.stringify({ cabinet, items, confirm: true }) });
    closeModal();
    toast('Остатки обновлены');
    applyStockChanges(result, cabinet);
  } catch (e) {
    toast(e.message);
  }
}
function openSetStock() {
  openModal(
    `<p class="eyebrow">Массовое изменение</p><h2>Задать остаток</h2><p>Будет обновлено товаров: ${state.stockSelected.size}. Значение применится к каждой выбранной позиции на её складе.</p><label class="stock-modal-label">Количество<input id="stockAmountInput" type="number" min="0" step="1" value="0"></label><div class="stock-quick-amounts">${[10, 20, 30, 40, 50].map(amount => `<button type="button" data-stock-quick="${amount}">${amount} шт</button>`).join('')}</div><button class="primary" id="confirmSetStock">Сохранить остаток</button>`
  );
  $('#confirmSetStock').onclick = setSelectedStock;
  const amountInput = $('#stockAmountInput'),
    markQuick = () =>
      $$('[data-stock-quick]').forEach(button => button.classList.toggle('active', button.dataset.stockQuick === amountInput.value));
  $$('[data-stock-quick]').forEach(
    button =>
      (button.onclick = () => {
        amountInput.value = button.dataset.stockQuick;
        markQuick();
        amountInput.focus();
      })
  );
  amountInput.oninput = markQuick;
}
function openCopyStock() {
  if (state.demo) return toast('В демо-режиме копирование отключено');
  const sourceIds = new Set(stockSelectedRows().map(row => String(row.warehouseId))),
    warehouses = (state.stocks?.warehouses || []).filter(item => !sourceIds.has(String(item.id)));
  if (!warehouses.length) return toast('Выберите товары и оставьте доступный другой склад для копирования');
  openModal(
    `<div class="stock-target-options"><label class="stock-target-all"><input type="checkbox" id="copyTargetAll"> <span>Выбрать все склады</span></label>${warehouses.map(item => `<label><input type="checkbox" name="copyTargetWarehouse" value="${escapeHtml(item.id)}"> <span>${escapeHtml(item.name)}</span></label>`).join('')}</div><button class="primary" id="confirmCopyStock">Скопировать остатки</button>`
  );
  const targetInputs = () => $$('input[name="copyTargetWarehouse"]');
  $('#copyTargetAll').onchange = () => {
    targetInputs().forEach(input => (input.checked = $('#copyTargetAll').checked));
  };
  targetInputs().forEach(
    input =>
      (input.onchange = () => {
        $('#copyTargetAll').checked = targetInputs().every(item => item.checked);
      })
  );
  $('#confirmCopyStock').onclick = async () => {
    const targets = targetInputs()
      .filter(input => input.checked)
      .map(input => input.value);
    if (!targets.length) return toast('Выберите хотя бы один целевой склад');
    const items = [...new Map(stockSelectedRows().map(row => [String(row.chrtId), { chrtId: row.chrtId, amount: row.amount }])).values()];
    const cabinet = state.cabinet;
    try {
      const result = await api('/api/fbs-stocks/copy', {
        method: 'POST',
        body: JSON.stringify({ cabinet, targetWarehouseIds: targets, items, confirm: true })
      });
      closeModal();
      toast(`Товары скопированы на складов: ${targets.length}`);
      applyStockChanges(result, cabinet);
    } catch (e) {
      toast(e.message);
    }
  };
}

const stockObserver = new MutationObserver(() => {
  const body = $('#stocksBody');
  if (!body) return;
  body.querySelectorAll('[data-stock-row]').forEach(input => {
    const row = input.closest('tr'),
      data = (state.stocks?.rows || []).find(item => stockRowKey(item) === input.dataset.stockRow);
    if (!row || row.dataset.decorated === '1' || !data) return;
    row.dataset.decorated = '1';
    const productCell = row.children[1];
    if (data.photo) {
      const image = document.createElement('img');
      image.className = 'stock-product-photo';
      image.src = data.photo;
      image.alt = '';
      image.loading = 'lazy';
      bindPhotoPreview(image);
      productCell.prepend(image);
    }
    [row.children[2], row.children[3], row.children[6]].forEach(cell => {
      const value = cell.textContent.trim(),
        button = document.createElement('button');
      button.className = 'copy-article';
      button.textContent = value;
      button.title = 'Скопировать';
      button.dataset.copy = value;
      cell.textContent = '';
      cell.append(button);
    });
  });
});
setTimeout(() => {
  const body = $('#stocksBody');
  if (body) stockObserver.observe(body, { childList: true });
}, 0);
