(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const state = { rows: [], sort: { key: 'date', direction: 'desc' } };
  const $ = (selector) => document.querySelector(selector);
  const number = (value) => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const money = (value) => `${number(value)} ₽`;
  const percent = (value) => `${number(value)}%`;
  const date = (value) => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('ru-RU'); };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

  function formatCell(key, value) {
    if (key === 'date') return date(value);
    if (['spend', 'revenue', 'cpc'].includes(key)) return money(value);
    if (['ctr', 'drr'].includes(key)) return percent(value);
    return number(value);
  }

  function sortedRows() {
    const { key, direction } = state.sort;
    return [...state.rows].sort((left, right) => {
      const a = left[key] ?? '', b = right[key] ?? '';
      const result = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ru', { numeric: true });
      return direction === 'asc' ? result : -result;
    });
  }

  function render() {
    const rows = sortedRows();
    $('#dailyBody').innerHTML = rows.length ? rows.map((row) => `<tr>${['date','id','name','views','clicks','ctr','cpc','carts','orders','canceled','revenue','spend','drr'].map((key) => `<td${key === 'name' ? ` title="${escapeHtml(row[key])}"` : ''}>${escapeHtml(formatCell(key, row[key]))}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="13" class="empty">Нет дневных данных за выбранный период</td></tr>';
  }

  async function load() {
    const query = new URLSearchParams({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '', from: params.get('from') || '', to: params.get('to') || '' });
    try {
      const response = await fetch(`/api/advertising/campaign?${query}`);
      if (!response.ok) throw new Error((await response.json()).error || 'Не удалось получить данные');
      const data = await response.json();
      const campaign = data.campaign;
      const daily = (campaign.daily || []).map((row) => ({ ...row, id: campaign.id, name: campaign.name }));
      state.rows = daily;
      $('#campaignTitle').textContent = campaign.name || `Кампания #${campaign.id}`;
      $('#periodLabel').textContent = `Кампания #${campaign.id} · ${date(data.period.from)} — ${date(data.period.to)}`;
      $('#summary').innerHTML = [['Показы', number(campaign.views)], ['Клики', number(campaign.clicks)], ['Рекламные заказы', number(campaign.orders)], ['Сумма заказов', money(campaign.revenue)], ['Затраты', money(campaign.spend)]].map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
      render();
    } catch (error) { $('#periodLabel').textContent = error.message; $('#dailyBody').innerHTML = `<tr><td colspan="13" class="empty">${escapeHtml(error.message)}</td></tr>`; }
  }

  document.querySelectorAll('th[data-key]').forEach((header) => header.addEventListener('click', () => { const key = header.dataset.key; state.sort = state.sort.key === key ? { key, direction: state.sort.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' }; render(); }));
  load();
})();