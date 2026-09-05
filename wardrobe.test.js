// Tests the pure logic block extracted directly from index.html, so it can
// never silently drift from what actually ships. See the PURE-LOGIC-START /
// PURE-LOGIC-END markers in index.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const match = html.match(/\/\/ ==== PURE-LOGIC-START ====([\s\S]*?)\/\/ ==== PURE-LOGIC-END ====/);
if (!match) throw new Error('Could not find PURE-LOGIC block in index.html');
const logicSource = match[1];

const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
// Top-level function declarations attach to window, but top-level const/let
// (like LOW_STOCK_THRESHOLD) live in the script's lexical scope instead and
// don't survive past this eval call — so copy it onto window explicitly,
// in the same eval, before that scope goes away.
dom.window.eval(`${logicSource}\nwindow.LOW_STOCK_THRESHOLD = LOW_STOCK_THRESHOLD;`);
const {
  LOW_STOCK_THRESHOLD,
  cleanAvailable,
  clamp,
  incrementDirty,
  decrementDirty,
  resetAllDirty,
  resetDirtyForIds,
  snapshotDirtyCounts,
  categoryCleanTotals,
  isLowStock,
  isOutfitWearable,
  matchesFilters,
} = dom.window;

function garment(overrides = {}) {
  return {
    id: 'g1',
    category: 'tops',
    quantity: 5,
    dirty_count: 0,
    color: 'black',
    is_archived: false,
    ...overrides,
  };
}

// --- cleanAvailable / clamp -------------------------------------------------

test('cleanAvailable is quantity minus dirty_count', () => {
  assert.equal(cleanAvailable(garment({ quantity: 5, dirty_count: 2 })), 3);
  assert.equal(cleanAvailable(garment({ quantity: 5, dirty_count: 5 })), 0);
});

test('clamp keeps a value within [min, max]', () => {
  assert.equal(clamp(10, 0, 5), 5);
  assert.equal(clamp(-3, 0, 5), 0);
  assert.equal(clamp(3, 0, 5), 3);
});

// --- quantity / dirty_count invariant --------------------------------------

test('incrementDirty moves one unit to dirty when clean stock exists', () => {
  const g = garment({ quantity: 5, dirty_count: 2 });
  assert.equal(incrementDirty(g), 3);
});

test('incrementDirty refuses to exceed quantity (invariant: dirty_count <= quantity)', () => {
  const g = garment({ quantity: 3, dirty_count: 3 });
  assert.equal(incrementDirty(g), null);
});

test('incrementDirty never returns a value above quantity even at the boundary', () => {
  const g = garment({ quantity: 1, dirty_count: 0 });
  assert.equal(incrementDirty(g), 1);
  assert.equal(incrementDirty(garment({ quantity: 1, dirty_count: 1 })), null);
});

test('decrementDirty moves one unit back to clean', () => {
  const g = garment({ quantity: 5, dirty_count: 3 });
  assert.equal(decrementDirty(g), 2);
});

test('decrementDirty refuses to go below zero (invariant: dirty_count >= 0)', () => {
  const g = garment({ quantity: 5, dirty_count: 0 });
  assert.equal(decrementDirty(g), 0);
});

// --- laundry-reset action ---------------------------------------------------

test('resetAllDirty zeroes dirty_count across every garment', () => {
  const garments = [
    garment({ id: 'a', quantity: 5, dirty_count: 3 }),
    garment({ id: 'b', quantity: 2, dirty_count: 2 }),
    garment({ id: 'c', quantity: 1, dirty_count: 0 }),
  ];
  const result = resetAllDirty(garments);
  assert.deepEqual(result.map((g) => g.dirty_count), [0, 0, 0]);
});

test('resetAllDirty does not mutate the original array (safe for optimistic rollback)', () => {
  const original = [garment({ id: 'a', quantity: 5, dirty_count: 3 })];
  resetAllDirty(original);
  assert.equal(original[0].dirty_count, 3);
});

test('resetDirtyForIds clears dirty_count only for the given ids (partial laundry loads)', () => {
  const garments = [
    garment({ id: 'a', quantity: 5, dirty_count: 3 }),
    garment({ id: 'b', quantity: 2, dirty_count: 2 }),
    garment({ id: 'c', quantity: 1, dirty_count: 1 }),
  ];
  const result = resetDirtyForIds(garments, new Set(['a', 'c']));
  assert.equal(result.find((g) => g.id === 'a').dirty_count, 0);
  assert.equal(result.find((g) => g.id === 'b').dirty_count, 2); // untouched
  assert.equal(result.find((g) => g.id === 'c').dirty_count, 0);
});

