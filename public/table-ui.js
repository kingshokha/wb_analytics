(() => {
  'use strict';

  const FILTER_OPTIONS = '.multi-filter > div[id]';
  const NON_TEXT_COLUMNS = /^(?:дата|date|сумма|цена|скидка|остаток|показы|клики|ctr|cpc|заказы|выкупы|ддр|roas|status|статус|id|sku|шт|руб|%)/i;
  const observedTables = new WeakSet();

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
    if (cell.querySelector('button, input, img, svg, [role="button"]')) return null;
    return cell.querySelector('.ad-product-name > span, .product > span, strong') || cell;
  }

  function decorateCell(cell, headerText) {
    if (!cell || NON_TEXT_COLUMNS.test(headerText.trim())) return;
    const target = textTarget(cell);
    if (!target) return;
    const fullText = target.textContent.trim();
    if (!fullText) return;
    target.classList.add('table-cell');
    if (target !== cell) target.classList.add('truncate-content');
    const overflowing = target.scrollWidth > target.clientWidth;
    if (overflowing) {
      target.title = fullText;
      target.setAttribute('aria-label', fullText);
    } else {
      target.removeAttribute('title');
      target.removeAttribute('aria-label');
    }
  }

  function initTruncation(root = document) {
    root.querySelectorAll('table').forEach((table) => {
      const headers = [...table.querySelectorAll('thead th')].map((header) => header.textContent);
      table.querySelectorAll('tbody tr').forEach((row) => {
        [...row.cells].forEach((cell, index) => decorateCell(cell, headers[index] || ''));
      });
      if (!observedTables.has(table) && typeof ResizeObserver === 'function') {
        observedTables.add(table);
        new ResizeObserver(() => initTruncation(table)).observe(table);
      }
    });
  }

  function initFilters(root = document) {
    root.querySelectorAll('.multi-filter').forEach(enhanceFilter);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    initTruncation();
    new MutationObserver(() => { initFilters(); initTruncation(); }).observe(document.body, { childList: true, subtree: true });
  });
})();