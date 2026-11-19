'use strict';
// --- Детализация товара: органика и реклама по дням, флажки кампаний и цен из Google Таблицы, оценки, заметки на графике.
const fs = require('node:fs');
const path = require('node:path');
const {
  ROOT,
  addDays,
  analyticsCache,
  apiError,
  cabinets,
  cachedAnalytics,
  datesBetween,
  moscowDate,
  tokenFor,
  wbRequest
} = require('../core/base');
const { glueRatings, productCards } = require('../core/product-cards');
const { cardPhoto } = require('../core/photos');
const {
  AD_CAMPAIGNS_URL,
  NORMQUERY_DAILY_URL,
  addAdMetrics,
  campaignProductIds,
  emptyAdMetrics,
  finalizeAdMetrics,
  historyChunks,
  normqueryRequest,
  summarizePositionDaily
} = require('../ads/stats');
const { keywordEventId } = require('../ads/keywords');
const { adCampaignMayHaveStats, loadAdStats } = require('../ads/campaign');
const { FUNNEL_MAX_DEPTH_DAYS, funnelHistory, pickFunnelCounts } = require('../funnel/funnel');
const { SHEET_DIR, readSheetHistory, readSheetJson, sheetAdsTrackingSince, sheetConfigured } = require('../sheet/sheet');

