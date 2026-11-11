// --- Раздел «Прибыль Сималенда»: оптовые цены Сималенда против цен товаров на WB ---
// Как таблица «Артикулы … с логистикой.xlsx»: по каждому товару кабинета, у которого артикул продавца начинается
// с артикула Сималенда (6938164/125/ШДФ → 6938164), — цена на WB, комиссия, налог, сборка, логистика, закупка
// по оптовой цене Сималенда, чистая прибыль и цена, при которой прибыль будет желаемой. Сервер отдаёт исходные
// данные, расчёт — на странице (public/sima-profit.js), чтобы желаемая прибыль, налог и сборка менялись сразу.
// Источники:
//   - карточки кабинета (productCards): предмет, размеры упаковки → объём в литрах, фото, название;
//   - цены WB: GET /api/v2/list/goods/filter (loadPriceGoods) — цена со скидкой продавца первого размера
//     (discountedPrice), как колонка «Цена WB» таблицы;
//   - комиссия: GET https://common-api.wildberries.ru/api/v1/tariffs/commission?locale=ru, поле kgvpMarketplace —
//     комиссия по модели «Маркетплейс» (FBS), %, по subjectID. Лимит — 1 запрос в минуту (всплеск 2), токен любой
//     категории; хранится 6 часов. Сверено 11.11.2026: совпадает с колонкой «Комиссия» таблицы у всех 10 419 товаров;
//   - логистика: GET https://common-api.wildberries.ru/api/v1/tariffs/box?date=ГГГГ-ММ-ДД, склад «Свой склад РФ»:
//     boxDeliveryMarketplaceBase — первый литр, boxDeliveryMarketplaceLiter — каждый следующий, ₽ (коэффициент склада
//     boxDeliveryMarketplaceCoefExpr, %, уже учтён). Числа приходят строками с запятой ("78,2"), «-» — нет тарифа.
//     Лимит — 60 запросов в минуту; хранится 6 часов. Товары до литра WB считает по ступеням, их в API нет —
//     SMALL_LITERS (из таблицы), умножаются на коэффициент склада;
//   - цены Сималенда — последняя загрузка модуля sima-land.js (data/Sima/prices.json).
// Маршрут: GET /api/sima-profit?cabinet=ID[&force=1] — force заново берёт цены WB.
'use strict';

const TARIFF_TTL = 6 * 60 * 60_000;
// Логистика товаров до литра включительно: [до скольких литров, ₽ при коэффициенте 100%].
const SMALL_LITERS = [[0.2, 23], [0.4, 26], [0.6, 29], [0.8, 30], [1, 32]];
// Если тарифы WB не пришли: «Свой склад РФ» на 11.11.2026.
const FALLBACK_TARIFF = { base: 78.2, liter: 23.8, coef: 170 };
const WAREHOUSE = 'Свой склад РФ';

// Артикул Сималенда из артикула продавца: число в начале, дальше «/» или конец.
const simaSid = vendorCode => String(vendorCode || '').trim().match(/^(\d{4,10})(?:\/|$)/)?.[1] || '';
const tariffNumber = value => { const number = Number(String(value ?? '').replace(',', '.').replace(/\s/g, '')); return Number.isFinite(number) && String(value ?? '').trim() !== '' ? number : null; };
// Тариф склада из ответа /api/v1/tariffs/box; null — склада нет или тарифов у него нет.
function boxTariff(response, warehouse = WAREHOUSE) {
  const list = response?.response?.data?.warehouseList || [];
  const item = list.find(row => String(row.warehouseName || '').trim() === warehouse);
  const tariff = item && { base: tariffNumber(item.boxDeliveryMarketplaceBase), liter: tariffNumber(item.boxDeliveryMarketplaceLiter), coef: tariffNumber(item.boxDeliveryMarketplaceCoefExpr) };
  return tariff && tariff.base != null && tariff.liter != null && tariff.coef != null ? tariff : null;
}
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? round(Number(value)) : null;

