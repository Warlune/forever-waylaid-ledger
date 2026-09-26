import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPayload, catalogItemIds, parseSavedVariables } from './owner-scan-sync.mjs';

const LUA = `FWL_HORDE_SCAN = {
  ["version"] = 1,
  ["realm"] = "Classic Beta PvP 2",
  ["market"] = "forever.pvp.horde.us",
  ["auctionHouse"] = "horde",
  ["faction"] = "Horde",
  ["zone"] = "Orgrimmar",
  ["zoneMapID"] = 1454,
  ["scannedAt"] = 1790361000,
  ["scanType"] = "full",
  ["itemCount"] = 2,
  ["items"] = {
    [2447] = { ["minUnitBuyout"] = 23, ["quantity"] = 100 },
    [999999] = { ["minUnitBuyout"] = 1, ["quantity"] = 1 },
  },
}`;

test('accepts completed Horde capital data and sends only catalog item prices', () => {
  const snapshot = parseSavedVariables(LUA);
  const payload = buildPayload(snapshot, new Set([2447]), 1790361100);
  assert.deepEqual(payload.prices, [{ itemId: 2447, price: 23, quantity: 100 }]);
  assert.equal(payload.market, 'forever.pvp.horde.us');
  assert.equal(payload.auctionHouse, 'horde');
  assert.equal(payload.zoneMapID, 1454);
  assert.equal(payload.scanType, 'full');
  assert.equal(payload.completedAt, 1790361000);
  assert.equal(buildPayload({ ...snapshot, realm: 'ClassicBetaPvP2' }, new Set([2447]), 1790361100).realm, 'ClassicBetaPvP2');
});

test('rejects a neutral auction scan and a falsely labeled zone', () => {
  const valid = parseSavedVariables(LUA);
  assert.throws(() => buildPayload({ ...valid, zone: 'Booty Bay', zoneMapID: 1434 }, new Set([2447]), 1790361100), /Horde capital/);
  assert.throws(() => buildPayload({ ...valid, zoneMapID: 1434 }, new Set([2447]), 1790361100), /Horde capital/);
  assert.throws(() => buildPayload({ ...valid, auctionHouse: 'neutral' }, new Set([2447]), 1790361100), /Horde auction house/);
  assert.throws(() => buildPayload({ ...valid, realm: 'Another Realm' }, new Set([2447]), 1790361100), /Classic Beta PvP 2/);
});

test('rejects malformed or executable Lua rather than evaluating it', () => {
  assert.throws(() => parseSavedVariables('FWL_HORDE_SCAN = { items = os.execute("calc") }'), /Unsupported SavedVariables expression|Unexpected SavedVariables syntax/);
  assert.throws(() => parseSavedVariables(`${LUA}\nFWL_HORDE_SCAN = {}`), /Unexpected data after/);
});

test('rejects incomplete and corrupted catalog prices', () => {
  const valid = parseSavedVariables(LUA);
  assert.throws(() => buildPayload({ ...valid, itemCount: 3 }, new Set([2447]), 1790361100), /item count/);
  assert.throws(() => buildPayload({ ...valid, items: { 2447: { minUnitBuyout: 0, quantity: 10 } }, itemCount: 1 }, new Set([2447]), 1790361100), /Invalid saved price/);
  assert.throws(() => buildPayload(valid, new Set([2447]), 1790361000 + 8 * 86400), /completion time/);
});

test('every raw recipe ingredient is captured by the addon and accepted by sync', () => {
  const catalog = JSON.parse(readFileSync(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
  const recipes = JSON.parse(readFileSync(new URL('../dist/recipes.json', import.meta.url), 'utf8'));
  const addonCatalog = readFileSync(new URL('../addon/ForeverWaylaidScan/Catalog.lua', import.meta.url), 'utf8');
  const addonIds = new Set([...addonCatalog.matchAll(/\[(\d+)\] = true/g)].map(match => Number(match[1])));
  const rawIds = Object.keys(recipes.metadata.leaves).map(Number);
  const allowedIds = catalogItemIds(catalog, recipes);

  assert.ok(rawIds.length > 0);
  for (const itemId of rawIds) {
    assert.ok(addonIds.has(itemId), `Addon omits raw ingredient ${itemId}`);
    assert.ok(allowedIds.has(itemId), `Sync omits raw ingredient ${itemId}`);
  }

  const snapshot = parseSavedVariables(LUA);
  snapshot.items[783] = { minUnitBuyout: 480, quantity: 12 };
  snapshot.itemCount++;
  const payload = buildPayload(snapshot, allowedIds, 1790361100);
  assert.deepEqual(payload.prices.find(item => item.itemId === 783), { itemId: 783, price: 480, quantity: 12 });
  assert.ok(!payload.prices.some(item => item.itemId === 999999));
  assert.throws(() => buildPayload({ ...snapshot, auctionHouse: 'neutral' }, allowedIds, 1790361100), /Horde auction house/);
});
