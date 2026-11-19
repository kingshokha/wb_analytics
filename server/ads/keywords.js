'use strict';
// --- Реклама: ключевые запросы кампании, их статистика по дням, отметки, пояснения, минус-фразы.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, apiError, cabinets, cachedAnalytics, datesBetween, tokenFor, wait, wbRequest } = require('../core/base');
const { productCards } = require('../core/product-cards');
const { cardPhoto } = require('../core/photos');
const {
  AD_CAMPAIGNS_URL,
  NORMQUERY_CHUNK,
  NORMQUERY_DAILY_URL,
  NORMQUERY_GET_MINUS_URL,
  NORMQUERY_LIST_INTERVAL,
  NORMQUERY_LIST_URL,
  NORMQUERY_MINUS_LIMIT,
  NORMQUERY_SET_MINUS_URL,
  campaignDir,
  campaignProductIds,
  historyPeriod,
  normqueryRequest,
  safeRatio,
  summarizeKeywordDaily
} = require('./stats');
const { funnelRangeNeedsFetch } = require('../funnel/funnel');

const KEYWORD_TAGS_FILE = path.join(ROOT, 'data', 'keyword-tags.json');
const CAMPAIGN_NOTES_FILE = path.join(ROOT, 'data', 'campaign-notes.json');
// Отметки ключевых запросов: одна основная отметка на запрос плюс независимая «Важный».
const KEYWORD_TAG_KEYS = [
  'target',
  'nearTarget',
  'nonTarget',
  'promote',
  'test',
  'traffic',
  'watch',
  'unprofitable',
  'profitable',
  'investigate'
];
// --- Отметки ключевых запросов (data/keyword-tags.json) ---
function readKeywordTags() {
  try {
    const data = JSON.parse(fs.readFileSync(KEYWORD_TAGS_FILE, 'utf8'));
    return { colors: data.colors || {}, campaigns: data.campaigns || {} };
  } catch {
    return { colors: {}, campaigns: {} };
  }
}
function writeKeywordTags(data) {
  fs.mkdirSync(path.dirname(KEYWORD_TAGS_FILE), { recursive: true });
  fs.writeFileSync(`${KEYWORD_TAGS_FILE}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${KEYWORD_TAGS_FILE}.tmp`, KEYWORD_TAGS_FILE);
}
function keywordTagsKey(cabinet, campaignId) {
  if (!/^[\w-]{1,40}$/.test(String(cabinet || '')) || !/^\d{1,15}$/.test(String(campaignId || '')))
    throw apiError(400, 'Некорректный кабинет или кампания');
  return `${cabinet}:${campaignId}`;
}
function keywordTags(cabinet, campaignId) {
  const data = readKeywordTags();
  return { tags: data.campaigns[keywordTagsKey(cabinet, campaignId)] || {}, colors: data.colors };
}
// У запроса — текущие отметки (tag, important) и история: смена отметок (с пояснением note), комментарии и смена статуса
// фразы через сайт. Новые события — в конце списка; хранятся все.
const keywordEventId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
function keywordQuery(value) {
  const query = String(value || '').trim();
  if (!query || query.length > 300) throw apiError(400, 'Не указан ключевой запрос');
  return query;
}
function pushKeywordEvent(entry, event) {
  entry.history = [...(entry.history || []), { id: keywordEventId(), at: new Date().toISOString(), ...event }];
}
// Запись без отметок и истории удаляется, чтобы файл не копил пустые записи.
function storeKeywordEntry(data, key, query, entry) {
  const campaign = data.campaigns[key] || {};
  if (entry.tag || entry.important || entry.history?.length) campaign[query] = entry;
  else delete campaign[query];
  if (Object.keys(campaign).length) data.campaigns[key] = campaign;
  else delete data.campaigns[key];
  writeKeywordTags(data);
  return campaign[query] || null;
}
function setKeywordTag(cabinet, campaignId, body = {}) {
  const key = keywordTagsKey(cabinet, campaignId),
    query = keywordQuery(body.query);
  if (body.tag != null && body.tag !== '' && !KEYWORD_TAG_KEYS.includes(body.tag)) throw apiError(400, 'Неизвестная отметка');
  const data = readKeywordTags(),
    before = data.campaigns[key]?.[query] || {};
  const current = { ...before, history: [...(before.history || [])] };
  if (body.clear) {
    delete current.tag;
    delete current.important;
  }
  if ('tag' in body) {
    if (body.tag) current.tag = body.tag;
    else delete current.tag;
  }
  if ('important' in body) {
    if (body.important) current.important = true;
    else delete current.important;
  }
  if ((before.tag || '') !== (current.tag || '')) pushKeywordEvent(current, { type: 'tag', from: before.tag || '', to: current.tag || '' });
  if (Boolean(before.important) !== Boolean(current.important))
    pushKeywordEvent(current, { type: 'important', on: Boolean(current.important) });
  return { query, tag: storeKeywordEntry(data, key, query, current) };
}
function setKeywordNote(cabinet, campaignId, body = {}) {
  const key = keywordTagsKey(cabinet, campaignId),
    query = keywordQuery(body.query),
    text = String(body.text || '').trim();
  if (!body.remove && !text) throw apiError(400, 'Пустой комментарий');
  if (text.length > 1000) throw apiError(400, 'Комментарий длиннее 1000 символов');
  const data = readKeywordTags(),
    current = { ...(data.campaigns[key]?.[query] || {}) };
  current.history = [...(current.history || [])];
  if (!body.eventId) {
    if (body.remove) throw apiError(400, 'Не указано, что удалить');
    pushKeywordEvent(current, { type: 'comment', text });
  } else {
    const index = current.history.findIndex(event => event.id === body.eventId);
    if (index < 0) throw apiError(404, 'Запись истории не найдена — обновите страницу');
    const event = { ...current.history[index] },
      now = new Date().toISOString();
    if (event.type === 'comment') {
      if (body.remove) {
        current.history.splice(index, 1);
        return { query, tag: storeKeywordEntry(data, key, query, current) };
      }
      event.text = text;
      event.editedAt = now;
    } else if (body.remove) {
      delete event.note;
      delete event.noteAt;
    } else {
      event.note = text;
      event.noteAt = now;
    }
    current.history[index] = event;
  }
  return { query, tag: storeKeywordEntry(data, key, query, current) };
}
// Исключение и включение фраз через сайт попадают в историю («Статус фразы»).
function recordKeywordStatus(cabinet, campaignId, action, queries = []) {
  if (!queries.length) return;
  const key = keywordTagsKey(cabinet, campaignId),
    data = readKeywordTags();
  for (const query of queries) {
    const entry = { ...(data.campaigns[key]?.[query] || {}) };
    pushKeywordEvent(entry, { type: 'status', action });
    data.campaigns[key] = { ...(data.campaigns[key] || {}), [query]: entry };
  }
  writeKeywordTags(data);
}
function setKeywordTagColors(colors = {}) {
  const data = readKeywordTags(),
    allowed = ['important', ...KEYWORD_TAG_KEYS];
  data.colors = Object.fromEntries(
    Object.entries(colors || {}).filter(([key, value]) => allowed.includes(key) && /^#[0-9a-f]{6}$/i.test(String(value)))
  );
  writeKeywordTags(data);
  return { colors: data.colors };
}

async function campaignKeywordDaily(id, campaignId, from, to, queryInput, nmIdsInput) {
  const period = historyPeriod(from, to),
    query = String(queryInput || '').trim(),
    dates = datesBetween(period.from, period.to);
  if (!query) throw apiError(400, 'Не указан ключевой запрос');
  if (id === 'demo' || !cabinets().length) {
    const items = [
      {
        dailyStats: dates.map((date, index) => ({
          date,
          stat: {
            normQuery: query,
            views: 400 + ((index * 53) % 300),
            clicks: 12 + ((index * 7) % 15),
            spend: 90 + ((index * 31) % 80),
            atbs: 2 + (index % 4),
            orders: index % 3,
            shks: index % 2,
            avgPos: 4 + (index % 5)
          }
        }))
      }
    ];
    return { demo: true, period, query, ...summarizeKeywordDaily(items, query, dates) };
  }
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const token = tokenFor(id);
  let nmIds = [...new Set((Array.isArray(nmIdsInput) ? nmIdsInput : []).map(String).filter(nmId => /^\d{1,15}$/.test(nmId)))].slice(0, 100);
  if (!nmIds.length) {
    const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
    const meta = (Array.isArray(campaignData?.adverts) ? campaignData.adverts : []).find(item => String(item.id) === String(campaignId));
    if (!meta) throw apiError(404, 'Кампания не найдена');
    nmIds = campaignProductIds(meta).map(String).slice(0, 100);
  }
  if (!nmIds.length) throw apiError(400, 'В кампании нет товаров');
  const response = await cachedAnalytics(
    `keyword-daily:${id}:${campaignId}:${period.from}:${period.to}:${nmIds.join(',')}`,
    () =>
      normqueryRequest(
        id,
        token,
        { from: period.from, to: period.to, items: nmIds.map(nmId => ({ advertId: Number(campaignId), nmId: Number(nmId) })) },
        NORMQUERY_DAILY_URL
      ),
    10 * 60_000
  );
  return { demo: false, period, query, ...summarizeKeywordDaily(response?.items || [], query, dates) };
}

// Списки активных, неактивных и архивных кластеров кампании по каждому артикулу.
// --- Исключение и включение ключевых запросов (минус-фразы WB) ---
// Новый список минус-фраз товара: set-minus у WB перезаписывает список целиком, поэтому к текущему списку
// добавляются выбранные запросы (исключить) или из него убираются (включить); остальные фразы не трогаются.
function mergeMinusList(before = [], queries = [], action = 'exclude') {
  const selected = new Set(queries);
  return action === 'exclude' ? [...new Set([...before, ...queries])] : before.filter(query => !selected.has(query));
}
// Что отправить в set-minus. Кластеры, которые WB перевёл в архив, в список не попадают: get-minus их ещё
// возвращает, но set-minus отклоняет весь запрос («cannot exclude archived presets: …»). Показов у архивных
// кластеров нет, так что убрать их из минус-фраз безопасно. Исключать архивный запрос не нужно — он пропускается.
function minusPlan(before = [], queries = [], action = 'exclude', archived = new Set()) {
  const skipped = action === 'exclude' ? queries.filter(query => archived.has(query)) : [];
  const usable = queries.filter(query => !skipped.includes(query));
  const next = mergeMinusList(before, usable, action).filter(query => !archived.has(query));
  return { next, usable, skipped, dropped: before.filter(query => archived.has(query)) };
}
// Названия архивных кластеров из ошибки WB: «cannot exclude archived presets: 'a', 'b'».
function archivedPresetsFromError(message = '') {
  const tail = String(message).match(/archived presets?:\s*(.+)$/i)?.[1] || '';
  return [...tail.matchAll(/'([^']+)'/g)].map(match => match[1]);
}

async function readMinusList(token, campaignId, nmId) {
  const response = await wbRequest(token, NORMQUERY_GET_MINUS_URL, {
    method: 'POST',
    body: { items: [{ advert_id: Number(campaignId), nm_id: Number(nmId) }] }
  });
  const item = (response?.items || []).find(entry => String(entry.nm_id ?? entry.nmId) === String(nmId));
  return (item?.norm_queries || item?.normQueries || []).map(String);
}

// Для каждого товара: прочитать текущий список, объединить, записать и перечитать для проверки.
// WB отклоняет весь запрос, если в нём есть кластер, которого у товара нет, поэтому каждому товару уходят только его кластеры.
async function campaignMinus(id, campaignId, action, queriesInput, nmIdsInput) {
  if (id === 'demo' || !cabinets().length) throw apiError(400, 'В демо-режиме исключать запросы нельзя');
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  if (!['exclude', 'include'].includes(action)) throw apiError(400, 'Неизвестное действие');
  const queries = [
    ...new Set((Array.isArray(queriesInput) ? queriesInput : []).map(query => String(query || '').trim()).filter(Boolean))
  ].slice(0, 500);
  if (!queries.length) throw apiError(400, 'Не выбраны запросы');
  const token = tokenFor(id);
  const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
  const meta = (Array.isArray(campaignData?.adverts) ? campaignData.adverts : []).find(item => String(item.id) === String(campaignId));
  if (!meta) throw apiError(404, 'Кампания не найдена');
  if (String(meta.settings?.payment_type || '').toLowerCase() === 'cpc')
    throw apiError(400, 'В кампаниях с оплатой за клики (CPC) WB не позволяет исключать запросы');
  const campaignNms = campaignProductIds(meta).map(String);
  const requested =
    Array.isArray(nmIdsInput) && nmIdsInput.length ? nmIdsInput.map(String).filter(nmId => campaignNms.includes(nmId)) : campaignNms;
  if (!requested.length) throw apiError(400, 'В кампании нет выбранных товаров');
  const statuses = await fetchNormqueryStatuses(id, token, campaignId, requested);
  const results = [];
  for (const nmId of requested) {
    const lists = statuses.get(nmId);
    const own = new Set(lists ? [...lists.active, ...lists.excluded, ...lists.archived] : []);
    const mine = queries.filter(query => own.has(query));
    if (!mine.length) continue;
    if (results.length) await wait(NORMQUERY_LIST_INTERVAL);
    try {
      const before = await readMinusList(token, campaignId, nmId),
        archived = new Set(lists?.archived || []);
      let plan = minusPlan(before, mine, action, archived);
      const skippedNote = plan.skipped.length ? `в архиве WB, исключать не нужно: ${plan.skipped.join(', ')}` : '';
      if (!plan.usable.length) {
        results.push({ nmId, ok: false, changed: 0, queries: mine, error: skippedNote });
        continue;
      }
      const unchanged = plan.next.length === before.length && plan.next.every(query => before.includes(query));
      if (unchanged) {
        results.push({ nmId, ok: true, changed: 0, queries: mine, note: skippedNote });
        continue;
      }
      if (plan.next.length > NORMQUERY_MINUS_LIMIT)
        throw apiError(400, `у товара было бы больше ${NORMQUERY_MINUS_LIMIT} минус-фраз — это предел WB`);
      const send = () =>
        wbRequest(token, NORMQUERY_SET_MINUS_URL, {
          method: 'POST',
          body: { advert_id: Number(campaignId), nm_id: Number(nmId), norm_queries: plan.next }
        });
      try {
        await send();
      } catch (error) {
        // Список архивных из normquery/list мог отстать — убираем то, что WB назвал в ошибке, и пробуем ещё раз.
        const named = archivedPresetsFromError(error.message);
        if (!named.length || named.every(query => archived.has(query))) throw error;
        named.forEach(query => archived.add(query));
        plan = minusPlan(before, mine, action, archived);
        await wait(NORMQUERY_LIST_INTERVAL);
        await send();
      }
      const after = await readMinusList(token, campaignId, nmId);
      const ok = plan.usable.every(query => (action === 'exclude' ? after.includes(query) : !after.includes(query)));
      const changed = plan.usable.filter(query => before.includes(query) !== after.includes(query)).length;
      const note = [skippedNote, plan.dropped.length ? `из минус-фраз убраны кластеры в архиве WB: ${plan.dropped.join(', ')}` : '']
        .filter(Boolean)
        .join('; ');
      results.push({ nmId, ok, changed, queries: mine, note, error: ok ? '' : 'WB принял запрос, но список минус-фраз не изменился' });
    } catch (error) {
      results.push({ nmId, ok: false, changed: 0, queries: mine, error: error.message });
    }
  }
  if (!results.length) throw apiError(400, 'Выбранные запросы не относятся к товарам кампании');
  return { action, results };
}

async function fetchNormqueryStatuses(id, token, campaignId, nmIds = []) {
  const statuses = new Map();
  for (let offset = 0; offset < nmIds.length; offset += NORMQUERY_CHUNK) {
    if (offset) await wait(NORMQUERY_LIST_INTERVAL);
    const items = nmIds.slice(offset, offset + NORMQUERY_CHUNK).map(nmId => ({ advertId: Number(campaignId), nmId: Number(nmId) }));
    const response = await wbRequest(token, NORMQUERY_LIST_URL, { method: 'POST', body: { items } });
    for (const item of Array.isArray(response?.items) ? response.items : []) {
      const nmId = String(item.nmId ?? item.nm_id ?? '');
      if (!nmId) continue;
      const lists = item.normQueries || item.norm_queries || {};
      statuses.set(nmId, {
        active: new Set(lists.active || []),
        excluded: new Set(lists.excluded || []),
        archived: new Set(lists.archived || [])
      });
    }
  }
  return statuses;
}

function keywordStatus(statuses, nmId, query) {
  const lists = statuses.get(String(nmId));
  if (!lists) return '';
  if (lists.excluded.has(query)) return 'excluded';
  if (lists.archived.has(query)) return 'archived';
  if (lists.active.has(query)) return 'active';
  return '';
}

function emptyKeyword(query) {
  return {
    query,
    views: 0,
    clicks: 0,
    spend: 0,
    carts: 0,
    orders: 0,
    sales: 0,
    positionWeight: 0,
    activeIn: 0,
    excludedIn: 0,
    archivedIn: 0,
    viewsKnown: false
  };
}

// По кампаниям с оплатой за клики WB не присылает в статистике запросов показы (а значит, и CTR с CPM):
// поля views в строках просто нет. Такие показатели помечаются неизвестными, а не нулевыми.
function addKeyword(target, row = {}) {
  if (row.views !== undefined && row.views !== null) target.viewsKnown = true;
  const views = Number(row.views || 0);
  target.views += views;
  target.clicks += Number(row.clicks || 0);
  target.spend += Number(row.spend || 0);
  target.carts += Number(row.atbs || 0);
  target.orders += Number(row.orders || 0);
  target.sales += Number(row.shks || 0);
  target.positionWeight += Number(row.avg_pos || 0) * (views || 1);
  target.positionBase = (target.positionBase || 0) + (views || 1);
}

function finalizeKeyword(row) {
  const { positionWeight, positionBase, ...rest } = row;
  // Запрос неактивен, если он выключен у всех артикулов, где встречается; частично — у одних активен, у других исключён.
  const status =
    rest.activeIn && rest.excludedIn
      ? 'partial'
      : rest.activeIn
        ? 'active'
        : rest.excludedIn
          ? 'excluded'
          : rest.archivedIn
            ? 'archived'
            : '';
  const known = rest.viewsKnown;
  return {
    ...rest,
    status,
    views: known ? rest.views : null,
    ctr: known ? safeRatio(row.clicks, row.views) : null,
    cpc: safeRatio(row.spend, row.clicks, 1),
    cpm: known ? safeRatio(row.spend, row.views, 1000) : null,
    cr: safeRatio(row.orders, row.clicks),
    avgPosition: positionBase ? Math.round((positionWeight / positionBase) * 10) / 10 : 0
  };
}

// Складывает ответ WB в итог по кампании и в разбивку по артикулам.
function summarizeKeywords(groups = [], statuses = new Map()) {
  const total = new Map();
  const byNmId = new Map();
  // Присылает ли WB показы по этой кампании вообще: тогда у выключенных кластеров показы — честный 0, иначе неизвестны.
  const viewsAvailable = groups.some(group => (group.stats || []).some(row => row.views !== undefined && row.views !== null));
  for (const group of groups) {
    const nmId = String(group.nm_id ?? group.nmId ?? '');
    for (const row of group.stats || []) {
      const query = String(row.norm_query || row.normQuery || '').trim();
      if (!query) continue;
      if (!total.has(query)) total.set(query, emptyKeyword(query));
      addKeyword(total.get(query), row);
      if (keywordStatus(statuses, nmId, query) === 'active') total.get(query).activeIn += 1;
      if (!nmId) continue;
      if (!byNmId.has(nmId)) byNmId.set(nmId, new Map());
      const product = byNmId.get(nmId);
      if (!product.has(query)) product.set(query, emptyKeyword(query));
      addKeyword(product.get(query), row);
      if (keywordStatus(statuses, nmId, query) === 'active') product.get(query).activeIn += 1;
    }
  }
  // Выключенные и архивные кластеры показов не набирают, поэтому в статистике их нет:
  // добавляем их отдельными строками с нулями, чтобы было видно, что они отключены.
  for (const [nmId, lists] of statuses) {
    for (const [status, queries] of [
      ['excluded', lists.excluded],
      ['archived', lists.archived]
    ]) {
      for (const value of queries) {
        const query = String(value || '').trim();
        if (!query) continue;
        if (!total.has(query)) total.set(query, emptyKeyword(query));
        total.get(query)[`${status}In`] += 1;
        if (viewsAvailable) total.get(query).viewsKnown = true;
        if (!byNmId.has(nmId)) byNmId.set(nmId, new Map());
        const product = byNmId.get(nmId);
        if (!product.has(query)) product.set(query, emptyKeyword(query));
        product.get(query)[`${status}In`] += 1;
        if (viewsAvailable) product.get(query).viewsKnown = true;
      }
    }
  }
  const finalize = map => [...map.values()].map(finalizeKeyword).sort((a, b) => b.views - a.views || a.query.localeCompare(b.query, 'ru'));
  return { total: finalize(total), byNmId: Object.fromEntries([...byNmId].map(([nmId, map]) => [nmId, finalize(map)])) };
}

// Версия формата сохранённых ключевых запросов: файлы старых версий перекачиваются.
// 2 — показы, CTR и CPM пустые (null), если WB их не прислал (кампании с оплатой за клики), а не 0.
const KEYWORDS_FORMAT = 2;

function keywordsFile(cabinetId, campaignId, from, to) {
  return path.join(campaignDir(cabinetId, campaignId), `keywords-${from}_${to}.json`);
}

function readCampaignKeywords(cabinetId, campaignId, from, to) {
  try {
    return JSON.parse(fs.readFileSync(keywordsFile(cabinetId, campaignId, from, to), 'utf8'));
  } catch {
    return null;
  }
}

function saveCampaignKeywords(cabinetId, campaignId, from, to, data) {
  const target = keywordsFile(cabinetId, campaignId, from, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

function demoCampaignKeywords(campaignId, from, to) {
  const queries = ['чехол на iphone 17 pro', 'чехол magsafe', 'чехол с кольцом', 'силиконовый чехол'];
  const groups = [
    {
      nm_id: 4210000,
      stats: queries.map((query, index) => ({
        norm_query: query,
        views: 4200 - index * 900,
        clicks: 180 - index * 40,
        spend: 900 - index * 180,
        atbs: 40 - index * 8,
        orders: 12 - index * 3,
        shks: 8 - index * 2,
        avg_pos: 3 + index
      }))
    },
    {
      nm_id: 4210001,
      stats: queries.slice(0, 2).map((query, index) => ({
        norm_query: query,
        views: 2100 - index * 700,
        clicks: 90 - index * 30,
        spend: 480 - index * 140,
        atbs: 18 - index * 6,
        orders: 5 - index * 2,
        shks: 3 - index,
        avg_pos: 5 + index
      }))
    }
  ];
  const demoStatuses = new Map([
    ['4210000', { active: new Set(queries.slice(0, 2)), excluded: new Set(queries.slice(2, 3)), archived: new Set(queries.slice(3)) }],
    ['4210001', { active: new Set(queries.slice(0, 1)), excluded: new Set(queries.slice(1, 2)), archived: new Set() }]
  ]);
  return {
    demo: true,
    campaignId,
    period: { from, to },
    updatedAt: new Date().toISOString(),
    viewsAvailable: true,
    ...summarizeKeywords(groups, demoStatuses),
    products: [
      { nmId: 4210000, name: 'Демо-товар 1.1', vendorCode: 'DEMO-1', photo: '' },
      { nmId: 4210001, name: 'Демо-товар 1.2', vendorCode: 'DEMO-2', photo: '' }
    ],
    warnings: []
  };
}

async function campaignKeywords(id, campaignId, from, to, refresh = false) {
  const period = historyPeriod(from, to);
  if (id === 'demo' || !cabinets().length) return demoCampaignKeywords(campaignId, period.from, period.to);
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const stored = readCampaignKeywords(id, campaignId, period.from, period.to);
  if (stored?.format === KEYWORDS_FORMAT && !refresh && !funnelRangeNeedsFetch(period.to, stored.updatedAt))
    return { ...stored, fromFile: true };
  const token = tokenFor(id);
  const warnings = [];
  const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
  const meta = (Array.isArray(campaignData?.adverts) ? campaignData.adverts : []).find(item => String(item.id) === String(campaignId));
  if (!meta) throw apiError(404, 'Кампания не найдена');
  const nmIds = campaignProductIds(meta);
  if (!nmIds.length)
    return {
      demo: false,
      campaignId,
      period,
      updatedAt: new Date().toISOString(),
      total: [],
      byNmId: {},
      products: [],
      warnings: ['В кампании нет товаров, по которым WB отдаёт поисковые запросы']
    };
  const groups = [];
  for (let offset = 0; offset < nmIds.length; offset += NORMQUERY_CHUNK) {
    const items = nmIds.slice(offset, offset + NORMQUERY_CHUNK).map(nmId => ({ advert_id: Number(campaignId), nm_id: Number(nmId) }));
    try {
      const response = await normqueryRequest(id, token, { from: period.from, to: period.to, items });
      groups.push(...(Array.isArray(response?.stats) ? response.stats : []));
    } catch (error) {
      warnings.push(`Ключевые запросы: ${error.message}`);
    }
  }
  const statuses = await fetchNormqueryStatuses(id, token, campaignId, nmIds).catch(
    error => (warnings.push(`Статусы ключевых запросов: ${error.message}`), new Map())
  );
  const cards = await productCards(id, token).catch(() => []);
  const byNmIdCard = new Map(
    cards.map(card => [
      String(card.nmID),
      { name: card.title || `Товар ${card.nmID}`, vendorCode: card.vendorCode || '', photo: cardPhoto(card) }
    ])
  );
  const summary = summarizeKeywords(groups, statuses);
  const result = {
    demo: false,
    format: KEYWORDS_FORMAT,
    campaignId,
    period,
    updatedAt: new Date().toISOString(),
    ...summary,
    viewsAvailable: summary.total.some(row => row.viewsKnown),
    products: nmIds
      .map(nmId => ({ nmId, ...(byNmIdCard.get(String(nmId)) || { name: `Товар ${nmId}`, vendorCode: '', photo: '' }) }))
      .filter(product => summary.byNmId[String(product.nmId)]?.length),
    warnings
  };
  if (!warnings.length) {
    try {
      saveCampaignKeywords(id, campaignId, period.from, period.to, result);
    } catch (error) {
      warnings.push(`Не удалось сохранить ключевые запросы: ${error.message}`);
    }
  }
  return result;
}

module.exports = {
  CAMPAIGN_NOTES_FILE,
  archivedPresetsFromError,
  campaignKeywordDaily,
  campaignKeywords,
  campaignMinus,
  keywordEventId,
  keywordTags,
  keywordTagsKey,
  mergeMinusList,
  minusPlan,
  recordKeywordStatus,
  setKeywordNote,
  setKeywordTag,
  setKeywordTagColors,
  summarizeKeywords
};
