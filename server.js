'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { PORT, ROOT, WB_HOSTS, datesBetween, safeFolderName, send } = require('./server/core/base');
const { loadProductCards } = require('./server/core/product-cards');
const { localPhoto } = require('./server/core/photos');
const { normalizeFbsStocks, normalizeFbwStocks, readBackFbsStocks, summarizeStockTotals } = require('./server/stocks/stocks');
const { normalizePricePreset, normalizeStockPreset } = require('./server/stocks/presets');
const { normalizePrices } = require('./server/prices/prices');
const { enrichOrders, normalizeOrderFeed, normalizeOrders, orderFeedPeriod, summarizeHourlyOrders } = require('./server/orders/orders');
const { chunkOrders, normalizeNewOrders, normalizeTrbxes, stickerType, summarizeSupplies } = require('./server/orders/fbs-orders');
const {
  campaignProductDaily,
  extractFunnel,
  historyChunks,
  historyPeriod,
  planAdFetch,
  summarizeAdStats,
  summarizeKeywordDaily,
  summarizePositionDaily,
  validAdPeriod,
  withAdBudgets
} = require('./server/ads/stats');
const { archivedPresetsFromError, mergeMinusList, minusPlan, summarizeKeywords } = require('./server/ads/keywords');
const {
  adCampaignMayHaveStats,
  campaignActivePeriod,
  campaignZones,
  depositCampaignBudget,
  mergeCampaignZones,
  setCampaignPlacements,
  setCampaignStatus,
  wbErrorText
} = require('./server/ads/campaign');
const {
  funnelDaysToFetch,
  funnelOrdersByNmId,
  funnelPeriods,
  funnelRangeBuckets,
  funnelRangeValues,
  funnelRecordCounts,
  funnelSalesMatrix,
  funnelTableFresh,
  pairFunnelDays,
  slimFunnelProduct
} = require('./server/funnel/funnel');
const { summaryDrops, summaryProducts, summaryTopProducts } = require('./server/funnel/summary');
const { productAdDays, productCampaignTimeline, productDetailPeriod } = require('./server/product/product');
const {
  SHEET_SYNC_EVERY,
  mergeSheetRows,
  readSheetHistory,
  saveSheetCurrent,
  saveSheetRows,
  sheetCabinetFilter,
  sheetCabinetSince,
  sheetConfigured,
  sheetSiteCabinet,
  splitSheetByCabinet,
  syncSheet,
  syncSheetOrders,
  withoutClubPriceRepeats
} = require('./server/sheet/sheet');
const { todoFields, todoNmId } = require('./server/todo/todo');
const { itemRatingPeriods, normalizeItemRatings } = require('./server/ratings/ratings');
const { itemReturnsPeriod, normalizeItemReturns, returnStatusGroup } = require('./server/returns/returns');
const { handleApi, simaLand } = require('./server/routes');

const PUBLIC_DIR = path.join(ROOT, 'public');
function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.resolve(PUBLIC_DIR, '.' + decodeURIComponent(requested));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
  };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${url.pathname}: ${error.message}`);
    send(res, error.status || 500, { error: error.message || 'Внутренняя ошибка', details: error.details });
  }
});

if (require.main === module)
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`WB Analytics: http://127.0.0.1:${PORT}`);
    // Копия Google Таблицы на компьютере: старая раскладка — по кабинетам, дозагрузка вскоре после запуска и дальше раз в час.
    // Заказы — отдельной дозагрузкой (лист «Заказы»), чтобы окна истории её не ждали.
    splitSheetByCabinet();
    if (sheetConfigured()) {
      setTimeout(syncSheet, 20_000);
      setInterval(syncSheet, SHEET_SYNC_EVERY);
      setTimeout(syncSheetOrders, 60_000);
      setInterval(syncSheetOrders, SHEET_SYNC_EVERY);
    }
    simaLand.start();
  });

module.exports = {
  server,
  wbErrorText,
  loadProductCards,
  readBackFbsStocks,
  depositCampaignBudget,
  mergeCampaignZones,
  campaignZones,
  setCampaignStatus,
  setCampaignPlacements,
  slimFunnelProduct,
  funnelTableFresh,
  campaignActivePeriod,
  productCampaignTimeline,
  mergeSheetRows,
  saveSheetRows,
  saveSheetCurrent,
  readSheetHistory,
  sheetCabinetSince,
  sheetSiteCabinet,
  sheetCabinetFilter,
  withoutClubPriceRepeats,
  mergeMinusList,
  minusPlan,
  archivedPresetsFromError,
  todoNmId,
  todoFields,
  productAdDays,
  productDetailPeriod,
  funnelOrdersByNmId,
  summarizeHourlyOrders,
  orderFeedPeriod,
  itemRatingPeriods,
  normalizeItemRatings,
  itemReturnsPeriod,
  normalizeItemReturns,
  returnStatusGroup,
  summarizeKeywordDaily,
  summarizePositionDaily,
  normalizeOrders,
  normalizeOrderFeed,
  enrichOrders,
  extractFunnel,
  summarizeAdStats,
  campaignProductDaily,
  withAdBudgets,
  summarizeKeywords,
  normalizeStockPreset,
  normalizePricePreset,
  adCampaignMayHaveStats,
  validAdPeriod,
  historyPeriod,
  historyChunks,
  planAdFetch,
  datesBetween,
  safeFolderName,
  funnelDaysToFetch,
  pairFunnelDays,
  funnelPeriods,
  funnelRangeBuckets,
  funnelRecordCounts,
  funnelRangeValues,
  funnelSalesMatrix,
  summaryTopProducts,
  summaryDrops,
  summaryProducts,
  normalizeFbsStocks,
  normalizeFbwStocks,
  normalizePrices,
  summarizeStockTotals,
  normalizeNewOrders,
  summarizeSupplies,
  normalizeTrbxes,
  chunkOrders,
  stickerType,
  localPhoto,
  WB_HOSTS
};