// --- Детализация товара (product.html): воронка по дням с разбивкой «органика / реклама», реклама товара, позиция ---
// Органика = воронка товара за день минус рекламная статистика этого товара за тот же день: переходы — минус клики
// рекламы, корзины — минус корзины, заказы — минус рекламные заказы. WB считает рекламу и воронку по-разному, поэтому
// разность может уйти в минус — тогда органика 0 (это делает страница). Реклама — только кампании, где есть этот товар;
// кампания «включена» в день, когда у товара были показы, клики или расход. Куски рекламы до 31 дня (ограничение WB);
// прошлые куски не меняются и кэшируются на 6 часов, текущий — на 2 минуты.
const PRODUCT_DETAIL_MAX_DAYS = 93;
function productDetailPeriod(from, to, today = moscowDate(0)) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  const safeTo = pattern.test(to || '') ? (to > today ? today : to) : today;
  const safeFrom = pattern.test(from || '') ? from : addDays(safeTo, -13);
  if (safeFrom > safeTo) throw apiError(400, 'Начало периода должно быть не позже конца');
  if (datesBetween(safeFrom, safeTo).length > PRODUCT_DETAIL_MAX_DAYS)
    throw apiError(400, `Выберите период не длиннее ${PRODUCT_DETAIL_MAX_DAYS} дней`);
  const earliest = addDays(today, -FUNNEL_MAX_DEPTH_DAYS);
  if (safeFrom < earliest) throw apiError(400, `WB отдаёт воронку только с ${earliest.split('-').reverse().join('.')}`);
  return { from: safeFrom, to: safeTo };
}
// Реклама одного товара по дням из ответа fullstats: сумма по кампаниям и список кампаний, включённых в этот день.
// Кампания считается включённой в день, когда у товара в ней 50 показов и больше: при меньшем числе (несколько
// случайных показов, расход «хвостом» после паузы) она по сути не работала.
const PRODUCT_AD_MIN_VIEWS = 50;
function productAdDays(stats = [], nmId, dates = []) {
  const days = new Map(dates.map(date => [date, { ...emptyAdMetrics(), campaigns: [] }])),
    campaigns = new Map();
  for (const stat of stats)
    for (const day of stat.days || []) {
      const date = String(day.date || '').slice(0, 10),
        row = days.get(date);
      if (!row) continue;
      const metrics = emptyAdMetrics();
      for (const app of day.apps || [])
        for (const nm of app.nms || []) if (String(nm.nmId ?? nm.nm) === String(nmId)) addAdMetrics(metrics, nm);
      addAdMetrics(row, metrics);
      const key = String(stat.advertId);
      if (!campaigns.has(key)) campaigns.set(key, { ...emptyAdMetrics(), activeDays: 0 });
      addAdMetrics(campaigns.get(key), metrics);
      if (metrics.views >= PRODUCT_AD_MIN_VIEWS) {
        row.campaigns.push(Number(stat.advertId));
        campaigns.get(key).activeDays += 1;
      }
    }
  return { days, campaigns };
}
function demoProductDetail(nmId, period, dates) {
  const campaigns = [
    { id: 901, name: 'Поиск — основной', type: 9 },
    { id: 902, name: 'Авто — весь каталог', type: 8 },
    { id: 903, name: 'Поиск — распродажа', type: 9 }
  ];
  const active = (id, index) =>
    id === 901 ? true : id === 902 ? index >= 3 && index < dates.length - 4 : index >= Math.floor(dates.length / 2);
  const days = dates.map((date, index) => {
    const wave = 1 + 0.15 * Math.sin(index / 1.7),
      on = campaigns.filter(item => active(item.id, index)).map(item => item.id);
    const opens = Math.round(900 * wave),
      carts = Math.round(opens * 0.12),
      orders = Math.round(carts * 0.3);
    const adClicks = Math.round(opens * (0.18 + on.length * 0.07)),
      adCarts = Math.round(adClicks * 0.1),
      adOrders = Math.round(adCarts * 0.3),
      spend = Math.round(adClicks * 14);
    return {
      date,
      funnel: {
        openCount: opens,
        cartCount: carts,
        orderCount: orders,
        orderSum: orders * 1890,
        buyoutCount: Math.round(orders * 0.7),
        buyoutSum: Math.round(orders * 0.7) * 1890,
        addToWishlistCount: Math.round(opens * 0.03)
      },
      ads: finalizeAdMetrics({
        ...emptyAdMetrics(),
        views: adClicks * 30,
        clicks: adClicks,
        spend,
        carts: adCarts,
        orders: adOrders,
        revenue: adOrders * 1890
      }),
      campaigns: on,
      avgPosition: Math.round((14 - on.length * 2 + Math.sin(index) * 2) * 10) / 10
    };
  });
  return {
    demo: true,
    period,
    product: { nmId: Number(nmId), name: 'Демо-товар: худи оверсайз', vendorCode: 'HOODIE-01', brand: 'Демо', subject: 'Худи', photo: '' },
    days,
    campaigns: campaigns.map(item => ({
      ...item,
      status: 9,
      activeDays: days.filter(day => day.campaigns.includes(item.id)).length,
      ...finalizeAdMetrics(emptyAdMetrics())
    })),
    tracking: null,
    priceChanges: [
      [3, 2100, 1890],
      [Math.max(4, dates.length - 5), 1890, 1990]
    ]
      .filter(([index]) => index < dates.length)
      .map(([index, before, after]) => ({
        at: `${dates[index]}T09:45:00.000Z`,
        date: dates[index],
        items: [
          { what: 'Цена со скидкой, ₽', before, after },
          { what: 'Скидка продавца, %', before: 30, after: Math.round((1 - after / 3000) * 100) }
        ]
      })),
    sync: { pending: 0 },
    warnings: [],
    fetchedAt: new Date().toISOString()
  };
}
// --- Включена ли кампания для товара — по истории Google Таблицы (статус и состав кампании) ---
// С начала отслеживания (sync.json → since) таблица записывает смену статуса («Статус», «Появилось в списке»,
// «Пропало из списка») и состава кампании («Артикулы WB»: новый формат — полные списки до и после, старый —
// «убраны: …» / «добавлены: …»). Кампания включена для товара, когда статус «Активна» и товар в ней есть.
// Значение поля после его последней записи — из таблицы (без записей — текущее из WB), раньше — восстанавливается
// назад по записям. Результат: Map id → { initial — состояние до первой записи, changes — [{ at, on, reason }] }.
const SHEET_ACTIVE_STATUS = 'Активна';
const sheetIds = value => String(value ?? '').match(/\d{5,}/g) || [];
const moscowDateOf = iso => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10);
const moscowDayStart = date => new Date(Date.parse(`${date}T00:00:00+03:00`)).toISOString();
function campaignSheetChange(row, nmId) {
  const what = String(row.what || '');
  if (what === 'Статус')
    return {
      field: 'status',
      before: row.before === SHEET_ACTIVE_STATUS,
      after: row.after === SHEET_ACTIVE_STATUS,
      reason: `статус: ${row.before} → ${row.after}`
    };
  if (what === 'Появилось в списке')
    return { field: 'status', before: false, after: row.after === SHEET_ACTIVE_STATUS, reason: `кампания появилась (${row.after})` };
  if (what === 'Пропало из списка')
    return { field: 'status', before: row.before === SHEET_ACTIVE_STATUS, after: false, reason: 'кампания пропала из списка' };
  if (!what.startsWith('Артикулы WB')) return null;
  let before, after;
  if (what.startsWith('Артикулы WB:')) {
    before = sheetIds(row.before).includes(nmId);
    after = sheetIds(row.after).includes(nmId);
  } else {
    const listed = prefix =>
      [row.before, row.after]
        .filter(value => new RegExp(`^${prefix}`, 'i').test(String(value ?? '')))
        .flatMap(sheetIds)
        .includes(nmId);
    if (listed('убран')) {
      before = true;
      after = false;
    } else if (listed('добавлен')) {
      before = false;
      after = true;
    } else return null;
  }
  return before === after
    ? null
    : { field: 'member', before, after, reason: after ? 'товар добавлен в кампанию' : 'товар убран из кампании' };
}
function productCampaignTimeline(nmId, rows = [], current = new Map()) {
  const byCampaign = new Map();
  for (const row of rows) {
    if (row?.section !== 'Реклама') continue;
    const change = campaignSheetChange(row, String(nmId));
    if (!change) continue;
    const id = String(row.id);
    if (!byCampaign.has(id)) byCampaign.set(id, []);
    byCampaign.get(id).push({ ...change, at: String(row.at) });
  }
  const on = state => state.status && state.member,
    result = new Map();
  for (const id of new Set([...byCampaign.keys(), ...current.keys()])) {
    const list = (byCampaign.get(id) || []).sort((a, b) => a.at.localeCompare(b.at));
    const state = { status: false, member: false, ...current.get(id) };
    for (const field of ['status', 'member']) {
      const last = list.filter(change => change.field === field).at(-1);
      if (last) state[field] = last.after;
    }
    // Назад по записям: перед каждой записью поле было равно её «до». Записи одного обновления таблицы (одно время) —
    // один переход: сравниваем состояние до первой и после последней из них.
    const states = [{ ...state }];
    for (let index = list.length - 1; index >= 0; index--) states.unshift({ ...states[0], [list[index].field]: list[index].before });
    const changes = [];
    for (let index = 0; index < list.length; ) {
      let end = index;
      while (end + 1 < list.length && list[end + 1].at === list[index].at) end++;
      const was = on(states[index]),
        now = on(states[end + 1]);
      if (was !== now)
        changes.push({
          at: list[index].at,
          on: now,
          reason: list
            .slice(index, end + 1)
            .map(change => change.reason)
            .join('; ')
        });
      index = end + 1;
    }
    result.set(id, { initial: on(states[0]), changes });
  }
  return result;
}
const timelineOnAt = (timeline, time) => {
  let on = timeline.initial;
  for (const change of timeline.changes) {
    if (change.at <= time) on = change.on;
    else break;
  }
  return on;
};
// Работала ли кампания по дням — для флажков ▶ / ■ в детализации кампании, по тем же правилам, что у товара:
// до начала отслеживания Google Таблицы — 50 показов в день и больше, с начала — статус «Активна» хоть какое-то время
// дня (пауза и запуск внутри дня флажков не дают). Состав кампании здесь не важен: timeline строится только по статусу.
// events — точные переходы из таблицы за период (для подсказки флажка). Только копия таблицы на компьютере.
function campaignActivity(campaignId, period, daily = [], currentStatus) {
  const dates = datesBetween(period.from, period.to),
    views = new Map(daily.map(day => [String(day.date).slice(0, 10), Number(day.views || 0)]));
  const byViews = date => (views.get(date) || 0) >= PRODUCT_AD_MIN_VIEWS,
    untracked = { tracking: null, days: dates.map(date => ({ date, on: byViews(date) })), events: [] };
  if (!sheetConfigured()) return untracked;
  const rows = readSheetHistory({ ids: [String(campaignId)], sections: ['Реклама'], limit: 1_000_000 }).items;
  const since = sheetAdsTrackingSince(readSheetJson(path.join(SHEET_DIR, 'sync.json'), {}).since, rows);
  if (!since || moscowDateOf(since) > period.to) return untracked;
  const fromDate = moscowDateOf(since) < period.from ? period.from : moscowDateOf(since);
  const startTime = [since, moscowDayStart(period.from)].sort().at(-1),
    endTime = moscowDayStart(addDays(period.to, 1));
  const timeline = productCampaignTimeline(
    '',
    rows,
    new Map([[String(campaignId), { status: Number(currentStatus) === 9, member: true }]])
  ).get(String(campaignId));
  const days = dates.map(date => {
    if (date < fromDate) return { date, on: byViews(date) };
    const dayStart = [startTime, moscowDayStart(date)].sort().at(-1),
      dayEnd = moscowDayStart(addDays(date, 1));
    return {
      date,
      on: timelineOnAt(timeline, dayStart) || timeline.changes.some(change => change.on && change.at > dayStart && change.at < dayEnd)
    };
  });
  // pausedAt — у включения: когда кампанию перед этим выключили (по таблице), чтобы подсказка флажка ▶ показывала,
  // что это запуск после паузы, а не первый запуск кампании.
  const events = timeline.changes
    .map((change, index) => ({ change, previous: timeline.changes[index - 1] }))
    .filter(({ change }) => change.at > startTime && change.at < endTime)
    .map(({ change, previous }) => ({
      at: change.at,
      date: moscowDateOf(change.at),
      on: change.on,
      ...(change.on && previous && !previous.on ? { pausedAt: previous.at } : {})
    }));
  return { tracking: { since, fromDate }, days, events };
}
// Данные таблицы для детализации товара (только копия на компьютере — без запросов к таблице):
// tracking — с какого дня статусы известны, какие кампании включены на начало и точные переходы за период;
// onByDate — включённые кампании по дням с начала отслеживания (включена хоть на какое-то время дня);
// priceChanges — изменения цены за период, сгруппированные по времени записи.
function productSheetData(nmId, period, dates, allCampaigns = [], inSettings = new Set(), statIds = []) {
  const empty = { tracking: null, onByDate: new Map(), priceChanges: [] };
  if (!sheetConfigured()) return empty;
  const groups = new Map();
  for (const row of readSheetHistory({ ids: [String(nmId)], sections: ['Цены'], limit: 100_000 }).items) {
    const date = moscowDateOf(row.at);
    if (date < period.from || date > period.to) continue;
    if (!groups.has(row.at)) groups.set(row.at, { at: row.at, date, items: [] });
    groups.get(row.at).items.push({ what: row.what, before: row.before, after: row.after });
  }
  const priceChanges = [...groups.values()].sort((a, b) => a.at.localeCompare(b.at));
  const current = new Map(
    [...new Set([...statIds.map(String), ...inSettings])].map(id => [
      id,
      { status: allCampaigns.find(item => String(item.id) === id)?.status === 9, member: inSettings.has(id) }
    ])
  );
  const adRows = readSheetHistory({ sections: ['Реклама'], limit: 1_000_000 }).items;
  const since = sheetAdsTrackingSince(
    readSheetJson(path.join(SHEET_DIR, 'sync.json'), {}).since,
    adRows.filter(row => current.has(String(row.id)))
  );
  if (!since || moscowDateOf(since) > period.to) return { ...empty, priceChanges };
  const fromDate = moscowDateOf(since) < period.from ? period.from : moscowDateOf(since);
  const startTime = [since, moscowDayStart(period.from)].sort().at(-1),
    endTime = moscowDayStart(addDays(period.to, 1));
  const timelines = productCampaignTimeline(nmId, adRows, current);
  const onAtStart = [],
    events = [],
    onByDate = new Map(dates.filter(date => date >= fromDate).map(date => [date, []]));
  for (const [id, timeline] of timelines) {
    if (!timeline.initial && !timeline.changes.length) continue;
    if (timelineOnAt(timeline, startTime)) onAtStart.push(Number(id));
    for (const change of timeline.changes)
      if (change.at > startTime && change.at < endTime)
        events.push({ id: Number(id), at: change.at, date: moscowDateOf(change.at), on: change.on, reason: change.reason });
    for (const [date, list] of onByDate) {
      const dayStart = [startTime, moscowDayStart(date)].sort().at(-1),
        dayEnd = moscowDayStart(addDays(date, 1));
      if (timelineOnAt(timeline, dayStart) || timeline.changes.some(change => change.on && change.at > dayStart && change.at < dayEnd))
        list.push(Number(id));
    }
  }
  return { tracking: { since, fromDate, onAtStart, events: events.sort((a, b) => a.at.localeCompare(b.at)) }, onByDate, priceChanges };
}
async function productDetail(id, nmIdInput, from, to, live = false) {
  const nmId = String(nmIdInput || '');
  if (!/^\d{1,15}$/.test(nmId)) throw apiError(400, 'Некорректный артикул');
  const period = productDetailPeriod(from, to),
    dates = datesBetween(period.from, period.to);
  if (id === 'demo' || !cabinets().length) return demoProductDetail(nmId, period, dates);
  const token = tokenFor(id),
    warnings = [],
    today = moscowDate(0);
  const cardsJob = productCards(id, token).catch(error => (warnings.push(`Карточки товаров: ${error.message}`), []));
  const funnelJob = funnelHistory(id, period.from, period.to, 'day', [nmId], live);
  let allCampaigns = [];
  try {
    const campaignData = await cachedAnalytics(`ad-campaigns:${id}`, () => wbRequest(token, AD_CAMPAIGNS_URL), 3 * 60_000);
    allCampaigns = Array.isArray(campaignData?.adverts) ? campaignData.adverts : [];
  } catch (error) {
    warnings.push(`Рекламные кампании: ${error.message}`);
  }
  const inSettings = new Set(allCampaigns.filter(item => campaignProductIds(item).map(String).includes(nmId)).map(item => String(item.id)));
  // Статистика — по всем кампаниям кабинета, а не только по тем, где товар есть в настройках сейчас: если артикул
  // из кампании убрали, его показы за прошлые дни всё равно должны попасть на график. Товар ищется в самой статистике.
  // Запросы те же, что у вкладки «Реклама» (loadAdStats), поэтому за тот же период до 31 дня ответ общий с ней.
  // Кусок с ошибкой WB в кэше не остаётся — при следующем обновлении он запросится заново.
  const adsJob = (async () => {
    const stats = [];
    for (const chunk of historyChunks(period)) {
      const key = `product-ad-all:${id}:${chunk.from}:${chunk.to}`;
      const result = await cachedAnalytics(
        key,
        async () => {
          const chunkWarnings = [];
          const loaded = await loadAdStats(id, token, chunk, chunkWarnings);
          return { stats: loaded.stats, warnings: chunkWarnings };
        },
        chunk.to < today ? 6 * 60 * 60_000 : 2 * 60_000
      ).catch(error => ({ stats: [], warnings: [`Статистика рекламы: ${error.message}`], failed: true }));
      if (result.warnings.length) {
        if (!result.failed) analyticsCache.delete(key);
        warnings.push(...result.warnings);
      }
      stats.push(...result.stats);
    }
    return stats;
  })();
  // Позиция в поиске — по поисковым кластерам кампаний с этим товаром (как в детализации кампании), взвешенно по показам:
  // кампании, где товар есть сейчас, и те, где у него была статистика за период.
  const positionsJob = adsJob
    .then(stats => {
      const withStats = [...productAdDays(stats, nmId, dates).campaigns]
        .filter(([, metrics]) => metrics.views || metrics.clicks || metrics.spend || metrics.orders)
        .map(([campaignId]) => campaignId);
      const ids = [...new Set([...inSettings, ...withStats])]
        .filter(
          campaignId =>
            allCampaigns.some(item => String(item.id) === campaignId) &&
            adCampaignMayHaveStats(
              allCampaigns.find(item => String(item.id) === campaignId),
              period.from,
              period.to
            )
        )
        .slice(0, 100);
      if (!ids.length) return new Map();
      return cachedAnalytics(
        `product-positions:${id}:${nmId}:${period.from}:${period.to}:${ids.join(',')}`,
        () =>
          normqueryRequest(
            id,
            token,
            { from: period.from, to: period.to, items: ids.map(campaignId => ({ advertId: Number(campaignId), nmId: Number(nmId) })) },
            NORMQUERY_DAILY_URL
          ),
        10 * 60_000
      ).then(response => new Map(summarizePositionDaily(response?.items || [], dates).map(day => [day.date, day.avgPosition])));
    })
    .catch(error => (warnings.push(`Позиция в поиске: ${error.message}`), new Map()));
  const [funnel, stats, positions, cards] = await Promise.all([funnelJob, adsJob, positionsJob, cardsJob]);
  const ads = productAdDays(stats, nmId, dates),
    funnelByDate = new Map((funnel.current || []).map(day => [day.date, day]));
  // До начала отслеживания в Google Таблице кампания включена по показам (50 и больше), после — по статусу и составу.
  const sheet = productSheetData(nmId, period, dates, allCampaigns, inSettings, [...ads.campaigns.keys()]);
  const days = dates.map(date => {
    const { campaigns, ...metrics } = ads.days.get(date),
      day = funnelByDate.get(date);
    return {
      date,
      funnel: day ? pickFunnelCounts(day) : null,
      ads: finalizeAdMetrics(metrics),
      campaigns: sheet.onByDate.get(date) || campaigns,
      avgPosition: positions.get(date) ?? null
    };
  });
  const card = cards.find(item => String(item.nmID) === nmId);
  // createdAt / startedAt — чтобы на графике отличить кампанию, запущенную в первый день периода, от работавшей раньше.
  // removed — у товара была статистика в кампании, но сейчас его в настройках кампании нет (убрали).
  // activeDays — дни, когда кампания была включена (по показам или по статусу из таблицы). В список попадают и
  // кампании без статистики, которые по таблице были включены (товар был в активной кампании, но показов не набрал).
  const campaignIds = new Set([...ads.campaigns.keys(), ...days.flatMap(day => day.campaigns.map(String))]);
  const campaigns = [...campaignIds]
    .map(campaignId => {
      const item = allCampaigns.find(campaign => String(campaign.id) === campaignId) || { id: Number(campaignId) },
        metrics = ads.campaigns.get(campaignId) || emptyAdMetrics();
      return {
        id: Number(campaignId),
        name: item.settings?.name || `Кампания #${campaignId}`,
        status: item.status ?? null,
        type: item.type ?? null,
        paymentType: item.settings?.payment_type || '',
        createdAt: item.timestamps?.created || '',
        startedAt: item.timestamps?.started || '',
        removed: !inSettings.has(campaignId),
        ...finalizeAdMetrics(metrics),
        activeDays: days.filter(day => day.campaigns.includes(Number(campaignId))).length
      };
    })
    .filter(item => item.activeDays || item.spend || item.views || item.orders)
    .sort((a, b) => b.spend - a.spend);
  return {
    demo: false,
    period,
    fetchedAt: new Date().toISOString(),
    product: {
      nmId: Number(nmId),
      name: card?.title || `Товар ${nmId}`,
      vendorCode: card?.vendorCode || '',
      brand: card?.brand || '',
      subject: card?.subjectName || '',
      photo: card ? cardPhoto(card) : '',
      feedback: await productFeedback(id, card)
    },
    days,
    campaigns,
    tracking: sheet.tracking,
    priceChanges: sheet.priceChanges,
    sync: funnel.sync || { pending: 0 },
    warnings: [...warnings, ...(funnel.warnings || [])]
  };
}
// Оценка и число оценок товара и его склейки (server/cards/glue-ratings.js). Склейки нет в файле — загружается сейчас (меньше секунды);
// не загрузилась — null, страница просто не покажет оценку.
async function productFeedback(id, card) {
  if (!card?.imtID) return null;
  try {
    const glue = await glueRatings.glueNow(id, card.imtID);
    if (!glue?.stars) return null;
    const item = glueRatings.item(id, card.imtID, Number(card.nmID));
    return { ...item, glueRating: glue.rating, glueCount: glue.count };
  } catch {
    return null;
  }
}
// Отметки на графике товара: data/product-notes.json, { "кабинет:артикул": [{ id, date, text, at }] } — свои заметки
// продавца: смена цены или СПП, ставки, акция. WB историю этого не отдаёт, поэтому их вносят вручную.
const PRODUCT_NOTES_FILE = path.join(ROOT, 'data', 'product-notes.json');
function productNotesKey(cabinet, nmId) {
  if (!/^[\w-]{1,40}$/.test(String(cabinet || '')) || !/^\d{1,15}$/.test(String(nmId || '')))
    throw apiError(400, 'Некорректный кабинет или артикул');
  return `${cabinet}:${nmId}`;
}
function readProductNotes() {
  try {
    const data = JSON.parse(fs.readFileSync(PRODUCT_NOTES_FILE, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
function productNotes(cabinet, nmId) {
  return {
    notes: [...(readProductNotes()[productNotesKey(cabinet, nmId)] || [])].sort(
      (a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at)
    )
  };
}
// Без noteId — новая отметка; с noteId — изменить дату и текст или удалить (remove).
function setProductNote(cabinet, nmId, body = {}) {
  const key = productNotesKey(cabinet, nmId),
    text = String(body.text || '').trim(),
    date = String(body.date || '');
  if (!body.remove) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw apiError(400, 'Укажите дату отметки');
    if (!text) throw apiError(400, 'Пустая отметка');
    if (text.length > 300) throw apiError(400, 'Отметка длиннее 300 символов');
  }
  const data = readProductNotes(),
    notes = [...(data[key] || [])];
  if (!body.noteId) notes.push({ id: keywordEventId(), date, text, at: new Date().toISOString() });
  else {
    const index = notes.findIndex(note => note.id === body.noteId);
    if (index < 0) throw apiError(404, 'Отметка не найдена — обновите страницу');
    if (body.remove) notes.splice(index, 1);
    else notes[index] = { ...notes[index], date, text, editedAt: new Date().toISOString() };
  }
  if (notes.length) data[key] = notes;
  else delete data[key];
  fs.mkdirSync(path.dirname(PRODUCT_NOTES_FILE), { recursive: true });
  fs.writeFileSync(`${PRODUCT_NOTES_FILE}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${PRODUCT_NOTES_FILE}.tmp`, PRODUCT_NOTES_FILE);
  return productNotes(cabinet, nmId);
}

module.exports = {
  campaignActivity,
  productAdDays,
  productCampaignTimeline,
  productDetail,
  productDetailPeriod,
  productNotes,
  setProductNote
};
