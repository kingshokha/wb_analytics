const test = require('node:test');
const assert = require('node:assert/strict');
const { donorArticle, donorArticles, draftFromDonor } = require('../wb-donor');

test('артикул WB из ссылок и текста', () => {
  assert.equal(donorArticle('https://www.wildberries.ru/catalog/200724819/detail.aspx?size=324428113'), 200724819);
  assert.equal(donorArticle('https://wb.ru/catalog/200724819/feedbacks'), 200724819);
  assert.equal(donorArticle('product?nm=315371657'), 315371657);
  assert.equal(donorArticle('200724819'), 200724819);
  assert.equal(donorArticle('без цифр'), null);
  assert.deepEqual(
    donorArticles('https://www.wildberries.ru/catalog/1111111/detail.aspx\n2222222, 1111111; 3333333'),
    [1111111, 2222222, 3333333]
  );
});

// Образец — карточка витрины 200724819 (зарядка) в сокращённом виде; характеристики предмета 765 — из /content/v2/object/charcs.
const charcs = [
  { charcID: 5023, name: 'Модель', charcType: 1, maxCount: 1 },
  { charcID: 11439, name: 'Разъем подключения', charcType: 1, maxCount: 3 },
  { charcID: 84696, name: 'Доп. опции зарядного устройства', charcType: 1, maxCount: 2 },
  { charcID: 179792, name: 'Количество предметов в упаковке', charcType: 1, maxCount: 1 },
  { charcID: 90610, name: 'Максимальный выходной ток', charcType: 4, maxCount: 0, unitName: 'А' },
  { charcID: 90745, name: 'Ширина упаковки', charcType: 4, maxCount: 0, unitName: 'см' },
  { charcID: 14177449, name: 'Цвет', charcType: 1, maxCount: 5 },
  { charcID: 14177446, name: 'Бренд', charcType: 1, maxCount: 1 },
  { charcID: 14177452, name: 'Описание', charcType: 0, maxCount: 1 },
  { charcID: 74941, name: 'Назначение товара', charcType: 1, maxCount: 3, required: true },
  { charcID: 15000001, name: 'ТНВЭД', charcType: 1, maxCount: 1, required: true }
];
const donor = {
  nmId: 200724819,
  buyerPrice: 535,
  video: 'https://videonme-basket-05.wbbasket.ru/vol51/part20072/200724819/hls/1440p/index.m3u8',
  photos: [{ big: 'https://basket-13.wbbasket.ru/vol2007/part200724/200724819/images/big/1.webp', c246x328: 'x' }],
  card: {
    imt_name: 'Быстрая зарядка для телефона 67w Type-c',
    subj_name: 'Зарядные устройства',
    description: 'Описание',
    vendor_code: 'xiaomi 67w',
    nm_colors_names: 'белый',
    selling: { brand_name: 'Xiaomi' },
    data: { subject_id: 765, subject_root_id: 8995, chrt_ids: [324428113], tech_size: '0' },
    options: [
      { name: 'Ширина упаковки', value: '13 см' },
      { name: 'Высота упаковки', value: '3 см' },
      { name: 'Вес с упаковкой (кг)', value: '0.25 кг' },
      { name: 'Длина упаковки', value: '15 см' },
      { name: 'Модель', value: '67W' },
      { name: 'Разъем подключения', value: 'USB; Type C' },
      { name: 'Доп. опции зарядного устройства', value: 'быстрая зарядка; Защита от перегрузок и замыканий; Защита от перегрева' },
      { name: 'Количество предметов в упаковке', value: '2 шт.' },
      { name: 'Максимальный выходной ток', value: '3,25 А' },
      { name: 'Страна производства', value: 'Китай' }
    ]
  }
};

test('черновик карточки из витрины: предмет, характеристики, габариты', () => {
  const { source, report } = draftFromDonor(donor, charcs);
  assert.equal(source.subjectID, 765, 'предмет — data.subject_id, а не родительская категория');
  assert.equal(source.brand, '');
  assert.deepEqual(source.dimensions, { length: 15, width: 13, height: 3, weightBrutto: 0.25 });
  const value = id => source.characteristics.find(item => item.id === id)?.value;
  assert.deepEqual(value(11439), ['USB', 'Type C'], 'несколько значений — через «; »');
  assert.deepEqual(value(84696), ['быстрая зарядка', 'Защита от перегрузок и замыканий'], 'не больше maxCount');
  assert.deepEqual(value(179792), ['2 шт.'], 'текст с единицей — как есть');
  assert.equal(value(90610), 3.25, 'числовая — числом');
  assert.equal(value(90745), undefined, 'размеры упаковки — в габариты, не в характеристики');
  assert.deepEqual(value(14177449), ['белый'], 'цвет — из nm_colors_names');
  assert.equal(value(14177446), undefined, 'бренд — не характеристика');
  assert.deepEqual(
    report.unmatched.map(row => row.name),
    ['Страна производства']
  );
  assert.deepEqual(report.requiredMissing, ['Назначение товара'], 'ТН ВЭД задаёт продавец — его в списке нет');
  assert.deepEqual(source.sizes, []);
  assert.equal(source.photos.length, 1);
  assert.equal(source.video, donor.video);
  assert.deepEqual(report.missingDims, []);
});

test('размеры из таблицы размеров витрины', () => {
  const card = {
    ...donor.card,
    data: { subject_id: 11, chrt_ids: [1, 2] },
    sizes_table: {
      details_props: ['RU', 'Обхват талии, в см'],
      values: [
        { tech_size: 'L', details: ['50', '86-90'] },
        { tech_size: 'XL', details: ['52', '90-94'] }
      ]
    },
    options: []
  };
  const { source, report } = draftFromDonor({ ...donor, card }, []);
  assert.deepEqual(source.sizes, [
    { techSize: 'L', wbSize: '50' },
    { techSize: 'XL', wbSize: '52' }
  ]);
  assert.deepEqual(report.missingDims, ['length', 'width', 'height', 'weightBrutto']);
  const one = draftFromDonor({ ...donor, card: { ...donor.card, data: { subject_id: 212, tech_size: 'ONE SIZE' }, options: [] } }, []);
  assert.deepEqual(one.source.sizes, [{ techSize: 'ONE SIZE', wbSize: '' }]);
  const unknown = draftFromDonor(
    { ...donor, card: { ...donor.card, data: { subject_id: 5302, chrt_ids: [1, 2, 3, 4] }, options: [] } },
    []
  );
  assert.match(unknown.report.warnings.join(' '), /4 размеров/);
  assert.throws(() => draftFromDonor({ ...donor, card: { ...donor.card, data: {} } }, []), /предмет/);
});
