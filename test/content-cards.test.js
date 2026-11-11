const test = require('node:test');
const assert = require('node:assert/strict');
const createContentCards = require('../content-cards');

const apiError = (status, message) => Object.assign(new Error(message), { status });
const cards = createContentCards({ apiError, cabinets: () => [], analyticsCache: new Map(), wbRequest: async () => ({}), tokenFor: () => 't', cachedAnalytics: async (key, loader) => loader(), readJson: async () => ({}), send: () => {}, localPhoto: url => url, loadProductCards: async () => [] });

const fresh = {
  nmID: 11, vendorCode: 'A1', title: 'Худи', brand: 'Demo', description: 'Описание', kizMarked: false,
  dimensions: { length: 30, width: 20, height: 5, weightBrutto: 0.45 },
  sizes: [{ chrtID: 100, techSize: 'S', wbSize: '42', skus: ['111'] }, { chrtID: 101, techSize: 'M', wbSize: '44', skus: ['222'] }],
  characteristics: [{ id: 1, name: 'Цвет', value: ['черный'] }]
};
const input = over => ({ nmID: 11, vendorCode: 'A1', title: 'Худи', brand: 'Demo', description: 'Описание', kizMarked: false, dimensions: fresh.dimensions,
  characteristics: [{ id: 1, value: ['черный', ' белый ', ''] }, { id: 2, value: 320 }, { id: 3, value: [] }],
  sizes: [{ chrtID: 100, techSize: 'S', wbSize: '42', skus: ['111', '333'] }, { chrtID: 101, techSize: 'M', wbSize: '44', skus: ['222'] }],
  documents: { items: [{ type: 2, number: 'ЕАЭС 1', startDate: '2025-02-13', endDate: '2030-02-10', isEndless: false }], excludeDocuments: false }, ...over });

test('карточки: запрос редактирования — только поля метода WB, пустые значения характеристик убираются', () => {
  const payload = cards.updatePayload(input({ title: '  Худи оверсайз  ' }), fresh);
  assert.deepEqual(Object.keys(payload).sort(), ['brand', 'characteristics', 'description', 'dimensions', 'documents', 'kizMarked', 'nmID', 'sizes', 'title', 'vendorCode']);
  assert.equal(payload.title, 'Худи оверсайз');
  assert.deepEqual(payload.characteristics, [{ id: 1, value: ['черный', 'белый'] }, { id: 2, value: 320 }]);
  assert.deepEqual(payload.sizes[0], { chrtID: 100, techSize: 'S', wbSize: '42', skus: ['111', '333'] });
  assert.equal(payload.documents.items[0].startDate, '2025-02-13T00:00:00.000Z');
  assert.equal(payload.dimensions.weightBrutto, 0.45);
});

test('карточки: нельзя удалить размер или баркод, у нового размера нужны цена и баркод', () => {
  assert.throws(() => cards.updatePayload(input({ sizes: [{ chrtID: 100, techSize: 'S', skus: ['111'] }] }), fresh), /Удалять размеры/);
  assert.throws(() => cards.updatePayload(input({ sizes: [{ chrtID: 100, techSize: 'S', skus: [] }, { chrtID: 101, skus: ['222'] }] }), fresh), /Баркоды нельзя удалить/);
  const withNew = sizes => input({ sizes: [...input().sizes, ...sizes] });
  assert.throws(() => cards.updatePayload(withNew([{ techSize: 'L', skus: ['444'] }]), fresh), /цену нового размера/);
  assert.throws(() => cards.updatePayload(withNew([{ techSize: 'L', price: 2500, skus: [] }]), fresh), /баркод/);
  assert.deepEqual(cards.updatePayload(withNew([{ techSize: 'L', wbSize: '46', price: 2500, skus: ['444'] }]), fresh).sizes[2], { techSize: 'L', wbSize: '46', price: 2500, skus: ['444'] });
});

