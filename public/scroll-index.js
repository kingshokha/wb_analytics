// --- Указатель разделов справа: риска на каждый блок страницы, бегунок — где вы сейчас ---
// По мотивам Scroll Index из Kokonut UI (MIT, @dorianbaffier, https://kokonutui.com), переписан на простой JS
// без React: прокручивается сама страница (режим window), шкала закреплена у правого края.
// Риска стоит там, где начинается блок при прокрутке: длинный блок оставляет длинный промежуток до следующей.
// Наведение увеличивает риски рядом с указателем (как док) и показывает название блока; клик — плавный переход к блоку;
// протяжка по шкале прокручивает страницу, отпущенная рядом с риской — доводит до неё. С клавиатуры: Tab на шкалу,
// стрелки вверх-вниз между блоками, Enter — перейти. Заходя в новый блок, шкала на миг показывает его название.
// Блоки — заголовки по селектору data-selector у <script> (по умолчанию h2 в шапке панели); скрытые не считаются.
(() => {
  'use strict';
  const content = document.querySelector('main');
  if (!content) return;
  const selector = document.currentScript?.dataset.selector || 'section.panel > .panel-head h2';
  // Высота шкалы, отступ заголовка от верха после перехода, увеличение рисок и его радиус, притяжение после протяжки,
  // сколько держится название блока после входа в него (мс).
  const RAIL = 280, OFFSET = 16, SWELL = 1.6, REACH = 26, SNAP = 18, FLASH = 900;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.createElement('nav');
  nav.className = 'scroll-index'; nav.setAttribute('aria-label', 'Разделы страницы'); nav.hidden = true;
  nav.innerHTML = '<div class="si-rail"><span class="si-head" aria-hidden="true"></span><span class="si-label" aria-hidden="true"></span></div>';
  document.body.append(nav);
  const rail = nav.firstElementChild, head = rail.querySelector('.si-head'), label = rail.querySelector('.si-label');
  let list = [], ticks = [], signature = '', start = 0, end = 1, active = -1, height = RAIL;
  let raf = 0, tween = 0, flashTimer = 0, painted = false, hover = null, drag = null;
  const swell = [];
  const easeInOut = t => t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2;

  // Риска: впереди, текущая или пройденная; одна остановка Tab на всю шкалу — на текущем блоке.
  function markTicks() {
    ticks.forEach((tick, i) => {
      tick.dataset.state = i === active ? 'current' : i < active ? 'passed' : 'ahead';
      tick.tabIndex = i === Math.max(active, 0) ? 0 : -1;
      if (i === active) tick.setAttribute('aria-current', 'location'); else tick.removeAttribute('aria-current');
    });
  }
  function buildTicks() {
    ticks.forEach(tick => tick.remove());
    ticks = list.map((section, index) => {
      const tick = document.createElement('button');
      tick.type = 'button'; tick.className = 'si-tick'; tick.dataset.state = 'ahead'; tick.setAttribute('aria-label', section.text);
      tick.innerHTML = '<span></span>';
      // Клик мышью обрабатывает шкала (pointerup); здесь — только клавиатура (detail === 0).
      tick.addEventListener('click', event => { if (event.detail === 0) jump(index); });
      tick.addEventListener('focus', () => show(index));
      tick.addEventListener('blur', () => { label.style.opacity = '0'; });
      tick.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        ticks[Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), ticks.length - 1)]?.focus();
      });
      rail.insertBefore(tick, head);
      return tick;
    });
    swell.length = 0;
  }
  function measure() {
    const scroll = scrollY, top = content.getBoundingClientRect().top + scroll;
    start = Math.max(top - OFFSET, 0);
    end = Math.max(top + content.offsetHeight - innerHeight, start + 1);
    list = [...content.querySelectorAll(selector)].filter(el => el.getClientRects().length).map(el => {
      const at = Math.min(Math.max(el.getBoundingClientRect().top + scroll - OFFSET, start), end);
      return { el, text: el.textContent.trim(), at, pos: (at - start) / (end - start) };
    });
    height = rail.clientHeight || RAIL;
    const next = list.map(section => section.text).join('|');
    if (next !== signature) { signature = next; buildTicks(); active = current(); markTicks(); }
    list.forEach((section, i) => { ticks[i].style.top = `${(section.pos * 100).toFixed(3)}%`; });
    nav.hidden = list.length < 2;
  }
  const fraction = () => Math.min(Math.max((scrollY - start) / (end - start), 0), 1);
  function nearest(y) {
    let index = -1, distance = Infinity;
    list.forEach((section, i) => { const d = Math.abs(section.pos * height - y); if (d < distance) { distance = d; index = i; } });
    return { index, distance };
  }
  function placeLabel(index, visible) {
    const section = list[index];
    if (!section) { label.style.opacity = '0'; return; }
    if (label.textContent !== section.text) label.textContent = section.text;
    label.style.transform = `translate3d(0, ${(section.pos * height).toFixed(1)}px, 0) translateY(-50%)`;
    label.style.opacity = visible ? '1' : '0';
  }
  // Текущий блок — последний, чей заголовок уже у верха экрана или выше.
  function current() {
    const scroll = scrollY + 1;
    let index = -1;
    list.forEach((section, i) => { if (section.at <= scroll) index = i; });
    return index;
  }
  function paint() {
    raf = 0;
    head.style.transform = `translate3d(0, ${(fraction() * height).toFixed(1)}px, 0)`;
    const now = current();
    if (now !== active) {
      active = now; markTicks();
      if (painted && hover === null && !drag && active >= 0) {
        placeLabel(active, true);
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { if (hover === null && !drag) label.style.opacity = '0'; }, FLASH);
      }
    }
    // Риски плавно тянутся к своему увеличению — оно следует за указателем без скачков.
    let moving = false;
    ticks.forEach((tick, i) => {
      const y = (list[i]?.pos ?? 0) * height;
      const target = hover === null || reduceMotion ? 1 : 1 + SWELL * Math.exp(-((hover - y) ** 2) / (2 * REACH * REACH));
      const value = (swell[i] ?? 1) + (target - (swell[i] ?? 1)) * 0.35;
      swell[i] = Math.abs(value - target) < 0.005 ? target : value;
      moving ||= swell[i] !== target;
      tick.style.setProperty('--swell', swell[i].toFixed(3));
    });
    painted = true;
    if (moving) schedule();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(paint); }
  function stopTween() { cancelAnimationFrame(tween); tween = 0; }
  function scrollToY(target) {
    stopTween();
    const from = scrollY, to = Math.max(target, 0);
    if (reduceMotion || Math.abs(to - from) < 2) { scrollTo(0, to); return; }
    const duration = Math.min(Math.max(260 + Math.abs(to - from) * 0.12, 300), 650), begin = performance.now();
    const step = now => { const t = Math.min((now - begin) / duration, 1); scrollTo(0, from + (to - from) * easeInOut(t)); tween = t < 1 ? requestAnimationFrame(step) : 0; };
    tween = requestAnimationFrame(step);
  }
  function jump(index) { const section = list[index]; if (section) scrollToY(section.at); }
  function show(index) { hover = (list[index]?.pos ?? 0) * height; placeLabel(index, true); schedule(); }

  const railY = event => Math.min(Math.max(event.clientY - rail.getBoundingClientRect().top, 0), height);
  rail.addEventListener('pointerdown', event => {
    if (drag || event.button !== 0) return;
    event.preventDefault();
    rail.setPointerCapture(event.pointerId); stopTween();
    const y = railY(event);
    drag = { id: event.pointerId, moved: false, y, t: event.timeStamp, v: 0 };
    hover = y; rail.dataset.dragging = '';
    placeLabel(nearest(y).index, true); schedule();
  });
  rail.addEventListener('pointermove', event => {
    const y = railY(event);
    if (drag && event.pointerId === drag.id) {
      const dt = Math.max(event.timeStamp - drag.t, 1);
      drag.v = drag.v * 0.4 + (y - drag.y) / dt * 0.6;
      drag.moved ||= Math.abs(y - drag.y) > 3;
      drag.y = y; drag.t = event.timeStamp;
      // Протяжка по шкале прокручивает страницу под ней.
      if (drag.moved) scrollTo(0, start + y / height * (end - start));
    } else if (event.pointerType !== 'mouse') return;
    hover = y; placeLabel(nearest(y).index, true); schedule();
  });
  const release = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const { moved, y, v } = drag;
    drag = null; delete rail.dataset.dragging;
    if (event.pointerType !== 'mouse') { hover = null; placeLabel(-1, false); }
    // Куда шла протяжка с разгона — и ближайшая к этому месту риска.
    const hit = nearest(moved ? y + v * 120 : y);
    if (hit.index >= 0 && (!moved || hit.distance < SNAP)) jump(hit.index);
    schedule();
  };
  rail.addEventListener('pointerup', release);
  rail.addEventListener('pointercancel', release);
  rail.addEventListener('pointerleave', () => { if (drag) return; hover = null; placeLabel(-1, false); schedule(); });
  addEventListener('scroll', schedule, { passive: true });
  // Своя прокрутка колесом или пальцем отменяет начатый переход.
  addEventListener('wheel', stopTween, { passive: true });
  addEventListener('touchstart', stopTween, { passive: true });
  // Блоки догружаются и меняют высоту, панели появляются и прячутся — риски пересчитываются.
  // Пересчёт — не чаще раза за кадр: подсказки графика прячутся и показываются при каждом движении мыши.
  let measuring = 0;
  const remeasure = () => { if (!measuring) measuring = requestAnimationFrame(() => { measuring = 0; measure(); schedule(); }); };
  new ResizeObserver(remeasure).observe(content);
  new MutationObserver(remeasure).observe(content, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  addEventListener('resize', remeasure);
  remeasure();
})();
