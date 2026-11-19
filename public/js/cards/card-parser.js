// Подключается после js/cards/cards.js.

// --- «Парсер WB»: новые карточки по ссылкам на чужие товары витрины WB ---
// Сервер (POST /api/cards/parse, разбор — server/cards/wb-donor.js) читает открытую карточку товара на витрине: наименование, предмет,
// описание, характеристики (по справочнику предмета), габариты, размеры, фото и видео. Продавец задаёт артикул, цену,
// бренд, ТН ВЭД и НДС, и сервер создаёт карточки так же, как копии в «Дублировать» (POST /api/cards/parse/create;
// ход — то же окно и GET /api/cards/duplicate).
const CARD_PARSE_DIMS = [
  ['length', 'Длина, см'],
  ['width', 'Ширина, см'],
  ['height', 'Высота, см'],
  ['weightBrutto', 'Вес с упак., кг']
];
const cardParse = { items: [], cabinet: '' };
function openCardParse() {
  if (cardDup.job && !cardDup.job.finishedAt && cardDup.cabinet === state.cabinet) return renderCardDupModal(true);
  openModal(
    `<div class="card-parse"><p class="eyebrow">Карточки товаров</p><h2>Парсер WB</h2>
    <p class="muted">Вставьте ссылки на товары Wildberries или их артикулы — до 20, через пробел или с новой строки. Сайт разберёт карточку товара на витрине WB и покажет, что перенесётся в новую карточку вашего кабинета: наименование, описание, предмет, характеристики, габариты, размеры, фото и видео. Документы чужого продавца не переносятся. Фото и описания других продавцов — их собственность: по жалобе WB может заблокировать карточку.</p>
    <textarea id="cardParseText" rows="3" placeholder="https://www.wildberries.ru/catalog/123456789/detail.aspx" aria-label="Ссылки на товары WB или артикулы"></textarea>
    <div class="modal-actions card-parse-run"><button type="button" class="primary" id="cardParseRun">Разобрать</button></div>
    <div id="cardParseResult"></div><p class="card-tag-note" id="cardParseNote" role="status"></p></div>`,
    true
  );
  setTimeout(() => $('#cardParseText')?.focus(), 0);
}
async function runCardParse() {
  const text = $('#cardParseText').value.trim(),
    note = $('#cardParseNote'),
    button = $('#cardParseRun'),
    cabinet = state.cabinet;
  if (!text) {
    note.textContent = 'Вставьте ссылку или артикул';
    note.classList.add('error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Разбираем…';
  note.classList.remove('error');
  note.textContent = 'Читаем витрину WB…';
  $('#cardParseResult').innerHTML = '';
  try {
    const { items } = await api('/api/cards/parse', { method: 'POST', body: JSON.stringify({ cabinet, text }) });
    if (state.cabinet !== cabinet || !$('.card-parse')) return;
    Object.assign(cardParse, { items, cabinet });
    note.textContent = '';
    renderCardParse();
  } catch (e) {
    note.textContent = `Не удалось: ${e.message}`;
    note.classList.add('error');
  } finally {
    button.disabled = false;
    button.textContent = 'Разобрать';
  }
}
function renderCardParse() {
  const items = cardParse.items,
    ok = items.filter(item => !item.error),
    cards = cardsView.data?.cards || [];
  const taken = new Set(cards.map(card => card.vendorCode));
  const brands = [...new Set(cards.map(card => card.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const num = value => (value > 0 ? String(value) : '');
  const block = item => {
    if (item.error)
      return `<section class="card-parse-item card-parse-failed"><b>${escapeHtml(item.nmId)}</b> — ${escapeHtml(item.error)}</section>`;
    const code = taken.has(`wb-${item.nmId}`)
      ? cardDupVendorCode(`wb-${item.nmId}`, taken)
      : (taken.add(`wb-${item.nmId}`), `wb-${item.nmId}`);
    const sizes = item.sizes.length
      ? item.sizes
          .map(size => (size.wbSize && size.wbSize !== size.techSize ? `${size.techSize} (${size.wbSize})` : size.techSize))
          .join(', ')
      : 'без размеров';
    const brandOptions = `<option value="">Без бренда</option>${brands.map(brand => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`).join('')}${item.donorBrand && !brands.includes(item.donorBrand) ? `<option value="${escapeHtml(item.donorBrand)}">${escapeHtml(item.donorBrand)} — как у товара (нужны права на бренд)</option>` : ''}`;
    const tnved = item.tnved
      ? `<label>ТН ВЭД<input class="card-parse-tnved" inputmode="numeric" maxlength="10" list="cardParseTnved${item.nmId}" value="${escapeHtml(item.tnved.suggested || '')}" placeholder="${item.tnved.options.length ? 'выберите код' : '10 цифр'}"><datalist id="cardParseTnved${item.nmId}">${item.tnved.options.map(option => `<option value="${escapeHtml(option.tnved)}">${option.isKiz ? 'нужна маркировка Честного знака' : ''}</option>`).join('')}</datalist></label>`
      : '';
    const vat = item.vat
      ? `<label>НДС<select class="card-parse-vat"><option value="">не указывать</option>${item.vat.options.map(value => `<option value="${escapeHtml(value)}"${value === item.vat.suggested ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>`
      : '';
    return `<section class="card-parse-item" data-parse-nm="${escapeHtml(item.nmId)}">
      <div class="card-parse-head">${item.photo ? `<img class="stock-product-photo" src="${escapeHtml(item.photo)}" alt="" loading="lazy">` : '<span class="card-nophoto">нет фото</span>'}
        <div><input class="card-parse-title" maxlength="60" value="${escapeHtml(item.title)}" aria-label="Наименование"><small>${escapeHtml(item.subjectName)} · <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.nmId)} на WB</a>${item.donorBrand ? ` · бренд ${escapeHtml(item.donorBrand)}` : ''}</small>
        <small>${fmtNum(item.photos)} фото${item.video ? ' · видео' : ''} · ${escapeHtml(sizes)} · описание ${fmtNum(item.descriptionLength)} симв.${item.titleCut ? ' · наименование обрезано до 60 символов' : ''}${item.needKiz ? ' · <b class="card-warn">нужна маркировка Честного знака</b>' : ''}</small></div></div>
      <div class="card-parse-fields">
        <label>Артикул продавца<input class="card-parse-code" maxlength="72" value="${escapeHtml(code)}"></label>
        <label>Цена до скидки, ₽<input class="card-parse-price" type="number" min="1" step="1" inputmode="numeric" placeholder="${item.buyerPrice ? `у товара ≈ ${escapeHtml(fmtNum(item.buyerPrice))}` : ''}"></label>
        <label>Бренд<select class="card-parse-brand">${brandOptions}</select></label>${tnved}${vat}
        ${CARD_PARSE_DIMS.map(([key, label]) => `<label>${label}<input class="card-parse-dim${item.missingDims.includes(key) ? ' card-parse-missing' : ''}" data-dim="${key}" type="number" min="0" step="${key === 'weightBrutto' ? '0.001' : '0.1'}" value="${num(item.dimensions[key])}"></label>`).join('')}
      </div>
      <details class="card-parse-charcs"><summary>Характеристики: перенесётся ${fmtNum(item.matched.length)}${item.unmatched.length ? ` · нет в справочнике предмета ${fmtNum(item.unmatched.length)}` : ''}${item.requiredMissing.length ? ` · <span class="card-warn">обязательных без значения ${fmtNum(item.requiredMissing.length)}</span>` : ''}</summary>
        <ul>${item.matched.map(row => `<li><b>${escapeHtml(row.name)}</b>: ${escapeHtml(row.value)}</li>`).join('')}</ul>
        ${item.unmatched.length ? `<p class="muted">Не перенесётся (в предмете нет такой характеристики или значение не подходит): ${escapeHtml(item.unmatched.map(row => `${row.name}: ${row.value}`).join('; '))}</p>` : ''}
        ${item.requiredMissing.length ? `<p class="card-warn">Обязательные без значения — WB может не создать карточку, заполните после: ${escapeHtml(item.requiredMissing.join(', '))}</p>` : ''}</details>
      ${item.warnings.map(text => `<small class="card-warn">${escapeHtml(text)}</small>`).join('')}
    </section>`;
  };
  $('#cardParseResult').innerHTML = `<div class="card-parse-list">${items.map(block).join('')}</div>${
    ok.length
      ? `<div class="card-parse-footer"><label class="card-dup-suffix">Цена для всех, ₽<input id="cardParsePriceAll" type="number" min="1" step="1" inputmode="numeric" aria-label="Цена до скидки для всех карточек"></label>
    <p class="muted">Цена — до скидки продавца; скидку и остатки задайте после создания. Подсказка «у товара ≈» — сколько платит покупатель на витрине, уже со скидками WB. WB создаёт карточку до 30 минут.</p>
    <div class="modal-actions"><button type="button" data-modal-close-inline>Отмена</button><button type="button" class="primary" id="cardParseCreate">Создать ${fmtNum(ok.length)} ${cardWord(ok.length)}</button></div></div>`
      : ''
  }`;
  $$('#cardParseResult .stock-product-photo').forEach(image => bindPhotoPreview(image));
}
async function createCardParse() {
  const note = $('#cardParseNote'),
    button = $('#cardParseCreate'),
    fail = text => {
      note.textContent = text;
      note.classList.add('error');
    };
  const items = $$('.card-parse-item[data-parse-nm]').map(section => {
    const value = selector => section.querySelector(selector)?.value.trim() ?? '';
    return {
      nmId: Number(section.dataset.parseNm),
      vendorCode: value('.card-parse-code'),
      title: value('.card-parse-title'),
      price: Number(value('.card-parse-price')),
      brand: value('.card-parse-brand'),
      tnved: value('.card-parse-tnved'),
      vat: value('.card-parse-vat'),
      dimensions: Object.fromEntries(
        [...section.querySelectorAll('.card-parse-dim')].map(input => [input.dataset.dim, Number(input.value)])
      )
    };
  });
  if (!items.length) return;
  const bad = items.find(item => !item.vendorCode);
  if (bad) return fail(`Укажите артикул продавца для ${bad.nmId}`);
  const seen = new Set(),
    twice = items.find(item => seen.has(item.vendorCode) || !seen.add(item.vendorCode));
  if (twice) return fail(`Артикул повторяется: ${twice.vendorCode}`);
  const noPrice = items.find(item => !(item.price > 0));
  if (noPrice) return fail(`Укажите цену для ${noPrice.vendorCode}`);
  const noDims = items.find(item => Object.values(item.dimensions).some(value => !(value > 0)));
  if (noDims) return fail(`Укажите габариты упаковки и вес для ${noDims.vendorCode}`);
  const noTnved = items.find(item => $(`.card-parse-item[data-parse-nm="${item.nmId}"] .card-parse-tnved`) && !item.tnved);
  if (noTnved) return fail(`Укажите ТН ВЭД для ${noTnved.vendorCode} — без него WB не пропустит карточку на продажу`);
  button.disabled = true;
  button.textContent = 'Отправляем…';
  note.classList.remove('error');
  note.textContent = '';
  try {
    const job = await api('/api/cards/parse/create', {
      method: 'POST',
      body: JSON.stringify({ cabinet: cardParse.cabinet, confirm: true, items })
    });
    cardDup.job = job;
    cardDup.cabinet = job.cabinet;
    renderCardDupModal(true);
    pollCardDuplicate();
  } catch (e) {
    button.disabled = false;
    button.textContent = `Создать ${fmtNum(items.length)} ${cardWord(items.length)}`;
    fail(`Не удалось: ${e.message}`);
  }
}
