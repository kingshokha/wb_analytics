'use strict';
// --- Реклама: статистика кампаний (fullstats), хранение по дням в data/Ads, бюджеты, запросы к WB по ключевым словам.
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
  dateDaysAgo,
  datesBetween,
  moscowDate,
  tokenFor,
  wait,
  wbRequest
} = require('../core/base');
const { cardPhoto } = require('../core/photos');

const AD_FRESH_DAYS = 7;
const NORMQUERY_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/stats';
const NORMQUERY_DAILY_URL = 'https://advert-api.wildberries.ru/adv/v1/normquery/stats';
const NORMQUERY_LIST_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/list';
const NORMQUERY_GET_MINUS_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/get-minus';
const NORMQUERY_SET_MINUS_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/set-minus';
const NORMQUERY_MINUS_LIMIT = 1000;
const NORMQUERY_LIST_INTERVAL = 250;
const NORMQUERY_CHUNK = 100;
const NORMQUERY_INTERVAL = 6_500;
const NORMQUERY_BURST = 10;
const normqueryBuckets = new Map();
const normqueryQueues = new Map();
const AD_CAMPAIGNS_URL = 'https://advert-api.wildberries.ru/api/advert/v2/adverts?statuses=7,9,11';
const FULLSTATS_INTERVAL = 20_500;
const HISTORY_MAX_MONTHS = 12;
const fullstatsQueues = new Map();
const fullstatsLastCall = new Map();
const AD_BUDGET_URL = 'https://advert-api.wildberries.ru/api/advert/v2/budget';
const AD_BUDGET_STATUSES = new Set([4, 9, 11]);
const AD_BUDGET_CHUNK = 50;
const AD_BUDGET_INTERVAL = 3_100;
const adBudgetLastCall = new Map();
function extractFunnel(payload) {
  const products = payload?.data?.products || payload?.products || [];
  const total = { views: 0, cart: 0, orders: 0, sales: 0, revenue: 0, currency: payload?.data?.currency || payload?.currency || 'RUB' };
  for (const item of products) {
    const s = item.statistic?.selected || item.selected || item.metrics || item;
    total.views += Number(s.openCount ?? s.openCardCount ?? s.views ?? s.openCard ?? 0);
    total.cart += Number(s.cartCount ?? s.addToCartCount ?? s.addToCart ?? 0);
    total.orders += Number(s.orderCount ?? s.ordersCount ?? s.orders ?? 0);
    total.sales += Number(s.buyoutCount ?? s.buyoutsCount ?? s.buyouts ?? s.sales ?? 0);
    total.revenue += Number(s.buyoutSum ?? s.buyoutsSumRub ?? s.orderSum ?? s.revenue ?? 0);
    total.currency = s.currency || item.currency || total.currency;
  }
  return total;
}

function safeRatio(value, base, multiplier = 100) {
  return Number(base) ? (Number(value || 0) / Number(base)) * multiplier : 0;
}

function adMetrics(source = {}) {
  const views = Number(source.views || 0),
    clicks = Number(source.clicks || 0),
    spend = Number(source.sum || 0);
  const orders = Number(source.orders || 0),
    revenue = Number(source.sum_price || 0);
  return {
    views,
    clicks,
    spend,
    orders,
    revenue,
    carts: Number(source.atbs || 0),
    sales: Number(source.shks || 0),
    canceled: Number(source.canceled || 0),
    ctr: safeRatio(clicks, views),
    cpc: safeRatio(spend, clicks, 1),
    cpm: safeRatio(spend, views, 1000),
    cr: safeRatio(orders, clicks),
    cpo: safeRatio(spend, orders, 1),
    drr: safeRatio(spend, revenue),
    roas: safeRatio(revenue, spend, 1)
  };
}

function addAdMetrics(target, source = {}) {
  target.views += Number(source.views || 0);
  target.clicks += Number(source.clicks || 0);
  target.spend += Number(source.sum ?? source.spend ?? 0);
  target.orders += Number(source.orders || 0);
  target.revenue += Number(source.sum_price ?? source.revenue ?? 0);
  target.carts += Number(source.atbs ?? source.carts ?? 0);
  target.sales += Number(source.shks ?? source.sales ?? 0);
  target.canceled += Number(source.canceled || 0);
}

