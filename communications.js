// --- Раздел «Сообщения»: общение с покупателями (WB API) — чаты, вопросы, отзывы, заявки на возврат ---
// Методы — документация WB «Общение с покупателями» (customer-communication, файл спецификации 09-communications.yaml):
//   вопросы   GET  feedbacks-api /api/v1/questions/count-unanswered, /api/v1/questions (take + skip ≤ 10 000)
//             PATCH /api/v1/questions: { id, wasViewed } — просмотрен; { id, answer: { text }, state: 'wbRu' } — ответить
//             или изменить ответ (один раз за 60 дней); { id, answer: { text }, state: 'none' } — отклонить вопрос
//   отзывы    GET  /api/v1/feedbacks/count-unanswered, /api/v1/feedbacks (isAnswered обязателен, take ≤ 5 000),
//             /api/v1/feedbacks/archive (с ответом, без ответа 30 дней, без текста и фото)
//             POST /api/v1/feedbacks/answer, PATCH /api/v1/feedbacks/answer — { id, text } 2–5000 символов, 204 без тела;
//             изменить ответ можно один раз за 60 дней; POST /api/v1/feedbacks/order/return { feedbackId } —
//             возврат товара, если у отзыва isAbleReturnProductOrders
//             Лимит категории «Вопросы и отзывы» — 3 запроса в секунду (интервал 333 мс) на все методы сразу.
//   чаты      GET  buyer-chat-api /api/v1/seller/chats — все чаты (подпись replySign для ответа);
//             GET  /api/v1/seller/events?next= — события всех чатов от старых к новым: повторять с next из ответа,
//             пока totalEvents не станет 0. События хранятся на компьютере (data/Chats/<кабинет>.json), как советует
//             WB, и дочитываются с сохранённого next. POST /api/v1/seller/message — multipart: replySign, message
//             до 1000 символов, file — JPEG, PNG, PDF до 5 Мб, всего до 30 Мб. GET /api/v1/seller/download/{id} —
//             файл из сообщения; 202 — файл на модерации (retrySeconds), 451 — не прошёл модерацию.
//             Лимит — 10 запросов за 10 секунд (интервал 1 с).
//   возвраты  GET  returns-api /api/v1/claims?is_archive= (заявки за 14 дней, limit ≤ 200);
//             PATCH /api/v1/claim { id, action, comment } — action только из actions заявки; comment 10–1000 символов,
//             обязателен для rejectcustom, можно для approvecc1. Лимит — 20 запросов в минуту (интервал 3 с).
// Расхождения с документацией: в goodCard чатов и событий WB присылает ещё name — название товара; у изображений в
// событиях бывает пустой url и нет downloadID — такие показываются как «изображение недоступно».
// Закреплённые отзывы (pins) — только по подписке «Джем» или тарифной опции, в раздел не входят.
// Ответы покупателям уходят только с confirm: true (подтверждение на странице). В демо-кабинете данные — в памяти сервера.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FEEDBACKS = 'https://feedbacks-api.wildberries.ru';
const CHAT = 'https://buyer-chat-api.wildberries.ru';
const RETURNS = 'https://returns-api.wildberries.ru';
const SCOPES = { [FEEDBACKS]: 'Вопросы и отзывы', [CHAT]: 'Чат с покупателями', [RETURNS]: 'Возвраты покупателями' };
// Интервал между запросами одного кабинета к одной категории — из таблиц лимитов WB (персональный токен).
const PACE_MS = { [FEEDBACKS]: 350, [CHAT]: 1000, [RETURNS]: 3000 };
const CLAIM_ACTIONS = {
  approve1: 'Одобрить с проверкой брака', approve2: 'Одобрить и забрать товар', autorefund1: 'Одобрить без возврата товара',
  reject1: 'Отклонить: брак не обнаружен', reject2: 'Отклонить: нужны фото или видео', reject3: 'Отклонить: в сервисный центр',
  rejectcustom: 'Отклонить с комментарием', approvecc1: 'Одобрить с возвратом в магазин', confirmreturngoodcc1: 'Подтвердить приёмку товара'
};
const CHAT_FILE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const CHAT_FILE_MAX = 5 * 1024 * 1024;
const CHAT_FILES_MAX = 30 * 1024 * 1024;
const CHAT_MESSAGE_MAX = 1000;
const EVENTS_MAX_PAGES = 40;
const CHATS_TTL = 30_000;
// «Ждёт ответа» — последнее сообщение от покупателя не старше 10 дней: WB советует отвечать в чате в течение 10 дней.
const CHAT_ANSWER_DAYS = 10;
const SUMMARY_TTL = 60_000;

