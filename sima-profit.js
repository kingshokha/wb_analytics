// --- Раздел «Прибыль Сималенда»: оптовые цены Сималенда и Lenardi против цен товаров на WB ---
// Как таблица «Артикулы … с логистикой.xlsx»: по каждому товару кабинета, у которого артикул продавца начинается
// с артикула Сималенда (6938164/125/ШДФ → 6938164) или это артикул Lenardi (305-043/L → 305-043, модуль lenardi.js), —
// цена на WB, комиссия, налог, сборка, логистика, закупка по оптовой цене поставщика, чистая прибыль и цена,
// при которой прибыль будет желаемой. Сервер отдаёт исходные
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
//   - цены Сималенда — последняя загрузка модуля sima-land.js (data/Sima/prices.json);
//   - опт Lenardi — последний загруженный на странице отчёт (модуль lenardi.js, data/Sima/lenardi.json).
// Маршрут: GET /api/sima-profit?cabinet=ID[&force=1] — force заново берёт цены WB.
//
// «Применить цены»: POST /api/sima-profit/apply { cabinet, items: [{ nmId, target }], confirm: true } — target — нужная
// цена со скидкой («Цена для нужной прибыли» страницы). Скидка продавца не меняется: цена до скидки — целая (WB
// принимает только целые), такая, чтобы цена со скидкой была не ниже нужной. Идёт в фоне; GET /api/sima-profit/apply
// ?cabinet=ID — ход и итог последнего применения кабинета. Методы WB (раздел «Цены и скидки», 02-items.yaml):
//   POST /api/v2/upload/task { data: [{ nmID, price, discount }] } — до 1000 товаров, ответ data.id — ID загрузки;
//   GET /api/v2/history/tasks?uploadID= — состояние: 3 — без ошибок, 4 — отменена, 5 — с ошибками в части товаров,
//     6 — ошибки во всех; пока WB не обработал загрузку, данных нет;
//   GET /api/v2/history/goods/task?uploadID=&limit=1000&offset= — товары загрузки: status 3 и errorText — ошибка.
//   Лимит категории — 10 запросов за 6 секунд (интервал 600 мс).
// Снижение — ступенями не больше 30% от текущей цены за загрузку: на деле (09.11.2026, ИП Шамсиддинов) снижение
// на 33–50% WB отправляет в карантин (товар продаётся по старой цене), больше чем в 2 раза — не принимает
// («New prices are more than twice lower…», в документации этого нет). Повышение — сразу. Перед первой загрузкой
// прежние цены записываются в data/Sima/Откаты цен/ — CSV для Excel, файлы не удаляются.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { lenardiArticle } = require('./lenardi');

const TARIFF_TTL = 6 * 60 * 60_000;
const PRICES_API = 'https://discounts-prices-api.wildberries.ru';
const MAX_CUT = 0.3;          // снижение за одну загрузку, доля текущей цены
const MAX_STEPS = 8;          // загрузок за одно применение (снижение в 10 раз — 7 ступеней)
const UPLOAD_BATCH = 1000;    // товаров в загрузке (максимум WB)
const PRICES_PAUSE = 650;     // между запросами категории «Цены и скидки»
const TASK_POLL = 3000, TASK_WAIT = 180_000;
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
// Дробь — до 12 значащих цифр перед округлением вверх: иначе 1000 × 0,7 = 700,0000000000001 станет 701.
const ceil = value => Math.ceil(Number(value.toPrecision(12)));
// Цена до скидки, при которой цена со скидкой не ниже нужной.
const listPrice = (target, discount) => ceil(target / (1 - discount / 100));
// Следующая ступень: снижение — не больше MAX_CUT от текущей цены, повышение — сразу до нужной.
const nextPrice = (current, final) => final >= current ? final : Math.max(final, ceil(current * (1 - MAX_CUT)));
// Ошибка товара из детализации загрузки — по-русски.
function goodError(text) {
  const value = String(text || '');
  if (/quarantine/i.test(value)) return 'Карантин цен: WB оставил старую цену, пока вы не подтвердите новую в кабинете («Цены и скидки» → «Карантин»)';
  if (/twice lower/i.test(value)) return 'WB не принял: новая цена ниже текущей больше чем в 2 раза';
  return value ? `WB не принял: ${value}` : 'WB не принял цену';
}
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? round(Number(value)) : null;

