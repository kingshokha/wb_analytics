'use strict';
// --- Детализация кампании: шапка, переименование, история настроек ---

// --- Шапка: название ведёт в кампанию в кабинете продвижения WB, номер рядом копируется по клику ---
function renderCampaignHeader(result) {
  const id = result.campaign.id,
    period = result.period,
    link = $('#campaignWbLink'),
    idButton = $('#campaignId');
  if (result.folder && /^\d+$/.test(String(id)))
    link.href = `https://cmp.wildberries.ru/campaigns/edit/${encodeURIComponent(id)}?from=${period.from}T00:00:00Z&to=${period.to}T00:00:00Z`;
  else link.removeAttribute('href');
  idButton.textContent = id;
  idButton.dataset.copy = id;
  idButton.hidden = false;
  $('#campaignRename').hidden = Boolean(result.demo) || (params.get('cabinet') || 'demo') === 'demo';
}
// --- Переименование кампании: карандаш у названия → поле ввода → POST /api/advertising/campaign/rename (WB /adv/v0/rename) ---
function openRename() {
  const title = $('#campaignTitle').textContent.trim(),
    h1 = $('.page-title h1');
  if (!h1 || $('#renameForm')) return;
  h1.hidden = true;
  h1.insertAdjacentHTML(
    'afterend',
    `<form class="rename-form" id="renameForm"><input id="renameInput" maxlength="100" value="${esc(title)}" aria-label="Новое название кампании"><button type="submit" class="primary">Сохранить</button><button type="button" data-rename-cancel>Отмена</button><small id="renameNote">До 100 символов. Название сразу поменяется в кабинете WB.</small></form>`
  );
  const input = $('#renameInput');
  input.focus();
  input.select();
}
function closeRename() {
  $('#renameForm')?.remove();
  const h1 = $('.page-title h1');
  if (h1) h1.hidden = false;
}
$('#campaignRename').onclick = openRename;
document.addEventListener('click', event => {
  if (event.target.closest('[data-rename-cancel]')) closeRename();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#renameForm')) closeRename();
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'renameForm') return;
  event.preventDefault();
  const form = event.target,
    input = $('#renameInput'),
    note = $('#renameNote'),
    name = input.value.replace(/\s+/g, ' ').trim();
  if (!name) {
    note.textContent = 'Название не может быть пустым';
    note.classList.add('error');
    return;
  }
  if (name === $('#campaignTitle').textContent.trim()) {
    closeRename();
    return;
  }
  form.querySelectorAll('button,input').forEach(control => {
    control.disabled = true;
  });
  note.classList.remove('error');
  note.textContent = 'Отправляем в WB…';
  try {
    const response = await fetch('/api/advertising/campaign/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '', name })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'WB не принял название');
    $('#campaignTitle').textContent = result.name;
    document.title = `${result.name} — WB Pulse`;
    closeRename();
  } catch (e) {
    form.querySelectorAll('button,input').forEach(control => {
      control.disabled = false;
    });
    note.textContent = `Не удалось: ${e.message}`;
    note.classList.add('error');
    input.focus();
  }
});
// --- «Размещение и ставки» → «История»: изменения статуса, настроек и ставок кампании из Google Таблицы ---
const SHEET_MONEY = /₽/;
// У ставок пустое значение — место показа выключено (таблица пишет «—»).
function historyValue(what, value, section) {
  if (value === '' || value == null || value === '—') return section === 'Ставки' ? 'выкл.' : '—';
  return SHEET_MONEY.test(what) && Number.isFinite(Number(value)) ? money(Number(value)) : esc(String(value));
}
// Сначала история с компьютера (data/Sheet) — окно открывается сразу; потом дозагрузка из Google Таблицы.
let setupHistoryRequest = 0;
function openSetupHistory() {
  const modal = $('#setupHistoryModal'),
    body = $('#setupHistoryBody'),
    note = $('#setupHistoryNote'),
    hint = $('#setupHistoryHint'),
    id = params.get('id') || '',
    request = ++setupHistoryRequest;
  modal.hidden = false;
  body.innerHTML = '<p class="history-empty">Загрузка…</p>';
  note.textContent = `Кампания № ${id}`;
  hint.textContent = '';
  window.SheetSync?.load(
    `/api/sheet-history?${new URLSearchParams({ id, sections: 'Реклама,Ставки,Ключевые слова' })}`,
    (data, phase, error, previous) => {
      if (request !== setupHistoryRequest || modal.hidden) return;
      hint.textContent = SheetSync.hint(data, phase, error, previous);
      if (data) renderSetupHistory(data);
      else if (error) body.innerHTML = `<p class="history-empty">Не удалось загрузить историю: ${esc(error.message)}</p>`;
    }
  );
}
function renderSetupHistory(data) {
  const body = $('#setupHistoryBody'),
    note = $('#setupHistoryNote'),
    id = params.get('id') || '';
  {
    if (!data.configured) {
      body.innerHTML =
        '<p class="history-empty">Google Таблица не подключена: впишите в .env сайта WB_SHEET_URL и WB_SHEET_KEY (ключ — в таблице «WB → Ключ для сайта») и перезапустите сервер. Инструкция — google-sheets/README.md.</p>';
      return;
    }
    const since = data.since
      ? `таблица следит за изменениями с ${new Date(data.since).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      : '';
    note.textContent = `Кампания № ${id}${since ? ` · ${since}` : ''} · записывается раз в час`;
    const items = (data.items || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!items.length) {
      body.innerHTML =
        '<p class="history-empty">Изменений статуса, настроек, ставок и минус-фраз пока нет. Таблица сравнивает каждое обновление с предыдущим и записывает только то, что поменялось.</p>';
      return;
    }
    let lastDay = '';
    body.innerHTML = items
      .map(item => {
        const at = new Date(item.at),
          day =
            at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) +
            (at.getFullYear() !== new Date().getFullYear() ? ` ${at.getFullYear()}` : ''),
          time = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const head = day !== lastDay ? `<div class="history-day">${esc(day)}</div>` : '';
        lastDay = day;
        // Ставки и ключевые слова — по артикулам: в подписи таблицы «Кампания · артикул (артикул продавца)».
        // У ключевых слов в «Было / Стало» — число исключённых запросов, а какие — в «Что изменилось».
        const product = ['Ставки', 'Ключевые слова'].includes(item.section)
          ? String(item.title || '')
              .split(' · ')
              .slice(1)
              .join(' · ')
          : '';
        const what = String(item.what || '').replace(/, ₽$/, '');
        const list = /^Артикулы WB:/.test(item.what || '');
        const values = list
          ? ''
          : `<span class="was">${historyValue(item.what, item.before, item.section)}</span> → <b>${historyValue(item.what, item.after, item.section)}</b>`;
        return `${head}<div class="history-item"><time>${esc(time)}</time><div><b>${esc(what)}</b>${product ? ` · артикул ${esc(product)}` : ''}${values ? `<br>${values}` : ''}</div></div>`;
      })
      .join('');
  }
}
function closeSetupHistory() {
  $('#setupHistoryModal').hidden = true;
}
$('#setupHistoryButton').onclick = openSetupHistory;
document.addEventListener('click', event => {
  if (event.target.closest('[data-setup-history-close]')) closeSetupHistory();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#setupHistoryModal').hidden) closeSetupHistory();
});
