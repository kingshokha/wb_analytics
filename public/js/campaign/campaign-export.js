'use strict';
// --- Детализация кампании: выгрузка истории за период ---

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const exportState = { presets: [], started: 0, timer: 0, chunks: 0, index: 0, phase: '', reason: '', waitUntil: 0, failed: 0 };
function buildExportPresets() {
  // «Сегодня» — по Москве (UTC+3), как в кабинете WB; дальше календарная арифметика идёт по этой дате.
  const msk = new Date(Date.now() + 3 * 3_600_000),
    today = new Date(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate());
  const start31 = new Date(today);
  start31.setDate(start31.getDate() - 30);
  const list = [
    { value: 'last31', label: 'Последние 31 день', from: isoDate(start31), to: isoDate(today) },
    { value: 'this-month', label: 'Этот месяц', from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(today) }
  ];
  for (let i = 1; i <= 12; i++) {
    const first = new Date(today.getFullYear(), today.getMonth() - i, 1),
      last = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
    list.push({
      value: `month-${i}`,
      label: `${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`,
      from: isoDate(first),
      to: isoDate(last)
    });
  }
  exportState.presets = list;
  const select = $('#exportPreset'),
    from = $('#exportFrom'),
    to = $('#exportTo');
  select.innerHTML =
    list.map(item => `<option value="${item.value}">${esc(item.label)}</option>`).join('') + '<option value="custom">Свой период</option>';
  from.min = to.min = list[list.length - 1].from;
  from.max = to.max = isoDate(today);
  const applyPreset = () => {
    const item = list.find(entry => entry.value === select.value);
    if (item) {
      from.value = item.from;
      to.value = item.to;
    }
  };
  select.onchange = applyPreset;
  from.onchange = to.onchange = () => {
    const match = list.find(entry => entry.from === from.value && entry.to === to.value);
    select.value = match ? match.value : 'custom';
  };
  select.value = 'last31';
  applyPreset();
}
// Пояснение, если период выгрузки обрезан по жизни кампании.
function exportLifeNote(event) {
  const period = event.period,
    active = event.activePeriod,
    created = createdDate(event.createdAt);
  if (!period) return '';
  if (!active)
    return created
      ? `Кампания создана ${created}, за выбранный период статистики у неё нет`
      : 'За выбранный период статистики у кампании нет';
  const parts = [];
  if (active.from > period.from) parts.push(`с ${date(active.from)} — даты создания`);
  if (active.to < period.to) parts.push(`по ${date(active.to)} — дату завершения`);
  return parts.length ? `Запрошено ${parts.join(', ')}` : '';
}
function formatSeconds(total) {
  return total >= 60 ? `${Math.floor(total / 60)} мин ${total % 60} сек` : `${total} сек`;
}
function exportRequestsSent(s, now) {
  if (s.phase === 'start') return 0;
  if (s.phase === 'wait' && now < s.waitUntil) return s.index;
  if (s.phase === 'finalize') return s.chunks;
  return s.index + 1;
}
function renderExportProgress() {
  const s = exportState,
    now = Date.now();
  if (s.silent) return;
  const saved = s.storedDays ? ` · из сохранённого: ${s.storedDays} дн.` : '',
    life = s.lifeNote ? ` · ${s.lifeNote}` : '';
  if (s.phase === 'start' && !s.known) {
    $('#exportProgress').textContent = 'Проверяем сохранённую статистику…';
    return;
  }
  if (s.chunks === 0) {
    $('#exportProgress').textContent =
      `${s.storedDays ? 'Все дни уже сохранены, запросы к WB не нужны' : 'Запросы к WB не нужны'}${life}${s.phase === 'finalize' ? ' · подставляем названия и фото товаров…' : ''}`;
    return;
  }
  let text = `Запросы: ${exportRequestsSent(s, now)} из ${s.chunks}${saved}${life}`;
  if (s.phase === 'finalize') {
    text += ' · подставляем названия и фото товаров…';
  } else if (s.phase !== 'start') {
    const waiting = s.phase === 'wait' ? Math.max(0, s.waitUntil - now) : 0;
    const current = s.phase === 'received' ? 0 : 1000;
    const next = Math.max(0, s.chunks - s.index - 1) * 21000;
    const eta = Math.ceil((waiting + current + next) / 1000);
    text += eta <= 3 ? ' · осталось несколько секунд' : ` · осталось примерно ${formatSeconds(eta)}`;
  }
  $('#exportProgress').textContent = text;
}
function handleExportEvent(event) {
  const s = exportState;
  if (event.type === 'start') {
    s.chunks = event.chunks;
    s.storedDays = Number(event.storedDays || 0);
    s.known = true;
    s.phase = 'start';
    s.lifeNote = exportLifeNote(event);
  }
  if (event.type === 'request') {
    s.index = event.index;
    s.phase = 'request';
  }
  if (event.type === 'wait') {
    s.index = event.index;
    s.phase = 'wait';
    s.reason = event.reason;
    s.waitUntil = Date.now() + Number(event.ms || 0);
  }
  if (event.type === 'chunk') {
    s.index = event.index;
    s.phase = 'received';
    if (!event.ok) s.failed++;
  }
  if (event.type === 'finalize') s.phase = 'finalize';
  if (event.type === 'error') throw new Error(event.error || 'Не удалось выгрузить статистику');
  renderExportProgress();
  return event.type === 'result' ? event : null;
}

