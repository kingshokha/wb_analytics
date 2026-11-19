// --- «Новые заказы FBS»: сборочные задания, поставки, короба, стикеры ---

async function loadFbsOrders(force = false) {
  if (!force && state.fbsOrdersKey === state.cabinet && state.fbsOrders) {
    renderFbsOrders();
    renderSupplies();
    return;
  }
  const btn = $('#refresh');
  btn.classList.add('loading');
  try {
    const [orders, supplies] = await Promise.all([
      api(`/api/fbs-orders?cabinet=${encodeURIComponent(state.cabinet)}`),
      api(`/api/supplies?cabinet=${encodeURIComponent(state.cabinet)}`)
    ]);
    state.fbsOrders = orders;
    state.supplies = supplies;
    state.fbsOrdersKey = state.cabinet;
    state.fbsSelected = new Set();
    state.fbsFilters = { warehouses: new Set(), categories: new Set(), assembly: new Set() };
    state.fbsPage = 1;
    state.demo = orders.demo;
    renderFbsOrders();
    renderSupplies();
    $('#cabinetMode').textContent = orders.demo ? 'Демо-данные' : 'Единый токен активен';
    setNotices('fbs-orders', 'load', [...(orders.warnings || []), ...(supplies.warnings || [])]);
  } catch (e) {
    toast(e.message);
    addNotice('fbs-orders', `Ошибка загрузки новых заданий: ${e.message}`);
  } finally {
    btn.classList.remove('loading');
  }
}
function setFbsFilterOptions(data) {
  const filters = [
    ['fbsWarehouseOptions', data.warehouses || [], 'warehouses'],
    ['fbsCategoryOptions', (data.categories || []).map(name => ({ id: name, name })), 'categories']
  ];
  for (const [id, items, key] of filters) {
    $(`#${id}`).innerHTML =
      items
        .map(item => {
          const value = String(item.id);
          return `<label><input type="checkbox" value="${escapeHtml(value)}" ${state.fbsFilters[key].has(value) ? 'checked' : ''}> ${escapeHtml(item.name)}</label>`;
        })
        .join('') || '<span class="filter-empty">Нет вариантов</span>';
    $$(`#${id} input`).forEach(
      input =>
        (input.onchange = () => {
          inputSelection(state.fbsFilters[key], input.value, input.checked);
          state.fbsPage = 1;
          renderFbsOrders();
        })
    );
  }
  $$('#fbsAssemblyOptions input').forEach(input => {
    input.checked = state.fbsFilters.assembly.has(input.value);
    input.onchange = () => {
      inputSelection(state.fbsFilters.assembly, input.value, input.checked);
      state.fbsPage = 1;
      renderFbsOrders();
    };
  });
  $('#fbsWarehouseLabel').textContent = state.fbsFilters.warehouses.size ? `Склады (${state.fbsFilters.warehouses.size})` : 'Склады';
  $('#fbsCategoryLabel').textContent = state.fbsFilters.categories.size ? `Категории (${state.fbsFilters.categories.size})` : 'Категории';
}
function fbsFilteredRows() {
  const rows = state.fbsOrders?.rows || [],
    term = $('#fbsSearch').value.toLowerCase(),
    assembly = [...state.fbsFilters.assembly];
  return rows
    .filter(
      row =>
        (!state.fbsFilters.warehouses.size || state.fbsFilters.warehouses.has(String(row.warehouseId))) &&
        (!state.fbsFilters.categories.size || state.fbsFilters.categories.has(row.category)) &&
        (!assembly.length || (assembly.includes('free') && !row.supplyId) || (assembly.includes('assembled') && Boolean(row.supplyId))) &&
        (!term ||
          [row.id, row.nmId, row.chrtId, row.vendorCode, row.name, row.sku, row.category, row.supplyId]
            .join(' ')
            .toLowerCase()
            .includes(term))
    )
    .sort((a, b) => {
      const key = state.fbsSort.key,
        av = a[key] ?? '',
        bv = b[key] ?? '';
      const result =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'ru', { numeric: true, sensitivity: 'base' });
      return state.fbsSort.dir === 'asc' ? result : -result;
    });
}
function renderFbsPagination(pageCount, total) {
  renderPager($('#fbsPagination'), {
    page: state.fbsPage,
    pageCount,
    total,
    sizeKey: 'fbs-orders',
    onPage: page => {
      state.fbsPage = page;
      renderFbsOrders();
      document.querySelector('#page-fbs-orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    onSize: size => {
      state.fbsPageSize = size;
      state.fbsPage = 1;
      renderFbsOrders();
    }
  });
}
function renderFbsOrders() {
  const data = state.fbsOrders || {},
    rows = data.rows || [],
    t = data.totals || {},
    supplyTotals = state.supplies?.totals || {};
  $('#fbsBadge').textContent = fmtNum(t.free || 0);
  const metrics = [
    ['Новых заданий', fmtNum(t.orders), 'ожидают сборки', '#7651e5'],
    ['Без поставки', fmtNum(t.free), 'можно собрать', '#f0a04b'],
    ['В поставке', fmtNum(t.assembled), 'переданы на сборку', '#318f68'],
    ['Сумма', fmtMoney(t.amount), 'по новым заданиям', '#9d77ff'],
    ['Товаров', fmtNum(t.products), 'уникальных позиций', '#318f68'],
    ['Открытых поставок', fmtNum(supplyTotals.open), `всего ${fmtNum(supplyTotals.supplies)}`, '#e76464']
  ];
  $('#fbsMetrics').innerHTML = metrics
    .map(
      x =>
        `<article class="metric" style="--accent:${x[3]}"><div class="metric-label">${x[0]}</div><div class="metric-value">${x[1]}</div><div class="metric-note">${x[2]}</div></article>`
    )
    .join('');
  setFbsFilterOptions(data);
  const filtered = fbsFilteredRows(),
    pageCount = Math.ceil(filtered.length / state.fbsPageSize);
  state.fbsPage = Math.min(Math.max(1, state.fbsPage), Math.max(1, pageCount));
  const start = (state.fbsPage - 1) * state.fbsPageSize,
    pageRows = filtered.slice(start, start + state.fbsPageSize);
  $('#fbsCount').textContent = `${filtered.length} из ${rows.length} ${pluralRu(rows.length, ['задания', 'заданий', 'заданий'])}`;
  $('#emptyFbsOrders').classList.toggle('hidden', filtered.length > 0);
  $('#fbsSelectAll').checked = pageRows.length > 0 && pageRows.every(row => state.fbsSelected.has(String(row.id)));
  $('#fbsOrdersBody').innerHTML = pageRows
    .map(row => {
      const picture = row.photo ? `<img src="${escapeHtml(row.photo)}" alt="" loading="lazy">` : escapeHtml(String(row.name || 'Т')[0]);
      return `<tr><td class="check-col"><input type="checkbox" data-fbs-row="${escapeHtml(row.id)}" ${state.fbsSelected.has(String(row.id)) ? 'checked' : ''} aria-label="Выбрать задание ${escapeHtml(row.id)}"></td><td><strong>${formatDate(row.createdAt)}</strong><small>${escapeHtml(row.cargoTypeName)}</small></td><td><div class="product"><span class="product-icon ${row.photo ? 'has-photo' : ''}">${picture}</span><span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.category)} · ${escapeHtml(row.size)}</small></span></div></td><td><button class="copy-article" data-copy="${escapeHtml(row.vendorCode || '')}">${escapeHtml(row.vendorCode || '—')}</button></td><td><button class="copy-article" data-copy="${escapeHtml(row.nmId || '')}">${escapeHtml(row.nmId || '—')}</button></td><td><button class="copy-article" data-copy="${escapeHtml(row.sku || '')}">${escapeHtml(row.sku || '—')}</button></td><td><strong>${fmtMoney(row.price, row.currencyCode)}</strong></td><td>${row.supplyId ? `<button class="copy-article supply-link" data-supply-open="${escapeHtml(row.supplyId)}">${escapeHtml(row.supplyId)}</button>` : '<span class="status status-new">Без поставки</span>'}</td><td><small title="${escapeHtml(row.id)}">${escapeHtml(row.id)}</small></td></tr>`;
    })
    .join('');
  renderFbsPagination(pageCount, filtered.length);
  $$('#fbsOrdersBody img').forEach(bindPhotoPreview);
  $$('[data-fbs-row]').forEach(
    input =>
      (input.onchange = () => {
        inputSelection(state.fbsSelected, input.dataset.fbsRow, input.checked);
        renderFbsActions();
      })
  );
  $$('[data-fbs-sort]').forEach(
    header =>
      (header.onclick = () => {
        const key = header.dataset.fbsSort;
        state.fbsSort = state.fbsSort.key === key ? { key, dir: state.fbsSort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' };
        state.fbsPage = 1;
        renderFbsOrders();
      })
  );
  $('#fbsSelectAll').onchange = () => {
    pageRows.forEach(row => inputSelection(state.fbsSelected, String(row.id), $('#fbsSelectAll').checked));
    renderFbsOrders();
  };
  $$('#fbsOrdersBody [data-supply-open]').forEach(button => (button.onclick = () => openSupplyDetail(button.dataset.supplyOpen)));
  renderFbsActions();
}
function renderFbsActions() {
  const count = state.fbsSelected.size;
  $('#fbsActions').classList.toggle('hidden', !count);
  $('#fbsSelectedCount').textContent = `Выбрано: ${fmtNum(count)}`;
}
function renderSupplies() {
  const rows = state.supplies?.rows || [],
    totals = state.supplies?.totals || {};
  $('#supplyCount').textContent = rows.length
    ? `${fmtNum(totals.open)} ${pluralRu(totals.open, ['открытая', 'открытые', 'открытых'])} из ${fmtNum(totals.supplies)}`
    : 'Поставок нет';
  $('#emptySupplies').classList.toggle('hidden', rows.length > 0);
  $('#suppliesBody').innerHTML = rows
    .map(
      row =>
        `<tr><td><button class="copy-article" data-copy="${escapeHtml(row.id)}">${escapeHtml(row.id)}</button></td><td><strong>${escapeHtml(row.name)}</strong></td><td><strong>${formatDate(row.createdAt)}</strong>${row.closedAt ? `<small>закрыта ${formatDate(row.closedAt)}</small>` : ''}</td><td><span class="status ${row.done ? 'status-complete' : 'status-new'}">${row.done ? 'Передана в доставку' : 'Открыта'}</span></td><td>${escapeHtml(row.cargoTypeName)}</td><td class="supply-row-actions"><button class="secondary" data-supply-detail="${escapeHtml(row.id)}">Состав</button><button class="secondary" data-supply-qr="${escapeHtml(row.id)}">QR</button><button class="danger" data-supply-remove="${escapeHtml(row.id)}" ${row.done ? 'disabled' : ''}>Удалить</button></td></tr>`
    )
    .join('');
  $$('[data-supply-detail]').forEach(button => (button.onclick = () => openSupplyDetail(button.dataset.supplyDetail)));
  $$('[data-supply-qr]').forEach(button => (button.onclick = () => downloadSupplyBarcode(button.dataset.supplyQr)));
  $$('[data-supply-remove]').forEach(button => (button.onclick = () => removeSupply(button.dataset.supplyRemove)));
}
async function openSupplyDetail(supplyId) {
  if (!supplyId) return;
  const btn = $('#refresh');
  btn.classList.add('loading');
  try {
    const q = new URLSearchParams({ cabinet: state.cabinet, id: supplyId });
    state.supplyDetail = await api('/api/supplies/detail?' + q);
    state.supplyOrderSelected = new Set();
    renderSupplyDetail();
    (state.supplyDetail.warnings || []).forEach(warning => toast(warning));
    $('#supplyDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    toast(e.message);
  } finally {
    btn.classList.remove('loading');
  }
}
function trbxOfOrder(orderId) {
  return (state.supplyDetail?.trbxes || []).find(trbx => trbx.orderIds.includes(Number(orderId)))?.id || '';
}
function renderSupplyDetail() {
  const detail = state.supplyDetail;
  const panel = $('#supplyDetailPanel');
  if (!detail?.supply) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const supply = detail.supply,
    orders = detail.orders || [],
    trbxes = detail.trbxes || [];
  $('#supplyDetailTitle').textContent = `Поставка ${supply.id}`;
  $('#supplyDetailMeta').innerHTML =
    `${escapeHtml(supply.name)} · создана ${formatDate(supply.createdAt)} · <span class="status ${supply.done ? 'status-complete' : 'status-new'}">${supply.done ? 'передана в доставку' : 'открыта'}</span>`;
  $('#deliverSupplyButton').disabled = supply.done || !orders.length;
  $('#addTrbxButton').disabled = supply.done;
  $('#supplyStickersButton').disabled = !orders.length;
  $('#supplyOrderCount').textContent = `${fmtNum(orders.length)} шт.`;
  $('#trbxCount').textContent = `${fmtNum(trbxes.length)} шт.`;
  $('#supplyOrdersBody').innerHTML =
    orders
      .map(row => {
        const trbxId = trbxOfOrder(row.id);
        return `<tr><td class="check-col"><input type="checkbox" data-supply-order="${escapeHtml(row.id)}" ${state.supplyOrderSelected.has(String(row.id)) ? 'checked' : ''} aria-label="Выбрать задание ${escapeHtml(row.id)}"></td><td><strong>${escapeHtml(row.name)}</strong><small>${row.detailsMissing ? 'данные задания WB уже не отдаёт' : `${escapeHtml(row.size)} · ${fmtMoney(row.price, row.currencyCode)}`}</small></td><td><button class="copy-article" data-copy="${escapeHtml(row.vendorCode || '')}">${escapeHtml(row.vendorCode || '—')}</button></td><td>${trbxId ? `<strong>${escapeHtml(trbxId)}</strong>` : '<small>не разложено</small>'}</td><td><small>${escapeHtml(row.id)}</small></td></tr>`;
      })
      .join('') || '<tr><td colspan="5"><small>В поставке пока нет заданий.</small></td></tr>';
  $('#supplyOrderSelectAll').checked = orders.length > 0 && orders.every(row => state.supplyOrderSelected.has(String(row.id)));
  $('#trbxList').innerHTML =
    trbxes
      .map(
        trbx =>
          `<article class="trbx-card"><header><strong>${escapeHtml(trbx.id)}</strong><span>${fmtNum(trbx.orderIds.length)} ${pluralRu(trbx.orderIds.length, ['задание', 'задания', 'заданий'])}</span></header><div class="trbx-actions"><button class="secondary" data-trbx-fill="${escapeHtml(trbx.id)}" ${supply.done ? 'disabled' : ''}>Положить выбранные</button><button class="secondary" data-trbx-qr="${escapeHtml(trbx.id)}">QR</button><button class="danger" data-trbx-remove="${escapeHtml(trbx.id)}" ${supply.done ? 'disabled' : ''}>Удалить</button></div></article>`
      )
      .join('') || '<p class="trbx-empty">Грузомест нет. Добавьте их, чтобы получить QR-коды коробов.</p>';
  $$('[data-supply-order]').forEach(
    input => (input.onchange = () => inputSelection(state.supplyOrderSelected, input.dataset.supplyOrder, input.checked))
  );
  $('#supplyOrderSelectAll').onchange = () => {
    orders.forEach(row => inputSelection(state.supplyOrderSelected, String(row.id), $('#supplyOrderSelectAll').checked));
    renderSupplyDetail();
  };
  $$('[data-trbx-fill]').forEach(button => (button.onclick = () => fillTrbx(button.dataset.trbxFill)));
  $$('[data-trbx-qr]').forEach(button => (button.onclick = () => downloadTrbxStickers([button.dataset.trbxQr])));
  $$('[data-trbx-remove]').forEach(button => (button.onclick = () => removeTrbx(button.dataset.trbxRemove)));
}
function stickerMime(type) {
  return type === 'svg' ? 'image/svg+xml' : type === 'png' ? 'image/png' : 'text/plain';
}
function stickerExt(type) {
  return type === 'svg' ? 'svg' : type === 'png' ? 'png' : 'zpl';
}
function downloadBase64(file, name, mime) {
  const a = document.createElement('a');
  a.href = `data:${mime};base64,${file}`;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}
function openStickerPrint(title, items, type) {
  const win = window.open('', '_blank');
  if (!win) return toast('Браузер заблокировал окно печати — разрешите всплывающие окна');
  const cards = items
    .map(
      item =>
        `<figure><img src="data:${stickerMime(type)};base64,${item.file}" alt="${escapeHtml(item.name)}"><figcaption>${escapeHtml(item.name)}</figcaption></figure>`
    )
    .join('');
  win.document.write(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box}body{margin:0;padding:14px;font:12px/1.45 system-ui,Arial,sans-serif;background:#f5f6f3;color:#1b1b1f}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}h1{font-size:15px;margin:0}button{font:inherit;padding:8px 16px;border:0;border-radius:9px;background:#7651e5;color:#fff;cursor:pointer}.sheet{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;width:58mm;background:#fff;border:1px solid #d9d9e3;border-radius:5px;padding:2mm;break-inside:avoid}figure img{display:block;width:100%;height:40mm;object-fit:contain}figcaption{margin-top:1mm;font-size:9px;text-align:center;color:#5b5b6b}@page{size:58mm 40mm;margin:0}@media print{body{padding:0;background:#fff}header{display:none}.sheet{display:block;gap:0}figure{width:58mm;height:40mm;padding:0;border:0;border-radius:0;break-after:page}figcaption{display:none}}</style></head><body><header><h1>${escapeHtml(title)} · ${items.length} шт.</h1><button onclick="window.print()">Печать</button></header><div class="sheet">${cards}</div></body></html>`
  );
  win.document.close();
}
function offerStickers(title, items, type) {
  if (!items.length) return toast('WB не вернул файлы для печати');
  const printable = type === 'png' || type === 'svg';
  openModal(
    `<p class="eyebrow">${escapeHtml(title)}</p><h2>Готово: ${items.length} шт.</h2><p>${printable ? 'Страница печати рассчитана на 58×40 мм — по одному стикеру на лист. Либо сохраните файлы по отдельности.' : 'Формат ZPL открывается только на термопринтере — сохраните файлы.'}</p><div class="modal-actions">${printable ? '<button class="primary" id="printStickers">Открыть для печати</button>' : ''}<button id="saveStickers">Скачать файлами</button></div>`
  );
  if (printable)
    $('#printStickers').onclick = () => {
      openStickerPrint(title, items, type);
      closeModal();
    };
  $('#saveStickers').onclick = () => {
    items.forEach(item => downloadBase64(item.file, `${item.name}.${stickerExt(type)}`, stickerMime(type)));
    closeModal();
    toast(`Файлов скачано: ${items.length}`);
  };
}
async function downloadOrderStickers() {
  if (!state.fbsSelected.size) return toast('Выберите сборочные задания');
  try {
    const data = await api('/api/orders/stickers', {
      method: 'POST',
      body: JSON.stringify({ cabinet: state.cabinet, orders: [...state.fbsSelected].map(Number), type: 'png' })
    });
    offerStickers(
      'Стикеры товаров',
      (data.stickers || []).filter(item => item.file).map(item => ({ file: item.file, name: `sticker-${item.orderId}` })),
      data.type || 'png'
    );
  } catch (e) {
    toast(e.message);
  }
}
async function downloadSupplyBarcode(supplyId) {
  const id = supplyId || state.supplyDetail?.supply?.id;
  if (!id) return toast('Выберите поставку');
  try {
    const q = new URLSearchParams({ cabinet: state.cabinet, id, type: 'png' });
    const data = await api('/api/supplies/barcode?' + q);
    if (!data.file) return toast('WB не вернул QR-код поставки');
    offerStickers(`QR-код поставки ${id}`, [{ file: data.file, name: `supply-${data.barcode || id}` }], data.type || 'png');
  } catch (e) {
    toast(e.message);
  }
}
async function downloadTrbxStickers(trbxIds) {
  const detail = state.supplyDetail;
  if (!detail?.supply) return toast('Откройте состав поставки');
  const ids = (trbxIds && trbxIds.length ? trbxIds : (detail.trbxes || []).map(trbx => trbx.id)).filter(Boolean);
  if (!ids.length) return toast('В поставке нет грузомест');
  try {
    const data = await api('/api/supplies/trbx/stickers', {
      method: 'POST',
      body: JSON.stringify({ cabinet: state.cabinet, supplyId: detail.supply.id, trbxIds: ids, type: 'png' })
    });
    offerStickers(
      'QR-коды грузомест',
      (data.stickers || []).filter(item => item.file).map(item => ({ file: item.file, name: `trbx-${item.trbxId}` })),
      data.type || 'png'
    );
  } catch (e) {
    toast(e.message);
  }
}
function openAssembleModal() {
  if (state.demo) return toast('В демо-режиме сборка заданий отключена');
  if (!state.fbsSelected.size) return toast('Выберите сборочные задания');
  const open = (state.supplies?.rows || []).filter(row => !row.done);
  openModal(
    `<p class="eyebrow">Сборка заданий</p><h2>Собрать в поставку</h2><p>Будет добавлено заданий: ${state.fbsSelected.size}. В WB они перейдут в статус «на сборке».</p><label class="stock-modal-label">Поставка<select id="assembleSupply"><option value="">➕ Создать новую поставку</option>${open.map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.id)} · ${escapeHtml(row.name)}</option>`).join('')}</select></label><label class="stock-modal-label" id="assembleNameLabel">Название новой поставки<input id="assembleName" maxlength="128" value="Поставка ${new Date().toLocaleDateString('ru-RU')}"></label><button class="primary" id="confirmAssemble">Собрать</button>`
  );
  const sync = () => $('#assembleNameLabel').classList.toggle('hidden', Boolean($('#assembleSupply').value));
  $('#assembleSupply').onchange = sync;
  sync();
  $('#confirmAssemble').onclick = runAssemble;
}
async function runAssemble() {
  const supplyId = $('#assembleSupply').value,
    name = $('#assembleName')?.value.trim() || '';
  if (!supplyId && !name) return toast('Введите название новой поставки');
  try {
    const data = await api('/api/supplies/orders', {
      method: 'POST',
      body: JSON.stringify({ cabinet: state.cabinet, supplyId, name, orders: [...state.fbsSelected].map(Number), confirm: true })
    });
    closeModal();
    toast(`Собрано заданий: ${data.added}${data.failed?.length ? ` · с ошибкой: ${data.failed.length}` : ''}`);
    (data.failed || []).slice(0, 3).forEach(item => toast(`Задание ${item.orderId}: ${item.message}`));
    state.fbsSelected.clear();
    await loadFbsOrders(true);
    await openSupplyDetail(data.supplyId);
  } catch (e) {
    toast(e.message);
  }
}
function openCreateSupply() {
  if (state.demo) return toast('В демо-режиме создание поставок отключено');
  openModal(
    `<p class="eyebrow">Поставки FBS</p><h2>Новая поставка</h2><p>Пустая поставка появится в списке — в неё можно собирать задания.</p><label class="stock-modal-label">Название<input id="supplyNameInput" maxlength="128" value="Поставка ${new Date().toLocaleDateString('ru-RU')}"></label><button class="primary" id="confirmCreateSupply">Создать</button>`
  );
  $('#confirmCreateSupply').onclick = async () => {
    try {
      const data = await api('/api/supplies', {
        method: 'POST',
        body: JSON.stringify({ cabinet: state.cabinet, name: $('#supplyNameInput').value.trim(), confirm: true })
      });
      closeModal();
      toast(`Поставка создана: ${data.id}`);
      await loadFbsOrders(true);
    } catch (e) {
      toast(e.message);
    }
  };
}
async function removeSupply(supplyId) {
  if (state.demo) return toast('В демо-режиме удаление поставок отключено');
  if (!confirm(`Удалить поставку ${supplyId}? Удалить можно только пустую и незакрытую поставку.`)) return;
  try {
    await api('/api/supplies/delete', { method: 'POST', body: JSON.stringify({ cabinet: state.cabinet, supplyId, confirm: true }) });
    if (state.supplyDetail?.supply?.id === supplyId) {
      state.supplyDetail = null;
      renderSupplyDetail();
    }
    toast('Поставка удалена');
    await loadFbsOrders(true);
  } catch (e) {
    toast(e.message);
  }
}
async function deliverSupply() {
  const supply = state.supplyDetail?.supply;
  if (!supply) return;
  if (state.demo) return toast('В демо-режиме передача поставки отключена');
  if (!confirm(`Передать поставку ${supply.id} в доставку? После этого её состав изменить нельзя.`)) return;
  try {
    await api('/api/supplies/deliver', {
      method: 'POST',
      body: JSON.stringify({ cabinet: state.cabinet, supplyId: supply.id, confirm: true })
    });
    toast('Поставка передана в доставку');
    await loadFbsOrders(true);
    await openSupplyDetail(supply.id);
  } catch (e) {
    toast(e.message);
  }
}
function openAddTrbx() {
  const detail = state.supplyDetail;
  if (!detail?.supply) return toast('Откройте состав поставки');
  if (state.demo) return toast('В демо-режиме грузоместа не создаются');
  openModal(
    `<p class="eyebrow">Поставка ${escapeHtml(detail.supply.id)}</p><h2>Добавить грузоместа</h2><p>WB создаст указанное количество коробов и выдаст для каждого QR-код.</p><label class="stock-modal-label">Количество<input id="trbxAmount" type="number" min="1" max="1000" step="1" value="1"></label><button class="primary" id="confirmTrbx">Добавить</button>`
  );
  $('#confirmTrbx').onclick = async () => {
    try {
      const data = await api('/api/supplies/trbx', {
        method: 'POST',
        body: JSON.stringify({ cabinet: state.cabinet, supplyId: detail.supply.id, amount: Number($('#trbxAmount').value), confirm: true })
      });
      closeModal();
      toast(`Добавлено грузомест: ${data.trbxIds.length}`);
      await openSupplyDetail(detail.supply.id);
    } catch (e) {
      toast(e.message);
    }
  };
}
async function fillTrbx(trbxId) {
  const detail = state.supplyDetail;
  if (!detail?.supply) return;
  if (state.demo) return toast('В демо-режиме раскладка по грузоместам отключена');
  if (!state.supplyOrderSelected.size) return toast('Отметьте задания в составе поставки');
  try {
    const data = await api('/api/supplies/trbx/orders', {
      method: 'POST',
      body: JSON.stringify({
        cabinet: state.cabinet,
        supplyId: detail.supply.id,
        trbxId,
        orders: [...state.supplyOrderSelected].map(Number),
        confirm: true
      })
    });
    toast(`В ${trbxId} добавлено заданий: ${data.added}`);
    state.supplyOrderSelected = new Set();
    await openSupplyDetail(detail.supply.id);
  } catch (e) {
    toast(e.message);
  }
}
async function removeTrbx(trbxId) {
  const detail = state.supplyDetail;
  if (!detail?.supply) return;
  if (state.demo) return toast('В демо-режиме удаление грузомест отключено');
  if (!confirm(`Удалить грузоместо ${trbxId}?`)) return;
  try {
    await api('/api/supplies/trbx/delete', {
      method: 'POST',
      body: JSON.stringify({ cabinet: state.cabinet, supplyId: detail.supply.id, trbxIds: [trbxId], confirm: true })
    });
    toast('Грузоместо удалено');
    await openSupplyDetail(detail.supply.id);
  } catch (e) {
    toast(e.message);
  }
}
function bindFbsOrders() {
  $('#fbsSearch').oninput = () => {
    state.fbsPage = 1;
    renderFbsOrders();
  };
  $('#assembleButton').onclick = openAssembleModal;
  $('#fbsStickerButton').onclick = downloadOrderStickers;
  $('#clearFbsSelection').onclick = () => {
    state.fbsSelected.clear();
    renderFbsOrders();
  };
  $('#createSupplyButton').onclick = openCreateSupply;
  $('#addTrbxButton').onclick = openAddTrbx;
  $('#supplyStickersButton').onclick = downloadSupplyOrderStickers;
  $('#supplyBarcodeButton').onclick = () => downloadSupplyBarcode();
  $('#trbxStickersButton').onclick = () => downloadTrbxStickers();
  $('#deliverSupplyButton').onclick = deliverSupply;
  $('#closeSupplyDetail').onclick = () => {
    state.supplyDetail = null;
    renderSupplyDetail();
  };
}

// Стикеры товаров для заданий поставки: отмеченные задания или все, если ничего не отмечено.
async function downloadSupplyOrderStickers() {
  const orders = state.supplyDetail?.orders || [];
  const selected = orders.filter(row => state.supplyOrderSelected.has(String(row.id)));
  const ids = (selected.length ? selected : orders).map(row => Number(row.id)).filter(Number.isInteger);
  if (!ids.length) return toast('В поставке нет заданий');
  try {
    const data = await api('/api/orders/stickers', {
      method: 'POST',
      body: JSON.stringify({ cabinet: state.cabinet, orders: ids, type: 'png' })
    });
    offerStickers(
      selected.length ? 'Стикеры отмеченных товаров' : 'Стикеры товаров поставки',
      (data.stickers || []).filter(item => item.file).map(item => ({ file: item.file, name: `sticker-${item.orderId}` })),
      data.type || 'png'
    );
  } catch (e) {
    toast(e.message);
  }
}
