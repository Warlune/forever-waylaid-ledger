import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPayload, catalogItemIds, parseSavedVariables, syncOnce } from './owner-scan-sync.mjs';

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
  const snapshot = parseSavedVariables(LUA).Horde;
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
  const valid = parseSavedVariables(LUA).Horde;
  assert.throws(() => buildPayload({ ...valid, zone: 'Booty Bay', zoneMapID: 1434 }, new Set([2447]), 1790361100), /faction capital/);
  assert.throws(() => buildPayload({ ...valid, zoneMapID: 1434 }, new Set([2447]), 1790361100), /faction capital/);
  assert.throws(() => buildPayload({ ...valid, auctionHouse: 'neutral' }, new Set([2447]), 1790361100), /faction auction house/);
  assert.throws(() => buildPayload({ ...valid, realm: 'Another Realm' }, new Set([2447]), 1790361100), /Classic Beta PvP 2/);
});

test('accepts Alliance capital scans while rejecting shared and neutral auction markets', () => {
  const horde = parseSavedVariables(LUA).Horde;
  for (const [zone, zoneMapID] of Object.entries({ 'Stormwind City': 1453, Ironforge: 1455, Darnassus: 1457, 'The Exodar': 1947 })) {
    const alliance = { ...horde, faction: 'Alliance', market: 'forever.pvp.alliance.us', auctionHouse: 'alliance', zone, zoneMapID };
    const payload = buildPayload(alliance, new Set([2447]), 1790361100);
    assert.equal(payload.faction, 'Alliance');
    assert.equal(payload.market, 'forever.pvp.alliance.us');
    assert.equal(payload.auctionHouse, 'alliance');
  }
  const alliance = { ...horde, faction: 'Alliance', market: 'forever.pvp.alliance.us', auctionHouse: 'alliance', zone: 'Stormwind City', zoneMapID: 1453 };
  assert.throws(() => buildPayload({ ...alliance, zone: 'Shattrath City', zoneMapID: 1955 }, new Set([2447]), 1790361100), /faction capital/);
  assert.throws(() => buildPayload({ ...alliance, zone: 'Booty Bay', zoneMapID: 1434 }, new Set([2447]), 1790361100), /faction capital/);
  assert.throws(() => buildPayload({ ...alliance, auctionHouse: 'neutral' }, new Set([2447]), 1790361100), /faction auction house/);
  assert.throws(() => buildPayload({ ...alliance, market: horde.market }, new Set([2447]), 1790361100), /faction auction house/);
  assert.throws(() => buildPayload({ ...alliance, faction: 'Horde' }, new Set([2447]), 1790361100), /faction auction house/);
});

test('rejects malformed or executable Lua rather than evaluating it', () => {
  assert.throws(() => parseSavedVariables('FWL_HORDE_SCAN = { items = os.execute("calc") }'), /Unsupported SavedVariables expression|Unexpected SavedVariables syntax/);
  assert.throws(() => parseSavedVariables(`${LUA}\nFWL_HORDE_SCAN = {}`), /Duplicate faction scan/);
  assert.throws(() => parseSavedVariables(`${LUA}\nOTHER_SCAN = {}`), /ForeverWaylaidScan saved file/);
  assert.throws(() => parseSavedVariables(''), /no faction scan snapshots/);
});

test('rejects incomplete and corrupted catalog prices', () => {
  const valid = parseSavedVariables(LUA).Horde;
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

  const snapshot = parseSavedVariables(LUA).Horde;
  snapshot.items[783] = { minUnitBuyout: 480, quantity: 12 };
  snapshot.itemCount++;
  const payload = buildPayload(snapshot, allowedIds, 1790361100);
  assert.deepEqual(payload.prices.find(item => item.itemId === 783), { itemId: 783, price: 480, quantity: 12 });
  assert.ok(!payload.prices.some(item => item.itemId === 999999));
  assert.throws(() => buildPayload({ ...snapshot, auctionHouse: 'neutral' }, allowedIds, 1790361100), /faction auction house/);
});

