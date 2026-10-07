// Боковое меню: по умолчанию свёрнуто до иконок, кнопка с тремя полосами разворачивает его поверх страницы.
// Закрывается той же кнопкой, кликом мимо меню, клавишей Esc или переходом по пункту меню.
(() => {
  'use strict';
  const sidebar = document.querySelector('.sidebar'), toggle = document.querySelector('.sidebar-toggle');
  if (!sidebar || !toggle) return;
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
