import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8')
  .replace(/initialize\(\);\s*$/, 'globalThis.marketTest = { parseOwnerSnapshot, ownerMarkets: OWNER_MARKETS, state };');
const context = { location: { hostname: 'warlune.github.io', pathname: '/forever-waylaid-ledger/' } };
runInNewContext(source, context);
const { parseOwnerSnapshot, ownerMarkets, state } = context.marketTest;
state.catalogIds.add(123);

function snapshot(market, faction, auctionHouse) {
  return JSON.stringify({ schemaVersion: 1, market, faction, auctionHouse, completedAt: 1700000000,
    prices: [{ itemId: 123, price: 500, quantity: 2 }] });
}

test('owner markets include PvP Horde and Alliance, with no unsupported realm types', () => {
  assert.equal(ownerMarkets.has('forever.pvp.horde.us'), true);
  assert.equal(ownerMarkets.has('forever.pvp.alliance.us'), true);
  assert.equal(ownerMarkets.has('forever.normal.horde.us'), false);
  assert.equal(ownerMarkets.has('forever.rp.alliance.us'), false);
});

for (const [faction, name] of [['horde', 'Horde'], ['alliance', 'Alliance']]) {
  const market = `forever.pvp.${faction}.us`;
  test(`${name} owner prices are accepted only for the matching faction`, () => {
    const parsed = parseOwnerSnapshot(snapshot(market, name, faction), market);
    assert.equal(parsed.prices.get(123).min, 500);
    const opposite = faction === 'horde' ? 'Alliance' : 'Horde';
    assert.throws(() => parseOwnerSnapshot(snapshot(market, opposite, faction), market));
    assert.throws(() => parseOwnerSnapshot(snapshot(market, name, 'neutral'), market));
    assert.throws(() => parseOwnerSnapshot(snapshot(market, name, faction), `forever.pvp.${faction === 'horde' ? 'alliance' : 'horde'}.us`));
    assert.throws(() => parseOwnerSnapshot(snapshot(market, name, faction).replace('"schemaVersion":1', '"schemaVersion":2'), market));
  });
}
