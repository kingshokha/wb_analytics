(() => {
  'use strict';

  const FILTER_OPTIONS = '.multi-filter > div[id]';
  const NON_TEXT_COLUMNS = /^(?:дата|date|сумма|цена|скидка|остаток|показы|клики|ctr|cpc|заказы|выкупы|ддр|roas|status|статус|id|sku|шт|руб|%)/i;

  function visibleLabels(options, query) {
    const normalized = query.trim().toLocaleLowerCase('ru-RU');
    return [...options.querySelectorAll('label')].filter((label) => {
      const visible = !normalized || label.textContent.toLocaleLowerCase('ru-RU').includes(normalized);
      label.hidden = !visible;
      return visible;
    });
  }

  function syncSelectAll(filter) {
    const options = filter.querySelector(FILTER_OPTIONS);
    const selectAll = filter.querySelector('.filter-select-all');
    if (!options || !selectAll) return;
    const checks = [...options.querySelectorAll('label')]
      .filter((label) => !label.hidden)
      .map((label) => label.querySelector('input[type="checkbox"]'))
      .filter(Boolean);
    selectAll.checked = checks.length > 0 && checks.every((input) => input.checked);
    selectAll.indeterminate = checks.some((input) => input.checked) && !selectAll.checked;
  }

  function enhanceFilter(filter) {
    const options = filter.querySelector(FILTER_OPTIONS);
    if (!options || filter.dataset.filterEnhanced === '1') return;
    filter.dataset.filterEnhanced = '1';
    const tools = document.createElement('div');
    tools.className = 'filter-tools';
    tools.innerHTML = '<input class="filter-search" type="search" placeholder="Поиск по пунктам" aria-label="Поиск по пунктам"><label class="filter-select-all"><input type="checkbox"> Выбрать все</label>';
    filter.insertBefore(tools, options);
    const search = tools.querySelector('.filter-search');
    const selectAll = tools.querySelector('.filter-select-all input');
    search.addEventListener('input', () => { visibleLabels(options, search.value); syncSelectAll(filter); });
    selectAll.addEventListener('change', () => {
      [...options.querySelectorAll('label')]
        .filter((label) => !label.hidden)
        .map((label) => label.querySelector('input[type="checkbox"]'))
        .filter(Boolean)
        .forEach((input) => { input.checked = selectAll.checked; input.dispatchEvent(new Event('change', { bubbles: true })); });
      syncSelectAll(filter);
    });
    options.addEventListener('change', () => syncSelectAll(filter));
    syncSelectAll(filter);
  }

  function textTarget(cell) {
    if (cell.querySelector('button, input, svg, [role="button"]')) return null;
    return cell.querySelector('.ad-product-name > span, .product > span, strong') || cell;
  }

  // Ячейка только размечается классами. Обрезан ли текст, проверяется при наведении (см. showFullText):
  // замер ширины в каждой ячейке сразу после смены классов заставлял браузер пересчитывать раскладку тысячи раз,
  // и сортировка таблицы на 300+ строк занимала секунды.
  function decorateCell(cell, headerText) {
    if (!cell || NON_TEXT_COLUMNS.test(headerText.trim())) return;
    const target = textTarget(cell);
    if (!target || !target.textContent.trim()) return;
    target.classList.add('table-cell');
    if (target !== cell) target.classList.add('truncate-content');
  }

  function decorateTable(table) {
    const headers = [...table.querySelectorAll('thead th')].map((header) => header.textContent);
    table.querySelectorAll('tbody tr').forEach((row) => {
      [...row.cells].forEach((cell, index) => decorateCell(cell, headers[index] || ''));
    });
  }

  function initTruncation(root = document) {
    root.querySelectorAll('table').forEach(decorateTable);
  }

  // Подсказка с полным текстом ставится только на обрезанную ячейку под курсором; свои title ячеек не трогаются.
  function showFullText(event) {
    const target = event.target.closest && event.target.closest('.table-cell');
    if (!target || (target.title && !target.dataset.truncateTitle)) return;
    const fullText = (target.innerText || target.textContent).trim();
    if (fullText && target.scrollWidth > target.clientWidth) {
      target.title = fullText;
      target.setAttribute('aria-label', fullText);
      target.dataset.truncateTitle = '1';
    } else if (target.dataset.truncateTitle) {
      target.removeAttribute('title');
      target.removeAttribute('aria-label');
      delete target.dataset.truncateTitle;
    }
  }

  // Изменения страницы собираются до следующего кадра: размечаются только таблицы, в которых что-то поменялось.
  const pendingTables = new Set();
  let pendingFrame = 0;
  function scheduleTables(records) {
    for (const record of records) {
      const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const table = node && node.closest('table');
      if (table) pendingTables.add(table);
      else if (node) record.addedNodes.forEach((added) => { if (added.nodeType === 1) (added.matches('table') ? [added] : added.querySelectorAll('table')).forEach((item) => pendingTables.add(item)); });
    }
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      initFilters();
      pendingTables.forEach((table) => { if (table.isConnected) decorateTable(table); });
      pendingTables.clear();
    });
  }

  function initFilters(root = document) {
    root.querySelectorAll('.multi-filter').forEach(enhanceFilter);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    initTruncation();
    document.addEventListener('mouseover', showFullText);
    new MutationObserver(scheduleTables).observe(document.body, { childList: true, subtree: true });
  });
})();