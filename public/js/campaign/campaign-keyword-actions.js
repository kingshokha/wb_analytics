'use strict';

// --- Исключение и включение выбранных запросов: галочки слева, нижняя панель действий, подтверждение ---
// Сервер читает текущие минус-фразы каждого товара, добавляет или убирает выбранные запросы и перепроверяет результат.
function selectedKeywordRows() {
  const rows = keywordView().rows;
  return rows.filter(row => keywords.selected.has(row.query));
}
function renderKeywordActions() {
  const bar = $('#keywordActions'),
    all = $('#keywordSelectAll'),
    selected = keywordsCpc() ? [] : selectedKeywordRows();
  bar.hidden = !selected.length;
  $('#keywordSelectedCount').textContent = `Выбрано: ${number(selected.length)}`;
  $('#keywordExclude').disabled = keywords.busy || !selected.some(row => row.status !== 'excluded');
  $('#keywordInclude').disabled = keywords.busy || !selected.some(row => row.status === 'excluded');
  const shownSelected = keywords.shown.filter(row => keywords.selected.has(row.query)).length;
  all.checked = keywords.shown.length > 0 && shownSelected === keywords.shown.length;
  all.indeterminate = shownSelected > 0 && shownSelected < keywords.shown.length;
}
function keywordMessage(text, kind = 'ok') {
  const box = $('#keywordMessage');
  box.className = `keyword-message ${kind}`;
  box.textContent = text;
}
function closeConfirm() {
  $('#confirmModal').hidden = true;
}
function openKeywordConfirm(action) {
  if (keywordsCpc()) return;
  const exclude = action === 'exclude',
    rows = selectedKeywordRows().filter(row => (exclude ? row.status !== 'excluded' : row.status === 'excluded'));
  if (!rows.length) return;
  const product = (keywords.data?.products || []).find(item => String(item.nmId) === keywords.product);
  const scope = product
    ? `только для артикула ${esc(product.vendorCode || product.name)} · ${esc(product.nmId)}`
    : 'для всех артикулов кампании, у которых есть эти запросы';
  const list =
    rows
      .slice(0, 15)
      .map(row => `<li>${esc(row.query)}${row.spend ? ` — ${esc(money(row.spend))}` : ''}</li>`)
      .join('') + (rows.length > 15 ? `<li>и ещё ${number(rows.length - 15)}</li>` : '');
  $('#confirmTitle').textContent = exclude
    ? `Исключить ${number(rows.length)} ${plural(rows.length, ['запрос', 'запроса', 'запросов'])}?`
    : `Включить ${number(rows.length)} ${plural(rows.length, ['запрос', 'запроса', 'запросов'])}?`;
  $('#confirmBody').innerHTML =
    `<p>${exclude ? 'Запросы будут добавлены в минус-фразы кампании в WB: товар перестанет показываться по ним' : 'Запросы будут убраны из минус-фраз кампании в WB: товар снова начнёт показываться по ним'} ${scope}.</p><ul>${list}</ul>` +
    `<small>Остальные минус-фразы не изменятся. Изменение сразу применяется в кабинете WB; отменить его можно здесь же${exclude ? ' кнопкой «Включить»' : ' кнопкой «Исключить»'}.</small>` +
    `<div class="confirm-buttons"><button type="button" class="secondary" data-confirm-close>Отмена</button><button type="button" class="${exclude ? 'danger' : 'include'}" id="confirmRun">${exclude ? 'Исключить' : 'Включить'}</button></div>`;
  $('#confirmModal').hidden = false;
  $('#confirmRun').onclick = () =>
    runKeywordMinus(
      action,
      rows.map(row => row.query)
    );
}
async function runKeywordMinus(action, queries) {
  const button = $('#confirmRun');
  button.disabled = true;
  button.textContent = 'Отправляем в WB…';
  keywords.busy = true;
  renderKeywordActions();
  try {
    const response = await fetch('/api/advertising/campaign/minus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cabinet: params.get('cabinet') || 'demo',
        id: params.get('id') || '',
        action,
        queries,
        nmIds: keywords.product ? [keywords.product] : []
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'WB не принял изменение');
    const failed = result.results.filter(item => !item.ok),
      changed = result.results.filter(item => item.ok && item.changed);
    const verb = action === 'exclude' ? 'Исключено' : 'Включено';
    // Пояснения сервера: какие запросы в архиве WB пропущены и какие архивные кластеры убраны из минус-фраз.
    const notes = result.results
      .filter(item => item.ok && item.note)
      .map(item => `${item.nmId}: ${item.note}`)
      .join('; ');
    keywordMessage(
      (failed.length
        ? `${verb} для ${number(changed.length)} из ${number(result.results.length)} артикулов. Не получилось: ${failed.map(item => `${item.nmId} — ${item.error}`).join('; ')}`
        : changed.length
          ? `${verb} ${number(queries.length)} ${plural(queries.length, ['запрос', 'запроса', 'запросов'])} для ${number(changed.length)} ${plural(changed.length, ['артикула', 'артикулов', 'артикулов'])}. Статусы обновляются…`
          : 'Изменений не потребовалось: запросы уже в нужном состоянии') + (notes ? ` Примечание — ${notes}` : ''),
      failed.length ? 'error' : 'ok'
    );
    closeConfirm();
    keywords.selected.clear();
    loadKeywords(keywords.data?.period || state.period, true);
  } catch (e) {
    keywordMessage(`Не удалось: ${e.message}`, 'error');
    closeConfirm();
  } finally {
    keywords.busy = false;
    renderKeywordActions();
  }
}
$('#keywordsBody').addEventListener('change', event => {
  const box = event.target.closest('[data-keyword-select]');
  if (!box) return;
  box.checked ? keywords.selected.add(box.dataset.keywordSelect) : keywords.selected.delete(box.dataset.keywordSelect);
  box.closest('tr').classList.toggle('keyword-selected', box.checked);
  renderKeywordActions();
});
$('#keywordSelectAll').onchange = event => {
  keywords.shown.forEach(row => (event.target.checked ? keywords.selected.add(row.query) : keywords.selected.delete(row.query)));
  renderKeywords();
};
$('#keywordExclude').onclick = () => openKeywordConfirm('exclude');
$('#keywordInclude').onclick = () => openKeywordConfirm('include');
$('#keywordClearSelection').onclick = () => {
  keywords.selected.clear();
  renderKeywords();
};
document.addEventListener('click', event => {
  if (event.target.closest('[data-confirm-close]')) closeConfirm();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#confirmModal').hidden) closeConfirm();
});
