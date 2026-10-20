// Боковое меню — одно на все страницы: пункты описаны здесь один раз и рисуются в <nav> каждой страницы
// (index.html, campaign.html, product.html). Новый раздел добавляется только в SIDEBAR_SECTIONS. Стили — sidebar.css.
// Активный пункт — data-active у <aside class="sidebar"> (на основном сайте его дальше переключает app.js).
// По умолчанию меню свёрнуто до иконок, кнопка с тремя полосами разворачивает его поверх страницы.
// Закрывается той же кнопкой, кликом мимо меню, клавишей Esc или переходом по пункту меню.
// На страницах детализации внизу меню — название кабинета, из которого страница открыта (?cabinet=…).
(() => {
  'use strict';
  const SVG = paths => `<svg viewBox="0 0 24 24">${paths}</svg>`;
  const BOXES = '<rect x="8" y="4.5" width="8" height="7.5" rx="1.2"/><rect x="3.5" y="12.5" width="8" height="7.5" rx="1.2"/><rect x="12.5" y="12.5" width="8" height="7.5" rx="1.2"/><path d="M12 4.5v2.5M7.5 12.5V15M16.5 12.5V15"/>';
  const SIDEBAR_SECTIONS = [
    { page: 'summary', label: 'Сводка', icon: '◎' },
    { page: 'orders', label: 'Лента заказов', icon: SVG('<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>') },
    { page: 'fbs-orders', label: 'Новые заказы', icon: SVG('<path d="M11.3 10.5l.2-3h9l.8 11h-6.3M13.6 7.5V6.6a2.4 2.4 0 0 1 4.8 0v.9"/><path d="M4.5 10.5h9.6l.8 10H3.7z"/><path d="M7 10.5V9.4a2.3 2.3 0 0 1 4.6 0v1.1"/>'), badge: 'fbsBadge' },
    { page: 'fbw-stocks', label: 'Остатки FBW', icon: SVG(BOXES) },
    { page: 'stocks', label: 'Остатки FBS', icon: SVG(BOXES) },
    { page: 'returns', label: 'Возвраты', icon: SVG('<path d="M9 13.5L4.5 9 9 4.5"/><path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-4"/>') },
    { page: 'prices', label: 'Цены и скидки', icon: '₽' },
    { page: 'funnel', label: 'Воронка', icon: SVG('<path d="M3.5 3.5v17h17"/><path d="M7 15.5l4-4.5 3 3 5.5-6.5"/><path d="M16 7.5h3.5V11"/>') },
    { page: 'ratings', label: 'Оценки товаров', icon: SVG('<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>') },
    { page: 'ads', label: 'Реклама', icon: 'ADS', iconClass: 'nav-icon-ads' },
    { page: 'todo', label: 'Дела', icon: SVG('<path d="M4 6.5l1.6 1.6L8.6 5"/><path d="M4 12.5l1.6 1.6 3-3.1"/><path d="M4 18.5l1.6 1.6 3-3.1"/><path d="M12 7h8M12 13h8M12 19h8"/>') }
  ];
  const sidebar = document.querySelector('.sidebar'), toggle = document.querySelector('.sidebar-toggle'), nav = sidebar?.querySelector('nav');
  if (!sidebar || !toggle || !nav) return;
  // Пункты — ссылки: их можно открыть в новой вкладке колесом мыши, Ctrl+кликом или через контекстное меню.
  // Счётчики (новые заказы) обновляет только основной сайт — на страницах детализации их не рисуем.
  const active = sidebar.dataset.active || '', live = Boolean(sidebar.querySelector('.cabinet-wrap'));
  nav.innerHTML = SIDEBAR_SECTIONS.map(item => `<a class="nav-item${item.page === active ? ' active' : ''}" href="/?page=${item.page}" data-page="${item.page}">` +
    `<span class="nav-icon${item.iconClass ? ` ${item.iconClass}` : ''}" aria-hidden="true">${item.icon}</span><span class="nav-label">${item.label}</span>${item.badge && live ? `<b id="${item.badge}">0</b>` : ''}</a>`).join('');
  const brand = sidebar.querySelector('.brand'); if (brand) brand.href = '/';

  // Страница детализации: внизу — кабинет из ссылки (название берём у сервера, пока грузится — номер).
  const cabinetId = new URLSearchParams(location.search).get('cabinet');
  if (!sidebar.querySelector('.cabinet-wrap') && cabinetId) {
    const block = document.createElement('div');
    block.className = 'sidebar-cabinet';
    block.title = 'Кабинет, из которого открыта страница';
    const paint = name => { block.innerHTML = `<span class="avatar" aria-hidden="true"></span><span><strong></strong><small>Кабинет</small></span>`; block.querySelector('.avatar').textContent = (name || '?').trim().charAt(0).toUpperCase(); block.querySelector('strong').textContent = name; };
    paint(cabinetId === 'demo' ? 'Демо-кабинет' : `Кабинет ${cabinetId}`);
    sidebar.append(block);
    if (cabinetId !== 'demo') fetch('/api/cabinets').then(response => response.json()).then(data => { const found = (data.cabinets || []).find(item => String(item.id) === cabinetId); if (found?.name) paint(found.name); }).catch(() => {});
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  document.body.append(backdrop);
  const items = [...sidebar.querySelectorAll('.nav-item')].map(item => [item, item.querySelector('.nav-label')?.textContent.trim() || '']);
  const isOpen = () => sidebar.classList.contains('expanded');
  function setOpen(open) {
    sidebar.classList.toggle('expanded', open);
    document.body.classList.toggle('sidebar-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Свернуть меню' : 'Развернуть меню');
    toggle.title = open ? 'Свернуть меню' : 'Развернуть меню';
    // В свёрнутом меню название пункта видно в подсказке при наведении на иконку.
    items.forEach(([item, label]) => open ? item.removeAttribute('title') : item.setAttribute('title', label));
  }
  toggle.addEventListener('click', () => setOpen(!isOpen()));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && isOpen()) setOpen(false); });
  sidebar.addEventListener('click', event => {
    if (event.target.closest('.nav-item') && !event.ctrlKey && !event.metaKey && !event.shiftKey) setOpen(false);
  });
  // Счётчик «0» на свёрнутой иконке не нужен — помечаем такие счётчики, CSS их прячет.
  const badges = [...sidebar.querySelectorAll('.nav-item b')];
  const markZero = () => badges.forEach(badge => badge.classList.toggle('zero', badge.textContent.trim() === '0'));
  if (badges.length) new MutationObserver(markZero).observe(sidebar, { subtree: true, childList: true, characterData: true });
  markZero();
  setOpen(false);
})();