// Строки раздела: товары с артикулом Сималенда или Lenardi и всё, что нужно для расчёта. article — артикул
// поставщика, supplier — его цены: { source: 'sima' | 'lenardi', status, name, wholesale, retail, inStock }.
// status: ok; noPrice — у поставщика нет цены; missing — нет на Сималенде; failed — цена не загрузилась;
// notListed — нет на листе «Артикулы» таблицы Сималенда или в файле опт Lenardi; notLoaded — цен ещё нет совсем.
function profitRows(cards = [], goods = [], commission = [], sima = null, photo = () => '', lenardi = null) {
  const prices = new Map(goods.map(good => [String(good.nmID), good]));
  const fees = new Map(commission.map(item => [Number(item.subjectID), item]));
  const listed = new Set((sima?.sids || []).map(String)), failed = new Set((sima?.failed || []).map(String)), found = sima?.found || {};
  const simaSupplier = sid => {
    const item = found[sid], balance = item?.balance ?? null;
    const status = item ? (positive(item.wholesale_price) || positive(item.price) ? 'ok' : 'noPrice') : !sima ? 'notLoaded' : failed.has(sid) ? 'failed' : listed.has(sid) ? 'missing' : 'notListed';
    return { source: 'sima', status, name: item?.name || '', wholesale: positive(item?.wholesale_price), retail: positive(item?.price), inStock: balance === null ? (item?.isEnough ? true : null) : balance > 0 };
  };
  const lenardiSupplier = article => {
    const known = Boolean(lenardi && Object.hasOwn(lenardi.prices, article)), wholesale = known ? positive(lenardi.prices[article]) : null;
    return { source: 'lenardi', status: !lenardi ? 'notLoaded' : !known ? 'notListed' : wholesale ? 'ok' : 'noPrice', name: '', wholesale, retail: null, inStock: null };
  };
  const rows = [];
  for (const card of cards) {
    const sid = simaSid(card.vendorCode), lenardiCode = sid ? '' : lenardiArticle(card.vendorCode);
    if (!sid && !lenardiCode) continue;
    const good = prices.get(String(card.nmID)), size = good?.sizes?.[0] || {}, fee = fees.get(Number(card.subjectID));
    const d = card.dimensions || {}, volume = d.length * d.width * d.height / 1000;
    rows.push({ nmId: Number(card.nmID), name: card.title || `Товар ${card.nmID}`, photo: photo(card), subject: card.subjectName || '', vendorCode: card.vendorCode || '', article: sid || lenardiCode,
      price: positive(size.discountedPrice ?? good?.discountedPrice), commission: Number.isFinite(Number(fee?.kgvpMarketplace)) ? Number(fee.kgvpMarketplace) : null,
      volume: Number.isFinite(volume) && volume > 0 ? round(volume, 3) : null,
      supplier: sid ? simaSupplier(sid) : lenardiSupplier(lenardiCode) });
  }
  return rows;
}