function finalizeAdMetrics(target) {
  return {
    ...target,
    ctr: safeRatio(target.clicks, target.views),
    cpc: safeRatio(target.spend, target.clicks, 1),
    cpm: safeRatio(target.spend, target.views, 1000),
    cr: safeRatio(target.orders, target.clicks),
    cpo: safeRatio(target.spend, target.orders, 1),
    drr: safeRatio(target.spend, target.revenue),
    roas: safeRatio(target.revenue, target.spend, 1)
  };
}

function emptyAdMetrics(extra = {}) {
  return { views: 0, clicks: 0, spend: 0, orders: 0, revenue: 0, carts: 0, sales: 0, canceled: 0, ...extra };
}

function campaignProductIds(campaign = {}) {
  const candidates = [
    campaign.nm_settings,
    campaign.nmSettings,
    campaign.settings?.nms,
    campaign.autoParams?.nms,
    Array.isArray(campaign.unitedParams) ? campaign.unitedParams.flatMap(item => item.nms || []) : []
  ];
  return [
    ...new Set(
      candidates
        .flatMap(list => (Array.isArray(list) ? list : []))
        .map(item => Number(item?.nm_id || item?.nmId || item?.nm || item))
        .filter(Number.isInteger)
    )
  ];
}

function summarizeAdStats(campaigns = [], stats = [], from, to) {
  const campaignById = new Map(campaigns.map(item => [String(item.id), item]));
  const daily = new Map();
  for (
    let cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const date = cursor.toISOString().slice(0, 10);
    daily.set(date, emptyAdMetrics({ date }));
  }
  const platforms = new Map([
    [1, emptyAdMetrics({ id: 1, name: 'Сайт' })],
    [32, emptyAdMetrics({ id: 32, name: 'Android' })],
    [64, emptyAdMetrics({ id: 64, name: 'iOS' })]
  ]);
  const products = new Map();
  const productDaily = new Map();
  const rows = [];
  for (const stat of stats) {
    const campaign = campaignById.get(String(stat.advertId));
    const nmIds = [
      ...new Set([
        ...campaignProductIds(campaign),
        ...(stat.days || []).flatMap(day =>
          (day.apps || []).flatMap(app => (app.nms || []).map(nm => Number(nm.nmId || nm.nm)).filter(Number.isInteger))
        )
      ])
    ];
    // Для столбца «Артикулы»: сколько товаров в кампании сейчас и у скольких были показы или клики за период.
    const inCampaign = campaignProductIds(campaign);
    const activeNmIds = [
      ...new Set(
        (stat.days || []).flatMap(day =>
          (day.apps || []).flatMap(app =>
            (app.nms || [])
              .filter(nm => Number(nm.views || 0) > 0 || Number(nm.clicks || 0) > 0)
              .map(nm => Number(nm.nmId || nm.nm))
              .filter(Number.isInteger)
          )
        )
      )
    ];
    rows.push({
      id: stat.advertId,
      name: campaign?.settings?.name || `Кампания #${stat.advertId}`,
      status: campaign?.status,
      type: campaign?.type ?? null,
      paymentType: campaign?.settings?.payment_type || '',
      bidType: campaign?.bid_type || '',
      createdAt: campaign?.timestamps?.created || '',
      startedAt: campaign?.timestamps?.started || '',
      updatedAt: campaign?.timestamps?.updated || '',
      nmIds,
      nmInCampaign: inCampaign,
      nmCount: inCampaign.length || nmIds.length,
      nmActive: inCampaign.length ? activeNmIds.filter(nmId => inCampaign.includes(nmId)).length : activeNmIds.length,
      nmRemovedActive: inCampaign.length ? activeNmIds.filter(nmId => !inCampaign.includes(nmId)).length : 0,
      activeNmIds,
      daily: (stat.days || []).map(day => ({ date: String(day.date || '').slice(0, 10), ...adMetrics(day) })),
      ...adMetrics(stat)
    });
    for (const day of stat.days || []) {
      const date = String(day.date || '').slice(0, 10);
      if (!daily.has(date)) daily.set(date, emptyAdMetrics({ date }));
      addAdMetrics(daily.get(date), day);
      for (const app of day.apps || []) {
        const appType = Number(app.appType || 0);
        if (!platforms.has(appType))
          platforms.set(appType, emptyAdMetrics({ id: appType, name: appType === 0 ? 'Не определено WB' : `Платформа ${appType}` }));
        addAdMetrics(platforms.get(appType), app);
        for (const nm of app.nms || []) {
          const key = String(nm.nmId || nm.nm || 'unknown');
          if (!products.has(key)) products.set(key, emptyAdMetrics({ nmId: nm.nmId || nm.nm, name: nm.name || `Товар ${key}` }));
          addAdMetrics(products.get(key), nm);
          const productKey = `${stat.advertId}:${key}:${date}`;
          if (!productDaily.has(productKey))
            productDaily.set(
              productKey,
              emptyAdMetrics({ advertId: stat.advertId, nmId: nm.nmId || nm.nm, name: nm.name || `Товар ${key}`, date })
            );
          addAdMetrics(productDaily.get(productKey), nm);
        }
      }
    }
  }
  for (const campaign of campaigns) {
    if (!rows.some(row => String(row.id) === String(campaign.id)))
      rows.push({
        id: campaign.id,
        name: campaign.settings?.name || `Кампания #${campaign.id}`,
        status: campaign.status,
        type: campaign.type ?? null,
        paymentType: campaign.settings?.payment_type || '',
        bidType: campaign.bid_type || '',
        createdAt: campaign.timestamps?.created || '',
        startedAt: campaign.timestamps?.started || '',
        updatedAt: campaign.timestamps?.updated || '',
        nmIds: campaignProductIds(campaign),
        nmInCampaign: campaignProductIds(campaign),
        nmCount: campaignProductIds(campaign).length,
        nmActive: 0,
        nmRemovedActive: 0,
        activeNmIds: [],
        ...finalizeAdMetrics(emptyAdMetrics())
      });
  }
  const total = emptyAdMetrics();
  rows.forEach(row => addAdMetrics(total, row));
  return {
    period: { from, to },
    totals: finalizeAdMetrics(total),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map(finalizeAdMetrics),
    campaigns: rows.map(finalizeAdMetrics).sort((a, b) => b.spend - a.spend),
    platforms: [...platforms.values()].map(finalizeAdMetrics).sort((a, b) => b.spend - a.spend),
    products: [...products.values()]
      .map(finalizeAdMetrics)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 100),
    productDaily: [...productDaily.values()]
      .map(finalizeAdMetrics)
      .sort((a, b) => `${a.date}:${a.nmId}`.localeCompare(`${b.date}:${b.nmId}`))
  };
}

