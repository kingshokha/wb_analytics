// --- Окна истории из Google Таблицы: сначала копия на компьютере, потом дозагрузка ---
// Цена товара («Цены и скидки»), история кампании («Размещение и ставки → История») и «История остатков» берут
// данные через /api/sheet-history. SheetSync.load сначала просит копию с компьютера (source=local) — окно рисуется
// сразу, — потом дозагрузку из таблицы (source=sheet) и рисует окно ещё раз. SheetSync.hint — подсказка о том,
// откуда данные и что нового.
(() => {
  'use strict';
  const time = iso => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  const plural = (count, forms) => { const n = Math.abs(count) % 100, d = n % 10; return forms[n > 10 && n < 20 ? 2 : d > 1 && d < 5 ? 1 : d === 1 ? 0 : 2]; };
  async function get(url, source) {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}source=${source}`);
    let data = {}; try { data = await response.json(); } catch { /* пустой ответ */ }
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  }
  // render(data, phase, error, previous): phase — 'local' или 'sheet'; previous — ответ с компьютера (для подсчёта нового).
  async function load(url, render) {
    let local = null;
    try { local = await get(url, 'local'); render(local, 'local', null, null); }
    catch (error) { render(null, 'local', error, null); }
    if (local && !local.configured) return;
    try { render(await get(url, 'sheet'), 'sheet', null, local); }
    catch (error) { render(local, 'sheet', error, local); }
  }
  // count(data) — сколько строк истории в окне (по фильтру окна), чтобы сказать «+N изменений».
  function hint(data, phase, error, previous, count = value => (value?.items || []).length) {
    if (data && data.configured === false) return '';
    const saved = data?.syncedAt ? ` на ${time(data.syncedAt)}` : '';
    if (phase === 'local') return error ? 'Не удалось прочитать данные с компьютера · загружаем из Google Таблицы…'
      : data?.syncedAt ? `Данные с компьютера${saved} · проверяем Google Таблицу…` : 'На компьютере данных ещё нет · загружаем из Google Таблицы…';
    const problem = error?.message || data?.syncError;
    if (problem) return `Google Таблица недоступна (${problem}) — показаны данные с компьютера${saved}`;
    const added = Math.max(0, count(data) - count(previous));
    return `${added ? `Обновлено из Google Таблицы: +${added} ${plural(added, ['изменение', 'изменения', 'изменений'])}` : 'Новых изменений в Google Таблице нет'} · ${time(new Date().toISOString())}`;
  }
  window.SheetSync = { load, hint };
})();
