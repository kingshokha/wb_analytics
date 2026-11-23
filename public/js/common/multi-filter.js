// --- Общий фильтр с галочками: «Категории», «Склады», «Артикулы», статусы и т. п. ---
// Внешне — выпадающее меню <details class="multi-filter mf">: заголовок со счётчиком («Категории (3)»), список с
// галочками, поиск (сам появляется, когда вариантов больше MULTI_FILTER_SEARCH_FROM), «Выбрать все» / «Выбрать
// найденные», внизу «Выбрано: N» и «Сбросить». Варианты можно сгруппировать: галочка группы отмечает всё внутри.
// Режим single — выбор одного варианта (кружки вместо галочек, меню закрывается после выбора).
//
// Подключение: const filter = multiFilter('#priceCategoryFilter', { label: 'Категории', selected: () => набор, onChange });
//   selected — Set выбранных значений или функция, которая его возвращает (компонент меняет этот же Set: так раздел
//   отбирает строки своим кодом, как раньше); в single — функция, возвращающая значение, и onChange(value).
//   filter.setItems([{ value, label, hint, count, title, group }]) — варианты; group — подпись группы.
//   filter.refresh() — перерисовать отметки и заголовок после изменения выбора снаружи.
// Пустое значение ('') в single — «все» (allLabel).
const MULTI_FILTER_SEARCH_FROM = 9;
const MULTI_FILTER_SHOWN = 300;