test('карточки: проверки наименования, артикула, габаритов и документов', () => {
  assert.throws(() => cards.updatePayload(input({ title: 'х'.repeat(61) }), fresh), /60/);
  assert.throws(() => cards.updatePayload(input({ vendorCode: ' ' }), fresh), /артикул продавца/);
  assert.throws(() => cards.updatePayload(input({ nmID: 12 }), fresh), /не совпадает/);
  assert.throws(() => cards.updatePayload(input({ dimensions: { length: 30.5, width: 1, height: 1, weightBrutto: 1 } }), fresh), /целое/);
  assert.throws(() => cards.updatePayload(input({ documents: { items: [{ type: 6, number: '1' }] } }), fresh), /тип документа/);
  const endless = cards.updatePayload(input({ documents: { items: [{ id: 'd1', type: 1, number: 'N', endDate: '2030-01-01', isEndless: true }] } }), fresh).documents.items[0];
  assert.equal(endless.id, 'd1'); assert.equal(endless.isEndless, true); assert.equal(endless.endDate, undefined);
});

// Окно карточки у настоящего кабинета: WB подменён. textSearch по артикулу ничего не находит (так бывает у WB), дальше —
// баркод из сохранённого списка, потом перебор всего списка и корзины.
test('карточки: поиск WB по артикулу ничего не дал — баркод из сохранённого списка, потом весь список и корзина', async () => {
  const target = { ...fresh, nmID: 55, subjectID: 7, sizes: [{ chrtID: 5, techSize: '0', skus: ['999'] }] };
  const filler = Array.from({ length: 100 }, (_, index) => ({ nmID: 1000 + index, subjectID: 7 }));
  const run = async ({ barcodeWorks, inList }) => {
    const calls = [];
    const wbRequest = async (token, url, options = {}) => {
      const settings = options.body?.settings || {}, text = settings.filter?.textSearch;
      if (/cards\/(list|trash)$/.test(url)) calls.push({ path: url.split('/').pop(), text: text ?? null, cursor: settings.cursor });
      if (url.endsWith('/cards/list')) {
        if (text === '55') return { cards: [] };
        if (text === '999') return { cards: barcodeWorks ? [target] : [] };
        if (!settings.cursor.nmID) return { cards: filler, cursor: { updatedAt: 'u1', nmID: 1099, total: 100 } };
        return { cards: inList ? [target] : [], cursor: { total: inList ? 1 : 0 } };
      }
      if (url.endsWith('/cards/trash')) return { cards: [], cursor: { total: 0 } };
      return {};
    };
    const module = createContentCards({ apiError, cabinets: () => [{ id: '1' }], analyticsCache: new Map(), wbRequest, tokenFor: () => 't', cachedAnalytics: async (key, loader) => loader(), readJson: async () => ({}),
      send: (res, status, payload) => Object.assign(res, { status, payload }), localPhoto: url => url, productCards: async () => [target], productCardsStatus: () => ({}), productCardsChanged: () => {}, refreshProductCards: () => {} });
    const res = {};
    try { await module.handle({ method: 'GET' }, res, new URL('http://local/api/card?cabinet=1&nmId=55')); } catch (error) { res.error = error; }
    return { res, calls };
  };
  const byBarcode = await run({ barcodeWorks: true, inList: true });
  assert.equal(byBarcode.res.payload.card.nmID, 55);
  assert.deepEqual(byBarcode.calls.map(call => call.text), ['55', '999'], 'по баркоду нашлась — список не листается');
  const byScan = await run({ barcodeWorks: false, inList: true });
  assert.equal(byScan.res.payload.card.nmID, 55);
  assert.deepEqual(byScan.calls.map(call => [call.path, call.text]), [['list', '55'], ['list', '999'], ['list', null], ['list', null]]);
  assert.deepEqual(byScan.calls[3].cursor, { limit: 100, nmID: 1099, updatedAt: 'u1' }, 'следующая страница — по cursor из ответа');
  const missing = await run({ barcodeWorks: false, inList: false });
  assert.equal(missing.res.error.status, 404);
  assert.match(missing.res.error.message, /ни в списке карточек, ни в корзине/);
  assert.deepEqual(missing.calls.slice(-2).map(call => [call.path, call.text]), [['trash', '55'], ['trash', null]]);
});

test('карточки: текст ошибки Контента — errorText и дополнительные ошибки по артикулам', () => {
  assert.equal(cards.contentErrorText({ errorText: 'some items lacks required characteristics', additionalErrors: { A1: 'missing required characteristics with ids: {5}' } }), 'some items lacks required characteristics — A1: missing required characteristics with ids: {5}');
  assert.equal(cards.contentErrorText({ errorText: 'Указан несуществующий imt', additionalErrors: { error: 'Указан несуществующий imt' } }), 'Указан несуществующий imt');
});
