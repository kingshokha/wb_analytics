'use strict';
// --- Маршруты /api/…: разбор адреса и вызов нужного раздела; модули разделов, которым нужны общие функции, создаются здесь.
const fs = require('node:fs');
const path = require('node:path');
const {
  DATA_FILE,
  ROOT,
  analyticsCache,
  apiError,
  cabinets,
  cachedAnalytics,
  publicCabinets,
  readAliases,
  readJson,
  send,
  tokenFor,
  wbRequest
} = require('./core/base');
const { glueRatings, productCards, productCardsChanged, productCardsStatus, refreshProductCards } = require('./core/product-cards');
const { cardPhoto, localPhoto, servePhoto } = require('./core/photos');
const { forgetList } = require('./core/lists');
const { addFbsStocks, copyFbsStocks, fbsStockProducts, fbsStocks, fbwStocks, updateFbsStocks } = require('./stocks/stocks');
const {
  PRICE_PRESETS_FILE,
  STOCK_PRESETS_FILE,
  cabinetPresets,
  normalizePricePreset,
  normalizeStockPreset,
  removePreset,
  savePreset
} = require('./stocks/presets');
const { loadPriceGoods, priceStocks, prices, updatePrices } = require('./prices/prices');
const { dashboard, hourlyOrders } = require('./orders/orders');
const {
  assembleOrders,
  createSupply,
  createTrbx,
  deleteSupply,
  deleteTrbx,
  deliverSupply,
  fillTrbx,
  newFbsOrders,
  orderStickers,
  supplyBarcode,
  supplyDetails,
  supplyList,
  trbxStickers
} = require('./orders/fbs-orders');
const { campaignPositions } = require('./ads/stats');
const {
  campaignKeywordDaily,
  campaignKeywords,
  campaignMinus,
  keywordTags,
  recordKeywordStatus,
  setKeywordNote,
  setKeywordTag,
  setKeywordTagColors
} = require('./ads/keywords');
const {
  adFinance,
  advertising,
  advertisingCampaign,
  advertisingCampaignHistory,
  advertisingCampaignPrevious,
  advertisingPrevious,
  campaignBudget,
  campaignNotes,
  campaignZones,
  depositCampaignBudget,
  renameCampaign,
  saveCampaignZones,
  setCampaignNote,
  setCampaignPlacements,
  setCampaignStatus
} = require('./ads/campaign');
const { funnelHistory, funnelOrders, funnelSales, funnelTable, refetchFunnel } = require('./funnel/funnel');
const { summary, summaryAds } = require('./funnel/summary');
const { campaignActivity, productDetail, productNotes, setProductNote } = require('./product/product');
const { sheetHistory } = require('./sheet/sheet');
const { saveTodo, todos } = require('./todo/todo');
const { itemRatings } = require('./ratings/ratings');
const { itemReturns } = require('./returns/returns');

