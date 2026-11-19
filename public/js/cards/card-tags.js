// --- «Карточки товаров»: ярлыки продавца — создать, переименовать, удалить ---
// Подключается после js/cards/cards.js.

// --- Ярлыки продавца: до 15, имя до 15 символов, цвет из шести ---
function openCardTags() {
  const tags = cardsView.data?.tags || [];
  openModal(`<div class="card-tags-modal"><p class="eyebrow">Карточки товаров</p><h2>Ярлыки</h2><p class="muted">Ярлыки видны только вам — для группировки и поиска карточек. До 15 ярлыков, название до 15 символов. Изменения сразу уходят в WB.</p>
    <div class="card-tag-list">${tags.map(tag => cardTagRow(tag)).join('') || '<p class="muted">Ярлыков пока нет.</p>'}</div>
    ${tags.length < 15 ? `<form class="card-tag-row new" data-card-tag-form="create">${cardTagFields({ name: '', color: 'D1CFD7' })}<button type="submit" class="primary">Создать</button></form>` : '<p class="muted">Создано 15 ярлыков — это максимум.</p>'}
    <p class="card-tag-note" id="cardTagNote" role="status"></p></div>`);
}
const cardTagFields = tag =>
  `<input name="name" maxlength="15" value="${escapeHtml(tag.name)}" placeholder="Название" required aria-label="Название ярлыка"><select name="color" aria-label="Цвет">${CARD_TAG_COLORS.map(([value, label]) => `<option value="${value}"${value === String(tag.color || '').toUpperCase() ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
const cardTagRow = tag =>
  `<form class="card-tag-row" data-card-tag-form="update" data-tag-id="${escapeHtml(tag.id)}">${cardTagChip(tag)}${cardTagFields(tag)}<button type="submit">Сохранить</button><button type="button" class="danger-link" data-card-tag-delete="${escapeHtml(tag.id)}" data-tag-name="${escapeHtml(tag.name)}">Удалить</button></form>`;
async function sendCardTag(body) {
  const note = $('#cardTagNote');
  note.textContent = 'Отправляем в WB…';
  note.classList.remove('error');
  try {
    const result = await api('/api/cards/tag', {
      method: 'POST',
      body: JSON.stringify({ cabinet: state.cabinet, confirm: true, ...body })
    });
    if (cardsView.data) cardsView.data.tags = result.tags || cardsView.data.tags;
    if (body.action === 'delete' && cardsView.data)
      cardsView.data.cards.forEach(card => {
        card.tags = card.tags.filter(tag => String(tag.id) !== String(body.id));
      });
    openCardTags();
    renderCards();
    toast('Ярлыки обновлены');
  } catch (e) {
    note.textContent = `Не удалось: ${e.message}`;
    note.classList.add('error');
  }
}
