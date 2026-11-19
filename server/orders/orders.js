'use strict';
// --- Лента заказов: заказы за период, заказы по часам, баланс продавца, сводка для главной.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, addDays, apiError, cabinets, cachedAnalytics, dateDaysAgo, moscowDate, tokenFor, wbRequest } = require('../core/base');
const { productCards } = require('../core/product-cards');
const { cardPhoto } = require('../core/photos');
const { extractFunnel } = require('../ads/stats');

const BALANCE_HISTORY_FILE = path.join(ROOT, 'data', 'balance-history.json');
const ORDER_FEED_LIMIT = 10_000;
function readBalanceHistory() {
  try {
    return JSON.parse(fs.readFileSync(BALANCE_HISTORY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveBalanceSnapshot(cabinetId, balance) {
  const history = readBalanceHistory();
  const list = Array.isArray(history[cabinetId]) ? history[cabinetId] : [];
  const current = Number(balance?.current || 0);
  const forWithdraw = Number(balance?.for_withdraw || 0);
  const previous = list[0];
  if (!previous || previous.current !== current || previous.forWithdraw !== forWithdraw || previous.currency !== balance.currency) {
    list.unshift({
      timestamp: new Date().toISOString(),
      currency: balance.currency || 'RUB',
      current,
      forWithdraw,
      delta: previous ? current - previous.current : 0,
      withdrawDelta: previous ? forWithdraw - previous.forWithdraw : 0
    });
    history[cabinetId] = list.slice(0, 20);
    fs.mkdirSync(path.dirname(BALANCE_HISTORY_FILE), { recursive: true });
    fs.writeFileSync(BALANCE_HISTORY_FILE, JSON.stringify(history, null, 2));
  }
  return history[cabinetId] || list;
}

function enrichOrders(orders, cards) {
  const byNmId = new Map((cards || []).map(card => [String(card.nmID), card]));
  return orders.map(order => {
    const card = byNmId.get(String(order.nmId));
    if (!card) return order;
    const size = (card.sizes || []).find(item => String(item.chrtID || item.chrtId) === String(order.chrtId)) || card.sizes?.[0];
    return {
      ...order,
      name: card.title || order.name,
      article: card.vendorCode || order.article,
      barcode: size?.skus?.[0] || '',
      brand: card.brand || '',
      subjectName: card.subjectName || '',
      photo: cardPhoto(card)
    };
  });
}

function demoDashboard() {
  const now = Date.now();
  const statuses = ['new', 'confirm', 'complete', 'cancel'];
  const names = ['Футболка базовая', 'Кроссовки Urban', 'Набор полотенец', 'Худи Oversize', 'Термокружка'];
  const orders = Array.from({ length: 18 }, (_, index) => ({
    id: 88422000 + index,
    nmId: 17540000 + (index % 5),
    article: `WB-${1200 + index}`,
    name: names[index % names.length],
    status: statuses[index % statuses.length],
    createdAt: new Date(now - index * 3_600_000).toISOString(),
    price: 129900 + (index % 5) * 45000,
    currencyCode: 643,
    warehouse: ['Коледино', 'Казань', 'Электросталь'][index % 3],
    source: index < 6 ? 'FBS' : 'Статистика'
  }));
  return {
    demo: true,
    orders,
    funnel: { views: 14840, cart: 3180, orders: 1246, sales: 982, revenue: 1762400, currency: 'RUB' },
    funnelProducts: [],
    funnelHistory: [],
    funnelGroupedHistory: [],
    warnings: []
  };
}

function currencyCode(currency) {
  return { RUB: 643, BYN: 933, KZT: 398, AMD: 51, KGS: 417, UZS: 860 }[currency] || 643;
}

function normalizeOrderFeed(payload) {
  const data = payload?.data || payload || {};
  const code = currencyCode(data.currency);
  return (data.orders || []).map(order => ({
    id: order.srid,
    nmId: order.nmId,
    chrtId: order.chrtId,
    article: `chrtID ${order.chrtId}`,
    name: `Товар WB ${order.nmId}`,
    status:
      order.status === 'buyout'
        ? 'complete'
        : order.status === 'cancel'
          ? 'cancel'
          : ['return', 'returnDefective'].includes(order.status)
            ? 'return'
            : 'new',
    rawStatus: order.status,
    cancelType: order.cancelType,
    createdAt: order.updatedAt || order.createdAt,
    orderedAt: order.createdAt,
    price: Math.round(Number(order.sellerPrice || 0) * 100),
    currencyCode: code,
    warehouse: order.warehouseName || '—',
    warehouseRegion: order.warehouseRegion,
    destinationCity: order.destinationCity,
    destinationDistrict: order.destinationDistrict,
    isMp: Boolean(order.isMp),
    isB2b: Boolean(order.isB2b),
    source: 'Лента WB'
  }));
}

// Строки ленты — только события «Ленты заказов» WB: у них есть склад отгрузки и город покупателя.
// Новое FBS-задание — тот же заказ (rid задания = srid события), поэтому отдельной строкой не идёт; от него берётся только
// сумма покупателя с учётом СПП (buyerPrice). Задания, которых ещё нет в ленте, видны в разделе «Новые заказы».
function normalizeOrders(fbs, orderFeed) {
  const tasks = new Map((fbs?.orders || []).filter(o => o.rid).map(o => [String(o.rid), o]));
  return normalizeOrderFeed(orderFeed)
    .map(order => {
      const task = tasks.get(String(order.id));
      if (!task) return order;
      // Сумма покупателя — в валюте продавца; если валюта события другая, не показываем её, чтобы не сравнивать разные валюты.
      const buyerPrice = task.convertedFinalPrice ?? task.finalPrice;
      const sameCurrency =
        !task.convertedCurrencyCode || !order.currencyCode || String(task.convertedCurrencyCode) === String(order.currencyCode);
      return buyerPrice != null && sameCurrency ? { ...order, buyerPrice } : order;
    })
    .sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
}

// --- Лента заказов WB: один общий запрос на кабинет ---
// WB отдаёт ленту не чаще 1 раза в минуту на аккаунт и максимум за последние 31 день. Поэтому и список заказов,
// и график по часам берут данные из одного запроса за 31 день (кэш 90 сек): повторный запрос раньше минуты
// не отправляется, а при отказе WB отдаются последние полученные данные.
const ORDER_FEED_INTERVAL = 61_000;
const orderFeedAttempts = new Map();
async function orderFeedMonth(id, token) {
  const today = moscowDate();
  return cachedAnalytics(
    `order-feed-31:${id}`,
    async () => {
      const wait = ORDER_FEED_INTERVAL - (Date.now() - (orderFeedAttempts.get(id) || 0));
      if (wait > 0) throw apiError(429, `WB отдаёт ленту заказов не чаще 1 раза в минуту — повторите через ${Math.ceil(wait / 1000)} сек`);
      orderFeedAttempts.set(id, Date.now());
      try {
        const feed = await wbRequest(token, 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/order-feed', {
          method: 'POST',
          body: {
            // Без пагинации WB отдаёт только 50 последних событий, поэтому запрашиваем максимум за один раз.
            selectedPeriod: { start: `${addDays(today, -30)}T00:00:00Z`, end: `${today}T23:59:59Z` },
            pagination: { limit: ORDER_FEED_LIMIT }
          }
        });
        return { feed, fetchedAt: new Date().toISOString() };
      } catch (error) {
        if (error.status === 429)
          throw apiError(429, `WB ограничил частоту запросов ленты заказов (1 в минуту) — повторите через ${error.retryAfter || 60} сек`);
        throw error;
      }
    },
    90_000
  );
}
// Период списка заказов — по времени текущего статуса события, как фильтрует сам WB.
function orderFeedPeriod(feed, from, to) {
  const start = Date.parse(`${from}T00:00:00Z`),
    end = Date.parse(`${to}T23:59:59Z`);
  const orders = (feed?.data?.orders || []).filter(order => {
    const at = Date.parse(order.updatedAt || order.createdAt);
    return at >= start && at <= end;
  });
  return { ...feed, data: { ...(feed?.data || {}), orders } };
}

// --- Заказы по часам (Лента заказов): сегодня и 7 предыдущих дней по местному времени владельца ---
// Время графика — Душанбе (UTC+5, без перехода на летнее время), на 2 часа больше московского.
// Сутки, «сегодня» и «к этому времени» тоже считаются по Душанбе.
const HOURLY_DAYS = 8;
const HOURLY_TIMEZONE = { name: 'Asia/Dushanbe', label: 'Душанбе', offsetHours: 5 };
// Каждый заказ (srid) считается один раз — по времени оформления; отменённые и возвращённые тоже, как в заказах WB.
// Выкуп — событие со статусом «выкуплен», по времени этого статуса (когда покупатель забрал товар).
// byNow — заказы и выкупы дня до того же времени суток, что сейчас: честное сравнение «к этому часу».
// offsetHours — сдвиг часового пояса от UTC: 5 — Душанбе, 3 — Москва.
function summarizeHourlyOrders(orders = [], today, nowMinutes, offsetHours = HOURLY_TIMEZONE.offsetHours) {
  const dates = Array.from({ length: HOURLY_DAYS }, (_, index) => addDays(today, index - HOURLY_DAYS + 1));
  const empty = () => ({ count: 0, sum: 0, buyoutCount: 0, buyoutSum: 0 });
  const days = new Map(dates.map(date => [date, { date, hours: Array.from({ length: 24 }, empty), byNow: empty() }]));
  const place = time => {
    const at = new Date(time);
    if (Number.isNaN(at.getTime())) return null;
    const local = new Date(at.getTime() + offsetHours * 3_600_000),
      day = days.get(local.toISOString().slice(0, 10));
    return day ? { day, hour: local.getUTCHours(), beforeNow: local.getUTCHours() * 60 + local.getUTCMinutes() <= nowMinutes } : null;
  };
  const add = (slot, countKey, sumKey, price) => {
    if (!slot) return;
    slot.day.hours[slot.hour][countKey] += 1;
    slot.day.hours[slot.hour][sumKey] += price;
    if (slot.beforeNow) {
      slot.day.byNow[countKey] += 1;
      slot.day.byNow[sumKey] += price;
    }
  };
  const seen = new Set();
  for (const order of orders) {
    const id = String(order.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const price = Number(order.price || 0) / 100;
    add(place(order.orderedAt || order.createdAt), 'count', 'sum', price);
    if (order.rawStatus === 'buyout') add(place(order.createdAt), 'buyoutCount', 'buyoutSum', price);
  }
  return dates.map(date => days.get(date));
}
function demoHourlyOrders(today, nowMinutes) {
  const orders = [];
  for (let back = 0; back < HOURLY_DAYS; back++) {
    const date = addDays(today, -back);
    for (let hour = 0; hour < 24; hour++) {
      // Вечерний пик и ночной провал, как у типичного магазина.
      const count = Math.max(
        0,
        Math.round(
          [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 5, 6, 6, 4, 2][hour] * (1 + (((back * 7 + hour * 3) % 5) - 2) * 0.15)
        )
      );
      for (let n = 0; n < count; n++) {
        const at = new Date(
          Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String((n * 13) % 60).padStart(2, '0')}:00Z`) -
            HOURLY_TIMEZONE.offsetHours * 3_600_000
        );
        if (back === 0 && hour * 60 + ((n * 13) % 60) > nowMinutes) continue;
        // Часть заказов выкуплена примерно через сутки — в часы, когда забирают из пунктов выдачи.
        const bought = back > 0 && (n + hour) % 3 !== 0,
          boughtAt = new Date(at.getTime() + (20 + ((hour * 5 + n) % 10)) * 3_600_000);
        orders.push({
          id: `demo-${date}-${hour}-${n}`,
          orderedAt: at.toISOString(),
          price: (900 + ((hour + n) % 4) * 350) * 100,
          ...(bought && boughtAt.getTime() <= Date.now()
            ? { rawStatus: 'buyout', createdAt: boughtAt.toISOString() }
            : { createdAt: at.toISOString() })
        });
      }
    }
  }
  return orders;
}
async function hourlyOrders(id) {
  const now = new Date(Date.now() + HOURLY_TIMEZONE.offsetHours * 3_600_000),
    today = now.toISOString().slice(0, 10),
    nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const meta = { today, now: { hour: now.getUTCHours(), minute: now.getUTCMinutes() }, currency: 'RUB', timezone: HOURLY_TIMEZONE };
  if (id === 'demo' || !cabinets().length)
    return { demo: true, ...meta, days: summarizeHourlyOrders(demoHourlyOrders(today, nowMinutes), today, nowMinutes) };
  // Та же лента за 31 день, что и у списка заказов; лишнее отсекается по времени оформления.
  const { feed, fetchedAt } = await orderFeedMonth(id, tokenFor(id));
  return {
    demo: false,
    ...meta,
    fetchedAt,
    currency: feed?.data?.currency || 'RUB',
    days: summarizeHourlyOrders(normalizeOrderFeed(feed), today, nowMinutes),
    warnings:
      (feed?.data?.orders || []).length >= ORDER_FEED_LIMIT
        ? [`WB отдал только первые ${ORDER_FEED_LIMIT} событий за 31 день — часть заказов могла не попасть`]
        : []
  };
}

async function dashboard(id, from, to) {
  if (id === 'demo' || !cabinets().length) return demoDashboard();
  const token = tokenFor(id);
  const warnings = [];
  const safeFrom = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : dateDaysAgo(6);
  const safeTo = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : dateDaysAgo(0);
  const jobs = [
    wbRequest(token, 'https://marketplace-api.wildberries.ru/api/v3/orders/new').catch(
      e => (warnings.push(`FBS: ${e.message}`), { orders: [] })
    ),
    orderFeedMonth(id, token)
      .then(({ feed }) => feed)
      .catch(e => (warnings.push(`Лента заказов: ${e.message}`), { data: { orders: [] } })),
    productCards(id, token).catch(e => (warnings.push(`Карточки товаров: ${e.message}`), [])),
    cachedAnalytics(`balance:${id}`, () => wbRequest(token, 'https://finance-api.wildberries.ru/api/v1/account/balance'), 60_000).catch(
      e => (warnings.push(`Баланс: ${e.message}`), null)
    )
  ];
  const [fbs, orderFeed, cards, balance] = await Promise.all(jobs);
  if ((orderFeed?.data?.orders || []).length >= ORDER_FEED_LIMIT) {
    warnings.push(`Лента заказов: WB отдал только первые ${ORDER_FEED_LIMIT} событий за 31 день — часть заказов могла не попасть`);
  }
  if (safeFrom < addDays(moscowDate(), -30))
    warnings.push('Лента заказов: WB отдаёт события только за последние 31 день — более ранних заказов в списке нет');
  const balanceHistory = balance ? saveBalanceSnapshot(id, balance) : readBalanceHistory()[id] || [];
  // Новые FBS-задания в строки ленты не входят — для счётчика «Новые FBS» их число отдаётся отдельно.
  return {
    demo: false,
    orders: enrichOrders(normalizeOrders(fbs, orderFeedPeriod(orderFeed, safeFrom, safeTo)), cards),
    fbsNew: (fbs?.orders || []).length,
    funnel: extractFunnel({ data: { products: [] } }),
    funnelProducts: [],
    funnelHistory: [],
    funnelGroupedHistory: [],
    balance: balance
      ? {
          currency: balance.currency || 'RUB',
          current: Number(balance.current || 0),
          forWithdraw: Number(balance.for_withdraw || 0),
          history: balanceHistory
        }
      : null,
    warnings
  };
}

module.exports = { dashboard, enrichOrders, hourlyOrders, normalizeOrderFeed, normalizeOrders, orderFeedPeriod, summarizeHourlyOrders };