// Строки раздела: товары с артикулом Сималенда и всё, что нужно для расчёта.
function profitRows(cards = [], goods = [], commission = [], sima = null, photo = () => '') {
  const prices = new Map(goods.map(good => [String(good.nmID), good]));
  const fees = new Map(commission.map(item => [Number(item.subjectID), item]));
  const listed = new Set((sima?.sids || []).map(String)), failed = new Set((sima?.failed || []).map(String)), found = sima?.found || {};
  const rows = [];
  for (const card of cards) {
    const sid = simaSid(card.vendorCode);
    if (!sid) continue;
    const good = prices.get(String(card.nmID)), size = good?.sizes?.[0] || {}, fee = fees.get(Number(card.subjectID));
    const d = card.dimensions || {}, volume = d.length * d.width * d.height / 1000;
    const item = found[sid];
    const status = item ? (positive(item.wholesale_price) || positive(item.price) ? 'ok' : 'noPrice') : !sima ? 'notLoaded' : failed.has(sid) ? 'failed' : listed.has(sid) ? 'missing' : 'notListed';
    const balance = item?.balance ?? null;
    rows.push({ nmId: Number(card.nmID), name: card.title || `Товар ${card.nmID}`, photo: photo(card), subject: card.subjectName || '', vendorCode: card.vendorCode || '', sid,
      price: positive(size.discountedPrice ?? good?.discountedPrice), commission: Number.isFinite(Number(fee?.kgvpMarketplace)) ? Number(fee.kgvpMarketplace) : null,
      volume: Number.isFinite(volume) && volume > 0 ? round(volume, 3) : null,
      sima: { status, name: item?.name || '', wholesale: positive(item?.wholesale_price), retail: positive(item?.price), inStock: balance === null ? (item?.isEnough ? true : null) : balance > 0 } });
  }
  return rows;
}

module.exports = function createSimaProfit({ send, apiError, cabinets, tokenFor, wbRequest, cachedAnalytics, analyticsCache, productCards, loadPriceGoods, cardPhoto, simaLand, today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10) }) {
  async function profit(id, force = false) {
    if (id === 'demo' || !cabinets().length) return { demo: true, configured: simaLand.configured(), rows: [], warnings: [], tariff: { ...FALLBACK_TARIFF, small: SMALL_LITERS, warehouse: WAREHOUSE } };
    const token = tokenFor(id), warnings = [];
    if (force) analyticsCache.delete(`sima-profit:goods:${id}`);
    const [cards, goods, commission, box] = await Promise.all([
      productCards(id, token),
      cachedAnalytics(`sima-profit:goods:${id}`, () => loadPriceGoods(token), 60_000),
      cachedAnalytics(`sima-profit:commission:${id}`, async () => (await wbRequest(token, 'https://common-api.wildberries.ru/api/v1/tariffs/commission?locale=ru'))?.report || [], TARIFF_TTL)
        .catch(error => { warnings.push(`Комиссии WB не загрузились: ${error.message}`); return []; }),
      cachedAnalytics(`sima-profit:box:${id}`, () => wbRequest(token, `https://common-api.wildberries.ru/api/v1/tariffs/box?date=${today()}`), TARIFF_TTL)
        .catch(error => { warnings.push(`Тарифы логистики WB не загрузились: ${error.message}`); return null; })
    ]);
    let tariff = boxTariff(box);
    if (!tariff) {
      if (box) warnings.push(`В тарифах WB нет склада «${WAREHOUSE}»`);
      warnings.push(`Логистика посчитана по тарифу ${String(FALLBACK_TARIFF.base).replace('.', ',')} ₽ за первый литр и ${String(FALLBACK_TARIFF.liter).replace('.', ',')} ₽ за следующий`);
      tariff = FALLBACK_TARIFF;
    }
    const sima = simaLand.prices();
    return { demo: false, configured: simaLand.configured(), rows: profitRows(cards, goods, commission, sima, cardPhoto), cards: cards.length,
      simaAt: sima?.at || null, simaArticles: sima?.sids?.length || 0, simaRefreshing: simaLand.refreshing(), tariff: { ...tariff, small: SMALL_LITERS, warehouse: WAREHOUSE }, warnings };
  }
  async function handle(req, res, target) {
    if (req.method === 'GET' && target.pathname === '/api/sima-profit') {
      send(res, 200, await profit(target.searchParams.get('cabinet') || 'demo', target.searchParams.get('force') === '1'));
      return true;
    }
    if (target.pathname.startsWith('/api/sima-profit')) throw apiError(404, 'Нет такого метода');
    return false;
  }
  return { handle, profit };
};
module.exports.simaSid = simaSid;
module.exports.boxTariff = boxTariff;
module.exports.profitRows = profitRows;
