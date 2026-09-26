import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8')
  .replace(/initialize\(\);\s*$/, 'globalThis.marketTest = { parseOwnerSnapshot, ownerMarkets: OWNER_MARKETS, state, setFaction };');
const elements = new Map();
const element = key => {
  if (!elements.has(key)) elements.set(key, { innerHTML: '', textContent: '', value: '', disabled: false, hidden: false,
    setAttribute(name, value) { this[name] = value; } });
  return elements.get(key);
};
const buttons = ['horde', 'alliance'].map(faction => ({ dataset: { factionChoice: faction },
  setAttribute(name, value) { this[name] = value; } }));
const context = {
  location: { hostname: 'warlune.github.io', pathname: '/forever-waylaid-ledger/' },
  document: { querySelector: element, querySelectorAll: () => buttons, documentElement: { dataset: {} } },
  window: { ShoppingTab: { setFaction() {} } },
  localStorage: { setItem() {} }
};
runInNewContext(source, context);
const { parseOwnerSnapshot, ownerMarkets, state, setFaction } = context.marketTest;
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

test('faction switch offers matching owner scans for both PvP factions', async () => {
  for (const faction of ['horde', 'alliance']) {
    await setFaction(faction, { market: `forever.pvp.${faction}.us`, animate: false });
    assert.equal(state.faction, faction);
    assert.equal(element('#price-source option[value="owner"]').disabled, false);
    assert.equal(element('#price-source option[value="owner"]').hidden, false);
    assert.match(element('#scan-help-copy').innerHTML, /completed Auctionator scans/);
    assert.equal(buttons.find(button => button.dataset.factionChoice === faction)['aria-pressed'], 'true');
  }
  await setFaction('alliance', { market: 'forever.normal.alliance.us', animate: false });
  assert.equal(element('#price-source option[value="owner"]').disabled, true);
  assert.match(element('#scan-help-copy').innerHTML, /uses AHledger prices/);
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