function campaignProductDaily(rows = [], campaignId, nmIds = []) {
  const own = rows.filter(row => String(row.advertId) === String(campaignId));
  if (own.length || rows.some(row => row.advertId !== undefined)) return own;
  const allowed = new Set(nmIds.map(String));
  return rows.filter(row => !allowed.size || allowed.has(String(row.nmId)));
}

function enrichAdvertising(summary, cards = []) {
  const byNmId = new Map(
    cards.map(card => [
      String(card.nmID),
      {
        name: card.title || `Товар ${card.nmID}`,
        vendorCode: card.vendorCode || '',
        photo: cardPhoto(card),
        barcode: card.sizes?.[0]?.skus?.[0] || ''
      }
    ])
  );
  const products = (summary.products || []).map(product => ({ ...product, ...(byNmId.get(String(product.nmId)) || {}) }));
  // nmVendorCodes — артикулы продавца для подсказки столбца «Артикулы» (до 100 товаров кампании).
  const campaigns = (summary.campaigns || []).map(campaign => ({
    ...campaign,
    photo: (campaign.nmIds || []).map(nmId => byNmId.get(String(nmId))?.photo).find(Boolean) || '',
    nmVendorCodes: Object.fromEntries((campaign.nmIds || []).slice(0, 100).map(nmId => [nmId, byNmId.get(String(nmId))?.vendorCode || '']))
  }));
  const productDaily = (summary.productDaily || []).map(row => ({ ...row, ...(byNmId.get(String(row.nmId)) || {}) }));
  return { ...summary, products, campaigns, productDaily };
}

function demoAdProducts(campaignIndex, views, clicks, spend, orders, revenue) {
  return [0.62, 0.38].map((share, index) => ({
    nmId: 4210000 + campaignIndex * 10 + index,
    name: `Демо-товар ${campaignIndex + 1}.${index + 1}`,
    views: Math.round(views * share),
    clicks: Math.round(clicks * share),
    sum: Math.round(spend * share * 100) / 100,
    orders: Math.round(orders * share),
    sum_price: Math.round(revenue * share * 100) / 100,
    atbs: Math.round(clicks * share * 0.23),
    shks: Math.round(orders * share * 0.78)
  }));
}

