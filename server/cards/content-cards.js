// --- Раздел «Карточки товаров»: список карточек кабинета и изменение их данных (WB API, Контент) ---
// Методы — документация WB «Работа с товарами» (item-management, файл спецификации 02-items.yaml):
//   список карточек  POST /content/v2/get/cards/list (по 100, курсор updatedAt + nmID)
//   корзина          POST /content/v2/get/cards/trash, перенос /content/v2/cards/delete/trash, восстановление /content/v2/cards/recover
//   редактирование   POST /content/v2/cards/update — карточка ПЕРЕЗАПИСЫВАЕТСЯ целиком: передаются все поля, в том числе
//                    неизменённые; нельзя менять фото, видео, ярлыки, цены и удалять баркоды; 10 запросов в минуту;
//                    ответ 200 не гарантирует сохранения — ошибки приходят в POST /content/v2/cards/error/list
//   характеристики   GET /content/v2/object/charcs/{subjectId}; справочники цвет / пол / страна / сезон / НДС
//   медиа            POST /content/v3/media/save (ссылки, заменяют весь набор) и /content/v3/media/file (один файл)
//   ярлыки           GET /content/v2/tags, POST /content/v2/tag, PATCH и DELETE /content/v2/tag/{id},
//                    POST /content/v2/tag/nomenclature/link (полный список ярлыков карточки)
//   объединение      POST /content/v2/cards/moveNm (с targetIMT — объединить, без — разъединить)
//   баркоды          POST /content/v2/barcodes — для новых размеров и копий
//   новые карточки   POST /content/v2/cards/upload — «Дублировать» (копии своих) и «Парсер WB» (по ссылкам на чужие товары витрины)
//   ТН ВЭД предмета  GET /content/v2/directory/tnved?subjectID= — подсказка для карточек из парсера
// Новые карточки с нуля (без образца) сайт не создаёт. Все изменения — только с confirm: true (подтверждение на странице).
// В демо-кабинете данные хранятся в памяти сервера, изменения применяются к ним — так можно проверить сайт без WB.
'use strict';

const donorParser = require('./wb-donor');
const CONTENT = 'https://content-api.wildberries.ru';
const NAMED_DIRECTORIES = ['colors', 'kinds', 'countries', 'seasons', 'vat'];
const TAG_COLORS = ['D1CFD7', 'FEE0E0', 'ECDAFF', 'E4EAFF', 'DEF1DD', 'FFECC7'];
const DOCUMENT_TYPES = [1, 2, 3, 4, 5, 7, 8, 9];
const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