test('resetDirtyForIds does not mutate the original array', () => {
  const original = [garment({ id: 'a', quantity: 5, dirty_count: 3 })];
  resetDirtyForIds(original, new Set(['a']));
  assert.equal(original[0].dirty_count, 3);
});

test('snapshotDirtyCounts captures prior values for undo', () => {
  const garments = [
    garment({ id: 'a', dirty_count: 3 }),
    garment({ id: 'b', dirty_count: 1 }),
  ];
  const snapshot = snapshotDirtyCounts(garments);
  const reset = resetAllDirty(garments);
  assert.equal(reset[0].dirty_count, 0);
  assert.equal(snapshot.get('a'), 3);
  assert.equal(snapshot.get('b'), 1);
});

// --- low stock ---------------------------------------------------------------

test('categoryCleanTotals sums clean-available across all rows in a category', () => {
  const garments = [
    garment({ id: 'a', category: 'socks', quantity: 12, dirty_count: 10 }),
    garment({ id: 'b', category: 'socks', quantity: 4, dirty_count: 4 }),
    garment({ id: 'c', category: 'tops', quantity: 5, dirty_count: 0 }),
  ];
  const totals = categoryCleanTotals(garments);
  assert.equal(totals.get('socks'), 2); // (12-10) + (4-4)
  assert.equal(totals.get('tops'), 5);
});

test('categoryCleanTotals excludes archived garments', () => {
  const garments = [
    garment({ id: 'a', category: 'tops', quantity: 5, dirty_count: 0, is_archived: true }),
  ];
  const totals = categoryCleanTotals(garments);
  assert.equal(totals.has('tops'), false);
});

test('isLowStock triggers at the documented threshold of 2', () => {
  assert.equal(LOW_STOCK_THRESHOLD, 2);
  assert.equal(isLowStock(2), true);
  assert.equal(isLowStock(0), true);
  assert.equal(isLowStock(3), false);
});

// --- outfit availability ------------------------------------------------------

test('isOutfitWearable is true only when every component has clean stock', () => {
  const garmentsById = new Map([
    ['shirt', garment({ id: 'shirt', quantity: 3, dirty_count: 1 })],
    ['pants', garment({ id: 'pants', quantity: 2, dirty_count: 1 })],
  ]);
  assert.equal(isOutfitWearable(['shirt', 'pants'], garmentsById), true);
});

test('isOutfitWearable is false if any single component is fully dirty', () => {
  const garmentsById = new Map([
    ['shirt', garment({ id: 'shirt', quantity: 3, dirty_count: 1 })],
    ['pants', garment({ id: 'pants', quantity: 2, dirty_count: 2 })],
  ]);
  assert.equal(isOutfitWearable(['shirt', 'pants'], garmentsById), false);
});

test('isOutfitWearable is false if a component garment no longer exists', () => {
  const garmentsById = new Map([
    ['shirt', garment({ id: 'shirt', quantity: 3, dirty_count: 0 })],
  ]);
  assert.equal(isOutfitWearable(['shirt', 'deleted-id'], garmentsById), false);
});

// --- filters -------------------------------------------------------------------

test('matchesFilters filters by category, color, and clean/dirty status', () => {
  const g = garment({ category: 'tops', color: 'red', quantity: 4, dirty_count: 4 });
  assert.equal(matchesFilters(g, { category: 'tops', color: 'all', status: 'all' }), true);
  assert.equal(matchesFilters(g, { category: 'bottoms', color: 'all', status: 'all' }), false);
  assert.equal(matchesFilters(g, { category: 'all', color: 'blue', status: 'all' }), false);
  assert.equal(matchesFilters(g, { category: 'all', color: 'all', status: 'clean' }), false);
  assert.equal(matchesFilters(g, { category: 'all', color: 'all', status: 'dirty' }), true);
});

test('matchesFilters scopes by section when a category-to-section map is given', () => {
  const categorySectionById = new Map([
    ['tops', 'clothes'],
    ['towels', 'household'],
  ]);
  const shirt = garment({ category: 'tops' });
  const towel = garment({ category: 'towels' });
  assert.equal(matchesFilters(shirt, { category: 'all', color: 'all', status: 'all', section: 'clothes' }, categorySectionById), true);
  assert.equal(matchesFilters(towel, { category: 'all', color: 'all', status: 'all', section: 'clothes' }, categorySectionById), false);
  assert.equal(matchesFilters(towel, { category: 'all', color: 'all', status: 'all', section: 'household' }, categorySectionById), true);
});

test('matchesFilters ignores section filtering when no category-to-section map is passed', () => {
  const g = garment({ category: 'tops' });
  assert.equal(matchesFilters(g, { category: 'all', color: 'all', status: 'all', section: 'household' }), true);
});
