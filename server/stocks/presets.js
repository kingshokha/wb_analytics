'use strict';
// --- Шаблоны остатков и цен: data/stock-presets.json и data/price-presets.json.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, apiError } = require('../core/base');
const { localPhoto } = require('../core/photos');

const STOCK_PRESETS_FILE = path.join(ROOT, 'data', 'stock-presets.json');
const PRICE_PRESETS_FILE = path.join(ROOT, 'data', 'price-presets.json');
const PRESET_MAX_ITEMS = 200;
const PRESET_MAX_COUNT = 50;
const STOCK_PRESET_MAX_AMOUNT = 100_000;
const PRICE_PRESET_MAX_PRICE = 1_000_000;
function readPresets(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// Шаблоны, сохранённые до локального кэша фото, хранят прямые ссылки на CDN WB — отдаём их тоже через кэш.
function cabinetPresets(file, cabinetId) {
  const list = readPresets(file)[cabinetId];
  return (Array.isArray(list) ? list : []).map(preset => ({
    ...preset,
    items: (preset.items || []).map(item => ({ ...item, photo: localPhoto(item.photo || '') }))
  }));
}

function writePresets(file, presets) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(presets, null, 2));
}

function presetName(preset = {}) {
  const name = String(preset.name || '')
    .trim()
    .slice(0, 60);
  if (!name) throw apiError(400, 'Укажите название шаблона');
  return name;
}

function presetId(preset = {}) {
  return /^[\w-]{1,40}$/.test(String(preset.id || ''))
    ? String(preset.id)
    : `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function savePreset(file, cabinetId, preset, normalize) {
  const id = String(cabinetId || '');
  if (!id) throw apiError(400, 'Не указан кабинет');
  const normalized = normalize(preset);
  const all = readPresets(file);
  const list = Array.isArray(all[id]) ? all[id] : [];
  const index = list.findIndex(item => item.id === normalized.id);
  if (index >= 0) list[index] = normalized;
  else list.push(normalized);
  if (list.length > PRESET_MAX_COUNT) throw apiError(400, `Больше ${PRESET_MAX_COUNT} шаблонов хранить нельзя`);
  all[id] = list;
  writePresets(file, all);
  return { presets: list };
}

function removePreset(file, cabinetId, id) {
  const cabinet = String(cabinetId || '');
  const all = readPresets(file);
  all[cabinet] = (Array.isArray(all[cabinet]) ? all[cabinet] : []).filter(item => item.id !== String(id || ''));
  writePresets(file, all);
  return { presets: all[cabinet] };
}

function normalizePricePreset(preset = {}) {
  const name = presetName(preset);
  const items = (Array.isArray(preset.items) ? preset.items : [])
    .map(item => ({
      nmId: Number(item.nmId),
      price: Math.round(Number(item.price)),
      discount: Math.round(Number(item.discount)),
      name: String(item.name || '').slice(0, 160),
      vendorCode: String(item.vendorCode || '').slice(0, 80),
      photo: String(item.photo || '').slice(0, 300)
    }))
    .filter(
      item =>
        Number.isInteger(item.nmId) &&
        Number.isFinite(item.price) &&
        item.price > 0 &&
        item.price <= PRICE_PRESET_MAX_PRICE &&
        Number.isInteger(item.discount) &&
        item.discount >= 0 &&
        item.discount <= 99
    );
  if (!items.length) throw apiError(400, 'Добавьте в шаблон хотя бы один товар с ценой и скидкой');
  if (items.length > PRESET_MAX_ITEMS) throw apiError(400, `В шаблоне не может быть больше ${PRESET_MAX_ITEMS} товаров`);
  return { id: presetId(preset), name, items, updatedAt: new Date().toISOString() };
}

function normalizeStockPreset(preset = {}) {
  const name = presetName(preset);
  const warehouseIds = [
    ...new Set((Array.isArray(preset.warehouseIds) ? preset.warehouseIds : []).map(value => String(value || '')).filter(Boolean))
  ];
  if (!warehouseIds.length) throw apiError(400, 'Выберите хотя бы один склад FBS');
  const items = (Array.isArray(preset.items) ? preset.items : [])
    .map(item => ({
      chrtId: Number(item.chrtId),
      amount: Math.floor(Number(item.amount)),
      nmId: Number(item.nmId) || '',
      sku: String(item.sku || '').slice(0, 40),
      name: String(item.name || '').slice(0, 160),
      vendorCode: String(item.vendorCode || '').slice(0, 80),
      size: String(item.size || '').slice(0, 40),
      photo: String(item.photo || '').slice(0, 300)
    }))
    .filter(
      item => Number.isInteger(item.chrtId) && Number.isInteger(item.amount) && item.amount >= 0 && item.amount <= STOCK_PRESET_MAX_AMOUNT
    );
  if (!items.length) throw apiError(400, 'Добавьте в шаблон хотя бы один артикул с количеством');
  if (items.length > PRESET_MAX_ITEMS) throw apiError(400, `В шаблоне не может быть больше ${PRESET_MAX_ITEMS} артикулов`);
  return { id: presetId(preset), name, warehouseIds, items, updatedAt: new Date().toISOString() };
}

module.exports = {
  PRICE_PRESETS_FILE,
  STOCK_PRESETS_FILE,
  cabinetPresets,
  normalizePricePreset,
  normalizeStockPreset,
  removePreset,
  savePreset
};
