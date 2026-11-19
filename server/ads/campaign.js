'use strict';
// --- Реклама: кампания — переименование, запуск и пауза, бюджет и пополнение, места показа, зоны, заметки, список кампаний.
const fs = require('node:fs');
const path = require('node:path');
const {
  ADS_DIR,
  addDays,
  analyticsCache,
  apiError,
  cabinetFolderName,
  cabinets,
  cachedAnalytics,
  datesBetween,
  tokenFor,
  wait,
  wbRequest
} = require('../core/base');
const { productCards } = require('../core/product-cards');
const {
  AD_BUDGET_INTERVAL,
  AD_BUDGET_STATUSES,
  AD_BUDGET_URL,
  AD_CAMPAIGNS_URL,
  adBudgetLastCall,
  addAdMetrics,
  advertBudgets,
  cachedCampaignStats,
  campaignDir,
  campaignProductDaily,
  campaignSetup,
  demoAds,
  emptyAdDay,
  emptyAdMetrics,
  enrichAdvertising,
  finalizeAdMetrics,
  fullstatsRequest,
  hasAdActivity,
  historyChunks,
  historyPeriod,
  loadStoredAdDays,
  planAdFetch,
  saveAdDays,
  summarizeAdStats,
  validAdPeriod,
  withAdBudgets
} = require('./stats');
const { CAMPAIGN_NOTES_FILE, keywordEventId, keywordTagsKey } = require('./keywords');

