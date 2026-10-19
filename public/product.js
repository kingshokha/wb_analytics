// --- Детализация товара (product.html): открывается из «Воронки» кнопкой со стрелкой у товара ---
// Главный график — столбцы «органика + реклама» по дням с переключателем показателя; над ним флажки запуска (▶) и
// остановки (■) рекламных кампаний с этим товаром, как в примере «Много кампаний одновременно», и ваши отметки
// (смена цены, СПП, ставки — WB их историю не отдаёт). Ниже — мини-графики показателей, у каждого своя шкала,
// и таблица кампаний. Данные — /api/product-detail, отметки — /api/product-notes. Пока вкладка видна,
// страница тихо обновляется раз в 2 минуты.
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const params = new URLSearchParams(location.search);
  const cabinet = params.get('cabinet') || 'demo', nmId = params.get('nmId') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const finite = value => value != null && Number.isFinite(Number(value));
  const fmtNum = value => finite(value) ? Math.round(value).toLocaleString('ru-RU') : '—';
  const fmtRub = value => finite(value) ? `${Math.round(value).toLocaleString('ru-RU')} ₽` : '—';
  const fmtPct = value => finite(value) ? `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: value < 10 ? 1 : 0 })}%` : '—';
  const fmtDec = value => finite(value) ? Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—';
  const fmtShort = value => { const v = Math.abs(value); return v >= 1e6 ? `${(value / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн` : v >= 1e4 ? `${Math.round(value / 1000).toLocaleString('ru-RU')} тыс` : v >= 1000 ? `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс` : value.toLocaleString('ru-RU', { maximumFractionDigits: v < 10 ? 1 : 0 }); };
  const mskToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const addDays = (iso, days) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
  const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const ddmm = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  const dayLong = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const hhmm = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  function niceScale(max, count) {
    if (!(max > 0)) return { max: 1, step: 1 };
    const raw = max / count, power = 10 ** Math.floor(Math.log10(raw)), fraction = raw / power;
    let step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
    if (max >= count && step < 1) step = 1;
    return { max: Math.ceil(max / step) * step, step };
  }

  // Показатели главного графика: воронка товара за день и её рекламная часть.
  const METRICS = [
    { key: 'openCount', ad: 'clicks', label: 'Переходы', title: 'Переходы в карточку по дням', fmt: fmtNum, adName: 'клики рекламы' },
    { key: 'cartCount', ad: 'carts', label: 'Корзины', title: 'Корзины по дням', fmt: fmtNum, adName: 'корзины с рекламы' },
    { key: 'orderCount', ad: 'orders', label: 'Заказы, шт', title: 'Заказы по дням', fmt: fmtNum, adName: 'рекламные заказы' },
    { key: 'orderSum', ad: 'revenue', label: 'Заказы, ₽', title: 'Сумма заказов по дням', fmt: fmtRub, adName: 'сумма рекламных заказов' }
  ];
  // Цвета кампаний не совпадают с синим «органики» и оранжевым «рекламы».
  const CAMPAIGN_COLORS = ['#7651e5', '#18875c', '#c2412d', '#0e8ea8', '#b5367f', '#8a6a1f', '#5d6b12', '#555b66', '#c79a12', '#2f9e9e'];
  // setNotices / addNotice — из notifications.js (колокольчик); если файл не загрузился, страница работает без него.
  const setNotices = (...args) => window.setNotices?.(...args), addNotice = (...args) => window.addNotice?.(...args);
  const view = { data: null, notes: [], metric: 'cartCount', colors: new Map(), hoverCampaign: null, editing: null, confirmDelete: null, request: 0, pollTimer: 0, autoAt: Date.now(), loading: false };
  try { const saved = localStorage.getItem('wb-product-metric'); if (METRICS.some(item => item.key === saved)) view.metric = saved; } catch { /* без памяти — по умолчанию корзины */ }

  // --- Период: из ссылки (как в «Воронке»), не длиннее 93 дней и не позже сегодняшнего дня по Москве ---
  const fromInput = $('#periodFrom'), toInput = $('#periodTo'), preset = $('#periodPreset');
  {
    const today = mskToday(), valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
    let to = valid(params.get('to')) ? params.get('to') : today; if (to > today) to = today;
    let from = valid(params.get('from')) ? params.get('from') : addDays(to, -13);
    if (from > to) from = addDays(to, -13);
    if (daysBetween(from, to) > 93) from = addDays(to, -92);
    fromInput.min = toInput.min = addDays(today, -364); fromInput.max = toInput.max = today;
    fromInput.value = from; toInput.value = to; syncPreset();
  }
  function syncPreset() {
    const length = daysBetween(fromInput.value, toInput.value), match = toInput.value === mskToday() && [...preset.options].find(option => Number(option.value) === length);
    preset.value = match ? match.value : 'custom';
  }
  let loadTimer = 0;
  function scheduleLoad() {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      if (!fromInput.value || !toInput.value) return;
      if (fromInput.value > toInput.value) return status('Начало периода позже конца', true);
      if (daysBetween(fromInput.value, toInput.value) > 93) return status('Выберите период не длиннее 93 дней', true);
      syncPreset(); view.autoAt = Date.now();
      const next = new URLSearchParams(location.search); next.set('from', fromInput.value); next.set('to', toInput.value); history.replaceState(null, '', `?${next}`);
      load();
    }, 60);
  }
  preset.onchange = () => { if (preset.value === 'custom') return; const to = mskToday(); toInput.value = to; fromInput.value = addDays(to, -(Number(preset.value) - 1)); scheduleLoad(); };
  fromInput.addEventListener('change', scheduleLoad); toInput.addEventListener('change', scheduleLoad);

  function status(text, error = false) { const line = $('#statusLine'); line.textContent = text; line.classList.toggle('error', error); }

  // --- Загрузка ---
  async function load({ silent = false, live = false } = {}) {
    const request = ++view.request; clearTimeout(view.pollTimer);
    if (!silent) { view.loading = true; status('Загрузка… Первая выгрузка рекламы из WB может занять до минуты.'); }
    try {
      const q = new URLSearchParams({ cabinet, nmId, from: fromInput.value, to: toInput.value, ...(live ? { live: '1' } : {}) });
      const response = await fetch(`/api/product-detail?${q}`), data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить данные товара');
      if (request !== view.request) return;
      view.data = data;
      view.colors = new Map(data.campaigns.map((campaign, index) => [campaign.id, CAMPAIGN_COLORS[index % CAMPAIGN_COLORS.length]]));
      render();
      const pending = data.sync?.pending || 0;
      status(pending ? `Догружаем воронку из WB: осталось ${pending} дн., примерно ${Math.max(5, data.sync.etaSeconds || 0)} сек — график дорисуется сам` : `Обновлено ${hhmm()} · автообновление раз в 2 минуты`);
      // Пока сервер догружает дни воронки, переспрашиваем его каждые 5 секунд.
      if (pending) view.pollTimer = setTimeout(() => { if (request === view.request) load({ silent: true }); }, 5000);
    } catch (error) {
      if (request !== view.request) return;
      if (!silent || !view.data) status(`Ошибка: ${error.message}`, true);
      addNotice('product', `Не удалось загрузить данные товара: ${error.message}`);
      if (!view.data) $('#mainChart').innerHTML = `<div class="chart-empty">${esc(error.message)}</div>`;
    } finally { if (request === view.request) view.loading = false; }
  }
  async function loadNotes() {
    try {
      const response = await fetch(`/api/product-notes?${new URLSearchParams({ cabinet, nmId })}`), data = await response.json();
      if (!response.ok) throw new Error(data.error);
      view.notes = data.notes || [];
    } catch { view.notes = []; }
    if (view.data) { renderMain(); renderMinis(); }
    renderNotes();
  }
  async function saveNote(body) {
    const response = await fetch('/api/product-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cabinet, nmId, ...body }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось сохранить отметку');
    view.notes = data.notes || []; view.editing = null; view.confirmDelete = null;
    renderNotes(); if (view.data) { renderMain(); renderMinis(); }
  }

  function render() { renderHead(); renderSwitch(); renderMain(); renderNotes(); renderMinis(); renderCampaigns(); }
  function renderHead() {
    const { product, demo } = view.data;
    document.title = `${product.name} — WB Pulse`;
    $('#productTitle').textContent = product.name;
    const photo = $('#productPhoto'); if (product.photo) photo.src = product.photo; else photo.removeAttribute('src');
    $('#productMeta').innerHTML = [product.vendorCode ? `<b>${esc(product.vendorCode)}</b>` : '', `<a href="https://www.wildberries.ru/catalog/${encodeURIComponent(product.nmId)}/detail.aspx" target="_blank" rel="noopener noreferrer" title="Открыть товар на WB">nmID ${esc(product.nmId)}</a>`,
      product.subject ? esc(product.subject) : '', product.brand ? esc(product.brand) : '', demo ? 'демо-данные' : ''].filter(Boolean).map(item => `<span>${item}</span>`).join('');
    // Предупреждения WB и ошибки — в колокольчике (notifications.js), как на основном сайте.
    setNotices('product', 'load', view.data.warnings || []);
    setNotices('product', 'sync', view.data.sync?.lastError ? [`Догрузка воронки из WB: ${view.data.sync.lastError}`] : [], 'error');
  }
  function renderSwitch() {
    $('#metricSwitch').innerHTML = METRICS.map(item => `<button type="button" data-metric="${item.key}" aria-pressed="${item.key === view.metric}">${item.label}</button>`).join('');
  }
  $('#metricSwitch').addEventListener('click', event => {
    const button = event.target.closest('[data-metric]'); if (!button) return;
    view.metric = button.dataset.metric; try { localStorage.setItem('wb-product-metric', view.metric); } catch { /* не запомним — не страшно */ }
    renderSwitch(); renderMain();
  });

  // Периоды работы кампаний: дни, когда у товара были показы, клики или расход. WB не отдаёт, когда кампания была
  // включена, а у товара с небольшим трафиком показы бывают не каждый день — поэтому перерыв до 2 дней остановкой
  // не считается, иначе флажки «запуск / остановка» стояли бы почти на каждом дне.
  const GAP_DAYS = 2;
  function campaignPeriods(days) {
    const periods = new Map();
    days.forEach((day, index) => day.campaigns.forEach(id => {
      const list = periods.get(id) || []; const last = list.at(-1);
      if (last && index - last.to - 1 <= GAP_DAYS) last.to = index; else list.push({ from: index, to: index });
      periods.set(id, list);
    }));
    return periods;
  }
  const campaignName = id => view.data.campaigns.find(item => item.id === id)?.name || `Кампания #${id}`;
  const notesNumbered = () => view.notes.map((note, index) => ({ ...note, number: index + 1 }));

  // --- Главный график: столбцы органика + реклама, флажки кампаний, отметки ---
  function renderMain() {
    const box = $('#mainChart'), data = view.data; if (!data || !box) return;
    const metric = METRICS.find(item => item.key === view.metric);
    $('#mainTitle').textContent = `${metric.title}: органика и реклама`;
    const days = data.days, count = days.length, W = Math.max(320, box.clientWidth || 900);
    const stacks = days.map(day => {
      const ad = Number(day.ads?.[metric.ad] || 0);
      if (!day.funnel) return { total: null, ad, organic: 0 };
      const total = Number(day.funnel[metric.key] || 0);
      return { total, ad, organic: Math.max(0, total - ad) };
    });
    const mL = 46, mR = 10, mB = 26, sw = (W - mL - mR) / count, x = index => mL + sw * (index + .5);
    // Флажки: ▶ — первый день кампании, ■ — первый день без неё; края периода событием не считаются.
    // Три и больше одинаковых события в один день — один общий серый флажок.
    // Показы всего один день внутри периода — один флажок ◆ вместо пары ▶ и ■ рядом. Кампания, у которой показы
    // есть уже в первый день, получает флажок у левого края: ▶, если её создали в этот день, иначе ↤ — работала
    // и раньше (иначе кампания, включённая до начала периода, на графике была бы не видна).
    const events = [], periods = campaignPeriods(days);
    for (const [id, list] of periods) for (const period of list) {
      if (period.from === period.to && period.from > 0 && period.to < count - 1) { events.push({ id, kind: 'blip', day: period.from }); continue; }
      if (period.from === 0) {
        const campaign = data.campaigns.find(item => item.id === id), created = String(campaign?.startedAt || campaign?.createdAt || '').slice(0, 10);
        events.push({ id, kind: created && created >= days[0].date ? 'start' : 'ongoing', day: 0 });
      }
      if (period.from > 0) events.push({ id, kind: 'start', day: period.from });
      if (period.to < count - 1) events.push({ id, kind: 'stop', day: period.to + 1 });
    }
    const groups = new Map(); events.forEach(event => { const key = `${event.kind}:${event.day}`; groups.set(key, [...(groups.get(key) || []), event]); });
    const flags = [];
    for (const group of groups.values()) {
      if (group.length >= 3) flags.push({ kind: group[0].kind, day: group[0].day, merged: group.map(event => event.id) });
      else flags.push(...group);
    }
    const order = { ongoing: 0, stop: 1, start: 2, blip: 3 };
    flags.sort((a, b) => a.day - b.day || order[a.kind] - order[b.kind]);
    const maxLength = W < 560 ? 9 : 18, ends = [];
    for (const flag of flags) {
      const name = flag.merged ? `${flag.merged.length} ${flag.merged.length < 5 ? 'кампании' : 'кампаний'}` : campaignName(flag.id);
      flag.text = `${{ start: '▶', stop: '■', blip: '◆', ongoing: '↤' }[flag.kind]} ${name.length > maxLength ? `${name.slice(0, maxLength - 1)}…` : name}`;
      flag.width = flag.text.length * 6.4 + 14; flag.x = mL + flag.day * sw;
      flag.fx = Math.max(mL, Math.min(flag.x, W - mR - flag.width));
      let level = ends.findIndex(end => end < flag.fx - 4); if (level < 0) { level = ends.length; ends.push(0); }
      ends[level] = flag.fx + flag.width; flag.level = level;
    }
    const flagBand = ends.length ? ends.length * 20 + 4 : 0, mT = 10 + flagBand, ph = W < 560 ? 220 : 280, H = mT + ph + mB;
    const notes = notesNumbered().filter(note => note.date >= days[0].date && note.date <= days.at(-1).date);
    const noteTop = notes.length ? 24 : 0;
    const max = Math.max(1, ...stacks.map(stack => stack.organic + stack.ad)), scale = niceScale(max * 1.04, W < 560 ? 3 : 4);
    const y = value => mT + noteTop + (ph - noteTop) - value / scale.max * (ph - noteTop);
    let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(metric.title)}: органика и реклама">`;
    for (let value = 0; value <= scale.max + 1e-9; value += scale.step) {
      if (value > 0) svg += `<line class="gridline" x1="${mL}" x2="${W - mR}" y1="${y(value)}" y2="${y(value)}"/>`;
      svg += `<text class="axis" x="${mL - 8}" y="${y(value) + 4}" text-anchor="end">${value ? fmtShort(value) : 0}</text>`;
    }
    svg += `<rect class="hover-col" x="0" y="${mT}" width="${sw}" height="${ph}" fill="#17211d" opacity="0" rx="4"/>`;
    // Заливка периодов кампаний — видна, только пока наведён её флажок или строка в таблице.
    for (const [id, list] of periods) for (const period of list) svg += `<rect class="fillrect" data-fill="${id}" x="${mL + period.from * sw}" y="${mT}" width="${(period.to - period.from + 1) * sw}" height="${ph}" fill="${view.colors.get(id) || '#555b66'}"/>`;
    const barWidth = Math.max(2, Math.min(34, sw * .72));
    stacks.forEach((stack, index) => {
      const left = x(index) - barWidth / 2, organicTop = y(stack.organic), adTop = y(stack.organic + stack.ad);
      if (stack.organic > 0) svg += `<rect x="${left}" y="${organicTop}" width="${barWidth}" height="${y(0) - organicTop}" fill="var(--organic)"/>`;
      if (stack.ad > 0) svg += `<rect x="${left}" y="${adTop}" width="${barWidth}" height="${organicTop - adTop}" fill="var(--ads)"/>`;
      if (stack.total === null) svg += `<rect x="${left}" y="${y(0) - 3}" width="${barWidth}" height="3" fill="#d3d9d5"><title>Воронка за ${ddmm(days[index].date)} ещё загружается</title></rect>`;
    });
    svg += `<line class="baseline" x1="${mL}" x2="${W - mR}" y1="${y(0)}" y2="${y(0)}"/>`;
    // Флажки кампаний: пунктир от флажка до низа графика цветом кампании. Клик — детализация кампании в новой вкладке;
    // у общего флажка — список его кампаний.
    for (const flag of flags) {
      const top = 10 + flag.level * 20, color = flag.merged ? '#555b66' : view.colors.get(flag.id) || '#555b66';
      const when = ddmm(days[flag.day].date), ids = flag.merged || [flag.id];
      const what = { start: flag.merged ? 'Запущены' : 'первый день с показами', stop: flag.merged ? 'Остановлены' : 'первый день без показов', blip: flag.merged ? 'Показы только в этот день' : 'показы только в этот день', ongoing: flag.merged ? 'Работали уже на начало периода' : 'работала уже на начало периода' }[flag.kind];
      const removed = data.campaigns.find(item => item.id === flag.id)?.removed ? ' (сейчас товар из кампании убран)' : '';
      const title = flag.merged ? `${what} ${when}: ${flag.merged.map(campaignName).join(', ')} — нажмите, чтобы выбрать кампанию` : `${campaignName(flag.id)}${removed}: ${what}${flag.kind === 'ongoing' ? '' : ` ${when}`} — нажмите, чтобы открыть детализацию кампании`;
      const body = `<title>${esc(title)}</title><line x1="${flag.x}" x2="${flag.x}" y1="${top + 16}" y2="${mT + ph}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/>` +
        `<rect x="${flag.fx}" y="${top}" width="${flag.width}" height="16" rx="4" fill="${color}"/><text class="flag-text" x="${flag.fx + 7}" y="${top + 12}">${esc(flag.text)}</text>`;
      svg += flag.merged ? `<g class="camp flag-merged" data-campaigns="${ids.join(',')}" data-day="${flag.day}" data-kind="${flag.kind}" data-x="${flag.fx}" data-y="${top + 18}" tabindex="0" role="button">${body}</g>`
        : `<a class="camp" data-campaigns="${flag.id}" href="${esc(campaignLink(flag.id))}" target="_blank" rel="noopener noreferrer">${body}</a>`;
    }
    // Ваши отметки: номер в кружке наверху графика и пунктир; короткая подпись — если хватает места до следующей.
    const byDay = new Map();
    notes.forEach((note, index) => {
      const day = days.findIndex(item => item.date === note.date), level = byDay.get(day) || 0; byDay.set(day, level + 1);
      const cx = x(day), cy = mT + 11 + level * 20, next = notes.slice(index + 1).find(item => item.date !== note.date);
      const room = (next ? x(days.findIndex(item => item.date === next.date)) : W - mR) - cx - 20, label = note.text.length > 26 ? `${note.text.slice(0, 25)}…` : note.text;
      svg += `<g class="note-mark"><title>${esc(`${note.number}. ${ddmm(note.date)} — ${note.text}`)}</title>${level ? '' : `<line x1="${cx}" x2="${cx}" y1="${cy}" y2="${mT + ph}" stroke="#555b66" stroke-width="1.2" stroke-dasharray="3 3"/>`}` +
        `<circle cx="${cx}" cy="${cy}" r="9" fill="#17211d"/><text class="note-num" x="${cx}" y="${cy + 3.6}" text-anchor="middle">${note.number}</text>` +
        (!level && room > label.length * 6.3 ? `<text x="${cx + 14}" y="${cy + 4}" font-size="11.5" font-weight="700" fill="#17211d">${esc(label)}</text>` : '') + '</g>';
    });
    const every = Math.max(1, Math.ceil(52 / sw));
    days.forEach((day, index) => { if ((count - 1 - index) % every === 0) svg += `<text class="axis" x="${x(index)}" y="${mT + ph + 18}" text-anchor="middle">${ddmm(day.date)}</text>`; });
    svg += `<rect class="overlay" x="${mL}" y="${mT}" width="${W - mL - mR}" height="${ph + mB}" fill="transparent" style="cursor:crosshair"/></svg>`;
    box.innerHTML = `${svg}<div class="chart-tooltip" hidden></div><div class="flag-menu" role="menu" hidden></div>`;
    applyCampaignFocus();
    const svgEl = box.querySelector('svg'), tip = box.querySelector('.chart-tooltip'), column = svgEl.querySelector('.hover-col');
    const pick = event => { const rect = svgEl.getBoundingClientRect(); return Math.max(0, Math.min(count - 1, Math.floor(((event.clientX - rect.left) / rect.width * W - mL) / sw))); };
    svgEl.querySelector('.overlay').addEventListener('pointermove', event => {
      const index = pick(event), day = days[index], stack = stacks[index], total = stack.organic + stack.ad;
      column.setAttribute('x', mL + index * sw); column.setAttribute('opacity', '.05');
      const share = value => total ? ` · ${Math.round(value / total * 100)}%` : '';
      const active = day.campaigns.map(id => `<div class="row"><i style="background:${view.colors.get(id) || '#555b66'}"></i>${esc(campaignName(id))}</div>`).join('');
      const dayNotes = notesNumbered().filter(note => note.date === day.date).map(note => `<div class="row"><i style="background:#17211d;border-radius:50%"></i>${note.number}. ${esc(note.text)}</div>`).join('');
      tip.innerHTML = `<strong>${esc(dayLong(day.date))}</strong>` +
        (stack.total === null ? '<div class="row muted">Воронка за этот день ещё загружается</div>' :
          `<div class="row"><i style="background:var(--organic)"></i>Органика<b>${metric.fmt(stack.organic)}${share(stack.organic)}</b></div>`) +
        `<div class="row"><i style="background:var(--ads)"></i>Реклама<b>${metric.fmt(stack.ad)}${share(stack.ad)}</b></div>` +
        (stack.total !== null ? `<div class="sep"></div><div class="row">Всего по воронке<b>${metric.fmt(stack.total)}</b></div>` : '') +
        `<div class="sep"></div>${active ? `<div class="row muted">Реклама включена: ${day.campaigns.length}</div>${active}` : '<div class="row muted">Реклама с этим товаром не показывалась</div>'}` +
        (dayNotes ? `<div class="sep"></div>${dayNotes}` : '') + '<div class="sep"></div><div class="row muted">Клик — добавить отметку на этот день</div>';
      tip.hidden = false;
      const rect = svgEl.getBoundingClientRect(), scaleX = rect.width / W, cx = x(index) * scaleX, width = tip.offsetWidth;
      tip.style.left = `${cx + 16 + width > box.clientWidth ? Math.max(0, cx - 16 - width) : cx + 16}px`; tip.style.top = `${mT * scaleX}px`;
    });
    svgEl.querySelector('.overlay').addEventListener('pointerleave', () => { tip.hidden = true; column.setAttribute('opacity', '0'); });
    svgEl.querySelector('.overlay').addEventListener('click', event => { view.editing = 'new'; view.newDate = days[pick(event)].date; renderNotes(); $('#notes input[type=text]')?.focus(); });
  }
  // Подсветка кампаний: view.hoverCampaign — список id (флажок, общий флажок или строка таблицы) или null.
  function applyCampaignFocus() {
    const box = $('#mainChart'), ids = view.hoverCampaign ? view.hoverCampaign.map(String) : null;
    box.classList.toggle('focus', Boolean(ids));
    box.querySelectorAll('.camp').forEach(group => group.classList.toggle('on', Boolean(ids) && group.dataset.campaigns.split(',').some(id => ids.includes(id))));
    box.querySelectorAll('.fillrect').forEach(rect => rect.classList.toggle('on', Boolean(ids) && ids.includes(rect.dataset.fill)));
    document.querySelectorAll('#campaignsBody tr[data-campaign]').forEach(row => row.classList.toggle('on', Boolean(ids) && ids.includes(row.dataset.campaign)));
  }
  function setCampaignHover(ids) {
    const key = ids ? ids.join(',') : '';
    if (key === (view.hoverCampaign || []).join(',')) return;
    view.hoverCampaign = ids && ids.length ? ids : null; applyCampaignFocus();
  }
  const campaignLink = id => `/campaign.html?${new URLSearchParams({ cabinet, id, from: fromInput.value, to: toInput.value })}`;
  // Наведение на флажок подсвечивает период кампании; общий флажок по клику открывает список своих кампаний.
  const chartBox = $('#mainChart');
  chartBox.addEventListener('pointerover', event => { if (event.target.closest('.flag-menu')) return; const flag = event.target.closest('[data-campaigns]'); setCampaignHover(flag ? flag.dataset.campaigns.split(',').map(Number) : null); });
  chartBox.addEventListener('pointerleave', () => setCampaignHover(null));
  function openFlagMenu(flag) {
    const menu = chartBox.querySelector('.flag-menu'), svg = chartBox.querySelector('svg'); if (!menu || !svg) return;
    const scale = svg.getBoundingClientRect().width / Number(svg.viewBox.baseVal.width), ids = flag.dataset.campaigns.split(',').map(Number);
    const what = { start: 'Запущены', stop: 'Остановлены', blip: 'Показы только в этот день', ongoing: 'Работали уже на начало периода' }[flag.dataset.kind];
    menu.innerHTML = `<p>${esc(what)}${flag.dataset.kind === 'ongoing' ? '' : ` ${ddmm(view.data.days[Number(flag.dataset.day)].date)}`} — открыть детализацию:</p>` +
      ids.map(id => `<a role="menuitem" href="${esc(campaignLink(id))}" target="_blank" rel="noopener noreferrer"><i style="background:${view.colors.get(id) || '#555b66'}"></i>${esc(campaignName(id))}</a>`).join('');
    menu.hidden = false;
    menu.style.left = `${Math.max(0, Math.min(Number(flag.dataset.x) * scale, chartBox.clientWidth - menu.offsetWidth))}px`; menu.style.top = `${Number(flag.dataset.y) * scale}px`;
    menu.querySelector('a')?.focus();
  }
  chartBox.addEventListener('click', event => { const flag = event.target.closest('.flag-merged'); if (flag) { event.stopPropagation(); openFlagMenu(flag); } });
  chartBox.addEventListener('keydown', event => { const flag = event.target.closest('.flag-merged'); if (flag && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openFlagMenu(flag); } });
  document.addEventListener('click', event => { const menu = chartBox.querySelector('.flag-menu'); if (menu && !menu.hidden && !event.target.closest('.flag-menu')) menu.hidden = true; });
  document.addEventListener('keydown', event => { const menu = chartBox.querySelector('.flag-menu'); if (event.key === 'Escape' && menu && !menu.hidden) menu.hidden = true; });

  // --- Отметки под графиком ---
  function noteForm(note) {
    const date = note?.date || view.newDate || toInput.value;
    return `<form class="note-form" data-note-form="${note ? esc(note.id) : 'new'}"><input type="date" value="${esc(date)}" max="${mskToday()}" aria-label="Дата отметки" required>` +
      `<input type="text" maxlength="300" value="${esc(note?.text || '')}" placeholder="Например: СПП 24% → 12%, цена 1 690 → 1 950 ₽" aria-label="Текст отметки" required>` +
      `<button type="submit" class="primary">${note ? 'Сохранить' : 'Добавить'}</button><button type="button" data-note-cancel>Отмена</button></form>`;
  }
  function renderNotes() {
    const box = $('#notes'), from = fromInput.value, to = toInput.value;
    box.innerHTML = notesNumbered().map(note => view.editing === note.id ? noteForm(note) :
      `<div class="note" data-note-id="${esc(note.id)}"><span class="num">${note.number}</span><span class="date">${ddmm(note.date)}${note.date.slice(0, 4) !== to.slice(0, 4) ? `.${note.date.slice(2, 4)}` : ''}</span><span class="text">${esc(note.text)}${note.date < from || note.date > to ? ' <span class="hint">(вне выбранного периода)</span>' : ''}</span>` +
      `<span class="actions">${view.confirmDelete === note.id ? '<button type="button" class="icon-btn danger" data-note-delete-yes>Удалить</button><button type="button" class="icon-btn" data-note-delete-no>Отмена</button>' : '<button type="button" class="icon-btn" data-note-edit>Изменить</button><button type="button" class="icon-btn danger" data-note-delete>Удалить</button>'}</span></div>`).join('') +
      (view.editing === 'new' ? noteForm(null) : '<button type="button" class="note-add" data-note-add>+ Отметка на графике</button>');
  }
  $('#notes').addEventListener('click', event => {
    const id = event.target.closest('[data-note-id]')?.dataset.noteId;
    if (event.target.closest('[data-note-add]')) { view.editing = 'new'; view.newDate = ''; renderNotes(); $('#notes input[type=text]')?.focus(); return; }
    if (event.target.closest('[data-note-cancel]')) { view.editing = null; renderNotes(); return; }
    if (event.target.closest('[data-note-edit]')) { view.editing = id; view.confirmDelete = null; renderNotes(); $('#notes input[type=text]')?.focus(); return; }
    if (event.target.closest('[data-note-delete]')) { view.confirmDelete = id; renderNotes(); return; }
    if (event.target.closest('[data-note-delete-no]')) { view.confirmDelete = null; renderNotes(); return; }
    if (event.target.closest('[data-note-delete-yes]')) saveNote({ noteId: id, remove: true }).catch(error => { status(error.message, true); addNotice('product', `Отметка не удалена: ${error.message}`); });
  });
  $('#notes').addEventListener('submit', event => {
    const form = event.target.closest('[data-note-form]'); if (!form) return;
    event.preventDefault();
    const [date, text] = form.querySelectorAll('input'), noteId = form.dataset.noteForm === 'new' ? undefined : form.dataset.noteForm;
    form.querySelectorAll('button').forEach(button => { button.disabled = true; });
    saveNote({ noteId, date: date.value, text: text.value }).catch(error => { status(error.message, true); addNotice('product', `Отметка не сохранена: ${error.message}`); form.querySelectorAll('button').forEach(button => { button.disabled = false; }); });
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && view.editing) { view.editing = null; renderNotes(); } });

  // --- Мини-графики: у каждого своя шкала; итог за период и среднее в день (у долей — значение за период) ---
  const funnelValue = key => day => day.funnel ? Number(day.funnel[key] || 0) : null;
  const adValue = key => day => Number(day.ads?.[key] || 0);
  const MINI_GROUPS = [
    { title: 'Воронка', items: [
      { label: 'Переходы в карточку', num: funnelValue('openCount'), fmt: fmtNum },
      { label: 'Корзины', num: funnelValue('cartCount'), fmt: fmtNum },
      { label: 'Заказы, шт', num: funnelValue('orderCount'), fmt: fmtNum },
      { label: 'Заказы, ₽', num: funnelValue('orderSum'), fmt: fmtRub },
      { label: 'Выкупы, шт', num: funnelValue('buyoutCount'), fmt: fmtNum },
      { label: 'Выкупы, ₽', num: funnelValue('buyoutSum'), fmt: fmtRub },
      { label: 'В избранное', num: funnelValue('addToWishlistCount'), fmt: fmtNum },
      { label: 'Конверсия в корзину', num: funnelValue('cartCount'), den: funnelValue('openCount'), scale: 100, fmt: fmtPct },
      { label: 'Конверсия в заказ', num: funnelValue('orderCount'), den: funnelValue('cartCount'), scale: 100, fmt: fmtPct },
      { label: 'Средний чек заказа', num: funnelValue('orderSum'), den: funnelValue('orderCount'), scale: 1, fmt: fmtRub }
    ] },
    { title: 'Реклама', items: [
      { label: 'Показы', num: adValue('views'), fmt: fmtNum },
      { label: 'Клики', num: adValue('clicks'), fmt: fmtNum },
      { label: 'CTR', num: adValue('clicks'), den: adValue('views'), scale: 100, fmt: fmtPct },
      { label: 'CPC', num: adValue('spend'), den: adValue('clicks'), scale: 1, fmt: fmtRub },
      { label: 'Расход', num: adValue('spend'), fmt: fmtRub },
      { label: 'Рекламные заказы', num: adValue('orders'), fmt: fmtNum },
      { label: 'ДРР по рекламным заказам', num: adValue('spend'), den: adValue('revenue'), scale: 100, fmt: fmtPct },
      { label: 'ДРР от всех заказов', num: adValue('spend'), den: funnelValue('orderSum'), scale: 100, fmt: fmtPct }
    ] },
    { title: 'Доля рекламы', items: [
      { label: 'В переходах', num: adValue('clicks'), den: funnelValue('openCount'), scale: 100, fmt: fmtPct, cap: true },
      { label: 'В корзинах', num: adValue('carts'), den: funnelValue('cartCount'), scale: 100, fmt: fmtPct, cap: true },
      { label: 'В заказах', num: adValue('orders'), den: funnelValue('orderCount'), scale: 100, fmt: fmtPct, cap: true }
    ] },
    { title: 'Позиция в поиске', items: [
      { label: 'Средняя позиция', num: day => finite(day.avgPosition) ? Number(day.avgPosition) : null, average: true, invert: true, fmt: fmtDec,
        averageNote: 'меньше — выше в поиске', emptyNote: 'нет данных по поисковым кластерам' }
    ] }
  ];
  // Рисует общий модуль mini-charts.js; ваши отметки — тонкие пунктиры, чтобы было видно, что после них изменилось.
  function renderMinis() {
    const data = view.data; if (!data) return;
    const groups = MINI_GROUPS.map(group => ({ ...group, items: group.items.map(item => ({ ...item, axis: item.fmt === fmtPct ? '%' : '' })) }));
    window.MiniCharts?.render($('#minis'), groups, data.days, { markers: view.notes.map(note => note.date) });
  }

  // --- Кампании товара ---
  function renderCampaigns() {
    const body = $('#campaignsBody'), list = view.data.campaigns;
    if (!list.length) { body.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted)">За период у товара не было рекламы</td></tr>'; return; }
    body.innerHTML = list.map(campaign => `<tr data-campaign="${campaign.id}"><td><div class="camp-name"><i style="background:${view.colors.get(campaign.id)}"></i><a href="${esc(campaignLink(campaign.id))}" target="_blank" rel="noopener noreferrer" title="Открыть детализацию кампании">${esc(campaign.name)}</a><small>№ ${esc(campaign.id)}</small>${campaign.removed ? '<small class="removed" title="Показы за период были, но сейчас товара в настройках кампании нет">убран из кампании</small>' : ''}</div></td>` +
      `<td>${fmtNum(campaign.activeDays)}</td><td>${fmtNum(campaign.views)}</td><td>${fmtNum(campaign.clicks)}</td><td>${fmtPct(campaign.ctr)}</td><td>${fmtRub(campaign.spend)}</td><td>${fmtNum(campaign.carts)}</td><td>${fmtNum(campaign.orders)}</td><td>${fmtRub(campaign.revenue)}</td><td>${campaign.revenue ? fmtPct(campaign.drr) : '—'}</td></tr>`).join('');
  }
  $('#campaignsBody').addEventListener('pointerover', event => { const row = event.target.closest('tr[data-campaign]'); setCampaignHover(row ? [Number(row.dataset.campaign)] : null); });
  $('#campaignsBody').addEventListener('pointerleave', () => setCampaignHover(null));

  // Перерисовка по ширине окна.
  let lastWidth = 0;
  new ResizeObserver(() => { const width = $('#mainChart').clientWidth; if (view.data && width !== lastWidth) { lastWidth = width; renderMain(); renderMinis(); } }).observe($('#mainChart'));

  // Автообновление: раз в 2 минуты, пока вкладка видна и не открыта форма отметки. Сегодняшний день воронки
  // сервер перезапросит у WB (live), прошлые дни и прошлые куски рекламы берутся из сохранённого.
  setInterval(() => {
    if (document.hidden || view.loading || view.editing || Date.now() - view.autoAt < 2 * 60_000) return;
    view.autoAt = Date.now(); load({ silent: true, live: true });
  }, 10_000);

  if (!/^\d{1,15}$/.test(nmId)) { status('В ссылке нет артикула товара', true); $('#mainChart').innerHTML = '<div class="chart-empty">Откройте товар из «Воронки» — кнопкой со стрелкой слева от товара.</div>'; return; }
  load(); loadNotes();
})();