function demoAds(from, to) {
  const campaigns = [
    {
      id: 101,
      status: 9,
      type: 9,
      bid_type: 'manual',
      timestamps: { created: '2026-03-12T09:15:00+03:00', started: '2026-09-01T10:00:00+03:00', updated: '2026-09-20T18:42:00+03:00' },
      settings: { name: 'Поиск · базовая коллекция', payment_type: 'cpm' }
    },
    {
      id: 102,
      status: 11,
      type: 8,
      bid_type: 'unified',
      timestamps: { created: '2026-06-02T14:40:00+03:00', started: null, updated: '2026-09-18T09:05:00+03:00' },
      settings: { name: 'Автокампания · хиты', payment_type: 'cpm' }
    },
    {
      id: 103,
      status: 7,
      type: 5,
      bid_type: 'manual',
      timestamps: { created: '2025-11-20T11:05:00+03:00', started: '2026-01-15T12:30:00+03:00', updated: '2026-08-30T21:10:00+03:00' },
      settings: { name: 'Карточка товара · новинки', payment_type: 'cpc' }
    }
  ];
  const demoBudgets = new Map([
    ['101', 18400],
    ['102', 7250]
  ]);
  const stats = campaigns.map((campaign, campaignIndex) => {
    const days = [];
    for (
      let cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`), index = 0;
      cursor <= end;
      cursor.setUTCDate(cursor.getUTCDate() + 1), index++
    ) {
      const views = 5200 + campaignIndex * 1700 + index * 260,
        clicks = Math.round(views * (0.025 + campaignIndex * 0.006));
      const spend = Math.round(clicks * (13 + campaignIndex * 4) * 100) / 100,
        orders = Math.round(clicks * (0.08 + campaignIndex * 0.015));
      const revenue = orders * (1750 + campaignIndex * 410);
      days.push({
        date: cursor.toISOString(),
        views,
        clicks,
        sum: spend,
        orders,
        sum_price: revenue,
        atbs: Math.round(clicks * 0.23),
        shks: Math.round(orders * 0.78),
        canceled: campaignIndex === 2 && index % 4 === 0 ? 1 : 0,
        apps: [1, 32, 64].map((appType, appIndex) => {
          const share = [0.18, 0.52, 0.3][appIndex];
          return {
            appType,
            views: Math.round(views * share),
            clicks: Math.round(clicks * share),
            sum: spend * share,
            orders: Math.round(orders * share),
            sum_price: revenue * share,
            nms: demoAdProducts(campaignIndex, views * share, clicks * share, spend * share, orders * share, revenue * share)
          };
        })
      });
    }
    const total = emptyAdMetrics();
    days.forEach(day => addAdMetrics(total, day));
    return {
      advertId: campaign.id,
      sum: total.spend,
      sum_price: total.revenue,
      atbs: total.carts,
      shks: total.sales,
      views: total.views,
      clicks: total.clicks,
      orders: total.orders,
      canceled: total.canceled,
      days
    };
  });
  const summary = summarizeAdStats(campaigns, stats, from, to);
  return { demo: true, ...summary, campaigns: withAdBudgets(summary.campaigns, demoBudgets), warnings: [] };
}

function validAdPeriod(from, to) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  const safeTo = pattern.test(to || '') ? to : dateDaysAgo(0);
  const safeFrom = pattern.test(from || '') ? from : dateDaysAgo(6);
  const days = Math.floor((new Date(`${safeTo}T00:00:00Z`) - new Date(`${safeFrom}T00:00:00Z`)) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1) throw apiError(400, 'Начало периода должно быть раньше окончания');
  if (days > 31) throw apiError(400, 'Для рекламы выберите период не более 31 дня — это ограничение WB API');
  return { from: safeFrom, to: safeTo };
}

function historyPeriod(from, to, today = moscowDate(0)) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(from || '') || !pattern.test(to || '')) throw apiError(400, 'Укажите даты начала и конца выгрузки');
  if (from > to) throw apiError(400, 'Дата начала должна быть не позже даты конца');
  if (to > today) throw apiError(400, 'Дата конца не может быть позже сегодняшнего дня');
  const [year, month] = today.split('-').map(Number);
  const earliest = new Date(Date.UTC(year, month - 1 - HISTORY_MAX_MONTHS, 1)).toISOString().slice(0, 10);
  if (from < earliest) throw apiError(400, `Выгрузка доступна не раньше ${earliest.split('-').reverse().join('.')}`);
  return { from, to };
}

function historyChunks({ from, to }) {
  const chunks = [];
  for (let cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); cursor <= end; ) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 30);
    chunks.push({ from: cursor.toISOString().slice(0, 10), to: (chunkEnd > end ? end : chunkEnd).toISOString().slice(0, 10) });
    cursor = chunkEnd;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}

// Статистика кампаний у WB ограничена одним запросом примерно раз в 20 секунд на продавца,
// поэтому все обращения к ней идут через очередь кабинета.
function fullstatsRequest(id, token, ids, from, to, onWait = () => {}) {
  const key = `ad-stats:${id}:${from}:${to}:${ids}`;
  const fresh = () => {
    const cached = analyticsCache.get(key);
    return cached && Date.now() - cached.savedAt < 3 * 60_000 ? cached : null;
  };
  if (fresh()) return Promise.resolve(fresh().value);
  const task = async () => {
    if (fresh()) return fresh().value;
    for (let attempt = 0; ; attempt++) {
      const delay = (fullstatsLastCall.get(id) || 0) + FULLSTATS_INTERVAL - Date.now();
      if (delay > 0) {
        onWait(delay, attempt ? 'retry' : 'limit');
        await wait(delay);
      }
      fullstatsLastCall.set(id, Date.now());
      try {
        const value = await wbRequest(
          token,
          `https://advert-api.wildberries.ru/adv/v3/fullstats?ids=${ids}&beginDate=${from}&endDate=${to}`
        );
        analyticsCache.set(key, { value, savedAt: Date.now() });
        return value;
      } catch (error) {
        if (error.status === 429 && attempt < 2) {
          fullstatsLastCall.set(id, Date.now() + Math.max(0, (error.retryAfter || 0) * 1000 - FULLSTATS_INTERVAL));
          continue;
        }
        const stale = analyticsCache.get(key);
        if (stale) return stale.value;
        throw error;
      }
    }
  };
  const run = (fullstatsQueues.get(id) || Promise.resolve()).then(task);
  fullstatsQueues.set(
    id,
    run.catch(() => {})
  );
  return run;
}

