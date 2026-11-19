// --- «Шаблоны остатков» FBS: наборы товаров со складами и количеством, применение одним нажатием ---

// --- Шаблоны остатков FBS ---
const presetState = { presets: [], draft: null };
function presetCatalog() {
  const unique = new Map();
  for (const row of state.stocks?.rows || []) {
    const key = String(row.chrtId);
    if (!key || unique.has(key)) continue;
    unique.set(key, {
      chrtId: row.chrtId,
      nmId: row.nmId,
      name: row.name,
      vendorCode: row.vendorCode,
      size: row.size,
      sku: row.sku,
      photo: row.photo
    });
  }
  return [...unique.values()];
}
function presetWarehouses() {
  return (state.stocks?.warehouses || []).map(item => ({ id: String(item.id), name: item.name }));
}
function presetWarehouseNames(preset) {
  const known = new Map(presetWarehouses().map(item => [item.id, item.name]));
  return (preset.warehouseIds || []).map(id => known.get(String(id)) || `Склад ${id}`).join(', ') || 'склады не выбраны';
}
function presetPhoto(item) {
  return item.photo ? `<img src="${escapeHtml(item.photo)}" alt="" loading="lazy">` : '<img alt="">';
}
async function openStockPresets() {
  if (!state.stocks) await loadStocks();
  try {
    const data = await api(`/api/stock-presets?cabinet=${encodeURIComponent(state.cabinet)}`);
    presetState.presets = data.presets || [];
  } catch (e) {
    presetState.presets = [];
    toast(e.message);
  }
  renderPresetList();
}
function renderPresetList() {
  const cards = presetState.presets
    .map(preset => {
      const amount = preset.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      return (
        `<div class="preset-card"><div><strong>${escapeHtml(preset.name)}</strong><small>Артикулов: ${fmtNum(preset.items.length)} · всего ${fmtNum(amount)} шт · складов: ${fmtNum((preset.warehouseIds || []).length)}</small></div>` +
        `<div class="preset-card-actions"><button class="primary" data-preset-run="${escapeHtml(preset.id)}">Выполнить</button>` +
        `<button data-preset-edit="${escapeHtml(preset.id)}">Изменить</button>` +
        `<button class="danger" data-preset-delete="${escapeHtml(preset.id)}">Удалить</button></div></div>`
      );
    })
    .join('');
  openModal(
    `<p class="eyebrow">Остатки FBS</p><h2>Шаблоны остатков</h2>` +
      `<p>Шаблон хранит артикулы с нужным количеством. При выполнении эти остатки выставляются на выбранных складах.</p>` +
      `<div class="preset-list">${cards || '<div class="preset-empty">Шаблонов пока нет. Создайте первый и добавьте в него артикулы с количеством.</div>'}</div>` +
      `<div class="preset-actions"><button class="primary" id="presetCreate">Новый шаблон</button></div>`
  );
  $('#presetCreate').onclick = () => openPresetEditor(null);
  $$('[data-preset-run]').forEach(button => (button.onclick = () => openPresetApply(button.dataset.presetRun)));
  $$('[data-preset-edit]').forEach(button => (button.onclick = () => openPresetEditor(button.dataset.presetEdit)));
  $$('[data-preset-delete]').forEach(button => (button.onclick = () => deletePreset(button.dataset.presetDelete)));
}
function openPresetEditor(id) {
  const existing = presetState.presets.find(item => item.id === id);
  presetState.draft = existing
    ? { ...existing, items: existing.items.map(item => ({ ...item })) }
    : { id: '', name: '', warehouseIds: presetWarehouses().map(item => item.id), items: [] };
  const draft = presetState.draft;
  const warehouses = presetWarehouses()
    .map(
      item =>
        `<label><input type="checkbox" data-preset-warehouse="${escapeHtml(item.id)}" ${draft.warehouseIds.includes(item.id) ? 'checked' : ''}> ${escapeHtml(item.name)}</label>`
    )
    .join('');
  openModal(
    `<p class="eyebrow">Остатки FBS</p><h2>${existing ? 'Изменить шаблон' : 'Новый шаблон'}</h2>` +
      `<label class="stock-modal-label">Название<input id="presetName" maxlength="60" placeholder="Например: утренние остатки" value="${escapeHtml(draft.name)}"></label>` +
      `<p class="eyebrow">Склады</p><div class="preset-warehouses">${warehouses || '<small>Склады FBS не найдены</small>'}</div>` +
      `<label class="stock-modal-label preset-search">Добавить артикул<input id="presetSearch" placeholder="Название, артикул WB, артикул продавца или баркод" autocomplete="off"><div id="presetSuggest"></div></label>` +
      `<div class="preset-items" id="presetItems"></div>` +
      `<div class="preset-actions"><button class="primary" id="presetSave">Сохранить шаблон</button>` +
      `${state.stockSelected.size ? `<button id="presetAddSelected">Добавить выбранные (${fmtNum(state.stockSelected.size)})</button>` : ''}` +
      `<button id="presetBack">К списку</button></div>`
  );
  $$('[data-preset-warehouse]').forEach(
    input =>
      (input.onchange = () => {
        const id = input.dataset.presetWarehouse;
        draft.warehouseIds = input.checked ? [...new Set([...draft.warehouseIds, id])] : draft.warehouseIds.filter(item => item !== id);
      })
  );
  $('#presetName').oninput = event => {
    draft.name = event.target.value;
  };
  $('#presetSearch').oninput = event => renderPresetSuggest(event.target.value);
  $('#presetSearch').onblur = () =>
    setTimeout(() => {
      const box = $('#presetSuggest');
      if (box) box.innerHTML = '';
    }, 180);
  $('#presetSave').onclick = savePreset;
  $('#presetBack').onclick = renderPresetList;
  if ($('#presetAddSelected'))
    $('#presetAddSelected').onclick = () => {
      stockSelectedRows().forEach(row =>
        addPresetItem(
          {
            chrtId: row.chrtId,
            nmId: row.nmId,
            name: row.name,
            vendorCode: row.vendorCode,
            size: row.size,
            sku: row.sku,
            photo: row.photo
          },
          row.amount
        )
      );
      renderPresetItems();
    };
  renderPresetItems();
}
function renderPresetSuggest(term) {
  const box = $('#presetSuggest');
  if (!box) return;
  const query = String(term || '')
    .trim()
    .toLowerCase();
  if (query.length < 2) {
    box.innerHTML = '';
    return;
  }
  const chosen = new Set(presetState.draft.items.map(item => String(item.chrtId)));
  const found = presetCatalog()
    .filter(
      item =>
        !chosen.has(String(item.chrtId)) &&
        `${item.name} ${item.nmId} ${item.vendorCode} ${item.sku} ${item.size}`.toLowerCase().includes(query)
    )
    .slice(0, 8);
  box.className = 'preset-suggest';
  box.innerHTML = found.length
    ? found
        .map(
          item =>
            `<button type="button" data-preset-add="${escapeHtml(item.chrtId)}">${presetPhoto(item)}<span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.vendorCode || '—')} · nmId ${escapeHtml(item.nmId || '—')} · размер ${escapeHtml(item.size || '—')}</small></span></button>`
        )
        .join('')
    : '<button type="button" disabled><span><b>Ничего не найдено</b></span></button>';
  box.querySelectorAll('[data-preset-add]').forEach(
    button =>
      (button.onclick = () => {
        const item = presetCatalog().find(row => String(row.chrtId) === button.dataset.presetAdd);
        if (item) addPresetItem(item, 0);
        $('#presetSearch').value = '';
        box.innerHTML = '';
        renderPresetItems();
      })
  );
}
function addPresetItem(item, amount) {
  const draft = presetState.draft;
  if (draft.items.some(row => String(row.chrtId) === String(item.chrtId))) return;
  draft.items.push({
    chrtId: item.chrtId,
    nmId: item.nmId,
    name: item.name,
    vendorCode: item.vendorCode,
    size: item.size,
    sku: item.sku,
    photo: item.photo,
    amount: Number(amount) || 0
  });
}
function renderPresetItems() {
  const box = $('#presetItems');
  if (!box) return;
  const items = presetState.draft.items;
  box.innerHTML = items.length
    ? items
        .map(
          (item, index) =>
            `<div class="preset-item">${presetPhoto(item)}<div><b>${escapeHtml(item.name || 'Товар')}</b><small>${escapeHtml(item.vendorCode || '—')} · nmId ${escapeHtml(item.nmId || '—')} · размер ${escapeHtml(item.size || '—')}</small></div>` +
            `<input type="number" min="0" step="1" value="${Number(item.amount) || 0}" data-preset-amount="${index}" aria-label="Количество"><button type="button" data-preset-remove="${index}" aria-label="Убрать">×</button></div>`
        )
        .join('')
    : '<div class="preset-empty">Добавьте артикулы через поиск выше</div>';
  box.querySelectorAll('[data-preset-amount]').forEach(
    input =>
      (input.oninput = () => {
        presetState.draft.items[Number(input.dataset.presetAmount)].amount = Math.max(0, Math.floor(Number(input.value) || 0));
      })
  );
  box.querySelectorAll('[data-preset-remove]').forEach(
    button =>
      (button.onclick = () => {
        presetState.draft.items.splice(Number(button.dataset.presetRemove), 1);
        renderPresetItems();
      })
  );
}
async function savePreset() {
  const draft = presetState.draft;
  if (!String(draft.name || '').trim()) return toast('Укажите название шаблона');
  if (!draft.warehouseIds.length) return toast('Выберите хотя бы один склад FBS');
  if (!draft.items.length) return toast('Добавьте хотя бы один артикул');
  if (draft.items.some(item => !Number.isInteger(Number(item.amount)) || Number(item.amount) < 0))
    return toast('Количество должно быть целым числом не меньше нуля');
  try {
    const data = await api('/api/stock-presets', { method: 'POST', body: JSON.stringify({ cabinet: state.cabinet, preset: draft }) });
    presetState.presets = data.presets || [];
    toast('Шаблон сохранён');
    renderPresetList();
  } catch (e) {
    toast(e.message);
  }
}
async function deletePreset(id) {
  const preset = presetState.presets.find(item => item.id === id);
  if (!preset || !confirm(`Удалить шаблон «${preset.name}»?`)) return;
  try {
    const data = await api(`/api/stock-presets?cabinet=${encodeURIComponent(state.cabinet)}&id=${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    presetState.presets = data.presets || [];
    toast('Шаблон удалён');
    renderPresetList();
  } catch (e) {
    toast(e.message);
  }
}
function openPresetApply(id) {
  const preset = presetState.presets.find(item => item.id === id);
  if (!preset) return;
  const known = new Set(presetWarehouses().map(item => item.id));
  const warehouses = (preset.warehouseIds || []).filter(item => known.has(String(item)));
  const missing = (preset.warehouseIds || []).length - warehouses.length;
  const rows = preset.items
    .map(
      item =>
        `<div class="preset-item">${presetPhoto(item)}<div><b>${escapeHtml(item.name || 'Товар')}</b><small>${escapeHtml(item.vendorCode || '—')} · размер ${escapeHtml(item.size || '—')}</small></div><input type="number" value="${Number(item.amount) || 0}" disabled></div>`
    )
    .join('');
  openModal(
    `<p class="eyebrow">Выполнение шаблона</p><h2>${escapeHtml(preset.name)}</h2>` +
      `<p>Остатки будут заменены на указанные значения. Складов: ${fmtNum(warehouses.length)} · позиций к обновлению: ${fmtNum(warehouses.length * preset.items.length)}.` +
      `${missing ? ` <b>Складов из шаблона больше нет: ${fmtNum(missing)}.</b>` : ''}</p>` +
      `<p><b>Склады:</b> ${escapeHtml(presetWarehouseNames({ warehouseIds: warehouses }))}</p>` +
      `<div class="preset-items">${rows}</div>` +
      `<div class="preset-actions"><button class="primary" id="presetRun">Выполнить</button><button id="presetCancel">Отмена</button></div>`
  );
  $('#presetCancel').onclick = renderPresetList;
  $('#presetRun').onclick = () => runPreset(preset, warehouses);
}
async function runPreset(preset, warehouses) {
  if (state.demo) return toast('В демо-режиме изменение остатков отключено');
  if (!warehouses.length) return toast('У шаблона нет действующих складов FBS');
  const items = warehouses.flatMap(warehouseId =>
    preset.items.map(item => ({ warehouseId, chrtId: item.chrtId, amount: Number(item.amount) || 0 }))
  );
  const button = $('#presetRun');
  if (button) {
    button.disabled = true;
    button.textContent = 'Выполняем…';
  }
  try {
    const cabinet = state.cabinet,
      result = await api('/api/fbs-stocks/update', { method: 'POST', body: JSON.stringify({ cabinet, items, confirm: true }) });
    closeModal();
    toast(`Шаблон «${preset.name}» выполнен: позиций ${fmtNum(items.length)}`);
    applyStockChanges(result, cabinet);
  } catch (e) {
    toast(e.message);
    if (button) {
      button.disabled = false;
      button.textContent = 'Выполнить';
    }
  }
}
