'use strict';
// --- Детализация кампании: мини-графики и «Размещение и ставки» ---

// --- Мини-графики под графиком по датам (общий модуль mini-charts.js, как в детализации товара) ---
const sumOf = key => day => (day[key] == null ? null : Number(day[key] || 0));
// Нет значения (нет показов у CPC-кампании, нет заказов для CPO) — прочерк, а не «0».
const orDash = format => value => (value == null || !Number.isFinite(Number(value)) ? '—' : format(value));
const miniNumber = orDash(number),
  miniMoney = orDash(money),
  miniPercent = orDash(percent);
const CAMPAIGN_MINIS = [
  {
    title: 'Показы и клики',
    items: [
      { label: 'Показы', num: sumOf('views'), fmt: miniNumber },
      { label: 'Клики', num: sumOf('clicks'), fmt: miniNumber },
      { label: 'CTR', num: sumOf('clicks'), den: sumOf('views'), scale: 100, fmt: miniPercent, axis: '%' },
      { label: 'CPM', num: sumOf('spend'), den: sumOf('views'), scale: 1000, fmt: miniMoney }
    ]
  },
  {
    title: 'Деньги',
    items: [
      { label: 'Затраты', num: sumOf('spend'), fmt: miniMoney },
      { label: 'CPC', num: sumOf('spend'), den: sumOf('clicks'), scale: 1, fmt: miniMoney },
      { label: 'Сумма заказов', num: sumOf('revenue'), fmt: miniMoney },
      { label: 'ДРР', num: sumOf('spend'), den: sumOf('revenue'), scale: 100, fmt: miniPercent, axis: '%' },
      { label: 'CPO', num: sumOf('spend'), den: sumOf('orders'), scale: 1, fmt: miniMoney }
    ]
  },
  {
    title: 'Результат',
    items: [
      { label: 'Корзины', num: sumOf('carts'), fmt: miniNumber },
      { label: 'Заказы', num: sumOf('orders'), fmt: miniNumber },
      { label: 'CR', num: sumOf('orders'), den: sumOf('clicks'), scale: 100, fmt: miniPercent, axis: '%' },
      { label: 'Отмены', num: sumOf('canceled'), fmt: miniNumber },
      {
        label: 'Средняя позиция',
        num: day => (state.positions?.has(day.date) ? Number(state.positions.get(day.date)) : null),
        average: true,
        invert: true,
        fmt: value =>
          value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 }),
        averageNote: 'меньше — выше в поиске',
        emptyNote: 'нет данных по поисковым кластерам'
      }
    ]
  }
];
function renderCampaignMinis() {
  const box = $('#campaignMinis');
  if (!box || !window.MiniCharts) return;
  const days = [...(state.rows || [])]
    .filter(day => /^\d{4}-\d{2}-\d{2}/.test(day.date || ''))
    .map(day => ({ ...day, date: String(day.date).slice(0, 10) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // CPC-кампании WB присылает без показов — тогда графики показов, CTR и CPM пустые («нет данных»).
  const markers = (campaignNotes?.list || []).map(item => String(item.at || '').slice(0, 10)).filter(Boolean);
  window.MiniCharts.render(box, CAMPAIGN_MINIS, days, { markers });
}
let minisWidth = 0;
new ResizeObserver(() => {
  const width = $('#campaignMinis')?.clientWidth || 0;
  if (width && width !== minisWidth) {
    minisWidth = width;
    renderCampaignMinis();
  }
}).observe($('#campaignMinis'));
$('#campaignId').onclick = event => {
  const button = event.currentTarget,
    text = button.dataset.copy;
  navigator.clipboard?.writeText(text).then(() => {
    button.textContent = 'Скопировано';
    setTimeout(() => {
      button.textContent = text;
    }, 1200);
  });
};
// Кнопка «i»: подробности выгрузки видны при наведении, а на телефоне — по нажатию.
$('#campaignInfoButton').onclick = event => {
  event.stopPropagation();
  event.currentTarget.closest('.info-wrap').classList.toggle('open');
};
document.addEventListener('click', event => {
  if (!event.target.closest('.info-wrap')) document.querySelector('.info-wrap')?.classList.remove('open');
});
// --- Блок «Размещение и ставки»: места размещения кампании и ставки товаров из настроек WB ---
// Переключатель у плашки места показа. WB меняет места показа (PUT /adv/v0/auction/placements) только у кампаний
// с ручной ставкой и оплатой за показы (CPM) в статусах 4, 9, 11 — у остальных переключатель неактивен с пояснением.
const PLACEMENT_LABELS = { search: 'поиске', recommendations: 'рекомендациях' };
function placementLock(setup) {
  if (isDemoCabinet()) return 'В демо-режиме места показа менять нельзя';
  if (setup.bidType !== 'manual' || String(setup.paymentType || '').toLowerCase() !== 'cpm')
    return 'WB позволяет менять места показа только у кампаний с ручной ставкой и оплатой за показы (CPM)';
  if (![4, 9, 11].includes(state.campaignStatus)) return 'У завершённой кампании места показа менять нельзя';
  return '';
}
function renderSetup(setup) {
  const panel = $('#setupPanel');
  if (!setup) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  state.setup = setup;
  const p = setup.placements || {},
    lock = placementLock(setup);
  // Единая ставка одинакова в поиске и рекомендациях — показываем её одним столбцом.
  const unified = setup.bidType === 'unified';
  $('#setupHead').innerHTML =
    `<th>Товар</th><th>Предмет</th>${unified ? '<th>Ставка</th>' : '<th>Ставка в поиске</th><th>Ставка в рекомендациях</th>'}`;
  $('#setupPlacements').innerHTML = [
    ['search', 'Поиск'],
    ['recommendations', 'Рекомендации']
  ]
    .map(
      ([key, label]) =>
        `<span class="placement ${p[key] ? 'on' : 'off'}" title="Размещение ${p[key] ? 'включено' : 'отключено'}"><i></i>${label}${p[key] ? '' : ' · выкл.'}` +
        `<button type="button" class="placement-switch" role="switch" aria-checked="${p[key] ? 'true' : 'false'}" data-placement="${key}" aria-label="Показы в ${PLACEMENT_LABELS[key]}" title="${esc(lock || (p[key] ? `Выключить показы в ${PLACEMENT_LABELS[key]}` : `Включить показы в ${PLACEMENT_LABELS[key]}`))}"${lock ? ' disabled' : ''}><span></span></button></span>`
    )
    .join('');
  // Ставка за отключённое место размещения приглушена и подписана: она есть в настройках, но не работает.
  const bid = (value, enabled) =>
    value == null
      ? '—'
      : `<span class="bid-cell ${enabled ? '' : 'bid-off'}">${money(value)}${enabled ? '' : '<small>выкл.</small>'}</span>`;
  $('#setupBids').innerHTML =
    (setup.bids || [])
      .map(
        item =>
          `<tr><td><div class="product-cell">${item.photo ? `<img class="product-photo" src="${esc(item.photo)}" alt="" loading="lazy">` : '<i class="product-photo-stub"></i>'}<span><b>${esc(item.name)}</b><small>${esc(item.vendorCode || '')}${item.vendorCode ? ' · ' : ''}${esc(item.nmId)}</small></span></div></td><td>${esc(item.subject || '—')}</td>${unified ? `<td>${bid(item.search ?? item.recommendations, p.search || p.recommendations)}</td>` : `<td>${bid(item.search, p.search)}</td><td>${bid(item.recommendations, p.recommendations)}</td>`}</tr>`
      )
      .join('') || `<tr><td colspan="${unified ? 3 : 4}" class="empty">WB не вернул ставки товаров</td></tr>`;
  bindPhotoPreviews('#setupBids');
}
