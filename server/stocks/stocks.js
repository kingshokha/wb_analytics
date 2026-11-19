'use strict';
// --- Остатки FBS и FBW: списки по складам, изменение, копирование на склады, «Добавить вручную».
const { apiError, cabinets, cachedAnalytics, tokenFor, wait, wbRequest } = require('../core/base');
const { productCards } = require('../core/product-cards');
const { cardPhoto } = require('../core/photos');
const { cardsSoFar, forgetList, progressiveList } = require('../core/lists');

const STOCKS_REPORT_API = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report';
function stockCardIndex(cards = []) {
  const index = new Map();
  for (const card of cards)
    for (const size of card.sizes || []) {
      const chrtId = String(size.chrtID || size.chrtId || '');
      if (!chrtId) continue;
      index.set(chrtId, {
        nmId: card.nmID,
        vendorCode: card.vendorCode || '',
        name: card.title || `Товар ${card.nmID}`,
        category: card.subjectName || 'Без категории',
        size: size.techSize || size.wbSize || '—',
        sku: (size.skus || [])[0] || '',
        photo: cardPhoto(card)
      });
    }
  return index;
}

function normalizeFbsStocks(warehouses = [], stockResponses = [], cards = []) {
  const byChrt = stockCardIndex(cards);
  const rows = [];
  stockResponses.forEach(({ warehouse, stocks }) =>
    (stocks || []).forEach(stock => {
      const meta = byChrt.get(String(stock.chrtId)) || {};
      rows.push({
        warehouseId: warehouse.id,
        warehouseName: warehouse.name || `Склад ${warehouse.id}`,
        officeId: warehouse.officeId,
        nmId: meta.nmId || '',
        vendorCode: meta.vendorCode || '',
        name: meta.name || `Размер ${stock.chrtId}`,
        category: meta.category || 'Без категории',
        size: meta.size || '—',
        sku: stock.sku || meta.sku || '',
        photo: meta.photo || '',
        chrtId: stock.chrtId,
        amount: Number(stock.amount || 0)
      });
    })
  );
  const categories = [...new Set(rows.map(row => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  return {
    rows: rows.sort((a, b) => b.amount - a.amount || String(a.name).localeCompare(String(b.name), 'ru')),
    warehouses: warehouses.map(item => ({ id: item.id, name: item.name || `Склад ${item.id}`, officeId: item.officeId })),
    categories,
    totals: stockTotals(rows)
  };
}
// Итоги таблицы остатков (FBS и FBW): позиций, товаров, складов, единиц, нулевых и в наличии.
function stockTotals(rows) {
  return {
    rows: rows.length,
    products: new Set(rows.map(row => String(row.nmId || row.chrtId))).size,
    warehouses: new Set(rows.map(row => String(row.warehouseId))).size,
    amount: rows.reduce((sum, row) => sum + row.amount, 0),
    zero: rows.filter(row => row.amount === 0).length,
    positive: rows.filter(row => row.amount > 0).length
  };
}

function demoFbsStocks() {
  const warehouses = [
    { id: 'demo-1', name: 'Основной FBS', officeId: 1 },
    { id: 'demo-2', name: 'Резервный FBS', officeId: 2 }
  ];
  const cards = [
    {
      nmID: 100001,
      vendorCode: 'TSHIRT-BLACK',
      title: 'Футболка базовая',
      subjectName: 'Одежда',
      sizes: [{ chrtID: 501, techSize: 'M', skus: ['460000000001'] }]
    },
    {
      nmID: 100002,
      vendorCode: 'MUG-THERMO',
      title: 'Термокружка',
      subjectName: 'Посуда',
      sizes: [{ chrtID: 502, techSize: '500 мл', skus: ['460000000002'] }]
    },
    {
      nmID: 100003,
      vendorCode: 'HOODIE-GREEN',
      title: 'Худи Oversize',
      subjectName: 'Одежда',
      sizes: [{ chrtID: 503, techSize: 'L', skus: ['460000000003'] }]
    }
  ];
  return {
    demo: true,
    ...normalizeFbsStocks(
      warehouses,
      [
        {
          warehouse: warehouses[0],
          stocks: [
            { chrtId: 501, sku: '460000000001', amount: 42 },
            { chrtId: 502, sku: '460000000002', amount: 8 }
          ]
        },
        {
          warehouse: warehouses[1],
          stocks: [
            { chrtId: 501, sku: '460000000001', amount: 15 },
            { chrtId: 503, sku: '460000000003', amount: 0 }
          ]
        }
      ],
      cards
    ),
    warnings: []
  };
}

// Остатки FBS: WB отдаёт их по списку размеров (chrtId, до 1000 за запрос, POST /api/v3/stocks/{warehouseId}; лимит —
// 300 запросов в минуту, интервал 200 мс), а размеры — из карточек. Поэтому остатки запрашиваются по каждой новой
// тысяче размеров из уже пришедших карточек, не дожидаясь всех.
async function fbsStocks(id, force = false) {
  if (id === 'demo' || !cabinets().length) return demoFbsStocks();
  const token = tokenFor(id);
  return progressiveList(`fbs-stocks:${id}`, 30_000, force, async publish => {
    const warnings = [];
    const warehousesResponse = await cachedAnalytics(
      `fbs-warehouses:${id}`,
      () => wbRequest(token, 'https://marketplace-api.wildberries.ru/api/v3/warehouses'),
      2 * 60_000
    );
    const warehouses = (Array.isArray(warehousesResponse) ? warehousesResponse : []).filter(
      item => Number(item.deliveryType) === 1 && !item.isDeleting
    );
    const cards = cardsSoFar(id, token, warnings),
      responses = warehouses.map(warehouse => ({ warehouse, stocks: [] })),
      asked = new Set();
    const snapshot = () => ({
      demo: false,
      ...normalizeFbsStocks(warehouses, responses, cards.cards()),
      warnings: [...new Set(warnings)],
      progress: { sizes: asked.size, cardsLoading: cards.loading() }
    });
    publish(snapshot);
    for (;;) {
      const loading = cards.loading(),
        pending = [...stockCardIndex(cards.cards()).keys()].filter(chrtId => !asked.has(chrtId));
      if (!pending.length && !loading) break;
      // Пока карточки грузятся, остатки запрашиваются полными тысячами размеров.
      if (!pending.length || (loading && pending.length < 1000)) {
        await Promise.race([cards.done, wait(700)]);
        continue;
      }
      const chunk = pending.slice(0, 1000);
      chunk.forEach(chrtId => asked.add(chrtId));
      for (const item of responses) {
        try {
          const result = await wbRequest(token, `https://marketplace-api.wildberries.ru/api/v3/stocks/${item.warehouse.id}`, {
            method: 'POST',
            body: { chrtIds: chunk.map(Number) }
          });
          item.stocks.push(...(Array.isArray(result?.stocks) ? result.stocks : []));
        } catch (error) {
          warnings.push(`${item.warehouse.name || item.warehouse.id}: ${error.message}`);
        }
        await wait(220);
      }
      publish(snapshot);
    }
    return snapshot();
  });
}

function normalizeFbwStocks(items = [], cards = []) {
  const byChrt = stockCardIndex(cards);
  const rows = items.map(item => {
    const meta = byChrt.get(String(item.chrtId)) || {};
    return {
      warehouseId: item.warehouseId,
      warehouseName: item.warehouseName || `Склад ${item.warehouseId || 'WB'}`,
      regionName: item.regionName || 'Без региона',
      nmId: Number(item.nmId || meta.nmId || 0) || '',
      chrtId: Number(item.chrtId || 0) || '',
      vendorCode: meta.vendorCode || '',
      name: meta.name || `Товар ${item.nmId || item.chrtId || ''}`,
      category: meta.category || 'Без категории',
      size: meta.size || '—',
      sku: meta.sku || '',
      photo: meta.photo || '',
      amount: Number(item.quantity || 0),
      inWayToClient: Number(item.inWayToClient || 0),
      inWayFromClient: Number(item.inWayFromClient || 0)
    };
  });
  const warehouses = [
    ...new Map(rows.map(row => [String(row.warehouseId), { id: row.warehouseId, name: row.warehouseName }])).values()
  ].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  const categories = [...new Set(rows.map(row => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  return {
    rows: rows.sort((a, b) => b.amount - a.amount || String(a.name).localeCompare(String(b.name), 'ru')),
    warehouses,
    categories,
    totals: stockTotals(rows)
  };
}

function demoFbwStocks() {
  const cards = [
    {
      nmID: 100001,
      vendorCode: 'TSHIRT-BLACK',
      title: 'Футболка базовая',
      subjectName: 'Одежда',
      sizes: [{ chrtID: 501, techSize: 'M', skus: ['460000000001'] }]
    },
    {
      nmID: 100002,
      vendorCode: 'MUG-THERMO',
      title: 'Термокружка',
      subjectName: 'Посуда',
      sizes: [{ chrtID: 502, techSize: '500 мл', skus: ['460000000002'] }]
    }
  ];
  const items = [
    {
      nmId: 100001,
      chrtId: 501,
      warehouseId: 507,
      warehouseName: 'Коледино',
      regionName: 'Центральный',
      quantity: 42,
      inWayToClient: 3,
      inWayFromClient: 1
    },
    {
      nmId: 100002,
      chrtId: 502,
      warehouseId: 117986,
      warehouseName: 'Казань',
      regionName: 'Приволжский',
      quantity: 8,
      inWayToClient: 2,
      inWayFromClient: 0
    }
  ];
  return { demo: true, ...normalizeFbwStocks(items, cards), warnings: [] };
}

// Отчёты остатков WB обновляются раз в 30 минут и ограничены 3 запросами в минуту,
// поэтому ответ кэшируется ненадолго и общий для вкладок FBW и цен.
async function loadInventoryReport(token, report) {
  const limit = 250000;
  const items = [];
  for (let offset = 0; ; offset += limit) {
    const response = await wbRequest(token, `${STOCKS_REPORT_API}/${report}`, {
      method: 'POST',
      body: { nmIds: [], chrtIds: [], limit, offset }
    });
    const batch = Array.isArray(response?.data?.items) ? response.data.items : Array.isArray(response?.items) ? response.items : [];
    items.push(...batch);
    if (batch.length < limit) break;
    await wait(20_100);
  }
  return items;
}

function inventoryReport(id, token, report) {
  return cachedAnalytics(`inventory:${report}:${id}`, () => loadInventoryReport(token, report), 2 * 60_000);
}

function summarizeStockTotals(wbItems = [], sellerItems = []) {
  const totals = {};
  const add = (items, key) => {
    for (const item of items) {
      const nmId = String(item.nmId || '');
      if (!nmId) continue;
      const row = (totals[nmId] ||= { fbs: 0, fbw: 0, total: 0 });
      const quantity = Number(item.quantity || 0);
      row[key] += quantity;
      row.total += quantity;
    }
  };
  add(wbItems, 'fbw');
  add(sellerItems, 'fbs');
  return totals;
}

// Остатки FBW — один отчёт WB; названия и фото подставляются из карточек по мере их загрузки.
async function fbwStocks(id, force = false) {
  if (id === 'demo' || !cabinets().length) return demoFbwStocks();
  const token = tokenFor(id);
  return progressiveList(`fbw-stocks:${id}`, 60_000, force, async publish => {
    const warnings = [],
      cards = cardsSoFar(id, token, warnings);
    const items = await inventoryReport(id, token, 'wb-warehouses');
    const snapshot = () => ({
      demo: false,
      ...normalizeFbwStocks(items, cards.cards()),
      warnings: [...warnings],
      progress: { cardsLoading: cards.loading() }
    });
    publish(snapshot);
    await cards.done;
    return snapshot();
  });
}
function groupStockUpdates(items = []) {
  const grouped = new Map();
  for (const item of items) {
    const warehouseId = String(item.warehouseId || '');
    const chrtId = Number(item.chrtId);
    const amount = Number(item.amount);
    if (!warehouseId || !Number.isInteger(chrtId) || !Number.isFinite(amount) || amount < 0) continue;
    if (!grouped.has(warehouseId)) grouped.set(warehouseId, []);
    grouped.get(warehouseId).push({ chrtId, amount: Math.floor(amount) });
  }
  return grouped;
}

// После изменения сайт не перезагружает весь список: сервер перечитывает у WB только изменённые размеры на этих складах
// (POST /api/v3/stocks/{warehouseId}, до 1000 chrtId за запрос, 300 запросов в минуту) и возвращает их остатки — сайт
// подставляет их в свои строки. Если перечитать не удалось, возвращаются отправленные значения: WB их уже принял (204).
async function readBackFbsStocks(token, grouped) {
  const stocks = [],
    warnings = [];
  for (const [warehouseId, items] of grouped) {
    for (let offset = 0; offset < items.length; offset += 1000) {
      const chunk = items.slice(offset, offset + 1000);
      if (stocks.length || warnings.length) await wait(220);
      try {
        const result = await wbRequest(token, `https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`, {
          method: 'POST',
          body: { chrtIds: chunk.map(item => item.chrtId) }
        });
        const found = new Map(
          (Array.isArray(result?.stocks) ? result.stocks : []).map(stock => [Number(stock.chrtId), Number(stock.amount || 0)])
        );
        chunk.forEach(item =>
          stocks.push({ warehouseId, chrtId: item.chrtId, amount: found.has(item.chrtId) ? found.get(item.chrtId) : item.amount })
        );
        const differ = chunk.filter(item => found.has(item.chrtId) && found.get(item.chrtId) !== item.amount).length;
        if (differ)
          warnings.push(`WB пока показывает другой остаток у ${differ} поз. — показан остаток из WB, проверьте позже кнопкой «Обновить»`);
      } catch (error) {
        warnings.push(`Остатки сохранены, но перечитать их у WB не удалось: ${error.message}`);
        chunk.forEach(item => stocks.push({ warehouseId, chrtId: item.chrtId, amount: item.amount }));
      }
    }
  }
  return { stocks, warnings: [...new Set(warnings)] };
}

async function updateFbsStocks(body) {
  const grouped = groupStockUpdates(body.items);
  if (!grouped.size) throw apiError(400, 'Выберите хотя бы один товар и укажите корректный остаток');
  return writeFbsStocks(String(body.cabinet || 'demo'), grouped);
}
// Запись остатков FBS — общая для «Задать остаток», «Скопировать на склады», шаблонов и «Добавить вручную»: по складу,
// до 1000 размеров за запрос. Ни одна позиция не принята — ошибка с причинами; часть — остальное записано, причины
// отказа — в предупреждениях (страница показывает их сообщением). Принятые перечитываются у WB.
async function writeFbsStocks(id, grouped) {
  const token = tokenFor(id),
    { accepted, failed } = await putFbsStocks(token, grouped);
  forgetList(`fbs-stocks:${id}`);
  const added = [...accepted.values()].reduce((sum, list) => sum + list.length, 0);
  if (!added && failed.length) throw apiError(409, `WB не принял остатки: ${failedSummary(failed)}`);
  const readBack = accepted.size ? await readBackFbsStocks(token, accepted) : { stocks: [], warnings: [] };
  return {
    ok: true,
    updated: added,
    added,
    failed,
    stocks: readBack.stocks,
    warnings: [...(failed.length ? [`WB не принял ${failed.length} поз.: ${failedSummary(failed)}`] : []), ...readBack.warnings]
  };
}
// «склад не подходит для крупногабаритных товаров — 3; в карточке нет кода ТНВЭД — 1»
function failedSummary(failed) {
  const counts = new Map();
  failed.forEach(item => counts.set(item.text, (counts.get(item.text) || 0) + 1));
  return [...counts].map(([text, count]) => `${text} — ${count}`).join('; ');
}

// «Добавить вручную»: товары кабинета для поиска в окне — по размерам (chrtId), из сохранённого списка карточек.
async function fbsStockProducts(id) {
  if (id === 'demo' || !cabinets().length)
    return {
      demo: true,
      products: [
        {
          nmId: 100001,
          vendorCode: 'TSHIRT-BLACK',
          name: 'Футболка базовая',
          category: 'Одежда',
          brand: 'Demo',
          photo: '',
          sizes: [{ chrtId: 501, size: 'M', sku: '460000000001' }]
        },
        {
          nmId: 100002,
          vendorCode: 'MUG-THERMO',
          name: 'Термокружка',
          category: 'Посуда',
          brand: 'Demo',
          photo: '',
          sizes: [{ chrtId: 502, size: '500 мл', sku: '460000000002' }]
        },
        {
          nmId: 100003,
          vendorCode: 'HOODIE-GREEN',
          name: 'Худи Oversize',
          category: 'Одежда',
          brand: 'Demo',
          photo: '',
          sizes: [{ chrtId: 503, size: 'L', sku: '460000000003' }]
        }
      ]
    };
  const cards = await productCards(id, tokenFor(id));
  return {
    demo: false,
    products: cards
      .map(card => ({
        nmId: card.nmID,
        vendorCode: card.vendorCode || '',
        name: card.title || `Товар ${card.nmID}`,
        category: card.subjectName || '',
        brand: card.brand || '',
        photo: cardPhoto(card),
        sizes: (card.sizes || [])
          .map(size => ({
            chrtId: Number(size.chrtID || size.chrtId),
            size: size.techSize && size.techSize !== '0' ? size.techSize : size.wbSize || '',
            sku: (size.skus || [])[0] || ''
          }))
          .filter(size => Number.isInteger(size.chrtId) && size.chrtId > 0)
      }))
      .filter(product => product.sizes.length)
  };
}
// Причины, по которым WB не принимает остаток (409 и 406 метода PUT /api/v3/stocks/{warehouseId}, документация
// «Остатки на складах продавца», 02-items.yaml).
const STOCK_ERRORS = {
  UploadDataLimit: 'превышен лимит загружаемых данных',
  NotFound: 'размер не найден',
  StoreIsProcessing: 'склад обновляется или удаляется — повторите через несколько секунд',
  CargoWarehouseRestrictionMGT: 'склад не подходит для малогабаритных товаров',
  CargoWarehouseRestrictionSGT: 'склад не подходит для сверхгабаритных товаров',
  CargoWarehouseRestrictionSGTKGTPlus: 'склад не подходит для сверх- и крупногабаритных товаров',
  CargoWarehouseRestrictionKGTPlus: 'склад не подходит для крупногабаритных товаров',
  DeliveryTypeRestriction: 'этот тип доставки недоступен для предмета товара',
  SubjectRestriction: 'продажа с этого склада недоступна для предмета товара',
  TnvedRequired: 'в карточке нет кода ТНВЭД',
  StocksUpdateBlock: 'обновление остатков ограничено из-за блокировки продавца',
  WarehouseStocksUpdateBlock: 'технические работы на складе — повторите позже'
};
// Остатки новых товаров на складах: по складу, до 1000 размеров за запрос (лимит метода — 300 запросов в минуту, 4XX
// считается за 10). На 409 WB перечисляет размеры, которые не принял, — их откладываем с причиной, остальные отправляем
// ещё раз (до 3 раз). Принятые перечитываются у WB, как после «Задать остаток».
async function addFbsStocks(body) {
  const id = String(body.cabinet || 'demo'),
    grouped = groupStockUpdates(body.items);
  if (!grouped.size) throw apiError(400, 'Выберите товары, склады и укажите остаток');
  const count = [...grouped.values()].reduce((sum, list) => sum + list.length, 0);
  if (count > 20_000) throw apiError(400, `Слишком много позиций за раз: ${count}, можно до 20 000`);
  if (id === 'demo' || !cabinets().length)
    return {
      ok: true,
      demo: true,
      added: count,
      failed: [],
      stocks: [...grouped].flatMap(([warehouseId, list]) => list.map(item => ({ warehouseId, ...item }))),
      warnings: []
    };
  return writeFbsStocks(id, grouped);
}
// PUT /api/v3/stocks/{warehouseId}: { accepted: Map(склад → принятые позиции), failed: [{ warehouseId, chrtId, text }] }.
async function putFbsStocks(token, grouped) {
  const failed = [],
    accepted = new Map();
  for (const [warehouseId, list] of grouped) {
    for (let offset = 0; offset < list.length; offset += 1000) {
      let chunk = list.slice(offset, offset + 1000);
      for (let attempt = 0; chunk.length && attempt < 3; attempt++) {
        try {
          await wbRequest(token, `https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`, {
            method: 'PUT',
            body: { stocks: chunk }
          });
          if (!accepted.has(warehouseId)) accepted.set(warehouseId, []);
          accepted.get(warehouseId).push(...chunk);
          break;
        } catch (error) {
          const reasons = Array.isArray(error.details) ? error.details : [],
            rejected = new Map();
          for (const reason of reasons)
            for (const item of Array.isArray(reason?.data) ? reason.data : [])
              rejected.set(Number(item.chrtId), STOCK_ERRORS[reason.code] || reason.message || reason.code || error.message);
          // Не 409 со списком размеров — отклонена вся порция.
          if (error.status !== 409 || !rejected.size) {
            const text = STOCK_ERRORS[reasons[0]?.code || error.details?.code] || error.message;
            chunk.forEach(item => failed.push({ warehouseId, chrtId: item.chrtId, text }));
            break;
          }
          chunk
            .filter(item => rejected.has(item.chrtId))
            .forEach(item => failed.push({ warehouseId, chrtId: item.chrtId, text: rejected.get(item.chrtId) }));
          chunk = chunk.filter(item => !rejected.has(item.chrtId));
        }
        await wait(220);
      }
      await wait(220);
    }
  }
  return { accepted, failed };
}

async function copyFbsStocks(body) {
  const targetWarehouseIds = [
    ...new Set(
      (Array.isArray(body.targetWarehouseIds) ? body.targetWarehouseIds : [body.targetWarehouseId])
        .map(value => String(value || ''))
        .filter(Boolean)
    )
  ];
  const stocks = (body.items || [])
    .map(item => ({ chrtId: Number(item.chrtId), amount: Math.floor(Number(item.amount)) }))
    .filter(item => Number.isInteger(item.chrtId) && Number.isFinite(item.amount) && item.amount >= 0);
  if (!targetWarehouseIds.length || !stocks.length) throw apiError(400, 'Выберите хотя бы один целевой склад и товары для копирования');
  const grouped = new Map(targetWarehouseIds.map(warehouseId => [warehouseId, stocks]));
  return { ...(await writeFbsStocks(String(body.cabinet || 'demo'), grouped)), targetWarehouseIds };
}

module.exports = {
  addFbsStocks,
  copyFbsStocks,
  fbsStockProducts,
  fbsStocks,
  fbwStocks,
  inventoryReport,
  normalizeFbsStocks,
  normalizeFbwStocks,
  readBackFbsStocks,
  stockCardIndex,
  summarizeStockTotals,
  updateFbsStocks
};
