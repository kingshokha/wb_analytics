(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const state = { rows: [], sort: { key: 'date', direction: 'desc' }, visibleMetrics: new Set(['views', 'clicks', 'orders', 'spend']) };
  const columns = ['date', 'views', 'clicks', 'ctr', 'cpc', 'carts', 'orders', 'canceled', 'revenue', 'spend', 'drr'];
  const chartMetrics = [
    { key: 'views', label: 'Показы', color: '#277a70' },
    { key: 'clicks', label: 'Клики', color: '#d77b28' },
    { key: 'carts', label: 'Корзины', color: '#4d8f63' },
    { key: 'orders', label: 'Заказы', color: '#b35b45' },
    { key: 'spend', label: 'Затраты', color: '#5a7d9a' },
    { key: 'revenue', label: 'Сумма заказов', color: '#8b6b3f' }
  ];
  const $ = (selector) => document.querySelector(selector);
  const number = (value) => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const money = (value) => `${number(value)} ₽`;
  const percent = (value) => `${number(value)}%`;
  const date = (value) => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('ru-RU'); };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const average = (key) => state.rows.length ? state.rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / state.rows.length : 0;
  const total = (key) => state.rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);

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

  function renderSummary() {
    const cards = [
      ['Средний ДРР', percent(average('drr'))],
      ['Средний CTR', percent(average('ctr'))],
      ['Средний CPC', money(average('cpc'))],
      ['Добавления в корзину', number(total('carts'))],
      ['Отмены', number(total('canceled'))]
    ];
    $('#summary').innerHTML = cards.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
  }

  function renderTable() {
    const rows = sortedRows();
    $('#dailyBody').innerHTML = rows.length ? rows.map((row) => `<tr>${columns.map((key) => `<td>${escapeHtml(formatCell(key, row[key]))}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="11" class="empty">Нет дневных данных за выбранный период</td></tr>';
  }

  function renderChartOptions() {
    $('#chartOptions').innerHTML = chartMetrics.map((metric) => `<label><input type="checkbox" data-chart-key="${metric.key}" ${state.visibleMetrics.has(metric.key) ? 'checked' : ''}> ${metric.label}</label>`).join('');
    $('#chartOptions').querySelectorAll('input').forEach((input) => input.addEventListener('change', () => { input.checked ? state.visibleMetrics.add(input.dataset.chartKey) : state.visibleMetrics.delete(input.dataset.chartKey); renderChart(); }));
  }

  function renderChart() {
    const svg = $('#dailyChart');
    const rows = [...state.rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const selected = chartMetrics.filter((metric) => state.visibleMetrics.has(metric.key));
    const width = 1200, height = 290, left = 54, right = 22, top = 20, bottom = 42, chartWidth = width - left - right, chartHeight = height - top - bottom;
    if (!rows.length || !selected.length) { svg.innerHTML = '<text x="600" y="145" text-anchor="middle" class="chart-axis">Выберите данные для отображения</text>'; return; }
    const max = Math.max(1, ...selected.flatMap((metric) => rows.map((row) => Number(row[metric.key] || 0))));
    const x = (index) => left + (rows.length === 1 ? chartWidth / 2 : index * chartWidth / (rows.length - 1));
    const y = (value) => top + chartHeight - Number(value || 0) / max * chartHeight;
    const grid = [0, .25, .5, .75, 1].map((ratio) => `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${y(max * ratio)}" y2="${y(max * ratio)}"/><text class="chart-axis" x="${left - 8}" y="${y(max * ratio) + 4}" text-anchor="end">${number(max * ratio)}</text>`).join('');
    const labels = rows.map((row, index) => index % Math.max(1, Math.ceil(rows.length / 8)) === 0 ? `<text class="chart-axis" x="${x(index)}" y="${height - 14}" text-anchor="middle">${escapeHtml(date(row.date))}</text>` : '').join('');
    const lines = selected.map((metric) => { const points = rows.map((row, index) => `${x(index)},${y(row[metric.key])}`).join(' '); const dots = rows.map((row, index) => `<circle class="chart-dot" cx="${x(index)}" cy="${y(row[metric.key])}" r="3" fill="${metric.color}"><title>${escapeHtml(date(row.date))}: ${escapeHtml(formatCell(metric.key, row[metric.key]))}</title></circle>`).join(''); return `<polyline class="chart-line" points="${points}" stroke="${metric.color}"/>${dots}`; }).join('');
    svg.innerHTML = `${grid}${labels}${lines}`;
  }

  async function load() {
    const query = new URLSearchParams({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '', from: params.get('from') || '', to: params.get('to') || '' });
    try {
      const response = await fetch(`/api/advertising/campaign?${query}`);
      if (!response.ok) throw new Error((await response.json()).error || 'Не удалось получить данные');
      const data = await response.json();
      const campaign = data.campaign;
      state.rows = campaign.daily || [];
      $('#campaignTitle').textContent = campaign.name || `Кампания #${campaign.id}`;
      $('#periodLabel').textContent = `Кампания #${campaign.id} · ${date(data.period.from)} — ${date(data.period.to)}`;
      renderSummary(); renderChartOptions(); renderChart(); renderTable();
    } catch (error) { $('#periodLabel').textContent = error.message; $('#dailyBody').innerHTML = `<tr><td colspan="11" class="empty">${escapeHtml(error.message)}</td></tr>`; }
  }

  document.querySelectorAll('th[data-key]').forEach((header) => header.addEventListener('click', () => { const key = header.dataset.key; state.sort = state.sort.key === key ? { key, direction: state.sort.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' }; renderTable(); }));
  load();
})();