module.exports = function createContentCards({
  wbRequest,
  tokenFor,
  cabinets,
  cachedAnalytics,
  analyticsCache,
  apiError,
  readJson,
  send,
  localPhoto,
  productCards,
  refreshProductCards,
  productCardsChanged,
  productCardsStatus,
  glueRatings = null
}) {
  const isDemo = id => id === 'demo' || !cabinets().length;
  const cardsKey = id => `product-cards:${id}`;
  // Список карточек хранится на сервере и на диске (productCards в server.js). После изменения он поправляется
  // на месте (patch) и перечитывается из WB в фоне.
  const forgetCards = (id, patch) => productCardsChanged(id, patch);

  // Ответы Контента: { data, error, errorText, additionalErrors }. Ошибка бывает и при 200 — тогда тоже исключение.
  // Текст ошибки — errorText и additionalErrors (по артикулам продавца или { error }).
  function contentErrorText(data, fallback) {
    const extra = data?.additionalErrors;
    const details = !extra
      ? ''
      : typeof extra === 'string'
        ? extra
        : Object.entries(extra)
            .filter(([, value]) => value)
            .map(([key, value]) => (key === 'error' || key === 'string' || key === 'description' ? String(value) : `${key}: ${value}`))
            .join('; ');
    const main = data?.errorText || data?.detail || data?.title || fallback;
    return [main, details && details !== main ? details : ''].filter(Boolean).join(' — ');
  }
  async function content(token, path, options = {}) {
    let data;
    try {
      data = await wbRequest(token, `${CONTENT}${path}`, options);
    } catch (error) {
      if (error.details && typeof error.details === 'object') error.message = contentErrorText(error.details, error.message);
      throw error;
    }
    if (data && data.error === true) throw apiError(400, contentErrorText(data, 'WB не принял запрос'), data);
    return data;
  }

  // --- Демо-кабинет: карточки, характеристики и ярлыки в памяти ---
  const demo = {
    cards: null,
    trash: [],
    tags: [
      { id: 1, name: 'Хит', color: 'FFECC7' },
      { id: 2, name: 'Новинка', color: 'DEF1DD' }
    ],
    errors: []
  };
  const DEMO_CHARCS = {
    1001: [
      {
        charcID: 14177449,
        name: 'Цвет',
        charcType: 1,
        maxCount: 3,
        required: true,
        unitName: '',
        existNamedField: false,
        isVariable: true,
        popular: true
      },
      { charcID: 14177451, name: 'Страна производства', charcType: 1, maxCount: 1, required: false, unitName: '', existNamedField: false },
      { charcID: 50, name: 'Состав', charcType: 1, maxCount: 3, required: true, unitName: '', existNamedField: false },
      { charcID: 51, name: 'Пол', charcType: 1, maxCount: 2, required: false, unitName: '', existNamedField: false },
      { charcID: 52, name: 'Сезон', charcType: 1, maxCount: 1, required: false, unitName: '', existNamedField: false },
      { charcID: 53, name: 'Плотность ткани', charcType: 4, maxCount: 0, required: false, unitName: 'г/м²', existNamedField: false },
      { charcID: 15001405, name: 'Ставка НДС', charcType: 1, maxCount: 1, required: false, unitName: '', existNamedField: false },
      { charcID: 14177446, name: 'Бренд', charcType: 1, maxCount: 1, required: false, unitName: '', existNamedField: true },
      { charcID: 15000000, name: 'Наименование', charcType: 0, maxCount: 1, required: false, unitName: '', existNamedField: true }
    ],
    1002: [
      {
        charcID: 14177449,
        name: 'Цвет',
        charcType: 1,
        maxCount: 1,
        required: false,
        unitName: '',
        existNamedField: false,
        isVariable: true
      },
      { charcID: 60, name: 'Объём', charcType: 4, maxCount: 0, required: true, unitName: 'мл', existNamedField: false },
      { charcID: 61, name: 'Комплектация', charcType: 1, maxCount: 5, required: false, unitName: '', existNamedField: false }
    ]
  };
  function demoCards() {
    if (demo.cards) return demo.cards;
    const now = Date.now(),
      card = (index, subjectID, subjectName, title, chars, sizes, extra = {}) => ({
        nmID: 4210000 + index,
        imtID: 9100000 + (extra.imt ?? index),
        nmUUID: `demo-${index}`,
        subjectID,
        subjectName,
        vendorCode: `DEMO-${index + 1}`,
        brand: 'Demo',
        title,
        description: `${title}. Демо-описание карточки: здесь продавец рассказывает о товаре, материалах и уходе.`,
        needKiz: false,
        kizMarked: false,
        photos: [],
        video: '',
        dimensions: { length: 30, width: 20, height: 5, weightBrutto: 0.45, isValid: index !== 3 },
        characteristics: chars,
        sizes,
        tags: index % 3 === 0 ? [demo.tags[0]] : [],
        createdAt: new Date(now - (40 - index) * 86_400_000).toISOString(),
        updatedAt: new Date(now - index * 3_600_000).toISOString(),
        documents:
          index === 1
            ? {
                items: [
                  {
                    id: 'demo-doc-1',
                    type: 2,
                    number: 'ЕАЭС N RU Д-CN.DEMO.12345/25',
                    startDate: '2025-02-13T00:00:00Z',
                    endDate: '2030-02-10T00:00:00Z',
                    verdict: { verified: true, status: 1, reason: 'valid' }
                  }
                ],
                overallVerdict: { isFullyChecked: true, status: 1 },
                excludeDocuments: false
              }
            : { items: [], excludeDocuments: false },
        ...extra.fields
      });
    const hoodieSizes = (base, sizes) =>
      sizes.map((techSize, i) => ({ chrtID: base + i, techSize, wbSize: String(42 + i * 2), skus: [`46000${base + i}`] }));
    demo.cards = [
      card(
        0,
        1001,
        'Худи',
        'Худи оверсайз с капюшоном',
        [
          { id: 14177449, name: 'Цвет', value: ['черный'] },
          { id: 50, name: 'Состав', value: ['хлопок 80%', 'полиэстер 20%'] },
          { id: 53, name: 'Плотность ткани', value: 320 }
        ],
        hoodieSizes(70000, ['S', 'M', 'L']),
        { imt: 0 }
      ),
      card(
        1,
        1001,
        'Худи',
        'Худи оверсайз с капюшоном',
        [
          { id: 14177449, name: 'Цвет', value: ['серый меланж'] },
          { id: 50, name: 'Состав', value: ['хлопок 80%', 'полиэстер 20%'] }
        ],
        hoodieSizes(71000, ['S', 'M', 'L', 'XL']),
        { imt: 0 }
      ),
      card(
        2,
        1001,
        'Худи',
        'Худи детское на молнии',
        [{ id: 14177449, name: 'Цвет', value: ['синий'] }],
        hoodieSizes(72000, ['110', '122'])
      ),
      card(
        3,
        1002,
        'Бутылки для воды',
        'Бутылка для воды спортивная 750 мл',
        [
          { id: 60, name: 'Объём', value: 750 },
          { id: 61, name: 'Комплектация', value: ['бутылка', 'крышка'] }
        ],
        [{ chrtID: 73000, techSize: '0', wbSize: '', skus: ['4600073000'] }]
      ),
      card(
        4,
        1002,
        'Бутылки для воды',
        'Бутылка стеклянная в чехле',
        [{ id: 60, name: 'Объём', value: 500 }],
        [{ chrtID: 74000, techSize: '0', wbSize: '', skus: ['4600074000'] }]
      )
    ];
    demo.trash = [
      card(5, 1002, 'Бутылки для воды', 'Бутылка старая модель', [], [{ chrtID: 75000, techSize: '0', wbSize: '', skus: ['4600075000'] }], {
        fields: { trashedAt: new Date(now - 2 * 86_400_000).toISOString() }
      })
    ];
    return demo.cards;
  }

  // --- Чтение ---
  // force — «Обновить»: свежий список грузится в фоне, а пока отдаётся сохранённый.
  async function allCards(id, force, wait = true) {
    if (isDemo(id)) return demoCards();
    if (force && !productCardsStatus(id).refreshing) productCardsChanged(id);
    return productCards(id, tokenFor(id), { wait });
  }
  async function tagsOf(id) {
    if (isDemo(id)) return demo.tags;
    return (await content(tokenFor(id), '/content/v2/tags'))?.data || [];
  }
  function verdictOf(card) {
    const docs = card.documents || {},
      items = docs.items || [];
    if (docs.overallVerdict?.status === 2 || items.some(item => item.verdict?.status === 2)) return 'fail';
    if (items.length && (!docs.overallVerdict || items.some(item => !item.verdict))) return 'pending';
    if (docs.overallVerdict?.status === 1) return 'ok';
    return items.length ? 'pending' : null;
  }
  // Причины ошибок проверки: общая по карточке и по каждому документу. По документации reason приходит только при status 2;
  // на деле бывает status 1 с reason, поэтому берётся только status 2. Причин documents_missing и documents_invalid и поля
  // issues (каких типов документов не хватает) в документации нет, но WB их присылает.
  function docErrorsOf(card) {
    const docs = card.documents || {},
      checks = [docs.overallVerdict, ...(docs.items || []).map(item => item.verdict)];
    return [...new Set(checks.filter(check => check?.status === 2 && check.reason).map(check => check.reason))];
  }
  const missingDocsOf = card => [
    ...new Set(
      (card.documents?.issues || []).filter(issue => issue.code === 'document_missing').flatMap(issue => issue.documentTypes || [])
    )
  ];
  // Цвета — характеристика «Цвет» (id 14177449); значение — массив строк, у части карточек — одна строка.
  const COLOR_CHARC = 14177449;
  // ТН ВЭД — характеристика «ТНВЭД» (id 15000001). Фильтра по ней в методе списка карточек нет, поэтому «Без ТН ВЭД»
  // отбирается на сайте: характеристики нет или она пустая. Пометку WB tnved_missing в проверке документов не берём —
  // на деле (19.11.2026, все кабинеты) её нет ни у одной карточки, хотя карточек без кода сотни.
  // «Код ТН ВЭД» (id 15004139) — другая характеристика с похожим названием; у части карточек заполнена только она.
  const charcFilled = (card, charcId) => {
    const value = (card.characteristics || []).find(item => Number(item?.id) === charcId)?.value;
    return Array.isArray(value) ? value.some(item => String(item ?? '').trim()) : Boolean(String(value ?? '').trim());
  };
  const noTnvedOf = card => !charcFilled(card, donorParser.TNVED_ID);
  const TNVED_OTHER_ID = 15004139;
  function colorsOf(card) {
    const charc = (card.characteristics || []).find(item => Number(item?.id) === COLOR_CHARC || item?.name === 'Цвет');
    const values = Array.isArray(charc?.value) ? charc.value : charc?.value != null ? [charc.value] : [];
    return [...new Set(values.map(value => String(value).trim().toLowerCase()).filter(Boolean))];
  }
  // Оценки с витрины WB (server/cards/glue-ratings.js): у товара — число оценок, средняя и разбивка по звёздам, у склейки — её оценка
  // и число оценок. null — ещё не загружены (или демо-кабинет).
  function feedbackOf(id, card) {
    if (!glueRatings || isDemo(id) || !id)
      return { feedbacks: null, fbAvg: null, fbStars: null, glueRating: null, glueCount: null, glueStars: null };
    const item = glueRatings.item(id, card.imtID, card.nmID),
      glue = glueRatings.glue(id, card.imtID);
    return {
      feedbacks: item ? item.count : null,
      fbAvg: item?.avg ?? null,
      fbStars: item?.stars || null,
      glueRating: glue?.rating ?? null,
      glueCount: glue ? glue.count : null,
      glueStars: glue?.stars || null
    };
  }
  function listItem(card, groupSizes, id = '') {
    const photo = card.photos?.[0] || {};
    return {
      ...feedbackOf(id, card),
      nmID: card.nmID,
      imtID: card.imtID,
      vendorCode: card.vendorCode || '',
      title: card.title || '',
      brand: card.brand || '',
      subjectID: card.subjectID,
      subjectName: card.subjectName || '',
      photo: localPhoto(photo.c246x328 || photo.tm || photo.square || photo.big || ''),
      photos: (card.photos || []).length,
      video: Boolean(card.video),
      sizes: (card.sizes || []).map(size => ({ techSize: size.techSize || '', wbSize: size.wbSize || '', skus: size.skus || [] })),
      tags: card.tags || [],
      needKiz: Boolean(card.needKiz),
      kizMarked: Boolean(card.kizMarked),
      dimensions: card.dimensions || null,
      documents: (card.documents?.items || []).length,
      verdict: verdictOf(card),
      docErrors: docErrorsOf(card),
      missingDocs: missingDocsOf(card),
      descriptionLength: String(card.description || '').length,
      characteristics: (card.characteristics || []).length,
      colors: colorsOf(card),
      noTnved: noTnvedOf(card),
      tnvedCodeOnly: noTnvedOf(card) && charcFilled(card, TNVED_OTHER_ID),
      groupSize: groupSizes.get(card.imtID) || 1,
      createdAt: card.createdAt || '',
      updatedAt: card.updatedAt || '',
      trashedAt: card.trashedAt || ''
    };
  }
  // refreshing — из WB как раз грузится свежий список: страница спросит ещё раз и покажет его. loading — самой первой
  // загрузки ещё нет на диске: в cards то, что уже пришло, loaded — сколько.
  // filter — фильтры страницы (предмет, бренд, ярлык): пока весь список грузится из WB, карточки по ним грузятся отдельно
  // и сразу (см. «Сначала — карточки по фильтру»).
  async function cardsList(id, force, filter = {}) {
    let cards = await allCards(id, force, false);
    const warnings = [];
    const tags = await tagsOf(id).catch(error => (warnings.push(`Ярлыки: ${error.message}`), []));
    const status = isDemo(id) ? { savedAt: Date.now(), refreshing: false } : productCardsStatus(id);
    const first = priorityCards(id, filter, status);
    if (first?.cards.size) {
      const seen = new Set();
      cards = cards.map(card => {
        seen.add(card.nmID);
        return first.cards.get(card.nmID) || card;
      });
      for (const card of first.cards.values()) if (!seen.has(card.nmID)) cards.push(card);
    }
    const groupSizes = new Map();
    cards.forEach(card => groupSizes.set(card.imtID, (groupSizes.get(card.imtID) || 0) + 1));
    // Оценки склеек — в фоне; склейки страницы, которую сейчас видно (imts), — первыми.
    let feedbacks = { loading: false };
    if (glueRatings && !isDemo(id) && status.savedAt && cards.length) {
      const priority = String(filter.imts || '')
        .split(',')
        .map(Number)
        .filter(Number.isInteger)
        .slice(0, 200);
      glueRatings.refresh(id, [...groupSizes.keys()], priority);
      feedbacks = glueRatings.status(id);
    }
    return {
      demo: isDemo(id),
      cards: cards.map(card => listItem(card, groupSizes, id)),
      tags,
      warnings,
      fetchedAt: new Date(status.savedAt || Date.now()).toISOString(),
      refreshing: status.refreshing,
      loading: !status.savedAt && status.refreshing,
      loaded: status.loaded || 0,
      feedbacks,
      priority: first
        ? { state: first.error ? 'error' : first.running ? 'loading' : 'done', count: first.cards.size, error: first.error || '' }
        : null
    };
  }
  // --- Сначала — карточки по фильтру ---
  // Полный список у кабинета с 15 000 карточек грузится из WB минуту-две. Пока он грузится, карточки по фильтрам страницы
  // (предмет → objectIDs, бренд → brands, ярлык → tagIDs; метод тот же, POST /content/v2/get/cards/list) грузятся
  // отдельным коротким списком и сразу подменяют свои строки в ответе. Когда полный список загрузится позже них, отдельный
  // больше не нужен. Поиск по тексту сюда не входит: textSearch WB ищет только по артикулам и баркоду, и ненадёжно.
  const priorityJobs = new Map();
  const PRIORITY_MAX_PAGES = 50;
  // Фильтр страницы → фильтр WB: objectIDs, brands, tagIDs — массивы (02-items.yaml, /content/v2/get/cards/list),
  // поэтому несколько предметов, брендов и ярлыков уходят одним запросом.
  function wbCardsFilter(filter) {
    const result = {},
      ids = list => [...new Set((list || []).map(Number).filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
    const objectIDs = ids(filter.subjectIDs),
      tagIDs = ids(filter.tagIDs),
      brands = [...new Set((filter.brands || []).map(value => String(value ?? '').trim()).filter(Boolean))].sort();
    if (objectIDs.length) result.objectIDs = objectIDs;
    if (brands.length) result.brands = brands;
    if (tagIDs.length) result.tagIDs = tagIDs;
    return Object.keys(result).length ? result : null;
  }
  function priorityCards(id, filter, status) {
    let job = priorityJobs.get(id);
    // Полный список загрузился после отдельного — отдельный больше не нужен.
    if (job && !job.running && status.savedAt >= job.at) {
      priorityJobs.delete(id);
      job = null;
    }
    const wbFilter = isDemo(id) ? null : wbCardsFilter(filter);
    if (!wbFilter || !(status.refreshing || job)) return job?.key === JSON.stringify(wbFilter) ? job : null;
    const key = JSON.stringify(wbFilter);
    if (job?.key === key) return job;
    if (!status.refreshing) return null;
    job = { key, at: Date.now(), running: true, cards: new Map(), error: '' };
    priorityJobs.set(id, job);
    const current = job;
    (async () => {
      const token = tokenFor(id);
      let cursor = { limit: 100 };
      for (let page = 0; page < PRIORITY_MAX_PAGES && priorityJobs.get(id) === current; page++) {
        let response;
        for (let retry = 0; ; retry++) {
          try {
            response = await content(token, '/content/v2/get/cards/list', {
              method: 'POST',
              body: { settings: { sort: { ascending: false }, cursor, filter: { withPhoto: -1, ...wbFilter } } }
            });
            break;
          } catch (error) {
            if (error.status !== 429 || retry >= 3) throw error;
            await sleep(Math.max(1000, (error.retryAfter || 0) * 1000));
          }
        }
        const batch = Array.isArray(response?.cards) ? response.cards : [];
        batch.forEach(card => current.cards.set(card.nmID, card));
        if (batch.length < 100 || !response?.cursor?.updatedAt || !response?.cursor?.nmID) break;
        cursor = { limit: 100, updatedAt: response.cursor.updatedAt, nmID: response.cursor.nmID };
        if ((page + 1) % 5 === 0) await sleep(650);
      }
    })()
      .catch(error => {
        current.error = error.message;
      })
      .finally(() => {
        current.running = false;
        current.at = Date.now();
      });
    return job;
  }
  async function trashList(id) {
    if (isDemo(id)) {
      demoCards();
      return { demo: true, cards: demo.trash.map(card => listItem(card, new Map())) };
    }
    const token = tokenFor(id),
      cards = [];
    let cursor = { limit: 100 };
    for (let page = 0; page < 30; page++) {
      const response = await content(token, '/content/v2/get/cards/trash', {
        method: 'POST',
        body: { settings: { sort: { ascending: false }, cursor } }
      });
      const batch = Array.isArray(response?.cards) ? response.cards : [];
      cards.push(...batch);
      if (batch.length < 100 || !response?.cursor?.trashedAt) break;
      cursor = { limit: 100, trashedAt: response.cursor.trashedAt, nmID: response.cursor.nmID };
    }
    return { demo: false, cards: cards.map(card => listItem(card, new Map())) };
  }
  // Ошибки сохранения (черновики WB): лимит метода — 10 запросов в минуту, поэтому ответ держим минуту.
  async function errorsList(id) {
    if (isDemo(id)) return { demo: true, items: demo.errors };
    return cachedAnalytics(
      `content-errors:${id}`,
      async () => {
        const token = tokenFor(id),
          items = [];
        let cursor = { limit: 100 };
        for (let page = 0; page < 5; page++) {
          const response = await content(token, '/content/v2/cards/error/list', {
            method: 'POST',
            body: { cursor, order: { ascending: false } }
          });
          const data = response?.data || {};
          for (const batch of data.items || [])
            for (const vendorCode of batch.vendorCodes || Object.keys(batch.errors || {})) {
              items.push({
                vendorCode,
                subject: batch.subjects?.[vendorCode]?.name || '',
                errors: batch.errors?.[vendorCode] || [],
                updatedAt: batch.updatedAt || ''
              });
            }
          if (!data.cursor?.next) break;
          cursor = { limit: 100, updatedAt: data.cursor.updatedAt, batchUUID: data.cursor.batchUUID };
        }
        return { demo: false, items };
      },
      60_000
    );
  }
  // Свежая карточка из WB (поиск по артикулу WB), а если её нет в списке — из корзины.
  // По документации textSearch ищет по артикулу продавца, артикулу WB и баркоду. На деле (кабинет Samiri, 11.11.2026)
  // поиск ненадёжен: одна и та же карточка по артикулу WB то находится, то нет, другая не находится вовсе, артикул
  // продавца с пробелами или кириллицей не находится никогда, а по баркоду находятся все. Поэтому, если по артикулу
  // ничего нет, ищем по баркодам карточки из сохранённого списка, а если и так нет — листаем весь список (и корзину)
  // по cursor, как в документации. Лимит категории «Контент» — 100 запросов в минуту (интервал 600 мс, всплеск 5).
  async function freshCard(id, nmId) {
    if (isDemo(id)) {
      const card = demoCards().find(item => item.nmID === nmId) || demo.trash.find(item => item.nmID === nmId);
      if (!card) throw apiError(404, 'Карточка не найдена');
      return { card: JSON.parse(JSON.stringify(card)), trashed: demo.trash.includes(card) };
    }
    const token = tokenFor(id),
      mine = cards => (cards || []).find(item => item.nmID === nmId);
    const search = async (path, text) =>
      mine(
        (
          await content(token, path, {
            method: 'POST',
            body: {
              settings: { cursor: { limit: 100 }, filter: { textSearch: text, ...(path.endsWith('/list') ? { withPhoto: -1 } : {}) } }
            }
          })
        )?.cards
      );
    // Весь список по страницам: cursor — из ответа (у корзины — trashedAt вместо updatedAt), пока страница полная.
    const scan = async path => {
      let cursor = { limit: 100 };
      for (let page = 0; page < 1000; page++) {
        if (page) await new Promise(resolve => setTimeout(resolve, 650));
        const response = await content(token, path, {
          method: 'POST',
          body: { settings: { sort: { ascending: false }, cursor, filter: path.endsWith('/list') ? { withPhoto: -1 } : {} } }
        });
        const found = mine(response?.cards),
          next = response?.cursor || {};
        if (found) return found;
        if ((response?.cards || []).length < 100 || !next.nmID) return null;
        cursor = { limit: 100, nmID: next.nmID, ...(next.trashedAt ? { trashedAt: next.trashedAt } : { updatedAt: next.updatedAt }) };
      }
      return null;
    };
    let card = await search('/content/v2/get/cards/list', String(nmId));
    if (!card) {
      const saved = mine(await allCards(id, false, false).catch(() => []));
      for (const barcode of (saved?.sizes || []).flatMap(size => size.skus || []).slice(0, 3))
        if (!card) card = await search('/content/v2/get/cards/list', String(barcode));
    }
    if (!card) card = await scan('/content/v2/get/cards/list');
    if (card) return { card, trashed: false };
    const trashed = (await search('/content/v2/get/cards/trash', String(nmId))) || (await scan('/content/v2/get/cards/trash'));
    if (trashed) return { card: trashed, trashed: true };
    throw apiError(404, 'Карточка не найдена в WB — ни в списке карточек, ни в корзине; возможно, её удалили');
  }
  async function charcsOf(id, subjectId) {
    if (isDemo(id)) return DEMO_CHARCS[subjectId] || [];
    return cachedAnalytics(
      `content-charcs:${subjectId}`,
      async () => (await content(tokenFor(id), `/content/v2/object/charcs/${subjectId}`))?.data || [],
      6 * 60 * 60_000
    );
  }
  // Справочники значений: Цвет, Пол, Страна производства, Сезон, Ставка НДС — подсказки при вводе.
  async function dictionaries(id) {
    if (isDemo(id))
      return {
        colors: ['черный', 'белый', 'серый меланж', 'синий', 'красный'],
        kinds: ['Мужской', 'Женский', 'Детский'],
        countries: ['Россия', 'Китай', 'Турция'],
        seasons: ['круглогодичный', 'лето', 'демисезон', 'зима'],
        vat: ['0', '5', '10', '20', 'Без НДС']
      };
    const result = {};
    for (const name of NAMED_DIRECTORIES) {
      result[name] = await cachedAnalytics(
        `content-dict:${name}`,
        async () =>
          ((await content(tokenFor(id), `/content/v2/directory/${name}`))?.data || [])
            .map(item => (typeof item === 'string' ? item : item.name))
            .filter(Boolean),
        24 * 60 * 60_000
      ).catch(() => []);
    }
    return result;
  }
  async function cardDetail(id, nmIdInput) {
    const nmId = Number(nmIdInput);
    if (!Number.isInteger(nmId) || nmId <= 0) throw apiError(400, 'Некорректный артикул WB');
    const { card, trashed } = await freshCard(id, nmId),
      warnings = [];
    const [charcs, dicts, tags, cards, errors] = await Promise.all([
      charcsOf(id, card.subjectID).catch(error => (warnings.push(`Характеристики предмета: ${error.message}`), [])),
      dictionaries(id),
      tagsOf(id).catch(error => (warnings.push(`Ярлыки: ${error.message}`), [])),
      allCards(id).catch(() => []),
      errorsList(id).catch(() => ({ items: [] }))
    ]);
    // Свежая карточка заменяет её же в кэше списка — список сразу показывает новые данные.
    if (!trashed && !isDemo(id)) {
      const cached = analyticsCache.get(cardsKey(id));
      if (cached?.value) {
        const index = cached.value.findIndex(item => item.nmID === nmId);
        if (index >= 0) cached.value[index] = card;
      }
    }
    // Оценки склейки и её карточек — с витрины WB (server/cards/glue-ratings.js); склейки нет в файле — загружается сейчас.
    let feedback = null;
    if (glueRatings && !isDemo(id) && !trashed && card.imtID) {
      const glue = await glueRatings.glueNow(id, card.imtID).catch(() => null);
      if (glue?.stars)
        feedback = { ...glueRatings.item(id, card.imtID, nmId), glueRating: glue.rating, glueCount: glue.count, glueStars: glue.stars };
    }
    const itemFeedback = nm => (feedback ? glueRatings.item(id, card.imtID, nm) : null);
    const group = trashed
      ? []
      : cards
          .filter(item => item.imtID === card.imtID && item.nmID !== nmId)
          .map(item => ({
            nmID: item.nmID,
            vendorCode: item.vendorCode,
            title: item.title,
            photo: localPhoto(item.photos?.[0]?.tm || item.photos?.[0]?.c246x328 || ''),
            feedback: itemFeedback(item.nmID)
          }));
    const groupSizes = new Map();
    cards.forEach(item => groupSizes.set(item.imtID, (groupSizes.get(item.imtID) || 0) + 1));
    const sameSubject = trashed
      ? []
      : cards
          .filter(item => item.subjectID === card.subjectID && item.imtID !== card.imtID)
          .map(item => ({
            nmID: item.nmID,
            imtID: item.imtID,
            vendorCode: item.vendorCode,
            title: item.title,
            photo: localPhoto(item.photos?.[0]?.tm || item.photos?.[0]?.c246x328 || ''),
            groupSize: groupSizes.get(item.imtID) || 1
          }));
    return {
      demo: isDemo(id),
      trashed,
      card,
      feedback,
      charcs,
      dictionaries: dicts,
      tags,
      group,
      sameSubject,
      errors: (errors.items || []).filter(item => item.vendorCode === card.vendorCode),
      warnings,
      fetchedAt: new Date().toISOString()
    };
  }

  // --- Изменения ---
  const needConfirm = body => {
    if (!body?.confirm) throw apiError(400, 'Подтвердите изменение карточки');
  };
  const nmIdsOf = list => {
    const ids = [...new Set((Array.isArray(list) ? list : []).map(Number))].filter(value => Number.isInteger(value) && value > 0);
    if (!ids.length) throw apiError(400, 'Не выбраны карточки');
    return ids;
  };

  // Карточка для /content/v2/cards/update из присланной страницей: только поля, которые метод принимает. Проверки —
  // то, что WB иначе отклонит или молча испортит: наименование до 60 символов, все существующие размеры и баркоды
  // на месте (удалять их метод не умеет), значения характеристик — массив строк или число.
  function updatePayload(input, fresh) {
    if (Number(input.nmID) !== fresh.nmID) throw apiError(400, 'Артикул WB не совпадает');
    const text = (value, max) => {
      const result = String(value ?? '').trim();
      if (max && result.length > max) throw apiError(400, `Слишком длинное значение (больше ${max} символов)`);
      return result;
    };
    const vendorCode = text(input.vendorCode, 72);
    if (!vendorCode) throw apiError(400, 'Укажите артикул продавца');
    const number = (value, name, { integer = false, decimals = 3 } = {}) => {
      if (value === '' || value == null) return 0;
      const result = Number(value);
      if (!Number.isFinite(result) || result < 0) throw apiError(400, `${name}: нужно неотрицательное число`);
      if (integer && !Number.isInteger(result)) throw apiError(400, `${name}: нужно целое число`);
      return Number(result.toFixed(decimals));
    };
    const dims = input.dimensions || {};
    const characteristics = (Array.isArray(input.characteristics) ? input.characteristics : [])
      .map(item => {
        const idValue = Number(item.id);
        if (!Number.isInteger(idValue)) throw apiError(400, 'Некорректная характеристика');
        if (typeof item.value === 'number') {
          if (!Number.isFinite(item.value)) throw apiError(400, `Характеристика ${idValue}: некорректное число`);
          return { id: idValue, value: item.value };
        }
        const values = (Array.isArray(item.value) ? item.value : [item.value]).map(value => String(value ?? '').trim()).filter(Boolean);
        return values.length ? { id: idValue, value: values } : null;
      })
      .filter(Boolean);
    const freshSizes = new Map((fresh.sizes || []).map(size => [Number(size.chrtID), size]));
    const sizes = (Array.isArray(input.sizes) ? input.sizes : []).map(size => {
      const skus = [...new Set((size.skus || []).map(value => String(value).trim()).filter(Boolean))];
      if (size.chrtID) {
        const old = freshSizes.get(Number(size.chrtID));
        if (!old) throw apiError(400, `Размер ${size.chrtID} не найден в карточке`);
        const missing = (old.skus || []).filter(sku => !skus.includes(sku));
        if (missing.length) throw apiError(400, `Баркоды нельзя удалить через API: ${missing.join(', ')}`);
        return { chrtID: Number(size.chrtID), techSize: text(size.techSize), wbSize: text(size.wbSize), skus };
      }
      if (!skus.length) throw apiError(400, 'У нового размера должен быть баркод');
      const price = Number(size.price);
      if (!Number.isInteger(price) || price <= 0) throw apiError(400, 'Укажите цену нового размера целым числом, ₽');
      return { techSize: text(size.techSize), wbSize: text(size.wbSize), price, skus };
    });
    const kept = new Set(sizes.filter(size => size.chrtID).map(size => size.chrtID));
    const lost = [...freshSizes.keys()].filter(chrtID => !kept.has(chrtID));
    if (lost.length) throw apiError(400, 'Удалять размеры через API нельзя — все существующие размеры должны остаться');
    const docs = input.documents || {};
    const documents = {
      items: (Array.isArray(docs.items) ? docs.items : []).map(item => {
        const type = Number(item.type);
        if (!DOCUMENT_TYPES.includes(type)) throw apiError(400, 'Укажите тип документа');
        const result = { type, number: text(item.number, 200) };
        if (!result.number) throw apiError(400, 'Укажите номер документа');
        if (item.id) result.id = String(item.id);
        for (const key of ['productNumber', 'tradeName', 'applicant'])
          if (String(item[key] || '').trim()) result[key] = text(item[key], 500);
        for (const key of ['startDate', 'endDate'])
          if (item[key]) {
            const time = Date.parse(item[key]);
            if (!Number.isFinite(time)) throw apiError(400, 'Некорректная дата документа');
            result[key] = new Date(time).toISOString();
          }
        result.isEndless = Boolean(item.isEndless);
        if (result.isEndless) delete result.endDate;
        return result;
      }),
      excludeDocuments: Boolean(docs.excludeDocuments)
    };
    const payload = {
      nmID: fresh.nmID,
      vendorCode,
      kizMarked: Boolean(input.kizMarked),
      brand: text(input.brand, 200),
      title: text(input.title, 60),
      description: text(input.description, 5000),
      dimensions: {
        length: number(dims.length, 'Длина', { integer: true }),
        width: number(dims.width, 'Ширина', { integer: true }),
        height: number(dims.height, 'Высота', { integer: true }),
        weightBrutto: number(dims.weightBrutto, 'Вес')
      },
      documents,
      characteristics,
      sizes
    };
    if (fresh.gtin || input.gtin) payload.gtin = text(input.gtin ?? fresh.gtin, 30);
    return payload;
  }
  async function updateCard(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'),
      nmId = Number(body.card?.nmID);
    const { card: fresh, trashed } = await freshCard(id, nmId);
    if (trashed) throw apiError(400, 'Карточка в корзине — сначала восстановите её');
    // Карточку могли изменить в WB после того, как страница её открыла: тогда наше сохранение затёрло бы чужие правки.
    if (body.updatedAt && fresh.updatedAt && body.updatedAt !== fresh.updatedAt)
      throw apiError(409, 'Карточку изменили в WB после того, как вы её открыли. Обновите страницу, проверьте данные и сохраните ещё раз');
    const payload = updatePayload(body.card, fresh);
    if (isDemo(id)) {
      const target = demoCards().find(item => item.nmID === nmId);
      Object.assign(target, payload, {
        sizes: payload.sizes.map((size, index) => ({
          chrtID: size.chrtID || nmId * 10 + index,
          techSize: size.techSize,
          wbSize: size.wbSize,
          skus: size.skus
        })),
        updatedAt: new Date().toISOString()
      });
      return { ok: true, demo: true, sent: payload };
    }
    await content(tokenFor(id), '/content/v2/cards/update', { method: 'POST', body: [payload] });
    forgetCards(id);
    analyticsCache.delete(`content-errors:${id}`);
    return { ok: true, sent: payload };
  }
  // Медиа по ссылкам: новый набор целиком заменяет старый. Видео WB отдаёт потоковой ссылкой (m3u8), а метод принимает
  // только MOV и MP4 — поэтому у карточки с видео менять набор фото нельзя: видео пропало бы или весь запрос отклонили.
  async function saveMedia(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'),
      nmId = Number(body.nmId);
    const urls = (Array.isArray(body.urls) ? body.urls : []).map(value => String(value).trim()).filter(Boolean);
    if (!urls.length) throw apiError(400, 'В карточке должно остаться хотя бы одно фото');
    if (urls.length > 30) throw apiError(400, 'Максимум 30 фото в карточке');
    for (const url of urls) {
      let target;
      try {
        target = new URL(url);
      } catch {
        throw apiError(400, `Некорректная ссылка: ${url}`);
      }
      if (!/^https?:$/.test(target.protocol)) throw apiError(400, `Ссылка должна начинаться с https://: ${url}`);
    }
    const { card } = await freshCard(id, nmId);
    if (card.video)
      throw apiError(
        400,
        'У карточки есть видео: через API набор фото можно заменить только вместе с видео, а видео WB отдаёт в формате, который нельзя загрузить обратно. Добавляйте фото файлом, а порядок и удаление меняйте в личном кабинете WB'
      );
    if (isDemo(id)) {
      const target = demoCards().find(item => item.nmID === nmId);
      target.photos = urls.map(url => ({ big: url, c246x328: url, tm: url }));
      target.updatedAt = new Date().toISOString();
      return { ok: true, demo: true };
    }
    await content(tokenFor(id), '/content/v3/media/save', { method: 'POST', body: { nmId, data: urls } });
    forgetCards(id);
    return { ok: true };
  }
  // Один файл (фото или видео) — добавляется к уже загруженным: номер больше их количества, у видео всегда 1.
  async function uploadMedia(req, url) {
    if (url.searchParams.get('confirm') !== '1') throw apiError(400, 'Подтвердите загрузку файла');
    const id = String(url.searchParams.get('cabinet') || 'demo'),
      nmId = Number(url.searchParams.get('nmId')),
      number = Number(url.searchParams.get('number'));
    if (!Number.isInteger(nmId) || nmId <= 0 || !Number.isInteger(number) || number < 1 || number > 30)
      throw apiError(400, 'Некорректный артикул или номер файла');
    const type = String(req.headers['content-type'] || ''),
      name =
        decodeURIComponent(String(req.headers['x-file-name'] || 'file'))
          .replace(/[^\w.\-а-яё ]/gi, '_')
          .slice(0, 120) || 'file';
    if (!/^(image\/(jpeg|png|bmp|gif|webp)|video\/(mp4|quicktime))$/.test(type))
      throw apiError(400, 'Формат файла: фото JPG, PNG, BMP, GIF, WebP или видео MP4, MOV');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MEDIA_MAX_BYTES) throw apiError(413, 'Файл больше 50 Мб');
      chunks.push(chunk);
    }
    if (!size) throw apiError(400, 'Пустой файл');
    if (type.startsWith('image/') && size > 32 * 1024 * 1024) throw apiError(413, 'Фото больше 32 Мб');
    if (isDemo(id)) {
      const target = demoCards().find(item => item.nmID === nmId);
      if (type.startsWith('video/')) target.video = 'demo-video';
      else target.photos.push({ big: '', tm: '' });
      return { ok: true, demo: true };
    }
    await sendMediaFile(tokenFor(id), nmId, number, Buffer.concat(chunks), type, name);
    forgetCards(id);
    return { ok: true };
  }
  // POST /content/v3/media/file: один файл, multipart, поле uploadfile; X-Photo-Number у видео — всегда 1.
  async function sendMediaFile(token, nmId, number, buffer, type, name) {
    const form = new FormData();
    form.append('uploadfile', new Blob([buffer], { type }), name);
    const response = await fetch(`${CONTENT}/content/v3/media/file`, {
      method: 'POST',
      headers: { Authorization: token, 'X-Nm-Id': String(nmId), 'X-Photo-Number': String(number) },
      body: form,
      signal: AbortSignal.timeout(120_000)
    });
    const text = await response.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!response.ok || data?.error === true)
      throw apiError(
        response.ok ? 400 : response.status,
        typeof data === 'object'
          ? contentErrorText(data, `WB не принял файл (${response.status})`)
          : `WB не принял файл (${response.status}): ${String(text).slice(0, 200)}`
      );
  }
  async function setCardTags(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'),
      nmId = Number(body.nmId);
    const tagIds = [...new Set((Array.isArray(body.tagIds) ? body.tagIds : []).map(Number))].filter(Number.isInteger);
    if (tagIds.length > 15) throw apiError(400, 'К карточке можно добавить максимум 15 ярлыков');
    if (isDemo(id)) {
      const target = demoCards().find(item => item.nmID === nmId);
      target.tags = demo.tags.filter(tag => tagIds.includes(tag.id));
      return { ok: true, demo: true };
    }
    await content(tokenFor(id), '/content/v2/tag/nomenclature/link', { method: 'POST', body: { nmID: nmId, tagsIDs: tagIds } });
    forgetCards(id);
    return { ok: true };
  }
  // Ярлыки продавца: до 15 штук, имя до 15 символов, цвет — из шести цветов WB.
  async function changeTag(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'),
      action = body.action,
      tagId = Number(body.id);
    const name = String(body.name ?? '').trim(),
      color = String(body.color || 'D1CFD7').toUpperCase();
    if (action !== 'delete') {
      if (!name) throw apiError(400, 'Укажите название ярлыка');
      if (name.length > 15) throw apiError(400, 'Название ярлыка — не больше 15 символов');
      if (!TAG_COLORS.includes(color)) throw apiError(400, 'Недопустимый цвет ярлыка');
    }
    if (isDemo(id)) {
      if (action === 'create') {
        if (demo.tags.length >= 15) throw apiError(400, 'Исчерпан лимит на создание ярлыков');
        demo.tags.push({ id: Math.max(0, ...demo.tags.map(tag => tag.id)) + 1, name, color });
      } else if (action === 'update') Object.assign(demo.tags.find(tag => tag.id === tagId) || {}, { name, color });
      else if (action === 'delete') {
        demo.tags = demo.tags.filter(tag => tag.id !== tagId);
        demoCards().forEach(card => {
          card.tags = (card.tags || []).filter(tag => tag.id !== tagId);
        });
      } else throw apiError(400, 'Неизвестное действие');
      return { ok: true, demo: true, tags: demo.tags };
    }
    const token = tokenFor(id);
    if (action === 'create') await content(token, '/content/v2/tag', { method: 'POST', body: { name, color } });
    else if (action === 'update') {
      if (!Number.isInteger(tagId)) throw apiError(400, 'Не указан ярлык');
      await content(token, `/content/v2/tag/${tagId}`, { method: 'PATCH', body: { name, color } });
    } else if (action === 'delete') {
      if (!Number.isInteger(tagId)) throw apiError(400, 'Не указан ярлык');
      await content(token, `/content/v2/tag/${tagId}`, { method: 'DELETE' });
    } else throw apiError(400, 'Неизвестное действие');
    forgetCards(id);
    return { ok: true, tags: await tagsOf(id) };
  }
  // Корзина: карточка продаётся, пока есть остатки; через 30 дней без остатков WB удаляет её сам.
  async function moveToTrash(body, restore) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'),
      nmIds = nmIdsOf(body.nmIds);
    if (nmIds.length > 1000) throw apiError(400, 'Не больше 1000 карточек за раз');
    if (isDemo(id)) {
      demoCards();
      const from = restore ? demo.trash : demo.cards,
        to = restore ? demo.cards : demo.trash;
      for (const nmId of nmIds) {
        const index = from.findIndex(card => card.nmID === nmId);
        if (index >= 0) {
          const [card] = from.splice(index, 1);
          card.trashedAt = restore ? '' : new Date().toISOString();
          to.push(card);
        }
      }
      return { ok: true, demo: true };
    }
    await content(tokenFor(id), restore ? '/content/v2/cards/recover' : '/content/v2/cards/delete/trash', {
      method: 'POST',
      body: { nmIDs: nmIds }
    });
    forgetCards(id, restore ? null : list => list.filter(card => !nmIds.includes(card.nmID)));
    return { ok: true };
  }
  // Объединение (с targetIMT — до 30 карточек одного предмета) и разъединение (без targetIMT; по одной карточке за запрос,
  // иначе отделённые карточки объединятся между собой). По документации в группе после объединения — не больше 30 карточек
  // («В группу можно объединить не больше 30 карточек») и все одного предмета: это проверяется заранее по списку карточек.
  // Карточка, которая была в другой группе, уходит из неё.
  async function moveCards(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'),
      nmIds = nmIdsOf(body.nmIds),
      targetIMT = body.targetIMT == null || body.targetIMT === '' ? null : Number(body.targetIMT);
    if (nmIds.length > 30) throw apiError(400, 'Объединить можно не больше 30 карточек');
    if (targetIMT !== null && !Number.isInteger(targetIMT)) throw apiError(400, 'Некорректный imtID');
    if (targetIMT === null && nmIds.length > 1) throw apiError(400, 'Отсоединять карточки нужно по одной');
    // Склейки, откуда уходят карточки, — чтобы после переноса перечитать их оценки.
    const fromImts = (await allCards(id).catch(() => [])).filter(card => nmIds.includes(card.nmID)).map(card => card.imtID);
    if (targetIMT !== null) {
      const cards = await allCards(id).catch(() => []),
        group = cards.filter(card => card.imtID === targetIMT);
      if (group.length) {
        const total = new Set([...group.map(card => card.nmID), ...nmIds]).size;
        if (total > 30) throw apiError(400, `В группе будет ${total} карточек, а можно не больше 30`);
        const subject = group[0].subjectID,
          other = cards.filter(card => nmIds.includes(card.nmID) && card.subjectID !== subject);
        if (other.length)
          throw apiError(
            400,
            `Объединять можно только карточки одного предмета («${group[0].subjectName}»): ${other.map(card => card.vendorCode || card.nmID).join(', ')}`
          );
      }
    }
    if (isDemo(id)) {
      demoCards()
        .filter(item => nmIds.includes(item.nmID))
        .forEach(card => {
          card.imtID = targetIMT ?? 9200000 + (card.nmID % 1000);
        });
      return { ok: true, demo: true };
    }
    // Склейки по 30 сайт шлёт подряд (лимит Контента — 100 запросов в минуту, всплеск 5). Если WB всё же ответил 429 —
    // ждём, сколько он сказал в X-Ratelimit-Retry, и повторяем (до 3 раз).
    for (let retry = 0; ; retry++) {
      try {
        await content(tokenFor(id), '/content/v2/cards/moveNm', {
          method: 'POST',
          body: targetIMT === null ? { nmIDs: nmIds } : { targetIMT, nmIDs: nmIds }
        });
        break;
      } catch (error) {
        if (error.status !== 429 || retry >= 3) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.max(1000, (error.retryAfter || 0) * 1000)));
      }
    }
    // Новый imtID отсоединённой карточки WB сообщит при перечитывании; до тех пор — свой, отрицательный, чтобы она была отдельно.
    forgetCards(id, list => list.map(card => (nmIds.includes(card.nmID) ? { ...card, imtID: targetIMT ?? -card.nmID } : card)));
    // Оценки склеек — сразу и ещё раз позже (server/cards/glue-ratings.js): отзывы на WB общие для склейки и после переноса меняются.
    glueRatings?.recheck(
      id,
      [targetIMT, ...fromImts].filter(imt => imt != null)
    );
    return { ok: true, moved: nmIds.length };
  }
  async function barcodes(body) {
    const id = String(body.cabinet || 'demo'),
      count = Math.max(1, Math.min(20, Math.round(Number(body.count) || 1)));
    if (isDemo(id)) return { barcodes: Array.from({ length: count }, (_, index) => `20${String(Date.now()).slice(-9)}${index}`) };
    return { barcodes: (await content(tokenFor(id), '/content/v2/barcodes', { method: 'POST', body: { count } }))?.data || [] };
  }

  // --- Дублирование карточек ---
  // Копия — новая отдельная карточка того же предмета: POST /content/v2/cards/upload (по одной карточке в variants;
  // лимит метода — 10 запросов в минуту, поэтому запросы раз в 6,5 с). Копируется всё, кроме артикула продавца (его
  // задаёт продавец), баркодов (новые — POST /content/v2/barcodes) и склейки: в одной склейке WB не принимает карточки
  // с одинаковыми характеристиками. Цена размеров — из метода цен (GET /api/v2/list/goods/filter?filterNmID=), скидку WB
  // при создании не принимает. Создаёт карточку WB асинхронно, до 30 минут; ошибки создания приходят в
  // POST /content/v2/cards/error/list. Поэтому дальше сервер раз в 15 с ищет копию по её баркоду и, когда она появилась,
  // загружает фото по ссылкам оригинала (POST /content/v3/media/save), видео файлом (POST /content/v3/media/file) и
  // ставит ярлыки (POST /content/v2/tag/nomenclature/link). Видео WB отдаёт потоком HLS (m3u8), а принимает только MP4
  // или MOV — его перепаковывает ffmpeg (без ffmpeg видео не копируется, остальное — да).
  // Задания хранятся в памяти сервера: после перезапуска уже созданные копии останутся в WB, но без медиа и ярлыков.
  const duplicateJobs = new Map();
  const DUPLICATE_MAX = 100,
    DUPLICATE_WAIT = 40 * 60_000,
    VIDEO_MAX_BYTES = 50 * 1024 * 1024;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Карточка для /content/v2/cards/upload из карточки списка WB: только поля схемы запроса.
  function duplicateVariant(card, vendorCode, barcodes, prices) {
    const sizes = (card.sizes?.length ? card.sizes : [{}]).map((size, index) => {
      const techSize = String(size.techSize || ''),
        wbSize = String(size.wbSize || ''),
        sized = (techSize && techSize !== '0') || wbSize;
      const price = prices.get(techSize) ?? prices.get('*');
      return { ...(sized ? { techSize, wbSize } : {}), ...(price ? { price } : {}), skus: [barcodes[index]] };
    });
    const docs = card.documents || {};
    const documents = {
      items: (docs.items || [])
        .filter(item => DOCUMENT_TYPES.includes(Number(item.type)) && item.number)
        .map(item => {
          const result = { type: Number(item.type), number: String(item.number) };
          for (const key of ['productNumber', 'tradeName', 'applicant', 'startDate', 'endDate']) if (item[key]) result[key] = item[key];
          result.isEndless = Boolean(item.isEndless);
          if (result.isEndless) delete result.endDate;
          return result;
        }),
      excludeDocuments: Boolean(docs.excludeDocuments)
    };
    const characteristics = (card.characteristics || [])
      .filter(
        item =>
          Number.isInteger(Number(item?.id)) &&
          item.value != null &&
          item.value !== '' &&
          !(Array.isArray(item.value) && !item.value.length)
      )
      .map(item => ({ id: Number(item.id), value: item.value }));
    const dims = card.dimensions || {};
    const variant = {
      vendorCode,
      title: card.title || '',
      description: card.description || '',
      brand: card.brand || '',
      kizMarked: Boolean(card.kizMarked),
      dimensions: {
        length: Number(dims.length) || 0,
        width: Number(dims.width) || 0,
        height: Number(dims.height) || 0,
        weightBrutto: Number(dims.weightBrutto) || 0
      },
      characteristics,
      sizes,
      documents
    };
    if (card.wholesale?.enabled)
      variant.wholesale = { enabled: true, ...(card.wholesale.quantum ? { quantum: card.wholesale.quantum } : {}) };
    return variant;
  }
  // Цены размеров оригинала: techSizeName → цена; '*' — цена первого размера (для размеров, которых нет в ответе).
  async function originalPrices(token, nmId) {
    const response = await wbRequest(
      token,
      `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1&offset=0&filterNmID=${nmId}`
    );
    const prices = new Map();
    for (const size of response?.data?.listGoods?.[0]?.sizes || []) {
      const price = Math.round(Number(size.price));
      if (!(price > 0)) continue;
      if (!prices.has('*')) prices.set('*', price);
      prices.set(String(size.techSizeName ?? ''), price);
    }
    return prices;
  }
  // Видео оригинала (HLS) → MP4 до 50 Мб: сначала в исходном качестве, если не влезает — 1080p, 720p, 480p.
  async function videoAsMp4(url) {
    const { spawn } = require('child_process'),
      os = require('os'),
      fsp = require('fs/promises'),
      path = require('path');
    const qualities = [null, '1080p', '720p', '480p'],
      tried = new Set();
    let failure = null;
    for (const quality of qualities) {
      const source = quality ? url.replace(/\/hls\/\d+p\//, `/hls/${quality}/`) : url;
      if (tried.has(source)) continue;
      tried.add(source);
      const file = path.join(os.tmpdir(), `wb-video-${process.pid}-${Date.now()}.mp4`);
      try {
        await new Promise((resolve, reject) => {
          const ffmpeg = spawn(
            'ffmpeg',
            ['-y', '-loglevel', 'error', '-i', source, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', file],
            { windowsHide: true }
          );
          let errors = '';
          ffmpeg.stderr.on('data', chunk => {
            errors += chunk;
          });
          const timer = setTimeout(() => ffmpeg.kill(), 180_000);
          ffmpeg.on('error', error => {
            clearTimeout(timer);
            reject(error.code === 'ENOENT' ? new Error('на компьютере нет ffmpeg') : error);
          });
          ffmpeg.on('close', code => {
            clearTimeout(timer);
            code === 0 ? resolve() : reject(new Error(`ffmpeg: ${errors.trim().split('\n').pop() || `код ${code}`}`));
          });
        });
        const buffer = await fsp.readFile(file);
        if (buffer.length && buffer.length <= VIDEO_MAX_BYTES) return buffer;
        failure = new Error('видео больше 50 Мб');
      } catch (error) {
        if (/нет ffmpeg/.test(error.message)) throw error;
        failure = error;
      } finally {
        fsp.unlink(file).catch(() => {});
      }
    }
    throw failure || new Error('видео не удалось перепаковать');
  }
  // Новая карточка по её баркоду: поиск по баркоду в списке карточек надёжен (см. freshCard).
  async function cardByBarcode(token, barcode) {
    const response = await content(token, '/content/v2/get/cards/list', {
      method: 'POST',
      body: { settings: { cursor: { limit: 100 }, filter: { textSearch: String(barcode), withPhoto: -1 } } }
    });
    return (response?.cards || []).find(card => (card.sizes || []).some(size => (size.skus || []).includes(String(barcode)))) || null;
  }
  // Новая карточка появляется в списке карточек раньше, чем о ней узнаёт сервис медиа: на деле (кабинет 1, 17.11.2026)
  // карточка нашлась по баркоду через 15 с после создания, а media/save сразу после этого ответил «Ошибка сохранения
  // товара: товар не найден nm_id = …». Поэтому на «не найден» повторяем: раз в 30 с, до 10 минут.
  const MEDIA_RETRY = 30_000,
    MEDIA_RETRY_FOR = 10 * 60_000;
  async function whenCardKnown(action) {
    const started = Date.now();
    for (;;) {
      try {
        return await action();
      } catch (error) {
        if (!/не найден|not found/i.test(error.message) || Date.now() - started >= MEDIA_RETRY_FOR) throw error;
      }
      await sleep(MEDIA_RETRY);
    }
  }
  // Медиа и ярлыки — на найденную копию. Ошибки здесь не отменяют копию: они пишутся в предупреждения.
  async function finishDuplicate(token, item) {
    const source = item.source,
      nmId = item.newNmId;
    const photos = (source.photos || []).map(photo => photo.big || photo.hq || photo.c516x688).filter(Boolean);
    if (photos.length) {
      try {
        await whenCardKnown(() => content(token, '/content/v3/media/save', { method: 'POST', body: { nmId, data: photos } }));
      } catch (error) {
        item.warnings.push(`Фото не скопированы: ${error.message}`);
      }
    }
    if (source.video) {
      item.status = 'video';
      try {
        await sleep(3000);
        const video = await videoAsMp4(source.video);
        await whenCardKnown(() => sendMediaFile(token, nmId, 1, video, 'video/mp4', 'video.mp4'));
      } catch (error) {
        item.warnings.push(`Видео не скопировано: ${error.message}`);
      }
    }
    const tagIds = (source.tags || []).map(tag => Number(tag.id)).filter(Number.isInteger);
    if (tagIds.length) {
      try {
        await whenCardKnown(() =>
          content(token, '/content/v2/tag/nomenclature/link', { method: 'POST', body: { nmID: nmId, tagsIDs: tagIds } })
        );
      } catch (error) {
        item.warnings.push(`Ярлыки не поставлены: ${error.message}`);
      }
    }
  }
  async function runDuplicate(job) {
    const id = job.cabinet,
      demoMode = isDemo(id),
      token = demoMode ? null : tokenFor(id);
    const fail = (item, text) => {
      item.status = 'error';
      item.error = text;
    };
    // 1. Оригиналы (свежие из WB) и их цены. У карточек из парсера витрины черновик и цена уже готовы.
    for (const item of job.items) {
      if (item.source) continue;
      item.status = 'preparing';
      try {
        const { card, trashed } = await freshCard(id, item.nmId);
        if (trashed) throw new Error('оригинал в корзине');
        item.source = card;
        item.prices = new Map();
        if (!demoMode) {
          try {
            item.prices = await originalPrices(token, item.nmId);
            if (!item.prices.size) item.warnings.push('У оригинала нет цены — задайте цену копии сами');
          } catch (error) {
            item.warnings.push(`Цена не скопирована: ${error.message}`);
          }
          await sleep(650);
        }
        item.status = 'queued';
      } catch (error) {
        fail(item, error.message);
      }
    }
    const ready = job.items.filter(item => item.source);
    if (demoMode) {
      demoCards();
      for (const item of ready) {
        const copy = JSON.parse(JSON.stringify(item.source)),
          nmID = Math.max(...demo.cards.map(card => card.nmID)) + 1;
        Object.assign(copy, {
          nmID,
          imtID: 9300000 + (nmID % 100000),
          nmUUID: `demo-copy-${nmID}`,
          vendorCode: item.vendorCode,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sizes: (copy.sizes || []).map((size, index) => ({
            ...size,
            chrtID: nmID * 10 + index,
            skus: [`20${String(nmID).slice(-7)}${index}`]
          }))
        });
        demo.cards.push(copy);
        item.newNmId = nmID;
        item.barcodes = copy.sizes.flatMap(size => size.skus);
        item.status = 'done';
      }
      job.finishedAt = new Date().toISOString();
      return;
    }
    // 2. Баркоды для всех размеров всех копий одним запросом.
    let barcodes = [];
    const need = ready.reduce((sum, item) => sum + Math.max(1, (item.source.sizes || []).length), 0);
    if (need) {
      try {
        barcodes = (await content(token, '/content/v2/barcodes', { method: 'POST', body: { count: need } }))?.data || [];
      } catch (error) {
        ready.forEach(item => fail(item, `Не удалось получить баркоды: ${error.message}`));
      }
      if (barcodes.length < need) ready.forEach(item => item.status !== 'error' && fail(item, 'WB выдал меньше баркодов, чем нужно'));
    }
    // 3. Создание — по одной карточке, раз в 6,5 с.
    let sent = 0;
    for (const item of ready) {
      if (item.status === 'error') continue;
      const count = Math.max(1, (item.source.sizes || []).length);
      item.barcodes = barcodes.splice(0, count);
      if (sent++) await sleep(6500);
      item.status = 'creating';
      try {
        await content(token, '/content/v2/cards/upload', {
          method: 'POST',
          body: [
            { subjectID: item.source.subjectID, variants: [duplicateVariant(item.source, item.vendorCode, item.barcodes, item.prices)] }
          ]
        });
        item.status = 'waiting';
        item.sentAt = Date.now();
      } catch (error) {
        fail(item, error.message);
      }
    }
    // 4. Ждём, пока WB создаст карточки: ищем по баркоду, проверяем список несозданных карточек.
    const started = Date.now();
    while (job.items.some(item => item.status === 'waiting') && Date.now() - started < DUPLICATE_WAIT) {
      await sleep(15_000);
      analyticsCache.delete(`content-errors:${id}`);
      const errors = (await errorsList(id).catch(() => ({ items: [] }))).items || [];
      for (const item of job.items.filter(entry => entry.status === 'waiting')) {
        const failed = errors.find(
          entry => entry.vendorCode === item.vendorCode && (!entry.updatedAt || Date.parse(entry.updatedAt) >= item.sentAt - 60_000)
        );
        if (failed) {
          fail(item, `WB не создал карточку: ${failed.errors.join('; ') || 'причина не указана'}`);
          continue;
        }
        let found = null;
        try {
          found = await cardByBarcode(token, item.barcodes[0]);
        } catch {}
        await sleep(700);
        if (!found) continue;
        item.newNmId = found.nmID;
        item.status = 'media';
        await finishDuplicate(token, item);
        item.status = 'done';
        forgetCards(id);
      }
    }
    job.items
      .filter(item => item.status === 'waiting')
      .forEach(item => fail(item, 'WB не создал карточку за 40 минут — проверьте «Ошибки сохранения» и список карточек'));
    job.finishedAt = new Date().toISOString();
    forgetCards(id);
  }
  const jobView = job => ({
    id: job.id,
    kind: job.kind || 'duplicate',
    cabinet: job.cabinet,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    items: job.items.map(item => ({
      nmId: item.nmId,
      vendorCode: item.vendorCode,
      sourceVendorCode: item.sourceVendorCode,
      title: item.title,
      status: item.status,
      error: item.error || '',
      warnings: item.warnings,
      newNmId: item.newNmId || null,
      barcodes: item.barcodes || []
    }))
  });
  async function startDuplicate(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'),
      list = Array.isArray(body.items) ? body.items : [];
    if (!list.length) throw apiError(400, 'Не выбраны карточки');
    if (list.length > DUPLICATE_MAX) throw apiError(400, `За раз можно дублировать не больше ${DUPLICATE_MAX} карточек`);
    jobsIdle(id);
    const cards = await allCards(id).catch(() => []),
      byNm = new Map(cards.map(card => [card.nmID, card])),
      check = vendorCodeCheck(cards);
    const items = list.map(entry => {
      const nmId = Number(entry.nmId),
        vendorCode = check(entry.vendorCode);
      if (!Number.isInteger(nmId) || nmId <= 0) throw apiError(400, 'Некорректный артикул WB');
      const card = byNm.get(nmId);
      return { nmId, vendorCode, sourceVendorCode: card?.vendorCode || '', title: card?.title || '', status: 'queued', warnings: [] };
    });
    return launchJob(id, 'duplicate', items);
  }
  // Новое задание не запускается, пока у кабинета идёт отправка карточек в WB (лимит создания — 10 запросов в минуту).
  function jobsIdle(id) {
    if (
      [...duplicateJobs.values()].some(
        job => job.cabinet === id && !job.finishedAt && job.items.some(item => ['preparing', 'queued', 'creating'].includes(item.status))
      )
    )
      throw apiError(409, 'Карточки этого кабинета ещё создаются — дождитесь окончания');
  }
  // Проверка артикула продавца новой карточки: не пустой, до 72 символов, свободен в кабинете и не повторяется в запросе.
  function vendorCodeCheck(cards) {
    const used = new Set(cards.map(card => card.vendorCode)),
      mine = new Set();
    return input => {
      const vendorCode = String(input ?? '').trim();
      if (!vendorCode) throw apiError(400, 'Укажите артикул продавца для каждой карточки');
      if (vendorCode.length > 72) throw apiError(400, `Артикул продавца длиннее 72 символов: ${vendorCode}`);
      if (used.has(vendorCode)) throw apiError(400, `Артикул продавца уже есть в кабинете: ${vendorCode}`);
      if (mine.has(vendorCode)) throw apiError(400, `Артикул продавца повторяется: ${vendorCode}`);
      mine.add(vendorCode);
      return vendorCode;
    };
  }
  function launchJob(id, kind, items) {
    const job = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      kind,
      cabinet: id,
      startedAt: new Date().toISOString(),
      items
    };
    duplicateJobs.set(job.id, job);
    runDuplicate(job).catch(error => {
      job.items
        .filter(item => item.status !== 'done')
        .forEach(item => {
          item.status = 'error';
          item.error = item.error || error.message;
        });
      job.finishedAt = new Date().toISOString();
    });
    return jobView(job);
  }

  // --- Парсер витрины: новые карточки по ссылкам на чужие товары WB (разбор — server/cards/wb-donor.js) ---
  // 1. POST /api/cards/parse { cabinet, text } — разбор ссылок и артикулов: черновики запоминаются на час, страница
  //    получает предпросмотр — что перенесётся, что нет, подсказки ТН ВЭД и НДС (на витрине их нет).
  // 2. POST /api/cards/parse/create { cabinet, confirm, items: [{ nmId, vendorCode, price, brand, title, tnved, vat,
  //    dimensions }] } — то, что задал продавец, накладывается на черновик, и дальше всё как у «Дублировать»:
  //    создание по одной карточке, ожидание WB, фото по ссылкам витрины, видео через ffmpeg.
  const PARSE_MAX = 20,
    PARSE_KEEP = 60 * 60_000;
  const parsedDonors = new Map();
  const charcValue = (card, charcId) => {
    const value = (card.characteristics || []).find(item => Number(item.id) === charcId)?.value;
    return Array.isArray(value) ? String(value[0] ?? '') : value == null ? '' : String(value);
  };
  const mostCommon = values => {
    const counts = new Map();
    values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  };
  async function parseDonors(body) {
    const id = String(body.cabinet || 'demo'),
      list = donorParser.donorArticles(body.text);
    if (!list.length) throw apiError(400, 'Вставьте ссылку на товар WB или его артикул');
    if (list.length > PARSE_MAX) throw apiError(400, `За раз — не больше ${PARSE_MAX} товаров, а вставлено ${list.length}`);
    const [cards, dicts] = await Promise.all([allCards(id).catch(() => []), dictionaries(id).catch(() => ({}))]);
    const now = Date.now();
    for (const [key, value] of parsedDonors) if (now - value.at > PARSE_KEEP) parsedDonors.delete(key);
    const vatSuggested = mostCommon(cards.map(card => charcValue(card, donorParser.VAT_ID)));
    const items = [];
    for (const nmId of list) {
      try {
        const donor = await donorParser.fetchDonor(nmId),
          subjectID = Number(donor.card?.data?.subject_id);
        const charcs = subjectID > 0 ? await charcsOf(id, subjectID) : [];
        const { source, report } = donorParser.draftFromDonor(donor, charcs);
        // ТН ВЭД: самый частый у карточек кабинета того же предмета, иначе — единственный код предмета из справочника WB.
        let tnvedOptions = [];
        if (!isDemo(id))
          tnvedOptions = await cachedAnalytics(
            `content-tnved:${subjectID}`,
            async () =>
              ((await content(tokenFor(id), `/content/v2/directory/tnved?subjectID=${subjectID}`))?.data || [])
                .map(item => ({ tnved: String(item.tnved || ''), isKiz: Boolean(item.isKiz) }))
                .filter(item => item.tnved),
            24 * 60 * 60_000
          ).catch(() => []);
        const tnvedSuggested =
          mostCommon(cards.filter(card => card.subjectID === subjectID).map(card => charcValue(card, donorParser.TNVED_ID))) ||
          (tnvedOptions.length === 1 ? tnvedOptions[0].tnved : '');
        const hasCharc = charcId => charcs.some(item => item.charcID === charcId);
        parsedDonors.set(`${id}:${nmId}`, { source, report, at: now });
        items.push({
          ...report,
          tnved: hasCharc(donorParser.TNVED_ID) ? { options: tnvedOptions, suggested: tnvedSuggested } : null,
          vat: hasCharc(donorParser.VAT_ID) ? { options: dicts.vat || [], suggested: vatSuggested } : null
        });
      } catch (error) {
        items.push({ nmId, error: error.message });
      }
    }
    return { items };
  }
  async function createFromDonors(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'),
      list = Array.isArray(body.items) ? body.items : [];
    if (!list.length) throw apiError(400, 'Нет товаров для создания');
    if (list.length > PARSE_MAX) throw apiError(400, `За раз — не больше ${PARSE_MAX} карточек`);
    jobsIdle(id);
    const check = vendorCodeCheck(await allCards(id).catch(() => []));
    const items = list.map(entry => {
      const nmId = Number(entry.nmId),
        parsed = parsedDonors.get(`${id}:${nmId}`);
      if (!parsed) throw apiError(400, `Товар ${nmId} разобран больше часа назад или в другом кабинете — разберите ссылки заново`);
      const vendorCode = check(entry.vendorCode),
        price = Math.round(Number(entry.price));
      if (!(price > 0)) throw apiError(400, `Укажите цену для ${vendorCode}`);
      const source = JSON.parse(JSON.stringify(parsed.source));
      const title = String(entry.title ?? '').trim();
      if (title) source.title = title.slice(0, 60);
      source.brand = String(entry.brand ?? '')
        .trim()
        .slice(0, 100);
      const dims = entry.dimensions || {};
      for (const key of ['length', 'width', 'height', 'weightBrutto']) {
        const value = Number(dims[key] ?? source.dimensions[key]);
        if (!(value > 0)) throw apiError(400, `Укажите габариты упаковки и вес для ${vendorCode}`);
        source.dimensions[key] = Number(value.toFixed(key === 'weightBrutto' ? 3 : 1));
      }
      const setCharc = (charcId, value) => {
        source.characteristics = source.characteristics.filter(item => item.id !== charcId);
        if (value) source.characteristics.push({ id: charcId, value: [value] });
      };
      const tnved = String(entry.tnved ?? '').trim();
      if (tnved && !/^\d{4,10}$/.test(tnved)) throw apiError(400, `ТН ВЭД — от 4 до 10 цифр: ${tnved}`);
      setCharc(donorParser.TNVED_ID, tnved);
      setCharc(donorParser.VAT_ID, String(entry.vat ?? '').trim());
      return {
        nmId,
        vendorCode,
        sourceVendorCode: parsed.report.donorVendorCode || '',
        title: source.title,
        status: 'queued',
        warnings: [...parsed.report.warnings.filter(text => /размер/.test(text))],
        source,
        prices: new Map([['*', price]])
      };
    });
    return launchJob(id, 'parse', items);
  }
  // Ход задания; без job — последнее задание кабинета (страницу могли перезагрузить).
  function duplicateStatus(id, jobId) {
    const job = jobId ? duplicateJobs.get(jobId) : [...duplicateJobs.values()].filter(item => item.cabinet === id).pop();
    if (!job || job.cabinet !== id) return { job: null };
    return { job: jobView(job) };
  }

  // Маршруты раздела. Возвращает true, если запрос обработан.
  async function handle(req, res, url) {
    const cabinet = () => url.searchParams.get('cabinet') || 'demo';
    if (req.method === 'GET' && url.pathname === '/api/cards') {
      // Предметы и ярлыки — номера через запятую, бренды — JSON-массив (в названии бренда может быть запятая).
      let brands = [];
      try {
        brands = JSON.parse(url.searchParams.get('brands') || '[]');
      } catch {
        brands = [];
      }
      const filter = {
        subjectIDs: String(url.searchParams.get('subjectIDs') || url.searchParams.get('subjectID') || '').split(','),
        brands: Array.isArray(brands) ? brands : [],
        tagIDs: String(url.searchParams.get('tagIDs') || url.searchParams.get('tagID') || '').split(','),
        imts: url.searchParams.get('imts')
      };
      if (url.searchParams.get('brand')) filter.brands.push(url.searchParams.get('brand'));
      send(res, 200, await cardsList(cabinet(), url.searchParams.get('force') === '1', filter));
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/cards/trash') {
      send(res, 200, await trashList(cabinet()));
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/cards/errors') {
      send(res, 200, await errorsList(cabinet()));
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/cards/duplicate') {
      send(res, 200, duplicateStatus(cabinet(), url.searchParams.get('job') || ''));
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/card') {
      send(res, 200, await cardDetail(cabinet(), url.searchParams.get('nmId')));
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/card/media/file') {
      send(res, 200, await uploadMedia(req, url));
      return true;
    }
    const routes = {
      '/api/card/update': updateCard,
      '/api/card/media': saveMedia,
      '/api/card/tags': setCardTags,
      '/api/cards/tag': changeTag,
      '/api/cards/trash': body => moveToTrash(body, false),
      '/api/cards/recover': body => moveToTrash(body, true),
      '/api/cards/move': moveCards,
      '/api/cards/barcodes': barcodes,
      '/api/cards/duplicate': startDuplicate,
      '/api/cards/parse': parseDonors,
      '/api/cards/parse/create': createFromDonors
    };
    if (req.method === 'POST' && routes[url.pathname]) {
      send(res, 200, await routes[url.pathname](await readJson(req)));
      return true;
    }
    return false;
  }
  return { handle, updatePayload, contentErrorText, duplicateVariant };
};