function multiFilter(target, options) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return null;
  const single = Boolean(options.single);
  const selectedSet = () => (typeof options.selected === 'function' ? options.selected() : options.selected) || new Set();
  const singleValue = () => String((typeof options.selected === 'function' ? options.selected() : options.selected) ?? '');
  const html = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const view = { items: [], signature: '', term: '' };
  root.classList.add('multi-filter', 'mf');
  if (single) root.classList.add('mf-single');
  root.innerHTML =
    `<summary></summary><div class="mf-panel"><label class="mf-search hidden"><input type="search" placeholder="${html(options.placeholder || 'Поиск')}" autocomplete="off" aria-label="Поиск"><span aria-hidden="true">⌕</span></label>` +
    `<label class="mf-all hidden"><input type="checkbox"><span></span></label><div class="mf-options"></div>` +
    `<div class="mf-actions${single ? ' hidden' : ''}"><span></span><button type="button">Сбросить</button></div></div>`;
  const summary = root.querySelector('summary'),
    search = root.querySelector('.mf-search input'),
    all = root.querySelector('.mf-all input'),
    box = root.querySelector('.mf-options'),
    actions = root.querySelector('.mf-actions');

  const searchable = () => options.search === true || (options.search !== false && view.items.length >= MULTI_FILTER_SEARCH_FROM);
  const matches = () => {
    const term = view.term.trim().toLocaleLowerCase('ru-RU');
    if (!term) return view.items;
    return view.items.filter(item => [item.label, item.hint, item.value, item.group].join(' ').toLocaleLowerCase('ru-RU').includes(term));
  };
  const isChecked = value => (single ? singleValue() === String(value) : selectedSet().has(String(value)));
  const optionHtml = item =>
    `<label class="mf-option" title="${html(item.title || [item.label, item.hint].filter(Boolean).join(' · '))}"><input type="${single ? 'radio' : 'checkbox'}" value="${html(item.value)}"${isChecked(item.value) ? ' checked' : ''}>` +
    `<span><b>${html(item.label)}</b>${item.hint ? `<small>${html(item.hint)}</small>` : ''}</span>${item.count != null ? `<em>${html(item.count)}</em>` : ''}</label>`;

  function renderSummary() {
    if (single) {
      const value = singleValue(),
        item = view.items.find(entry => String(entry.value) === value);
      summary.textContent = item ? (options.prefix ? `${options.prefix}: ${item.label}` : item.label) : options.allLabel || options.label;
      root.classList.toggle('mf-active', Boolean(value));
      return;
    }
    const size = selectedSet().size;
    summary.textContent = size ? `${options.label} (${size})` : options.label;
    root.classList.toggle('mf-active', size > 0);
    actions.querySelector('span').textContent = size ? `Выбрано: ${size}` : options.allText || 'Ничего не выбрано — показаны все';
    actions.querySelector('button').disabled = !size;
  }
  function renderAll(found) {
    const show = !single && found.length > 1;
    root.querySelector('.mf-all').classList.toggle('hidden', !show);
    if (!show) return;
    const picked = found.filter(item => isChecked(item.value)).length;
    all.checked = picked === found.length;
    all.indeterminate = picked > 0 && picked < found.length;
    root.querySelector('.mf-all span').textContent = view.term.trim() ? `Выбрать найденные (${found.length})` : 'Выбрать все';
  }
  function renderList() {
    root.querySelector('.mf-search').classList.toggle('hidden', !searchable());
    root.classList.toggle('mf-wide', searchable() || view.items.some(item => item.hint));
    const found = matches(),
      shown = found.slice(0, MULTI_FILTER_SHOWN);
    let lastGroup = null,
      out = '';
    if (single && options.allLabel)
      out += `<label class="mf-option"><input type="radio" value=""${singleValue() === '' ? ' checked' : ''}><span><b>${html(options.allLabel)}</b></span></label>`;
    for (const item of shown) {
      if (item.group && item.group !== lastGroup) {
        const members = view.items.filter(entry => entry.group === item.group),
          picked = members.filter(entry => isChecked(entry.value)).length;
        out +=
          `<label class="mf-option mf-group-head"><input type="checkbox" data-mf-group="${html(item.group)}"${picked === members.length ? ' checked' : ''}${picked > 0 && picked < members.length ? ' data-mf-partial="1"' : ''}>` +
          `<span><b>${html(item.group)}</b></span></label>`;
      }
      lastGroup = item.group || null;
      out += item.group ? optionHtml(item).replace('class="mf-option"', 'class="mf-option mf-in-group"') : optionHtml(item);
    }
    if (!found.length)
      out = `<span class="filter-empty">${view.items.length ? 'Ничего не найдено' : options.empty || 'Нет вариантов'}</span>`;
    else if (found.length > shown.length)
      out += `<span class="filter-empty">Показаны первые ${MULTI_FILTER_SHOWN} из ${found.length} — уточните поиск</span>`;
    // Прокрутка списка сохраняется: после отметки галочки раздел перерисовывается, и список не должен прыгать наверх.
    const scroll = box.scrollTop;
    box.innerHTML = out;
    box.scrollTop = scroll;
    box.querySelectorAll('[data-mf-partial]').forEach(input => (input.indeterminate = true));
    renderAll(found);
    renderSummary();
  }
  // Отметки обновляются на месте, без перерисовки списка.
  function changed(value) {
    api.refresh();
    options.onChange?.(single ? value : selectedSet());
  }

  box.addEventListener('change', event => {
    const input = event.target;
    if (single) {
      root.removeAttribute('open');
      return changed(input.value);
    }
    const set = selectedSet();
    const values = input.dataset.mfGroup
      ? view.items.filter(item => item.group === input.dataset.mfGroup).map(item => String(item.value))
      : [input.value];
    values.forEach(value => (input.checked ? set.add(value) : set.delete(value)));
    changed();
  });
  all.addEventListener('change', () => {
    const set = selectedSet();
    matches().forEach(item => (all.checked ? set.add(String(item.value)) : set.delete(String(item.value))));
    changed();
  });
  actions.querySelector('button').addEventListener('click', () => {
    selectedSet().clear();
    changed();
  });
  search.addEventListener('input', () => {
    view.term = search.value;
    renderList();
  });
  root.addEventListener('toggle', () => {
    if (root.open && searchable()) setTimeout(() => search.focus(), 0);
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      root.removeAttribute('open');
      summary.focus();
    }
  });

  const api = {
    root,
    // Варианты перерисовываются, только если изменились: иначе отметка галочки не сбрасывала бы прокрутку списка.
    setItems(items) {
      view.items = (items || []).map(item => (typeof item === 'object' ? item : { value: item, label: item }));
      view.items.forEach(item => (item.value = String(item.value)));
      const signature = JSON.stringify(view.items.map(item => [item.value, item.label, item.hint, item.count, item.group]));
      if (signature === view.signature) return api.refresh();
      view.signature = signature;
      renderList();
      return api;
    },
    refresh() {
      box.querySelectorAll('input[value]').forEach(input => (input.checked = isChecked(input.value)));
      box.querySelectorAll('[data-mf-group]').forEach(input => {
        const members = view.items.filter(item => item.group === input.dataset.mfGroup),
          picked = members.filter(item => isChecked(item.value)).length;
        input.checked = picked === members.length;
        input.indeterminate = picked > 0 && picked < members.length;
      });
      renderAll(matches());
      renderSummary();
      return api;
    }
  };
  renderList();
  return api;
}

// Варианты фильтра «Артикулы»: [{ nmId, vendorCode, title }] → артикул продавца крупно, ниже — артикул WB и название;
// поиск — по всем трём. Повторы nmId убираются.
function articleFilterItems(list) {
  const seen = new Set();
  return (list || [])
    .filter(item => item?.nmId && !seen.has(String(item.nmId)) && seen.add(String(item.nmId)))
    .map(item => ({
      value: String(item.nmId),
      label: item.vendorCode || item.title || 'Без артикула',
      hint: [item.nmId, item.vendorCode ? item.title : ''].filter(Boolean).join(' · ')
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }));
}

// Меню закрывается щелчком мимо него — и на страницах без общего обработчика главной страницы.
document.addEventListener('click', event => {
  document.querySelectorAll('.mf[open]').forEach(filter => {
    if (!filter.contains(event.target)) filter.removeAttribute('open');
  });
});