// Какие дни нужно запросить у WB: несохранённые и свежие (WB ещё пересчитывает их статистику).
// Соседние дни собираются в запросы не длиннее 31 дня, чтобы тратить меньше запросов.
function planAdFetch(dates = [], storedDates = new Set(), today = moscowDate(0), freshDays = AD_FRESH_DAYS) {
  const freshFrom = addDays(today, -freshDays);
  const missing = dates.filter(date => !storedDates.has(date) || date >= freshFrom);
  const chunks = [];
  for (let index = 0; index < missing.length; ) {
    const limit = addDays(missing[index], 30);
    let last = index;
    while (last + 1 < missing.length && missing[last + 1] <= limit) last++;
    chunks.push({ from: missing[index], to: missing[last] });
    index = last + 1;
  }
  return { missing, chunks };
}

// Если кабинет переименовали или папка лежит по старой схеме прямо в data/Ads,
// папка кампании переносится на новое место, чтобы сохранённая статистика не терялась.
function campaignDir(cabinetId, campaignId) {
  const target = path.join(ADS_DIR, cabinetFolderName(cabinetId), String(campaignId));
  if (fs.existsSync(target)) return target;
  const candidates = [path.join(ADS_DIR, String(campaignId))];
  try {
    for (const entry of fs.readdirSync(ADS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && !/^\d+$/.test(entry.name)) candidates.push(path.join(ADS_DIR, entry.name, String(campaignId)));
    }
  } catch {}
  const source = candidates.find(dir => dir !== target && fs.existsSync(dir));
  if (source) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
    try {
      if (path.dirname(source) !== ADS_DIR && !fs.readdirSync(path.dirname(source)).length) fs.rmdirSync(path.dirname(source));
    } catch {}
  }
  return target;
}

function adMonthFile(cabinetId, campaignId, month) {
  return path.join(campaignDir(cabinetId, campaignId), `${month}.json`);
}

