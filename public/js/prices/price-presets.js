// --- «Шаблоны цен»: наборы товаров с ценой и скидкой, применение одним нажатием ---

// --- Шаблоны цен и скидок ---
const pricePresetState = { presets: [], draft: null };
function pricePresetCatalog() {
  return (state.prices?.rows || []).map(row => ({
    nmId: row.nmId,
    name: row.name,
    vendorCode: row.vendorCode,
    photo: row.photo,
    price: row.price,
    discount: row.discount
  }));
}
async function openPricePresets() {
  if (!state.prices) await loadPrices();
  try {
    const data = await api(`/api/price-presets?cabinet=${encodeURIComponent(state.cabinet)}`);
    pricePresetState.presets = data.presets || [];
  } catch (e) {
    pricePresetState.presets = [];
    toast(e.message);
  }
  renderPricePresetList();
}
function renderPricePresetList() {
  const cards = pricePresetState.presets
    .map(preset => {
      const prices = preset.items.map(item => Number(item.price) || 0);
      const min = prices.length ? Math.min(...prices) : 0,
        max = prices.length ? Math.max(...prices) : 0;
      const range = min === max ? fmtRub(min) : `${fmtRub(min)} — ${fmtRub(max)}`;
      return (
        `<div class="preset-card"><div><strong>${escapeHtml(preset.name)}</strong><small>Товаров: ${fmtNum(preset.items.length)} · цены ${escapeHtml(range)}</small></div>` +
        `<div class="preset-card-actions"><button class="primary" data-price-preset-run="${escapeHtml(preset.id)}">Выполнить</button>` +
        `<button data-price-preset-edit="${escapeHtml(preset.id)}">Изменить</button>` +
        `<button class="danger" data-price-preset-delete="${escapeHtml(preset.id)}">Удалить</button></div></div>`
      );
    })
    .join('');
  openModal(
    `<p class="eyebrow">Цены и скидки</p><h2>Шаблоны цен</h2>` +
      `<p>Шаблон хранит товары с ценой и скидкой продавца. При выполнении эти значения отправляются в Wildberries.</p>` +
      `<div class="preset-list">${cards || '<div class="preset-empty">Шаблонов пока нет. Создайте первый и добавьте в него товары с ценой и скидкой.</div>'}</div>` +
      `<div class="preset-actions"><button class="primary" id="pricePresetCreate">Новый шаблон</button></div>`
  );
  $('#pricePresetCreate').onclick = () => openPricePresetEditor(null);
  $$('[data-price-preset-run]').forEach(button => (button.onclick = () => openPricePresetApply(button.dataset.pricePresetRun)));
  $$('[data-price-preset-edit]').forEach(button => (button.onclick = () => openPricePresetEditor(button.dataset.pricePresetEdit)));
  $$('[data-price-preset-delete]').forEach(button => (button.onclick = () => deletePricePreset(button.dataset.pricePresetDelete)));
}
function openPricePresetEditor(id) {
  const existing = pricePresetState.presets.find(item => item.id === id);
  pricePresetState.draft = existing ? { ...existing, items: existing.items.map(item => ({ ...item })) } : { id: '', name: '', items: [] };
  const draft = pricePresetState.draft;
  openModal(
    `<p class="eyebrow">Цены и скидки</p><h2>${existing ? 'Изменить шаблон' : 'Новый шаблон'}</h2>` +
      `<label class="stock-modal-label">Название<input id="pricePresetName" maxlength="60" placeholder="Например: цены на распродажу" value="${escapeHtml(draft.name)}"></label>` +
      `<label class="stock-modal-label preset-search">Добавить товар<input id="pricePresetSearch" placeholder="Название, артикул WB или артикул продавца" autocomplete="off"><div id="pricePresetSuggest"></div></label>` +
      `<div class="preset-items" id="pricePresetItems"></div>` +
      `<div class="preset-actions"><button class="primary" id="pricePresetSave">Сохранить шаблон</button>` +
      `${state.priceSelected.size ? `<button id="pricePresetAddSelected">Добавить выбранные (${fmtNum(state.priceSelected.size)})</button>` : ''}` +
      `<button id="pricePresetBack">К списку</button></div>`
  );
  $('#pricePresetName').oninput = event => {
    draft.name = event.target.value;
  };
  $('#pricePresetSearch').oninput = event => renderPricePresetSuggest(event.target.value);
  $('#pricePresetSearch').onblur = () =>
    setTimeout(() => {
      const box = $('#pricePresetSuggest');
      if (box) box.innerHTML = '';
    }, 180);
  $('#pricePresetSave').onclick = savePricePreset;
  $('#pricePresetBack').onclick = renderPricePresetList;
  if ($('#pricePresetAddSelected'))
    $('#pricePresetAddSelected').onclick = () => {
      (state.prices?.rows || []).filter(row => state.priceSelected.has(String(row.nmId))).forEach(row => addPricePresetItem(row));
      renderPricePresetItems();
    };
  renderPricePresetItems();
}
function renderPricePresetSuggest(term) {
  const box = $('#pricePresetSuggest');
  if (!box) return;
  const query = String(term || '')
    .trim()
    .toLowerCase();
  if (query.length < 2) {
    box.innerHTML = '';
    return;
  }
  const chosen = new Set(pricePresetState.draft.items.map(item => String(item.nmId)));
  const found = pricePresetCatalog()
    .filter(item => !chosen.has(String(item.nmId)) && `${item.name} ${item.nmId} ${item.vendorCode}`.toLowerCase().includes(query))
    .slice(0, 8);
  box.className = 'preset-suggest';
  box.innerHTML = found.length
    ? found
        .map(
          item =>
            `<button type="button" data-price-preset-add="${escapeHtml(item.nmId)}">${presetPhoto(item)}<span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.vendorCode || '—')} · nmId ${escapeHtml(item.nmId)} · сейчас ${escapeHtml(fmtRub(item.price))} · скидка ${escapeHtml(item.discount)}%</small></span></button>`
        )
        .join('')
    : '<button type="button" disabled><span><b>Ничего не найдено</b></span></button>';
  box.querySelectorAll('[data-price-preset-add]').forEach(
    button =>
      (button.onclick = () => {
        const item = pricePresetCatalog().find(row => String(row.nmId) === button.dataset.pricePresetAdd);
        if (item) addPricePresetItem(item);
        $('#pricePresetSearch').value = '';
        box.innerHTML = '';
        renderPricePresetItems();
      })
  );
}
function addPricePresetItem(row) {
  const draft = pricePresetState.draft;
  if (draft.items.some(item => String(item.nmId) === String(row.nmId))) return;
  draft.items.push({
    nmId: row.nmId,
    name: row.name,
    vendorCode: row.vendorCode,
    photo: row.photo,
    price: Math.round(Number(row.price) || 0) || 1,
    discount: Math.round(Number(row.discount) || 0)
  });
}
function renderPricePresetItems() {
  const box = $('#pricePresetItems');
  if (!box) return;
  const items = pricePresetState.draft.items;
  box.innerHTML = items.length
    ? items
        .map(
          (item, index) =>
            `<div class="preset-item">${presetPhoto(item)}<div><b>${escapeHtml(item.name || 'Товар')}</b><small>${escapeHtml(item.vendorCode || '—')} · nmId ${escapeHtml(item.nmId)} · со скидкой ${escapeHtml(fmtRub(Math.round((Number(item.price) * (100 - Number(item.discount))) / 100)))}</small></div>` +
            `<input type="number" min="1" step="1" value="${Number(item.price) || 0}" data-price-preset-price="${index}" aria-label="Цена, ₽">` +
            `<input type="number" min="0" max="99" step="1" value="${Number(item.discount) || 0}" data-price-preset-discount="${index}" aria-label="Скидка, %">` +
            `<button type="button" data-price-preset-remove="${index}" aria-label="Убрать">×</button></div>`
        )
        .join('')
    : '<div class="preset-empty">Добавьте товары через поиск выше</div>';
  box.querySelectorAll('[data-price-preset-price]').forEach(
    input =>
      (input.onchange = () => {
        pricePresetState.draft.items[Number(input.dataset.pricePresetPrice)].price = Math.max(1, Math.round(Number(input.value) || 0));
        renderPricePresetItems();
      })
  );
  box.querySelectorAll('[data-price-preset-discount]').forEach(
    input =>
      (input.onchange = () => {
        pricePresetState.draft.items[Number(input.dataset.pricePresetDiscount)].discount = Math.min(
          99,
          Math.max(0, Math.round(Number(input.value) || 0))
        );
        renderPricePresetItems();
      })
  );
  box.querySelectorAll('[data-price-preset-remove]').forEach(
    button =>
      (button.onclick = () => {
        pricePresetState.draft.items.splice(Number(button.dataset.pricePresetRemove), 1);
        renderPricePresetItems();
      })
  );
}
async function savePricePreset() {
  const draft = pricePresetState.draft;
  if (!String(draft.name || '').trim()) return toast('Укажите название шаблона');
  if (!draft.items.length) return toast('Добавьте хотя бы один товар');
  if (draft.items.some(item => !(Number(item.price) > 0))) return toast('Цена должна быть больше нуля');
  if (draft.items.some(item => !Number.isInteger(Number(item.discount)) || Number(item.discount) < 0 || Number(item.discount) > 99))
    return toast('Скидка должна быть целым числом от 0 до 99');
  try {
    const data = await api('/api/price-presets', { method: 'POST', body: JSON.stringify({ cabinet: state.cabinet, preset: draft }) });
    pricePresetState.presets = data.presets || [];
    toast('Шаблон сохранён');
    renderPricePresetList();
  } catch (e) {
    toast(e.message);
  }
}
async function deletePricePreset(id) {
  const preset = pricePresetState.presets.find(item => item.id === id);
  if (!preset || !confirm(`Удалить шаблон «${preset.name}»?`)) return;
  try {
    const data = await api(`/api/price-presets?cabinet=${encodeURIComponent(state.cabinet)}&id=${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    pricePresetState.presets = data.presets || [];
    toast('Шаблон удалён');
    renderPricePresetList();
  } catch (e) {
    toast(e.message);
  }
}
function openPricePresetApply(id) {
  const preset = pricePresetState.presets.find(item => item.id === id);
  if (!preset) return;
  const byNmId = new Map((state.prices?.rows || []).map(row => [String(row.nmId), row]));
  const ready = preset.items.filter(item => byNmId.has(String(item.nmId)));
  const missing = preset.items.length - ready.length;
  const rows = preset.items
    .map(item => {
      const known = byNmId.get(String(item.nmId)),
        discounted = Math.round((Number(item.price) * (100 - Number(item.discount))) / 100);
      return (
        `<div class="preset-item">${presetPhoto(item)}<div><b>${escapeHtml(item.name || 'Товар')}</b><small>${known ? `сейчас ${escapeHtml(fmtRub(known.price))} · скидка ${escapeHtml(known.discount)}% · со скидкой ${escapeHtml(fmtRub(known.discountedPrice))} → <strong>${escapeHtml(fmtRub(discounted))}</strong>` : 'нет в текущем списке цен'}</small></div>` +
        `<input type="number" value="${Number(item.price) || 0}" disabled><input type="number" value="${Number(item.discount) || 0}" disabled></div>`
      );
    })
    .join('');
  openModal(
    `<p class="eyebrow">Выполнение шаблона</p><h2>${escapeHtml(preset.name)}</h2>` +
      `<p>Будет отправлено товаров: ${fmtNum(ready.length)}. Для поразмерных карточек цена изменится у каждого размера.` +
      `${missing ? ` <b>Пропущено товаров, которых нет в списке цен: ${fmtNum(missing)}.</b>` : ''}</p>` +
      `<div class="preset-items">${rows}</div>` +
      `<div class="preset-actions"><button class="primary" id="pricePresetRun">Выполнить</button><button id="pricePresetCancel">Отмена</button></div>`
  );
  $('#pricePresetCancel').onclick = renderPricePresetList;
  $('#pricePresetRun').onclick = () => runPricePreset(preset, ready);
}
async function runPricePreset(preset, ready) {
  if (state.demo) return toast('В демо-режиме изменение цен отключено');
  if (!ready.length) return toast('Ни один товар шаблона не найден в текущем списке цен');
  const byNmId = new Map((state.prices?.rows || []).map(row => [String(row.nmId), row]));
  const items = ready.map(item => {
    const row = byNmId.get(String(item.nmId));
    return {
      nmId: item.nmId,
      price: Number(item.price),
      discount: Number(item.discount),
      editableSizePrice: row.editableSizePrice,
      sizeItems: row.sizeItems
    };
  });
  const button = $('#pricePresetRun');
  if (button) {
    button.disabled = true;
    button.textContent = 'Выполняем…';
  }
  try {
    await api('/api/prices/update', { method: 'POST', body: JSON.stringify({ cabinet: state.cabinet, items, confirm: true }) });
    closeModal();
    toast(`Шаблон «${preset.name}» отправлен в WB: товаров ${fmtNum(items.length)}`);
    await loadPrices(true);
  } catch (e) {
    toast(e.message);
    if (button) {
      button.disabled = false;
      button.textContent = 'Выполнить';
    }
  }
}
