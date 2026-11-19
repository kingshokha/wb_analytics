'use strict';

// --- Запуск и пауза кампании, места показа: подтверждение в общем окне, ошибка WB показывается там же ---
// Без run окно только сообщает (одна кнопка «Понятно»).
function openActionConfirm({ title, text, note, button, kind, run }) {
  $('#confirmTitle').textContent = title;
  $('#confirmBody').innerHTML =
    `<p>${esc(text)}</p>${note ? `<small>${esc(note)}</small>` : ''}<p class="confirm-error" id="confirmError" hidden></p>` +
    `<div class="confirm-buttons">${run ? `<button type="button" class="secondary" data-confirm-close>Отмена</button><button type="button" class="${kind}" id="confirmRun">${esc(button)}</button>` : '<button type="button" class="secondary" data-confirm-close>Понятно</button>'}</div>`;
  $('#confirmModal').hidden = false;
  if (!run) return;
  $('#confirmRun').onclick = async () => {
    const runButton = $('#confirmRun'),
      error = $('#confirmError');
    runButton.disabled = true;
    runButton.textContent = 'Отправляем в WB…';
    error.hidden = true;
    try {
      await run();
      closeConfirm();
    } catch (e) {
      error.textContent = `Не удалось: ${e.message}`;
      error.hidden = false;
      runButton.disabled = false;
      runButton.textContent = button;
    }
  };
}
async function postCampaignAction(path, body) {
  const response = await fetch(`/api/advertising/campaign/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cabinet: params.get('cabinet') || 'demo', id: params.get('id') || '', confirm: true, ...body })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Ошибка ${response.status}`);
  return result;
}
document.addEventListener('click', event => {
  if (event.target.closest('[data-budget-add]')) {
    openBudgetDeposit();
    return;
  }
  const statusButton = event.target.closest('[data-campaign-status]');
  if (statusButton) {
    const pause = statusButton.dataset.campaignStatus === 'pause';
    const run = async () => {
      const result = await postCampaignAction('status', { action: pause ? 'pause' : 'start' });
      renderMeta({ ...state.campaignMeta, status: result.status });
      if (state.setup) renderSetup(state.setup);
    };
    openActionConfirm(
      pause
        ? {
            title: 'Поставить кампанию на паузу?',
            text: 'Кампания сразу перестанет показываться в WB. Запустить её снова можно здесь же кнопкой «Запустить».',
            button: 'Поставить на паузу',
            kind: 'danger',
            run
          }
        : {
            title: 'Запустить кампанию?',
            text: 'Кампания начнёт показываться в WB по текущим ставкам и местам показа.',
            note: 'WB проверит бюджет кампании: если его не хватает, запуск не пройдёт — пополните бюджет в кабинете WB.',
            button: 'Запустить',
            kind: 'include',
            run
          }
    );
    return;
  }
  const placementSwitch = event.target.closest('[data-placement]');
  if (!placementSwitch || placementSwitch.disabled || !state.setup) return;
  const key = placementSwitch.dataset.placement,
    current = state.setup.placements || {},
    on = !current[key],
    where = PLACEMENT_LABELS[key];
  const next = { search: Boolean(current.search), recommendations: Boolean(current.recommendations), [key]: on };
  if (!next.search && !next.recommendations) {
    openActionConfirm({
      title: 'Нельзя выключить оба места показа',
      text: 'Хотя бы одно место показа должно остаться включённым. Чтобы остановить показы совсем, поставьте кампанию на паузу.'
    });
    return;
  }
  openActionConfirm({
    title: on ? `Включить показы в ${where}?` : `Выключить показы в ${where}?`,
    text: on
      ? `Кампания начнёт показываться в ${where} по текущим ставкам товаров.`
      : `Кампания перестанет показываться в ${where}. Ставки товаров сохранятся, включить показы можно здесь же.`,
    note: 'Изменение сразу применяется в кабинете WB.',
    button: on ? 'Включить' : 'Выключить',
    kind: on ? 'include' : 'danger',
    run: async () => {
      const result = await postCampaignAction('placements', next);
      state.setup = { ...state.setup, placements: result.placements };
      renderSetup(state.setup);
    }
  });
});
$('#keywordSearch').oninput = event => {
  keywords.search = event.target.value;
  keywords.page = 1;
  renderKeywords();
};
$('#keywordStatusFilter').addEventListener('click', event => {
  const button = event.target.closest('[data-keyword-filter]');
  if (!button) return;
  keywords.statusFilter = button.dataset.keywordFilter;
  keywords.page = 1;
  document
    .querySelectorAll('#keywordStatusFilter [data-keyword-filter]')
    .forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderKeywords();
});
$('#keywordRefresh').onclick = () => loadKeywords(keywords.data?.period || state.period, true);
