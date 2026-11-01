// --- Ширина столбцов во всех таблицах сайта: одна реализация для главной, детализаций кампании и товара, карточки ---
// Потяните правый край заголовка — ширина запомнится в браузере. Хранится по столбцу: ключ data-col-key, а без него —
// название столбца. Поэтому ширина переживает скрытие и перестановку столбцов и смену набора в меню «Столбцы».
// Ширина по умолчанию — data-col-width; если её нет хотя бы у одного столбца и ничего не сохранено, до первого
// перетаскивания ширину подбирает браузер. Столбцы с одинаковым ключом (дни в «Продажах по дням») делят одну ширину.
// Ключ таблицы — data-width-key, иначе id её tbody. data-no-resize — таблица без изменения ширины.
// Заодно заголовок над значениями, выровненными влево (товар, кампания, запрос), получает класс col-left (tables.css).
(() => {
  'use strict';
  const PREFIX = 'wb-column-widths:', MIN_WIDTH = 48;
  const page = location.pathname.replace(/^\/+|\.html$/g, '') || 'index';
  const headerText = th => [...th.childNodes].filter(node => !(node.classList && node.classList.contains('column-resizer')))
    .map(node => node.textContent).join('').replace(/[↕↑↓]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  // Ключ столбца: data-col-key, иначе другой data-…-key заголовка (сортировка в детализации кампании), иначе название.
  const columnKey = (th, index) => th.dataset.colKey || Object.entries(th.dataset).find(([name]) => /Key$/.test(name))?.[1] || headerText(th) || `#${index}`;
  const readJson = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* не сохранится — не страшно */ } };
  function storageKey(table) {
    const id = table.dataset.widthKey || table.querySelector('tbody[id]')?.id || table.id || [...document.querySelectorAll('table')].indexOf(table);
    // Ключи главной страницы — как раньше, чтобы подобранные ширины сохранились; у остальных страниц — с именем страницы.
    return PREFIX + (page === 'index' ? id : `${page}:${id}`);
  }
  // Раньше часть таблиц хранила ширины списком по порядку столбцов, а детализация кампании — под своим ключом.
  // Если число столбцов совпадает, список один раз переводится в ширины по столбцам.
  function savedWidths(table, key, keys) {
    const saved = readJson(key);
    if (saved && !Array.isArray(saved)) return saved;
    const legacy = Array.isArray(saved) ? saved : page === 'campaign' ? readJson(`wb-campaign-column-widths:${table.querySelector('tbody[id]')?.id}`) : null;
    const result = {};
    if (Array.isArray(legacy) && legacy.length === keys.length && legacy.every(Number.isFinite)) keys.forEach((k, i) => { result[k] = legacy[i]; });
    if (Object.keys(result).length) writeJson(key, result);
    return result;
  }
  function fix(table, headers, widths) {
    headers.forEach((th, i) => { th.style.width = `${widths[i]}px`; });
    const total = widths.reduce((sum, width) => sum + width, 0);
    table.style.width = `${total}px`; table.style.minWidth = `${total}px`; table.style.tableLayout = 'fixed';
  }
  function handle(table, headers, keys, index, key) {
    const grip = document.createElement('span');
    grip.className = 'column-resizer'; grip.title = 'Потяните, чтобы изменить ширину'; grip.setAttribute('aria-hidden', 'true');
    grip.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const widths = headers.map(th => Math.round(th.getBoundingClientRect().width));
      if (!widths[index]) return;
      fix(table, headers, widths);
      const startX = event.clientX, startWidth = widths[index], startTotal = widths.reduce((sum, width) => sum + width, 0);
      document.body.classList.add('resizing-column');
      const move = moveEvent => {
        const width = Math.max(MIN_WIDTH, Math.round(startWidth + moveEvent.clientX - startX)), delta = width - startWidth;
        headers[index].style.width = `${width}px`; table.style.width = `${startTotal + delta}px`; table.style.minWidth = `${startTotal + delta}px`;
      };
      const stop = () => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', stop); document.removeEventListener('pointercancel', stop);
        document.body.classList.remove('resizing-column');
        const saved = readJson(key), map = saved && !Array.isArray(saved) ? saved : {};
        headers.forEach((th, i) => { map[keys[i]] = Math.round(th.getBoundingClientRect().width); });
        map[keys[index]] = Math.round(headers[index].getBoundingClientRect().width);
        writeJson(key, map);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', stop);
      document.addEventListener('pointercancel', stop);
    });
    return grip;
  }
  function setup(table) {
    if (table.closest('[data-no-resize]')) return;
    const headers = [...table.querySelectorAll('thead th')];
    if (!headers.length) return;
    const keys = headers.map(columnKey), signature = keys.join('|');
    // Заголовки перерисовали (другой набор столбцов или те же, но новые элементы) — ширины применяются заново.
    if (table.dataset.colWidths === signature && headers.every(th => th.querySelector(':scope > .column-resizer'))) return;
    table.dataset.colWidths = signature; table.classList.add('resizable-table');
    const key = storageKey(table), saved = savedWidths(table, key, keys);
    const widths = headers.map((th, i) => Number(saved[keys[i]]) || Number(th.dataset.colWidth) || 0);
    if (widths.every(width => width > 0)) fix(table, headers, widths);
    else { table.style.width = ''; table.style.minWidth = ''; table.style.tableLayout = ''; headers.forEach(th => { th.style.width = ''; }); }
    headers.forEach((th, i) => { if (!th.querySelector(':scope > .column-resizer')) th.append(handle(table, headers, keys, i, key)); });
  }
  function alignHeaders(table) {
    const headers = [...table.querySelectorAll('thead th')], row = table.tBodies[0]?.rows[0];
    if (!row || row.cells.length !== headers.length) return;
    headers.forEach((th, i) => { if (i) th.classList.toggle('col-left', getComputedStyle(row.cells[i]).textAlign === 'left'); });
  }
  function init(root = document) {
    (root.matches?.('table') ? [root] : [...root.querySelectorAll('table')]).forEach(table => { setup(table); alignHeaders(table); });
  }
  // Изменения страницы собираются до следующего кадра: обрабатываются только таблицы, в которых что-то поменялось.
  const pending = new Set();
  let frame = 0;
  function schedule(records) {
    for (const record of records) {
      const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const table = node && node.closest('table');
      if (table) pending.add(table);
      else record.addedNodes.forEach(added => { if (added.nodeType === 1) (added.matches('table') ? [added] : added.querySelectorAll('table')).forEach(item => pending.add(item)); });
    }
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; pending.forEach(table => { if (table.isConnected) init(table); }); pending.clear(); });
  }
  window.initColumnWidths = init;
  const start = () => { init(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
