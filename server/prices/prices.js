'use strict';
// --- Цены и скидки: список цен товаров, изменение цены и скидки, остатки у цен.
const { apiError, cabinets, tokenFor, wait, wbRequest } = require('../core/base');
const { cardPhoto } = require('../core/photos');
const { cardsSoFar, forgetList, progressiveList } = require('../core/lists');
const { inventoryReport, summarizeStockTotals } = require('../stocks/stocks');

async function priceStocks(id) {
  if (id === 'demo' || !cabinets().length) {
    return {
      demo: true,
      byNmId: summarizeStockTotals(
        [
          { nmId: 100001, quantity: 57 },
          { nmId: 100002, quantity: 12 }
        ],
        [
          { nmId: 100001, quantity: 42 },
          { nmId: 100001, quantity: 15 },
          { nmId: 100002, quantity: 8 }
        ]
      ),
      warnings: []
    };
  }
  const token = tokenFor(id);
  const warnings = [];
  const wb = await inventoryReport(id, token, 'wb-warehouses').catch(error => {
    warnings.push(`Остатки на складах WB: ${error.message}`);
    return null;
  });
  const seller = await inventoryReport(id, token, 'seller-warehouses').catch(error => {
    warnings.push(`Остатки на складах продавца: ${error.message}`);
    return null;
  });
  if (!wb && !seller) throw apiError(502, warnings.join('; '));
  return { demo: false, updatedAt: new Date().toISOString(), byNmId: summarizeStockTotals(wb || [], seller || []), warnings };
}

function normalizePrices(goods = [], cards = []) {
  const byNmId = new Map(cards.map(card => [String(card.nmID), card]));
  const rows = goods.map(good => {
    const card = byNmId.get(String(good.nmID)) || {};
    const sizes = Array.isArray(good.sizes) ? good.sizes : [];
    const firstSize = sizes[0] || {};
    return {
      nmId: Number(good.nmID),
      vendorCode: good.vendorCode || card.vendorCode || '',
      name: card.title || `Товар ${good.nmID}`,
      photo: cardPhoto(card),
      category: card.subjectName || 'Без категории',
      brand: card.brand || 'Без бренда',
      // Дата создания карточки (createdAt из списка карточек); пока карточки догружаются — пусто.
      createdAt: card.createdAt || '',
      currency: good.currencyIsoCode4217 || 'RUB',
      price: Number(firstSize.price || good.price || 0),
      discountedPrice: Number(firstSize.discountedPrice || good.discountedPrice || 0),
      clubDiscountedPrice: Number(firstSize.clubDiscountedPrice || good.clubDiscountedPrice || 0),
      discount: Number(good.discount || 0),
      clubDiscount: Number(good.clubDiscount || 0),
      sizes: sizes.length,
      sizeItems: sizes
        .map(size => ({ sizeId: Number(size.sizeID), name: size.techSizeName || '' }))
        .filter(size => Number.isInteger(size.sizeId)),
      editableSizePrice: Boolean(good.editableSizePrice),
      isBadTurnover: Boolean(good.isBadTurnover)
    };
  });
  const categories = [...new Set(rows.map(row => row.category))].sort((a, b) => a.localeCompare(b, 'ru'));
  const brands = [...new Set(rows.map(row => row.brand))].sort((a, b) => a.localeCompare(b, 'ru'));
  return {
    rows,
    categories,
    brands,
    totals: {
      products: rows.length,
      averagePrice: rows.length ? rows.reduce((sum, row) => sum + row.price, 0) / rows.length : 0,
      averageDiscount: rows.length ? rows.reduce((sum, row) => sum + row.discount, 0) / rows.length : 0,
      discounted: rows.filter(row => row.discount > 0).length,
      badTurnover: rows.filter(row => row.isBadTurnover).length
    }
  };
}

