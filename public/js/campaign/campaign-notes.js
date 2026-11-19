'use strict';

// --- Заметки по кампании: плавающая кнопка справа внизу, окно с заметками по дням (новые сверху) и полем для новой ---
// Хранятся на компьютере (data/campaign-notes.json), отдельно для каждой кампании.
const campaignNotes = { list: [], open: false, editing: null };
const notesQuery = () => ({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '' });
async function loadCampaignNotes() {
  try {
    const response = await fetch(`/api/campaign-notes?${new URLSearchParams(notesQuery())}`),
      data = await response.json();
    if (!response.ok) throw new Error(data.error);
    campaignNotes.list = data.notes || [];
  } catch {
    campaignNotes.list = [];
  }
  renderCampaignNotesButton();
  if (campaignNotes.open) renderCampaignNotes();
  renderCampaignMinis();
}
function renderCampaignNotesButton() {
  const count = $('#campaignNotesCount');
  count.textContent = campaignNotes.list.length;
  count.hidden = !campaignNotes.list.length;
}
function renderCampaignNotes() {
  const panel = $('#campaignNotesPanel'),
    draft = panel.querySelector('[data-campaign-note-form="new"] textarea')?.value || '';
  let day = '',
    html = '';
  for (const note of [...campaignNotes.list].reverse()) {
    const label = historyDay(note.at);
    if (label !== day) {
      day = label;
      html += `<div class="history-day"><span>${esc(label)}</span></div>`;
    }
    html +=
      `<article class="history-card comment"><div class="history-card-head"><div class="history-title">Заметка${note.editedAt ? ` · изменена ${esc(historyTime(note.editedAt))}` : ''}</div><div class="history-who"><b>Вы</b><small>${historyTime(note.at)}</small></div></div>` +
      (campaignNotes.editing === note.id
        ? noteForm(`data-campaign-note-form="${esc(note.id)}"`, note.text, 'Заметка')
        : `<div class="history-comment">${COMMENT_ICON}<p>${esc(note.text)}</p><span class="history-actions"><button type="button" data-campaign-note-edit="${esc(note.id)}" title="Изменить" aria-label="Изменить">${EDIT_ICON}</button><button type="button" data-campaign-note-delete="${esc(note.id)}" title="Удалить" aria-label="Удалить">${DELETE_ICON}</button></span></div>`) +
      '</article>';
  }
  panel.innerHTML =
    `<div class="history-head"><strong>Заметки по кампании</strong><button type="button" class="history-close" data-campaign-notes-close aria-label="Закрыть">×</button></div>` +
    `<div class="notes-list">${html || '<p class="history-empty">Заметок пока нет. Запишите, что меняли в кампании и зачем, — потом будет видно, что сработало.</p>'}</div>` +
    `<div class="notes-new">${noteForm('data-campaign-note-form="new"', draft, 'Новая заметка — Enter сохранить, Shift+Enter перенос')}</div>`;
  const field = panel.querySelector(
    campaignNotes.editing
      ? `[data-campaign-note-form="${CSS.escape(campaignNotes.editing)}"] textarea`
      : '[data-campaign-note-form="new"] textarea'
  );
  if (field) {
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }
}
function toggleCampaignNotes(open = !campaignNotes.open) {
  campaignNotes.open = open;
  campaignNotes.editing = null;
  $('#campaignNotesPanel').hidden = !open;
  $('#campaignNotesButton').setAttribute('aria-expanded', String(open));
  if (open) renderCampaignNotes();
}
async function saveCampaignNote(body) {
  try {
    const response = await fetch('/api/campaign-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...notesQuery(), ...body })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'не сохранилось');
    campaignNotes.list = data.notes || [];
    return true;
  } catch (e) {
    alertNote(`Заметка не сохранилась: ${e.message}`);
    return false;
  }
}
const alertNote = text => {
  const panel = $('#campaignNotesPanel');
  panel.querySelector('.notes-error')?.remove();
  panel.insertAdjacentHTML('beforeend', `<p class="price-product-note notes-error" style="color:#b84949">${esc(text)}</p>`);
};
$('#campaignNotesButton').addEventListener('click', event => {
  event.stopPropagation();
  toggleCampaignNotes();
});
$('#campaignNotesPanel').addEventListener('click', async event => {
  event.stopPropagation();
  if (event.target.closest('[data-campaign-notes-close]')) return toggleCampaignNotes(false);
  const edit = event.target.closest('[data-campaign-note-edit]');
  if (edit) {
    campaignNotes.editing = edit.dataset.campaignNoteEdit;
    return renderCampaignNotes();
  }
  const remove = event.target.closest('[data-campaign-note-delete]');
  if (remove) {
    if (await saveCampaignNote({ noteId: remove.dataset.campaignNoteDelete, remove: true })) {
      renderCampaignNotesButton();
      renderCampaignNotes();
    }
    return;
  }
  if (event.target.closest('[data-note-cancel]')) {
    const form = event.target.closest('form');
    if (form?.dataset.campaignNoteForm === 'new') form.querySelector('textarea').value = '';
    campaignNotes.editing = null;
    renderCampaignNotes();
  }
});
$('#campaignNotesPanel').addEventListener('submit', async event => {
  event.preventDefault();
  const id = event.target.dataset.campaignNoteForm,
    text = event.target.querySelector('textarea').value.trim();
  // Пустой текст у существующей заметки — удалить её; пустая новая — ничего не делать.
  if (id === 'new' && !text) return;
  if (await saveCampaignNote(id === 'new' ? { text } : text ? { noteId: id, text } : { noteId: id, remove: true })) {
    if (id === 'new') event.target.querySelector('textarea').value = '';
    campaignNotes.editing = null;
    renderCampaignNotesButton();
    renderCampaignNotes();
  }
});
// Клик мимо окна закрывает его, если ничего не пишется (иначе можно потерять набранный текст).
document.addEventListener('click', event => {
  if (!campaignNotes.open || event.target.closest('#campaignNotesPanel,#campaignNotesButton')) return;
  const draft = $('#campaignNotesPanel [data-campaign-note-form="new"] textarea')?.value.trim();
  if (!draft && !campaignNotes.editing) toggleCampaignNotes(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && campaignNotes.open) toggleCampaignNotes(false);
});
loadCampaignNotes();