module.exports = function createCommunications({ wbRequest, tokenFor, cabinets, cachedAnalytics, analyticsCache, apiError, readJson, send, chatsDir }) {
  const isDemo = id => id === 'demo' || !cabinets().length;
  const cabinetOf = value => { const id = String(value || 'demo'); if (!/^[\w-]{1,40}$/.test(id)) throw apiError(400, 'Некорректный кабинет'); return id; };
  const forget = (id, ...keys) => keys.forEach(key => analyticsCache.delete(`messages-${key}:${id}`));
  const needConfirm = body => { if (body?.confirm !== true) throw apiError(400, 'Подтвердите действие на странице'); };
  const textOf = (value, min, max, label) => {
    const text = String(value ?? '').trim();
    if (text.length < min) throw apiError(400, min > 1 ? `${label} — не короче ${min} символов` : `Напишите ${label.toLowerCase()}`);
    if (text.length > max) throw apiError(400, `${label} — не длиннее ${max} символов`);
    return text;
  };

  // Запросы одного кабинета к одной категории идут по очереди с интервалом из лимитов WB.
  const queues = new Map();
  function paced(key, ms, task) {
    const run = (queues.get(key) || Promise.resolve()).then(task);
    queues.set(key, run.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, ms))));
    return run;
  }
  // Ошибки WB — понятным текстом: нет категории в токене, частые запросы; у вопросов и отзывов ошибка бывает и при 200.
  function wbError(base, error) {
    const detail = String(error.details?.detail || error.details?.errorText || error.message || '');
    if (error.status === 403 && /scope/i.test(detail)) error.message = `Нет доступа: в токене кабинета нет категории «${SCOPES[base]}». Создайте токен с этой категорией в кабинете WB → Доступ к API`;
    else if (error.status === 429) error.message = 'WB ограничил частоту запросов — попробуйте через минуту';
    else if (error.details?.errorText) error.message = error.details.errorText;
    else if (error.details?.error && typeof error.details.error === 'string') error.message = error.details.error;
    return error;
  }
  async function call(base, id, pathname, options = {}) {
    const token = tokenFor(id);
    let data;
    try { data = await paced(`${base}|${id}`, PACE_MS[base], () => wbRequest(token, `${base}${pathname}`, options)); }
    catch (error) { throw wbError(base, error); }
    if (data && data.error === true) throw apiError(400, data.errorText || 'WB не принял запрос', data);
    return data;
  }
  async function readLargeJson(req, max) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > max) throw apiError(413, 'Файлы больше 30 Мб'); chunks.push(chunk); }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw apiError(400, 'Некорректный JSON'); }
  }

  // --- Демо-кабинет ---
  let demo = null;
  function demoData() {
    if (demo) return demo;
    const now = Date.now(), ago = minutes => now - minutes * 60_000, iso = minutes => new Date(ago(minutes)).toISOString();
    const product = (nmId, name, vendorCode) => ({ nmId, name, vendorCode, brand: 'Demo' });
    const event = (chatID, minutes, sender, text, extra = {}) => ({ chatID, eventID: `demo-${chatID}-${minutes}`, eventType: 'message', addTimestamp: ago(minutes), addTime: iso(minutes), sender, source: sender === 'client' ? 'android' : 'seller-portal', clientName: sender === 'client' ? extra.clientName : undefined, message: { text, attachments: extra.attachments } });
    demo = {
      chats: [
        { chatID: 'demo-chat-1', clientName: 'Анна', goodCard: { nmID: 4210000, name: 'Футболка базовая', size: 'M', rid: 'demo-rid-1', price: 1290, priceCurrency: 'RUB' } },
        { chatID: 'demo-chat-2', clientName: 'Сергей', goodCard: { nmID: 4210001, name: 'Бутылка для воды', size: '0', rid: 'demo-rid-2', price: 690, priceCurrency: 'RUB' } },
        { chatID: 'demo-chat-3', clientName: 'Мария', goodCard: { nmID: 4210002, name: 'Худи оверсайз', size: 'L', rid: 'demo-rid-3', price: 3490, priceCurrency: 'RUB' } }
      ],
      events: [
        event('demo-chat-1', 300, 'client', 'Здравствуйте! Подскажите, футболка садится после стирки?', { clientName: 'Анна', attachments: { goodCard: { nmID: 4210000, name: 'Футболка базовая' } } }),
        event('demo-chat-1', 280, 'seller', 'Здравствуйте! При стирке до 30 °C не садится.'),
        event('demo-chat-1', 40, 'client', 'Спасибо! А размер M на рост 170 подойдёт?', { clientName: 'Анна' }),
        event('demo-chat-2', 2000, 'client', 'Пришла бутылка с трещиной, вот фото.', { clientName: 'Сергей', attachments: { images: [{ date: iso(2000), url: '' }] } }),
        event('demo-chat-2', 1900, 'seller', 'Сожалеем! Оформите, пожалуйста, возврат — мы его одобрим.'),
        event('demo-chat-3', 90, 'client', 'Когда будет размер XL?', { clientName: 'Мария' })
      ],
      questions: [
        { id: 'demo-q-1', text: 'Есть ли размер XL?', createdDate: iso(120), state: 'suppliersPortalSynch', answer: null, productDetails: { nmId: 4210002, productName: 'Худи оверсайз', supplierArticle: 'DEMO-3', brandName: 'Demo' }, wasViewed: false, isWarned: false },
        { id: 'demo-q-2', text: 'Можно стирать в машинке?', createdDate: iso(1500), state: 'suppliersPortalSynch', answer: null, productDetails: { nmId: 4210000, productName: 'Футболка базовая', supplierArticle: 'DEMO-1', brandName: 'Demo' }, wasViewed: true, isWarned: false },
        { id: 'demo-q-3', text: 'Какой объём бутылки?', createdDate: iso(5000), state: 'wbRu', answer: { text: '750 мл.', editable: true, createDate: iso(4900) }, productDetails: { nmId: 4210001, productName: 'Бутылка для воды', supplierArticle: 'DEMO-2', brandName: 'Demo' }, wasViewed: true, isWarned: false }
      ],
      feedbacks: [
        { id: 'demo-f-1', text: 'Ткань тонкая, после стирки потеряла вид.', pros: '', cons: 'Качество', productValuation: 2, createdDate: iso(200), answer: null, state: 'none', productDetails: { nmId: 4210000, productName: 'Футболка базовая', supplierArticle: 'DEMO-1', brandName: 'Demo', size: 'M' }, photoLinks: [], video: null, wasViewed: false, userName: 'Ольга', orderStatus: 'buyout', matchingSize: 'ok', isAbleReturnProductOrders: true, returnProductOrdersDate: null, bables: ['качество'], color: 'белый', subjectName: 'Футболки' },
        { id: 'demo-f-2', text: 'Отличная бутылка, не протекает.', pros: 'Удобная', cons: 'Нет', productValuation: 5, createdDate: iso(700), answer: null, state: 'none', productDetails: { nmId: 4210001, productName: 'Бутылка для воды', supplierArticle: 'DEMO-2', brandName: 'Demo', size: '0' }, photoLinks: [], video: null, wasViewed: true, userName: 'Игорь', orderStatus: 'buyout', matchingSize: '', isAbleReturnProductOrders: false, returnProductOrdersDate: null, bables: ['цена'], color: 'синий', subjectName: 'Бутылки' },
        { id: 'demo-f-3', text: 'Худи тёплое, сидит хорошо.', pros: 'Тёплое', cons: '', productValuation: 5, createdDate: iso(9000), answer: { text: 'Спасибо за отзыв!', state: 'wbRu', editable: true }, state: 'wbRu', productDetails: { nmId: 4210002, productName: 'Худи оверсайз', supplierArticle: 'DEMO-3', brandName: 'Demo', size: 'L' }, photoLinks: [], video: null, wasViewed: true, userName: 'Дмитрий', orderStatus: 'buyout', matchingSize: 'ok', isAbleReturnProductOrders: false, returnProductOrdersDate: null, bables: [], color: 'серый', subjectName: 'Худи' }
      ],
      claims: [
        { id: '00000000-0000-4000-8000-000000000001', claim_type: 1, status: 0, status_ex: 0, nm_id: 4210001, user_comment: 'Бутылка пришла с трещиной на дне.', wb_comment: null, dt: iso(1800).slice(0, 19), imt_name: 'Бутылка для воды', order_dt: iso(8000).slice(0, 19), dt_update: iso(1800).slice(0, 19), photos: [], video_paths: [], actions: ['approve1', 'approve2', 'autorefund1', 'reject1', 'reject2', 'reject3', 'rejectcustom'], price: 690, currency_code: '643', srid: 'demo-rid-2', delivery_dt: iso(3000).slice(0, 19) }
      ],
      archivedClaims: []
    };
    return demo;
  }

  // --- Чаты: события на компьютере, дочитываются с сохранённого next ---
  const storeFile = id => path.join(chatsDir, `${id}.json`);
  function readStore(id) {
    try { const data = JSON.parse(fs.readFileSync(storeFile(id), 'utf8')); return { next: Number(data.next) || 0, events: Array.isArray(data.events) ? data.events : [], syncedAt: data.syncedAt || null }; }
    catch { return { next: 0, events: [], syncedAt: null }; }
  }
  function writeStore(id, store) {
    fs.mkdirSync(chatsDir, { recursive: true });
    fs.writeFileSync(`${storeFile(id)}.tmp`, JSON.stringify(store));
    fs.renameSync(`${storeFile(id)}.tmp`, storeFile(id));
  }
  // Подписи чатов для ответа — только на сервере: из списка чатов и из событий нового чата.
  const signs = new Map();
  const syncing = new Map();
  function syncEvents(id) {
    if (syncing.has(id)) return syncing.get(id);
    const run = (async () => {
      const store = readStore(id), known = new Set(store.events.map(item => item.eventID));
      let added = 0, error = '';
      try {
        for (let page = 0; page < EVENTS_MAX_PAGES; page++) {
          const result = (await call(CHAT, id, `/api/v1/seller/events${store.next ? `?next=${store.next}` : ''}`))?.result || {};
          const events = Array.isArray(result.events) ? result.events : [];
          if (!result.totalEvents || !events.length) break;
          for (const event of events) if (event?.eventID && !known.has(event.eventID)) { known.add(event.eventID); store.events.push(event); added++; }
          if (!Number(result.next) || Number(result.next) === store.next) break;
          store.next = Number(result.next);
        }
      } catch (problem) { error = problem.message; }
      store.syncedAt = new Date().toISOString();
      if (added || !fs.existsSync(storeFile(id))) writeStore(id, store);
      for (const event of store.events) if (event.replySign) signs.set(`${id}|${event.chatID}`, event.replySign);
      return { ...store, error };
    })().finally(() => syncing.delete(id));
    syncing.set(id, run);
    return run;
  }
  const eventTime = event => Number(event.addTimestamp) || Date.parse(event.addTime) || 0;
  function chatsFrom(chats, events, now = Date.now()) {
    const byChat = new Map(), answerFrom = now - CHAT_ANSWER_DAYS * 86_400_000;
    for (const event of events) { if (!byChat.has(event.chatID)) byChat.set(event.chatID, []); byChat.get(event.chatID).push(event); }
    return chats.map(chat => {
      const list = (byChat.get(chat.chatID) || []).sort((a, b) => eventTime(a) - eventTime(b)), last = list[list.length - 1];
      const card = chat.goodCard || {}, lastAt = Number(chat.lastMessage?.addTimestamp) || (last ? eventTime(last) : 0), unanswered = last?.sender === 'client';
      return {
        chatId: chat.chatID, clientName: chat.clientName || last?.clientName || 'Покупатель',
        product: { nmId: Number(card.nmID) || null, name: card.name || '', size: card.size || '', rid: card.rid || '', price: Number(card.price) || 0 },
        lastText: chat.lastMessage?.text || last?.message?.text || (last?.message?.attachments ? 'Вложение' : ''),
        lastAt, lastSender: last?.sender || '', unanswered, awaiting: unanswered && lastAt >= answerFrom, messages: list.length
      };
    }).sort((a, b) => b.lastAt - a.lastAt);
  }
  async function chatsList(id, force = false) {
    if (force) forget(id, 'chats');
    return cachedAnalytics(`messages-chats:${id}`, async () => {
      if (isDemo(id)) { const data = demoData(); return { demo: true, chats: chatsFrom(data.chats, data.events), syncedAt: new Date().toISOString() }; }
      const chats = (await call(CHAT, id, '/api/v1/seller/chats'))?.result || [];
      for (const chat of chats) if (chat.replySign) signs.set(`${id}|${chat.chatID}`, chat.replySign);
      const store = await syncEvents(id);
      return { demo: false, chats: chatsFrom(chats, store.events), syncedAt: store.syncedAt, warning: store.error ? `Не все сообщения загружены: ${store.error}` : '' };
    }, CHATS_TTL);
  }
  const messageOf = event => {
    const attachments = event.message?.attachments || {};
    return {
      id: event.eventID, at: eventTime(event), sender: event.sender || '', clientName: event.clientName || '', source: event.source || '',
      text: event.message?.text || '',
      product: attachments.goodCard ? { nmId: Number(attachments.goodCard.nmID) || null, name: attachments.goodCard.name || '', size: attachments.goodCard.size || '' } : null,
      files: (attachments.files || []).map(file => ({ name: file.name || 'Файл', type: file.contentType || '', size: Number(file.size) || 0, downloadId: file.downloadID || '' })),
      images: (attachments.images || []).map(image => ({ downloadId: image.downloadID || '' }))
    };
  };
  async function chatMessages(id, chatId) {
    if (!chatId) throw apiError(400, 'Не указан чат');
    const list = await chatsList(id), chat = list.chats.find(item => item.chatId === chatId);
    if (!chat) throw apiError(404, 'Чат не найден');
    const events = isDemo(id) ? demoData().events : readStore(id).events;
    return { chat, messages: events.filter(event => event.chatID === chatId).sort((a, b) => eventTime(a) - eventTime(b)).map(messageOf) };
  }
  async function sendMessage(req, url) {
    if (url.searchParams.get('confirm') !== '1') throw apiError(400, 'Подтвердите отправку сообщения');
    const id = cabinetOf(url.searchParams.get('cabinet')), chatId = String(url.searchParams.get('chatId') || '');
    const body = await readLargeJson(req, Math.ceil(CHAT_FILES_MAX * 1.4) + 100_000);
    const message = String(body.message ?? '').trim();
    if (message.length > CHAT_MESSAGE_MAX) throw apiError(400, `Сообщение — не длиннее ${CHAT_MESSAGE_MAX} символов`);
    const files = (Array.isArray(body.files) ? body.files : []).map(file => {
      const type = String(file?.type || ''), data = Buffer.from(String(file?.data || ''), 'base64');
      const name = String(file?.name || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'file';
      if (!CHAT_FILE_TYPES.includes(type)) throw apiError(400, `«${name}»: можно только JPEG, PNG или PDF`);
      if (!data.length) throw apiError(400, `«${name}»: пустой файл`);
      if (data.length > CHAT_FILE_MAX) throw apiError(400, `«${name}»: файл больше 5 Мб`);
      return { name, type, data };
    });
    if (files.reduce((sum, file) => sum + file.data.length, 0) > CHAT_FILES_MAX) throw apiError(400, 'Файлы вместе — больше 30 Мб');
    if (!message && !files.length) throw apiError(400, 'Напишите сообщение или приложите файл');
    if (isDemo(id)) {
      const data = demoData(); if (!data.chats.some(chat => chat.chatID === chatId)) throw apiError(404, 'Чат не найден');
      const now = Date.now();
      data.events.push({ chatID: chatId, eventID: `demo-sent-${now}`, eventType: 'message', addTimestamp: now, addTime: new Date(now).toISOString(), sender: 'seller', source: 'seller-public-api', message: { text: message, attachments: files.length ? { files: files.map(file => ({ name: file.name, contentType: file.type, size: file.data.length })) } : undefined } });
      forget(id, 'chats', 'summary');
      return { ok: true, demo: true, warnings: [] };
    }
    let sign = signs.get(`${id}|${chatId}`);
    if (!sign) { await chatsList(id, true); sign = signs.get(`${id}|${chatId}`); }
    if (!sign) throw apiError(404, 'Чат не найден — обновите список чатов');
    const form = new FormData();
    form.append('replySign', sign);
    if (message) form.append('message', message);
    for (const file of files) form.append('file', new Blob([file.data], { type: file.type }), file.name);
    const response = await paced(`${CHAT}|${id}`, PACE_MS[CHAT], () => fetch(`${CHAT}/api/v1/seller/message`, { method: 'POST', headers: { Authorization: tokenFor(id) }, body: form, signal: AbortSignal.timeout(120_000) }));
    const text = await response.text(); let data = text; try { data = JSON.parse(text); } catch {}
    if (!response.ok) throw wbError(CHAT, apiError(response.status, (typeof data === 'object' && (data?.detail || data?.error)) || `WB не принял сообщение (${response.status})`, typeof data === 'object' ? data : null));
    forget(id, 'chats', 'summary');
    await chatsList(id);
    return { ok: true, warnings: Array.isArray(data?.errors) ? data.errors.filter(Boolean).map(String) : [] };
  }
  // Файл из сообщения: отдаётся как есть (JPEG, PNG, PDF); на модерации — { pending, retrySeconds }.
  async function downloadFile(res, url) {
    const id = cabinetOf(url.searchParams.get('cabinet')), fileId = String(url.searchParams.get('id') || '');
    if (!/^[\w-]{1,100}$/.test(fileId)) throw apiError(400, 'Некорректный файл');
    if (isDemo(id)) throw apiError(404, 'В демо-кабинете файлов нет');
    const response = await paced(`${CHAT}|${id}`, PACE_MS[CHAT], () => fetch(`${CHAT}/api/v1/seller/download/${fileId}`, { headers: { Authorization: tokenFor(id) }, signal: AbortSignal.timeout(60_000) }));
    if (response.status === 202) { const data = await response.json().catch(() => ({})); return send(res, 200, { pending: true, moderationState: data.moderationState || 'pending', retrySeconds: Number(data.retrySeconds) || 30 }); }
    if (response.status === 451) throw apiError(451, 'Файл не прошёл модерацию WB');
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw wbError(CHAT, apiError(response.status, data.detail || data.error || `WB не отдал файл (${response.status})`, data)); }
    const type = String(response.headers.get('content-type') || '').split(';')[0];
    if (!CHAT_FILE_TYPES.includes(type)) throw apiError(415, 'Неизвестный тип файла');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': buffer.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.end(buffer);
  }

  // --- Вопросы ---
  const paging = (params, maxTake, maxSum) => {
    const take = Math.max(1, Math.min(maxTake, Math.round(Number(params.get('take')) || 30))), skip = Math.max(0, Math.round(Number(params.get('skip')) || 0));
    if (maxSum && skip + take > maxSum) throw apiError(400, `WB отдаёт не больше ${maxSum} записей — уточните фильтр`);
    const nmId = Number(params.get('nmId')); return { take, skip, nmId: Number.isInteger(nmId) && nmId > 0 ? nmId : 0 };
  };
  const productOf = details => ({ nmId: Number(details?.nmId) || null, name: details?.productName || '', vendorCode: details?.supplierArticle || '', brand: details?.brandName || '', size: details?.size || '' });
  const questionOf = item => ({ id: item.id, text: item.text || '', createdDate: item.createdDate, state: item.state || '', answer: item.answer ? { text: item.answer.text || '', editable: Boolean(item.answer.editable), createDate: item.answer.createDate || '' } : null, product: productOf(item.productDetails), wasViewed: Boolean(item.wasViewed), isWarned: Boolean(item.isWarned) });
  async function listQuestions(id, params) {
    const answered = params.get('answered') === '1', { take, skip, nmId } = paging(params, 200, 10_000);
    if (isDemo(id)) {
      const all = demoData().questions, list = all.filter(item => Boolean(item.answer) === answered && (!nmId || item.productDetails.nmId === nmId));
      return { demo: true, countUnanswered: all.filter(item => !item.answer).length, countArchive: all.filter(item => item.answer).length, total: list.length, items: list.slice(skip, skip + take).map(questionOf) };
    }
    const query = new URLSearchParams({ isAnswered: String(answered), take: String(take), skip: String(skip), order: 'dateDesc' }); if (nmId) query.set('nmId', String(nmId));
    const data = (await call(FEEDBACKS, id, `/api/v1/questions?${query}`))?.data || {};
    const countUnanswered = Number(data.countUnanswered) || 0, countArchive = Number(data.countArchive) || 0;
    return { demo: false, countUnanswered, countArchive, total: nmId ? null : answered ? countArchive : countUnanswered, items: (data.questions || []).map(questionOf) };
  }
  async function questionAction(body) {
    const id = cabinetOf(body.cabinet), questionId = String(body.id || ''), action = String(body.action || '');
    if (!/^[\w-]{1,64}$/.test(questionId)) throw apiError(400, 'Не указан вопрос');
    if (!['answer', 'edit', 'reject', 'viewed'].includes(action)) throw apiError(400, 'Неизвестное действие');
    if (action !== 'viewed') needConfirm(body);
    const text = action === 'viewed' ? '' : textOf(body.text, 1, 5000, action === 'reject' ? 'Причина отклонения' : 'Ответ');
    const payload = action === 'viewed' ? { id: questionId, wasViewed: true } : { id: questionId, answer: { text }, state: action === 'reject' ? 'none' : 'wbRu' };
    if (isDemo(id)) {
      const question = demoData().questions.find(item => item.id === questionId); if (!question) throw apiError(404, 'Вопрос не найден');
      if (action === 'viewed') question.wasViewed = true;
      else { question.answer = { text, editable: action !== 'edit', createDate: new Date().toISOString() }; question.state = payload.state; question.wasViewed = true; }
    } else await call(FEEDBACKS, id, '/api/v1/questions', { method: 'PATCH', body: payload });
    forget(id, 'summary');
    return { ok: true, demo: isDemo(id) };
  }

  // --- Отзывы ---
  const feedbackOf = item => ({
    id: item.id, text: item.text || '', pros: item.pros || '', cons: item.cons || '', rating: Number(item.productValuation) || 0, createdDate: item.createdDate, state: item.state || '',
    answer: item.answer ? { text: item.answer.text || '', state: item.answer.state || '', editable: Boolean(item.answer.editable) } : null,
    product: productOf(item.productDetails), photos: (item.photoLinks || []).map(photo => ({ full: photo.fullSize || '', mini: photo.miniSize || '' })).filter(photo => photo.full || photo.mini),
    video: item.video?.link ? { preview: item.video.previewImage || '', link: item.video.link, duration: Number(item.video.durationSec) || 0 } : null,
    wasViewed: Boolean(item.wasViewed), userName: item.userName || '', orderStatus: item.orderStatus || '', matchingSize: String(item.matchingSize || '').trim(),
    tags: Array.isArray(item.bables) ? item.bables : [], color: item.color || '', subjectName: item.subjectName || '',
    canReturn: Boolean(item.isAbleReturnProductOrders), returnDate: item.returnProductOrdersDate || '', parentFeedbackId: item.parentFeedbackId || '', childFeedbackId: item.childFeedbackId || ''
  });
  async function listFeedbacks(id, params) {
    const mode = ['new', 'answered', 'archive'].includes(params.get('mode')) ? params.get('mode') : 'new', { take, skip, nmId } = paging(params, 200, mode === 'answered' || mode === 'new' ? 200_000 : 0);
    if (isDemo(id)) {
      const all = demoData().feedbacks, list = all.filter(item => (mode === 'new' ? !item.answer : Boolean(item.answer)) && (!nmId || item.productDetails.nmId === nmId));
      return { demo: true, countUnanswered: all.filter(item => !item.answer).length, countArchive: all.filter(item => item.answer).length, total: list.length, items: list.slice(skip, skip + take).map(feedbackOf) };
    }
    const query = new URLSearchParams({ take: String(take), skip: String(skip), order: 'dateDesc' }); if (nmId) query.set('nmId', String(nmId));
    if (mode !== 'archive') query.set('isAnswered', String(mode === 'answered'));
    const data = (await call(FEEDBACKS, id, `/api/v1/feedbacks${mode === 'archive' ? '/archive' : ''}?${query}`))?.data || {};
    const countUnanswered = Number(data.countUnanswered) || 0, countArchive = Number(data.countArchive) || 0;
    return { demo: false, countUnanswered, countArchive, total: nmId || mode === 'archive' ? null : mode === 'answered' ? countArchive : countUnanswered, items: (data.feedbacks || []).map(feedbackOf) };
  }
  async function feedbackAction(body) {
    needConfirm(body);
    const id = cabinetOf(body.cabinet), feedbackId = String(body.id || ''), action = String(body.action || '');
    if (!/^[\w-]{1,64}$/.test(feedbackId)) throw apiError(400, 'Не указан отзыв');
    if (!['answer', 'edit', 'return'].includes(action)) throw apiError(400, 'Неизвестное действие');
    const text = action === 'return' ? '' : textOf(body.text, 2, 5000, 'Ответ');
    if (isDemo(id)) {
      const feedback = demoData().feedbacks.find(item => item.id === feedbackId); if (!feedback) throw apiError(404, 'Отзыв не найден');
      if (action === 'return') { if (!feedback.isAbleReturnProductOrders) throw apiError(422, 'Запрос на возврат покупок недоступен'); feedback.isAbleReturnProductOrders = false; feedback.returnProductOrdersDate = new Date().toISOString(); }
      else { feedback.answer = { text, state: 'wbRu', editable: action !== 'edit' }; feedback.state = 'wbRu'; }
    } else if (action === 'return') await call(FEEDBACKS, id, '/api/v1/feedbacks/order/return', { method: 'POST', body: { feedbackId } });
    else await call(FEEDBACKS, id, '/api/v1/feedbacks/answer', { method: action === 'edit' ? 'PATCH' : 'POST', body: { id: feedbackId, text } });
    forget(id, 'summary');
    return { ok: true, demo: isDemo(id) };
  }

  // --- Заявки на возврат ---
  const media = link => { const value = String(link || ''); return value.startsWith('//') ? `https:${value}` : value; };
  const claimOf = item => ({
    id: item.id, source: item.claim_type === 3 ? 'чат' : 'портал покупателей', status: Number(item.status) || 0, statusEx: Number(item.status_ex) || 0,
    nmId: Number(item.nm_id) || null, productName: item.imt_name || '', userComment: item.user_comment || '', wbComment: item.wb_comment || '',
    createdAt: item.dt || '', orderedAt: item.order_dt || '', updatedAt: item.dt_update || '', deliveredAt: item.delivery_dt || '',
    photos: (item.photos || []).map(media).filter(Boolean), videos: (item.video_paths || []).map(media).filter(Boolean),
    actions: (item.actions || []).filter(action => CLAIM_ACTIONS[action]).map(action => ({ action, label: CLAIM_ACTIONS[action] })),
    price: Number(item.price) || 0, currency: item.currency_code || '', srid: item.srid || '', imei: item.origin_id_info || ''
  });
  async function listClaims(id, params) {
    const archive = params.get('archive') === '1', limit = Math.max(1, Math.min(200, Math.round(Number(params.get('take')) || 50))), offset = Math.max(0, Math.round(Number(params.get('skip')) || 0));
    if (isDemo(id)) { const list = archive ? demoData().archivedClaims : demoData().claims; return { demo: true, total: list.length, items: list.slice(offset, offset + limit).map(claimOf) }; }
    const data = await call(RETURNS, id, `/api/v1/claims?${new URLSearchParams({ is_archive: String(archive), limit: String(limit), offset: String(offset) })}`) || {};
    return { demo: false, total: Number(data.total) || 0, items: (data.claims || []).map(claimOf) };
  }
  async function claimAction(body) {
    needConfirm(body);
    const id = cabinetOf(body.cabinet), claimId = String(body.id || ''), action = String(body.action || '');
    if (!/^[0-9a-f-]{8,40}$/i.test(claimId)) throw apiError(400, 'Не указана заявка');
    if (!CLAIM_ACTIONS[action]) throw apiError(400, 'Неизвестное действие с заявкой');
    const comment = action === 'rejectcustom' ? textOf(body.comment, 10, 1000, 'Комментарий')
      : action === 'approvecc1' && String(body.comment || '').trim() ? textOf(body.comment, 10, 1000, 'Комментарий') : '';
    if (isDemo(id)) {
      const data = demoData(), index = data.claims.findIndex(item => item.id === claimId); if (index < 0) throw apiError(404, 'Заявка не найдена');
      const claim = data.claims[index]; if (!claim.actions.includes(action)) throw apiError(400, 'Это действие для заявки недоступно');
      Object.assign(claim, { status: action.startsWith('reject') ? 1 : 2, status_ex: action.startsWith('reject') ? 1 : action === 'autorefund1' ? 5 : 10, wb_comment: comment || CLAIM_ACTIONS[action], dt_update: new Date().toISOString().slice(0, 19), actions: [] });
      data.claims.splice(index, 1); data.archivedClaims.unshift(claim);
    } else await call(RETURNS, id, '/api/v1/claim', { method: 'PATCH', body: comment ? { id: claimId, action, comment } : { id: claimId, action } });
    forget(id, 'summary');
    return { ok: true, demo: isDemo(id) };
  }

  // --- Счётчики для кнопки «Сообщения»: неотвеченные вопросы и отзывы, чаты с последним сообщением покупателя, заявки на рассмотрении ---
  async function summary(id, force = false) {
    if (force) forget(id, 'summary');
    return cachedAnalytics(`messages-summary:${id}`, async () => {
      const part = async loader => { try { return { count: await loader(), error: '' }; } catch (error) { return { count: 0, error: error.message }; } };
      const demoMode = isDemo(id), data = demoMode ? demoData() : null;
      const result = {
        chats: await part(async () => (await chatsList(id)).chats.filter(chat => chat.awaiting).length),
        questions: await part(async () => demoMode ? data.questions.filter(item => !item.answer).length : Number((await call(FEEDBACKS, id, '/api/v1/questions/count-unanswered'))?.data?.countUnanswered) || 0),
        feedbacks: await part(async () => demoMode ? data.feedbacks.filter(item => !item.answer).length : Number((await call(FEEDBACKS, id, '/api/v1/feedbacks/count-unanswered'))?.data?.countUnanswered) || 0),
        claims: await part(async () => demoMode ? data.claims.length : Number((await call(RETURNS, id, '/api/v1/claims?is_archive=false&limit=1'))?.total) || 0)
      };
      return { demo: demoMode, ...result, total: Object.values(result).reduce((sum, item) => sum + item.count, 0), checkedAt: new Date().toISOString() };
    }, SUMMARY_TTL);
  }

  // Маршруты раздела. Возвращает true, если запрос обработан.
  async function handle(req, res, url) {
    const id = () => cabinetOf(url.searchParams.get('cabinet')), force = url.searchParams.get('force') === '1';
    if (req.method === 'GET') {
      const routes = {
        '/api/messages/summary': () => summary(id(), force),
        '/api/messages/chats': () => chatsList(id(), force),
        '/api/messages/chat': () => chatMessages(id(), String(url.searchParams.get('chatId') || '')),
        '/api/messages/questions': () => listQuestions(id(), url.searchParams),
        '/api/messages/feedbacks': () => listFeedbacks(id(), url.searchParams),
        '/api/messages/claims': () => listClaims(id(), url.searchParams)
      };
      if (url.pathname === '/api/messages/file') { await downloadFile(res, url); return true; }
      if (routes[url.pathname]) { send(res, 200, await routes[url.pathname]()); return true; }
    }
    if (req.method === 'POST') {
      if (url.pathname === '/api/messages/chat/send') { send(res, 200, await sendMessage(req, url)); return true; }
      const routes = { '/api/messages/question': questionAction, '/api/messages/feedback': feedbackAction, '/api/messages/claim': claimAction };
      if (routes[url.pathname]) { send(res, 200, await routes[url.pathname](await readJson(req))); return true; }
    }
    return false;
  }
  return { handle, chatsFrom, claimOf, CLAIM_ACTIONS };
};