function demoPrices() {
  const cards = [
    { nmID: 100001, vendorCode: 'TSHIRT-BLACK', title: 'Футболка базовая', subjectName: 'Одежда', brand: 'WB Pulse' },
    { nmID: 100002, vendorCode: 'MUG-THERMO', title: 'Термокружка', subjectName: 'Посуда', brand: 'Home' }
  ];
  const goods = [
    {
      nmID: 100001,
      vendorCode: 'TSHIRT-BLACK',
      currencyIsoCode4217: 'RUB',
      discount: 20,
      clubDiscount: 5,
      sizes: [{ price: 1990, discountedPrice: 1592, clubDiscountedPrice: 1512 }]
    },
    {
      nmID: 100002,
      vendorCode: 'MUG-THERMO',
      currencyIsoCode4217: 'RUB',
      discount: 10,
      clubDiscount: 0,
      sizes: [{ price: 1290, discountedPrice: 1161, clubDiscountedPrice: 1161 }]
    }
  ];
  return { demo: true, ...normalizePrices(goods, cards), warnings: [] };
}

// Цены и скидки всех товаров кабинета — для таблицы цен: GET /api/v2/list/goods/filter по 1000 (лимит категории
// «Цены и скидки» — 10 запросов за 6 секунд). onBatch — каждая пришедшая порция (для показа по ходу).
async function loadPriceGoods(token, onBatch = () => {}) {
  const goods = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const response = await wbRequest(
      token,
      `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=${offset}`
    );
    const batch = Array.isArray(response?.data?.listGoods) ? response.data.listGoods : [];
    goods.push(...batch);
    onBatch(goods);
    if (batch.length < 1000) break;
    await wait(650);
  }
  return goods;
}

// Цены приходят быстро, карточки (названия, фото, предмет, бренд) — долго: строки показываются сразу, а названия
// и фото подставляются по мере загрузки карточек.
async function prices(id, force = false) {
  if (id === 'demo' || !cabinets().length) return demoPrices();
  const token = tokenFor(id);
  return progressiveList(`prices:${id}`, 30_000, force, async publish => {
    const warnings = [],
      cards = cardsSoFar(id, token, warnings);
    let goods = [];
    const snapshot = () => ({
      demo: false,
      ...normalizePrices(goods, cards.cards()),
      warnings: [...warnings],
      progress: { loaded: goods.length, cardsLoading: cards.loading() }
    });
    goods = await loadPriceGoods(token, list => {
      goods = list;
      publish(snapshot);
    });
    publish(snapshot);
    await cards.done;
    return snapshot();
  });
}

async function updatePrices(body) {
  const token = tokenFor(body.cabinet);
  const items = (body.items || [])
    .map(item => ({
      nmID: Number(item.nmId),
      price: Number(item.price),
      discount: Number(item.discount),
      editableSizePrice: Boolean(item.editableSizePrice),
      sizeItems: Array.isArray(item.sizeItems) ? item.sizeItems : []
    }))
    .filter(
      item =>
        Number.isInteger(item.nmID) &&
        Number.isFinite(item.price) &&
        item.price > 0 &&
        Number.isInteger(item.discount) &&
        item.discount >= 0 &&
        item.discount <= 99
    );
  if (!items.length) throw apiError(400, 'Выберите товары и укажите корректные цену и скидку');
  const data = items.map(item =>
    item.editableSizePrice ? { nmID: item.nmID, discount: item.discount } : { nmID: item.nmID, price: item.price, discount: item.discount }
  );
  const sizeData = items
    .filter(item => item.editableSizePrice)
    .flatMap(item =>
      item.sizeItems
        .map(size => ({ nmID: item.nmID, sizeID: Number(size.sizeId), price: item.price }))
        .filter(size => Number.isInteger(size.sizeID))
    );
  const uploads = [];
  for (let offset = 0; offset < data.length; offset += 1000) {
    if (offset) await wait(650);
    uploads.push(
      await wbRequest(token, 'https://discounts-prices-api.wildberries.ru/api/v2/upload/task', {
        method: 'POST',
        body: { data: data.slice(offset, offset + 1000) }
      })
    );
  }
  for (let offset = 0; offset < sizeData.length; offset += 1000) {
    await wait(650);
    uploads.push(
      await wbRequest(token, 'https://discounts-prices-api.wildberries.ru/api/v2/upload/task/size', {
        method: 'POST',
        body: { data: sizeData.slice(offset, offset + 1000) }
      })
    );
  }
  forgetList(`prices:${body.cabinet}`);
  return { ok: true, updated: items.length, updatedSizes: sizeData.length, uploads };
}

module.exports = { loadPriceGoods, normalizePrices, priceStocks, prices, updatePrices };
