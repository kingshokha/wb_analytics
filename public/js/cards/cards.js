// --- «Карточки товаров»: все карточки кабинета, корзина и ошибки сохранения ---
// Данные — /api/cards (сервер: content-cards.js, метод WB «Список карточек товаров»), /api/cards/trash, /api/cards/errors.
// Карточка открывается на отдельной странице card.html — там её данные можно изменить. Здесь же — ярлыки продавца
// (создать, переименовать, удалить), восстановление карточек из корзины, склейка по 30 и копии выбранных карточек
// («Дублировать»). Новые карточки с нуля сайт не создаёт — так задумано.
// Файл подключается до app.js: $, state, api, escapeHtml и прочее из app.js используются только внутри функций.
const CARD_PROBLEMS = [
  ['', 'Все карточки'],
  ['nophoto', 'Без фото'],
  ['fewphoto', 'Меньше 3 фото'],
  ['desc', 'Описание короче 1000 символов'],
  ['dims', 'Габариты под вопросом']
];
const CARD_TAG_COLORS = [
  ['D1CFD7', 'серый'],
  ['FEE0E0', 'красный'],
  ['ECDAFF', 'фиолетовый'],
  ['E4EAFF', 'синий'],
  ['DEF1DD', 'зелёный'],
  ['FFECC7', 'жёлтый']
];
// Цвет полосы у карточек одной склейки: соседние группы — разными цветами.
const CARD_GLUE_COLORS = ['#9d77ff', '#318f68', '#f0a04b', '#277a70', '#e76464', '#5a7d9a'];
const cardsView = {
  data: null,
  key: '',
  error: '',
  tab: 'cards',
  trash: null,
  trashKey: '',
  errors: null,
  errorsKey: '',
  search: '',
  subject: '',
  brand: '',
  color: '',
  tag: '',
  problem: '',
  doc: '',
  glue: '',
  extras: { key: '', ratings: null, prices: null, ratingsError: '', pricesError: '', poll: 0 },
  sort: { key: 'updatedAt', dir: 'desc' },
  page: 1,
  pageSize: pageSizeFor('cards'),
  request: 0,
  poll: 0,
  selected: new Set(),
  lastSelected: null,
  shiftSelect: false,
  glueMode: 'title',
  glueFill: true
};
// Склейка по 30: в группе WB не больше 30 карточек (метод moveNm).
const CARD_GLUE_LIMIT = 30;

const cardDate = iso =>
  iso
    ? new Date(iso)
        .toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
        .replace(',', '')
    : '—';
const cardLink = nmId => `/card.html?${new URLSearchParams({ cabinet: state.cabinet, nmId })}`;
// Причины, по которым WB не принял карточку или документ: известные — по-русски, остальные — как есть.
const CARD_DOC_ERRORS = {
  documents_missing: 'нет нужных документов',
  documents_invalid: 'документ недействителен',
  document_missing: 'документ не загружен',
  document_not_found: 'документ не найден в реестре',
  document_inactive: 'у документа нет юридической силы',
  document_expired: 'истёк срок документа',
  document_type_mismatch: 'номер не соответствует типу документа',
  document_dates_mismatch: 'неверные даты в документе',
  applicant_mismatch: 'заявитель в документе и карточке различается',
  trade_name_mismatch: 'торговое наименование отличается от документа',
  tnved_missing: 'не указан код ТН ВЭД',
  supplier_inn_missing: 'не указан ИНН',
  supplier_not_registered: 'поставщик не найден в реестре',
  supplier_inactive: 'ошибка в статусе поставщика',
  product_group_not_registered: 'неверная товарная группа в маркировке',
  kiz_required: 'нельзя продавать без кода Честного знака',
  kiz_certificate_missing: 'нет подтверждения нанесения маркировки',
  unknown: 'проверка не пройдена'
};
const cardDocError = code => CARD_DOC_ERRORS[code] || code;
const CARD_DOC_TYPES = {
  1: 'сертификат соответствия',
  2: 'декларация о соответствии',
  3: 'свидетельство о госрегистрации',
  4: 'РУ на медизделия',
  5: 'РУ Республики Беларусь',
  7: 'данные о регистрации пестицида',
  8: 'данные о регистрации агрохимиката',
  9: 'РУ на лекарства'
};
// «Без КИЗ»: WB требует код Честного знака (needKiz), а продавец не подтвердил его нанесение (kizMarked), или проверка отклонила карточку по маркировке.
const cardNoKiz = card =>
  (card.needKiz && !card.kizMarked) || card.docErrors.some(code => code === 'kiz_required' || code === 'kiz_certificate_missing');
const cardDocKeys = card => [
  ...(cardNoKiz(card) ? ['kiz'] : []),
  ...(card.noTnved ? ['tnved'] : []),
  ...(card.verdict === 'fail' ? ['fail'] : []),
  ...(card.verdict === 'pending' ? ['pending'] : []),
  ...card.missingDocs.map(type => `missing:${type}`),
  ...card.docErrors.map(code => `error:${code}`)
];
const cardDocLabel = key =>
  key === 'kiz'
    ? 'Без КИЗ (Честный знак)'
    : key === 'tnved'
      ? 'Без ТН ВЭД'
      : key === 'fail'
        ? 'Проверка не пройдена'
        : key === 'pending'
          ? 'На проверке'
          : key.startsWith('missing:')
            ? `Нет: ${CARD_DOC_TYPES[key.slice(8)] || `документ типа ${key.slice(8)}`}`
            : `Ошибка: ${cardDocError(key.slice(6))}`;
// Пункты фильтра «Документы»: «Без КИЗ» и «Без ТН ВЭД» — всегда первыми, дальше — только то, что есть в кабинете;
// выбранный пункт остаётся в списке.
function cardDocOptions(cards, selected) {
  const counts = new Map([
    ['kiz', 0],
    ['tnved', 0],
    ['fail', 0],
    ['pending', 0]
  ]);
  cards.forEach(card => cardDocKeys(card).forEach(key => counts.set(key, (counts.get(key) || 0) + 1)));
  const fixed = ['kiz', 'tnved', 'fail', 'pending'],
    group = key => (fixed.includes(key) ? 0 : key.startsWith('missing:') ? 1 : 2);
  return [...counts]
    .filter(([key, count]) => key === 'kiz' || key === 'tnved' || count > 0 || key === selected)
    .sort((a, b) => group(a[0]) - group(b[0]) || (group(a[0]) ? b[1] - a[1] : fixed.indexOf(a[0]) - fixed.indexOf(b[0])))
    .map(([key, count]) => [key, `${cardDocLabel(key)} · ${fmtNum(count)}`]);
}
const cardWord = n => {
  const a = n % 100,
    b = n % 10;
  return a > 10 && a < 20 ? 'карточек' : b === 1 ? 'карточка' : b > 1 && b < 5 ? 'карточки' : 'карточек';
};
const cardTagChip = tag => `<span class="card-tag" style="--tag:#${escapeHtml(tag.color || 'D1CFD7')}">${escapeHtml(tag.name)}</span>`;

