// Календарь выбора периода в духе Range Calendar из shadcn/ui: два месяца рядом, первый клик — начало, второй — конец.
// Подключается к блокам [data-date-range] с двумя полями <input type="date">. Поля остаются в разметке скрытыми и хранят
// значения, поэтому код страниц читает и меняет их .value как раньше; после выбора периода на полях срабатывает change.
(() => {
  'use strict';
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2.5"/><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4"/></svg>';
  const CHEVRON = direction => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${direction < 0 ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'}"/></svg>`;
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const pad = value => String(value).padStart(2, '0');
  // Даты — полночь UTC в миллисекундах: так часовой пояс браузера не сдвигает день.
  const parse = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)) : null;
  const iso = time => new Date(time).toISOString().slice(0, 10);
  const text = time => { const date = new Date(time); return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`; };
  const monthStart = time => { const date = new Date(time); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1); };
  const addMonths = (time, count) => { const date = new Date(time); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1); };
  // «Сегодня» — по Москве (UTC+3), как во всём сайте.
  const today = () => { const date = new Date(Date.now() + 3 * 3_600_000); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); };
  const daysText = count => `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'день' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'дня' : 'дней'}`;
  let active = null;

  function enhance(group) {
    const [fromInput, toInput] = group.querySelectorAll('input[type="date"]');
    if (!fromInput || !toInput || group.dataset.dateRangeReady) return;
    group.dataset.dateRangeReady = '1';
    group.classList.add('drp');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'drp-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    group.append(trigger);
    const pop = document.createElement('div');
    pop.className = 'drp-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Выбор периода');
    pop.hidden = true;
    document.body.append(pop);
    // month — первый день левого месяца; hover — день под курсором, пока выбран только конец периода.
    const view = { month: 0, from: null, to: null, hover: null };
    const limits = () => ({ min: parse(fromInput.min) ?? parse(toInput.min), max: parse(toInput.max) ?? parse(fromInput.max) });
    const monthsCount = () => window.innerWidth >= 640 ? 2 : 1;

    function refresh() {
      const from = parse(fromInput.value), to = parse(toInput.value);
      trigger.innerHTML = `${ICON}<strong>${from != null ? text(from) : 'дд.мм.гггг'} — ${to != null ? text(to) : 'дд.мм.гггг'}</strong>`;
      trigger.setAttribute('aria-label', `Период: ${from != null ? text(from) : 'не выбран'} — ${to != null ? text(to) : 'не выбран'}`);
      trigger.disabled = fromInput.disabled || toInput.disabled;
      if (trigger.disabled && active === controller) close();
    }
    // Значения полей меняет и код страниц (пресеты периода, выбор месяца) — подпись кнопки обновляется вместе с ними.
    for (const input of [fromInput, toInput]) {
      Object.defineProperty(input, 'value', { configurable: true, get() { return valueDescriptor.get.call(this); }, set(value) { valueDescriptor.set.call(this, value); refresh(); } });
      new MutationObserver(refresh).observe(input, { attributes: true, attributeFilter: ['disabled', 'min', 'max'] });
    }

    function render() {
      const count = monthsCount(), { min, max } = limits(), now = today();
      let months = '';
      for (let index = 0; index < count; index++) {
        const first = new Date(addMonths(view.month, index)), year = first.getUTCFullYear(), month = first.getUTCMonth();
        const offset = (first.getUTCDay() + 6) % 7, length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        let cells = WEEKDAYS.map(day => `<span class="drp-weekday">${day}</span>`).join('') + '<span></span>'.repeat(offset);
        for (let day = 1; day <= length; day++) {
          const time = Date.UTC(year, month, day), column = (offset + day - 1) % 7;
          const classes = ['drp-day', time === now ? 'today' : '', column === 0 || day === 1 ? 'row-start' : '', column === 6 || day === length ? 'row-end' : ''].filter(Boolean).join(' ');
          const disabled = (min != null && time < min) || (max != null && time > max);
          cells += `<button type="button" class="${classes}" data-day="${time}" aria-label="${text(time)}"${disabled ? ' disabled' : ''}>${day}</button>`;
        }
        months += `<div class="drp-month"><div class="drp-caption">${MONTHS[month]} ${year}</div><div class="drp-grid">${cells}</div></div>`;
      }
      const prevDisabled = min != null && view.month <= monthStart(min), nextDisabled = max != null && addMonths(view.month, count - 1) >= monthStart(max);
      pop.innerHTML = `<button type="button" class="drp-nav prev" data-nav="-1" aria-label="Предыдущий месяц"${prevDisabled ? ' disabled' : ''}>${CHEVRON(-1)}</button>` +
        `<button type="button" class="drp-nav next" data-nav="1" aria-label="Следующий месяц"${nextDisabled ? ' disabled' : ''}>${CHEVRON(1)}</button>` +
        `<div class="drp-months">${months}</div><div class="drp-foot"></div>`;
      paint();
    }
    // Подсветка периода без перерисовки сетки: при выборе конца период тянется за курсором.
    function paint() {
      const end = view.to ?? (view.from != null ? view.hover : null);
      const low = view.from == null ? null : end == null ? view.from : Math.min(view.from, end), high = view.from == null ? null : end == null ? view.from : Math.max(view.from, end);
      pop.querySelectorAll('.drp-day').forEach(button => {
        const time = Number(button.dataset.day);
        button.classList.toggle('start', time === low);
        button.classList.toggle('end', time === high);
        button.classList.toggle('in-range', low != null && time > low && time < high);
        button.setAttribute('aria-pressed', String(low != null && time >= low && time <= high));
      });
      const foot = pop.querySelector('.drp-foot');
      if (foot) foot.innerHTML = view.from != null && view.to == null
        ? `<span>Начало: <b>${text(view.from)}</b></span><span>Выберите дату конца</span>`
        : low != null ? `<span><b>${text(low)} — ${text(high)}</b></span><span>${daysText(Math.round((high - low) / 86_400_000) + 1)}</span>` : '<span>Выберите дату начала</span>';
    }
    function place() {
      // Под блоком дат от его левого края; если не помещается — по правому краю блока (ширина окна — без полосы прокрутки).
      const rect = group.getBoundingClientRect(), width = pop.offsetWidth, height = pop.offsetHeight, viewport = document.documentElement.clientWidth;
      pop.style.left = `${Math.max(8, rect.left + width <= viewport - 8 ? rect.left : Math.min(rect.right - width, viewport - width - 8))}px`;
      pop.style.top = `${rect.bottom + 8 + height <= window.innerHeight || rect.top < height + 16 ? rect.bottom + 8 : rect.top - height - 8}px`;
    }
    function open() {
      if (active && active !== controller) active.close();
      view.from = parse(fromInput.value); view.to = parse(toInput.value); view.hover = null;
      // Справа — месяц конца периода; если начало раньше, левым становится месяц начала. Месяцы за пределами min/max не показываем.
      const count = monthsCount(), { min, max } = limits();
      let month = addMonths(monthStart(view.to ?? view.from ?? today()), -(count - 1));
      if (view.from != null && view.from < month) month = monthStart(view.from);
      if (max != null && addMonths(month, count - 1) > monthStart(max)) month = addMonths(monthStart(max), -(count - 1));
      if (min != null && month < monthStart(min)) month = monthStart(min);
      view.month = month;
      pop.hidden = false;
      render();
      place();
      trigger.setAttribute('aria-expanded', 'true');
      active = controller;
    }
    function close() {
      pop.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (active === controller) active = null;
    }
    function commit() {
      fromInput.value = iso(view.from);
      toInput.value = iso(view.to);
      for (const input of [fromInput, toInput]) input.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(close, 160);
    }
    const controller = { close, group, pop, place, trigger };

    trigger.addEventListener('click', () => active === controller ? close() : open());
    // Подпись «Период» и поля вокруг кнопки тоже открывают календарь.
    group.addEventListener('click', event => { if (!trigger.contains(event.target) && !trigger.disabled) trigger.click(); });
    pop.addEventListener('click', event => {
      const nav = event.target.closest('[data-nav]');
      if (nav && !nav.disabled) { view.month = addMonths(view.month, Number(nav.dataset.nav)); render(); return; }
      const day = event.target.closest('.drp-day');
      if (!day || day.disabled) return;
      const time = Number(day.dataset.day);
      if (view.from == null || view.to != null) { view.from = time; view.to = null; view.hover = null; paint(); return; }
      if (time < view.from) { view.to = view.from; view.from = time; } else view.to = time;
      paint();
      commit();
    });
    pop.addEventListener('mouseover', event => {
      const day = event.target.closest('.drp-day');
      if (!day || day.disabled || view.from == null || view.to != null) return;
      view.hover = Number(day.dataset.day);
      paint();
    });
    pop.addEventListener('mouseleave', () => { if (view.to == null && view.hover != null) { view.hover = null; paint(); } });
    refresh();
  }

  // Клик мимо календаря или Esc закрывают его; незавершённый выбор (только начало) не применяется.
  document.addEventListener('mousedown', event => {
    if (active && !active.pop.contains(event.target) && !active.group.contains(event.target)) active.close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) { const trigger = active.trigger; active.close(); trigger.focus(); }
  });
  window.addEventListener('scroll', event => { if (active && !active.pop.contains(event.target)) active.place(); }, true);
  window.addEventListener('resize', () => active?.close());

  document.querySelectorAll('[data-date-range]').forEach(enhance);
})();
