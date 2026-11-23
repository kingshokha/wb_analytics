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
      // Список приходит частями, и каждая часть — новые строки без остатков: уже загруженные остатки
      // подставляются сразу, иначе после первой части в колонке «Остаток» оставался бы прочерк.
      if (state.priceStocks && state.priceStocksKey === state.cabinet) mergePriceStocks();
      state.demo = data.demo;
      renderPrices();
      setNotices('prices', 'load', data.warnings);
    });
  } catch (e) {
    toast(e.message);
    addNotice('prices', `Ошибка загрузки цен: ${e.message}`);
  }
}
// Фильтры — общий компонент (js/common/multi-filter.js); выбранное — в state.priceFilters.
const priceFilter = (target, label, key) =>
  multiFilter(target, {
    label,
    selected: () => state.priceFilters[key],
    onChange: () => {
      resetPricePage();
      renderPrices();
    }
  });
const priceCategoryFilter = priceFilter('#priceCategoryFilter', 'Категории', 'categories'),
  priceBrandFilter = priceFilter('#priceBrandFilter', 'Бренды', 'brands'),
  priceDiscountFilter = priceFilter('#priceDiscountFilter', 'Скидки', 'discounts').setItems([
    { value: 'discounted', label: 'Со скидкой' },
    { value: 'none', label: 'Без скидки' },
    { value: 'club', label: 'Скидка WB Клуба' }
  ]);