// Раздел «Карточки товаров» — отдельный модуль (content-cards.js), маршруты /api/card и /api/cards/*.
const contentCards = require('./cards/content-cards')({
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
  glueRatings
});
// Раздел «Сообщения» — отдельный модуль (communications.js), маршруты /api/messages/*. События чатов — в data/Chats
// (для тестового сервера — WB_CHATS_DIR, чтобы не трогать копию на компьютере).
const CHATS_DIR = process.env.WB_CHATS_DIR ? path.resolve(process.env.WB_CHATS_DIR) : path.join(ROOT, 'data', 'Chats');
const communications = require('./messages/communications')({
  wbRequest,
  tokenFor,
  cabinets,
  cachedAnalytics,
  analyticsCache,
  apiError,
  readJson,
  send,
  chatsDir: CHATS_DIR
});
// Раздел «Цены Сималенда» — отдельный модуль (sima-land.js), маршруты /api/sima/*: раз в час загружает оптовые цены
// Сималенда в отдельную Google Таблицу (google-sheets/sima-land) и держит копию их истории в data/Sima.
const simaLand = require('./sima/sima-land')({ send, apiError, readJson, root: ROOT });
// Оптовые цены Lenardi из загруженного отчёта xlsx (lenardi.js), маршруты /api/lenardi.
const lenardi = require('./sima/lenardi')({ send, apiError, readJson, root: ROOT });
// Раздел «Прибыль Сималенда» (sima-profit.js), маршрут /api/sima-profit: оптовые цены Сималенда и Lenardi против цен на WB.
const simaProfit = require('./sima/sima-profit')({
  send,
  apiError,
  readJson,
  cabinets,
  tokenFor,
  wbRequest,
  cachedAnalytics,
  analyticsCache,
  productCards,
  loadPriceGoods,
  cardPhoto,
  simaLand,
  lenardi,
  root: ROOT,
  pricesChanged: id => forgetList(`prices:${id}`)
});

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname.startsWith('/api/photo/')) return servePhoto(res, url);
  if (url.pathname.startsWith('/api/card') && (await contentCards.handle(req, res, url))) return;
  if (url.pathname.startsWith('/api/messages/') && (await communications.handle(req, res, url))) return;
  if (url.pathname.startsWith('/api/sima/') && (await simaLand.handle(req, res, url))) return;
  if (url.pathname.startsWith('/api/sima-profit') && (await simaProfit.handle(req, res, url))) return;
  if (url.pathname.startsWith('/api/lenardi') && (await lenardi.handle(req, res, url))) return;
  if (req.method === 'GET' && url.pathname === '/api/cabinets')
    return send(res, 200, { cabinets: publicCabinets(), demo: !cabinets().length });
  if (req.method === 'PATCH' && /^\/api\/cabinets\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    if (!cabinets().some(c => c.id === id)) throw apiError(404, 'Кабинет не найден');
    const { name } = await readJson(req);
    const clean = String(name || '')
      .trim()
      .slice(0, 60);
    if (!clean) throw apiError(400, 'Введите название кабинета');
    const aliases = readAliases();
    aliases[id] = clean;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(aliases, null, 2));
    return send(res, 200, { id, name: clean });
  }
  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    return send(
      res,
      200,
      await dashboard(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to'))
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/returns') {
    return send(
      res,
      200,
      await itemReturns(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to'))
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/ratings') {
    return send(
      res,
      200,
      await itemRatings(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to'))
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/orders/hourly') {
    return send(res, 200, await hourlyOrders(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'GET' && url.pathname === '/api/summary') {
    return send(
      res,
      200,
      await summary(
        url.searchParams.get('cabinet') || 'demo',
        url.searchParams.get('from'),
        url.searchParams.get('to'),
        url.searchParams.get('refresh') === '1'
      )
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/summary/ads') {
    return send(
      res,
      200,
      await summaryAds(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to'))
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign') {
    return send(
      res,
      200,
      await advertisingCampaign(
        url.searchParams.get('cabinet') || 'demo',
        url.searchParams.get('id'),
        url.searchParams.get('from'),
        url.searchParams.get('to')
      )
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign/positions') {
    return send(
      res,
      200,
      await campaignPositions(
        url.searchParams.get('cabinet') || 'demo',
        url.searchParams.get('id'),
        url.searchParams.get('from'),
        url.searchParams.get('to')
      )
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/keyword-tags') {
    return send(res, 200, keywordTags(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id')));
  }
  if (req.method === 'POST' && url.pathname === '/api/keyword-tags') {
    const body = await readJson(req);
    return send(res, 200, setKeywordTag(body.cabinet || 'demo', body.id, body));
  }
  if (req.method === 'GET' && url.pathname === '/api/product-detail') {
    return send(
      res,
      200,
      await productDetail(
        url.searchParams.get('cabinet') || 'demo',
        url.searchParams.get('nmId'),
        url.searchParams.get('from'),
        url.searchParams.get('to'),
        url.searchParams.get('live') === '1'
      )
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/sheet-history') {
    return send(
      res,
      200,
      await sheetHistory(
        url.searchParams.get('id'),
        url.searchParams.get('sections'),
        url.searchParams.get('days'),
        url.searchParams.get('source'),
        url.searchParams.get('all') === '1',
        url.searchParams.get('cabinet') || ''
      )
    );
  }
  if (req.method === 'POST' && url.pathname === '/api/advertising/campaign/rename') {
    const body = await readJson(req);
    return send(res, 200, await renameCampaign(body.cabinet || 'demo', body.id, body.name));
  }
  if (req.method === 'POST' && url.pathname === '/api/advertising/campaign/status') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите запуск или паузу кампании');
    return send(res, 200, await setCampaignStatus(body.cabinet || 'demo', body.id, body.action));
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign/budget') {
    return send(res, 200, await campaignBudget(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id')));
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/finance') {
    return send(res, 200, await adFinance(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'POST' && url.pathname === '/api/advertising/campaign/budget/deposit') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите пополнение бюджета');
    return send(res, 200, await depositCampaignBudget(body.cabinet || 'demo', body.id, body));
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign/zones') {
    return send(
      res,
      200,
      campaignZones(
        url.searchParams.get('cabinet') || 'demo',
        url.searchParams.get('id'),
        url.searchParams.get('from'),
        url.searchParams.get('to')
      )
    );
  }
  // Присылает расширение Chrome. Принимается только от расширения или с самого сайта: обычная страница в браузере
  // могла бы отправить сюда запрос без предварительной проверки CORS и подложить чужие цифры.
  if (req.method === 'POST' && url.pathname === '/api/advertising/campaign/zones') {
    const origin = String(req.headers.origin || '');
    if (origin && !origin.startsWith('chrome-extension://') && origin !== `http://${req.headers.host}`)
      throw apiError(403, 'Запрос не от расширения');
    return send(res, 200, await saveCampaignZones(await readJson(req, 30_000_000)));
  }
  if (req.method === 'POST' && url.pathname === '/api/advertising/campaign/placements') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите изменение мест показа');
    return send(res, 200, await setCampaignPlacements(body.cabinet || 'demo', body.id, body));
  }
  if (req.method === 'GET' && url.pathname === '/api/product-notes') {
    return send(res, 200, productNotes(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('nmId')));
  }
  if (req.method === 'POST' && url.pathname === '/api/product-notes') {
    const body = await readJson(req);
    return send(res, 200, setProductNote(body.cabinet || 'demo', body.nmId, body));
  }
  if (req.method === 'GET' && url.pathname === '/api/todos') {
    return send(res, 200, await todos());
  }
  if (req.method === 'POST' && url.pathname === '/api/todos') {
    return send(res, 200, saveTodo(await readJson(req)));
  }
  if (req.method === 'GET' && url.pathname === '/api/campaign-notes') {
    return send(res, 200, campaignNotes(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id')));
  }
  if (req.method === 'POST' && url.pathname === '/api/campaign-notes') {
    const body = await readJson(req);
    return send(res, 200, setCampaignNote(body.cabinet || 'demo', body.id, body));
  }
  if (req.method === 'POST' && url.pathname === '/api/keyword-tags/note') {
    const body = await readJson(req);
    return send(res, 200, setKeywordNote(body.cabinet || 'demo', body.id, body));
  }
  if (req.method === 'POST' && url.pathname === '/api/keyword-tags/colors') {
    const body = await readJson(req);
    return send(res, 200, setKeywordTagColors(body.colors));
  }
  if (req.method === 'POST' && url.pathname === '/api/advertising/campaign/keyword-daily') {
    const body = await readJson(req);
    return send(res, 200, await campaignKeywordDaily(body.cabinet || 'demo', body.id, body.from, body.to, body.query, body.nmIds));
  }
  if (req.method === 'POST' && url.pathname === '/api/advertising/campaign/minus') {
    const body = await readJson(req);
    const result = await campaignMinus(body.cabinet || 'demo', body.id, body.action, body.queries, body.nmIds);
    const changed = [...new Set(result.results.filter(item => item.ok && item.changed).flatMap(item => item.queries))];
    try {
      recordKeywordStatus(body.cabinet || 'demo', body.id, result.action, changed);
    } catch (error) {
      console.error('История статусов фраз не записалась:', error.message);
    }
    return send(res, 200, result);
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign/keywords') {
    return send(
      res,
      200,
      await campaignKeywords(
        url.searchParams.get('cabinet') || 'demo',
        url.searchParams.get('id'),
        url.searchParams.get('from'),
        url.searchParams.get('to'),
        url.searchParams.get('refresh') === '1'
      )
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign/previous') {
    return send(
      res,
      200,
      await advertisingCampaignPrevious(
        url.searchParams.get('cabinet') || 'demo',
        url.searchParams.get('id'),
        url.searchParams.get('from'),
        url.searchParams.get('to')
      )
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/campaign/history') {
    // Ответ идёт построчно: события прогресса, затем итог или ошибка.
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    const write = event => res.write(`${JSON.stringify(event)}\n`);
    try {
      const result = await advertisingCampaignHistory(
        url.searchParams.get('cabinet') || 'demo',
        url.searchParams.get('id'),
        url.searchParams.get('from'),
        url.searchParams.get('to'),
        write
      );
      let activity = null;
      try {
        activity = campaignActivity(
          result.campaign?.id ?? url.searchParams.get('id'),
          result.period,
          result.campaign?.daily,
          result.campaign?.status
        );
      } catch (error) {
        console.error('Детализация кампании: дни работы не посчитаны', error.message);
      }
      write({ type: 'result', ...result, activity });
    } catch (error) {
      write({ type: 'error', error: error.message || 'Не удалось выгрузить статистику' });
    }
    return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising/previous') {
    return send(
      res,
      200,
      await advertisingPrevious(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to'))
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/advertising') {
    return send(
      res,
      200,
      await advertising(
        url.searchParams.get('cabinet') || 'demo',
        url.searchParams.get('from'),
        url.searchParams.get('to'),
        url.searchParams.get('part') || 'all'
      )
    );
  }
  if (req.method === 'POST' && url.pathname === '/api/funnel/sales') {
    const body = await readJson(req);
    return send(res, 200, await funnelSales(body.cabinet || 'demo', body.from, body.to, body.nmIds, body.metric));
  }
  if (req.method === 'POST' && url.pathname === '/api/funnel/history') {
    const body = await readJson(req);
    return send(res, 200, await funnelHistory(body.cabinet || 'demo', body.from, body.to, body.grouping, body.nmIds, body.live === true));
  }
  if (req.method === 'POST' && url.pathname === '/api/funnel/refetch') {
    const body = await readJson(req);
    return send(res, 200, refetchFunnel(body.cabinet || 'demo', body.from, body.to, body.grouping));
  }
  if (req.method === 'GET' && url.pathname === '/api/funnel/history') {
    return send(
      res,
      200,
      await funnelHistory(
        url.searchParams.get('cabinet') || 'demo',
        url.searchParams.get('from'),
        url.searchParams.get('to'),
        url.searchParams.get('grouping')
      )
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/funnel/orders') {
    return send(
      res,
      200,
      await funnelOrders(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to'))
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/funnel') {
    return send(
      res,
      200,
      await funnelTable(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('from'), url.searchParams.get('to'), {
        version: url.searchParams.get('version') || '',
        offset: url.searchParams.get('offset'),
        force: url.searchParams.get('force') === '1'
      })
    );
  }
  if (req.method === 'GET' && url.pathname === '/api/fbs-stocks') {
    return send(res, 200, await fbsStocks(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('force') === '1'));
  }
  if (req.method === 'GET' && url.pathname === '/api/fbw-stocks') {
    return send(res, 200, await fbwStocks(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('force') === '1'));
  }
  if (req.method === 'GET' && url.pathname === '/api/prices') {
    return send(res, 200, await prices(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('force') === '1'));
  }
  if (req.method === 'GET' && url.pathname === '/api/prices/stocks') {
    return send(res, 200, await priceStocks(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'POST' && url.pathname === '/api/prices/update') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите изменение цен и скидок');
    return send(res, 200, await updatePrices(body));
  }
  if (req.method === 'GET' && url.pathname === '/api/stock-presets') {
    return send(res, 200, { presets: cabinetPresets(STOCK_PRESETS_FILE, url.searchParams.get('cabinet') || 'demo') });
  }
  if (req.method === 'POST' && url.pathname === '/api/stock-presets') {
    const body = await readJson(req);
    return send(res, 200, savePreset(STOCK_PRESETS_FILE, body.cabinet, body.preset, normalizeStockPreset));
  }
  if (req.method === 'DELETE' && url.pathname === '/api/stock-presets') {
    return send(res, 200, removePreset(STOCK_PRESETS_FILE, url.searchParams.get('cabinet') || '', url.searchParams.get('id') || ''));
  }
  if (req.method === 'GET' && url.pathname === '/api/price-presets') {
    return send(res, 200, { presets: cabinetPresets(PRICE_PRESETS_FILE, url.searchParams.get('cabinet') || 'demo') });
  }
  if (req.method === 'POST' && url.pathname === '/api/price-presets') {
    const body = await readJson(req);
    return send(res, 200, savePreset(PRICE_PRESETS_FILE, body.cabinet, body.preset, normalizePricePreset));
  }
  if (req.method === 'DELETE' && url.pathname === '/api/price-presets') {
    return send(res, 200, removePreset(PRICE_PRESETS_FILE, url.searchParams.get('cabinet') || '', url.searchParams.get('id') || ''));
  }
  if (req.method === 'POST' && url.pathname === '/api/fbs-stocks/update') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите изменение остатков');
    return send(res, 200, await updateFbsStocks(body));
  }
  if (req.method === 'GET' && url.pathname === '/api/fbs-stocks/products') {
    return send(res, 200, await fbsStockProducts(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'POST' && url.pathname === '/api/fbs-stocks/add') {
    const body = await readJson(req, 5_000_000);
    if (!body.confirm) throw apiError(400, 'Подтвердите добавление остатков');
    return send(res, 200, await addFbsStocks(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/fbs-stocks/copy') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите копирование остатков');
    return send(res, 200, await copyFbsStocks(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/orders/stickers') {
    return send(res, 200, await orderStickers(await readJson(req)));
  }
  if (req.method === 'GET' && url.pathname === '/api/fbs-orders') {
    return send(res, 200, await newFbsOrders(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'GET' && url.pathname === '/api/supplies') {
    return send(res, 200, await supplyList(url.searchParams.get('cabinet') || 'demo'));
  }
  if (req.method === 'GET' && url.pathname === '/api/supplies/detail') {
    return send(res, 200, await supplyDetails(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id')));
  }
  if (req.method === 'GET' && url.pathname === '/api/supplies/barcode') {
    return send(
      res,
      200,
      await supplyBarcode(url.searchParams.get('cabinet') || 'demo', url.searchParams.get('id'), url.searchParams.get('type'))
    );
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите создание поставки');
    return send(res, 200, await createSupply(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/delete') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите удаление поставки');
    return send(res, 200, await deleteSupply(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/deliver') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите передачу поставки в доставку');
    return send(res, 200, await deliverSupply(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/orders') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите сборку заданий');
    return send(res, 200, await assembleOrders(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/trbx') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите добавление грузомест');
    return send(res, 200, await createTrbx(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/trbx/delete') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите удаление грузомест');
    return send(res, 200, await deleteTrbx(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/trbx/orders') {
    const body = await readJson(req);
    if (!body.confirm) throw apiError(400, 'Подтвердите раскладку заданий по грузоместам');
    return send(res, 200, await fillTrbx(body));
  }
  if (req.method === 'POST' && url.pathname === '/api/supplies/trbx/stickers') {
    return send(res, 200, await trbxStickers(await readJson(req)));
  }
  throw apiError(404, 'Метод сайта не найден');
}

module.exports = { handleApi, simaLand };
