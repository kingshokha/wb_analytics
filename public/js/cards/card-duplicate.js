// Подключается после js/cards/cards.js.

// --- «Дублировать»: копии выбранных карточек с новым артикулом продавца и новыми баркодами ---
// Сервер (POST /api/cards/duplicate) создаёт копии по одной и сам ждёт, пока WB их создаст (до 30 минут), затем копирует
// фото, видео и ярлыки. Страница раз в 4 с спрашивает ход (GET /api/cards/duplicate) — окно можно закрыть и открыть снова.
const CARD_DUP_MAX = 100;
const cardDup = { job: null, cabinet: '', poll: 0 };
const CARD_DUP_STATUS = {
  preparing: 'готовим',
  queued: 'в очереди',
  creating: 'отправляем в WB',
  waiting: 'WB создаёт карточку…',
  media: 'копируем фото и ярлыки',
  video: 'копируем видео',
  done: 'готово',
  error: 'ошибка'
};
// Свободный артикул продавца: «артикул-2», «артикул-3»… — которого нет ни в кабинете, ни среди других копий.
function cardDupVendorCode(base, taken) {
  for (let n = 2; ; n++) {
    const code = `${base}-${n}`.slice(-72);
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
}
function openCardDuplicate() {
  if (cardDup.job && !cardDup.job.finishedAt && cardDup.cabinet === state.cabinet) return renderCardDupModal(true);
  const picked = cardPicked(cardRows());
  if (!picked.length) return toast('Выберите карточки');
  if (picked.length > CARD_DUP_MAX)
    return toast(`За раз можно дублировать не больше ${CARD_DUP_MAX} карточек — выбрано ${fmtNum(picked.length)}`);
  const taken = new Set((cardsView.data?.cards || []).map(card => card.vendorCode));
  openModal(
    `<div class="card-dup"><p class="eyebrow">Карточки товаров</p><h2>Дублировать ${fmtNum(picked.length)} ${cardWord(picked.length)}</h2>
    <p class="muted">Копия — новая карточка того же предмета. Скопируются наименование, описание, бренд, характеристики, габариты, документы, размеры и цена, фото, видео и ярлыки. Новыми будут артикул продавца (задайте ниже), баркоды (выдаст WB) и артикул WB. В склейку копия не попадает — WB не склеивает карточки с одинаковыми характеристиками. Скидку и остатки задайте после: WB создаёт карточку до 30 минут.</p>
    <label class="card-dup-suffix">Окончание артикула для всех <input id="cardDupSuffix" maxlength="20" placeholder="-2" aria-label="Окончание артикула для всех копий"></label>
    <div class="card-dup-list"><table class="stock-table" data-no-resize><thead><tr><th>Оригинал</th><th>Артикул продавца копии</th><th>Ход</th></tr></thead><tbody>${picked.map(card => `<tr data-dup-nm="${escapeHtml(card.nmID)}"><td><b>${escapeHtml(card.vendorCode || '—')}</b><small>${escapeHtml(card.nmID)} · ${escapeHtml((card.title || '').slice(0, 50))}</small></td><td><input class="card-dup-code" data-dup-base="${escapeHtml(card.vendorCode || card.nmID)}" maxlength="72" value="${escapeHtml(cardDupVendorCode(card.vendorCode || String(card.nmID), taken))}" aria-label="Артикул продавца копии ${escapeHtml(card.vendorCode || card.nmID)}"></td><td class="card-dup-state muted">—</td></tr>`).join('')}</tbody></table></div>
    <p class="card-tag-note" id="cardDupNote" role="status"></p><div class="modal-actions"><button type="button" data-modal-close-inline id="cardDupCancel">Отмена</button><button type="button" class="primary" id="cardDupConfirm">Создать копии</button></div></div>`,
    true
  );
  $('#cardDupConfirm').onclick = startCardDuplicate;
}
async function startCardDuplicate() {
  const rows = $$('.card-dup [data-dup-nm]'),
    note = $('#cardDupNote'),
    button = $('#cardDupConfirm');
  const items = rows.map(row => ({ nmId: Number(row.dataset.dupNm), vendorCode: row.querySelector('.card-dup-code').value.trim() }));
  const empty = items.find(item => !item.vendorCode);
  if (empty) {
    note.textContent = 'Укажите артикул продавца у каждой копии';
    note.classList.add('error');
    return;
  }
  const seen = new Set(),
    twice = items.find(item => seen.has(item.vendorCode) || !seen.add(item.vendorCode));
  if (twice) {
    note.textContent = `Артикул повторяется: ${twice.vendorCode}`;
    note.classList.add('error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Отправляем…';
  note.classList.remove('error');
  note.textContent = '';
  try {
    const job = await api('/api/cards/duplicate', {
      method: 'POST',
      body: JSON.stringify({ cabinet: state.cabinet, confirm: true, items })
    });
    cardDup.job = job;
    cardDup.cabinet = job.cabinet;
    renderCardDupModal(false);
    pollCardDuplicate();
  } catch (e) {
    button.disabled = false;
    button.textContent = 'Создать копии';
    note.textContent = `Не удалось: ${e.message}`;
    note.classList.add('error');
  }
}
// Окно с ходом задания. reopen — окно открыто заново (задание шло, пока окно было закрыто).
function renderCardDupModal(reopen) {
  const job = cardDup.job;
  if (!job) return;
  if (reopen || !$('.card-dup')) {
    const parse = job.kind === 'parse';
    openModal(
      `<div class="card-dup"><p class="eyebrow">Карточки товаров</p><h2>${parse ? 'Карточки по ссылкам WB' : 'Копии карточек'}</h2><p class="muted">WB создаёт карточку до 30 минут. Окно можно закрыть — карточки создадутся, а ход можно посмотреть, снова нажав «${parse ? 'Парсер WB' : 'Дублировать'}».</p>
      <div class="card-dup-list"><table class="stock-table" data-no-resize><thead><tr><th>${parse ? 'Товар на WB' : 'Оригинал'}</th><th>Артикул продавца${parse ? '' : ' копии'}</th><th>Ход</th></tr></thead><tbody>${job.items.map(item => `<tr data-dup-nm="${escapeHtml(item.nmId)}"><td><b>${escapeHtml(parse ? item.title || '—' : item.sourceVendorCode || '—')}</b><small>${escapeHtml(item.nmId)}${parse ? '' : ` · ${escapeHtml((item.title || '').slice(0, 50))}`}</small></td><td><input class="card-dup-code" value="${escapeHtml(item.vendorCode)}" disabled></td><td class="card-dup-state muted">—</td></tr>`).join('')}</tbody></table></div>
      <p class="card-tag-note" id="cardDupNote" role="status"></p><div class="modal-actions"><button type="button" class="primary" data-modal-close-inline>Закрыть</button></div></div>`,
      true
    );
  } else {
    $('#cardDupSuffix')?.closest('label')?.remove();
    $$('.card-dup-code').forEach(input => {
      input.disabled = true;
    });
    $('#cardDupCancel')?.remove();
    const button = $('#cardDupConfirm');
    if (button) {
      button.disabled = false;
      button.textContent = 'Закрыть';
      button.onclick = closeModal;
    }
  }
  job.items.forEach(item => {
    const cell = $(`.card-dup [data-dup-nm="${CSS.escape(String(item.nmId))}"] .card-dup-state`);
    if (!cell) return;
    const done = item.status === 'done',
      failed = item.status === 'error';
    cell.className = `card-dup-state${failed ? ' card-warn' : done ? '' : ' muted'}`;
    cell.innerHTML = `${done && item.newNmId ? `готово · <a class="card-title-link" href="${escapeHtml(cardLink(item.newNmId))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.newNmId)}</a>` : escapeHtml(CARD_DUP_STATUS[item.status] || item.status)}${failed ? `<small>${escapeHtml(item.error)}</small>` : ''}${(item.warnings || []).map(text => `<small class="card-warn">${escapeHtml(text)}</small>`).join('')}`;
  });
  const count = status => job.items.filter(item => item.status === status).length;
  const note = $('#cardDupNote');
  if (note)
    note.textContent = job.finishedAt
      ? `Готово ${fmtNum(count('done'))} из ${fmtNum(job.items.length)}${count('error') ? ` · с ошибкой ${fmtNum(count('error'))}` : ''}`
      : `Создано ${fmtNum(count('done'))} из ${fmtNum(job.items.length)} · ждём WB…`;
}
async function pollCardDuplicate() {
  clearTimeout(cardDup.poll);
  const job = cardDup.job;
  if (!job || job.finishedAt) return;
  cardDup.poll = setTimeout(async () => {
    try {
      const { job: fresh } = await api(`/api/cards/duplicate?${new URLSearchParams({ cabinet: cardDup.cabinet, job: job.id })}`);
      if (!fresh) {
        cardDup.job = null;
        return;
      }
      const before = job.items.filter(item => item.status === 'done').length;
      cardDup.job = fresh;
      if ($('.card-dup')) renderCardDupModal(false);
      if (
        fresh.items.filter(item => item.status === 'done').length > before &&
        state.cabinet === fresh.cabinet &&
        state.activePage === 'cards'
      )
        loadCards(false, true);
      if (fresh.finishedAt) {
        const done = fresh.items.filter(item => item.status === 'done').length;
        toast(
          `${fresh.kind === 'parse' ? 'Карточки по ссылкам WB' : 'Копии карточек'}: готово ${fmtNum(done)} из ${fmtNum(fresh.items.length)}`
        );
        return;
      }
    } catch {}
    pollCardDuplicate();
  }, 4000);
}
