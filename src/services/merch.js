const fs = require('fs');

const { DEFAULT_MERCH_ITEMS, MERCH_ITEMS_PATH, STANDARD_SIZES } = require('../config');
const { readJsonArray, writeJsonArray } = require('./storage');

function normalizePrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (amount <= 0 || amount > 10000) return null;
  return Math.round(amount * 100) / 100;
}

function normalizeOptionalPrice(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  return normalizePrice(value);
}

function normalizeSizes(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = String(value || '')
      .trim()
      .toUpperCase();
    if (!normalized) continue;
    if (normalized.length > 12) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= 12) break;
  }
  return output;
}

function normalizeMerchItem(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;

  const id = String(candidate.id || '').trim();
  const name = String(candidate.name || '').trim();
  const image = String(candidate.image || '').trim();
  const price = normalizePrice(candidate.price);
  if (!id || !name || !image || price === null) return null;

  const includeSizes =
    candidate.includeSizes === true ||
    (Array.isArray(candidate.sizes) && normalizeSizes(candidate.sizes).length > 0);
  const twoXlPrice = normalizeOptionalPrice(candidate.twoXlPrice);

  return {
    id,
    name,
    price,
    image,
    sizes: includeSizes ? [...STANDARD_SIZES] : [],
    allowInitials: Boolean(candidate.allowInitials),
    paused: Boolean(candidate.paused),
    twoXlPrice: includeSizes ? twoXlPrice : null,
    createdAt: candidate.createdAt || new Date().toISOString()
  };
}

function readMerchItems() {
  const fileExisted = fs.existsSync(MERCH_ITEMS_PATH);
  const rawItems = readJsonArray(MERCH_ITEMS_PATH);
  const normalized = rawItems.map(normalizeMerchItem).filter(Boolean);

  if (normalized.length > 0) {
    return normalized;
  }

  if (fileExisted) {
    return [];
  }

  const seeded = DEFAULT_MERCH_ITEMS.map((item) => ({ ...item }));
  writeJsonArray(MERCH_ITEMS_PATH, seeded);
  return seeded;
}

function writeMerchItems(items) {
  writeJsonArray(MERCH_ITEMS_PATH, items);
}

module.exports = {
  normalizePrice,
  normalizeOptionalPrice,
  normalizeSizes,
  normalizeMerchItem,
  readMerchItems,
  writeMerchItems
};
