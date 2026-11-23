// --- «Карточки товаров»: «Склеить» выбранные в одну склейку и «Объединить по 30 шт» ---
// Подключается после js/cards/cards.js: cardsView, cardRows, cardGluePlan и прочее оттуда — только внутри функций.

// «Склеить» — выбранные карточки в одну склейку (POST /api/cards/move, метод WB moveNm). Склеить можно только карточки
// одного предмета, в склейке — не больше 30. Основа — склейка, которую выбрали целиком (все её карточки отмечены): из
// склеек, выбранных частично, отмеченные карточки переходят в неё. Целиком выбранных несколько — самая большая из них;
// ни одной — самая большая склейка среди выбранных. Карточки из других склеек уходят из них — окно об этом предупреждает.
function cardMergePlan(picked) {
  const all = cardsView.data?.cards || [],
    subjects = [...new Set(picked.map(card => card.subjectName || '—'))];
  const groupOf = imt => all.filter(card => card.imtID === imt),
    pickedIds = new Set(picked.map(card => card.nmID));
  const glued = picked.filter(card => card.groupSize > 1);
  const groups = [...new Set(glued.map(card => card.imtID))]
    .map(imt => ({ imt, cards: groupOf(imt) }))
    .map(group => ({ ...group, whole: group.cards.every(card => pickedIds.has(card.nmID)) }));
  const bySize = (a, b) => b.cards.length - a.cards.length,
    whole = groups.filter(group => group.whole).sort(bySize);
  const chosen = whole[0] || [...groups].sort(bySize)[0] || null;
  const target = chosen ? chosen.imt : (picked[0]?.imtID ?? null);
  const base = target == null ? [] : groupOf(target),
    move = picked.filter(card => card.imtID !== target);
  const leaving = move.filter(card => card.groupSize > 1);
  return {
    subjects,
    target,
    base,
    move,
    leaving,
    glued,
    whole: Boolean(chosen?.whole),
    total: new Set([...base, ...move].map(card => card.nmID)).size
  };
}
// Прогноз оценки склейки после объединения. На WB отзывы склеенных карточек общие: к оценкам склейки-основы по звёздам
// добавляются оценки переносимых карточек. Оценку WB считает по своей формуле, поэтому прогноз — сдвиг её текущей оценки
// на столько, на сколько меняется простая средняя по звёздам.
function cardMergeRatings(plan) {
  const target = (cardsView.data?.cards || []).find(card => card.imtID === plan.target);
  if (!target?.glueStars) return '<p class="muted card-merge-note">Оценки склеек ещё не загружены с WB — прогноза оценки пока нет.</p>';
  const sum = stars => stars.reduce((total, value) => total + value, 0),
    avg = stars => {
      const count = sum(stars);
      return count ? stars.reduce((total, value, index) => total + value * (index + 1), 0) / count : null;
    };
  const add = [0, 0, 0, 0, 0];
  let missing = 0;
  plan.move.forEach(card => {
    if (!card.fbStars) {
      missing++;
      return;
    }
    card.fbStars.forEach((value, index) => {
      add[index] += value;
    });
  });
  const base = target.glueStars,
    after = base.map((value, index) => value + add[index]);
  const now = target.glueRating ?? avg(base),
    shift = avg(base) != null && avg(after) != null ? avg(after) - avg(base) : 0,
    estimate = now != null ? now + shift : avg(after);
  const nowCount = target.glueCount ?? sum(base),
    addCount = sum(add),
    fmt = value => (value == null ? '—' : `★ ${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const tone = Math.abs(shift) < 0.005 ? '' : shift < 0 ? ' down' : ' up';
  return (
    `<div class="card-merge-rating"><div><span>Склейка-основа сейчас</span><b>${fmt(now)}</b><small>${fmtNum(nowCount)} ${cardRatingWord(nowCount)}</small></div>` +
    `<div><span>Добавятся оценки</span><b>${addCount ? fmt(avg(add)) : '—'}</b><small>${addCount ? `${fmtNum(addCount)} ${cardRatingWord(addCount)}` : 'у переносимых карточек оценок нет'}</small></div>` +
    `<div><span>После объединения, примерно</span><b class="card-merge-estimate${tone}">${fmt(estimate)}</b><small>${fmtNum(nowCount + addCount)} ${cardRatingWord(nowCount + addCount)}${tone ? ` · ${shift > 0 ? '+' : '−'}${Math.abs(shift).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}` : ''}</small></div></div>` +
    `<p class="muted card-merge-note">На WB отзывы склеенных карточек общие. Прогноз — по оценкам по звёздам; WB считает оценку по своей формуле, поэтому итог может немного отличаться.${plan.leaving.length ? ' Склейки, из которых уходят карточки, потеряют их оценки.' : ''}${missing ? ` У ${fmtNum(missing)} ${cardWord(missing)} оценки ещё не загружены — в прогнозе их нет.` : ''}</p>`
  );
}
function openCardMerge() {
  const picked = cardPicked(cardRows());
  if (picked.length < 2) return toast('Выберите хотя бы две карточки');
  const plan = cardMergePlan(picked),
    name = card => `${escapeHtml(card.vendorCode || card.nmID)} <small>${escapeHtml(card.nmID)}</small>`;
  let problem = '';
  if (plan.subjects.length > 1)
    problem = `Склеить можно только карточки одного предмета, а выбраны: ${plan.subjects.map(escapeHtml).join(', ')}.`;
  else if (!plan.move.length) problem = 'Выбранные карточки уже в одной склейке.';
  else if (plan.total > CARD_GLUE_LIMIT)
    problem = `В склейке будет ${fmtNum(plan.total)} карточек, а WB разрешает не больше ${CARD_GLUE_LIMIT}.`;
  const warn = plan.glued.length
    ? `<div class="card-merge-warn"><b>Уже в склейке: ${fmtNum(plan.glued.length)} ${cardWord(plan.glued.length)}.</b> ${plan.base.length > 1 ? `Основа — склейка из ${fmtNum(plan.base.length)} ${pluralRu(plan.base.length, ['карточки', 'карточек', 'карточек'])}${plan.whole ? ', выбранная целиком' : ' — самая большая среди выбранных'}, в неё перейдут остальные выбранные.` : ''}${
        plan.leaving.length
          ? ` Эти карточки уйдут из своих склеек: ${plan.leaving
              .slice(0, 20)
              .map(card => `${escapeHtml(card.vendorCode || card.nmID)} (склейка из ${fmtNum(card.groupSize)})`)
              .join(', ')}${plan.leaving.length > 20 ? ` и ещё ${fmtNum(plan.leaving.length - 20)}` : ''}.`
          : ''
      }</div>`
    : '';
  openModal(`<div class="card-merge"><p class="eyebrow">Карточки товаров</p><h2>Склеить ${fmtNum(picked.length)} ${cardWord(picked.length)}</h2>
    <p class="muted">Выбранные карточки станут одной склейкой — на WB это один товар с выбором вариантов. Изменение сразу уйдёт в WB.${plan.subjects.length === 1 ? ` Предмет: ${escapeHtml(plan.subjects[0])}.` : ''}${!problem ? ` В склейке будет ${fmtNum(plan.total)} ${cardWord(plan.total)}.` : ''}</p>
    ${warn}${problem ? `<p class="card-merge-problem">${problem}</p>` : cardMergeRatings(plan)}
    <ul class="card-merge-list">${picked
      .slice(0, 30)
      .map(
        card =>
          `<li>${name(card)} — ${escapeHtml((card.title || '').slice(0, 60))}${card.groupSize > 1 ? ` <span class="card-glue-chip">склейка · ${fmtNum(card.groupSize)}</span>` : ''}</li>`
      )
      .join('')}${picked.length > 30 ? `<li class="muted">…и ещё ${fmtNum(picked.length - 30)}</li>` : ''}</ul>
    <p class="card-tag-note" id="cardMergeNote" role="status"></p>
    <div class="modal-actions"><button type="button" data-modal-close-inline>Отмена</button><button type="button" class="primary" id="cardMergeConfirm"${problem ? ' disabled' : ''}>${plan.leaving.length ? 'Склеить всё равно' : 'Склеить'}</button></div></div>`);
  if (problem) return;
  $('#cardMergeConfirm').onclick = async () => {
    const button = $('#cardMergeConfirm'),
      note = $('#cardMergeNote'),
      cabinet = state.cabinet;
    button.disabled = true;
    button.textContent = 'Склеиваем…';
    note.classList.remove('error');
    note.textContent = '';
    try {
      await api('/api/cards/move', {
        method: 'POST',
        body: JSON.stringify({ cabinet, confirm: true, nmIds: plan.move.map(card => card.nmID), targetIMT: plan.target })
      });
      if (cardsView.key === cabinet && cardsView.data) {
        const list = cardsView.data.cards,
          ids = new Set(plan.move.map(card => card.nmID)),
          touched = new Set([plan.target, ...plan.move.map(card => card.imtID)]);
        list.forEach(card => {
          if (ids.has(card.nmID)) card.imtID = plan.target;
        });
        touched.forEach(imt => {
          const size = list.filter(card => card.imtID === imt).length;
          list.forEach(card => {
            if (card.imtID === imt) card.groupSize = size;
          });
        });
        picked.forEach(card => cardsView.selected.delete(card.nmID));
      }
      closeModal();
      toast(`Склеено: ${fmtNum(plan.total)} ${cardWord(plan.total)} в одной склейке`);
      if (state.cabinet === cabinet) {
        renderCards();
        loadCards(false, true);
      }
    } catch (e) {
      button.disabled = false;
      button.textContent = 'Склеить';
      note.textContent = `Не удалось: ${e.message}`;
      note.classList.add('error');
    }
  };
}
// Окно склейки: scope 'selected' — выбранные карточки предмета, 'all' — все карточки без склейки по фильтрам, по всем предметам.
const cardGlue = { scope: 'selected', plan: null, run: null };
function cardGlueList() {
  const rows = cardRows();
  return cardGlue.scope === 'all' ? rows.filter(cardSelectable) : cardChosen(rows);
}
function openCardGlueBatch(scope) {
  if (cardGlue.run) return toast('Склейка ещё идёт — дождитесь окончания');
  cardGlue.scope = scope;
  openModal(
    `<div class="card-glue-batch"><p class="eyebrow">Карточки товаров</p><h2>Объединить по ${CARD_GLUE_LIMIT} шт</h2><p class="muted" id="cardGlueScope"></p>
    <div class="card-glue-options"><label><input type="radio" name="cardGlueMode" value="title"> Похожие по названию</label><label><input type="radio" name="cardGlueMode" value="order"> Подряд по таблице</label><label><input type="checkbox" id="cardGlueFill"> Дополнять неполные склейки до ${CARD_GLUE_LIMIT}</label></div>
    <p class="muted card-glue-hint" id="cardGlueHint"></p><p class="card-glue-total" id="cardGlueTotal"></p><ol class="card-glue-plan" id="cardGluePlan"></ol>
    <p class="card-tag-note" id="cardGlueNote" role="status"></p><div class="modal-actions"><button type="button" data-modal-close-inline id="cardGlueCancel">Отмена</button><button type="button" class="primary" id="cardGlueConfirm">Объединить</button></div></div>`,
    true
  );
  $('#cardGlueConfirm').onclick = runCardGlueBatch;
  renderCardGluePlan();
}
function renderCardGluePlan() {
  if (!$('.card-glue-batch') || cardGlue.run) return;
  const v = cardsView,
    list = cardGlueList(),
    plan = cardGluePlan(list, v.glueMode, v.glueFill),
    all = cardGlue.scope === 'all',
    subjects = new Set(list.map(card => card.subjectID)).size;
  cardGlue.plan = plan;
  $$('[name=cardGlueMode]').forEach(input => {
    input.checked = input.value === v.glueMode;
  });
  $('#cardGlueFill').checked = v.glueFill;
  $('#cardGlueScope').textContent = all
    ? `Все предметы по текущим фильтрам: ${fmtNum(list.length)} ${cardWord(list.length)} без склейки в ${fmtNum(subjects)} ${pluralRu(subjects, ['предмете', 'предметах', 'предметах'])}. Каждый предмет склеивается отдельно — WB не склеивает разные предметы. Изменения сразу уйдут в WB.`
    : `Выбрано ${fmtNum(list.length)} ${cardWord(list.length)} без склейки в ${fmtNum(subjects)} ${pluralRu(subjects, ['предмете', 'предметах', 'предметах'])}. Каждый предмет склеивается отдельно. Изменения сразу уйдут в WB.`;
  $('#cardGlueHint').textContent =
    (v.glueMode === 'title'
      ? 'Вместе — карточки одного предмета с одинаковым названием (регистр и знаки препинания не важны), в порядке таблицы. Карточка с уникальным названием остаётся одна.'
      : 'Вместе — подряд в порядке таблицы, по 30.') +
    (v.glueFill
      ? v.glueMode === 'title'
        ? ' Сначала карточки добавляются в неполные склейки, где есть товар с тем же названием.'
        : ' Сначала карточки добавляются в неполные склейки того же предмета.'
      : '');
  $('#cardGlueTotal').textContent = cardGlueSummary(plan);
  const short = text => (text.length > 60 ? `${text.slice(0, 59)}…` : text),
    name = card => escapeHtml(card.vendorCode || card.nmID),
    SHOWN = 300;
  $('#cardGluePlan').innerHTML =
    plan.steps
      .slice(0, SHOWN)
      .map(step => {
        const count = step.cards.length,
          first = step.cards[0];
        return `<li>${all ? `<b>${escapeHtml(step.subject)}</b> · ` : ''}${step.before ? `дополнить склейку ${fmtNum(step.before)} → ${fmtNum(step.before + count)}: +${fmtNum(count)}` : `новая · ${fmtNum(count)} ${cardWord(count)}`} — «${escapeHtml(short(first.title || 'Без названия'))}» <small>${name(first)}${count > 1 ? ` … ${name(step.cards.at(-1))}` : ''}</small></li>`;
      })
      .join('') + (plan.steps.length > SHOWN ? `<li class="muted">…и ещё ${fmtNum(plan.steps.length - SHOWN)}</li>` : '');
  $('#cardGlueConfirm').disabled = !plan.steps.length;
  $('#cardGlueConfirm').textContent =
    plan.steps.length > 1
      ? `Объединить: ${fmtNum(plan.steps.length)} ${pluralRu(plan.steps.length, ['шаг', 'шага', 'шагов'])}`
      : 'Объединить';
}
// Шаги уходят в WB по очереди. Лимит Контента WB — 100 запросов в минуту, всплеск 5: первые 5 — сразу, дальше раз в 650 мс
// (на 429 сервер сам подождёт и повторит). Ошибка одного шага не останавливает остальные; три ошибки подряд — остановка.
async function runCardGlueBatch() {
  const steps = cardGlue.plan?.steps || [];
  if (!steps.length || cardGlue.run) return;
  const cabinet = state.cabinet,
    run = { stop: false },
    button = $('#cardGlueConfirm'),
    note = $('#cardGlueNote'),
    errors = [];
  cardGlue.run = run;
  $$('.card-glue-options input').forEach(input => {
    input.disabled = true;
  });
  $('#cardGlueCancel').textContent = 'Скрыть окно';
  note.classList.remove('error');
  button.textContent = 'Остановить';
  button.onclick = () => {
    run.stop = true;
    button.disabled = true;
    button.textContent = 'Останавливаем…';
  };
  let done = 0,
    streak = 0;
  for (const [index, step] of steps.entries()) {
    if (run.stop) break;
    note.textContent = `Отправляем ${fmtNum(index + 1)} из ${fmtNum(steps.length)}…${errors.length ? ` · не прошло: ${errors.length}` : ''}`;
    if (index >= 5) await new Promise(resolve => setTimeout(resolve, 650));
    try {
      await api('/api/cards/move', {
        method: 'POST',
        body: JSON.stringify({
          cabinet,
          confirm: true,
          nmIds: (step.before ? step.cards : step.cards.slice(1)).map(card => card.nmID),
          targetIMT: step.target
        })
      });
      done++;
      streak = 0;
      if (cardsView.key === cabinet && cardsView.data) {
        const ids = new Set(step.cards.map(card => card.nmID)),
          list = cardsView.data.cards;
        list.forEach(card => {
          if (ids.has(card.nmID)) {
            card.imtID = step.target;
            cardsView.selected.delete(card.nmID);
          }
        });
        const size = list.filter(card => card.imtID === step.target).length;
        list.forEach(card => {
          if (card.imtID === step.target) card.groupSize = size;
        });
      }
    } catch (e) {
      errors.push(`${step.subject} · ${step.cards[0].vendorCode || step.cards[0].nmID}: ${e.message}`);
      if (++streak >= 3) break;
    }
  }
  cardGlue.run = null;
  const rest = steps.length - done - errors.length,
    word = n => pluralRu(n, ['шаг', 'шага', 'шагов']);
  toast(`Склейка: готово ${fmtNum(done)} из ${fmtNum(steps.length)}`);
  if (note.isConnected) {
    if (!errors.length && !rest) closeModal();
    else {
      note.innerHTML = `Готово ${fmtNum(done)} из ${fmtNum(steps.length)}${rest ? ` · не отправлено ${fmtNum(rest)} ${word(rest)}${run.stop ? ' (остановлено)' : ' (три ошибки подряд — остановлено)'}` : ''}${errors.length ? `<br>Не прошло ${fmtNum(errors.length)}:<br>${errors.slice(0, 10).map(escapeHtml).join('<br>')}` : ''}`;
      note.classList.toggle('error', errors.length > 0);
      button.disabled = false;
      button.textContent = 'Закрыть';
      button.onclick = closeModal;
      $('#cardGlueCancel').classList.add('hidden');
    }
  }
  if (state.cabinet === cabinet) {
    renderCards();
    if (done) loadCards(false, true);
  }
}
