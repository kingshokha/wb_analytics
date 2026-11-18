// --- Парсер витрины WB: чужой товар по ссылке или артикулу → данные для новой карточки в кабинете ---
// Источник — открытые файлы витрины на серверах basket-NN.wbbasket.ru. Это не API продавца и документации у него нет:
// формат проверен 18.11.2026 на реальных товарах (зарядки, одежда, носки, обои, матрасы). WB может поменять его без
// предупреждения — тогда правится этот файл.
//  • Карточка: /vol{nm/1e5}/part{nm/1e3}/{nm}/info/ru/card.json. Номер сервера NN нигде не написан и растёт с артикулом —
//    спрашиваем все сразу, найденный запоминаем для vol. Предмет — data.subject_id (subject_root_id — родительская
//    категория, не предмет). Характеристики — options [{ name, value }]: несколько значений — через «; », с единицей
//    измерения в тексте, как в самой карточке («2 шт.», «1 м»). Размеры упаковки и «Вес с упаковкой (кг)» — тоже там.
//    Размеры товара — sizes_table.values [{ tech_size, details }] (details по details_props, «RU» — российский размер);
//    без таблицы — data.tech_size («0» — товар без размеров).
//  • Фото: там же /images/big/{1..media.photo_count}.webp — 900×1200, WB принимает WebP по ссылке (media/save).
//  • История цены для покупателя: /info/price-history.json — раз в неделю, в копейках, уже со скидками WB.
//  • Видео (media.has_video): videonme-basket-NN.wbbasket.ru/vol{nm%144}/part{nm/1e4}/{nm}/hls/1440p/index.m3u8.
// Открытый API цен витрины (card.wb.ru) отвечает 403 — им не пользуемся. ТН ВЭД, НДС, документов и деклараций на
// витрине нет: ТН ВЭД и НДС задаёт продавец, документы чужие и не копируются.
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Accept: '*/*' };
const BASKETS = 60, VIDEO_BASKETS = 40, TIMEOUT = 8000;
const hostByVol = new Map();
const pad = n => String(n).padStart(2, '0');

// Артикул WB из ссылки любого вида или из текста: /catalog/123/, ?nm=123, card=123 или просто число.
function donorArticle(text) {
  const value = String(text || '');
  const match = value.match(/catalog\/(\d{5,12})/) || value.match(/(?:product|card|nm)[=/](\d{5,12})/i) || value.match(/(?:^|\D)(\d{5,12})(?:\D|$)/);
  return match ? Number(match[1]) : null;
}
// Все артикулы из вставленного текста: ссылки и числа через пробел, запятую, точку с запятой или с новой строки.
function donorArticles(text) {
  return [...new Set(String(text || '').split(/[\s,;]+/).map(donorArticle).filter(nm => Number.isInteger(nm) && nm > 0))];
}

async function getJson(url) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
const firstOk = (count, attempt) => Promise.any(Array.from({ length: count }, (_, index) => attempt(pad(index + 1)))).catch(() => null);

async function fetchDonor(nmId) {
  const nm = Number(nmId);
  if (!Number.isInteger(nm) || nm <= 0) throw new Error('некорректный артикул WB');
  const vol = Math.floor(nm / 1e5), path = `/vol${vol}/part${Math.floor(nm / 1e3)}/${nm}`;
  let host = hostByVol.get(vol), card = host ? await getJson(`https://${host}${path}/info/ru/card.json`).catch(() => null) : null;
  if (!card) {
    const found = await firstOk(BASKETS, async number => { const candidate = `basket-${number}.wbbasket.ru`; return { host: candidate, card: await getJson(`https://${candidate}${path}/info/ru/card.json`) }; });
    if (!found) throw new Error('товар не найден на витрине WB — проверьте артикул');
    ({ host, card } = found); hostByVol.set(vol, host);
  }
  const base = `https://${host}${path}`, count = Math.min(30, Math.max(0, Number(card.media?.photo_count) || 0));
  const photos = Array.from({ length: count }, (_, index) => ({ big: `${base}/images/big/${index + 1}.webp`, c246x328: `${base}/images/c246x328/${index + 1}.webp` }));
  const [history, video] = await Promise.all([
    getJson(`${base}/info/price-history.json`).catch(() => null),
    card.media?.has_video ? firstOk(VIDEO_BASKETS, async number => {
      const url = `https://videonme-basket-${number}.wbbasket.ru/vol${nm % 144}/part${Math.floor(nm / 1e4)}/${nm}/hls/1440p/index.m3u8`;
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return url;
    }) : null
  ]);
  const last = Array.isArray(history) ? history[history.length - 1] : null;
  const buyerPrice = Number(last?.price?.RUB) > 0 ? Math.round(Number(last.price.RUB) / 100) : null;
  return { nmId: nm, card, photos, video, buyerPrice };
}

const norm = text => String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const numberOf = value => { const match = String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/); return match ? Number(match[0]) : null; };
// Поля, которые у карточки отдельные, а не характеристики: бренд, наименование, описание, баркод.
const OWN_FIELDS = new Set([14177446, 15000000, 14177452, 14177453]);
const TNVED_ID = 15000001, VAT_ID = 15001405;
// Габариты упаковки: на витрине — характеристики, в карточке — поле dimensions (см и кг).
const DIMENSIONS = { 'длина упаковки': 'length', 'ширина упаковки': 'width', 'высота упаковки': 'height', 'вес с упаковкой (кг)': 'weightBrutto' };

