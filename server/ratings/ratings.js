'use strict';
// --- Оценки товаров: отчёт WB item-rating.
const { addDays, apiError, cabinets, cachedAnalytics, datesBetween, moscowDate, tokenFor, wbRequest } = require('../core/base');
const { glueRatings, productCards } = require('../core/product-cards');
const { cardPhoto } = require('../core/photos');

// --- Оценки товаров: /api/analytics/v2/item-rating — рейтинг по отзывам, новые отзывы по звёздам, сравнение с конкурентами ---
// WB: период заканчивается не позже вчерашнего дня и начинается не раньше 364 суток от вчера; лимит — 3 запроса
// в минуту (интервал 20 сек); данные обновляются раз в час, поэтому кэш 30 минут.
// Поле dynamics — разница с прошлым периодом в тех же единицах, а не проценты, как сказано в документации:
// проверено на данных (22 отзыва при dynamics 18 — в прошлом периоде было ровно 4).
const ITEM_RATING_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v2/item-rating';
const ITEM_RATING_PAGE = 1000;
const ITEM_RATING_INTERVAL = 21_000;
const itemRatingAttempts = new Map();
function itemRatingPeriods(from, to) {
  const yesterday = moscowDate(-1),
    earliest = addDays(yesterday, -364),
    valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  const end = valid(to) && to < yesterday ? (to < earliest ? earliest : to) : yesterday;
  let start = valid(from) ? from : addDays(end, -6);
  if (start > end) start = end;
  if (start < earliest) start = earliest;
  const length = datesBetween(start, end).length,
    pastStart = addDays(start, -length);
  return {
    current: { start, end },
    past: pastStart >= earliest ? { start: pastStart, end: addDays(start, -1) } : null,
    endClamped: valid(to) && to > end
  };
}
function normalizeItemRatings(pages = [], cards = []) {
  const byNmId = new Map(cards.map(card => [String(card.nmID), card])),
    first = pages[0] || {},
    increase = first.feedbackIncrease || {};
  const delta = value => (value == null ? null : Number(value));
  const STAR_KEYS = { 5: 'fiveStar', 4: 'fourStar', 3: 'threeStar', 2: 'twoStar', 1: 'oneStar' };
  const items = pages
    .flatMap(page => page.items || [])
    .map(item => {
      const card = byNmId.get(String(item.nmId)) || {};
      return {
        nmId: item.nmId,
        title: item.title || card.title || `Товар ${item.nmId}`,
        vendorCode: item.vendorCode || card.vendorCode || '',
        subjectName: item.subjectName || '',
        brandName: item.brandName || '',
        photo: cardPhoto(card),
        cardRating: item.rating == null ? null : Number(item.rating),
        feedbackRating: item.feedbackRating?.current == null ? null : Number(item.feedbackRating.current),
        feedbackRatingDelta: delta(item.feedbackRating?.dynamics),
        percentile: item.feedbackRating?.percentile == null ? null : Number(item.feedbackRating.percentile),
        newFeedbacks: Number(item.feedbackCount?.current || 0),
        newFeedbacksDelta: delta(item.feedbackCount?.dynamics),
        stars: Object.fromEntries(
          Object.entries(STAR_KEYS).map(([star, key]) => [
            star,
            { count: Number(item[key]?.current || 0), delta: delta(item[key]?.dynamics) }
          ])
        ),
        disqualified: Number(item.disqualified || 0),
        pinned: Boolean(item.pinnedFeedback),
        shadowed: Boolean(item.isShadowed)
      };
    });
  return {
    seller: {
      rating: first.sellerRating?.current ?? null,
      ratingDelta: delta(first.sellerRating?.dynamics),
      newFeedbacks: Number(increase.current || 0),
      newFeedbacksDelta: delta(increase.dynamics),
      totalFeedbacks: Number(increase.total || 0),
      stars: Object.fromEntries(
        Object.entries(STAR_KEYS).map(([star, key]) => [
          star,
          { count: Number(increase[key]?.current || 0), delta: delta(increase[key]?.dynamics), total: Number(increase[key]?.total || 0) }
        ])
      )
    },
    items
  };
}
function demoItemRatings() {
  const items = [
    ['Быстрая зарядка 67W Type-C', 4.23, 0.01, 7.7, 8.5, [48, 4, 1, 1, 4], 8, 2, false],
    ['Беспроводная зарядка MagSafe 20W', 4.51, -0.49, 44.4, 10, [17, 2, 1, 0, 2], 18, 0, false],
    ['Фен-стайлер с насадками', 4.71, 0, 32.6, 7.2, [12, 1, 0, 0, 1], 1, 0, false],
    ['Чехол для iPhone 17 Pro Max', 4.88, 0.02, 81.3, 9.1, [25, 2, 0, 0, 0], -3, 1, false],
    ['Кабель USB-C 2 м', 3.92, -0.12, 3.1, 6.4, [5, 1, 1, 2, 3], 4, 0, true]
  ].map(([title, rating, ratingDelta, percentile, cardRating, stars, countDelta, disqualified, shadowed], index) => ({
    nmId: 4210000 + index,
    title,
    vendorCode: `DEMO-${index + 1}`,
    subjectName: 'Демо',
    brandName: 'Demo',
    rating: cardRating,
    feedbackRating: { current: rating, dynamics: ratingDelta, percentile },
    feedbackCount: { current: stars.reduce((sum, value) => sum + value, 0), dynamics: countDelta },
    fiveStar: { current: stars[0] },
    fourStar: { current: stars[1] },
    threeStar: { current: stars[2] },
    twoStar: { current: stars[3] },
    oneStar: { current: stars[4] },
    disqualified,
    pinnedFeedback: index === 0,
    isShadowed: shadowed
  }));
  return {
    sellerRating: { current: 4.31, dynamics: 0.02 },
    feedbackIncrease: {
      current: 131,
      total: 40746,
      dynamics: 31,
      fiveStar: { current: 107, total: 29818 },
      fourStar: { current: 10, total: 2400 },
      threeStar: { current: 3, total: 1500 },
      twoStar: { current: 3, total: 1487 },
      oneStar: { current: 10, total: 5541 }
    },
    items
  };
}
async function itemRatings(id, from, to) {
  const periods = itemRatingPeriods(from, to);
  if (id === 'demo' || !cabinets().length) return { demo: true, periods, ...normalizeItemRatings([demoItemRatings()]) };
  const token = tokenFor(id);
  const pages = await cachedAnalytics(
    `item-rating:${id}:${periods.current.start}:${periods.current.end}`,
    async () => {
      const result = [];
      for (let offset = 0; offset < 20 * ITEM_RATING_PAGE; offset += ITEM_RATING_PAGE) {
        // Не чаще одного запроса в 21 секунду на кабинет — лимит WB 3 в минуту.
        const wait = ITEM_RATING_INTERVAL - (Date.now() - (itemRatingAttempts.get(id) || 0));
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        itemRatingAttempts.set(id, Date.now());
        const response = await wbRequest(token, ITEM_RATING_URL, {
          method: 'POST',
          body: {
            currentPeriod: periods.current,
            ...(periods.past ? { pastPeriod: periods.past } : {}),
            orderBy: { field: 'feedbackCount', mode: 'desc' },
            limit: ITEM_RATING_PAGE,
            offset
          }
        }).catch(error => {
          if (error.status === 429)
            throw apiError(429, `WB ограничил частоту запросов оценок (3 в минуту) — повторите через ${error.retryAfter || 20} сек`);
          throw error;
        });
        const data = response?.data || {};
        result.push(data);
        if ((data.items || []).length < ITEM_RATING_PAGE) break;
      }
      return result;
    },
    30 * 60_000
  );
  const cards = await productCards(id, token).catch(() => []);
  const result = { demo: false, periods, ...normalizeItemRatings(pages, cards) };
  // «Всего оценок» — с открытых данных отзывов WB по склейкам (server/cards/glue-ratings.js): отчёт WB даёт только прирост за период.
  const imtByNm = new Map(cards.map(card => [Number(card.nmID), card.imtID]));
  for (const item of result.items) {
    const stats = glueRatings.item(id, imtByNm.get(Number(item.nmId)), Number(item.nmId));
    item.totalFeedbacks = stats ? stats.count : null;
  }
  glueRatings.refresh(
    id,
    cards.map(card => card.imtID),
    result.items
      .slice(0, 200)
      .map(item => imtByNm.get(Number(item.nmId)))
      .filter(Boolean)
  );
  result.feedbacksLoading = glueRatings.status(id).loading;
  return result;
}

module.exports = { itemRatingPeriods, itemRatings, normalizeItemRatings };