test('parses independent Horde and Alliance SavedVariables in either order', () => {
  const alliance = LUA.replace('FWL_HORDE_SCAN', 'FWL_ALLIANCE_SCAN')
    .replace('forever.pvp.horde.us', 'forever.pvp.alliance.us')
    .replace('["auctionHouse"] = "horde"', '["auctionHouse"] = "alliance"')
    .replace('["faction"] = "Horde"', '["faction"] = "Alliance"')
    .replace('["zone"] = "Orgrimmar"', '["zone"] = "Stormwind City"')
    .replace('["zoneMapID"] = 1454', '["zoneMapID"] = 1453');
  for (const source of [`${LUA}\n${alliance}`, `${alliance}\n${LUA}`]) {
    const snapshots = parseSavedVariables(source);
    assert.equal(snapshots.Horde.faction, 'Horde');
    assert.equal(snapshots.Alliance.faction, 'Alliance');
    assert.equal(buildPayload(snapshots.Alliance, new Set([2447]), 1790361100).zone, 'Stormwind City');
  }
});

test('checks and publishes faction markets independently', async () => {
  const timestamp = Math.floor(Date.now() / 1000) - 60;
  const horde = LUA.replace('1790361000', String(timestamp));
  const alliance = horde.replace('FWL_HORDE_SCAN', 'FWL_ALLIANCE_SCAN')
    .replace('forever.pvp.horde.us', 'forever.pvp.alliance.us')
    .replace('["auctionHouse"] = "horde"', '["auctionHouse"] = "alliance"')
    .replace('["faction"] = "Horde"', '["faction"] = "Alliance"')
    .replace('["zone"] = "Orgrimmar"', '["zone"] = "Stormwind City"')
    .replace('["zoneMapID"] = 1454', '["zoneMapID"] = 1453');
  const directory = await mkdtemp(path.join(tmpdir(), 'fwl-sync-'));
  const scanFile = path.join(directory, 'ForeverWaylaidScan.lua');
  const seen = [];
  const originalFetch = globalThis.fetch;
  await writeFile(scanFile, `${horde}\n${alliance}`);
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body);
      seen.push({ method: 'POST', market: payload.market });
      return new Response('{}', { status: 200 });
    }
    const market = new URL(url).searchParams.get('market');
    seen.push({ method: 'GET', market });
    return new Response('{}', { status: 404 });
  };
  try {
    const first = await syncOnce({ scanFile, token: 'x'.repeat(32) }, new Set([2447]));
    assert.deepEqual(first.errors, []);
    assert.deepEqual(first.results.map(result => result.status), ['published', 'published']);
    assert.deepEqual(seen, [
      { method: 'GET', market: 'forever.pvp.horde.us' },
      { method: 'POST', market: 'forever.pvp.horde.us' },
      { method: 'GET', market: 'forever.pvp.alliance.us' },
      { method: 'POST', market: 'forever.pvp.alliance.us' },
    ]);
    const second = await syncOnce({ scanFile, token: 'x'.repeat(32) }, new Set([2447]), first.digests);
    assert.deepEqual(second.results.map(result => result.status), ['unchanged', 'unchanged']);
    assert.equal(seen.length, 4);

    // A mislabelled Alliance SavedVariable cannot publish Horde prices twice.
    await writeFile(scanFile, `${horde}\n${horde.replace('FWL_HORDE_SCAN', 'FWL_ALLIANCE_SCAN')}`);
    const mixed = await syncOnce({ scanFile, token: 'x'.repeat(32) }, new Set([2447]), first.digests);
    assert.deepEqual(mixed.results.map(result => result.status), ['unchanged']);
    assert.equal(mixed.errors.length, 1);
    assert.equal(mixed.errors[0].faction, 'Alliance');
    assert.match(mixed.errors[0].error.message, /Alliance saved variable contains a Horde scan/);
    assert.equal(seen.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