function readAdMonth(cabinetId, campaignId, month) {
  try {
    return JSON.parse(fs.readFileSync(adMonthFile(cabinetId, campaignId, month), 'utf8'));
  } catch {
    return null;
  }
}

function loadStoredAdDays(cabinetId, campaignId, from, to) {
  const stored = new Map();
  for (const month of [...new Set(datesBetween(from, to).map(date => date.slice(0, 7)))]) {
    for (const [date, record] of Object.entries(readAdMonth(cabinetId, campaignId, month)?.days || {})) {
      if (date >= from && date <= to && record?.campaign) stored.set(date, record);
    }
  }
  return stored;
}

function emptyAdDay(date) {
  return { date, ...finalizeAdMetrics(emptyAdMetrics()) };
}

function saveAdDays(campaignId, cabinet, name, dates, daily, productsByDate) {
  const fetchedAt = new Date().toISOString();
  const byMonth = new Map();
  for (const date of dates) {
    if (!byMonth.has(date.slice(0, 7))) byMonth.set(date.slice(0, 7), []);
    byMonth.get(date.slice(0, 7)).push(date);
  }
  for (const [month, monthDates] of byMonth) {
    const file = readAdMonth(cabinet, campaignId, month) || { campaignId: Number(campaignId), month, days: {} };
    for (const date of monthDates) {
      file.days[date] = {
        fetchedAt,
        campaign: daily.get(date) || emptyAdDay(date),
        products: (productsByDate.get(date) || []).map(({ photo, vendorCode, barcode, ...item }) => item)
      };
    }
    file.days = Object.fromEntries(Object.entries(file.days).sort(([a], [b]) => a.localeCompare(b)));
    Object.assign(file, { cabinet, name, updatedAt: fetchedAt });
    const target = adMonthFile(cabinet, campaignId, month);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(file, null, 2));
    fs.renameSync(`${target}.tmp`, target);
  }
}

// Если вкладка рекламы только что скачала статистику всех кампаний за подходящий период,
// нужная кампания берётся из этого ответа без нового запроса к WB.
function cachedCampaignStats(id, campaignId, from, to) {
  const prefix = `ad-stats:${id}:`;
  for (const [key, entry] of analyticsCache) {
    if (!key.startsWith(prefix) || Date.now() - entry.savedAt >= 3 * 60_000) continue;
    const [cachedFrom, cachedTo, ids = ''] = key.slice(prefix.length).split(':');
    if (cachedFrom > from || cachedTo < to || !ids.split(',').includes(String(campaignId))) continue;
    const stat = (Array.isArray(entry.value) ? entry.value : []).find(item => String(item.advertId) === String(campaignId));
    if (!stat) return [];
    return [
      {
        ...stat,
        days: (stat.days || []).filter(day => {
          const date = String(day.date || '').slice(0, 10);
          return date >= from && date <= to;
        })
      }
    ];
  }
  return null;
}

function hasAdActivity(day = {}) {
  return ['views', 'clicks', 'spend', 'orders', 'revenue', 'carts', 'canceled'].some(key => Number(day[key] || 0) > 0);
}

// --- Ключевые запросы кампании (поисковые кластеры WB) ---
// Метод отдаёт кластеры отдельно для каждой пары «кампания + артикул», до 100 пар в запросе,
// лимит 10 запросов в минуту, поэтому запросы идут через очередь кабинета и сохраняются в файл.
// Места размещения и ставки товаров из списка кампаний (/api/advert/v2/adverts): ставки WB хранит в копейках.
// Для CPM ставка — за 1000 показов, для CPC — за клик.
function campaignSetup(meta, cards = [], demo = false) {
  if (demo)
    return {
      paymentType: 'cpm',
      bidType: 'manual',
      placements: { search: true, recommendations: false },
      bids: [{ nmId: 4210000, name: 'Демо-товар 1.1', vendorCode: 'DEMO-1', photo: '', subject: 'Демо', search: 250, recommendations: 0 }]
    };
  if (!meta) return null;
  const byNmId = new Map(cards.map(card => [String(card.nmID), card]));
  const rub = value => (value == null ? null : Number(value) / 100);
  return {
    paymentType: meta.settings?.payment_type || '',
    bidType: meta.bid_type || '',
    placements: meta.settings?.placements || null,
    bids: (Array.isArray(meta.nm_settings) ? meta.nm_settings : []).map(item => {
      const card = byNmId.get(String(item.nm_id)) || {};
      return {
        nmId: item.nm_id,
        name: card.title || `Товар ${item.nm_id}`,
        vendorCode: card.vendorCode || '',
        photo: cardPhoto(card),
        subject: item.subject?.name || '',
        search: rub(item.bids_kopecks?.search),
        recommendations: rub(item.bids_kopecks?.recommendations)
      };
    })
  };
}