// Сервер отдаёт сохранённый список сразу, а свежий из WB грузит в фоне (у кабинета с тысячами карточек — минута-две).
// Пока он грузится (refreshing), страница переспрашивает: при самой первой загрузке — каждые 3 с и показывает
// карточки по ходу, потом — раз в 10 с, и подменяет список, когда свежий готов. Фильтры и страница остаются.
async function loadCards(force = false, silent = false) {
  const key = state.cabinet,
    request = ++cardsView.request;
  clearTimeout(cardsView.poll);
  if (!force && !silent && cardsView.key === key && cardsView.data) {
    renderCards();
    return;
  }
  if (cardsView.key !== key) {
    Object.assign(cardsView, {
      data: null,
      trash: null,
      errors: null,
      subject: '',
      brand: '',
      color: '',
      tag: '',
      doc: '',
      glue: '',
      page: 1
    });
    cardsView.selected.clear();
  }
  cardsView.key = key;
  cardsView.error = '';
  if (!silent) renderCards();
  const btn = $('#refresh');
  if (!silent) btn.classList.add('loading');
  try {
    const data = await api(`/api/cards?${new URLSearchParams({ cabinet: key, ...(force ? { force: '1' } : {}), ...cardsFilterQuery() })}`);
    if (request !== cardsView.request) return;
    cardsView.data = data;
    applyCardExtras();
    if (!data.loading) {
      setNotices('cards', 'load', data.warnings);
      loadCardExtras(key, force);
    }
    if (force) {
      cardsView.trash = null;
      cardsView.errors = null;
    }
    if (!data.loading) loadCardErrors(false);
    // Карточки по фильтру грузятся отдельно и быстро — пока они идут, спрашиваем чаще.
    // Пока с WB грузятся оценки склеек — тоже переспрашиваем, раз в 10 с.
    if (data.refreshing || data.feedbacks?.loading)
      cardsView.poll = setTimeout(
        () => {
          if (state.activePage === 'cards' && state.cabinet === key) loadCards(false, true);
        },
        data.loading || data.priority?.state === 'loading' ? 3000 : 10000
      );
  } catch (e) {
    if (request !== cardsView.request) return;
    if (!silent) {
      cardsView.error = e.message;
      addNotice('cards', `Карточки: ${e.message}`);
    }
  } finally {
    if (request === cardsView.request) {
      btn.classList.remove('loading');
      renderCards();
    }
  }
}
// Оценка и цена — не из метода карточек: оценка — из «Оценок товаров» (/api/ratings, рейтинг по отзывам; WB отдаёт
// 1000 товаров за запрос и не чаще 3 запросов в минуту, поэтому у большого кабинета — несколько минут, потом кэш 30 мин),
// цена со скидкой — из «Цен и скидок» (/api/prices; у товара с разными ценами размеров — цена первого размера, как там).
// Грузятся в фоне после списка карточек и подставляются по артикулу WB; ответ для другого кабинета отбрасывается.
function applyCardExtras() {
  const x = cardsView.extras,
    cards = cardsView.data?.cards;
  if (!cards || x.key !== cardsView.key) return;
  cards.forEach(card => {
    if (x.ratings) {
      const value = x.ratings.get(card.nmID);
      card.rating = value > 0 ? value : null;
    }
    if (x.prices) {
      const value = x.prices.get(card.nmID);
      card.price = value > 0 ? value : null;
    }
  });
}
function loadCardExtras(key, force = false) {
  const x = cardsView.extras;
  if (x.key !== key) {
    clearTimeout(x.poll);
    Object.assign(x, { key, ratings: null, prices: null, ratingsError: '', pricesError: '' });
  }
  const done = () => {
    if (cardsView.key !== key || x.key !== key) return false;
    applyCardExtras();
    if (state.activePage === 'cards') renderCards();
    return true;
  };
  if (force || (!x.ratings && !x.ratingsLoading)) {
    x.ratingsLoading = true;
    api(`/api/ratings?cabinet=${encodeURIComponent(key)}`)
      .then(
        data => {
          if (x.key !== key) return;
          x.ratings = new Map((data.items || []).map(item => [Number(item.nmId), item.feedbackRating]));
          x.ratingsError = '';
        },
        error => {
          if (x.key === key) x.ratingsError = error.message;
        }
      )
      .finally(() => {
        if (x.key === key) x.ratingsLoading = false;
        done();
      });
  }
  if (force || (!x.prices && !x.pricesLoading)) loadCardPrices(key, force);
}
// Цены сервер отдаёт по частям (partial): пока список не весь, переспрашиваем каждые 3 с. Если «Цены и скидки» уже
// загружены для этого кабинета — берём оттуда.
function loadCardPrices(key, force) {
  const x = cardsView.extras,
    ready = !force && state.pricesKey === key && state.prices && !state.prices.partial;
  const take = data => {
    x.prices = new Map((data.rows || []).map(row => [Number(row.nmId), row.discountedPrice]));
    x.pricesError = '';
  };
  if (ready) {
    take(state.prices);
    applyCardExtras();
    return;
  }
  x.pricesLoading = true;
  api(`/api/prices?${new URLSearchParams({ cabinet: key, ...(force ? { force: '1' } : {}) })}`)
    .then(
      data => {
        if (x.key !== key) return;
        take(data);
        x.pricesLoading = Boolean(data.partial);
        if (data.partial)
          x.poll = setTimeout(() => {
            if (x.key === key) loadCardPrices(key, false);
          }, 3000);
      },
      error => {
        if (x.key === key) {
          x.pricesError = error.message;
          x.pricesLoading = false;
        }
      }
    )
    .finally(() => {
      if (x.key !== key || cardsView.key !== key) return;
      applyCardExtras();
      if (state.activePage === 'cards') renderCards();
    });
}
// Оценки с витрины WB (сервер: glue-ratings.js) — число оценок товара, разбивка по звёздам, оценка склейки.
// Общие форматы оценок — js/common/ratings-format.js.
const cardStarsTitle = stars => WBRatings.starsTitle(stars);
const cardRatingWord = count => WBRatings.word(count);
const cardRatingNum = value => WBRatings.star(value);
// «Оценка»: рейтинг товара из отчёта WB «Оценки товаров», под ним — сколько всего оценок; при наведении — по звёздам.
// Рейтинга в отчёте нет, а оценки на витрине есть — средняя по ним.
function cardRatingCell(card) {
  const x = cardsView.extras,
    loading = cardsView.data?.feedbacks?.loading;
  const value = card.rating ?? (card.feedbacks ? card.fbAvg : null);
  const top =
    value != null
      ? `<strong class="card-rating"${card.rating == null ? ' title="Средняя по оценкам на WB — в отчёте «Оценки товаров» товара нет"' : ''}>★ ${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>`
      : !x.ratings && !x.ratingsError && card.feedbacks == null
        ? '<span class="muted">…</span>'
        : '<span class="muted">—</span>';
  const count =
    card.feedbacks == null
      ? loading
        ? '<small class="card-rating-count muted">оценки грузятся…</small>'
        : ''
      : `<small class="card-rating-count">${card.feedbacks ? `${fmtNum(card.feedbacks)} ${cardRatingWord(card.feedbacks)}` : 'нет оценок'}</small>`;
  const stars = card.fbStars ? cardStarsTitle(card.fbStars) : '';
  return `<td${stars ? ` title="${escapeHtml(`Оценки товара по звёздам:\n${stars}`)}"` : ''}>${top}${count}</td>`;
}
// Оценка склейки: «★ 4,1 · 32 262 оценки» — как на WB у покупателя.
const cardGlueRating = (card, withCount) =>
  card.glueRating == null
    ? ''
    : ` · ★ ${cardRatingNum(card.glueRating)}${withCount && card.glueCount != null ? ` · ${fmtNum(card.glueCount)} ${cardRatingWord(card.glueCount)}` : ''}`;