module.exports = function createSimaProfit({ send, apiError, readJson, cabinets, tokenFor, wbRequest, cachedAnalytics, analyticsCache, productCards, loadPriceGoods, cardPhoto, simaLand,
  lenardi = { prices: () => null, info: () => null },
  pricesChanged = () => {}, root = '.', dir = path.join(root, 'data', 'Sima'), pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10) }) {
  const jobs = new Map();
  // Запрос категории «Цены и скидки»: при 429 — повтор после паузы из заголовка WB (до трёх раз).
  async function pricesRequest(token, url, options) {
    for (let attempt = 0; ; attempt++) {
      try { return await wbRequest(token, url, options); }
      catch (error) {
        if (error.status !== 429 || attempt >= 3) throw error;
        await pause(Math.max(PRICES_PAUSE, (error.retryAfter || 6) * 1000));
      }
    }
  }
  // Ждёт, пока WB обработает загрузку; возвращает ошибки товаров: nmID → текст. Пока загрузка не обработана, WB
  // отвечает без данных или ошибкой — опрос продолжается до TASK_WAIT.
  async function taskErrors(token, uploadId, nmIds) {
    const failed = new Map(), all = text => { for (const nmId of nmIds) failed.set(nmId, text); return failed; };
    let status = 0;
    for (const started = Date.now(); Date.now() - started < TASK_WAIT;) {
      await pause(TASK_POLL);
      try { status = Number((await pricesRequest(token, `${PRICES_API}/api/v2/history/tasks?uploadID=${uploadId}`))?.data?.status) || 0; }
      catch (error) { if (error.status === 401 || error.status === 403) throw error; }
      if ([3, 4, 5, 6].includes(status)) break;
    }
    if (status === 3) return failed;
    if (status === 4) return all('WB отменил загрузку');
    if (![5, 6].includes(status)) return all('WB не обработал загрузку за 3 минуты — цена могла измениться позже, проверьте её в «Ценах и скидках»');
    for (let offset = 0; ; offset += 1000) {
      await pause(PRICES_PAUSE);
      const goods = (await pricesRequest(token, `${PRICES_API}/api/v2/history/goods/task?uploadID=${uploadId}&limit=1000&offset=${offset}`))?.data?.historyGoods || [];
      for (const good of goods) if (Number(good.status) === 3) failed.set(Number(good.nmID), goodError(good.errorText));
      if (goods.length < 1000) break;
    }
    return failed;
  }
  // Одна ступень: загрузки по 1000 товаров, у каждой — ожидание обработки. Возвращает ошибки товаров.
  async function upload(token, batch) {
    const failed = new Map();
    for (let offset = 0; offset < batch.length; offset += UPLOAD_BATCH) {
      if (offset) await pause(PRICES_PAUSE);
      const part = batch.slice(offset, offset + UPLOAD_BATCH), nmIds = part.map(({ item }) => item.nmId);
      let response;
      try { response = await pricesRequest(token, `${PRICES_API}/api/v2/upload/task`, { method: 'POST', body: { data: part.map(({ item, price }) => ({ nmID: item.nmId, price, discount: item.discount })) } }); }
      catch (error) { if (error.status === 401 || error.status === 403) throw error; for (const nmId of nmIds) failed.set(nmId, `WB не принял загрузку: ${error.details?.errorText || error.message}`); continue; }
      const uploadId = response?.data?.id;
      if (!uploadId) { for (const nmId of nmIds) failed.set(nmId, `WB не принял загрузку: ${response?.errorText || 'нет номера загрузки'}`); continue; }
      for (const [nmId, text] of await taskErrors(token, uploadId, nmIds)) failed.set(nmId, text);
    }
    return failed;
  }
  // Прежние цены — до первой загрузки, в CSV для Excel (точка с запятой, BOM). Имя — кабинет и время запуска.
  function writeRollback(job, plan) {
    const at = new Date(job.startedAt), two = value => String(value).padStart(2, '0');
    const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
    const name = `Откат цен ${job.cabinetName.replace(/[\\/:*?"<>|]/g, ' ')} ${stamp}.csv`, folder = path.join(dir, 'Откаты цен');
    const lines = plan.map(item => [item.nmId, `"${String(item.vendorCode).replace(/"/g, '""')}"`, item.start, item.discount, String(item.discounted).replace('.', ','), item.final].join(';'));
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, name), `﻿Арт. WB;Арт. продавца;Цена до скидки;Скидка, %;Цена со скидкой;Новая цена до скидки\n${lines.join('\n')}\n`);
    return path.join(folder, name);
  }
  async function runApply(job, token, items) {
    try {
      job.phase = 'Берём текущие цены из WB';
      const goods = new Map((await loadPriceGoods(token)).map(good => [Number(good.nmID), good])), plan = [];
      for (const { nmId, target } of items) {
        const good = goods.get(nmId), size = good?.sizes?.[0];
        if (!good || !size) { job.errors.push({ nmId, text: 'Товара нет в ценах WB' }); continue; }
        if (good.editableSizePrice) { job.errors.push({ nmId, text: 'У товара цены по размерам — меняйте их в «Ценах и скидках»' }); continue; }
        const discount = Number(good.discount) || 0, price = Number(size.price), final = listPrice(target, discount);
        if (final === price) { job.unchanged++; continue; }
        plan.push({ nmId, vendorCode: good.vendorCode || '', discount, start: price, current: price, final, discounted: Number(size.discountedPrice) || 0 });
      }
      job.planned = plan.length;
      if (plan.length) job.rollback = writeRollback(job, plan);
      let pending = plan;
      for (let step = 1; pending.length && step <= MAX_STEPS; step++) {
        const batch = pending.map(item => ({ item, price: nextPrice(item.current, item.final) }));
        job.phase = `Загрузка ${step}, товаров: ${batch.length}${step > 1 ? ' (снижение ступенями)' : ''}`;
        if (step > 1) await pause(PRICES_PAUSE);
        const failed = await upload(token, batch);
        for (const { item, price } of batch) {
          if (failed.has(item.nmId)) job.errors.push({ nmId: item.nmId, text: failed.get(item.nmId) });
          else item.current = price;
        }
        job.steps = step;
        pending = batch.filter(({ item }) => !failed.has(item.nmId) && item.current !== item.final).map(({ item }) => item);
      }
      for (const item of pending) job.errors.push({ nmId: item.nmId, text: `Снижена до ${item.current} ₽ из ${item.final} ₽ нужных — нажмите «Применить цены» ещё раз` });
      const done = plan.filter(item => item.current === item.final);
      job.raised = done.filter(item => item.final > item.start).length;
      job.lowered = done.filter(item => item.final < item.start).length;
    } catch (error) {
      job.error = error.message;
      console.error('Применение цен Сималенда:', error.message);
    } finally {
      job.running = false; job.finishedAt = new Date().toISOString(); job.phase = '';
      analyticsCache.delete(`sima-profit:goods:${job.cabinet}`);
      pricesChanged(job.cabinet);
    }
  }
  const publicJob = job => job && { ...job, errors: job.errors.slice(0, 300), errorCount: job.errors.length, rollback: job.rollback ? path.relative(root, job.rollback) : '' };
  function apply(body = {}) {
    const cabinet = String(body.cabinet || '');
    if (body.confirm !== true) throw apiError(400, 'Нужно подтверждение');
    if (cabinet === 'demo' || !cabinets().some(item => item.id === cabinet)) throw apiError(400, 'В демо-кабинете цены не меняются');
    const items = [], seen = new Set();
    for (const item of Array.isArray(body.items) ? body.items : []) {
      const nmId = Number(item?.nmId), target = Number(item?.target);
      if (!Number.isInteger(nmId) || nmId <= 0 || !Number.isFinite(target) || target <= 0 || target > 10_000_000 || seen.has(nmId)) continue;
      seen.add(nmId); items.push({ nmId, target });
    }
    if (!items.length) throw apiError(400, 'Выберите товары, у которых посчитана цена для нужной прибыли');
    if (items.length > 20_000) throw apiError(400, 'Слишком много товаров за раз');
    if (jobs.get(cabinet)?.running) throw apiError(409, 'Цены этого кабинета уже меняются — дождитесь окончания');
    const job = { cabinet, cabinetName: cabinets().find(item => item.id === cabinet)?.name || `Кабинет ${cabinet}`, running: true, startedAt: new Date().toISOString(), finishedAt: null,
      total: items.length, planned: 0, unchanged: 0, raised: 0, lowered: 0, steps: 0, phase: 'Начинаем', errors: [], error: '', rollback: '' };
    jobs.set(cabinet, job);
    runApply(job, tokenFor(cabinet), items);
    return publicJob(job);
  }
  async function profit(id, force = false) {
    if (id === 'demo' || !cabinets().length) return { demo: true, configured: simaLand.configured(), rows: [], warnings: [], lenardi: lenardi.info(), tariff: { ...FALLBACK_TARIFF, small: SMALL_LITERS, warehouse: WAREHOUSE } };
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
    return { demo: false, configured: simaLand.configured(), rows: profitRows(cards, goods, commission, sima, cardPhoto, lenardi.prices()), cards: cards.length,
      simaAt: sima?.at || null, simaArticles: sima?.sids?.length || 0, simaRefreshing: simaLand.refreshing(), lenardi: lenardi.info(), tariff: { ...tariff, small: SMALL_LITERS, warehouse: WAREHOUSE }, warnings };
  }
  async function handle(req, res, target) {
    if (req.method === 'GET' && target.pathname === '/api/sima-profit') {
      send(res, 200, await profit(target.searchParams.get('cabinet') || 'demo', target.searchParams.get('force') === '1'));
      return true;
    }
    if (req.method === 'POST' && target.pathname === '/api/sima-profit/apply') {
      send(res, 200, { job: apply(await readJson(req, 5_000_000)) });
      return true;
    }
    if (req.method === 'GET' && target.pathname === '/api/sima-profit/apply') {
      send(res, 200, { job: publicJob(jobs.get(String(target.searchParams.get('cabinet') || ''))) || null });
      return true;
    }
    if (target.pathname.startsWith('/api/sima-profit')) throw apiError(404, 'Нет такого метода');
    return false;
  }
  return { handle, profit, apply, job: cabinet => publicJob(jobs.get(String(cabinet))) };
};
module.exports.simaSid = simaSid;
module.exports.listPrice = listPrice;
module.exports.nextPrice = nextPrice;
module.exports.boxTariff = boxTariff;
module.exports.profitRows = profitRows;