// Пояснение к смене отметки (eventId события отметки) или комментарий (без eventId — новый); remove — удалить.
// --- Заметки по кампании (кнопка с заметками в детализации): data/campaign-notes.json, { "кабинет:кампания": [заметки] } ---
function readCampaignNotes() {
  try {
    const data = JSON.parse(fs.readFileSync(CAMPAIGN_NOTES_FILE, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
function campaignNotes(cabinet, campaignId) {
  return { notes: readCampaignNotes()[keywordTagsKey(cabinet, campaignId)] || [] };
}
// Без noteId — новая заметка; с noteId — изменить текст или удалить (remove).
function setCampaignNote(cabinet, campaignId, body = {}) {
  const key = keywordTagsKey(cabinet, campaignId),
    text = String(body.text || '').trim();
  if (!body.remove && !text) throw apiError(400, 'Пустая заметка');
  if (text.length > 3000) throw apiError(400, 'Заметка длиннее 3000 символов');
  const data = readCampaignNotes(),
    notes = [...(data[key] || [])];
  if (!body.noteId) notes.push({ id: keywordEventId(), at: new Date().toISOString(), text });
  else {
    const index = notes.findIndex(note => note.id === body.noteId);
    if (index < 0) throw apiError(404, 'Заметка не найдена — обновите страницу');
    if (body.remove) notes.splice(index, 1);
    else notes[index] = { ...notes[index], text, editedAt: new Date().toISOString() };
  }
  if (notes.length) data[key] = notes;
  else delete data[key];
  fs.mkdirSync(path.dirname(CAMPAIGN_NOTES_FILE), { recursive: true });
  fs.writeFileSync(`${CAMPAIGN_NOTES_FILE}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${CAMPAIGN_NOTES_FILE}.tmp`, CAMPAIGN_NOTES_FILE);
  return { notes: data[key] || [] };
}
// Переименование кампании (карандаш в шапке детализации): POST /adv/v0/rename, название до 100 символов.
// После успеха сбрасывается кэш списка кампаний — новое название сразу видно во «Рекламе».
async function renameCampaign(id, campaignId, nameInput) {
  if (id === 'demo' || !cabinets().length) throw apiError(400, 'В демо-режиме переименовывать кампании нельзя');
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const name = String(nameInput || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) throw apiError(400, 'Название не может быть пустым');
  if (name.length > 100) throw apiError(400, 'Название длиннее 100 символов — это предел WB');
  const token = tokenFor(id);
  try {
    await wbRequest(token, 'https://advert-api.wildberries.ru/adv/v0/rename', {
      method: 'POST',
      body: { advertId: Number(campaignId), name }
    });
  } catch (error) {
    // На 400/422 WB отвечает простым текстом — показываем его, а не «WB API вернул 400».
    const text = typeof error.details === 'string' ? error.details.trim() : '';
    throw apiError(error.status || 502, text ? `WB: ${text.slice(0, 200)}` : error.message);
  }
  analyticsCache.delete(`ad-campaigns:${id}`);
  return { ok: true, id: Number(campaignId), name };
}

// Текст ошибки WB у изменяющих методов кампании: 400 — JSON { error } или { detail }, 422 — простой текст.
function wbErrorText(error) {
  const details = error?.details;
  return String(typeof details === 'string' ? details : details?.error || details?.detail || details?.message || '').trim();
}
// Одна кампания с текущими статусом и настройками: /api/advert/v2/adverts?ids= — любой статус, без кэша списка.
async function fetchCampaign(token, campaignId) {
  const data = await wbRequest(token, `https://advert-api.wildberries.ru/api/advert/v2/adverts?ids=${encodeURIComponent(campaignId)}`);
  return (Array.isArray(data?.adverts) ? data.adverts : []).find(item => String(item.id) === String(campaignId)) || null;
}
const CAMPAIGN_STATUS_NAMES = { '-1': 'удаляется', 4: 'готова к запуску', 7: 'завершена', 8: 'отменена', 9: 'активна', 11: 'на паузе' };

// --- Запуск и пауза кампании: GET /adv/v0/start и GET /adv/v0/pause с ?id=, успех — 200 без тела ---
// start — для статусов 4 (готова к запуску) и 11 (пауза); при нехватке бюджета WB отвечает 400
// { error: 'AdvertChangeStatus: Low Budget: not enough budget' }. pause — для статуса 9 (активна).
// 422 — «Статус кампании не изменен» простым текстом. Лимит — 5 запросов в секунду.
// Статус проверяется до запроса и перечитывается после: WB может применить его не мгновенно.
const CAMPAIGN_STATUS_ACTIONS = {
  start: { url: 'https://advert-api.wildberries.ru/adv/v0/start', from: [4, 11], verb: 'запустить', expected: 9 },
  pause: { url: 'https://advert-api.wildberries.ru/adv/v0/pause', from: [9], verb: 'поставить на паузу', expected: 11 }
};
async function setCampaignStatus(id, campaignId, action) {
  if (id === 'demo' || !cabinets().length) throw apiError(400, 'В демо-режиме запускать и останавливать кампании нельзя');
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const spec = CAMPAIGN_STATUS_ACTIONS[action];
  if (!spec) throw apiError(400, 'Неизвестное действие с кампанией');
  const token = tokenFor(id),
    before = await fetchCampaign(token, campaignId);
  if (!before) throw apiError(404, 'WB не нашёл кампанию');
  if (!spec.from.includes(Number(before.status)))
    throw apiError(400, `Кампанию в статусе «${CAMPAIGN_STATUS_NAMES[before.status] || before.status}» нельзя ${spec.verb}`);
  try {
    await wbRequest(token, `${spec.url}?id=${encodeURIComponent(campaignId)}`);
  } catch (error) {
    const text = wbErrorText(error);
    if (/low budget|not enough budget/i.test(text))
      throw apiError(400, 'Недостаточно бюджета кампании — пополните его в кабинете WB и запустите снова');
    if (/not found/i.test(text)) throw apiError(404, 'WB не нашёл кампанию');
    if (error.status === 422) throw apiError(422, `WB не изменил статус кампании${text ? `: ${text.slice(0, 200)}` : ''}`);
    throw apiError(error.status || 502, text ? `WB: ${text.slice(0, 200)}` : error.message);
  }
  analyticsCache.delete(`ad-campaigns:${id}`);
  await wait(800);
  const after = await fetchCampaign(token, campaignId).catch(() => null);
  return { ok: true, id: Number(campaignId), status: Number(after?.status ?? spec.expected) };
}

// --- Бюджет кампании и его пополнение ---
// Остаток — POST /api/advert/v2/budget (как в списке кампаний, тот же интервал 3 с), в рублях; только статусы 4, 9, 11,
// по другим WB ничего не возвращает — тогда budget: null.
// Источники для пополнения — GET /adv/v1/balance (1 запрос в секунду): balance — счёт, net — баланс (взаиморасчёт из будущих
// продаж), bonus — бонусы; суммы в рублях. Минимум пополнения — minTopUp из GET /api/advert/v1/config в копейках (1 запрос
// в минуту, только персональный и сервисный токен); если конфиг недоступен — 1000 ₽, как в ошибке WB
// «Invalid Params: minimum deposit amount is 1000».
const AD_BALANCE_URL = 'https://advert-api.wildberries.ru/adv/v1/balance';
const AD_CONFIG_URL = 'https://advert-api.wildberries.ru/api/advert/v1/config';
const AD_DEPOSIT_URL = 'https://advert-api.wildberries.ru/adv/v1/budget/deposit';
const AD_DEPOSIT_MIN = 1000;
// В документации net — «Баланс», но в кабинете WB эта же сумма подписана «Единый счёт» (сверено с кабинетом: 95 324 ₽
// в net и в окне пополнения WB) — называем как в кабинете.
const AD_DEPOSIT_SOURCES = [
  { type: 0, field: 'balance', name: 'Счёт продвижения' },
  { type: 1, field: 'net', name: 'Единый счёт' },
  { type: 3, field: 'bonus', name: 'Бонусы' }
];

async function campaignBudget(id, campaignId) {
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  if (id === 'demo' || !cabinets().length) return { demo: true, budget: 2450, currency: 'RUB' };
  const token = tokenFor(id);
  const data = await cachedAnalytics(
    `ad-budget:${id}:${campaignId}`,
    async () => {
      const pause = AD_BUDGET_INTERVAL - (Date.now() - (adBudgetLastCall.get(id) || 0));
      if (pause > 0) await wait(pause);
      adBudgetLastCall.set(id, Date.now());
      return wbRequest(token, AD_BUDGET_URL, { method: 'POST', body: { advertIds: [Number(campaignId)] } });
    },
    30_000
  );
  const item = (Array.isArray(data?.adverts) ? data.adverts : []).find(advert => String(advert.advertId) === String(campaignId));
  return { demo: false, budget: item?.total != null ? Number(item.total) : null, currency: item?.currency || 'RUB' };
}

async function adDepositMinimum(id, token) {
  try {
    const config = await cachedAnalytics(`ad-config:${id}`, () => wbRequest(token, AD_CONFIG_URL), 60 * 60_000);
    const min = Number(config?.minTopUp) / 100;
    return Number.isFinite(min) && min > 0 ? Math.ceil(min) : AD_DEPOSIT_MIN;
  } catch {
    return AD_DEPOSIT_MIN;
  }
}

async function adFinance(id) {
  if (id === 'demo' || !cabinets().length) {
    return {
      demo: true,
      currency: 'RUB',
      minTopUp: AD_DEPOSIT_MIN,
      sources: [
        { type: 0, name: 'Счёт продвижения', amount: 0 },
        { type: 1, name: 'Единый счёт', amount: 95324 },
        { type: 3, name: 'Бонусы', amount: 1200 }
      ]
    };
  }
  const token = tokenFor(id);
  const balance = await cachedAnalytics(`ad-balance:${id}`, () => wbRequest(token, AD_BALANCE_URL), 5_000);
  return {
    demo: false,
    currency: balance?.currency || 'RUB',
    minTopUp: await adDepositMinimum(id, token),
    sources: AD_DEPOSIT_SOURCES.map(source => ({ type: source.type, name: source.name, amount: Number(balance?.[source.field] || 0) }))
  };
}

// Пополнение: POST /adv/v1/budget/deposit?id= с { sum, type, return: true } — в ответе новый бюджет { total, currency }.
// Лимит — 1 запрос в секунду. Кампания после пополнения сама не запускается: для этого есть запуск (setCampaignStatus).
async function depositCampaignBudget(id, campaignId, body = {}) {
  if (id === 'demo' || !cabinets().length) throw apiError(400, 'В демо-режиме пополнять бюджет нельзя');
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const sum = Number(body.sum),
    type = Number(body.type),
    source = AD_DEPOSIT_SOURCES.find(item => item.type === type);
  if (!source) throw apiError(400, 'Выберите источник списания');
  const token = tokenFor(id),
    min = await adDepositMinimum(id, token);
  if (!Number.isInteger(sum) || sum < min)
    throw apiError(400, `Сумма пополнения — целое число рублей, не меньше ${min.toLocaleString('ru-RU')} ₽`);
  const campaign = await fetchCampaign(token, campaignId);
  if (!campaign) throw apiError(404, 'WB не нашёл кампанию');
  if (!AD_BUDGET_STATUSES.has(Number(campaign.status)))
    throw apiError(400, `Кампанию в статусе «${CAMPAIGN_STATUS_NAMES[campaign.status] || campaign.status}» пополнить нельзя`);
  const balance = await wbRequest(token, AD_BALANCE_URL).catch(() => null);
  if (balance && Number(balance[source.field] || 0) < sum)
    throw apiError(
      400,
      `Источник «${source.name}»: доступно ${Number(balance[source.field] || 0).toLocaleString('ru-RU')} ₽ — меньше суммы пополнения`
    );
  let result;
  try {
    result = await wbRequest(token, `${AD_DEPOSIT_URL}?id=${encodeURIComponent(campaignId)}`, {
      method: 'POST',
      body: { sum, type, return: true }
    });
  } catch (error) {
    const text = wbErrorText(error),
      minimum = text.match(/minimum deposit amount is (\d+)/i);
    if (minimum) throw apiError(400, `WB: минимальная сумма пополнения — ${Number(minimum[1]).toLocaleString('ru-RU')} ₽`);
    throw apiError(error.status || 502, text ? `WB: ${text.slice(0, 200)}` : error.message);
  }
  analyticsCache.delete(`ad-budget:${id}:${campaignId}`);
  analyticsCache.delete(`ad-balance:${id}`);
  const budget =
    result?.total != null ? Number(result.total) : (await campaignBudget(id, campaignId).catch(() => ({ budget: null }))).budget;
  return { ok: true, id: Number(campaignId), budget, currency: result?.currency || 'RUB', status: Number(campaign.status) };
}

// --- Места показа: PUT /adv/v0/auction/placements — только ручная ставка и оплата за показы (cpm), статусы 4, 9, 11 ---
// Тело: { placements: [{ advert_id, placements: { search, recommendations } }] }, оба флага обязательны; успех — 204 без тела.
// Для CPC WB отвечает 400 «advert … has payment type cpc, placements cannot be changed». Лимит — 1 запрос в секунду,
// поэтому запросы одного кабинета идут не чаще раза в 1,1 с. Хотя бы одно место показа должно остаться включённым.
const PLACEMENTS_URL = 'https://advert-api.wildberries.ru/adv/v0/auction/placements';
const placementLastCall = new Map();
async function setCampaignPlacements(id, campaignId, body = {}) {
  if (id === 'demo' || !cabinets().length) throw apiError(400, 'В демо-режиме места показа менять нельзя');
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const { search, recommendations } = body;
  if (typeof search !== 'boolean' || typeof recommendations !== 'boolean') throw apiError(400, 'Укажите, включены ли поиск и рекомендации');
  if (!search && !recommendations) throw apiError(400, 'Хотя бы одно место показа должно остаться включённым');
  const token = tokenFor(id),
    campaign = await fetchCampaign(token, campaignId);
  if (!campaign) throw apiError(404, 'WB не нашёл кампанию');
  if (campaign.bid_type !== 'manual' || String(campaign.settings?.payment_type || '').toLowerCase() !== 'cpm')
    throw apiError(400, 'Места показа меняются только у кампаний с ручной ставкой и оплатой за показы (CPM)');
  if (![4, 9, 11].includes(Number(campaign.status)))
    throw apiError(400, `У кампании в статусе «${CAMPAIGN_STATUS_NAMES[campaign.status] || campaign.status}» места показа менять нельзя`);
  const pause = 1_100 - (Date.now() - (placementLastCall.get(id) || 0));
  if (pause > 0) await wait(pause);
  placementLastCall.set(id, Date.now());
  try {
    await wbRequest(token, PLACEMENTS_URL, {
      method: 'PUT',
      body: { placements: [{ advert_id: Number(campaignId), placements: { search, recommendations } }] }
    });
  } catch (error) {
    const text = wbErrorText(error);
    if (/payment type cpc/i.test(text)) throw apiError(400, 'WB: у кампаний с оплатой за клики места показа менять нельзя');
    throw apiError(error.status || 502, text ? `WB: ${text.slice(0, 200)}` : error.message);
  }
  analyticsCache.delete(`ad-campaigns:${id}`);
  const after = await fetchCampaign(token, campaignId).catch(() => null);
  return { ok: true, id: Number(campaignId), placements: after?.settings?.placements || { search, recommendations } };
}

// --- Статистика кампании по зонам показов: поиск, полки, каталог ---
// В открытом API WB (dev.wildberries.ru) статистики по зонам нет. Её присылает расширение Chrome «WB: статистика по зонам
// показов» (Downloads/wb-zones-extension): оно берёт данные во внутреннем API кабинета cmp.wildberries.ru с сессией продавца
// (get-stats по местам показа и fullstat для каталога) и отправляет сюда уже разобранными.
// Хранятся в папке кампании, в zones.json. Присланный день заменяет тот же день целиком (свежие цифры WB),
// остальные дни не трогаются и не удаляются.
const ZONE_FIELDS = ['views', 'clicks', 'atbs', 'orders', 'shks', 'sum_price', 'spend'];
const ZONE_KEYS = ['all', 'searchCatalog', 'shelves'];
const ZONES_FILE = 'zones.json';

function zoneMetrics(src) {
  const out = {};
  let any = false;
  for (const field of ZONE_FIELDS) {
    const value = Number(src?.[field]);
    out[field] = Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
    if (out[field]) any = true;
  }
  return any ? out : null;
}

// upload — то, что присылает расширение: { from, to, byNm: { all|searchCatalog|shelves: { nm: { дата: метрики } } },
// catalogDaily: { дата: метрики } | null (fullstat не ответил), catalogNm: { nm: { metrics, name } } | null }.
// Каталог по артикулам WB отдаёт только итогом за период, поэтому он хранится по периодам «from_to».
function mergeCampaignZones(stored, upload = {}, receivedAt = new Date().toISOString()) {
  const from = String(upload.from || ''),
    to = String(upload.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw apiError(400, 'Неверный период');
  const dates = datesBetween(from, to);
  if (dates.length > 400) throw apiError(400, 'Период больше 400 дней');
  const result = {
    days: { ...(stored?.days || {}) },
    catalogByNm: { ...(stored?.catalogByNm || {}) },
    names: { ...(stored?.names || {}) }
  };
  const byNm = upload.byNm || {},
    catalogDaily = upload.catalogDaily && typeof upload.catalogDaily === 'object' ? upload.catalogDaily : null;
  for (const date of dates) {
    const day = { receivedAt };
    for (const zone of ZONE_KEYS) {
      day[zone] = {};
      for (const [nm, byDate] of Object.entries(byNm[zone] || {})) {
        const metrics = /^\d{1,15}$/.test(nm) ? zoneMetrics(byDate?.[date]) : null;
        if (metrics) day[zone][nm] = metrics;
      }
    }
    // Без fullstat каталог за день неизвестен: остаётся прежний, если был.
    day.catalog = catalogDaily ? zoneMetrics(catalogDaily[date]) || {} : result.days[date]?.catalog || null;
    result.days[date] = day;
  }
  if (upload.catalogNm && typeof upload.catalogNm === 'object') {
    const items = {};
    for (const [nm, item] of Object.entries(upload.catalogNm)) {
      if (!/^\d{1,15}$/.test(nm)) continue;
      const metrics = zoneMetrics(item?.metrics);
      if (metrics) items[nm] = metrics;
      if (item?.name) result.names[nm] = String(item.name).slice(0, 300);
    }
    result.catalogByNm[`${from}_${to}`] = { from, to, receivedAt, items };
  }
  result.days = Object.fromEntries(Object.entries(result.days).sort(([a], [b]) => a.localeCompare(b)));
  return result;
}

// Кабинет кампании: сначала по папке с уже сохранённой статистикой, потом по списку кампаний каждого кабинета.
async function campaignCabinet(campaignId) {
  const list = cabinets();
  if (!list.length) throw apiError(400, 'Сайт работает в демо-режиме: статистику по зонам сохранить некуда');
  for (const cabinet of list) if (fs.existsSync(path.join(ADS_DIR, cabinetFolderName(cabinet.id), String(campaignId)))) return cabinet.id;
  for (const cabinet of list) {
    try {
      const data = await cachedAnalytics(`ad-campaigns:${cabinet.id}`, () => wbRequest(cabinet.token, AD_CAMPAIGNS_URL), 3 * 60_000);
      if ((Array.isArray(data?.adverts) ? data.adverts : []).some(item => String(item.id) === String(campaignId))) return cabinet.id;
    } catch {}
  }
  throw apiError(404, `Кампания ${campaignId} не найдена ни в одном кабинете сайта`);
}

function readCampaignZones(cabinetId, campaignId) {
  const file = path.join(campaignDir(cabinetId, campaignId), ZONES_FILE);
  if (!fs.existsSync(file)) return { file, data: null };
  try {
    return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    throw apiError(500, `Не удалось прочитать ${ZONES_FILE}: ${error.message}`);
  }
}

async function saveCampaignZones(body = {}) {
  const campaignId = String(body.campaignId || '');
  if (!/^\d{1,15}$/.test(campaignId)) throw apiError(400, 'Неверный номер кампании');
  const cabinet = await campaignCabinet(campaignId);
  // Испорченный файл не перезаписывается: readCampaignZones бросит ошибку, сохранённое останется как было.
  const { file, data } = readCampaignZones(cabinet, campaignId);
  const receivedAt = new Date().toISOString();
  const merged = mergeCampaignZones(data, body, receivedAt);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ campaignId: Number(campaignId), cabinet, updatedAt: receivedAt, ...merged }));
  fs.renameSync(`${file}.tmp`, file);
  const name = cabinets().find(item => item.id === cabinet)?.name || '';
  return {
    ok: true,
    campaignId: Number(campaignId),
    cabinet,
    cabinetName: name,
    from: body.from,
    to: body.to,
    days: datesBetween(body.from, body.to).length,
    catalog: Boolean(body.catalogDaily),
    folder: `data/Ads/${cabinetFolderName(cabinet)}/${campaignId}`
  };
}

// Демо: два своих артикула и третий, у которого только заказы после клика по рекламе («другие товары»).
function demoZones(from, to) {
  const days = {};
  for (const date of datesBetween(from, to)) {
    const seed = Number(date.replace(/-/g, '')) % 97,
      vary = k => 0.7 + ((seed * k) % 13) / 20;
    const zone = (views, ctr, cpm, cart, order, price) => {
      const clicks = Math.round(views * ctr * vary(3)),
        atbs = Math.round(clicks * cart * vary(5)),
        orders = Math.round(atbs * order * vary(7));
      return zoneMetrics({ views, clicks, atbs, orders, shks: orders, sum_price: orders * price, spend: (views * cpm) / 1000 });
    };
    const searchA = zone(Math.round(900 * vary(2)), 0.035, 188, 0.13, 0.3, 2490),
      shelvesA = zone(Math.round(2600 * vary(4)), 0.017, 185, 0.12, 0.2, 2490);
    const searchB = zone(Math.round(400 * vary(6)), 0.03, 188, 0.1, 0.25, 1590),
      shelvesB = zone(Math.round(1400 * vary(8)), 0.014, 185, 0.1, 0.2, 1590);
    const catalog = zone(Math.round(45 * vary(9)), 0.02, 188, 0, 0, 0);
    const sum = (...list) =>
      zoneMetrics(Object.fromEntries(ZONE_FIELDS.map(field => [field, list.reduce((s, m) => s + Number(m?.[field] || 0), 0)])));
    const other = seed % 3 ? zoneMetrics({ orders: 1, shks: 1, sum_price: 990 }) : null;
    const searchCatalogA = sum(searchA, catalog);
    days[date] = {
      all: { 100001: sum(searchCatalogA, shelvesA), 100002: sum(searchB, shelvesB), ...(other ? { 100003: other } : {}) },
      searchCatalog: { 100001: searchCatalogA, 100002: searchB, ...(other ? { 100003: other } : {}) },
      shelves: { 100001: shelvesA, 100002: shelvesB },
      catalog
    };
  }
  return {
    demo: true,
    updatedAt: new Date().toISOString(),
    days,
    catalogByNm: {},
    names: { 100001: 'Демо-товар 1', 100002: 'Демо-товар 2', 100003: 'Демо-товар 3' }
  };
}

function campaignZones(cabinetId, campaignId, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to)) || from > to)
    throw apiError(400, 'Неверный период');
  if (cabinetId === 'demo' || !cabinets().length) return demoZones(from, to);
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  tokenFor(cabinetId);
  // Отдаются все дни, не только выбранного периода: по ним страница проверяет, подходит ли к таблице каталог артикула,
  // присланный за другой период (например, 23.10–05.11 при периоде страницы 22.10–04.11, если 22.10 и 05.11 пустые).
  const data = readCampaignZones(cabinetId, campaignId).data;
  return {
    demo: false,
    updatedAt: data?.updatedAt || '',
    days: data?.days || {},
    catalogByNm: data?.catalogByNm || {},
    names: data?.names || {},
    folder: `data/Ads/${cabinetFolderName(cabinetId)}/${campaignId}`
  };
}