// silent — автообновление: тот же период, что выгружен последним, без прогресса и блокировки кнопок;
// выбранные запросы, позиции и прошлый период не сбрасываются, при ошибке остаются прежние данные.
async function exportHistory(silent = false) {
  const button = $('#exportHistory'),
    controls = [button, $('#exportPreset'), $('#exportFrom'), $('#exportTo')];
  const from = silent ? exportState.loaded?.from : $('#exportFrom').value,
    to = silent ? exportState.loaded?.to : $('#exportTo').value;
  if (silent && (!from || !to)) return;
  if (!from || !to) return alert('Выберите даты начала и конца выгрузки');
  if (from > to) return alert('Дата начала должна быть не позже даты конца');
  if (silent) {
    exportState.silent = true;
    exportState.running = true;
    try {
      await exportHistoryRun(from, to, true);
    } catch {
      /* тихо: остаются прежние данные */
    } finally {
      exportState.silent = false;
      exportState.running = false;
    }
    return;
  }
  Object.assign(exportState, {
    started: Date.now(),
    chunks: 0,
    index: 0,
    phase: 'start',
    reason: '',
    waitUntil: 0,
    failed: 0,
    storedDays: 0,
    known: false,
    lifeNote: '',
    running: true
  });
  controls.forEach(control => (control.disabled = true));
  button.textContent = 'Выгрузка…';
  renderExportProgress();
  clearInterval(exportState.timer);
  exportState.timer = setInterval(renderExportProgress, 250);
  try {
    const result = await exportHistoryRun(from, to, false);
    clearInterval(exportState.timer);
    const took = formatSeconds(Math.max(1, Math.round((Date.now() - exportState.started) / 1000)));
    const saved = result.storedDays ? ` · из сохранённого: ${result.storedDays} дн.` : '';
    const life = exportState.lifeNote ? ` · ${exportState.lifeNote}` : '';
    $('#exportProgress').textContent = exportState.failed
      ? `Готово за ${took} · запросов без данных: ${exportState.failed} из ${exportState.chunks}${saved}${life}`
      : `Готово за ${took} · запросов к WB: ${exportState.chunks}${saved}${life}`;
  } catch (e) {
    clearInterval(exportState.timer);
    $('#exportProgress').textContent = `Ошибка: ${e.message}`;
  } finally {
    clearInterval(exportState.timer);
    controls.forEach(control => (control.disabled = false));
    button.textContent = 'Выгрузить';
    exportState.running = false;
  }
}
async function exportHistoryRun(from, to, silent) {
  const q = new URLSearchParams({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '', from, to });
  const response = await fetch(`/api/advertising/campaign/history?${q}`);
  if (!response.ok || !response.body) throw new Error('Не удалось начать выгрузку');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    result = null;
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) result = handleExportEvent(JSON.parse(line)) || result;
    }
    if (done) break;
  }
  if (!result) throw new Error('Выгрузка прервалась без результата');
  exportState.loaded = { from, to };
  state.rows = result.campaign.daily || [];
  state.productDaily = result.productDaily || [];
  state.setupProducts = new Map(
    (result.setup?.bids || []).map(item => [String(item.nmId), { name: item.name, vendorCode: item.vendorCode }])
  );
  state.activity = result.activity || null;
  state.campaignCreatedAt = result.campaign?.createdAt || '';
  renderMeta(result.campaign);
  loadBudget();
  renderSummary(result.campaign);
  renderSetup(result.setup);
  renderOptions();
  renderChart();
  renderTable();
  renderProductTable();
  renderCampaignMinis();
  loadPositions(result.activePeriod || result.period, silent);
  loadChartEvents();
  $('#campaignTitle').textContent = result.campaign.name || `Кампания #${result.campaign.id}`;
  document.title = `${$('#campaignTitle').textContent} — WB Pulse`;
  renderCampaignHeader(result);
  state.period = result.activePeriod || result.period;
  loadZones();
  if (!silent) fetchZonesFromExtension(true);
  if (silent) {
    if (!keywords.loading) loadKeywords(state.period, true, true);
  } else {
    loadKeywords(state.period);
    loadPrevious(result.period, result.campaign);
  }
  $('#periodLabel').textContent = `${date(result.period.from)} — ${date(result.period.to)}${result.folder ? ` · ${result.folder}` : ''}`;
  if (silent)
    $('#autoRefreshNote').textContent =
      `Обновлено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · автообновление раз в 2 минуты`;
  return result;
}
