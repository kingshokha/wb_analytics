// --- Карточка товара (card.html): открывается из «Карточек товаров», данные можно изменить и отправить в WB ---
// Данные — /api/card (сервер: content-cards.js): свежая карточка из WB, характеристики её предмета, справочники
// (цвет, пол, страна, сезон, НДС), ярлыки продавца, карточки той же группы и ошибки сохранения.
// Основные данные (наименование, бренд, артикул, описание, характеристики, габариты, размеры и баркоды, документы,
// маркировка) копятся в черновике и уходят одним запросом «Сохранить в WB»: метод WB перезаписывает карточку целиком,
// поэтому отправляется вся карточка; сервер сверяет, что её не изменили в WB после открытия страницы. WB проверяет
// изменения уже после ответа — через несколько секунд страница перечитывает карточку и ошибки сохранения.
// Фото, ярлыки, объединение и корзина — отдельные действия WB, у каждого своё подтверждение.
// Ограничения WB: нельзя удалять размеры и баркоды; у карточки с видео нельзя менять порядок и состав фото по ссылкам.
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)];
  const params = new URLSearchParams(location.search), cabinet = params.get('cabinet') || 'demo', nmId = Number(params.get('nmId'));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const fmtRub = value => `${Math.round(value).toLocaleString('ru-RU')} ₽`;
  const fmtDate = iso => iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '—';
  const setNotices = (...args) => window.setNotices?.(...args);
  // Значения характеристик со справочниками WB — подсказки при вводе.
  const DIRECTORY_OF = { 'Цвет': 'colors', 'Пол': 'kinds', 'Страна производства': 'countries', 'Сезон': 'seasons', 'Ставка НДС': 'vat' };
  const DOC_TYPES = [[1, 'Сертификат соответствия'], [2, 'Декларация о соответствии'], [3, 'Свидетельство о гос. регистрации (СГР)'], [4, 'РУ на медицинские изделия'], [5, 'РУ Республики Беларусь'], [7, 'Регистрация пестицида'], [8, 'Регистрация агрохимиката'], [9, 'РУ на лекарственные препараты']];
  const view = { data: null, original: null, draft: null, media: null, mediaOriginal: null, tags: null, tagsOriginal: null, showAll: false, busy: false, focus: null };

  async function api(url, options = {}) {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    let data = {}; try { data = await response.json(); } catch { /* пустой ответ */ }
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  }
  function status(text, error = false) { const line = $('#statusLine'); line.textContent = text; line.classList.toggle('error', error); }
  const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify({ cabinet, confirm: true, ...body }) });

  // --- Загрузка ---
  async function load(message) {
    if (!Number.isInteger(nmId) || nmId <= 0) { $('#content').innerHTML = '<div class="loading">В ссылке нет артикула WB. Откройте карточку из раздела «Карточки товаров».</div>'; status('Нет артикула', true); return; }
    status('Загружаем карточку из WB…');
    try {
      const data = await api(`/api/card?${new URLSearchParams({ cabinet, nmId })}`);
      view.data = data; view.original = editable(data.card); view.draft = clone(view.original);
      view.mediaOriginal = (data.card.photos || []).map(photo => ({ preview: photo.c246x328 || photo.c516x688 || photo.tm || photo.big || '', url: photo.hq || photo.big || photo.c516x688 || '' }));
      view.media = clone(view.mediaOriginal);
      view.tagsOriginal = (data.card.tags || []).map(tag => tag.id).sort((a, b) => a - b); view.tags = [...view.tagsOriginal];
      setNotices('card', 'load', data.warnings || []);
      render();
      status(message || `Загружено из WB ${fmtDate(data.fetchedAt)}${data.demo ? ' · демо-данные' : ''}`);
    } catch (error) {
      $('#content').innerHTML = `<div class="loading">Не удалось загрузить карточку: ${esc(error.message)}</div>`;
      status(error.message, true);
    }
  }
  // Редактируемая часть карточки — то, что уходит в «Редактирование карточек товаров».
  function editable(card) {
    const day = iso => iso ? String(iso).slice(0, 10) : '';
    return {
      title: card.title || '', brand: card.brand || '', vendorCode: card.vendorCode || '', description: card.description || '', kizMarked: Boolean(card.kizMarked), gtin: card.gtin || '',
      dimensions: { length: card.dimensions?.length ?? '', width: card.dimensions?.width ?? '', height: card.dimensions?.height ?? '', weightBrutto: card.dimensions?.weightBrutto ?? '' },
      chars: Object.fromEntries((card.characteristics || []).map(item => [item.id, item.value])),
      sizes: (card.sizes || []).map(size => ({ chrtID: size.chrtID, techSize: size.techSize || '', wbSize: size.wbSize || '', skus: [...(size.skus || [])] })),
      documents: { excludeDocuments: Boolean(card.documents?.excludeDocuments), items: (card.documents?.items || []).map(item => ({ id: item.id, type: item.type, number: item.number || '', productNumber: item.productNumber || '', tradeName: item.tradeName || '', applicant: item.applicant || '', startDate: day(item.startDate), endDate: day(item.endDate), isEndless: Boolean(item.isEndless) })) }
    };
  }
  const charcList = () => (view.data?.charcs || []).filter(charc => charc.charcType !== 0 && !charc.existNamedField);
  const charcName = id => charcList().find(charc => charc.charcID === Number(id))?.name || (view.data.card.characteristics || []).find(item => item.id === Number(id))?.name || `Характеристика ${id}`;
  const valueText = value => value == null || (Array.isArray(value) && !value.length) || value === '' ? '—' : Array.isArray(value) ? value.join(', ') : String(value);
  const short = (value, max = 60) => { const text = String(value ?? ''); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

  // --- Отличия черновика от карточки из WB: список для окна подтверждения и счётчик в нижней панели ---
  function changes() {
    const o = view.original, d = view.draft, list = [];
    const text = (label, a, b) => { if (String(a ?? '') !== String(b ?? '')) list.push(`${label}: «${esc(short(a) || '—')}» → «${esc(short(b) || '—')}»`); };
    text('Наименование', o.title, d.title); text('Бренд', o.brand, d.brand); text('Артикул продавца', o.vendorCode, d.vendorCode); text('Дополнительный GTIN', o.gtin, d.gtin);
    if (o.description !== d.description) list.push(`Описание: ${o.description.length} → ${d.description.length} символов`);
    if (o.kizMarked !== d.kizMarked) list.push(`Маркировка Честного знака: ${d.kizMarked ? 'подтверждена' : 'подтверждение снято'}`);
    for (const [key, label] of [['length', 'Длина, см'], ['width', 'Ширина, см'], ['height', 'Высота, см'], ['weightBrutto', 'Вес, кг']]) text(label, o.dimensions[key], d.dimensions[key]);
    for (const id of new Set([...Object.keys(o.chars), ...Object.keys(d.chars)])) {
      if (JSON.stringify(o.chars[id] ?? null) !== JSON.stringify(normalizeValue(d.chars[id]) ?? null)) list.push(`${esc(charcName(id))}: ${esc(short(valueText(o.chars[id]), 80))} → ${esc(short(valueText(d.chars[id]), 80))}`);
    }
    d.sizes.forEach(size => {
      const old = size.chrtID ? o.sizes.find(item => item.chrtID === size.chrtID) : null, label = size.techSize && size.techSize !== '0' ? `Размер ${esc(size.techSize)}` : 'Товар без размера';
      if (!old) { list.push(`Новый размер ${esc(size.techSize || '—')}${size.wbSize ? ` (${esc(size.wbSize)})` : ''}: цена ${size.price ? fmtRub(size.price) : '—'}, баркод ${esc(size.skus.join(', ') || '—')}`); return; }
      if (old.techSize !== size.techSize) list.push(`${label}: размер «${esc(old.techSize)}» → «${esc(size.techSize)}»`);
      if (old.wbSize !== size.wbSize) list.push(`${label}: российский размер «${esc(old.wbSize || '—')}» → «${esc(size.wbSize || '—')}»`);
      const added = size.skus.filter(sku => !old.skus.includes(sku)); if (added.length) list.push(`${label}: новые баркоды ${esc(added.join(', '))}`);
    });
    if (o.documents.excludeDocuments !== d.documents.excludeDocuments) list.push(d.documents.excludeDocuments ? 'Документы: подтверждаю, что документы не требуются (все документы будут удалены)' : 'Документы: снято подтверждение «документы не требуются»');
    const docName = item => `${(DOC_TYPES.find(([type]) => type === Number(item.type)) || [0, 'Документ'])[1]} ${esc(item.number || '')}`.trim();
    for (const item of d.documents.items) {
      const old = item.id ? o.documents.items.find(doc => doc.id === item.id) : null;
      if (!old) list.push(`Новый документ: ${docName(item)}`); else if (JSON.stringify(old) !== JSON.stringify(item)) list.push(`Изменён документ: ${docName(item)}`);
    }
    for (const old of o.documents.items) if (!d.documents.items.some(item => item.id === old.id)) list.push(`Удалён документ: ${docName(old)}`);
    return list;
  }
  // Значение характеристики к отправке: пустые строки убираются, пустой список и пустое число — «нет значения».
  function normalizeValue(value) {
    if (Array.isArray(value)) { const list = value.map(item => String(item).trim()).filter(Boolean); return list.length ? list : undefined; }
    if (value === '' || value == null) return undefined;
    return value;
  }
  function payload() {
    const d = view.draft, card = view.data.card;
    const ids = [...new Set([...(card.characteristics || []).map(item => String(item.id)), ...Object.keys(d.chars)])];
    return {
      nmID: card.nmID, vendorCode: d.vendorCode.trim(), kizMarked: d.kizMarked, brand: d.brand.trim(), title: d.title.trim(), description: d.description, gtin: d.gtin || undefined,
      dimensions: { length: d.dimensions.length, width: d.dimensions.width, height: d.dimensions.height, weightBrutto: d.dimensions.weightBrutto },
      characteristics: ids.map(id => ({ id: Number(id), value: normalizeValue(d.chars[id]) })).filter(item => item.value !== undefined),
      sizes: d.sizes.map(size => size.chrtID ? { chrtID: size.chrtID, techSize: size.techSize, wbSize: size.wbSize, skus: size.skus } : { techSize: size.techSize, wbSize: size.wbSize, price: Number(size.price), skus: size.skus }),
      documents: { excludeDocuments: d.documents.excludeDocuments, items: d.documents.items.map(item => ({ ...item, startDate: item.startDate || undefined, endDate: item.isEndless ? undefined : item.endDate || undefined })) }
    };
  }
  // Проверки до отправки — те же правила, что у WB; иначе запрос уйдёт и вернётся с ошибкой.
  function problems() {
    const d = view.draft, list = [];
    if (!d.title.trim()) list.push('Наименование не может быть пустым'); if (d.title.length > 60) list.push('Наименование — не больше 60 символов');
    if (!d.vendorCode.trim()) list.push('Артикул продавца не может быть пустым');
    if (d.description.length > 5000) list.push('Описание — не больше 5000 символов');
    for (const charc of charcList()) {
      const value = normalizeValue(d.chars[charc.charcID]);
      // WB не сохраняет карточку, пока пуста хоть одна обязательная характеристика — даже если её не трогали.
      if (charc.required && value === undefined) list.push(`Заполните обязательную характеристику «${charc.name}»`);
      if (charc.charcType === 1 && charc.maxCount > 0 && Array.isArray(value) && value.length > charc.maxCount) list.push(`«${charc.name}»: не больше ${charc.maxCount} значений`);
    }
    d.sizes.filter(size => !size.chrtID).forEach(size => { if (!size.skus.length) list.push(`Новый размер ${size.techSize || ''}: нужен баркод`); if (!(Number(size.price) > 0) || !Number.isInteger(Number(size.price))) list.push(`Новый размер ${size.techSize || ''}: укажите цену целым числом`); });
    d.documents.items.forEach(item => { if (!item.type) list.push('У документа не выбран тип'); if (!String(item.number).trim()) list.push('У документа не указан номер'); });
    return list;
  }

  // --- Отрисовка ---
  function render() {
    const data = view.data, card = data.card, photo = card.photos?.[0];
    document.title = `${card.title || card.vendorCode} — карточка — WB Pulse`;
    $('#cardTitle').textContent = card.title || 'Без названия';
    if (photo) $('#cardPhoto').src = photo.c246x328 || photo.tm || photo.big;
    $('#cardMeta').innerHTML = [`Артикул продавца <b>${esc(card.vendorCode)}</b>`, `Артикул WB <button type="button" class="copy" data-copy="${card.nmID}" title="Скопировать">${card.nmID}</button>`,
      esc(card.subjectName || ''), card.brand ? esc(card.brand) : '', `изменена ${fmtDate(card.updatedAt)}`,
      `<a href="https://www.wildberries.ru/catalog/${card.nmID}/detail.aspx" target="_blank" rel="noopener noreferrer">на WB ↗</a>`,
      `<a href="/product.html?${new URLSearchParams({ cabinet, nmId: card.nmID })}" target="_blank" rel="noopener noreferrer">детализация товара ↗</a>`,
      `<a href="/?page=cards">все карточки</a>`].filter(Boolean).join(' · ');
    renderBanners();
    const dirs = Object.entries(data.dictionaries || {}).map(([name, values]) => `<datalist id="dl-${name}">${values.map(value => `<option value="${esc(value)}">`).join('')}</datalist>`).join('');
    $('#content').innerHTML = `${dirs}<div class="layout"><div class="col">${data.trashed ? '' : panelMain() + panelCharcs() + panelDims() + panelSizes() + panelDocs()}</div><div class="col">${panelMedia()}${data.trashed ? '' : panelTags() + panelGroup()}${panelTrash()}</div></div>`;
    if (view.focus) { const field = $(view.focus); if (field) { field.focus(); view.focus = null; } }
    updateSavebar();
  }
  function renderBanners() {
    const data = view.data, card = data.card, list = [];
    if (data.trashed) list.push(`<div class="banner"><b>Карточка в корзине.</b> Она продаётся, пока есть остатки; без остатков WB удалит её через 30 дней. Чтобы менять данные, восстановите её.<br><button type="button" class="btn small" data-action="recover">Восстановить из корзины</button></div>`);
    if (data.errors?.length) list.push(`<div class="banner error"><b>WB не принял последние изменения этой карточки</b> (${fmtDate(data.errors[0].updatedAt)}):<ul>${data.errors.flatMap(item => item.errors).map(text => `<li>${esc(text)}</li>`).join('')}</ul>Исправьте и сохраните ещё раз — ошибка уйдёт из списка.</div>`);
    if (card.dimensions?.isValid === false) list.push('<div class="banner"><b>Габариты под вопросом:</b> WB считает, что они сильно отличаются от средних по предмету или не заполнены. Проверьте, что размеры упаковки указаны в сантиметрах, а вес — в килограммах.</div>');
    if (card.needKiz && !card.kizMarked) list.push('<div class="banner"><b>Нужна маркировка Честного знака.</b> Карточка не пройдёт проверку, пока вы не подтвердите, что код маркировки нанесён на товар (галочка в «Основном»).</div>');
    $('#banners').innerHTML = list.join('');
  }
  const changedClass = (a, b) => JSON.stringify(a) !== JSON.stringify(b) ? ' changed' : '';
  function panelMain() {
    const o = view.original, d = view.draft, card = view.data.card;
    return `<section class="panel"><div class="panel-head"><h2>Основное</h2></div><div class="panel-body">
      <label class="field${changedClass(o.title, d.title)}"><span>Наименование <small class="counter${d.title.length > 60 ? ' over' : ''}" data-counter="title">${d.title.length} / 60</small></span><input data-field="title" maxlength="80" value="${esc(d.title)}"></label>
      <div class="grid-2"><label class="field${changedClass(o.brand, d.brand)}"><span>Бренд</span><input data-field="brand" value="${esc(d.brand)}"></label>
      <label class="field${changedClass(o.vendorCode, d.vendorCode)}"><span>Артикул продавца</span><input data-field="vendorCode" maxlength="72" value="${esc(d.vendorCode)}"></label></div>
      ${o.gtin ? `<label class="field${changedClass(o.gtin, d.gtin)}"><span>Дополнительный GTIN</span><input data-field="gtin" value="${esc(d.gtin)}"></label>` : ''}
      <label class="field${changedClass(o.description, d.description)}"><span>Описание <small class="counter${d.description.length > 5000 ? ' over' : ''}" data-counter="description">${d.description.length} символов · обычно до 2000, в некоторых предметах до 5000</small></span><textarea data-field="description" rows="9">${esc(d.description)}</textarea></label>
      ${card.needKiz || o.kizMarked ? `<label class="check"><input type="checkbox" data-field="kizMarked"${d.kizMarked ? ' checked' : ''}> На товар нанесён обязательный код маркировки Честного знака${card.needKiz ? '' : ' (для этого товара маркировка не обязательна)'}</label>` : ''}
      <p class="hint">Артикул продавца меняйте осторожно: по нему товар ищется в кабинете, отчётах и на этом сайте.</p></div></section>`;
  }
  function charcField(charc) {
    const id = charc.charcID, value = view.draft.chars[id], original = view.original.chars[id], dir = DIRECTORY_OF[charc.name];
    const head = `<span><b>${esc(charc.name)}${charc.required ? ' <i class="req">*</i>' : ''}</b><small>${[charc.unitName, charc.charcType === 1 && charc.maxCount ? `до ${charc.maxCount} знач.` : ''].filter(Boolean).join(' · ')}</small></span>`;
    if (charc.charcType === 4) return `<label class="field charc${changedClass(original ?? null, normalizeValue(value) ?? null)}">${head}<input type="number" step="any" min="0" data-charc-number="${id}" value="${value ?? ''}"></label>`;
    const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [String(value)];
    const full = charc.maxCount > 0 && values.length >= charc.maxCount;
    return `<div class="field charc${changedClass(original ?? null, normalizeValue(value) ?? null)}">${head}<div class="chips" data-chips="${id}">${values.map((item, index) => `<span class="chip"><span title="${esc(item)}">${esc(item)}</span><button type="button" data-chip-remove="${id}" data-index="${index}" aria-label="Убрать «${esc(item)}»">×</button></span>`).join('')}`
      + `<input data-chip-input="${id}" ${dir ? `list="dl-${dir}"` : ''} placeholder="${full ? `максимум ${charc.maxCount}` : 'Добавить — Enter'}"${full ? ' disabled' : ''} aria-label="${esc(charc.name)}"></div></div>`;
  }
  function panelCharcs() {
    const charcs = charcList(), d = view.draft, card = view.data.card;
    if (!charcs.length) return `<section class="panel"><div class="panel-head"><h2>Характеристики</h2></div><div class="panel-body"><p class="hint">Характеристики предмета не загрузились — изменить их сейчас нельзя.</p></div></section>`;
    const filled = charc => normalizeValue(d.chars[charc.charcID]) !== undefined || view.original.chars[charc.charcID] !== undefined;
    const sorted = charcs.slice().sort((a, b) => (b.required - a.required) || (filled(b) - filled(a)) || ((b.popular || b.hasFilter) - (a.popular || a.hasFilter)) || a.name.localeCompare(b.name, 'ru'));
    const shown = sorted.filter(charc => view.showAll || charc.required || filled(charc)), hidden = sorted.length - shown.length;
    // Характеристики карточки, которых у предмета больше нет: WB их хранит, сайт отправляет их обратно без изменений.
    const known = new Set(charcs.map(charc => charc.charcID)), named = new Set((view.data.charcs || []).filter(charc => charc.existNamedField || charc.charcType === 0).map(charc => charc.charcID));
    const legacy = (card.characteristics || []).filter(item => !known.has(item.id) && !named.has(item.id));
    return `<section class="panel"><div class="panel-head"><h2>Характеристики</h2><p class="hint">${esc(card.subjectName)} · <span class="req">*</span> — обязательные</p></div><div class="panel-body">
      <div class="charcs">${shown.map(charcField).join('')}</div>
      ${hidden || view.showAll ? `<button type="button" class="more-toggle" data-action="toggle-charcs">${view.showAll ? 'Скрыть незаполненные' : `Показать незаполненные (${hidden})`}</button>` : ''}
      ${legacy.length ? `<p class="legacy">Есть в карточке, но больше нет у предмета (отправятся без изменений): ${legacy.map(item => `<b>${esc(item.name)}</b>: ${esc(valueText(item.value))}`).join('; ')}</p>` : ''}</div></section>`;
  }
  function panelDims() {
    const o = view.original.dimensions, d = view.draft.dimensions;
    const input = (key, label, step) => `<label class="field${changedClass(String(o[key]), String(d[key]))}"><span>${label}</span><input type="number" min="0" step="${step}" data-dim="${key}" value="${esc(d[key])}"></label>`;
    return `<section class="panel"><div class="panel-head"><h2>Габариты и вес с упаковкой</h2></div><div class="panel-body"><div class="grid-4">${input('length', 'Длина, см', 1)}${input('width', 'Ширина, см', 1)}${input('height', 'Высота, см', 1)}${input('weightBrutto', 'Вес, кг', 0.001)}</div>
      <p class="hint">Только сантиметры (целые) и килограммы (до трёх знаков после запятой). От габаритов зависят логистика и хранение; WB обновляет их до 30 минут.</p></div></section>`;
  }
  function panelSizes() {
    const d = view.draft;
    const rows = d.sizes.map((size, index) => {
      const old = size.chrtID ? view.original.sizes.find(item => item.chrtID === size.chrtID) : null;
      const chips = size.skus.map((sku, skuIndex) => old?.skus.includes(sku) ? `<span class="chip locked" title="Баркод из WB — удалить через API нельзя"><span>${esc(sku)}</span></span>` : `<span class="chip"><span>${esc(sku)}</span><button type="button" data-sku-remove="${index}" data-index="${skuIndex}" aria-label="Убрать баркод">×</button></span>`).join('');
      return `<tr class="${old ? '' : 'new'}"><td><input class="inline-input" data-size="${index}" data-key="techSize" value="${esc(size.techSize)}" placeholder="S, 42, 0" aria-label="Размер"></td><td><input class="inline-input" data-size="${index}" data-key="wbSize" value="${esc(size.wbSize)}" placeholder="—" aria-label="Российский размер"></td>`
        + `<td><div class="chips">${chips}<input data-sku-input="${index}" placeholder="Новый баркод — Enter" aria-label="Добавить баркод"></div><button type="button" class="more-toggle" data-sku-generate="${index}">Сгенерировать баркод WB</button></td>`
        + `<td>${old ? '<span class="hint">из WB</span>' : `<input class="inline-input" type="number" min="1" step="1" data-size="${index}" data-key="price" value="${esc(size.price ?? '')}" placeholder="Цена, ₽" aria-label="Цена"><button type="button" class="more-toggle" data-size-remove="${index}">Убрать</button>`}</td></tr>`;
    }).join('');
    return `<section class="panel"><div class="panel-head"><h2>Размеры и баркоды</h2></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>Размер</th><th>Российский</th><th>Баркоды</th><th>Цена</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="sizes-actions"><button type="button" class="btn small" data-action="add-size">+ Размер</button></div>
      <p class="hint">WB не даёт удалять размеры и баркоды через API — только добавлять. У нового размера нужна цена (₽) и баркод; цены существующих размеров меняются в разделе «Цены и скидки».</p></div></section>`;
  }
  function panelDocs() {
    const d = view.draft.documents, card = view.data.card, overall = card.documents?.overallVerdict;
    const verdict = item => { const v = (card.documents?.items || []).find(doc => doc.id === item.id)?.verdict; return !item.id ? '<span class="badge pending">новый</span>' : !v ? '<span class="badge pending">на проверке</span>' : v.status === 1 ? '<span class="badge ok">проверка пройдена</span>' : `<span class="badge fail">не пройдена${v.reason ? `: ${esc(v.reason)}` : ''}</span>`; };
    const docs = d.items.map((item, index) => `<div class="doc"><div class="doc-head"><select class="inline-input" style="max-width:320px" data-doc="${index}" data-key="type" aria-label="Тип документа"><option value="">Тип документа</option>${DOC_TYPES.map(([type, label]) => `<option value="${type}"${Number(item.type) === type ? ' selected' : ''}>${label}</option>`).join('')}</select>${verdict(item)}<button type="button" class="more-toggle" data-doc-remove="${index}">Удалить</button></div>
      <div class="grid-2"><label class="field"><span>Номер</span><input data-doc="${index}" data-key="number" value="${esc(item.number)}"></label><label class="field"><span>Доп. номер</span><input data-doc="${index}" data-key="productNumber" value="${esc(item.productNumber)}"></label>
      <label class="field"><span>Торговое наименование</span><input data-doc="${index}" data-key="tradeName" value="${esc(item.tradeName)}"></label><label class="field"><span>Представитель изготовителя</span><input data-doc="${index}" data-key="applicant" value="${esc(item.applicant)}"></label>
      <label class="field"><span>Действует с</span><input type="date" data-doc="${index}" data-key="startDate" value="${esc(item.startDate)}"></label><label class="field"><span>Действует по</span><input type="date" data-doc="${index}" data-key="endDate" value="${esc(item.endDate)}"${item.isEndless ? ' disabled' : ''}></label></div>
      <label class="check"><input type="checkbox" data-doc="${index}" data-key="isEndless"${item.isEndless ? ' checked' : ''}> Бессрочный документ</label></div>`).join('');
    const reason = { documents_missing: 'нет нужных документов', valid: '' }[overall?.reason] ?? overall?.reason ?? '';
    return `<section class="panel"><div class="panel-head"><h2>Разрешительные документы</h2>${overall ? `<span class="badge ${overall.status === 1 ? 'ok' : 'fail'}">карточка: ${overall.status === 1 ? 'проверка пройдена' : `проверка не пройдена${reason ? ` — ${esc(reason)}` : ''}`}</span>` : card.documents?.items?.length ? '<span class="badge pending">карточка на проверке</span>' : ''}</div><div class="panel-body">
      ${overall?.status === 2 && overall.reason === 'documents_missing' ? '<p class="banner" style="margin-bottom:10px">WB считает, что для этого товара нужны разрешительные документы (сертификат, декларация и т. п.). Добавьте документ ниже или, если документы для товара по закону не требуются, отметьте это галочкой внизу.</p>' : ''}
      ${docs || '<p class="hint" style="margin-bottom:10px">Документов нет.</p>'}
      <div class="sizes-actions"><button type="button" class="btn small" data-action="add-doc"${d.excludeDocuments ? ' disabled' : ''}>+ Документ</button></div>
      <label class="check"><input type="checkbox" data-field="excludeDocuments"${d.excludeDocuments ? ' checked' : ''}> Для товара документы не требуются (все документы будут удалены из карточки)</label>
      <p class="hint">После изменения документа WB проверяет карточку заново — до 3 дней. Продажи на это время не останавливаются, если карточка уже продавалась.</p></div></section>`;
  }
  function panelMedia() {
    const card = view.data.card, hasVideo = Boolean(card.video), changed = JSON.stringify(view.media) !== JSON.stringify(view.mediaOriginal);
    const items = view.media.map((item, index) => `<div class="media-item${item.isNew ? ' new' : ''}">${item.preview ? `<img src="${esc(item.preview)}" alt="" loading="lazy">` : ''}<span class="num">${index + 1}</span>${hasVideo || view.data.trashed ? '' : `<div class="tools"><button type="button" data-media-move="${index}" data-dir="-1" title="Левее"${index ? '' : ' disabled'}>‹</button><button type="button" class="del" data-media-remove="${index}" title="Убрать">×</button><button type="button" data-media-move="${index}" data-dir="1" title="Правее"${index < view.media.length - 1 ? '' : ' disabled'}>›</button></div>`}</div>`).join('');
    return `<section class="panel"><div class="panel-head"><h2>Фото и видео</h2><span class="hint">${view.media.length} фото${hasVideo ? ' · есть видео' : ''} · максимум 30</span></div><div class="panel-body">
      <div class="media">${items || '<p class="hint">Фото нет.</p>'}</div>
      ${view.data.trashed ? '' : `${hasVideo ? '<p class="hint" style="margin-top:8px">У карточки есть видео: WB заменяет медиа только целиком, а видео он отдаёт в формате, который нельзя загрузить обратно. Поэтому менять порядок и удалять фото здесь нельзя — только добавлять файлом. Порядок меняйте в личном кабинете WB.</p>' : `<div class="media-add"><input type="url" id="mediaUrl" placeholder="Ссылка на фото: https://…/photo.jpg"><button type="button" class="btn small" data-action="media-url">Добавить ссылку</button></div>`}
      <div class="media-add"><label class="btn small" style="display:inline-flex;align-items:center">Загрузить файл с компьютера<input type="file" id="mediaFile" accept="image/jpeg,image/png,image/bmp,image/gif,image/webp,video/mp4,video/quicktime" hidden></label>${changed ? '<button type="button" class="btn small" data-action="media-reset">Вернуть как было</button><button type="button" class="btn small primary" data-action="media-save">Сохранить фото в WB</button>' : ''}</div>
      <p class="hint" style="margin-top:8px">Фото: от 700×900 px, до 32 Мб, JPG, PNG, BMP, GIF, WebP. Видео: одно, до 50 Мб, MP4 или MOV. Файл сразу добавляется в карточку в конец, после подтверждения.</p>`}</div></section>`;
  }
  function panelTags() {
    const tags = view.data.tags || [], changed = JSON.stringify([...view.tags].sort((a, b) => a - b)) !== JSON.stringify(view.tagsOriginal);
    return `<section class="panel"><div class="panel-head"><h2>Ярлыки</h2><a class="hint" href="/?page=cards">создать или переименовать — в «Карточках товаров»</a></div><div class="panel-body">
      ${tags.length ? `<div class="tags">${tags.map(tag => `<button type="button" class="tag-toggle" style="--tag:#${esc(tag.color)}" data-tag="${tag.id}" aria-pressed="${view.tags.includes(tag.id)}"><i></i>${esc(tag.name)}</button>`).join('')}</div>` : '<p class="hint">У вас пока нет ярлыков.</p>'}
      ${changed ? '<div class="sizes-actions"><button type="button" class="btn small" data-action="tags-reset">Вернуть как было</button><button type="button" class="btn small primary" data-action="tags-save">Сохранить ярлыки в WB</button></div>' : ''}</div></section>`;
  }
  function panelGroup() {
    const data = view.data, card = data.card, group = data.group || [], same = data.sameSubject || [];
    const imts = [...new Map(same.map(item => [item.imtID, item])).values()];
    return `<section class="panel"><div class="panel-head"><h2>Объединённая карточка</h2><span class="hint">imtID ${card.imtID}</span></div><div class="panel-body">
      ${group.length ? `<p class="hint" style="margin-bottom:8px">Вместе с этой карточкой (покупатель видит их как варианты одного товара):</p><div class="group-list">${group.map(item => `<div class="group-item">${item.photo ? `<img src="${esc(item.photo)}" alt="">` : ''}<a href="/card.html?${new URLSearchParams({ cabinet, nmId: item.nmID })}">${esc(item.vendorCode)}</a><span class="hint">${esc(short(item.title, 40))}</span></div>`).join('')}</div>
      <div class="row-actions"><button type="button" class="btn small" data-action="unmerge">Отсоединить эту карточку</button></div>` : '<p class="hint" style="margin-bottom:8px">Карточка не объединена с другими.</p>'}
      ${imts.length ? `<div class="row-actions" style="margin-top:10px"><select id="mergeTarget" aria-label="С какой карточкой объединить"><option value="">Присоединить к карточке того же предмета…</option>${imts.map(item => `<option value="${item.imtID}">${esc(item.vendorCode)} — ${esc(short(item.title, 40))}</option>`).join('')}</select><button type="button" class="btn small" data-action="merge">Присоединить</button></div>` : ''}
      <p class="hint" style="margin-top:8px">Объединять можно только карточки одного предмета, до 30 в группе.</p></div></section>`;
  }
  function panelTrash() {
    if (view.data.trashed) return '';
    return `<section class="panel"><div class="panel-head"><h2>Корзина</h2></div><div class="panel-body"><p class="hint" style="margin-bottom:10px">Карточка в корзине продаётся, пока есть остатки. Без остатков WB удаляет её через 30 дней; до этого её можно восстановить.</p><button type="button" class="btn small danger" data-action="trash">Перенести в корзину</button></div></section>`;
  }
  function updateSavebar() {
    if (!view.draft || view.data?.trashed) { $('#savebar').hidden = true; return; }
    const count = changes().length;
    $('#savebar').hidden = !count;
    $('#saveSummary').textContent = count ? `Несохранённых изменений: ${count}` : '';
  }
  // После ввода в поле — только счётчики и подсветка, без перерисовки (фокус остаётся в поле).
  function markField(input, changed) { input.closest('.field')?.classList.toggle('changed', changed); updateSavebar(); }

  // --- Окно подтверждения ---
  function dialog(html) { $('#dialog').innerHTML = html; $('#overlay').hidden = false; $('#dialog').querySelector('button.primary, button')?.focus(); }
  function closeDialog() { $('#overlay').hidden = true; $('#dialog').innerHTML = ''; }
  function confirmAction(title, text, button, run, danger = false) {
    dialog(`<h2>${title}</h2><p>${text}</p><p class="status-line" id="dialogStatus" style="text-align:left;margin-top:8px"></p><div class="actions"><button type="button" class="btn" data-dialog-close>Отмена</button><button type="button" class="btn primary${danger ? ' danger' : ''}" id="dialogRun">${button}</button></div>`);
    $('#dialogRun').onclick = async () => {
      const runButton = $('#dialogRun'), line = $('#dialogStatus'); runButton.disabled = true; runButton.textContent = 'Отправляем в WB…'; line.classList.remove('error'); line.textContent = '';
      try { await run(); } catch (error) { runButton.disabled = false; runButton.textContent = button; line.textContent = `Не получилось: ${error.message}`; line.classList.add('error'); }
    };
  }
  // «Сохранить в WB»: список изменений → отправка → через несколько секунд перечитываем карточку и ошибки WB.
  function openSave() {
    const list = changes(), issues = problems();
    if (issues.length) { dialog(`<h2>Исправьте перед сохранением</h2><ul>${issues.map(text => `<li>${esc(text)}</li>`).join('')}</ul><div class="actions"><button type="button" class="btn primary" data-dialog-close>Понятно</button></div>`); return; }
    confirmAction('Сохранить карточку в WB?', `<ul>${list.map(text => `<li>${text}</li>`).join('')}</ul>WB перезаписывает карточку целиком — отправится вся карточка с этими изменениями. Проверка и обновление на WB занимают до 30 минут; лимит WB — 10 сохранений в минуту.`, 'Сохранить в WB', async () => {
      const sentAt = Date.now();
      const result = await post('/api/card/update', { updatedAt: view.data.card.updatedAt, card: payload() });
      closeDialog(); status(result.demo ? 'Сохранено (демо-кабинет)' : 'WB принял запрос — проверяем, сохранились ли изменения…');
      view.original = clone(view.draft); updateSavebar();
      setTimeout(() => verifySave(sentAt), result.demo ? 300 : 8000);
    });
  }
  async function verifySave(sentAt) {
    await load();
    const errors = (view.data?.errors || []).filter(item => Date.parse(item.updatedAt) >= sentAt - 60_000);
    if (errors.length) { status('WB отклонил изменения — подробности сверху', true); return; }
    const updated = Date.parse(view.data?.card?.updatedAt || 0) >= sentAt - 60_000;
    status(updated ? `Сохранено в WB ${fmtDate(view.data.card.updatedAt)}. На сайте WB изменения появятся в течение 30 минут` : 'Запрос принят, WB ещё обрабатывает изменения — обновите карточку через минуту');
    $('#banners').insertAdjacentHTML('afterbegin', `<div class="banner ${updated ? 'ok' : 'info'}">${updated ? '<b>Изменения сохранены в WB.</b> На витрине они появятся в течение 30 минут.' : '<b>WB ещё обрабатывает изменения.</b> Нажмите «Обновить» через минуту, чтобы проверить результат.'}</div>`);
  }

  // --- События ---
  document.addEventListener('input', event => {
    const input = event.target, d = view.draft; if (!d) return;
    if (input.dataset.field && input.type !== 'checkbox') {
      d[input.dataset.field] = input.value;
      const counter = $(`[data-counter="${input.dataset.field}"]`);
      if (counter) { const length = input.value.length, limit = input.dataset.field === 'title' ? 60 : 5000; counter.textContent = input.dataset.field === 'title' ? `${length} / 60` : `${length} символов · обычно до 2000, в некоторых предметах до 5000`; counter.classList.toggle('over', length > limit); }
      markField(input, String(view.original[input.dataset.field]) !== input.value); return;
    }
    if (input.dataset.dim) { d.dimensions[input.dataset.dim] = input.value === '' ? '' : Number(input.value); markField(input, String(view.original.dimensions[input.dataset.dim]) !== String(d.dimensions[input.dataset.dim])); return; }
    if (input.dataset.charcNumber) { const id = input.dataset.charcNumber; d.chars[id] = input.value === '' ? undefined : Number(input.value); markField(input, JSON.stringify(view.original.chars[id] ?? null) !== JSON.stringify(normalizeValue(d.chars[id]) ?? null)); return; }
    if (input.dataset.size !== undefined && input.dataset.key) { const size = d.sizes[Number(input.dataset.size)]; size[input.dataset.key] = input.dataset.key === 'price' ? (input.value === '' ? '' : Number(input.value)) : input.value; updateSavebar(); return; }
    if (input.dataset.doc !== undefined && input.dataset.key && input.type !== 'checkbox') { d.documents.items[Number(input.dataset.doc)][input.dataset.key] = input.dataset.key === 'type' ? Number(input.value) || '' : input.value; updateSavebar(); }
  });
  document.addEventListener('change', event => {
    const input = event.target, d = view.draft; if (!d) return;
    if (input.type === 'checkbox' && input.dataset.field === 'kizMarked') { d.kizMarked = input.checked; updateSavebar(); return; }
    if (input.type === 'checkbox' && input.dataset.field === 'excludeDocuments') { d.documents.excludeDocuments = input.checked; render(); return; }
    if (input.type === 'checkbox' && input.dataset.doc !== undefined) { const item = d.documents.items[Number(input.dataset.doc)]; item.isEndless = input.checked; if (input.checked) item.endDate = ''; render(); return; }
    if (input.tagName === 'SELECT' && input.dataset.doc !== undefined) { d.documents.items[Number(input.dataset.doc)].type = Number(input.value) || ''; updateSavebar(); return; }
    if (input.id === 'mediaFile' && input.files?.[0]) uploadFile(input.files[0]);
  });
  // Значение характеристики или баркод добавляется по Enter (запятая — часть значения: «хлопок 50%, акрил 50%»).
  document.addEventListener('keydown', event => {
    const input = event.target;
    if (event.key === 'Escape' && !$('#overlay').hidden) { closeDialog(); return; }
    if (event.key !== 'Enter') return;
    if (input.dataset.chipInput) { event.preventDefault(); addChip(input.dataset.chipInput, input.value); return; }
    if (input.dataset.skuInput !== undefined) { event.preventDefault(); addSku(Number(input.dataset.skuInput), input.value); }
  });
  // Ушли из поля, не нажав Enter, — введённое значение всё равно добавляется (перерисовывается только это поле,
  // чтобы клик по соседней кнопке не потерялся).
  document.addEventListener('focusout', event => {
    const input = event.target;
    if (input.dataset?.chipInput && input.value.trim()) addChip(input.dataset.chipInput, input.value, false);
  });
  function refreshCharc(id, keepFocus) {
    const charc = charcList().find(item => item.charcID === Number(id)), field = $(`[data-chips="${id}"]`)?.closest('.field');
    if (!charc || !field) return render();
    field.outerHTML = charcField(charc);
    if (keepFocus) $(`[data-chip-input="${id}"]`)?.focus();
    updateSavebar();
  }
  function addChip(id, raw, keepFocus = true) {
    const value = String(raw || '').trim(); if (!value) return;
    const charc = charcList().find(item => item.charcID === Number(id)), current = normalizeValue(view.draft.chars[id]) || [];
    const list = Array.isArray(current) ? current : [String(current)];
    if (charc?.maxCount > 0 && list.length >= charc.maxCount) { status(`«${charc.name}»: не больше ${charc.maxCount} значений`, true); return; }
    if (!list.includes(value)) view.draft.chars[id] = [...list, value];
    refreshCharc(id, keepFocus);
  }
  function addSku(index, raw) {
    const value = String(raw || '').trim().replace(/\s+/g, ''); if (!value) return;
    if (view.draft.sizes.some(size => size.skus.includes(value))) { status(`Баркод ${value} уже есть в карточке`, true); return; }
    view.draft.sizes[index].skus.push(value); view.focus = `[data-sku-input="${index}"]`; render();
  }
  async function uploadFile(file) {
    const card = view.data.card, isVideo = file.type.startsWith('video/');
    const number = isVideo ? 1 : (card.photos || []).length + 1;
    if (!isVideo && number > 30) { status('В карточке уже 30 фото — это максимум', true); return; }
    confirmAction(isVideo ? 'Загрузить видео?' : 'Добавить фото?', `${esc(file.name)} (${(file.size / 1024 / 1024).toFixed(1)} Мб) ${isVideo ? (card.video ? 'заменит текущее видео карточки' : 'станет видео карточки') : `добавится в карточку фото №${number}`}. Файл сразу уйдёт в WB.`, 'Загрузить', async () => {
      const response = await fetch(`/api/card/media/file?${new URLSearchParams({ cabinet, nmId: card.nmID, number, confirm: '1' })}`, { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      let data = {}; try { data = await response.json(); } catch { /* пустой ответ */ }
      if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
      closeDialog(); status('Файл загружен в WB. Обработка фото занимает до нескольких минут');
      setTimeout(() => load('Файл загружен в WB — карточка перечитана'), data.demo ? 200 : 6000);
    });
  }

  document.addEventListener('click', event => {
    const target = event.target;
    if (target.closest('[data-dialog-close]') || target === $('#overlay')) { closeDialog(); return; }
    const copy = target.closest('[data-copy]');
    if (copy) { navigator.clipboard?.writeText(copy.dataset.copy).then(() => status(`Скопировано: ${copy.dataset.copy}`)).catch(() => {}); return; }
    if (target.closest('#reloadButton')) { if (changes().length && !window.confirm('Несохранённые изменения пропадут. Загрузить карточку заново?')) return; load(); return; }
    if (target.closest('#discardButton')) { view.draft = clone(view.original); render(); return; }
    if (target.closest('#saveButton')) { openSave(); return; }
    const d = view.draft;
    const chipRemove = target.closest('[data-chip-remove]');
    if (chipRemove) { const id = chipRemove.dataset.chipRemove, list = [...(normalizeValue(d.chars[id]) || [])]; list.splice(Number(chipRemove.dataset.index), 1); d.chars[id] = list; refreshCharc(id, false); return; }
    const skuRemove = target.closest('[data-sku-remove]');
    if (skuRemove) { d.sizes[Number(skuRemove.dataset.skuRemove)].skus.splice(Number(skuRemove.dataset.index), 1); render(); return; }
    const skuGenerate = target.closest('[data-sku-generate]');
    if (skuGenerate) { skuGenerate.disabled = true; api('/api/cards/barcodes', { method: 'POST', body: JSON.stringify({ cabinet, count: 1 }) }).then(result => addSku(Number(skuGenerate.dataset.skuGenerate), result.barcodes?.[0])).catch(error => { skuGenerate.disabled = false; status(`Баркод не сгенерирован: ${error.message}`, true); }); return; }
    const sizeRemove = target.closest('[data-size-remove]');
    if (sizeRemove) { d.sizes.splice(Number(sizeRemove.dataset.sizeRemove), 1); render(); return; }
    const docRemove = target.closest('[data-doc-remove]');
    if (docRemove) { d.documents.items.splice(Number(docRemove.dataset.docRemove), 1); render(); return; }
    const mediaMove = target.closest('[data-media-move]');
    if (mediaMove) { const index = Number(mediaMove.dataset.mediaMove), next = index + Number(mediaMove.dataset.dir); [view.media[index], view.media[next]] = [view.media[next], view.media[index]]; render(); return; }
    const mediaRemove = target.closest('[data-media-remove]');
    if (mediaRemove) { view.media.splice(Number(mediaRemove.dataset.mediaRemove), 1); render(); return; }
    const tag = target.closest('[data-tag]');
    if (tag) { const id = Number(tag.dataset.tag); view.tags = view.tags.includes(id) ? view.tags.filter(item => item !== id) : [...view.tags, id]; render(); return; }
    const action = target.closest('[data-action]')?.dataset.action; if (!action) return;
    const card = view.data?.card;
    if (action === 'toggle-charcs') { view.showAll = !view.showAll; render(); }
    if (action === 'add-size') { d.sizes.push({ techSize: '', wbSize: '', price: '', skus: [] }); render(); }
    if (action === 'add-doc') { d.documents.items.push({ type: '', number: '', productNumber: '', tradeName: '', applicant: '', startDate: '', endDate: '', isEndless: false }); render(); }
    if (action === 'media-url') {
      const field = $('#mediaUrl'), url = field.value.trim();
      if (!/^https?:\/\/\S+\.(jpe?g|png|bmp|gif|webp)(\?\S*)?$/i.test(url)) { status('Нужна прямая ссылка на файл фото: …/photo.jpg (JPG, PNG, BMP, GIF, WebP)', true); return; }
      if (view.media.length >= 30) { status('Максимум 30 фото', true); return; }
      view.media.push({ preview: url, url, isNew: true }); render();
    }
    if (action === 'media-reset') { view.media = clone(view.mediaOriginal); render(); }
    if (action === 'media-save') confirmAction('Сохранить фото в WB?', `В карточке будет ${view.media.length} фото в показанном порядке. WB заменяет набор фото целиком: убранные фото удалятся. Если хотя бы одна ссылка не подойдёт (размер меньше 700×900, формат), WB не загрузит ни одного фото.`, 'Сохранить фото', async () => {
      const result = await post('/api/card/media', { nmId: card.nmID, urls: view.media.map(item => item.url) });
      closeDialog(); status('Фото отправлены в WB — обработка занимает до нескольких минут'); setTimeout(() => load('Фото отправлены в WB — карточка перечитана'), result.demo ? 200 : 6000);
    });
    if (action === 'tags-reset') { view.tags = [...view.tagsOriginal]; render(); }
    if (action === 'tags-save') confirmAction('Сохранить ярлыки?', `На карточке будут ярлыки: ${esc((view.data.tags || []).filter(item => view.tags.includes(item.id)).map(item => item.name).join(', ') || 'без ярлыков')}.`, 'Сохранить', async () => {
      await post('/api/card/tags', { nmId: card.nmID, tagIds: view.tags }); closeDialog(); load('Ярлыки сохранены в WB');
    });
    if (action === 'unmerge') confirmAction('Отсоединить карточку?', `Карточка ${esc(card.vendorCode)} станет отдельным товаром со своим imtID. Остальные карточки группы останутся вместе.`, 'Отсоединить', async () => {
      await post('/api/cards/move', { nmIds: [card.nmID] }); closeDialog(); load('Карточка отсоединена');
    });
    if (action === 'merge') {
      const select = $('#mergeTarget'), targetIMT = Number(select?.value), option = select?.selectedOptions?.[0];
      if (!targetIMT) { status('Выберите карточку, к которой присоединить', true); return; }
      confirmAction('Присоединить карточку?', `Карточка ${esc(card.vendorCode)} станет вариантом товара «${esc(option.textContent)}» (imtID ${targetIMT}).`, 'Присоединить', async () => {
        await post('/api/cards/move', { nmIds: [card.nmID], targetIMT }); closeDialog(); load('Карточка присоединена');
      });
    }
    if (action === 'trash') confirmAction('Перенести в корзину?', `Карточка ${esc(card.vendorCode)} уйдёт в корзину WB и получит новый imtID (отделится от группы). Она продаётся, пока есть остатки; чтобы снять с продажи, обнулите остатки. Без остатков WB удалит её через 30 дней.`, 'В корзину', async () => {
      await post('/api/cards/trash', { nmIds: [card.nmID] }); closeDialog(); load('Карточка перенесена в корзину');
    }, true);
    if (action === 'recover') confirmAction('Восстановить карточку?', `Карточка ${esc(card.vendorCode)} вернётся из корзины. Метод WB — не чаще 3 раз в минуту.`, 'Восстановить', async () => {
      await post('/api/cards/recover', { nmIds: [card.nmID] }); closeDialog(); load('Карточка восстановлена');
    });
  });
  window.addEventListener('beforeunload', event => { if (view.draft && changes().length) { event.preventDefault(); event.returnValue = ''; } });
  load();
})();
