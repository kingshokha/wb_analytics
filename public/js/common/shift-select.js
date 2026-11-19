// --- Выбор диапазона галочек с Shift: на всех страницах, во всех списках с галочками ---
// Отметьте первую галочку, затем с Shift — последнюю: все галочки между ними примут то же состояние (отмечены или сняты).
// Список — галочки одного вида: с тем же data-атрибутом (data-stock-row, data-card-select…), с тем же name или,
// если их нет, лежащие в одном блоке (пункты фильтра). «Выбрать все» в заголовке — одна такая, в диапазоны не входит.
// Галочки между крайними нажимаются программно (click), поэтому страница учитывает их своими обработчиками — как ручной
// выбор. Страница может перерисовать таблицу после каждого нажатия, поэтому галочки ищутся заново по своему признаку.
(() => {
  const BOX = 'input[type="checkbox"]';
  let anchor = null,
    busy = false;

  const dataAttr = input =>
    [...input.attributes].map(attr => attr.name).find(name => name.startsWith('data-') && input.getAttribute(name) !== '');
  // Вид галочки — селектор, общий для всего списка, и признак, по которому её можно найти после перерисовки.
  function kindOf(input) {
    // Галочки «Карточек товаров» выбирают диапазон сами (через все страницы по фильтрам, js/cards/cards.js) — не трогаем.
    if (input.matches('[data-card-select]')) return null;
    const attr = dataAttr(input);
    if (attr) return { list: `${BOX}[${attr}]`, one: `${BOX}[${attr}="${CSS.escape(input.getAttribute(attr))}"]` };
    if (input.name)
      return {
        list: `${BOX}[name="${CSS.escape(input.name)}"]`,
        one: input.value ? `${BOX}[name="${CSS.escape(input.name)}"][value="${CSS.escape(input.value)}"]` : null
      };
    // Без признаков — пункты одного блока (фильтр «Наличие», «Статусы»…): блок — ближайший предок с id.
    const holder = input.closest('[id]');
    if (!holder || !input.value || input.id) return null;
    const scope = `#${CSS.escape(holder.id)} ${BOX}:not([id])`;
    return { list: scope, one: `${scope}[value="${CSS.escape(input.value)}"]` };
  }
  // Общий блок списка: таблица, окно или блок с id — диапазон не выходит за него.
  const rootOf = input => input.closest('table, .modal, [role="dialog"], [id]') || document.body;
  const listOf = (input, kind) => [...rootOf(input).querySelectorAll(kind.list)].filter(box => box.offsetParent !== null || box === input);

  document.addEventListener(
    'click',
    event => {
      const input = event.target;
      if (busy || !(input instanceof HTMLInputElement) || input.type !== 'checkbox' || input.disabled) return;
      const kind = kindOf(input);
      if (!kind?.one) {
        anchor = null;
        return;
      }
      const previous = anchor;
      anchor = { kind, one: kind.one };
      if (!event.shiftKey || !previous || previous.kind.list !== kind.list || previous.one === kind.one) return;
      const list = listOf(input, kind),
        from = list.findIndex(box => box.matches(previous.one)),
        to = list.indexOf(input);
      if (from < 0 || to < 0) return;
      // Shift+клик по подписи у некоторых браузеров выделяет текст — снимаем выделение.
      window.getSelection?.().removeAllRanges();
      const checked = input.checked,
        targets = list
          .slice(Math.min(from, to), Math.max(from, to) + 1)
          .filter(box => box !== input)
          .map(box => kindOf(box)?.one)
          .filter(Boolean);
      // После того как страница обработает саму нажатую галочку (она может перерисовать таблицу).
      setTimeout(() => {
        busy = true;
        try {
          for (const selector of targets) {
            const box = document.querySelector(selector);
            if (box && !box.disabled && box.checked !== checked) box.click();
          }
        } finally {
          busy = false;
        }
      });
    },
    true
  );
})();
