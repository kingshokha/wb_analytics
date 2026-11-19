'use strict';
// --- Возвраты и перемещения: отчёт WB item-returns.
const { addDays, apiError, cabinets, cachedAnalytics, moscowDate, tokenFor, wait, wbRequest } = require('../core/base');
const { productCards } = require('../core/product-cards');
const { cardPhoto } = require('../core/photos');
const { historyChunks } = require('../ads/stats');

// --- Возвраты и перемещения: /api/analytics/v1/item-returns — возвраты товаров продавцу в ПВЗ ---
// Проверено на данных (окт. 2026): без параметра status WB отдаёт только архивные, поэтому активные и архивные
// запрашиваются отдельно. Период запроса — не больше 31 дня (фильтр по дате заказа на возврат, orderDt).
// Лимит — 10 запросов в минуту на кабинет: дальше 429 и x-ratelimit-retry (секунды ожидания). Нет данных — 204 без тела.
// Даты приходят по Москве в двух видах: «2026-10-14 08:09:39» и «2025-03-31T11:33:53». orderId часто 0.
// Активные (ещё не выданы) берутся за последние 93 дня независимо от выбранного периода: их нужно забрать из ПВЗ.
const ITEM_RETURNS_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/item-returns';
const ITEM_RETURNS_PAGE = 1000;
const ITEM_RETURNS_ACTIVE_DAYS = 93;
const ITEM_RETURNS_MAX_DAYS = 366;
function itemReturnsPeriod(from, to) {
  const today = moscowDate(),
    valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  const end = valid(to) && to < today ? to : today;
  let start = valid(from) && from <= end ? from : addDays(end, -29);
  if (start < addDays(end, -(ITEM_RETURNS_MAX_DAYS - 1))) start = addDays(end, -(ITEM_RETURNS_MAX_DAYS - 1));
  return { from: start, to: end };
}
// Группа статуса для цвета и фильтров; сам текст статуса WB показывается как есть.
function returnStatusGroup(status, active) {
  const text = String(status || '').toLowerCase();
  if (text.includes('готов к выдаче')) return 'ready';
  if (text.startsWith('выдан')) return 'done';
  if (text.includes('истек') || text.includes('истёк')) return 'expired';
  if (text.includes('отмен')) return 'cancel';
  return active ? 'transit' : 'other';
}
const wbDateTime = value => (value ? String(value).trim().replace(' ', 'T') : null);
function normalizeItemReturns(rows = [], cards = [], active = false) {
  const byNmId = new Map(cards.map(card => [String(card.nmID), card]));
  return rows.map(item => {
    const card = byNmId.get(String(item.nmId)) || {};
    return {
      id: `${item.srid || ''}:${item.shkId || ''}`,
      srid: item.srid || '',
      shkId: item.shkId ? String(item.shkId) : '',
      stickerId: item.stickerId ? String(item.stickerId) : '',
      orderId: Number(item.orderId) || null,
      nmId: item.nmId,
      sku: item.sku || '',
      techSize: item.techSize && item.techSize !== '0' ? String(item.techSize) : '',
      brand: item.brand || card.brand || '',
      subjectName: item.subjectName || card.subjectName || '',
      title: card.title || item.subjectName || `Товар ${item.nmId}`,
      vendorCode: card.vendorCode || '',
      photo: cardPhoto(card),
      kiz: item.kiz || '',
      returnType: item.returnType || '—',
      returnReason: item.returnReason || '',
      returnStatus: item.returnStatus || '—',
      status: returnStatusGroup(item.returnStatus, active),
      active,
      orderDt: item.orderDt || null,
      readyAt: wbDateTime(item.readyToReturnDt),
      expiresAt: wbDateTime(item.expiredDt),
      completedAt: wbDateTime(item.completedDt),
      officeId: item.dstOfficeId || null,
      officeAddress: String(item.dstOfficeAddress || '').trim()
    };
  });
}
async function itemReturnsRequest(token, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await wbRequest(token, `${ITEM_RETURNS_URL}?${new URLSearchParams(params)}`);
    } catch (error) {
      if (error.status !== 429) throw error;
      if (attempt >= 2)
        throw apiError(429, `WB ограничил частоту запросов возвратов (10 в минуту) — повторите через ${error.retryAfter || 60} сек`);
      await wait(Math.min(65, error.retryAfter || 10) * 1000 + 300);
    }
  }
}
async function itemReturnsChunk(id, token, status, chunk) {
  return cachedAnalytics(
    `item-returns:${id}:${status}:${chunk.from}:${chunk.to}`,
    async () => {
      const rows = [];
      for (let offset = 0; offset < 20 * ITEM_RETURNS_PAGE; offset += ITEM_RETURNS_PAGE) {
        const response = await itemReturnsRequest(token, {
          dateFrom: chunk.from,
          dateTo: chunk.to,
          status,
          limit: ITEM_RETURNS_PAGE,
          offset
        });
        const report = Array.isArray(response?.report) ? response.report : [];
        rows.push(...report);
        if (report.length < ITEM_RETURNS_PAGE || rows.length >= Number(response?.count || 0)) break;
      }
      return rows;
    },
    10 * 60_000
  );
}
function demoItemReturns(period) {
  const offices = ['Москва, Профсоюзная улица 56', 'Москва, улица Тверская 18к1', 'Химки, Ленинградское шоссе 2'];
  const items = [
    ['Возврат брака', 'Готов к выдаче', 0, 2],
    ['Возврат брака', 'Готов к выдаче', 0, 6],
    ['Возврат неверного вложения', 'Готов к выдаче', 1, 1],
    ['Возврат брака', 'В пути в пвз', 1, null],
    ['Возврат товара, который приехал по МП, продавцу', 'Погружен в машину до СЦ/РЦ', 2, null],
    ['Возврат брака', 'Выдано', 0, null],
    ['Возврат брака', 'Выдано', 1, null],
    ['Возврат неверного вложения', 'Выдано', 0, null],
    ['Возврат брака', 'Истек срок хранения на пвз', 2, null],
    ['Возврат товара, который приехал по МП, продавцу', 'Выдано', 2, null],
    ['Возврат брака', 'Отмена по задержке', 1, null]
  ];
  const now = Date.now(),
    at = days => new Date(now + days * 864e5 + 3 * 3_600_000).toISOString().slice(0, 19);
  const rows = items.map(([returnType, returnStatus, office, expiresIn], index) => {
    const active = !/выдано|истек|отмена/i.test(returnStatus),
      orderDt = addDays(period.to, -(2 + index * 2));
    return {
      active,
      row: {
        sku: `20400000000${index}`,
        brand: 'Demo',
        nmId: 4210000 + (index % 5),
        subjectName: 'Демо-товар',
        techSize: index % 3 ? 'M' : '0',
        srid: `demo-return-${index}`,
        shkId: 5220000000 + index,
        stickerId: `5126800${index}`,
        orderId: 0,
        orderDt,
        returnType,
        returnStatus,
        dstOfficeId: 100 + office,
        dstOfficeAddress: offices[office],
        kiz: index === 2 ? '0102900000376311210DEMO' : null,
        readyToReturnDt: /Готов|Выдано|Истек/.test(returnStatus) ? at(-(index + 1)) : null,
        expiredDt: expiresIn != null ? at(expiresIn) : null,
        completedDt: returnStatus === 'Выдано' ? at(-index) : null
      }
    };
  });
  return { active: rows.filter(x => x.active).map(x => x.row), archive: rows.filter(x => !x.active).map(x => x.row) };
}
async function itemReturns(id, from, to) {
  const period = itemReturnsPeriod(from, to),
    activeWindow = { from: addDays(moscowDate(), -(ITEM_RETURNS_ACTIVE_DAYS - 1)), to: moscowDate() };
  const pack = (active, archive, cards, demo) => {
    const archived = normalizeItemReturns(archive, cards, false),
      archivedIds = new Set(archived.map(item => item.id));
    // Возврат, который успели выдать между запросами, может попасть в оба списка — оставляем архивную запись.
    return {
      demo,
      period,
      activeWindow,
      active: normalizeItemReturns(active, cards, true).filter(item => !archivedIds.has(item.id)),
      archive: archived,
      fetchedAt: new Date().toISOString()
    };
  };
  if (id === 'demo' || !cabinets().length) {
    const demo = demoItemReturns(period);
    return pack(demo.active, demo.archive, [], true);
  }
  const token = tokenFor(id),
    active = [],
    archive = [];
  for (const chunk of historyChunks(activeWindow)) active.push(...(await itemReturnsChunk(id, token, 'active', chunk)));
  for (const chunk of historyChunks(period)) archive.push(...(await itemReturnsChunk(id, token, 'archive', chunk)));
  const cards = await productCards(id, token).catch(() => []);
  return pack(active, archive, cards, false);
}

module.exports = { itemReturns, itemReturnsPeriod, normalizeItemReturns, returnStatusGroup };