// Дни, за которые у кампании может быть статистика: не раньше создания и не позже завершения (см. campaignEndStamp).
// Даты WB отдаёт по Москве, поэтому день берётся прямо из строки.
function campaignActivePeriod(campaign = {}, period) {
  const day = value => (/^\d{4}-\d{2}-\d{2}/.test(value || '') ? String(value).slice(0, 10) : '');
  const created = day(campaign.timestamps?.created),
    ended = day(campaignEndStamp(campaign));
  const from = created > period.from ? created : period.from;
  const to = ended && ended < period.to ? ended : period.to;
  return from <= to ? { from, to } : null;
}

async function advertisingCampaignHistory(id, campaignId, from, to, report = () => {}) {
  const whole = historyPeriod(from, to);
  const demo = id === 'demo' || !cabinets().length;
  if (!demo && !/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const token = demo ? null : tokenFor(id);
  let meta = null;
  let cardsPromise = Promise.resolve([]);
  let campaign = null;
  if (!demo) {
    // Карточки нужны только для названий и фото, поэтому грузятся параллельно и не задерживают запросы статистики.
    cardsPromise = productCards(id, token).catch(() => []);
    const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
    meta = (Array.isArray(campaignData?.adverts) ? campaignData.adverts : []).find(item => String(item.id) === String(campaignId));
    if (!meta) throw apiError(404, 'Кампания не найдена');
    campaign = summarizeAdStats([meta], [], whole.from, whole.to).campaigns[0];
  }
  // Запрашиваются только дни жизни кампании: до создания WB статистику не отдаёт, и запросы по ним — пустая трата лимита.
  const active = demo ? whole : campaignActivePeriod(meta, whole);
  const dates = active ? datesBetween(active.from, active.to) : [];
  const stored = demo || !active ? new Map() : loadStoredAdDays(id, campaignId, active.from, active.to);
  const plan = demo ? { missing: dates, chunks: historyChunks(whole) } : planAdFetch(dates, new Set(stored.keys()));
  const storedDays = dates.length - plan.missing.length;
  report({
    type: 'start',
    chunks: plan.chunks.length,
    period: whole,
    activePeriod: active,
    createdAt: meta?.timestamps?.created || '',
    days: dates.length,
    storedDays
  });
  const daily = new Map();
  const productsByDate = new Map();
  const warnings = [];
  const missing = new Set(plan.missing);
  for (const [date, record] of stored) {
    if (missing.has(date)) continue;
    daily.set(date, record.campaign);
    productsByDate.set(
      date,
      (record.products || []).map(item => ({ ...item, date, advertId: Number(campaignId) }))
    );
  }
  for (const [index, chunk] of plan.chunks.entries()) {
    report({ type: 'request', index, chunks: plan.chunks.length, ...chunk });
    let data;
    try {
      if (demo) data = demoAds(chunk.from, chunk.to);
      else {
        const stats =
          cachedCampaignStats(id, campaignId, chunk.from, chunk.to) ||
          (await fullstatsRequest(id, token, String(campaignId), chunk.from, chunk.to, (ms, reason) =>
            report({ type: 'wait', index, chunks: plan.chunks.length, ms, reason })
          ));
        data = summarizeAdStats([meta], Array.isArray(stats) ? stats : [], chunk.from, chunk.to);
      }
    } catch (error) {
      warnings.push(`${chunk.from} — ${chunk.to}: ${error.message}`);
      report({ type: 'chunk', index, chunks: plan.chunks.length, ok: false, error: error.message });
      continue;
    }
    const row = (data.campaigns || []).find(item => String(item.id) === String(campaignId));
    if (row) campaign = row;
    const chunkDates = datesBetween(chunk.from, chunk.to);
    const chunkDays = new Map((row?.daily || []).map(day => [day.date, day]));
    const chunkProducts = campaignProductDaily(data.productDaily || [], campaignId, row?.nmIds || []);
    for (const date of chunkDates) {
      daily.set(date, chunkDays.get(date) || emptyAdDay(date));
      productsByDate.set(
        date,
        chunkProducts.filter(item => item.date === date)
      );
    }
    if (!demo) {
      try {
        saveAdDays(campaignId, id, meta.settings?.name || row?.name || '', chunkDates, daily, productsByDate);
      } catch (error) {
        warnings.push(`Не удалось сохранить статистику ${chunk.from} — ${chunk.to}: ${error.message}`);
      }
    }
    report({ type: 'chunk', index, chunks: plan.chunks.length, ok: true });
  }
  if (!campaign) throw apiError(warnings.length ? 502 : 404, warnings[0] || 'Кампания не найдена');
  report({ type: 'finalize' });
  const days = [...daily.values()].filter(hasAdActivity).sort((a, b) => a.date.localeCompare(b.date));
  const total = emptyAdMetrics();
  days.forEach(day => addAdMetrics(total, day));
  const cards = await cardsPromise;
  const enriched = enrichAdvertising(
    {
      campaigns: [{ ...campaign, ...finalizeAdMetrics(total), daily: days }],
      products: [],
      productDaily: [...productsByDate.values()].flat()
    },
    cards
  );
  return {
    generatedAt: new Date().toISOString(),
    cabinet: id,
    campaignId,
    period: whole,
    activePeriod: active,
    warnings,
    storedDays,
    requests: plan.chunks.length,
    folder: demo ? '' : `data/Ads/${cabinetFolderName(id)}/${campaignId}`,
    campaign: enriched.campaigns[0],
    setup: campaignSetup(meta, cards, demo),
    productDaily: enriched.productDaily.sort((a, b) => `${a.date}:${a.nmId}`.localeCompare(`${b.date}:${b.nmId}`))
  };
}
// Прошлый период той же длины — для изменения в процентах в карточках детализации кампании. Та же выгрузка, только без
// хода работы: дни берутся из сохранённых файлов (data/Ads/…), недостающие — из WB. Если кампании тогда ещё не было,
// available: false — сравнивать не с чем. Слишком старый период (раньше, чем WB отдаёт историю) — тоже без сравнения.
const CAMPAIGN_PREVIOUS_KEYS = ['views', 'clicks', 'orders', 'revenue', 'spend', 'carts', 'canceled', 'ctr', 'cpc', 'drr'];
async function advertisingCampaignPrevious(id, campaignId, from, to) {
  const period = historyPeriod(from, to),
    length = datesBetween(period.from, period.to).length;
  const previous = { from: addDays(period.from, -length), to: addDays(period.from, -1) };
  try {
    historyPeriod(previous.from, previous.to);
  } catch (error) {
    return { period: previous, available: false, reason: error.message };
  }
  return cachedAnalytics(
    `campaign-previous:${id}:${campaignId}:${previous.from}:${previous.to}`,
    async () => {
      const result = await advertisingCampaignHistory(id, campaignId, previous.from, previous.to);
      return {
        period: previous,
        available: Boolean(result.activePeriod),
        campaign: Object.fromEntries(CAMPAIGN_PREVIOUS_KEYS.map(key => [key, Number(result.campaign?.[key] || 0)]))
      };
    },
    10 * 60_000
  );
}
async function advertisingCampaign(id, campaignId, from, to) {
  const summary = await advertising(id, from, to);
  const campaign = (summary.campaigns || []).find(item => String(item.id) === String(campaignId));
  if (!campaign) throw apiError(404, 'Кампания не найдена за выбранный период');
  const productDaily = campaignProductDaily(summary.productDaily || [], campaignId, campaign.nmIds || []);
  return { period: summary.period, campaign, productDaily };
}
// Момент, после которого у кампании не может быть статистики. У действующих WB ставит в deleted заглушку 2100-01-01,
// и у многих завершённых тоже; тогда для завершённой (статус 7) берётся updated: завершение само меняет эту дату.
function campaignEndStamp(campaign = {}) {
  const deleted = campaign.timestamps?.deleted || '';
  // Заглушка приходит как 2100-01-01T00:00:00+03:00, то есть в UTC это ещё 2099 год, поэтому граница с запасом.
  if (Date.parse(deleted) < Date.parse('2099-01-01T00:00:00Z')) return deleted;
  return Number(campaign.status) === 7 ? campaign.timestamps?.updated || '' : '';
}

// Начало берётся из created, а не из started: started — последний запуск, и кампания могла крутиться в периоде до перезапуска.
function adCampaignMayHaveStats(campaign = {}, from, to) {
  const ended = Date.parse(campaignEndStamp(campaign));
  if (Number.isFinite(ended) && ended < Date.parse(`${from}T00:00:00+03:00`)) return false;
  const created = Date.parse(campaign.timestamps?.created || '');
  return !(Number.isFinite(created) && created > Date.parse(`${to}T23:59:59+03:00`));
}

// part=active — быстрый первый ответ вкладки: статистика только действующих и приостановленных кампаний, без остатков бюджета.
// Полный ответ вкладка запрашивает следом в фоне; пачки действующих кампаний при этом берутся из кэша fullstats.
async function advertising(id, from, to, part = 'all') {
  const period = validAdPeriod(from, to);
  if (id === 'demo' || !cabinets().length) return demoAds(period.from, period.to);
  const token = tokenFor(id);
  const warnings = [];
  const partial = part === 'active';
  const { campaigns, stats } = await loadAdStats(id, token, period, warnings, partial ? 'running' : 'all');
  // Карточки нужны только для фото и названий товаров. Быстрый ответ их не ждёт: если в кэше их нет,
  // загрузка идёт в фоне, и фото с названиями приходят вместе с полным ответом.
  const cardsJob = productCards(id, token);
  const cards = partial ? ((await Promise.race([cardsJob.catch(() => []), wait(0).then(() => null)])) ?? []) : await cardsJob;
  const budgets = partial ? new Map() : await advertBudgets(id, token, campaigns, warnings);
  const summary = enrichAdvertising(summarizeAdStats(campaigns, stats, period.from, period.to), cards);
  return { demo: false, partial, ...summary, campaigns: withAdBudgets(summary.campaigns, budgets), warnings };
}

// Статистика кампаний за прошлый период той же длины — для изменений в процентах в таблице «Рекламные кампании».
// Вкладка запрашивает её последней, в фоне: это ещё один проход по fullstats (раз в 20 секунд на пачку).
const AD_COMPARE_KEYS = ['spend', 'views', 'clicks', 'ctr', 'cpc', 'cpm', 'carts', 'orders', 'cr', 'cpo', 'revenue', 'drr', 'roas'];
async function advertisingPrevious(id, from, to) {
  const period = validAdPeriod(from, to);
  const length = datesBetween(period.from, period.to).length;
  const previous = { from: addDays(period.from, -length), to: addDays(period.from, -1) };
  const pick = campaign => ({ id: campaign.id, ...Object.fromEntries(AD_COMPARE_KEYS.map(key => [key, Number(campaign[key] || 0)])) });
  // totals — для изменения в карточках вкладки «Реклама» (расходы, выручка, ДРР, CTR, CPC, ROAS).
  if (id === 'demo' || !cabinets().length) {
    const demo = demoAds(previous.from, previous.to);
    return { demo: true, period: previous, totals: pick(demo.totals || {}), campaigns: demo.campaigns.map(pick), warnings: [] };
  }
  const warnings = [];
  const { campaigns, stats } = await loadAdStats(id, tokenFor(id), previous, warnings);
  const summary = summarizeAdStats(campaigns, stats, previous.from, previous.to);
  return { demo: false, period: previous, totals: pick(summary.totals), campaigns: summary.campaigns.map(pick), warnings };
}

async function loadAdStats(id, token, period, warnings = [], part = 'all') {
  const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
  const campaigns = Array.isArray(campaignData?.adverts) ? campaignData.adverts : [];
  const stats = [];
  // WB отдаёт статистику максимум по 50 кампаниям за запрос и не чаще раза в 20 секунд,
  // поэтому кампании, закончившиеся до начала периода, не запрашиваются: статистики у них быть не может.
  // Действующие и завершённые идут разными пачками: пачки одинаковы во всех вызовах за период
  // (вкладка, её фоновая догрузка, сводка) и повторно берутся из кэша fullstats.
  const statCampaigns = campaigns.filter(campaign => adCampaignMayHaveStats(campaign, period.from, period.to));
  const running = statCampaigns.filter(campaign => Number(campaign.status) !== 7);
  const finished = statCampaigns.filter(campaign => Number(campaign.status) === 7);
  for (const group of part === 'running' ? [running] : [running, finished]) {
    for (let offset = 0; offset < group.length; offset += 50) {
      const ids = group
        .slice(offset, offset + 50)
        .map(item => item.id)
        .join(',');
      if (!ids) continue;
      try {
        const chunk = await fullstatsRequest(id, token, ids, period.from, period.to);
        if (Array.isArray(chunk)) stats.push(...chunk);
      } catch (error) {
        warnings.push(`Статистика рекламы: ${error.message}`);
      }
    }
  }
  return { campaigns, stats };
}

module.exports = {
  adCampaignMayHaveStats,
  adFinance,
  advertising,
  advertisingCampaign,
  advertisingCampaignHistory,
  advertisingCampaignPrevious,
  advertisingPrevious,
  campaignActivePeriod,
  campaignBudget,
  campaignNotes,
  campaignZones,
  depositCampaignBudget,
  loadAdStats,
  mergeCampaignZones,
  renameCampaign,
  saveCampaignZones,
  setCampaignNote,
  setCampaignPlacements,
  setCampaignStatus,
  wbErrorText
};