// Ячейка оценки или цены: пока грузится — «…», ошибка — «—» с причиной в подсказке.
function cardExtraCell(card, kind) {
  if (kind === 'rating') return cardRatingCell(card);
  const x = cardsView.extras;
  if (!x.prices)
    return x.pricesError
      ? `<td class="muted" title="${escapeHtml(x.pricesError)}">—</td>`
      : '<td class="muted" title="Загружается…">…</td>';
  if (card.price == null) return '<td class="muted" title="Нет цены в «Ценах и скидках»">—</td>';
  return `<td><strong class="card-price">${fmtRub(card.price)}</strong></td>`;
}
// Фильтры страницы для сервера: пока весь список грузится из WB, карточки по ним он грузит отдельно и отдаёт первыми.
// Предмет на странице выбран по названию — серверу нужен его номер (subjectID).
function cardsFilterQuery() {
  const v = cardsView,
    query = {};
  const subjectID = v.subject && (v.data?.cards || []).find(card => card.subjectName === v.subject)?.subjectID;
  if (subjectID) query.subjectID = String(subjectID);
  if (v.brand) query.brand = v.brand;
  if (v.tag) query.tagID = v.tag;
  // Склейки страницы, которую сейчас видно: их оценки сервер загрузит первыми.
  if (v.pageImts) query.imts = v.pageImts;
  return query;
}
async function loadCardTrash(force = false) {
  if (!force && cardsView.trashKey === state.cabinet && cardsView.trash) return renderCards();
  cardsView.trashKey = state.cabinet;
  cardsView.trash = null;
  renderCards();
  try {
    cardsView.trash = await api(`/api/cards/trash?cabinet=${encodeURIComponent(state.cabinet)}`);
  } catch (e) {
    cardsView.trash = { error: e.message, cards: [] };
  }
  renderCards();
}
async function loadCardErrors(force = false) {
  if (!force && cardsView.errorsKey === state.cabinet && cardsView.errors) return;
  cardsView.errorsKey = state.cabinet;
  try {
    cardsView.errors = await api(`/api/cards/errors?cabinet=${encodeURIComponent(state.cabinet)}`);
  } catch (e) {
    cardsView.errors = { error: e.message, items: [] };
  }
  renderCards();
}