// --- Статистика одного ключевого запроса по дням ---
// /adv/v1/normquery/stats отдаёт дневную статистику сразу по всем кластерам товаров кампании, поэтому ответ кэшируется:
// первый запрос ждёт WB (до 10 запросов в минуту), следующие ключевые запросы того же периода открываются мгновенно.
function emptyKeywordDay(date) {
  return { date, views: 0, clicks: 0, spend: 0, carts: 0, orders: 0, sales: 0, positionWeight: 0, positionBase: 0, viewsKnown: false };
}
function summarizeKeywordDaily(items = [], query, dates = []) {
  const byDate = new Map(dates.map(date => [date, emptyKeywordDay(date)]));
  for (const item of items)
    for (const day of item.dailyStats || []) {
      const stat = day.stat || {};
      if (String(stat.normQuery || '').trim() !== query) continue;
      const date = String(day.date || '').slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, emptyKeywordDay(date));
      const row = byDate.get(date),
        views = Number(stat.views || 0);
      if (stat.views !== undefined && stat.views !== null) row.viewsKnown = true;
      row.views += views;
      row.clicks += Number(stat.clicks || 0);
      row.spend += Number(stat.spend || 0);
      row.carts += Number(stat.atbs || 0);
      row.orders += Number(stat.orders || 0);
      row.sales += Number(stat.shks || 0);
      if (stat.avgPos) {
        row.positionWeight += Number(stat.avgPos) * (views || 1);
        row.positionBase += views || 1;
      }
    }
  const viewsAvailable = [...byDate.values()].some(row => row.viewsKnown);
  return {
    viewsAvailable,
    days: [...byDate.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ positionWeight, positionBase, viewsKnown, ...row }) => ({
        ...row,
        views: viewsAvailable ? row.views : null,
        ctr: viewsAvailable ? safeRatio(row.clicks, row.views) : null,
        cpm: viewsAvailable ? safeRatio(row.spend, row.views, 1000) : null,
        cpc: safeRatio(row.spend, row.clicks, 1),
        cr: safeRatio(row.orders, row.clicks),
        avgPosition: positionBase ? Math.round((positionWeight / positionBase) * 10) / 10 : null
      }))
  };
}
// Средняя позиция кампании по дням: из статистики поисковых кластеров (/adv/v1/normquery/stats), взвешенная по показам
// (у CPC-кампаний показов нет — тогда каждый кластер весит одинаково). Это позиция в поиске; дни без данных — null.
function summarizePositionDaily(items = [], dates = []) {
  const byDate = new Map(dates.map(date => [date, { weight: 0, base: 0 }]));
  for (const item of items)
    for (const day of item.dailyStats || []) {
      const stat = day.stat || {};
      if (!stat.avgPos) continue;
      const date = String(day.date || '').slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, { weight: 0, base: 0 });
      const weight = Number(stat.views) || 1,
        row = byDate.get(date);
      row.weight += Number(stat.avgPos) * weight;
      row.base += weight;
    }
  return [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({ date, avgPosition: row.base ? Math.round((row.weight / row.base) * 10) / 10 : null }));
}
async function campaignPositions(id, campaignId, from, to) {
  const period = historyPeriod(from, to),
    dates = datesBetween(period.from, period.to);
  if (id === 'demo' || !cabinets().length)
    return { demo: true, period, days: dates.map((date, index) => ({ date, avgPosition: 6 + ((index * 7) % 9) })) };
  if (!/^\d{1,15}$/.test(String(campaignId || ''))) throw apiError(400, 'Некорректный номер кампании');
  const token = tokenFor(id);
  const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
  const meta = (Array.isArray(campaignData?.adverts) ? campaignData.adverts : []).find(item => String(item.id) === String(campaignId));
  if (!meta) throw apiError(404, 'Кампания не найдена');
  const nmIds = campaignProductIds(meta).map(String).slice(0, 100);
  if (!nmIds.length) return { demo: false, period, days: dates.map(date => ({ date, avgPosition: null })) };
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
  return { demo: false, period, days: summarizePositionDaily(response?.items || [], dates) };
}

