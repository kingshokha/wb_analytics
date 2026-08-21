(() => {
  'use strict';

  const FILTER_OPTIONS = '.multi-filter > div[id]';

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
    const labels = [...options.querySelectorAll('label')].filter((label) => !label.hidden);
    const checks = labels.map((label) => label.querySelector('input[type="checkbox"]')).filter(Boolean);
    selectAll.checked = checks.length > 0 && checks.every((input) => input.checked);
    selectAll.indeterminate = checks.some((input) => input.checked) && !selectAll.checked;
  }

  function enhanceFilter(filter) {
    const options = filter.querySelector(FILTER_OPTIONS);
    if (!options || filter.dataset.filterEnhanced === '1') return;
    filter.dataset.filterEnhanced = '1';

    const tools = document.createElement('div');
    tools.className = 'filter-tools';
    tools.innerHTML = `
      <input class="filter-search" type="search" placeholder="Поиск по пунктам" aria-label="Поиск по пунктам">
      <label class="filter-select-all"><input type="checkbox"> Выбрать все</label>
    `;
    filter.insertBefore(tools, options);

    const search = tools.querySelector('.filter-search');
    const selectAll = tools.querySelector('.filter-select-all input');
    search.addEventListener('input', () => {
      visibleLabels(options, search.value);
      syncSelectAll(filter);
    });
    selectAll.addEventListener('change', () => {
      [...options.querySelectorAll('label')]
        .filter((label) => !label.hidden)
        .map((label) => label.querySelector('input[type="checkbox"]'))
        .filter(Boolean)
        .forEach((input) => {
          input.checked = selectAll.checked;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      syncSelectAll(filter);
    });
    options.addEventListener('change', () => syncSelectAll(filter));
    syncSelectAll(filter);
  }

  function initFilters(root = document) {
    root.querySelectorAll('.multi-filter').forEach(enhanceFilter);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    new MutationObserver(() => initFilters()).observe(document.body, { childList: true, subtree: true });
  });
})();