function cardProblem(card, key) {
  if (key === 'nophoto') return !card.photos;
  if (key === 'fewphoto') return card.photos < 3;
  if (key === 'desc') return card.descriptionLength < 1000;
  if (key === 'dims') return card.dimensions?.isValid === false;
  return true;
}
// Строка поиска по карточке собирается один раз на загрузку — при тысячах карточек ввод в поиск не тормозит.
const cardSearchText = new WeakMap();
// Фильтр «Цвет»: карточка подходит, если среди её цветов есть выбранный; «none» — карточки без цвета.
const cardColorMatch = (card, color) => !color || (color === 'none' ? !(card.colors || []).length : (card.colors || []).includes(color));
const cardHaystack = card => {
  let text = cardSearchText.get(card);
  if (text == null) {
    text = [card.title, card.vendorCode, card.nmID, card.brand, card.subjectName, ...card.sizes.flatMap(size => size.skus)]
      .join(' ')
      .toLowerCase();
    cardSearchText.set(card, text);
  }
  return text;
};
function cardRows() {
  const v = cardsView,
    term = v.search.trim().toLowerCase();
  const rows = (v.data?.cards || []).filter(
    card =>
      (!v.subject || card.subjectName === v.subject) &&
      (!v.brand || card.brand === v.brand) &&
      cardColorMatch(card, v.color) &&
      (!v.tag || card.tags.some(tag => String(tag.id) === v.tag)) &&
      cardProblem(card, v.problem) &&
      (!v.doc || cardDocKeys(card).includes(v.doc)) &&
      (!v.glue || (v.glue === 'glued') === card.groupSize > 1) &&
      (!term || cardHaystack(card).includes(term))
  );
  const dir = v.sort.dir === 'asc' ? 1 : -1,
    key = v.sort.key;
  // Пустые значения (нет оценки, нет цены) — всегда в конце, при любом направлении.
  rows.sort((a, b) => {
    const av = a[key] ?? '',
      bv = b[key] ?? '';
    if (av === '' || bv === '') return (av === '') - (bv === '');
    return (
      dir * (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru', { numeric: true }))
    );
  });
  if (v.glue !== 'glued') return rows;
  // «Со склейкой»: карточки одной группы подряд. Группы — в порядке сортировки их первой карточки, внутри — тоже по сортировке.
  const groups = new Map();
  rows.forEach(card => {
    if (!groups.has(card.imtID)) groups.set(card.imtID, []);
    groups.get(card.imtID).push(card);
  });
  return [...groups.values()].flat();
}
// Галочки — у всех карточек: выбранные можно дублировать. «Объединить по 30 шт» — только когда выбран предмет (склеить
// можно лишь карточки одного предмета) и только для выбранных без склейки: склейки уже склеенных не меняются.
// Выбранные — из строк по текущим фильтрам, в порядке таблицы.
const cardSelectable = card => card.groupSize <= 1;
const cardPicked = rows => rows.filter(card => cardsView.selected.has(card.nmID));
const cardChosen = rows => rows.filter(card => cardSelectable(card) && cardsView.selected.has(card.nmID));
function cardGlueChunks(list) {
  const chunks = [];
  for (let i = 0; i < list.length; i += CARD_GLUE_LIMIT) chunks.push(list.slice(i, i + CARD_GLUE_LIMIT));
  return chunks;
}
// Название для «похожих по названию»: регистр, ё/е, кавычки и знаки препинания не важны.
const cardTitleKey = title =>
  String(title || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
// План склейки. list — карточки без склейки в порядке таблицы; склеиваются только карточки одного предмета (так требует WB).
// mode 'title' — карточки с одинаковым названием (карточка без пары остаётся одна), 'order' — подряд по таблице.
// fill — сначала дополнить до 30 неполные склейки того же предмета (в режиме 'title' — где есть карточка с тем же названием),
// самые большие — первыми. Шаг: before > 0 — карточки добавляются к склейке target, иначе новая склейка с основой cards[0].
function cardGluePlan(list, mode, fill) {
  const buckets = new Map(),
    groups = [];
  let alone = 0;
  list.forEach(card => {
    const title = cardTitleKey(card.title);
    if (mode === 'title' && !title) {
      alone++;
      return;
    }
    const key = mode === 'title' ? `${card.subjectID}|${title}` : String(card.subjectID);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(card);
  });
  if (fill) {
    const byImt = new Map();
    (cardsView.data?.cards || []).forEach(card => {
      if (card.groupSize < 2 || card.groupSize >= CARD_GLUE_LIMIT) return;
      let group = byImt.get(card.imtID);
      if (!group) {
        byImt.set(card.imtID, (group = { imtID: card.imtID, subjectID: card.subjectID, size: card.groupSize, titles: new Set() }));
        groups.push(group);
      }
      group.titles.add(cardTitleKey(card.title));
    });
    groups.sort((a, b) => b.size - a.size);
  }
  const steps = [];
  for (let rest of buckets.values()) {
    const { subjectID, subjectName } = rest[0],
      title = cardTitleKey(rest[0].title);
    for (const group of groups) {
      if (!rest.length) break;
      if (group.subjectID !== subjectID || group.size >= CARD_GLUE_LIMIT || (mode === 'title' && !group.titles.has(title))) continue;
      const take = rest.slice(0, CARD_GLUE_LIMIT - group.size);
      rest = rest.slice(take.length);
      steps.push({ target: group.imtID, before: group.size, cards: take, subject: subjectName });
      group.size += take.length;
    }
    cardGlueChunks(rest).forEach(chunk => {
      if (chunk.length > 1) steps.push({ target: chunk[0].imtID, before: 0, cards: chunk, subject: subjectName });
      else alone++;
    });
  }
  return { steps, alone };
}
function cardGlueSummary({ steps, alone }) {
  const created = steps.filter(step => !step.before).length,
    filled = steps.length - created,
    count = steps.reduce((sum, step) => sum + step.cards.length, 0);
  const parts = [
    created && `${fmtNum(created)} ${pluralRu(created, ['новая склейка', 'новые склейки', 'новых склеек'])}`,
    filled && `дополнится ${fmtNum(filled)} ${pluralRu(filled, ['склейка', 'склейки', 'склеек'])}`,
    count && `склеится ${fmtNum(count)} ${cardWord(count)}`,
    alone && `без пары останется ${fmtNum(alone)}`
  ].filter(Boolean);
  return parts.join(' · ') || 'склеить нечего';
}
const CARD_GLUE_MODES = { title: 'похожие по названию', order: 'подряд по таблице' };
// Плавающая панель внизу по центру, как в «Ценах и скидках»: «Дублировать», «Склеить» выбранные в одну склейку и, когда
// выбран предмет, — «Объединить по 30 шт» для выбранных без склейки (подробности плана — в подсказке кнопки).
function renderCardSelectBar(rows, selecting) {
  const bar = $('#cardsSelectBar'),
    picked = cardPicked(rows),
    chosen = selecting ? cardChosen(rows) : [],
    free = rows.filter(cardSelectable).length;
  bar.classList.toggle('hidden', !picked.length);
  if (!picked.length) {
    bar.innerHTML = '';
    return;
  }
  const plan = chosen.length ? cardGluePlan(chosen, cardsView.glueMode, cardsView.glueFill) : null;
  const glueTitle = chosen.length
    ? `Без склейки ${fmtNum(chosen.length)} из ${fmtNum(free)} · ${CARD_GLUE_MODES[cardsView.glueMode]}: ${cardGlueSummary(plan)}`
    : '';
  bar.innerHTML =
    `<strong>Выбрано: ${fmtNum(picked.length)}</strong><button type="button" class="primary" id="cardDuplicateRun">Дублировать</button>` +
    `<button type="button" class="secondary" id="cardMergeRun" title="Объединить выбранные карточки в одну склейку">Склеить</button>` +
    `${plan?.steps.length ? `<button type="button" class="primary" id="cardGlueRun" title="${escapeHtml(glueTitle)}">Объединить по ${CARD_GLUE_LIMIT} шт</button>` : ''}<button type="button" class="stock-clear" id="cardSelectClear">Сбросить</button>`;
}

function renderCards() {
  const v = cardsView,
    data = v.data,
    cards = data?.cards || [];
  if (!$('#page-cards')) return;
  // Вкладки (плиток-счётчиков над таблицей нет — убраны по просьбе продавца, те же числа дают фильтры)
  $$('[data-cards-tab]').forEach(button => button.classList.toggle('active', button.dataset.cardsTab === v.tab));
  $('#cardsTabCount').textContent = data ? fmtNum(cards.length) : '';
  $('#trashTabCount').textContent = v.trash?.cards ? fmtNum(v.trash.cards.length) : '';
  const errorCount = v.errors?.items?.length || 0;
  $('#errorsTabCount').textContent = errorCount ? fmtNum(errorCount) : '';
  $('#errorsTabCount').classList.toggle('alert', errorCount > 0);
  $('#cardsFilters').classList.toggle('hidden', v.tab !== 'cards');
  // Корзина и ошибки — в своей таблице (#cardsAlt): у основной таблицы запомненные ширины столбцов по ключам.
  $('#cardsMain').classList.toggle('hidden', v.tab !== 'cards');
  $('#cardsAlt').classList.toggle('hidden', v.tab === 'cards');
  $('#cardsSelectBar').classList.add('hidden');
  if (v.tab === 'trash') return renderCardTrash();
  if (v.tab === 'errors') return renderCardErrors();
  $('#emptyCardsTitle').textContent = 'Карточек не найдено';
  // Фильтры: предметы, бренды, ярлыки — из данных; выбранное значение остаётся в списке.
  const options = (id, label, values, selected) => {
    $(id).innerHTML =
      `<option value="">${label}</option>${values.map(([value, text]) => `<option value="${escapeHtml(value)}"${String(value) === selected ? ' selected' : ''}>${escapeHtml(text)}</option>`).join('')}`;
  };
  const uniq = list => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')).map(value => [value, value]);
  options('#cardSubjectFilter', 'Все предметы', uniq(cards.map(card => card.subjectName)), v.subject);
  options('#cardBrandFilter', 'Все бренды', uniq(cards.map(card => card.brand)), v.brand);
  // Цвета — со счётчиками; «Без цвета» — последним, если такие карточки есть.
  const colorCounts = new Map();
  let noColor = 0;
  cards.forEach(card => {
    const list = card.colors || [];
    if (!list.length) noColor++;
    list.forEach(color => colorCounts.set(color, (colorCounts.get(color) || 0) + 1));
  });
  if (v.color && v.color !== 'none' && !colorCounts.has(v.color)) colorCounts.set(v.color, 0);
  options(
    '#cardColorFilter',
    'Все цвета',
    [
      ...[...colorCounts].sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([color, count]) => [color, `${color} · ${fmtNum(count)}`]),
      ...(noColor || v.color === 'none' ? [['none', `Без цвета · ${fmtNum(noColor)}`]] : [])
    ],
    v.color
  );
  options(
    '#cardTagFilter',
    'Все ярлыки',
    (data?.tags || []).map(tag => [String(tag.id), tag.name]),
    v.tag
  );
  options('#cardProblemFilter', 'Все карточки', CARD_PROBLEMS.slice(1), v.problem);
  options('#cardDocFilter', 'Документы: все', cardDocOptions(cards, v.doc), v.doc);
  $('#cardGlueFilter').value = v.glue;
  $('#cardsTitle').textContent = 'Карточки товаров';
  if (!data) {
    $('#cardsCount').textContent = v.error ? `Не удалось загрузить: ${v.error}` : 'Загрузка карточек…';
    $('#cardsBody').innerHTML = '';
    $('#emptyCards').classList.add('hidden');
    $('#cardsPagination').classList.add('hidden');
    return;
  }
  const rows = cardRows(),
    pageCount = Math.ceil(rows.length / v.pageSize);
  v.page = Math.min(Math.max(1, v.page), Math.max(1, pageCount));
  const first = data.priority,
    firstNote = !first
      ? ''
      : first.state === 'loading'
        ? ' · сначала грузим карточки по фильтру…'
        : first.state === 'done'
          ? ` · по фильтру уже свежие: ${fmtNum(first.count)}`
          : ` · карточки по фильтру не загрузились: ${first.error}`;
  const fresh = data.loading
    ? ` · загружаем из WB: пришло ${fmtNum(data.loaded || cards.length)}…${firstNote}`
    : `${data.demo ? ' · демо-данные' : ''} · обновлено ${cardDate(data.fetchedAt)}${data.refreshing ? ` · обновляется из WB…${firstNote}` : ''}`;
  const fb = data.feedbacks,
    fbNote = fb?.loading ? ` · оценки с WB: ${fmtNum(fb.done || 0)} из ${fmtNum(fb.total || 0)} склеек…` : '';
  $('#cardsCount').textContent = `${fmtNum(rows.length)} из ${fmtNum(cards.length)}${fresh}${fbNote}`;
  const columns = [
    ['title', 'Товар', 360],
    ['subjectName', 'Предмет', 150],
    ['brand', 'Бренд', 120],
    ['rating', 'Оценка', 90],
    ['price', 'Цена', 110],
    ['sizes', 'Размеры', 140],
    ['photos', 'Медиа', 110],
    ['tags', 'Ярлыки', 150],
    ['verdict', 'Проверка', 170],
    ['updatedAt', 'Изменена', 120]
  ];
  // Заголовки создаются один раз — так сохраняются ширины столбцов (column-widths.js); при сортировке меняется только стрелка.
  const head = $('#cardsHead');
  // У «Оценки» две сортировки: по рейтингу (заголовок) и по числу оценок (кнопка «кол-во»).
  if (!head.children.length) {
    head.innerHTML = columns
      .map(
        ([key, label, width]) =>
          `<th data-card-sort="${key}" data-col-key="${key}" data-col-width="${width}">${key === 'title' ? '<input type="checkbox" class="card-select" id="cardSelectAll" aria-label="Выбрать все карточки по фильтрам">' : ''}${label} <span class="rating-sort-arrow"></span>${key === 'rating' ? '<button type="button" class="card-sort-alt" data-card-sort-alt="feedbacks" title="Сортировать по числу оценок">кол-во <span class="card-sort-alt-arrow"></span></button>' : ''}</th>`
      )
      .join('');
  }
  head.querySelectorAll('[data-card-sort]').forEach(th => {
    th.querySelector('.rating-sort-arrow').textContent = v.sort.key === th.dataset.cardSort ? (v.sort.dir === 'asc' ? '↑' : '↓') : '↕';
  });
  head.querySelectorAll('[data-card-sort-alt]').forEach(button => {
    button.classList.toggle('active', v.sort.key === button.dataset.cardSortAlt);
    button.querySelector('.card-sort-alt-arrow').textContent =
      v.sort.key === button.dataset.cardSortAlt ? (v.sort.dir === 'asc' ? '↑' : '↓') : '↕';
  });
  // Галочки — у всех карточек. «Выбрать все» — все карточки по фильтрам, на всех страницах. selecting — выбран предмет:
  // тогда выбранные без склейки можно склеить.
  const selecting = Boolean(v.subject),
    free = rows.filter(cardSelectable).length,
    picked = cardPicked(rows).length,
    all = $('#cardSelectAll');
  all.checked = rows.length > 0 && picked === rows.length;
  all.indeterminate = picked > 0 && picked < rows.length;
  all.disabled = !rows.length;
  all.title = rows.length ? `Выбрать все по фильтрам: ${fmtNum(rows.length)}` : 'Карточек нет';
  // Без предмета — «Склеить по 30…» сразу по всем предметам (каждый отдельно).
  const glueAll = $('#cardGlueAll');
  glueAll.classList.toggle('hidden', selecting);
  glueAll.disabled = !free;
  glueAll.title = free ? `Карточек без склейки по фильтрам: ${fmtNum(free)} — склеить по предметам` : 'Карточек без склейки нет';
  renderCardSelectBar(rows, selecting);
  const verdict = {
    ok: '<span class="status status-complete">пройдена</span>',
    fail: '<span class="status status-cancel">не пройдена</span>',
    pending: '<span class="status status-confirm">на проверке</span>'
  };
  // В режиме «Со склейкой» над каждой группой — строка группы (и в начале страницы, если группа продолжается с прошлой).
  const pageRows = rows.slice((v.page - 1) * v.pageSize, v.page * v.pageSize),
    glued = v.glue === 'glued',
    shown = new Map();
  v.pageImts = [...new Set(pageRows.map(card => card.imtID))].join(',');
  if (glued) rows.forEach(card => shown.set(card.imtID, (shown.get(card.imtID) || 0) + 1));
  let lastImt = null,
    groupIndex = 0;
  $('#cardsBody').innerHTML = pageRows
    .map((card, index) => {
      const sizes = card.sizes.map(size => (size.techSize && size.techSize !== '0' ? size.techSize : '')).filter(Boolean);
      const barcodes = card.sizes.flatMap(size => size.skus);
      let head = '';
      if (glued && card.imtID !== lastImt) {
        if (lastImt !== null) groupIndex++;
        lastImt = card.imtID;
        const count = shown.get(card.imtID),
          continued = index === 0 && v.page > 1 && rows[(v.page - 1) * v.pageSize - 1]?.imtID === card.imtID;
        head = `<tr class="card-glue-head" style="--glue:${CARD_GLUE_COLORS[groupIndex % CARD_GLUE_COLORS.length]}"><td colspan="${columns.length}"${card.glueStars ? ` title="${escapeHtml(`Оценки склейки по звёздам:\n${cardStarsTitle(card.glueStars)}`)}"` : ''}>Склейка · ${fmtNum(card.groupSize)} ${cardWord(card.groupSize)}${cardGlueRating(card, true)}${continued ? ' (продолжение)' : ''}<small>${escapeHtml(card.subjectName || '')}${count < card.groupSize ? ` · по фильтрам видно ${fmtNum(count)}` : ''}</small></td></tr>`;
      }
      return (
        `${head}<tr${glued ? ` class="card-glued" style="--glue:${CARD_GLUE_COLORS[groupIndex % CARD_GLUE_COLORS.length]}"` : ''}><td><div class="card-cell"><input type="checkbox" class="card-select" data-card-select="${escapeHtml(card.nmID)}"${v.selected.has(card.nmID) ? ' checked' : ''} aria-label="Выбрать ${escapeHtml(card.vendorCode || card.nmID)}">${card.photo ? `<img class="stock-product-photo" src="${escapeHtml(card.photo)}" alt="" loading="lazy">` : '<span class="card-nophoto" title="Нет фото">нет фото</span>'}<span><a class="card-title-link" href="${escapeHtml(cardLink(card.nmID))}" target="_blank" rel="noopener noreferrer" title="Открыть карточку: ${escapeHtml(card.title)}">${escapeHtml(card.title || 'Без названия')}</a><small>${escapeHtml(card.vendorCode || '—')} · <button type="button" class="copy-article" data-copy="${escapeHtml(card.nmID)}" title="Скопировать артикул WB">${escapeHtml(card.nmID)}</button>${card.groupSize > 1 && !glued ? ` · <span class="card-glue-chip" title="Объединена с другими карточками${card.glueRating != null ? ` · оценка склейки на WB ${cardRatingNum(card.glueRating)}${card.glueCount != null ? `, ${fmtNum(card.glueCount)} ${cardRatingWord(card.glueCount)}` : ''}` : ''}">склейка · ${card.groupSize}${cardGlueRating(card, false)}</span>` : ''}</small></span></div></td>` +
        `<td>${escapeHtml(card.subjectName || '—')}</td><td>${escapeHtml(card.brand || '—')}</td>${cardExtraCell(card, 'rating')}${cardExtraCell(card, 'price')}` +
        `<td>${sizes.length ? escapeHtml(sizes.slice(0, 5).join(', ')) + (sizes.length > 5 ? ` +${sizes.length - 5}` : '') : 'без размера'}<small>${fmtNum(barcodes.length)} ${barcodes.length === 1 ? 'баркод' : barcodes.length < 5 && barcodes.length ? 'баркода' : 'баркодов'}</small></td>` +
        `<td class="${card.photos < 3 ? 'card-warn' : ''}">${fmtNum(card.photos)} фото${card.video ? ' · видео' : ''}</td>` +
        `<td>${card.tags.map(cardTagChip).join(' ') || '<span class="muted">—</span>'}</td>` +
        `<td>${card.verdict ? verdict[card.verdict] : '<span class="muted">нет документов</span>'}${card.verdict === 'fail' && card.docErrors.length ? `<small>${escapeHtml(card.docErrors.map(cardDocError).join(', '))}</small>` : ''}${card.needKiz ? `<small>${card.kizMarked ? 'маркировка подтверждена' : '<b class="card-warn">маркировка не подтверждена</b>'}</small>` : ''}${card.noTnved ? `<small><b class="card-warn" title="${card.tnvedCodeOnly ? 'Поле «ТНВЭД» пустое, заполнен только «Код ТН ВЭД» — другая характеристика WB. На странице карточки код можно перенести в «ТНВЭД» одной кнопкой' : 'В карточке нет характеристики «ТНВЭД» — укажите код на странице карточки'}">нет ТН ВЭД</b>${card.tnvedCodeOnly ? ' · есть только «Код ТН ВЭД»' : ''}</small>` : ''}${card.dimensions?.isValid === false ? '<small class="card-warn">габариты под вопросом</small>' : ''}</td>` +
        `<td>${cardDate(card.updatedAt)}</td></tr>`
      );
    })
    .join('');
  $$('#cardsBody .stock-product-photo').forEach(image => {
    if (image.dataset.previewBound) return;
    image.dataset.previewBound = '1';
    bindPhotoPreview(image);
  });
  $('#emptyCards').classList.toggle('hidden', rows.length > 0);
  renderPager($('#cardsPagination'), {
    page: v.page,
    pageCount,
    total: rows.length,
    sizeKey: 'cards',
    onPage: page => {
      v.page = page;
      renderCards();
      $('#page-cards .stock-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    onSize: size => {
      v.pageSize = size;
      v.page = 1;
      renderCards();
    }
  });
}
// Корзина: карточка продаётся, пока есть остатки; без остатков WB удаляет её через 30 дней.
function renderCardTrash() {
  const trash = cardsView.trash;
  $('#cardsTitle').textContent = 'Корзина';
  $('#cardsPagination').classList.add('hidden');
  if (!trash) {
    $('#cardsCount').textContent = 'Загрузка корзины…';
    $('#cardsAlt').innerHTML = '';
    $('#emptyCards').classList.add('hidden');
    return;
  }
  $('#cardsCount').textContent = trash.error
    ? `Не удалось загрузить: ${trash.error}`
    : `${fmtNum(trash.cards.length)} карточек · без остатков WB удаляет их через 30 дней в корзине`;
  $('#cardsAlt').innerHTML =
    '<table class="stock-table cards-alt-table" data-no-resize><thead><tr><th>Товар</th><th>Предмет</th><th>В корзине с</th><th>Удалится</th><th></th></tr></thead><tbody>' +
    trash.cards
      .map(card => {
        const removeAt = card.trashedAt ? new Date(Date.parse(card.trashedAt) + 30 * 86_400_000).toISOString() : '';
        return (
          `<tr><td><div class="card-cell"><span><a class="card-title-link" href="${escapeHtml(cardLink(card.nmID))}" target="_blank" rel="noopener noreferrer">${escapeHtml(card.title || card.vendorCode || 'Без названия')}</a><small>${escapeHtml(card.vendorCode || '—')} · ${escapeHtml(card.nmID)}</small></span></div></td><td>${escapeHtml(card.subjectName || '—')}</td><td>${cardDate(card.trashedAt)}</td><td>${removeAt ? `${cardDate(removeAt).slice(0, 8)}<small>если нет остатков</small>` : '—'}</td>` +
          `<td><button type="button" class="ghost card-recover" data-card-recover="${escapeHtml(card.nmID)}" data-card-name="${escapeHtml(card.vendorCode || card.nmID)}">Восстановить</button></td></tr>`
        );
      })
      .join('') +
    '</tbody></table>';
  $('#emptyCards').classList.toggle('hidden', trash.cards.length > 0 || Boolean(trash.error));
  $('#emptyCardsTitle').textContent = 'Корзина пуста';
}
// Ошибки сохранения: WB проверяет изменения после ответа «успешно» — отклонённые попадают сюда.
function renderCardErrors() {
  const errors = cardsView.errors;
  $('#cardsTitle').textContent = 'Ошибки сохранения';
  $('#cardsPagination').classList.add('hidden');
  if (!errors) {
    $('#cardsCount').textContent = 'Загрузка…';
    $('#cardsAlt').innerHTML = '';
    loadCardErrors();
    return;
  }
  $('#cardsCount').textContent = errors.error
    ? `Не удалось загрузить: ${errors.error}`
    : 'Изменения, которые WB не принял после проверки. Чтобы ошибка ушла, сохраните карточку ещё раз с исправлениями.';
  const byVendor = new Map((cardsView.data?.cards || []).map(card => [card.vendorCode, card]));
  $('#cardsAlt').innerHTML = (errors.items || []).length
    ? '<table class="stock-table cards-alt-table" data-no-resize><thead><tr><th>Артикул продавца</th><th>Предмет</th><th>Что не так</th><th>Когда</th></tr></thead><tbody>' +
      errors.items
        .map(item => {
          const card = byVendor.get(item.vendorCode);
          return `<tr><td>${card ? `<a class="card-title-link" href="${escapeHtml(cardLink(card.nmID))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.vendorCode)}</a>` : escapeHtml(item.vendorCode)}</td><td>${escapeHtml(item.subject || '—')}</td><td class="card-errors">${item.errors.map(text => `<div>${escapeHtml(text)}</div>`).join('')}</td><td>${cardDate(item.updatedAt)}</td></tr>`;
        })
        .join('') +
      '</tbody></table>'
    : '';
  $('#emptyCards').classList.toggle('hidden', (errors.items || []).length > 0 || Boolean(errors.error));
  $('#emptyCardsTitle').textContent = 'Ошибок нет';
}

document.addEventListener('click', event => {
  if (
    !event.target.closest('#page-cards') &&
    !event.target.closest('.card-tags-modal') &&
    !event.target.closest('.card-recover-confirm') &&
    !event.target.closest('.card-glue-batch') &&
    !event.target.closest('.card-dup') &&
    !event.target.closest('.card-parse') &&
    !event.target.closest('.card-merge')
  )
    return;
  const tab = event.target.closest('[data-cards-tab]');
  if (tab) {
    cardsView.tab = tab.dataset.cardsTab;
    if (cardsView.tab === 'trash') loadCardTrash();
    if (cardsView.tab === 'errors') loadCardErrors(true);
    renderCards();
    return;
  }
  if (event.target.closest('#cardDuplicateRun')) return openCardDuplicate();
  if (event.target.closest('#cardMergeRun')) return openCardMerge();
  if (event.target.closest('#cardGlueRun')) return openCardGlueBatch('selected');
  if (event.target.closest('#cardGlueAll')) return openCardGlueBatch('all');
  // Shift+клик по галочке отмечает (или снимает) все карточки между ней и прошлой нажатой — сам выбор в обработчике change.
  if (event.target.closest('[data-card-select]')) cardsView.shiftSelect = event.shiftKey;
  if (event.target.closest('#cardSelectClear')) {
    cardsView.selected.clear();
    renderCards();
    return;
  }
  const alt = event.target.closest('[data-card-sort-alt]');
  if (alt) {
    const key = alt.dataset.cardSortAlt;
    cardsView.sort = cardsView.sort.key === key ? { key, dir: cardsView.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' };
    renderCards();
    return;
  }
  const sort = event.target.closest('[data-card-sort]');
  if (sort && !event.target.closest('.column-resizer') && !event.target.closest('.card-select')) {
    const key = sort.dataset.cardSort;
    cardsView.sort =
      cardsView.sort.key === key
        ? { key, dir: cardsView.sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: ['title', 'subjectName', 'brand'].includes(key) ? 'asc' : 'desc' };
    renderCards();
    return;
  }
  if (event.target.closest('#cardTagsButton')) return openCardTags();
  if (event.target.closest('#cardParseButton')) return openCardParse();
  if (event.target.closest('#cardParseRun')) return runCardParse();
  if (event.target.closest('#cardParseCreate')) return createCardParse();
  const remove = event.target.closest('[data-card-tag-delete]');
  if (remove) {
    if (remove.dataset.confirming) {
      sendCardTag({ action: 'delete', id: Number(remove.dataset.cardTagDelete) });
      return;
    }
    remove.dataset.confirming = '1';
    remove.textContent = `Удалить «${remove.dataset.tagName}» из всех карточек?`;
    return;
  }
  const recover = event.target.closest('[data-card-recover]');
  if (recover) {
    openModal(
      `<div class="card-recover-confirm"><h2>Восстановить карточку?</h2><p class="muted">Карточка ${escapeHtml(recover.dataset.cardName)} вернётся из корзины в список карточек WB. Метод WB: не чаще 3 раз в минуту.</p><div class="modal-actions"><button type="button" data-modal-close-inline>Отмена</button><button type="button" class="primary" data-card-recover-confirm="${escapeHtml(recover.dataset.cardRecover)}">Восстановить</button></div></div>`
    );
    return;
  }
  const confirmRecover = event.target.closest('[data-card-recover-confirm]');
  if (confirmRecover) {
    confirmRecover.disabled = true;
    confirmRecover.textContent = 'Отправляем…';
    api('/api/cards/recover', {
      method: 'POST',
      body: JSON.stringify({ cabinet: state.cabinet, confirm: true, nmIds: [Number(confirmRecover.dataset.cardRecoverConfirm)] })
    })
      .then(() => {
        closeModal();
        toast('Карточка восстановлена');
        cardsView.trash = null;
        loadCardTrash(true);
        loadCards(true);
      })
      .catch(e => {
        confirmRecover.disabled = false;
        confirmRecover.textContent = 'Восстановить';
        toast(e.message);
      });
    return;
  }
  if (event.target.closest('[data-modal-close-inline]')) closeModal();
});
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-card-tag-form]');
  if (!form) return;
  event.preventDefault();
  sendCardTag({
    action: form.dataset.cardTagForm,
    id: Number(form.dataset.tagId) || undefined,
    name: form.elements.name.value.trim(),
    color: form.elements.color.value
  });
});
// «Окончание артикула для всех»: артикул копии = артикул оригинала + окончание.
document.addEventListener('input', event => {
  if (event.target.id === 'cardParsePriceAll' && event.target.value)
    $$('.card-parse-price').forEach(input => {
      input.value = event.target.value;
    });
});
document.addEventListener('keydown', event => {
  if (event.target.id === 'cardParseText' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    runCardParse();
  }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'cardDupSuffix') return;
  const suffix = event.target.value.trim();
  if (suffix)
    $$('.card-dup-code[data-dup-base]').forEach(input => {
      input.value = `${input.dataset.dupBase}${suffix}`.slice(0, 72);
    });
});
document.addEventListener('input', event => {
  if (event.target.id !== 'cardSearch') return;
  cardsView.search = event.target.value;
  cardsView.page = 1;
  if (cardsView.data) renderCards();
});
document.addEventListener('change', event => {
  const map = {
      cardSubjectFilter: 'subject',
      cardBrandFilter: 'brand',
      cardColorFilter: 'color',
      cardTagFilter: 'tag',
      cardProblemFilter: 'problem',
      cardDocFilter: 'doc',
      cardGlueFilter: 'glue'
    },
    key = map[event.target.id];
  if (key) {
    cardsView[key] = event.target.value;
    cardsView.page = 1;
    if (key === 'subject') {
      cardsView.selected.clear();
      cardsView.lastSelected = null;
    }
    renderCards();
    // Список ещё грузится из WB — сразу попросить карточки по новому фильтру.
    if (cardsView.data?.refreshing && ['subject', 'brand', 'tag'].includes(key)) loadCards(false, true);
    return;
  }
  const one = event.target.closest('[data-card-select]');
  if (one) {
    const v = cardsView,
      nmId = Number(one.dataset.cardSelect),
      rows = cardRows(),
      from = rows.findIndex(card => card.nmID === v.lastSelected),
      to = rows.findIndex(card => card.nmID === nmId);
    const range = v.shiftSelect && from >= 0 && to >= 0 ? rows.slice(Math.min(from, to), Math.max(from, to) + 1) : [{ nmID: nmId }];
    range.forEach(card => (one.checked ? v.selected.add(card.nmID) : v.selected.delete(card.nmID)));
    v.lastSelected = nmId;
    v.shiftSelect = false;
    renderCards();
    return;
  }
  if (event.target.name === 'cardGlueMode' || event.target.id === 'cardGlueFill') {
    if (event.target.name === 'cardGlueMode') cardsView.glueMode = event.target.value;
    else cardsView.glueFill = event.target.checked;
    renderCardGluePlan();
    renderCards();
    return;
  }
  if (event.target.id === 'cardSelectAll') {
    cardRows().forEach(card => (event.target.checked ? cardsView.selected.add(card.nmID) : cardsView.selected.delete(card.nmID)));
    renderCards();
  }
});
