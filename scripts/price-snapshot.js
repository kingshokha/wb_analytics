'use strict';
// Снимок цен и скидок для GitHub Actions (.github/workflows/price-snapshots.yml).
// Токены WB — переменные окружения с именами на WB_ (например WB_PRICES_TOKEN_SAMIRI); в сценарии каждая
// задаётся из одноимённого секрета репозитория. Имя кабинета в снимке — часть имени после
// WB_PRICES_TOKEN_ / WB_TOKEN_ / WB_ («samiri»).
// Снимок шифруется открытым ключом (scripts/snapshot-public-key.pem) и пишется в папку ветки snapshots:
//   prices/<кабинет>/<ГГГГ-ММ-ДД>T<ЧЧ-ММ>.json.enc  (время московское)
// Запуск: node scripts/price-snapshot.js <папка ветки snapshots>
const fs = require('fs');
const path = require('path');
const { encryptSnapshot } = require('./snapshot-crypto');

const PRICES_URL = 'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter';
const PUBLIC_KEY_FILE = path.join(__dirname, 'snapshot-public-key.pem');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function tokensFromEnv(env = process.env) {
  return Object.entries(env)
    .filter(([name, value]) => /^WB_/.test(name) && typeof value === 'string' && value.trim())
    .map(([name, value]) => ({ cabinet: name.replace(/^WB_(PRICES_)?(TOKEN_?)?/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'main', token: value.trim() }));
}

async function wbGet(url, token) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { Authorization: token } });
    if (response.ok) return response.json();
    // Лимит WB — ждём, сколько он просит, и пробуем ещё (не больше трёх раз).
    if (response.status === 429 && attempt < 4) { await wait((Number(response.headers.get('x-ratelimit-retry')) || 6) * 1000); continue; }
    throw new Error(`WB ответил ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}

async function loadGoods(token) {
  const goods = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const response = await wbGet(`${PRICES_URL}?limit=1000&offset=${offset}`, token);
    const batch = Array.isArray(response?.data?.listGoods) ? response.data.listGoods : [];
    goods.push(...batch);
    if (batch.length < 1000) break;
    await wait(650);
  }
  return goods;
}

// В снимке — только то, что нужно для истории цен: цена, скидки и цены размеров, если они разные.
function compactGoods(goods = []) {
  return goods.map(good => {
    const sizes = Array.isArray(good.sizes) ? good.sizes : [], first = sizes[0] || {};
    return { nmId: Number(good.nmID), vendorCode: good.vendorCode || '', currency: good.currencyIsoCode4217 || 'RUB',
      price: Number(first.price || 0), discountedPrice: Number(first.discountedPrice || 0), clubDiscountedPrice: Number(first.clubDiscountedPrice || 0),
      discount: Number(good.discount || 0), clubDiscount: Number(good.clubDiscount || 0),
      ...(good.editableSizePrice && sizes.length > 1 ? { sizes: sizes.map(size => ({ sizeId: Number(size.sizeID), name: size.techSizeName || '', price: Number(size.price || 0), discountedPrice: Number(size.discountedPrice || 0) })) } : {}) };
  });
}

function moscowStamp(date = new Date()) {
  return new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 16).replace(':', '-');
}

async function main(outputDir) {
  if (!outputDir) throw new Error('Укажите папку ветки snapshots');
  const publicKey = fs.readFileSync(PUBLIC_KEY_FILE, 'utf8'), cabinets = tokensFromEnv();
  if (!cabinets.length) throw new Error('Нет токенов WB: добавьте секрет с именем на WB_ (например WB_PRICES_TOKEN_SAMIRI) и строку с ним в env шага «Снять цены» в .github/workflows/price-snapshots.yml');
  const takenAt = new Date(), stamp = moscowStamp(takenAt);
  let saved = 0;
  for (const { cabinet, token } of cabinets) {
    try {
      const goods = compactGoods(await loadGoods(token));
      const dir = path.join(outputDir, 'prices', cabinet);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${stamp}.json.enc`), encryptSnapshot({ version: 1, cabinet, takenAt: takenAt.toISOString(), goods }, publicKey));
      // В журнал — только количество: журнал запусков публичного репозитория видят все.
      console.log(`${cabinet}: снимок ${stamp}, товаров ${goods.length}`);
      saved += 1;
    } catch (error) { console.error(`${cabinet}: не удалось — ${error.message}`); }
  }
  if (!saved) process.exitCode = 1;
}

if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { tokensFromEnv, compactGoods, moscowStamp };