function normqueryRequest(id, token, body, url = NORMQUERY_URL) {
  const task = async () => {
    for (;;) {
      const now = Date.now();
      const bucket = normqueryBuckets.get(id) || { tokens: NORMQUERY_BURST, updatedAt: now };
      bucket.tokens = Math.min(NORMQUERY_BURST, bucket.tokens + Math.max(0, now - bucket.updatedAt) / NORMQUERY_INTERVAL);
      bucket.updatedAt = now;
      normqueryBuckets.set(id, bucket);
      if (bucket.tokens < 1) {
        await wait((1 - bucket.tokens) * NORMQUERY_INTERVAL);
        continue;
      }
      bucket.tokens -= 1;
      return wbRequest(token, url, { method: 'POST', body });
    }
  };
  const run = (normqueryQueues.get(id) || Promise.resolve()).then(task);
  normqueryQueues.set(
    id,
    run.catch(() => {})
  );
  return run;
}

function withAdBudgets(campaigns = [], budgets = new Map()) {
  return campaigns.map(campaign => ({ ...campaign, budget: budgets.has(String(campaign.id)) ? budgets.get(String(campaign.id)) : null }));
}

// Остатки бюджетов кампаний: POST /api/advert/v2/budget, до 50 кампаний за запрос, статусы 4, 9, 11; лимит — 20 запросов
// в минуту (интервал 3 с). Старый GET /adv/v1/budget?id= WB отключает 16 ноября 2026. Проверено на данных: кампании в других
// статусах WB просто не возвращает (без ошибки), total совпадает со старым методом.
async function advertBudgets(id, token, campaigns = [], warnings = []) {
  const targets = campaigns
    .filter(item => AD_BUDGET_STATUSES.has(Number(item.status)))
    .map(item => Number(item.id))
    .filter(Boolean);
  const budgets = new Map();
  let failed = 0;
  for (let offset = 0; offset < targets.length; offset += AD_BUDGET_CHUNK) {
    const chunk = targets.slice(offset, offset + AD_BUDGET_CHUNK);
    try {
      const data = await cachedAnalytics(
        `ad-budgets:${id}:${chunk.join(',')}`,
        async () => {
          const pause = AD_BUDGET_INTERVAL - (Date.now() - (adBudgetLastCall.get(id) || 0));
          if (pause > 0) await wait(pause);
          adBudgetLastCall.set(id, Date.now());
          return wbRequest(token, AD_BUDGET_URL, { method: 'POST', body: { advertIds: chunk } });
        },
        60_000
      );
      for (const item of Array.isArray(data?.adverts) ? data.adverts : [])
        if (item?.advertId != null && item.total != null) budgets.set(String(item.advertId), Number(item.total));
    } catch {
      failed += chunk.length;
    }
  }
  if (failed) warnings.push(`Остаток бюджета: WB не ответил по ${failed} кампаниям`);
  return budgets;
}

module.exports = {
  AD_BUDGET_INTERVAL,
  AD_BUDGET_STATUSES,
  AD_BUDGET_URL,
  AD_CAMPAIGNS_URL,
  NORMQUERY_CHUNK,
  NORMQUERY_DAILY_URL,
  NORMQUERY_GET_MINUS_URL,
  NORMQUERY_LIST_INTERVAL,
  NORMQUERY_LIST_URL,
  NORMQUERY_MINUS_LIMIT,
  NORMQUERY_SET_MINUS_URL,
  adBudgetLastCall,
  addAdMetrics,
  advertBudgets,
  cachedCampaignStats,
  campaignDir,
  campaignPositions,
  campaignProductDaily,
  campaignProductIds,
  campaignSetup,
  demoAds,
  emptyAdDay,
  emptyAdMetrics,
  enrichAdvertising,
  extractFunnel,
  finalizeAdMetrics,
  fullstatsRequest,
  hasAdActivity,
  historyChunks,
  historyPeriod,
  loadStoredAdDays,
  normqueryRequest,
  planAdFetch,
  safeRatio,
  saveAdDays,
  summarizeAdStats,
  summarizeKeywordDaily,
  summarizePositionDaily,
  validAdPeriod,
  withAdBudgets
};
