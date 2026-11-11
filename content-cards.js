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
//   баркоды          POST /content/v2/barcodes — для новых размеров
// Создание карточек сайт не делает. Все изменения — только с confirm: true (подтверждение на странице).
// В демо-кабинете данные хранятся в памяти сервера, изменения применяются к ним — так можно проверить сайт без WB.
'use strict';

const CONTENT = 'https://content-api.wildberries.ru';
const NAMED_DIRECTORIES = ['colors', 'kinds', 'countries', 'seasons', 'vat'];
const TAG_COLORS = ['D1CFD7', 'FEE0E0', 'ECDAFF', 'E4EAFF', 'DEF1DD', 'FFECC7'];
const DOCUMENT_TYPES = [1, 2, 3, 4, 5, 7, 8, 9];
const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

module.exports = function createContentCards({ wbRequest, tokenFor, cabinets, cachedAnalytics, analyticsCache, apiError, readJson, send, localPhoto, productCards, refreshProductCards, productCardsChanged, productCardsStatus }) {
  const isDemo = id => id === 'demo' || !cabinets().length;
  const cardsKey = id => `product-cards:${id}`;
  // Список карточек хранится на сервере и на диске (productCards в server.js). После изменения он поправляется
  // на месте (patch) и перечитывается из WB в фоне.
  const forgetCards = (id, patch) => productCardsChanged(id, patch);

  // Ответы Контента: { data, error, errorText, additionalErrors }. Ошибка бывает и при 200 — тогда тоже исключение.
  // Текст ошибки — errorText и additionalErrors (по артикулам продавца или { error }).
  function contentErrorText(data, fallback) {
    const extra = data?.additionalErrors;
    const details = !extra ? '' : typeof extra === 'string' ? extra : Object.entries(extra).filter(([, value]) => value).map(([key, value]) => key === 'error' || key === 'string' || key === 'description' ? String(value) : `${key}: ${value}`).join('; ');
    const main = data?.errorText || data?.detail || data?.title || fallback;
    return [main, details && details !== main ? details : ''].filter(Boolean).join(' — ');
  }
  async function content(token, path, options = {}) {
    let data;
    try { data = await wbRequest(token, `${CONTENT}${path}`, options); }
    catch (error) { if (error.details && typeof error.details === 'object') error.message = contentErrorText(error.details, error.message); throw error; }
    if (data && data.error === true) throw apiError(400, contentErrorText(data, 'WB не принял запрос'), data);
    return data;
  }

  // --- Демо-кабинет: карточки, характеристики и ярлыки в памяти ---
  const demo = { cards: null, trash: [], tags: [{ id: 1, name: 'Хит', color: 'FFECC7' }, { id: 2, name: 'Новинка', color: 'DEF1DD' }], errors: [] };
  const DEMO_CHARCS = {
    1001: [
      { charcID: 14177449, name: 'Цвет', charcType: 1, maxCount: 3, required: true, unitName: '', existNamedField: false, isVariable: true, popular: true },
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
      { charcID: 14177449, name: 'Цвет', charcType: 1, maxCount: 1, required: false, unitName: '', existNamedField: false, isVariable: true },
      { charcID: 60, name: 'Объём', charcType: 4, maxCount: 0, required: true, unitName: 'мл', existNamedField: false },
      { charcID: 61, name: 'Комплектация', charcType: 1, maxCount: 5, required: false, unitName: '', existNamedField: false }
    ]
  };
  function demoCards() {
    if (demo.cards) return demo.cards;
    const now = Date.now(), card = (index, subjectID, subjectName, title, chars, sizes, extra = {}) => ({
      nmID: 4210000 + index, imtID: 9100000 + (extra.imt ?? index), nmUUID: `demo-${index}`, subjectID, subjectName, vendorCode: `DEMO-${index + 1}`, brand: 'Demo', title,
      description: `${title}. Демо-описание карточки: здесь продавец рассказывает о товаре, материалах и уходе.`, needKiz: false, kizMarked: false, photos: [], video: '',
      dimensions: { length: 30, width: 20, height: 5, weightBrutto: 0.45, isValid: index !== 3 }, characteristics: chars,
      sizes, tags: index % 3 === 0 ? [demo.tags[0]] : [], createdAt: new Date(now - (40 - index) * 86_400_000).toISOString(), updatedAt: new Date(now - index * 3_600_000).toISOString(),
      documents: index === 1 ? { items: [{ id: 'demo-doc-1', type: 2, number: 'ЕАЭС N RU Д-CN.DEMO.12345/25', startDate: '2025-02-13T00:00:00Z', endDate: '2030-02-10T00:00:00Z', verdict: { verified: true, status: 1, reason: 'valid' } }], overallVerdict: { isFullyChecked: true, status: 1 }, excludeDocuments: false } : { items: [], excludeDocuments: false },
      ...extra.fields
    });
    const hoodieSizes = (base, sizes) => sizes.map((techSize, i) => ({ chrtID: base + i, techSize, wbSize: String(42 + i * 2), skus: [`46000${base + i}`] }));
    demo.cards = [
      card(0, 1001, 'Худи', 'Худи оверсайз с капюшоном', [{ id: 14177449, name: 'Цвет', value: ['черный'] }, { id: 50, name: 'Состав', value: ['хлопок 80%', 'полиэстер 20%'] }, { id: 53, name: 'Плотность ткани', value: 320 }], hoodieSizes(70000, ['S', 'M', 'L']), { imt: 0 }),
      card(1, 1001, 'Худи', 'Худи оверсайз с капюшоном', [{ id: 14177449, name: 'Цвет', value: ['серый меланж'] }, { id: 50, name: 'Состав', value: ['хлопок 80%', 'полиэстер 20%'] }], hoodieSizes(71000, ['S', 'M', 'L', 'XL']), { imt: 0 }),
      card(2, 1001, 'Худи', 'Худи детское на молнии', [{ id: 14177449, name: 'Цвет', value: ['синий'] }], hoodieSizes(72000, ['110', '122'])),
      card(3, 1002, 'Бутылки для воды', 'Бутылка для воды спортивная 750 мл', [{ id: 60, name: 'Объём', value: 750 }, { id: 61, name: 'Комплектация', value: ['бутылка', 'крышка'] }], [{ chrtID: 73000, techSize: '0', wbSize: '', skus: ['4600073000'] }]),
      card(4, 1002, 'Бутылки для воды', 'Бутылка стеклянная в чехле', [{ id: 60, name: 'Объём', value: 500 }], [{ chrtID: 74000, techSize: '0', wbSize: '', skus: ['4600074000'] }])
    ];
    demo.trash = [card(5, 1002, 'Бутылки для воды', 'Бутылка старая модель', [], [{ chrtID: 75000, techSize: '0', wbSize: '', skus: ['4600075000'] }], { fields: { trashedAt: new Date(now - 2 * 86_400_000).toISOString() } })];
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
    const docs = card.documents || {}, items = docs.items || [];
    if (docs.overallVerdict?.status === 2 || items.some(item => item.verdict?.status === 2)) return 'fail';
    if (items.length && (!docs.overallVerdict || items.some(item => !item.verdict))) return 'pending';
    if (docs.overallVerdict?.status === 1) return 'ok';
    return items.length ? 'pending' : null;
  }
  // Причины ошибок проверки: общая по карточке и по каждому документу. По документации reason приходит только при status 2;
  // на деле бывает status 1 с reason, поэтому берётся только status 2. Причин documents_missing и documents_invalid и поля
  // issues (каких типов документов не хватает) в документации нет, но WB их присылает.
  function docErrorsOf(card) {
    const docs = card.documents || {}, checks = [docs.overallVerdict, ...(docs.items || []).map(item => item.verdict)];
    return [...new Set(checks.filter(check => check?.status === 2 && check.reason).map(check => check.reason))];
  }
  const missingDocsOf = card => [...new Set((card.documents?.issues || []).filter(issue => issue.code === 'document_missing').flatMap(issue => issue.documentTypes || []))];
  function listItem(card, groupSizes) {
    const photo = card.photos?.[0] || {};
    return {
      nmID: card.nmID, imtID: card.imtID, vendorCode: card.vendorCode || '', title: card.title || '', brand: card.brand || '', subjectID: card.subjectID, subjectName: card.subjectName || '',
      photo: localPhoto(photo.c246x328 || photo.tm || photo.square || photo.big || ''), photos: (card.photos || []).length, video: Boolean(card.video),
      sizes: (card.sizes || []).map(size => ({ techSize: size.techSize || '', wbSize: size.wbSize || '', skus: size.skus || [] })),
      tags: card.tags || [], needKiz: Boolean(card.needKiz), kizMarked: Boolean(card.kizMarked), dimensions: card.dimensions || null,
      documents: (card.documents?.items || []).length, verdict: verdictOf(card), docErrors: docErrorsOf(card), missingDocs: missingDocsOf(card), descriptionLength: String(card.description || '').length,
      characteristics: (card.characteristics || []).length, groupSize: groupSizes.get(card.imtID) || 1, createdAt: card.createdAt || '', updatedAt: card.updatedAt || '', trashedAt: card.trashedAt || ''
    };
  }
  // refreshing — из WB как раз грузится свежий список: страница спросит ещё раз и покажет его. loading — самой первой
  // загрузки ещё нет на диске: в cards то, что уже пришло, loaded — сколько.
  async function cardsList(id, force) {
    const cards = await allCards(id, force, false), groupSizes = new Map();
    cards.forEach(card => groupSizes.set(card.imtID, (groupSizes.get(card.imtID) || 0) + 1));
    const warnings = [];
    const tags = await tagsOf(id).catch(error => (warnings.push(`Ярлыки: ${error.message}`), []));
    const status = isDemo(id) ? { savedAt: Date.now(), refreshing: false } : productCardsStatus(id);
    return { demo: isDemo(id), cards: cards.map(card => listItem(card, groupSizes)), tags, warnings, fetchedAt: new Date(status.savedAt || Date.now()).toISOString(),
      refreshing: status.refreshing, loading: !status.savedAt && status.refreshing, loaded: status.loaded || 0 };
  }
  async function trashList(id) {
    if (isDemo(id)) { demoCards(); return { demo: true, cards: demo.trash.map(card => listItem(card, new Map())) }; }
    const token = tokenFor(id), cards = [];
    let cursor = { limit: 100 };
    for (let page = 0; page < 30; page++) {
      const response = await content(token, '/content/v2/get/cards/trash', { method: 'POST', body: { settings: { sort: { ascending: false }, cursor } } });
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
    return cachedAnalytics(`content-errors:${id}`, async () => {
      const token = tokenFor(id), items = [];
      let cursor = { limit: 100 };
      for (let page = 0; page < 5; page++) {
        const response = await content(token, '/content/v2/cards/error/list', { method: 'POST', body: { cursor, order: { ascending: false } } });
        const data = response?.data || {};
        for (const batch of data.items || []) for (const vendorCode of batch.vendorCodes || Object.keys(batch.errors || {})) {
          items.push({ vendorCode, subject: batch.subjects?.[vendorCode]?.name || '', errors: batch.errors?.[vendorCode] || [], updatedAt: batch.updatedAt || '' });
        }
        if (!data.cursor?.next) break;
        cursor = { limit: 100, updatedAt: data.cursor.updatedAt, batchUUID: data.cursor.batchUUID };
      }
      return { demo: false, items };
    }, 60_000);
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
    const token = tokenFor(id), mine = cards => (cards || []).find(item => item.nmID === nmId);
    const search = async (path, text) => mine((await content(token, path, { method: 'POST', body: { settings: { cursor: { limit: 100 }, filter: { textSearch: text, ...(path.endsWith('/list') ? { withPhoto: -1 } : {}) } } } }))?.cards);
    // Весь список по страницам: cursor — из ответа (у корзины — trashedAt вместо updatedAt), пока страница полная.
    const scan = async path => {
      let cursor = { limit: 100 };
      for (let page = 0; page < 1000; page++) {
        if (page) await new Promise(resolve => setTimeout(resolve, 650));
        const response = await content(token, path, { method: 'POST', body: { settings: { sort: { ascending: false }, cursor, filter: path.endsWith('/list') ? { withPhoto: -1 } : {} } } });
        const found = mine(response?.cards), next = response?.cursor || {};
        if (found) return found;
        if ((response?.cards || []).length < 100 || !next.nmID) return null;
        cursor = { limit: 100, nmID: next.nmID, ...(next.trashedAt ? { trashedAt: next.trashedAt } : { updatedAt: next.updatedAt }) };
      }
      return null;
    };
    let card = await search('/content/v2/get/cards/list', String(nmId));
    if (!card) {
      const saved = mine(await allCards(id, false, false).catch(() => []));
      for (const barcode of (saved?.sizes || []).flatMap(size => size.skus || []).slice(0, 3)) if (!card) card = await search('/content/v2/get/cards/list', String(barcode));
    }
    if (!card) card = await scan('/content/v2/get/cards/list');
    if (card) return { card, trashed: false };
    const trashed = await search('/content/v2/get/cards/trash', String(nmId)) || await scan('/content/v2/get/cards/trash');
    if (trashed) return { card: trashed, trashed: true };
    throw apiError(404, 'Карточка не найдена в WB — ни в списке карточек, ни в корзине; возможно, её удалили');
  }
  async function charcsOf(id, subjectId) {
    if (isDemo(id)) return DEMO_CHARCS[subjectId] || [];
    return cachedAnalytics(`content-charcs:${subjectId}`, async () => (await content(tokenFor(id), `/content/v2/object/charcs/${subjectId}`))?.data || [], 6 * 60 * 60_000);
  }
  // Справочники значений: Цвет, Пол, Страна производства, Сезон, Ставка НДС — подсказки при вводе.
  async function dictionaries(id) {
    if (isDemo(id)) return { colors: ['черный', 'белый', 'серый меланж', 'синий', 'красный'], kinds: ['Мужской', 'Женский', 'Детский'], countries: ['Россия', 'Китай', 'Турция'], seasons: ['круглогодичный', 'лето', 'демисезон', 'зима'], vat: ['0', '5', '10', '20', 'Без НДС'] };
    const result = {};
    for (const name of NAMED_DIRECTORIES) {
      result[name] = await cachedAnalytics(`content-dict:${name}`, async () => ((await content(tokenFor(id), `/content/v2/directory/${name}`))?.data || []).map(item => typeof item === 'string' ? item : item.name).filter(Boolean), 24 * 60 * 60_000).catch(() => []);
    }
    return result;
  }
  async function cardDetail(id, nmIdInput) {
    const nmId = Number(nmIdInput);
    if (!Number.isInteger(nmId) || nmId <= 0) throw apiError(400, 'Некорректный артикул WB');
    const { card, trashed } = await freshCard(id, nmId), warnings = [];
    const [charcs, dicts, tags, cards, errors] = await Promise.all([
      charcsOf(id, card.subjectID).catch(error => (warnings.push(`Характеристики предмета: ${error.message}`), [])),
      dictionaries(id),
      tagsOf(id).catch(error => (warnings.push(`Ярлыки: ${error.message}`), [])),
      allCards(id).catch(() => []),
      errorsList(id).catch(() => ({ items: [] }))
    ]);
    // Свежая карточка заменяет её же в кэше списка — список сразу показывает новые данные.
    if (!trashed && !isDemo(id)) { const cached = analyticsCache.get(cardsKey(id)); if (cached?.value) { const index = cached.value.findIndex(item => item.nmID === nmId); if (index >= 0) cached.value[index] = card; } }
    const group = trashed ? [] : cards.filter(item => item.imtID === card.imtID && item.nmID !== nmId).map(item => ({ nmID: item.nmID, vendorCode: item.vendorCode, title: item.title, photo: localPhoto(item.photos?.[0]?.tm || item.photos?.[0]?.c246x328 || '') }));
    const groupSizes = new Map(); cards.forEach(item => groupSizes.set(item.imtID, (groupSizes.get(item.imtID) || 0) + 1));
    const sameSubject = trashed ? [] : cards.filter(item => item.subjectID === card.subjectID && item.imtID !== card.imtID).map(item => ({ nmID: item.nmID, imtID: item.imtID, vendorCode: item.vendorCode, title: item.title,
      photo: localPhoto(item.photos?.[0]?.tm || item.photos?.[0]?.c246x328 || ''), groupSize: groupSizes.get(item.imtID) || 1 }));
    return { demo: isDemo(id), trashed, card, charcs, dictionaries: dicts, tags, group, sameSubject, errors: (errors.items || []).filter(item => item.vendorCode === card.vendorCode), warnings, fetchedAt: new Date().toISOString() };
  }

  // --- Изменения ---
  const needConfirm = body => { if (!body?.confirm) throw apiError(400, 'Подтвердите изменение карточки'); };
  const nmIdsOf = list => { const ids = [...new Set((Array.isArray(list) ? list : []).map(Number))].filter(value => Number.isInteger(value) && value > 0); if (!ids.length) throw apiError(400, 'Не выбраны карточки'); return ids; };

  // Карточка для /content/v2/cards/update из присланной страницей: только поля, которые метод принимает. Проверки —
  // то, что WB иначе отклонит или молча испортит: наименование до 60 символов, все существующие размеры и баркоды
  // на месте (удалять их метод не умеет), значения характеристик — массив строк или число.
  function updatePayload(input, fresh) {
    if (Number(input.nmID) !== fresh.nmID) throw apiError(400, 'Артикул WB не совпадает');
    const text = (value, max) => { const result = String(value ?? '').trim(); if (max && result.length > max) throw apiError(400, `Слишком длинное значение (больше ${max} символов)`); return result; };
    const vendorCode = text(input.vendorCode, 72); if (!vendorCode) throw apiError(400, 'Укажите артикул продавца');
    const number = (value, name, { integer = false, decimals = 3 } = {}) => {
      if (value === '' || value == null) return 0;
      const result = Number(value); if (!Number.isFinite(result) || result < 0) throw apiError(400, `${name}: нужно неотрицательное число`);
      if (integer && !Number.isInteger(result)) throw apiError(400, `${name}: нужно целое число`);
      return Number(result.toFixed(decimals));
    };
    const dims = input.dimensions || {};
    const characteristics = (Array.isArray(input.characteristics) ? input.characteristics : []).map(item => {
      const idValue = Number(item.id); if (!Number.isInteger(idValue)) throw apiError(400, 'Некорректная характеристика');
      if (typeof item.value === 'number') { if (!Number.isFinite(item.value)) throw apiError(400, `Характеристика ${idValue}: некорректное число`); return { id: idValue, value: item.value }; }
      const values = (Array.isArray(item.value) ? item.value : [item.value]).map(value => String(value ?? '').trim()).filter(Boolean);
      return values.length ? { id: idValue, value: values } : null;
    }).filter(Boolean);
    const freshSizes = new Map((fresh.sizes || []).map(size => [Number(size.chrtID), size]));
    const sizes = (Array.isArray(input.sizes) ? input.sizes : []).map(size => {
      const skus = [...new Set((size.skus || []).map(value => String(value).trim()).filter(Boolean))];
      if (size.chrtID) {
        const old = freshSizes.get(Number(size.chrtID)); if (!old) throw apiError(400, `Размер ${size.chrtID} не найден в карточке`);
        const missing = (old.skus || []).filter(sku => !skus.includes(sku)); if (missing.length) throw apiError(400, `Баркоды нельзя удалить через API: ${missing.join(', ')}`);
        return { chrtID: Number(size.chrtID), techSize: text(size.techSize), wbSize: text(size.wbSize), skus };
      }
      if (!skus.length) throw apiError(400, 'У нового размера должен быть баркод');
      const price = Number(size.price); if (!Number.isInteger(price) || price <= 0) throw apiError(400, 'Укажите цену нового размера целым числом, ₽');
      return { techSize: text(size.techSize), wbSize: text(size.wbSize), price, skus };
    });
    const kept = new Set(sizes.filter(size => size.chrtID).map(size => size.chrtID));
    const lost = [...freshSizes.keys()].filter(chrtID => !kept.has(chrtID)); if (lost.length) throw apiError(400, 'Удалять размеры через API нельзя — все существующие размеры должны остаться');
    const docs = input.documents || {};
    const documents = {
      items: (Array.isArray(docs.items) ? docs.items : []).map(item => {
        const type = Number(item.type); if (!DOCUMENT_TYPES.includes(type)) throw apiError(400, 'Укажите тип документа');
        const result = { type, number: text(item.number, 200) }; if (!result.number) throw apiError(400, 'Укажите номер документа');
        if (item.id) result.id = String(item.id);
        for (const key of ['productNumber', 'tradeName', 'applicant']) if (String(item[key] || '').trim()) result[key] = text(item[key], 500);
        for (const key of ['startDate', 'endDate']) if (item[key]) { const time = Date.parse(item[key]); if (!Number.isFinite(time)) throw apiError(400, 'Некорректная дата документа'); result[key] = new Date(time).toISOString(); }
        result.isEndless = Boolean(item.isEndless); if (result.isEndless) delete result.endDate;
        return result;
      }),
      excludeDocuments: Boolean(docs.excludeDocuments)
    };
    const payload = {
      nmID: fresh.nmID, vendorCode, kizMarked: Boolean(input.kizMarked), brand: text(input.brand, 200), title: text(input.title, 60), description: text(input.description, 5000),
      dimensions: { length: number(dims.length, 'Длина', { integer: true }), width: number(dims.width, 'Ширина', { integer: true }), height: number(dims.height, 'Высота', { integer: true }), weightBrutto: number(dims.weightBrutto, 'Вес') },
      documents, characteristics, sizes
    };
    if (fresh.gtin || input.gtin) payload.gtin = text(input.gtin ?? fresh.gtin, 30);
    return payload;
  }
  async function updateCard(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'), nmId = Number(body.card?.nmID);
    const { card: fresh, trashed } = await freshCard(id, nmId);
    if (trashed) throw apiError(400, 'Карточка в корзине — сначала восстановите её');
    // Карточку могли изменить в WB после того, как страница её открыла: тогда наше сохранение затёрло бы чужие правки.
    if (body.updatedAt && fresh.updatedAt && body.updatedAt !== fresh.updatedAt) throw apiError(409, 'Карточку изменили в WB после того, как вы её открыли. Обновите страницу, проверьте данные и сохраните ещё раз');
    const payload = updatePayload(body.card, fresh);
    if (isDemo(id)) {
      const target = demoCards().find(item => item.nmID === nmId);
      Object.assign(target, payload, { sizes: payload.sizes.map((size, index) => ({ chrtID: size.chrtID || nmId * 10 + index, techSize: size.techSize, wbSize: size.wbSize, skus: size.skus })), updatedAt: new Date().toISOString() });
      return { ok: true, demo: true, sent: payload };
    }
    await content(tokenFor(id), '/content/v2/cards/update', { method: 'POST', body: [payload] });
    forgetCards(id); analyticsCache.delete(`content-errors:${id}`);
    return { ok: true, sent: payload };
  }
  // Медиа по ссылкам: новый набор целиком заменяет старый. Видео WB отдаёт потоковой ссылкой (m3u8), а метод принимает
  // только MOV и MP4 — поэтому у карточки с видео менять набор фото нельзя: видео пропало бы или весь запрос отклонили.
  async function saveMedia(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'), nmId = Number(body.nmId);
    const urls = (Array.isArray(body.urls) ? body.urls : []).map(value => String(value).trim()).filter(Boolean);
    if (!urls.length) throw apiError(400, 'В карточке должно остаться хотя бы одно фото');
    if (urls.length > 30) throw apiError(400, 'Максимум 30 фото в карточке');
    for (const url of urls) { let target; try { target = new URL(url); } catch { throw apiError(400, `Некорректная ссылка: ${url}`); } if (!/^https?:$/.test(target.protocol)) throw apiError(400, `Ссылка должна начинаться с https://: ${url}`); }
    const { card } = await freshCard(id, nmId);
    if (card.video) throw apiError(400, 'У карточки есть видео: через API набор фото можно заменить только вместе с видео, а видео WB отдаёт в формате, который нельзя загрузить обратно. Добавляйте фото файлом, а порядок и удаление меняйте в личном кабинете WB');
    if (isDemo(id)) { const target = demoCards().find(item => item.nmID === nmId); target.photos = urls.map(url => ({ big: url, c246x328: url, tm: url })); target.updatedAt = new Date().toISOString(); return { ok: true, demo: true }; }
    await content(tokenFor(id), '/content/v3/media/save', { method: 'POST', body: { nmId, data: urls } });
    forgetCards(id);
    return { ok: true };
  }
  // Один файл (фото или видео) — добавляется к уже загруженным: номер больше их количества, у видео всегда 1.
  async function uploadMedia(req, url) {
    if (url.searchParams.get('confirm') !== '1') throw apiError(400, 'Подтвердите загрузку файла');
    const id = String(url.searchParams.get('cabinet') || 'demo'), nmId = Number(url.searchParams.get('nmId')), number = Number(url.searchParams.get('number'));
    if (!Number.isInteger(nmId) || nmId <= 0 || !Number.isInteger(number) || number < 1 || number > 30) throw apiError(400, 'Некорректный артикул или номер файла');
    const type = String(req.headers['content-type'] || ''), name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')).replace(/[^\w.\-а-яё ]/gi, '_').slice(0, 120) || 'file';
    if (!/^(image\/(jpeg|png|bmp|gif|webp)|video\/(mp4|quicktime))$/.test(type)) throw apiError(400, 'Формат файла: фото JPG, PNG, BMP, GIF, WebP или видео MP4, MOV');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MEDIA_MAX_BYTES) throw apiError(413, 'Файл больше 50 Мб'); chunks.push(chunk); }
    if (!size) throw apiError(400, 'Пустой файл');
    if (type.startsWith('image/') && size > 32 * 1024 * 1024) throw apiError(413, 'Фото больше 32 Мб');
    if (isDemo(id)) { const target = demoCards().find(item => item.nmID === nmId); if (type.startsWith('video/')) target.video = 'demo-video'; else target.photos.push({ big: '', tm: '' }); return { ok: true, demo: true }; }
    const form = new FormData();
    form.append('uploadfile', new Blob([Buffer.concat(chunks)], { type }), name);
    const response = await fetch(`${CONTENT}/content/v3/media/file`, { method: 'POST', headers: { Authorization: tokenFor(id), 'X-Nm-Id': String(nmId), 'X-Photo-Number': String(number) }, body: form, signal: AbortSignal.timeout(120_000) });
    const text = await response.text(); let data = text; try { data = JSON.parse(text); } catch {}
    if (!response.ok || data?.error === true) throw apiError(response.ok ? 400 : response.status, typeof data === 'object' ? contentErrorText(data, `WB не принял файл (${response.status})`) : `WB не принял файл (${response.status}): ${String(text).slice(0, 200)}`);
    forgetCards(id);
    return { ok: true };
  }
  async function setCardTags(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'), nmId = Number(body.nmId);
    const tagIds = [...new Set((Array.isArray(body.tagIds) ? body.tagIds : []).map(Number))].filter(Number.isInteger);
    if (tagIds.length > 15) throw apiError(400, 'К карточке можно добавить максимум 15 ярлыков');
    if (isDemo(id)) { const target = demoCards().find(item => item.nmID === nmId); target.tags = demo.tags.filter(tag => tagIds.includes(tag.id)); return { ok: true, demo: true }; }
    await content(tokenFor(id), '/content/v2/tag/nomenclature/link', { method: 'POST', body: { nmID: nmId, tagsIDs: tagIds } });
    forgetCards(id);
    return { ok: true };
  }
  // Ярлыки продавца: до 15 штук, имя до 15 символов, цвет — из шести цветов WB.
  async function changeTag(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'), action = body.action, tagId = Number(body.id);
    const name = String(body.name ?? '').trim(), color = String(body.color || 'D1CFD7').toUpperCase();
    if (action !== 'delete') {
      if (!name) throw apiError(400, 'Укажите название ярлыка');
      if (name.length > 15) throw apiError(400, 'Название ярлыка — не больше 15 символов');
      if (!TAG_COLORS.includes(color)) throw apiError(400, 'Недопустимый цвет ярлыка');
    }
    if (isDemo(id)) {
      if (action === 'create') { if (demo.tags.length >= 15) throw apiError(400, 'Исчерпан лимит на создание ярлыков'); demo.tags.push({ id: Math.max(0, ...demo.tags.map(tag => tag.id)) + 1, name, color }); }
      else if (action === 'update') Object.assign(demo.tags.find(tag => tag.id === tagId) || {}, { name, color });
      else if (action === 'delete') { demo.tags = demo.tags.filter(tag => tag.id !== tagId); demoCards().forEach(card => { card.tags = (card.tags || []).filter(tag => tag.id !== tagId); }); }
      else throw apiError(400, 'Неизвестное действие');
      return { ok: true, demo: true, tags: demo.tags };
    }
    const token = tokenFor(id);
    if (action === 'create') await content(token, '/content/v2/tag', { method: 'POST', body: { name, color } });
    else if (action === 'update') { if (!Number.isInteger(tagId)) throw apiError(400, 'Не указан ярлык'); await content(token, `/content/v2/tag/${tagId}`, { method: 'PATCH', body: { name, color } }); }
    else if (action === 'delete') { if (!Number.isInteger(tagId)) throw apiError(400, 'Не указан ярлык'); await content(token, `/content/v2/tag/${tagId}`, { method: 'DELETE' }); }
    else throw apiError(400, 'Неизвестное действие');
    forgetCards(id);
    return { ok: true, tags: await tagsOf(id) };
  }
  // Корзина: карточка продаётся, пока есть остатки; через 30 дней без остатков WB удаляет её сам.
  async function moveToTrash(body, restore) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'), nmIds = nmIdsOf(body.nmIds);
    if (nmIds.length > 1000) throw apiError(400, 'Не больше 1000 карточек за раз');
    if (isDemo(id)) {
      demoCards();
      const from = restore ? demo.trash : demo.cards, to = restore ? demo.cards : demo.trash;
      for (const nmId of nmIds) { const index = from.findIndex(card => card.nmID === nmId); if (index >= 0) { const [card] = from.splice(index, 1); card.trashedAt = restore ? '' : new Date().toISOString(); to.push(card); } }
      return { ok: true, demo: true };
    }
    await content(tokenFor(id), restore ? '/content/v2/cards/recover' : '/content/v2/cards/delete/trash', { method: 'POST', body: { nmIDs: nmIds } });
    forgetCards(id, restore ? null : list => list.filter(card => !nmIds.includes(card.nmID)));
    return { ok: true };
  }
  // Объединение (с targetIMT — до 30 карточек одного предмета) и разъединение (без targetIMT; по одной карточке за запрос,
  // иначе отделённые карточки объединятся между собой). По документации в группе после объединения — не больше 30 карточек
  // («В группу можно объединить не больше 30 карточек») и все одного предмета: это проверяется заранее по списку карточек.
  // Карточка, которая была в другой группе, уходит из неё.
  async function moveCards(body) {
    needConfirm(body);
    const id = String(body.cabinet || 'demo'), nmIds = nmIdsOf(body.nmIds), targetIMT = body.targetIMT == null || body.targetIMT === '' ? null : Number(body.targetIMT);
    if (nmIds.length > 30) throw apiError(400, 'Объединить можно не больше 30 карточек');
    if (targetIMT !== null && !Number.isInteger(targetIMT)) throw apiError(400, 'Некорректный imtID');
    if (targetIMT === null && nmIds.length > 1) throw apiError(400, 'Отсоединять карточки нужно по одной');
    if (targetIMT !== null) {
      const cards = await allCards(id).catch(() => []), group = cards.filter(card => card.imtID === targetIMT);
      if (group.length) {
        const total = new Set([...group.map(card => card.nmID), ...nmIds]).size;
        if (total > 30) throw apiError(400, `В группе будет ${total} карточек, а можно не больше 30`);
        const subject = group[0].subjectID, other = cards.filter(card => nmIds.includes(card.nmID) && card.subjectID !== subject);
        if (other.length) throw apiError(400, `Объединять можно только карточки одного предмета («${group[0].subjectName}»): ${other.map(card => card.vendorCode || card.nmID).join(', ')}`);
      }
    }
    if (isDemo(id)) { demoCards().filter(item => nmIds.includes(item.nmID)).forEach(card => { card.imtID = targetIMT ?? 9200000 + card.nmID % 1000; }); return { ok: true, demo: true }; }
    // Склейки по 30 сайт шлёт подряд (лимит Контента — 100 запросов в минуту, всплеск 5). Если WB всё же ответил 429 —
    // ждём, сколько он сказал в X-Ratelimit-Retry, и повторяем (до 3 раз).
    for (let retry = 0; ; retry++) {
      try { await content(tokenFor(id), '/content/v2/cards/moveNm', { method: 'POST', body: targetIMT === null ? { nmIDs: nmIds } : { targetIMT, nmIDs: nmIds } }); break; }
      catch (error) { if (error.status !== 429 || retry >= 3) throw error; await new Promise(resolve => setTimeout(resolve, Math.max(1000, (error.retryAfter || 0) * 1000))); }
    }
    // Новый imtID отсоединённой карточки WB сообщит при перечитывании; до тех пор — свой, отрицательный, чтобы она была отдельно.
    forgetCards(id, list => list.map(card => nmIds.includes(card.nmID) ? { ...card, imtID: targetIMT ?? -card.nmID } : card));
    return { ok: true, moved: nmIds.length };
  }
  async function barcodes(body) {
    const id = String(body.cabinet || 'demo'), count = Math.max(1, Math.min(20, Math.round(Number(body.count) || 1)));
    if (isDemo(id)) return { barcodes: Array.from({ length: count }, (_, index) => `20${String(Date.now()).slice(-9)}${index}`) };
    return { barcodes: (await content(tokenFor(id), '/content/v2/barcodes', { method: 'POST', body: { count } }))?.data || [] };
  }

  // Маршруты раздела. Возвращает true, если запрос обработан.
  async function handle(req, res, url) {
    const cabinet = () => url.searchParams.get('cabinet') || 'demo';
    if (req.method === 'GET' && url.pathname === '/api/cards') { send(res, 200, await cardsList(cabinet(), url.searchParams.get('force') === '1')); return true; }
    if (req.method === 'GET' && url.pathname === '/api/cards/trash') { send(res, 200, await trashList(cabinet())); return true; }
    if (req.method === 'GET' && url.pathname === '/api/cards/errors') { send(res, 200, await errorsList(cabinet())); return true; }
    if (req.method === 'GET' && url.pathname === '/api/card') { send(res, 200, await cardDetail(cabinet(), url.searchParams.get('nmId'))); return true; }
    if (req.method === 'POST' && url.pathname === '/api/card/media/file') { send(res, 200, await uploadMedia(req, url)); return true; }
    const routes = {
      '/api/card/update': updateCard, '/api/card/media': saveMedia, '/api/card/tags': setCardTags, '/api/cards/tag': changeTag,
      '/api/cards/trash': body => moveToTrash(body, false), '/api/cards/recover': body => moveToTrash(body, true), '/api/cards/move': moveCards, '/api/cards/barcodes': barcodes
    };
    if (req.method === 'POST' && routes[url.pathname]) { send(res, 200, await routes[url.pathname](await readJson(req))); return true; }
    return false;
  }
  return { handle, updatePayload, contentErrorText };
};
