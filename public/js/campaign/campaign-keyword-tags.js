'use strict';
// --- Детализация кампании: отметки, пояснения и история ключевых запросов ---

// --- Отметки ключевых запросов: «Важный» сочетается с любой, остальные — одна на запрос. Хранятся на сервере по кампании ---
const KEYWORD_TAGS = {
  important: { label: 'Важный', desc: 'Можно сочетать с любой отметкой', icon: '★', color: '#f0a04b' },
  target: { label: 'Целевой', desc: 'Запрос точно подходит товару', icon: '◎', color: '#2f8f62' },
  nearTarget: { label: 'Околоцелевой', desc: 'Смежный запрос: проверяем интерес к товару', icon: '✣', color: '#3f6fd6' },
  nonTarget: { label: 'Нецелевой', desc: 'Покупатель ищет другой товар', icon: '✕', color: '#d4553f' },
  promote: { label: 'Продвигаем', desc: 'Усиливаем показы по запросу', icon: '➚', color: '#2e7d32' },
  test: { label: 'Тестируем', desc: 'Проверяем рекламную гипотезу', icon: '⚗', color: '#7b2fbf' },
  traffic: { label: 'Трафик', desc: 'Запрос для привлечения трафика', icon: '≋', color: '#4a63d6' },
  watch: { label: 'Наблюдаем', desc: 'Следим за результатом без изменений', icon: '◉', color: '#2b7bbf' },
  unprofitable: { label: 'Не окупается', desc: 'Затраты не оправдывают результат', icon: '⊘', color: '#c0392b' },
  profitable: { label: 'Выгодно', desc: 'Результат устраивает по затратам', icon: '₽', color: '#43a047' },
  investigate: { label: 'Разобраться', desc: 'Есть вопрос: добавьте пояснение', icon: '?', color: '#e67e22' }
};
const KEYWORD_TAG_ORDER = Object.keys(KEYWORD_TAGS).filter(key => key !== 'important');
keywords.tags = {};
keywords.tagColors = {};
keywords.tagsLoaded = false;
const tagColor = key => keywords.tagColors[key] || KEYWORD_TAGS[key].color;
async function loadKeywordTags() {
  try {
    const response = await fetch(
      `/api/keyword-tags?${new URLSearchParams({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '' })}`
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    keywords.tags = result.tags || {};
    keywords.tagColors = result.colors || {};
    keywords.tagsLoaded = true;
    renderKeywords();
  } catch {
    /* без отметок таблица работает как раньше */
  }
}
function keywordTagButton(query) {
  const tag = keywords.tags[query] || {};
  if (!tag.tag && !tag.important)
    return `<button type="button" class="keyword-tag-add" data-keyword-tag="${esc(query)}" title="Добавить отметку" aria-label="Добавить отметку запросу «${esc(query)}»">+</button>`;
  const title = [tag.important ? KEYWORD_TAGS.important.label : '', tag.tag ? KEYWORD_TAGS[tag.tag].label : ''].filter(Boolean).join(' · ');
  // В строке — только иконки отметок, названия видны при наведении.
  const main = tag.tag ? `<i style="color:${tagColor(tag.tag)}">${KEYWORD_TAGS[tag.tag].icon}</i>` : '';
  return `<button type="button" class="keyword-tag-set" data-keyword-tag="${esc(query)}" style="--tag:${tag.tag ? tagColor(tag.tag) : tagColor('important')}" title="${esc(title)} — изменить отметку" aria-label="Отметка «${esc(title)}», изменить">${tag.important ? `<i style="color:${tagColor('important')}">★</i>` : ''}${main}</button>`;
}
// --- Пояснения и история: у запроса хранится история смены отметок (с пояснениями), комментарии и смена статуса фразы ---
const NOTE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.75h5.25l3 3v9.5H4z"/><path d="M9.25 1.75v3h3M6.25 8h4M6.25 10.75h4"/></svg>';
const COMMENT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3h11v7.5H7.25L4.5 13v-2.5h-2z"/></svg>';
const EDIT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.75l2.75 2.75-7.5 7.5H3v-2.75z"/></svg>';
const DELETE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';
const keywordHistory = query => keywords.tags[query]?.history || [];
// Значок справа от запроса появляется, когда есть хотя бы одно пояснение или комментарий.
const keywordHasNotes = query => keywordHistory(query).some(event => event.note || event.type === 'comment');
// Последняя смена основной отметки на текущую — к ней относится пояснение из меню отметок.
const lastTagEvent = query => {
  const tag = keywords.tags[query]?.tag;
  return tag ? [...keywordHistory(query)].reverse().find(event => event.type === 'tag' && event.to === tag) || null : null;
};
const keywordNoteButton = query =>
  keywordHasNotes(query)
    ? `<button type="button" class="keyword-note-button" data-keyword-notes="${esc(query)}" aria-label="История отметок и комментариев запроса «${esc(query)}»">${NOTE_ICON}</button>`
    : '';
const noteForm = (attr, text, placeholder) =>
  `<form class="note-form" ${attr}><textarea rows="2" maxlength="1000" placeholder="${placeholder}" aria-label="${placeholder}">${esc(text || '')}</textarea><div><button type="button" class="note-cancel" data-note-cancel>Отмена</button><button type="submit" class="note-save">Сохранить</button></div></form>`;
// Enter сохраняет, Shift+Enter — перенос строки.
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && event.target.matches('.note-form textarea')) {
    event.preventDefault();
    event.target.form.requestSubmit();
  }
});
async function saveKeywordNote(query, body) {
  try {
    const response = await fetch('/api/keyword-tags/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '', query, ...body })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'не сохранилось');
    if (result.tag) keywords.tags[query] = result.tag;
    else delete keywords.tags[query];
    renderKeywords();
    return true;
  } catch (e) {
    keywordMessage(`Комментарий не сохранился: ${e.message}`, 'error');
    return false;
  }
}
function closeTagMenu() {
  $('#keywordTagMenu').hidden = true;
  tagMenu.editing = false;
}
const tagMenu = { editing: false };
// Под выбранной отметкой — пояснение к ней: ссылка «Добавить пояснение», поле ввода или уже написанный текст.
function tagNoteBlock(query) {
  const event = lastTagEvent(query);
  if (tagMenu.editing) return noteForm('data-tag-note-form', event?.note, 'Пояснение к отметке');
  if (event?.note)
    return `<div class="tag-note">${NOTE_ICON}<span>${esc(event.note)}</span><button type="button" class="tag-note-link" data-tag-note-add>Изменить</button></div>`;
  return `<button type="button" class="tag-note-link tag-note-add" data-tag-note-add>${NOTE_ICON}Добавить пояснение</button>`;
}
function renderTagMenu(query) {
  const menu = $('#keywordTagMenu'),
    tag = keywords.tags[query] || {};
  menu.dataset.query = query;
  menu.innerHTML =
    `<button type="button" class="tag-menu-close" data-tag-close aria-label="Закрыть">×</button><small class="tag-menu-caption">Отметка кластера</small><strong class="tag-menu-query">${esc(query)}</strong>` +
    `<button type="button" class="tag-item ${tag.important ? 'active' : ''}" data-tag-important><i style="color:${tagColor('important')}">${tag.important ? '★' : '☆'}</i><span>${KEYWORD_TAGS.important.label}<small>${KEYWORD_TAGS.important.desc}</small></span></button><hr>` +
    KEYWORD_TAG_ORDER.map(
      key =>
        `<button type="button" class="tag-item ${tag.tag === key ? 'active' : ''}" data-tag-set="${key}"><i style="color:${tagColor(key)}">${KEYWORD_TAGS[key].icon}</i><span>${KEYWORD_TAGS[key].label}<small>${KEYWORD_TAGS[key].desc}</small></span></button>${tag.tag === key ? tagNoteBlock(query) : ''}`
    ).join('') +
    `<hr><button type="button" class="tag-item" data-tag-clear ${tag.tag || tag.important ? '' : 'disabled'}><i>⌫</i><span>Убрать отметку</span></button><button type="button" class="tag-colors-link" data-tag-colors>⚙ Настроить цвета отметок</button>`;
  if (tagMenu.editing) {
    const field = menu.querySelector('.note-form textarea');
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }
}
function openTagMenu(query, anchor) {
  const menu = $('#keywordTagMenu');
  tagMenu.editing = false;
  hideHistory();
  renderTagMenu(query);
  menu.hidden = false;
  placeTagMenu(anchor);
}
// Меню у кнопки: вниз, если помещается, иначе в сторону, где больше места, с прокруткой внутри.
function placeTagMenu(anchor) {
  const menu = $('#keywordTagMenu'),
    rect = anchor.getBoundingClientRect(),
    below = window.innerHeight - rect.bottom - 14,
    above = rect.top - 14,
    scroll = menu.scrollTop;
  menu.style.maxHeight = 'none';
  const full = menu.offsetHeight,
    down = full <= below || below >= above,
    height = Math.min(full, down ? below : above);
  menu.style.maxHeight = `${height}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${down ? rect.bottom + 6 : rect.top - 6 - height}px`;
  menu.scrollTop = scroll;
}
// При прокрутке страницы меню едет за своей кнопкой; закрывается, только когда кнопка ушла с экрана.
function followTagMenu() {
  const menu = $('#keywordTagMenu');
  if (menu.hidden) return;
  const anchor = document.querySelector(`[data-keyword-tag="${CSS.escape(menu.dataset.query || '')}"]`),
    rect = anchor?.getBoundingClientRect();
  if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) return closeTagMenu();
  placeTagMenu(anchor);
}
// Меню открыто для этого запроса и не редактируется — перерисовать (например, когда сервер вернул событие для пояснения).
const refreshTagMenu = query => {
  const menu = $('#keywordTagMenu');
  if (!menu.hidden && menu.dataset.query === query && !tagMenu.editing) renderTagMenu(query);
};
async function saveKeywordTag(query, change) {
  const before = keywords.tags[query] ? { ...keywords.tags[query] } : null;
  const next = { ...(before || {}) };
  if (change.clear) {
    delete next.tag;
    delete next.important;
  }
  if ('tag' in change) {
    if (change.tag) next.tag = change.tag;
    else delete next.tag;
  }
  if ('important' in change) {
    if (change.important) next.important = true;
    else delete next.important;
  }
  if (next.tag || next.important || next.history?.length) keywords.tags[query] = next;
  else delete keywords.tags[query];
  renderKeywords();
  try {
    const response = await fetch('/api/keyword-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '', query, ...change })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'не сохранилось');
    if (result.tag) keywords.tags[query] = result.tag;
    else delete keywords.tags[query];
  } catch (e) {
    if (before) keywords.tags[query] = before;
    else delete keywords.tags[query];
    keywordMessage(`Отметка не сохранилась: ${e.message}`, 'error');
  }
  renderKeywords();
  refreshTagMenu(query);
}
function openTagColors() {
  closeTagMenu();
  $('#tagColorsBody').innerHTML =
    Object.keys(KEYWORD_TAGS)
      .map(
        key =>
          `<label class="tag-color-row"><i style="color:${tagColor(key)}">${KEYWORD_TAGS[key].icon}</i><span>${KEYWORD_TAGS[key].label}</span><input type="color" value="${tagColor(key)}" data-tag-color="${key}" aria-label="Цвет отметки «${KEYWORD_TAGS[key].label}»"></label>`
      )
      .join('') +
    `<div class="confirm-buttons"><button type="button" class="secondary" data-tag-colors-reset>По умолчанию</button><button type="button" data-tag-colors-save>Сохранить</button></div>`;
  $('#tagColorsModal').hidden = false;
}
async function saveTagColors(colors) {
  try {
    const response = await fetch('/api/keyword-tags/colors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colors })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    keywords.tagColors = result.colors || {};
    $('#tagColorsModal').hidden = true;
    renderKeywords();
  } catch (e) {
    keywordMessage(`Цвета не сохранились: ${e.message}`, 'error');
  }
}
$('#keywordsBody').addEventListener('click', event => {
  const button = event.target.closest('[data-keyword-tag]');
  if (!button) return;
  event.stopPropagation();
  const menu = $('#keywordTagMenu');
  if (!menu.hidden && menu.dataset.query === button.dataset.keywordTag) {
    closeTagMenu();
    return;
  }
  openTagMenu(button.dataset.keywordTag, button);
});
$('#keywordTagMenu').addEventListener('click', event => {
  // Меню перерисовывается при клике — без этого document увидит «внешний» клик и закроет его.
  event.stopPropagation();
  const query = $('#keywordTagMenu').dataset.query,
    tag = keywords.tags[query] || {};
  if (event.target.closest('[data-tag-close]')) return closeTagMenu();
  if (event.target.closest('[data-tag-colors]')) return openTagColors();
  if (event.target.closest('[data-tag-important]')) {
    saveKeywordTag(query, { important: !tag.important });
    tagMenu.editing = false;
    renderTagMenu(query);
    return;
  }
  // После выбора отметки меню остаётся открытым: под ней появляется «Добавить пояснение».
  const set = event.target.closest('[data-tag-set]');
  if (set) {
    saveKeywordTag(query, { tag: tag.tag === set.dataset.tagSet ? '' : set.dataset.tagSet });
    tagMenu.editing = false;
    renderTagMenu(query);
    return;
  }
  if (event.target.closest('[data-tag-note-add]')) {
    tagMenu.editing = true;
    renderTagMenu(query);
    return;
  }
  if (event.target.closest('[data-note-cancel]')) {
    tagMenu.editing = false;
    renderTagMenu(query);
    return;
  }
  if (event.target.closest('[data-tag-clear]')) {
    saveKeywordTag(query, { clear: true });
    closeTagMenu();
  }
});
$('#keywordTagMenu').addEventListener('submit', async event => {
  event.preventDefault();
  const query = $('#keywordTagMenu').dataset.query,
    text = event.target.querySelector('textarea').value.trim(),
    target = lastTagEvent(query);
  // Пустое поле у уже написанного пояснения — удалить его; без события отметки пояснение сохраняется комментарием.
  const ok = !text
    ? target?.note
      ? await saveKeywordNote(query, { eventId: target.id, remove: true })
      : true
    : await saveKeywordNote(query, target ? { eventId: target.id, text } : { text });
  if (ok) {
    tagMenu.editing = false;
    if (!$('#keywordTagMenu').hidden) renderTagMenu(query);
  }
});
// --- Всплывающая история запроса: при наведении на значок справа от запроса; клик закрепляет окно ---
const historyPop = { query: '', tab: 'all', editing: null, pinned: false, timer: 0, anchor: null };
const HISTORY_TABS = [
  ['all', 'Все'],
  ['notes', 'Комментарии и отметки'],
  ['status', 'Статус фразы']
];
const historyDay = iso => {
  const at = new Date(iso);
  return `${at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })} · ${at.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'Europe/Moscow' })}`;
};
const historyTime = iso => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const tagBadge = key =>
  `<span class="history-tag"><i style="color:${KEYWORD_TAGS[key] ? tagColor(key) : 'inherit'}">${KEYWORD_TAGS[key]?.icon || ''}</i><b>${esc(KEYWORD_TAGS[key]?.label || key)}</b></span>`;
function historyTitle(event) {
  if (event.type === 'tag')
    return event.to
      ? `Отмечен как ${event.from ? `<span class="history-from">${esc(KEYWORD_TAGS[event.from]?.label || event.from)}</span> → ` : ''}${tagBadge(event.to)}`
      : `Снята отметка ${tagBadge(event.from)}`;
  if (event.type === 'important') return `${event.on ? 'Отмечен как' : 'Снята отметка'} ${tagBadge('important')}`;
  if (event.type === 'status')
    return event.action === 'exclude' ? 'Фраза <b>исключена</b> из показов (минус-фраза)' : 'Фраза снова <b>включена</b> в показы';
  return 'Комментарий';
}
function historyComment(event, text) {
  if (historyPop.editing === event.id)
    return noteForm(`data-history-form="${esc(event.id)}"`, text, event.type === 'comment' ? 'Комментарий' : 'Пояснение');
  return `<div class="history-comment">${COMMENT_ICON}<p>${esc(text)}</p><span class="history-actions"><button type="button" data-history-edit="${esc(event.id)}" title="Изменить" aria-label="Изменить">${EDIT_ICON}</button><button type="button" data-history-delete="${esc(event.id)}" title="Удалить" aria-label="Удалить">${DELETE_ICON}</button></span></div>`;
}
function historyCard(event) {
  const text = event.type === 'comment' ? event.text : event.note;
  const body = text
    ? historyComment(event, text)
    : historyPop.editing === event.id
      ? noteForm(`data-history-form="${esc(event.id)}"`, '', 'Пояснение')
      : `<button type="button" class="history-explain" data-history-edit="${esc(event.id)}">Пояснить</button>`;
  return `<article class="history-card ${event.type}"><div class="history-card-head"><div class="history-title">${historyTitle(event)}</div><div class="history-who"><b>Вы</b><small>${historyTime(event.at)}</small></div></div>${body}</article>`;
}
function renderHistory() {
  const pop = $('#keywordHistoryPop'),
    query = historyPop.query;
  const events = keywordHistory(query)
    .filter(event => historyPop.tab === 'all' || (historyPop.tab === 'status' ? event.type === 'status' : event.type !== 'status'))
    .slice()
    .reverse();
  let day = '',
    list = '';
  for (const event of events) {
    const label = historyDay(event.at);
    if (label !== day) {
      day = label;
      list += `<div class="history-day"><span>${esc(label)}</span></div>`;
    }
    list += historyCard(event);
  }
  pop.innerHTML =
    `<div class="history-head"><strong>${esc(query)}</strong><button type="button" class="history-close" data-history-close aria-label="Закрыть">×</button></div>` +
    `<div class="history-tabs" role="tablist">${HISTORY_TABS.map(([key, label]) => `<button type="button" role="tab" aria-selected="${historyPop.tab === key}" class="${historyPop.tab === key ? 'active' : ''}" data-history-tab="${key}">${label}</button>`).join('')}</div>` +
    `<div class="history-list">${list || '<p class="history-empty">Записей нет</p>'}</div>` +
    `<div class="history-foot">${historyPop.editing === 'new' ? noteForm('data-history-form="new"', '', 'Комментарий') : `<button type="button" class="history-add" data-history-add>${COMMENT_ICON}Добавить комментарий</button>`}</div>`;
  const field = pop.querySelector('.note-form textarea');
  if (field) {
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }
}
function placeHistory() {
  const pop = $('#keywordHistoryPop'),
    anchor = historyPop.anchor;
  if (!anchor?.isConnected) return;
  const rect = anchor.getBoundingClientRect(),
    below = window.innerHeight - rect.bottom - 14,
    above = rect.top - 14;
  pop.style.maxHeight = 'none';
  const full = pop.offsetHeight,
    down = full <= below || below >= above,
    height = Math.min(full, down ? below : above);
  pop.style.maxHeight = `${height}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.right - pop.offsetWidth + 14, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${down ? rect.bottom + 6 : rect.top - 6 - height}px`;
}
function showHistory(query, anchor, pinned = false) {
  clearTimeout(historyPop.timer);
  if (historyPop.query !== query) {
    historyPop.tab = 'all';
    historyPop.editing = null;
  }
  Object.assign(historyPop, { query, anchor, pinned: pinned || (historyPop.pinned && historyPop.query === query) });
  $('#keywordHistoryPop').hidden = false;
  renderHistory();
  placeHistory();
}
function hideHistory() {
  clearTimeout(historyPop.timer);
  $('#keywordHistoryPop').hidden = true;
  Object.assign(historyPop, { query: '', editing: null, pinned: false, anchor: null });
}
// Окно не закрывается, пока оно закреплено кликом или в нём пишут комментарий.
const historyBusy = () => historyPop.pinned || historyPop.editing != null;
const scheduleHideHistory = () => {
  clearTimeout(historyPop.timer);
  historyPop.timer = setTimeout(() => {
    if (!historyBusy()) hideHistory();
  }, 250);
};
// После перерисовки таблицы (сохранение) окно привязывается к новому значку того же запроса.
function refreshHistory() {
  if ($('#keywordHistoryPop').hidden) return;
  if (!keywordHistory(historyPop.query).length) {
    hideHistory();
    return;
  }
  historyPop.anchor = document.querySelector(`[data-keyword-notes="${CSS.escape(historyPop.query)}"]`) || historyPop.anchor;
  renderHistory();
  placeHistory();
}
$('#keywordsBody').addEventListener('mouseover', event => {
  const button = event.target.closest('[data-keyword-notes]');
  if (!button) return;
  clearTimeout(historyPop.timer);
  if ($('#keywordHistoryPop').hidden || historyPop.query !== button.dataset.keywordNotes) showHistory(button.dataset.keywordNotes, button);
});
$('#keywordsBody').addEventListener('mouseout', event => {
  const button = event.target.closest('[data-keyword-notes]');
  if (button && !button.contains(event.relatedTarget)) scheduleHideHistory();
});
$('#keywordsBody').addEventListener('click', event => {
  const button = event.target.closest('[data-keyword-notes]');
  if (!button) return;
  event.stopPropagation();
  if (!$('#keywordHistoryPop').hidden && historyPop.query === button.dataset.keywordNotes && historyPop.pinned) hideHistory();
  else {
    closeTagMenu();
    showHistory(button.dataset.keywordNotes, button, true);
  }
});
$('#keywordHistoryPop').addEventListener('mouseenter', () => clearTimeout(historyPop.timer));
$('#keywordHistoryPop').addEventListener('mouseleave', scheduleHideHistory);
$('#keywordHistoryPop').addEventListener('click', async event => {
  // Окно перерисовывается при клике — без этого document увидит «внешний» клик и закроет его.
  // Клик внутри закрепляет окно: после смены вкладки оно может стать ниже и уйти из-под курсора.
  event.stopPropagation();
  historyPop.pinned = true;
  const query = historyPop.query;
  if (event.target.closest('[data-history-close]')) return hideHistory();
  const tab = event.target.closest('[data-history-tab]');
  if (tab) {
    historyPop.tab = tab.dataset.historyTab;
    historyPop.editing = null;
    renderHistory();
    placeHistory();
    return;
  }
  if (event.target.closest('[data-history-add]')) {
    historyPop.editing = 'new';
    renderHistory();
    placeHistory();
    return;
  }
  if (event.target.closest('[data-note-cancel]')) {
    historyPop.editing = null;
    renderHistory();
    placeHistory();
    return;
  }
  const edit = event.target.closest('[data-history-edit]');
  if (edit) {
    historyPop.editing = edit.dataset.historyEdit;
    renderHistory();
    placeHistory();
    return;
  }
  const remove = event.target.closest('[data-history-delete]');
  if (remove) {
    if (await saveKeywordNote(query, { eventId: remove.dataset.historyDelete, remove: true })) refreshHistory();
    refreshTagMenu(query);
  }
});
$('#keywordHistoryPop').addEventListener('submit', async event => {
  event.preventDefault();
  const query = historyPop.query,
    id = event.target.dataset.historyForm,
    text = event.target.querySelector('textarea').value.trim();
  const target = keywordHistory(query).find(item => item.id === id);
  // Пустой текст у существующей записи — удалить её текст (комментарий удаляется целиком).
  const ok =
    id === 'new'
      ? text
        ? await saveKeywordNote(query, { text })
        : true
      : !text
        ? target?.note || target?.type === 'comment'
          ? await saveKeywordNote(query, { eventId: id, remove: true })
          : true
        : await saveKeywordNote(query, { eventId: id, text });
  if (ok) {
    historyPop.editing = null;
    refreshHistory();
    refreshTagMenu(query);
  }
});
document.addEventListener('click', event => {
  if (!$('#keywordHistoryPop').hidden && !event.target.closest('#keywordHistoryPop')) hideHistory();
});
$('#tagColorsModal').addEventListener('click', event => {
  if (event.target.closest('[data-tag-colors-close]')) $('#tagColorsModal').hidden = true;
  if (event.target.closest('[data-tag-colors-reset]')) saveTagColors({});
  if (event.target.closest('[data-tag-colors-save]'))
    saveTagColors(
      Object.fromEntries(
        [...document.querySelectorAll('[data-tag-color]')]
          .filter(input => input.value.toLowerCase() !== KEYWORD_TAGS[input.dataset.tagColor].color.toLowerCase())
          .map(input => [input.dataset.tagColor, input.value])
      )
    );
});
document.addEventListener('click', event => {
  if (!$('#keywordTagMenu').hidden && !event.target.closest('#keywordTagMenu')) closeTagMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeTagMenu();
    hideHistory();
    $('#tagColorsModal').hidden = true;
  }
});
window.addEventListener(
  'scroll',
  event => {
    if (!$('#keywordTagMenu').contains(event.target)) followTagMenu();
    // История закрывается при прокрутке страницы, а если в ней пишут или она закреплена — едет за значком.
    if (!$('#keywordHistoryPop').hidden && !$('#keywordHistoryPop').contains(event.target)) {
      if (historyBusy()) placeHistory();
      else hideHistory();
    }
  },
  true
);
loadKeywordTags();
