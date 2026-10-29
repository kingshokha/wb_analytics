// --- Пагинация таблиц — одна на весь сайт ---
// Одна строка: «Назад 1 … 5 6 [7] 8 9 … 181 Вперёд», поле «Страница N из M» (Enter — перейти) и выбор
// «Показывать по 25 / 50 / 100 / 200». По умолчанию — 100 строк. Выбранное число строк запоминается в браузере
// для каждой таблицы отдельно (ключ wb-page-size:<таблица>). На телефоне соседних страниц — по одной с каждой стороны.
// renderPager(контейнер, { page, pageCount, total, sizeKey, onPage(page), onSize(size) }) рисует и сам вешает обработчики.
// Подключается раньше остальных скриптов: pageSizeFor() нужен им при запуске.
const PAGE_SIZES = [25, 50, 100, 200];
const PAGE_SIZE_DEFAULT = 100;
function pageSizeFor(key) {
  try { const saved = Number(localStorage.getItem(`wb-page-size:${key}`)); return PAGE_SIZES.includes(saved) ? saved : PAGE_SIZE_DEFAULT; }
  catch { return PAGE_SIZE_DEFAULT; }
}
function savePageSize(key, size) { try { localStorage.setItem(`wb-page-size:${key}`, String(size)); } catch { /* без памяти — до перезагрузки */ } }
// Номера страниц: первая, последняя и соседние с текущей; пропуск в одну страницу показываем числом, а не «…».
function pagerPages(page, count, around) {
  const set = new Set([1, count]);
  for (let value = page - around; value <= page + around; value++) if (value >= 1 && value <= count) set.add(value);
  const list = [...set].sort((a, b) => a - b), result = [];
  list.forEach((value, index) => {
    const gap = index ? value - list[index - 1] : 0;
    if (gap === 2) result.push(value - 1); else if (gap > 2) result.push('…');
    result.push(value);
  });
  return result;
}
function renderPager(el, { page, pageCount, total = 0, sizeKey = '', onPage, onSize }) {
  if (!el) return;
  // Одна страница и строк не больше самого маленького размера — пагинация не нужна совсем.
  if (pageCount <= 1 && (!sizeKey || total <= PAGE_SIZES[0])) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const around = window.innerWidth < 680 ? 1 : 2, size = sizeKey ? pageSizeFor(sizeKey) : 0;
  const pages = pageCount > 1 ? `<button type="button" class="stock-page-button" data-pager="prev" ${page <= 1 ? 'disabled' : ''}>Назад</button><div class="stock-page-numbers">${pagerPages(page, pageCount, around).map(value => value === '…'
    ? '<span class="pager-gap" aria-hidden="true">…</span>'
    : `<button type="button" class="stock-page-button ${value === page ? 'active' : ''}" data-pager="${value}" aria-current="${value === page ? 'page' : 'false'}">${value}</button>`).join('')}</div><button type="button" class="stock-page-button" data-pager="next" ${page >= pageCount ? 'disabled' : ''}>Вперёд</button>`
    + (pageCount > 7 ? `<label class="pager-goto">Страница <input type="number" min="1" max="${pageCount}" value="${page}" aria-label="Номер страницы"> из ${pageCount}</label>` : '') : '';
  const sizes = sizeKey ? `<label class="pager-size">Показывать по <select aria-label="Строк на странице">${PAGE_SIZES.map(value => `<option value="${value}"${value === size ? ' selected' : ''}>${value}</option>`).join('')}</select></label>` : '';
  el.innerHTML = `<div class="pager">${pages}${sizes}</div>`;
  const go = target => { const value = Math.round(Number(target)); if (Number.isInteger(value) && value >= 1 && value <= pageCount && value !== page) onPage?.(value); };
  el.querySelectorAll('[data-pager]').forEach(button => { button.onclick = () => { const target = button.dataset.pager; go(target === 'prev' ? page - 1 : target === 'next' ? page + 1 : target); }; });
  const input = el.querySelector('.pager-goto input');
  if (input) input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); go(input.value); } };
  const select = el.querySelector('.pager-size select');
  if (select) select.onchange = () => { const value = Number(select.value); savePageSize(sizeKey, value); onSize?.(value); };
}
