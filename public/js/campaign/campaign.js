'use strict';
// --- Детализация кампании: автообновление и запуск страницы — подключается последним ---

// Автообновление: раз в 2 минуты, пока вкладка видна. Пропускается, пока идёт выгрузка или открыто окно, меню,
// заметки или поле ввода в них — чтобы ничего не закрылось и не сбилось под рукой.
const AUTO_REFRESH_MS = 2 * 60_000;
let autoRefreshAt = Date.now();
function autoRefreshBusy() {
  return (
    document.hidden ||
    exportState.running ||
    keywords.busy ||
    campaignNotes.open ||
    !$('#keywordTagMenu').hidden ||
    !$('#keywordHistoryPop').hidden ||
    [...document.querySelectorAll('.modal')].some(modal => !modal.hidden) ||
    Boolean(document.activeElement?.closest('textarea,.note-form'))
  );
}
setInterval(() => {
  if (Date.now() - autoRefreshAt < AUTO_REFRESH_MS || autoRefreshBusy()) return;
  autoRefreshAt = Date.now();
  exportHistory(true);
}, 10_000);
$('#exportHistory').addEventListener('click', () => {
  autoRefreshAt = Date.now();
});
function load() {
  const from = params.get('from') || '',
    to = params.get('to') || '',
    fromInput = $('#exportFrom'),
    toInput = $('#exportTo');
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to && from >= fromInput.min && to <= toInput.max) {
    fromInput.value = from;
    toInput.value = to;
    fromInput.onchange();
  }
  loadZones();
  exportHistory();
}
$('#dailyHead').addEventListener('click', event => {
  if (event.target.closest('.column-resizer')) return;
  const h = event.target.closest('th[data-key]');
  if (!h) return;
  const k = h.dataset.key;
  state.sort =
    state.sort.key === k ? { key: k, direction: state.sort.direction === 'asc' ? 'desc' : 'asc' } : { key: k, direction: 'desc' };
  renderTable();
});
$('#productHead').addEventListener('click', event => {
  if (event.target.closest('.column-resizer')) return;
  const h = event.target.closest('th[data-product-key]');
  if (!h) return;
  const k = h.dataset.productKey;
  state.productSort =
    state.productSort.key === k
      ? { key: k, direction: state.productSort.direction === 'asc' ? 'desc' : 'asc' }
      : { key: k, direction: 'desc' };
  renderProductTable();
});
['daily', 'product', 'keywords'].forEach(renderColumnsMenu);
renderDailyHead();
renderProductHead();
renderKeywordHead();
buildExportPresets();
$('#exportHistory').onclick = () => exportHistory();
document.querySelectorAll('[data-modal-close]').forEach(el => (el.onclick = closeProductModal));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeProductModal();
});
load();
