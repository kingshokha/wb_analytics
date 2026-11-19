const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const createGlueRatings = require('../glue-ratings');
const { parseGlue, averageOf } = createGlueRatings;

// Сокращённый ответ feedbacks1.wb.ru/feedbacks/v2/193227360 (склейка зарядок, 19.11.2026).
const sample = {
  valuation: '4.1', feedbackCount: 32262,
  valuationDistribution: { 1: 4919, 2: 1121, 3: 1500, 4: 1843, 5: 22844 },
  nmValuationDistribution: [
    { nm: 200724819, valuationDistribution: { 1: 1764, 2: 380, 3: 545, 4: 684, 5: 8806 } },
    { nm: 310089710, valuationDistribution: { 1: 3, 2: 4, 3: 2, 4: 2, 5: 50 } }
  ],
  feedbacks: [{ id: 'x', nmId: 200724819, productValuation: 5 }]
};

test('ответ отзывов витрины: оценка склейки и оценки товаров по звёздам', () => {
  const glue = parseGlue(sample, 1000);
  assert.equal(glue.rating, 4.1);
  assert.equal(glue.count, 32262);
  assert.deepEqual(glue.stars, [4919, 1121, 1500, 1843, 22844]);
  assert.deepEqual(glue.items[200724819], [1764, 380, 545, 684, 8806]);
  assert.equal(averageOf(glue.items[200724819]), 4.18);
  assert.equal(averageOf([0, 0, 0, 0, 0]), null);
  const empty = parseGlue({ valuation: '', feedbackCount: 0, valuationDistribution: null, nmValuationDistribution: null });
  assert.equal(empty.rating, null);
  assert.deepEqual(empty.stars, [0, 0, 0, 0, 0]);
});

test('оценки товара и склейки из сохранённого файла', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glue-ratings-'));
  fs.writeFileSync(path.join(dir, 'Оценки склеек.json'), JSON.stringify({ groups: { 193227360: parseGlue(sample, Date.now()) } }));
  const ratings = createGlueRatings({ dirFor: () => dir });
  assert.deepEqual(ratings.item('1', 193227360, 200724819), { count: 12179, avg: 4.18, stars: [1764, 380, 545, 684, 8806] });
  assert.deepEqual(ratings.item('1', 193227360, 999), { count: 0, avg: null, stars: [0, 0, 0, 0, 0] }, 'товар склейки без оценок');
  assert.equal(ratings.item('1', 555, 200724819), null, 'склейка ещё не загружена');
  assert.equal(ratings.glue('1', 193227360).count, 32262);
  fs.rmSync(dir, { recursive: true, force: true });
});