// Черновик карточки (в виде карточки из списка WB — его понимает duplicateVariant) и отчёт для предпросмотра.
// charcs — характеристики предмета из /content/v2/object/charcs/{subjectId}.
function draftFromDonor(donor, charcs = []) {
  const card = donor.card || {}, subjectID = Number(card.data?.subject_id);
  if (!Number.isInteger(subjectID) || subjectID <= 0) throw new Error('у товара на витрине не указан предмет');
  const byName = new Map(charcs.filter(item => item.charcType !== 0 && !OWN_FIELDS.has(item.charcID)).map(item => [norm(item.name), item]));
  const characteristics = [], matched = [], unmatched = [], used = new Set(), warnings = [];
  const dimensions = { length: 0, width: 0, height: 0, weightBrutto: 0 };
  let gramsBrutto = 0;
  const put = (charc, raw, label) => {
    if (used.has(charc.charcID)) return true;
    let value;
    if (charc.charcType === 4) { value = numberOf(raw); if (value == null) return false; }
    else {
      value = (Array.isArray(raw) ? raw : String(raw ?? '').split(';')).map(item => String(item).trim()).filter(Boolean);
      if (charc.maxCount > 0) value = value.slice(0, charc.maxCount);
      if (!value.length) return false;
    }
    used.add(charc.charcID); characteristics.push({ id: charc.charcID, name: charc.name, value });
    matched.push({ name: charc.name, value: Array.isArray(value) ? value.join('; ') : `${value}${charc.unitName ? ` ${charc.unitName}` : ''}`, from: label });
    return true;
  };
  for (const option of Array.isArray(card.options) ? card.options : []) {
    const name = norm(option?.name), raw = option?.value;
    if (!name || raw == null || raw === '') continue;
    const dim = DIMENSIONS[name];
    if (dim) {
      const value = numberOf(raw);
      if (value > 0) dimensions[dim] = dim === 'weightBrutto' ? Number(value.toFixed(3)) : Number((/мм/.test(String(raw)) ? value / 10 : value).toFixed(1));
      continue;
    }
    if (name === 'вес товара с упаковкой (г)') gramsBrutto = numberOf(raw) || 0;
    const charc = byName.get(name);
    if (!charc || !put(charc, raw, option.name)) unmatched.push({ name: option.name, value: String(raw) });
  }
  if (!dimensions.weightBrutto && gramsBrutto > 0) dimensions.weightBrutto = Number((gramsBrutto / 1000).toFixed(3));
  // Пол и цвет — у витрины ещё и отдельными полями.
  const kind = byName.get('пол');
  if (kind && Array.isArray(card.kinds) && card.kinds.length) put(kind, card.kinds, 'Пол');
  const color = byName.get('цвет');
  if (color && card.nm_colors_names) put(color, String(card.nm_colors_names).split(/[;,]/), 'Цвет');
  // Размеры: таблица размеров, иначе один размер из data.tech_size, иначе товар без размеров.
  const table = card.sizes_table, ru = Array.isArray(table?.details_props) ? table.details_props.indexOf('RU') : -1;
  let sizes = Array.isArray(table?.values) && table.values.length
    ? table.values.map(size => ({ techSize: String(size.tech_size || '').trim(), wbSize: ru >= 0 ? String(size.details?.[ru] || '').trim() : '' })).filter(size => size.techSize)
    : [];
  if (!sizes.length && card.data?.tech_size && String(card.data.tech_size) !== '0') sizes = [{ techSize: String(card.data.tech_size), wbSize: '' }];
  const chrts = Array.isArray(card.data?.chrt_ids) ? card.data.chrt_ids.length : 0;
  if (chrts > Math.max(1, sizes.length)) warnings.push(`У товара ${chrts} размеров, а витрина показывает ${sizes.length || 'ни одного'} — недостающие размеры добавьте в карточке после создания`);
  const missingDims = Object.entries(dimensions).filter(([, value]) => !(value > 0)).map(([key]) => key);
  if (missingDims.length) warnings.push('На витрине нет части габаритов упаковки — укажите их');
  const requiredMissing = charcs.filter(item => item.required && item.charcType !== 0 && !OWN_FIELDS.has(item.charcID) && item.charcID !== TNVED_ID && item.charcID !== VAT_ID && !used.has(item.charcID)).map(item => item.name);
  const title = String(card.imt_name || card.name || '').trim();
  const source = {
    subjectID, subjectName: card.subj_name || '', title: title.slice(0, 60), description: String(card.description || '').trim().slice(0, 5000), brand: '',
    characteristics: characteristics.map(({ id, value }) => ({ id, value })), dimensions, sizes, photos: donor.photos || [], video: donor.video || '', tags: [], documents: { items: [] }
  };
  const report = {
    nmId: donor.nmId, link: `https://www.wildberries.ru/catalog/${donor.nmId}/detail.aspx`, title: source.title, titleCut: title.length > 60,
    subjectID, subjectName: source.subjectName, donorBrand: card.selling?.brand_name || '', donorVendorCode: card.vendor_code || '',
    photo: source.photos[0]?.c246x328 || '', photos: source.photos.length, video: Boolean(source.video), sizes, descriptionLength: source.description.length,
    dimensions, missingDims, matched, unmatched, requiredMissing, buyerPrice: donor.buyerPrice ?? null, needKiz: Boolean(card.need_kiz), warnings
  };
  return { source, report };
}

module.exports = { donorArticle, donorArticles, fetchDonor, draftFromDonor, TNVED_ID, VAT_ID };