function priceFilterOptions() {
  const data = state.prices || {};
  priceCategoryFilter.setItems(data.categories || []);
  priceBrandFilter.setItems(data.brands || []);
  priceDiscountFilter.refresh();
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
        bv = b[key] ?? '';
      // Пустые значения (например, нет даты создания — карточки нет в списке) — в конце при любом направлении.
      if (key === 'createdAt' && (av === '' || bv === '')) return (av === '') - (bv === '');
      const result =
        typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru', { numeric: true });
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
        `<tr><td class="check-col"><input type="checkbox" data-price-row="${row.nmId}" ${state.priceSelected.has(String(row.nmId)) ? 'checked' : ''}></td><td class="price-product-cell" data-price-open="${row.nmId}" title="История цены и изменение">${row.photo ? `<img class="stock-product-photo" src="${escapeHtml(row.photo)}" alt="" loading="lazy">` : ''}<span><strong>${escapeHtml(row.name)}</strong><small>${row.editableSizePrice ? `Цены размеров · ${row.sizes}` : 'Единая цена'}</small></span></td><td><strong>${escapeHtml(row.vendorCode || '—')}</strong></td><td><strong>${row.nmId}</strong></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.brand)}</td><td><strong>${fmtRub(row.price)}</strong></td><td><strong>${fmtPercent(row.discount)}</strong></td><td><strong>${fmtRub(row.discountedPrice)}</strong></td><td>${fmtPercent(row.clubDiscount)}</td><td>${priceStockCell(row)}</td><td>${priceCreatedCell(row)}</td></tr>`
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
const selectedPriceRows = () => (state.prices?.rows || []).filter(row => state.priceSelected.has(String(row.nmId)));
const BULK_PRICE_SHOWN = 200;
// Итог массового изменения: цена со скидкой после ввода и по каждому товару «сейчас → станет».
function renderBulkPricePreview() {
  const price = Number($('#newPriceInput').value),
    discount = Number($('#newDiscountInput').value),
    box = $('#bulkPricePreview'),
    button = $('#confirmSetPrices');
  const valid = Number.isFinite(price) && price > 0 && Number.isInteger(discount) && discount >= 0 && discount <= 99;
  button.disabled = !valid;
  if (!valid) {
    box.innerHTML = $('#newPriceInput').value
      ? '<p class="price-down">Цена — больше 0, скидка — целое число от 0 до 99%</p>'
      : '<p class="price-product-note">Введите цену — здесь появится окончательная цена со скидкой.</p>';
    return;
  }
  const discounted = Math.round((price * (100 - discount)) / 100),
    rows = selectedPriceRows();
  const drops = rows.filter(row => row.discountedPrice && (row.discountedPrice - discounted) / row.discountedPrice >= 0.3).length;
  const list = rows
    .slice(0, BULK_PRICE_SHOWN)
    .map(
      row =>
        `<div><span>${escapeHtml(row.name)}<small>${escapeHtml(row.vendorCode || '—')} · ${escapeHtml(row.nmId)}</small></span>` +
        `<span>${fmtRub(row.discountedPrice)} → <strong>${fmtRub(discounted)}</strong> ${priceChange(discounted, row.discountedPrice)}</span></div>`
    )
    .join('');
  const more =
    rows.length > BULK_PRICE_SHOWN ? `<p class="price-product-note">И ещё ${fmtNum(rows.length - BULK_PRICE_SHOWN)} товаров.</p>` : '';
  box.innerHTML =
    `<p class="bulk-price-total">Окончательная цена со скидкой: <strong>${fmtRub(discounted)}</strong></p>` +
    (drops
      ? `<p class="price-down">У ${fmtNum(drops)} товаров цена со скидкой падает на 30% и больше — проверьте, нет ли опечатки.</p>`
      : '') +
    `<div class="bulk-price-list">${list}${more}</div>`;
}
function openSetPrices() {
  if (state.demo) return toast('В демо-режиме изменение цен отключено');
  openModal(
    `<p class="eyebrow">Массовое изменение</p><h2>Задать цену и скидку</h2><p>Новые значения будут применены к товарам: ${state.priceSelected.size}. Для поразмерных карточек цена изменится у каждого размера.</p><label class="stock-modal-label">Цена, ₽<input id="newPriceInput" type="number" min="1" step="1"></label><label class="stock-modal-label">Скидка продавца, %<input id="newDiscountInput" type="number" min="0" max="99" step="1" value="0"></label><div id="bulkPricePreview"></div><button class="primary" id="confirmSetPrices">Отправить в WB</button>`
  );
  $('#newPriceInput').oninput = $('#newDiscountInput').oninput = renderBulkPricePreview;
  renderBulkPricePreview();
  $('#confirmSetPrices').onclick = async () => {
    const price = Number($('#newPriceInput').value),
      discount = Number($('#newDiscountInput').value);
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(discount) || discount < 0 || discount > 99)
      return toast('Проверьте цену и скидку от 0 до 99%');
    const items = selectedPriceRows().map(row => ({
      nmId: row.nmId,
      price,
      discount,
      editableSizePrice: row.editableSizePrice,
      sizeItems: row.sizeItems
    }));
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

// --- «Заблокировать цену»: минимальная цена для автоакций и срок блокировки → файл Excel по шаблону WB ---
// Сайт ничего не меняет в WB: файл (POST /api/prices/min-price-file, server/prices/min-price-file.js) загружается
// в кабинете WB. Цена у каждого товара своя: «Цена для всех» и «Текущие цены со скидкой» заполняют все строки сразу.
const PRICE_LOCK_TERMS = ['7 дней', '30 дней', 'Бессрочно'];
const priceLock = { rows: [], prices: new Map(), term: 'Бессрочно' };
function renderPriceLockList() {
  const shown = priceLock.rows.slice(0, BULK_PRICE_SHOWN),
    rest = priceLock.rows.length - shown.length;
  $('#priceLockList').innerHTML =
    shown
      .map(
        row =>
          `<div><span>${escapeHtml(row.name)}<small>${escapeHtml(row.vendorCode || '—')} · ${escapeHtml(row.nmId)} · сейчас со скидкой ${fmtRub(row.discountedPrice)}</small></span>` +
          `<span><input type="number" min="1" step="1" placeholder="Цена, ₽" data-price-lock="${row.nmId}" value="${escapeHtml(priceLock.prices.get(String(row.nmId)) ?? '')}" aria-label="Минимальная цена, ₽"></span></div>`
      )
      .join('') +
    (rest > 0
      ? `<p class="price-product-note">И ещё ${fmtNum(rest)} товаров — их цены задаются кнопками «Цена для всех» и «Текущие цены со скидкой».</p>`
      : '');
  $$('[data-price-lock]').forEach(input => (input.oninput = () => priceLock.prices.set(input.dataset.priceLock, input.value)));
}
function openPriceLock() {
  priceLock.rows = selectedPriceRows();
  if (!priceLock.rows.length) return toast('Выберите товары');
  priceLock.prices = new Map(priceLock.rows.map(row => [String(row.nmId), '']));
  openModal(
    `<p class="eyebrow">Автоакции</p><h2>Заблокировать цену</h2>` +
      `<p>Товаров: ${fmtNum(priceLock.rows.length)}. Сайт соберёт файл Excel по шаблону WB «Шаблон обновления минимальной цены и блокировки автоакций»: новая минимальная цена для применения скидки по автоакции и новая блокировка. Загрузите файл в кабинете WB там же, где скачивается этот шаблон. Сам сайт в WB ничего не меняет.</p>` +
      `<div class="price-lock-row"><label class="stock-modal-label">Цена для всех, ₽<input id="priceLockAll" type="number" min="1" step="1"></label><button type="button" id="priceLockCurrent">Текущие цены со скидкой</button></div>` +
      `<div class="stock-modal-label">Срок блокировки<div class="price-lock-terms">${PRICE_LOCK_TERMS.map(
        term =>
          `<label><input type="radio" name="priceLockTerm" value="${term}" ${term === priceLock.term ? 'checked' : ''}> ${term}</label>`
      ).join('')}</div></div>` +
      `<div class="bulk-price-list" id="priceLockList"></div>` +
      `<button class="primary" id="priceLockDownload">Скачать Excel</button>`
  );
  renderPriceLockList();
  $('#priceLockAll').oninput = () => {
    const value = $('#priceLockAll').value;
    priceLock.rows.forEach(row => priceLock.prices.set(String(row.nmId), value));
    renderPriceLockList();
  };
  $('#priceLockCurrent').onclick = () => {
    $('#priceLockAll').value = '';
    priceLock.rows.forEach(row =>
      priceLock.prices.set(String(row.nmId), row.discountedPrice ? String(Math.round(row.discountedPrice)) : '')
    );
    renderPriceLockList();
  };
  $$('[name="priceLockTerm"]').forEach(input => (input.onchange = () => (priceLock.term = input.value)));
  $('#priceLockDownload').onclick = downloadPriceLock;
}
async function downloadPriceLock() {
  const items = priceLock.rows.map(row => ({
    nmId: row.nmId,
    price: Number(priceLock.prices.get(String(row.nmId))),
    vendorCode: row.vendorCode,
    category: row.category === 'Без категории' ? '' : row.category,
    brand: row.brand === 'Без бренда' ? '' : row.brand
  }));
  const wrong = items.filter(item => !Number.isInteger(item.price) || item.price < 1).length;
  if (wrong) return toast(`Укажите цену целым числом рублей больше нуля — не указана у товаров: ${fmtNum(wrong)}`);
  const button = $('#priceLockDownload');
  button.disabled = true;
  button.textContent = 'Собираем файл…';
  try {
    const response = await fetch('/api/prices/min-price-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cabinet: state.cabinet, lock: priceLock.term, items })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Ошибка ${response.status}`);
    }
    const stamp = new Date()
      .toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      .replace(', ', ' ')
      .replace(':', '.');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = `Шаблон обновления минимальной цены и блокировки автоакций ${stamp}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    toast(`Файл готов: товаров ${fmtNum(items.length)}, блокировка — ${priceLock.term}`);
  } catch (e) {
    toast(e.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Скачать Excel';
  }
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
// Дата создания карточки: дата крупно, время ниже; пока карточки догружаются — прочерк.
function priceCreatedCell(row) {
  if (!row.createdAt) return '<span class="stock-muted">—</span>';
  const date = new Date(row.createdAt);
  return `<strong>${date.toLocaleDateString('ru-RU')}</strong><small>${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>`;
}
function priceStockCell(row) {
  if (!state.priceStocks) return '<span class="stock-muted">Загрузка…</span>';
  if (row.stock == null) return '<span class="stock-muted">—</span>';
  return `<strong class="${row.stock > 0 ? 'in-stock' : 'out-stock'}">${fmtNum(row.stock)} шт</strong><small>FBS ${fmtNum(row.stockFbs)} · FBW ${fmtNum(row.stockFbw)}</small>`;
}
