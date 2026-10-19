// --- Мини-графики «у каждого своя шкала» (вариант 8 из charts-lab): детализация товара и детализация кампании ---
// MiniCharts.render(box, groups, days, { markers }) рисует группы карточек: в каждой — название, итог за период,
// подпись и маленький график по дням со своей шкалой и подсказкой при наведении.
//   groups:  [{ title, items: [item] }]
//   item:    { label, num(day) → число | null, den?(day), scale? (100 — проценты), cap? (не больше 100), average?,
//              invert? (меньше — лучше: шкала перевёрнута), fmt(value) → текст, axis? ('%' — подписи шкалы с %),
//              averageNote?, emptyNote? }
//   days:    массив дней с полем date (YYYY-MM-DD) — то, что получают num и den;
//   markers: даты, которые отмечаются тонким пунктиром (например, свои отметки или заметки).
// Итог: без den — сумма за период и среднее в день; с den — значение за весь период (сумма num / сумма den);
// average — среднее по дням с данными. Стили — mini-charts.css.
(() => {
  'use strict';
  const COLORS = ['#7651e5', '#eb6834', '#1baf7a', '#2a78d6', '#e87ba4', '#0e8ea8', '#8a6a1f', '#555b66'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const finite = value => value != null && Number.isFinite(Number(value));
  const ddmm = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  const dayLong = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const fmtShort = value => { const v = Math.abs(value); return v >= 1e6 ? `${(value / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн` : v >= 1e4 ? `${Math.round(value / 1000).toLocaleString('ru-RU')} тыс` : v >= 1000 ? `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс` : value.toLocaleString('ru-RU', { maximumFractionDigits: v < 10 ? 1 : 0 }); };
  function niceScale(max, count) {
    if (!(max > 0)) return { max: 1, step: 1 };
    const raw = max / count, power = 10 ** Math.floor(Math.log10(raw)), fraction = raw / power;
    let step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
    if (max >= count && step < 1) step = 1;
    return { max: Math.ceil(max / step) * step, step };
  }

  function series(item, days) {
    const daily = days.map(day => {
      const num = item.num(day); if (num === null || num === undefined) return null;
      if (!item.den) return num;
      const den = item.den(day); if (!den) return null;
      const value = num / den * (item.scale || 1); return item.cap ? Math.min(100, value) : value;
    });
    const known = daily.filter(finite);
    let headline, sub;
    if (item.den) {
      const totals = days.reduce((sum, day) => { const num = item.num(day), den = item.den(day); return num == null || den == null ? sum : { num: sum.num + num, den: sum.den + den }; }, { num: 0, den: 0 });
      headline = totals.den ? (item.cap ? Math.min(100, totals.num / totals.den * (item.scale || 1)) : totals.num / totals.den * (item.scale || 1)) : null;
      sub = known.length ? `за период · по дням от ${item.fmt(Math.min(...known))} до ${item.fmt(Math.max(...known))}` : 'за период — нет данных';
    } else if (item.average) {
      headline = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
      sub = known.length ? `в среднем за ${known.length} дн.${item.averageNote ? ` · ${item.averageNote}` : ''}` : (item.emptyNote || 'нет данных');
    } else {
      const total = known.reduce((a, b) => a + b, 0); headline = known.length ? total : null;
      sub = known.length ? `за ${known.length} дн. · в среднем ${item.fmt(total / known.length)} в день` : (item.emptyNote || 'нет данных');
    }
    return { daily, headline, sub };
  }

  function render(box, groups, days, options = {}) {
    if (!box) return;
    box.classList.add('mini-charts');
    if (!days.length) { box.innerHTML = '<p class="mini-empty">Нет данных за период</p>'; return; }
    let colorIndex = 0;
    const items = [];
    box.innerHTML = groups.map(group => `<div class="mini-group"><h3>${esc(group.title)}</h3><div class="multiples">${group.items.map(item => {
      const color = COLORS[colorIndex++ % COLORS.length], data = series(item, days); items.push({ item, data, color });
      return `<div class="mini"><h4><i style="background:${color}"></i>${esc(item.label)}</h4><div class="sum">${item.fmt(data.headline)}</div><div class="sub">${esc(data.sub)}</div><div class="mini-chart"></div></div>`;
    }).join('')}</div></div>`).join('');
    box.querySelectorAll('.mini').forEach((element, index) => draw(element.querySelector('.mini-chart'), items[index], days, options.markers || []));
  }

  function draw(holder, { item, data, color }, days, markers) {
    const values = data.daily, W = Math.max(200, holder.clientWidth || 250), H = 120;
    const m = { top: 8, right: 6, bottom: 20, left: 40 }, pw = W - m.left - m.right, ph = H - m.top - m.bottom, count = days.length;
    const x = index => m.left + (count === 1 ? pw / 2 : index * pw / (count - 1)), known = values.filter(finite);
    if (!known.length) { holder.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}"><text class="mc-axis" x="${W / 2}" y="${H / 2}" text-anchor="middle">нет данных</text></svg>`; return; }
    let low = 0, high, ticks;
    if (item.invert) {
      // Меньше — лучше (позиция в поиске): шкала перевёрнута — чем выше линия, тем лучше.
      const min = Math.min(...known), max = Math.max(...known), pad = Math.max(1, (max - min) * .15);
      low = Math.max(1, Math.floor(min - pad)); high = Math.ceil(max + pad); ticks = [low, high];
    } else { const scale = niceScale(Math.max(...known), 2); high = scale.max; ticks = [0, scale.max / 2, scale.max]; }
    const y = value => item.invert ? m.top + (value - low) / (high - low || 1) * ph : m.top + ph - (value - low) / (high - low || 1) * ph;
    let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(item.label)} по дням">`;
    ticks.forEach(value => { svg += `${value !== ticks[0] || item.invert ? `<line class="mc-grid" x1="${m.left}" x2="${W - m.right}" y1="${y(value)}" y2="${y(value)}"/>` : ''}<text class="mc-axis" x="${m.left - 6}" y="${y(value) + 4}" text-anchor="end">${fmtShort(value)}${item.axis === '%' ? '%' : ''}</text>`; });
    svg += `<line class="mc-base" x1="${m.left}" x2="${W - m.right}" y1="${m.top + ph}" y2="${m.top + ph}"/>`;
    markers.forEach(date => { const index = days.findIndex(day => day.date === date); if (index >= 0) svg += `<line x1="${x(index)}" x2="${x(index)}" y1="${m.top}" y2="${m.top + ph}" stroke="#9aa39e" stroke-width="1" stroke-dasharray="2 3"/>`; });
    const segments = []; let current = [];
    values.forEach((value, index) => { if (finite(value)) current.push([x(index), y(value)]); else if (current.length) { segments.push(current); current = []; } });
    if (current.length) segments.push(current);
    for (const segment of segments) {
      const line = segment.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
      if (!item.invert && segment.length > 1) svg += `<path d="${line}L${segment.at(-1)[0].toFixed(1)},${m.top + ph}L${segment[0][0].toFixed(1)},${m.top + ph}Z" fill="${color}" opacity=".1"/>`;
      svg += segment.length > 1 ? `<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : `<circle cx="${segment[0][0]}" cy="${segment[0][1]}" r="2.5" fill="${color}"/>`;
    }
    svg += `<text class="mc-axis" x="${m.left}" y="${H - 4}">${ddmm(days[0].date)}</text><text class="mc-axis" x="${W - m.right}" y="${H - 4}" text-anchor="end">${ddmm(days.at(-1).date)}</text>`;
    svg += `<g class="mini-hover" visibility="hidden"><line y1="${m.top}" y2="${m.top + ph}" stroke="#a7afaa"/><circle r="4" fill="${color}" stroke="#fff" stroke-width="2"/></g>`;
    svg += `<rect class="mini-overlay" x="${m.left}" y="${m.top}" width="${pw}" height="${ph + m.bottom}" fill="transparent"/></svg>`;
    holder.innerHTML = `${svg}<div class="mini-tip" hidden></div>`;
    const svgEl = holder.querySelector('svg'), tip = holder.querySelector('.mini-tip'), hover = svgEl.querySelector('.mini-hover'), overlay = svgEl.querySelector('.mini-overlay');
    overlay.addEventListener('pointermove', event => {
      const rect = svgEl.getBoundingClientRect(), index = Math.max(0, Math.min(count - 1, Math.round(((event.clientX - rect.left) / rect.width * W - m.left) / pw * Math.max(1, count - 1)))), value = values[index];
      hover.setAttribute('visibility', 'visible'); hover.querySelector('line').setAttribute('x1', x(index)); hover.querySelector('line').setAttribute('x2', x(index));
      const dot = hover.querySelector('circle'); dot.setAttribute('visibility', finite(value) ? 'visible' : 'hidden'); if (finite(value)) { dot.setAttribute('cx', x(index)); dot.setAttribute('cy', y(value)); }
      tip.innerHTML = `<strong>${esc(dayLong(days[index].date))}</strong><div class="row">${esc(item.label)}<b>${item.fmt(value)}</b></div>`; tip.hidden = false;
      const scaleX = rect.width / W, px = x(index) * scaleX, width = tip.offsetWidth;
      tip.style.left = `${px + 12 + width > holder.clientWidth ? Math.max(0, px - 12 - width) : px + 12}px`; tip.style.top = '-6px';
    });
    overlay.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  window.MiniCharts = { render, series };
})();
