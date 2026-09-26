import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const scope = { window: {} };
runInNewContext(readFileSync(new URL('../dist/crafting.js', import.meta.url), 'utf8'), scope);
const { quote } = scope.window.Crafting;

function recipe(itemId, reagents, outputMin = 1, outputMax = outputMin) {
  return { itemId, name: `Crafted ${itemId}`, spellId: itemId + 1000,
    profession: 'Engineering', skill: 1, outputMin, outputMax,
    reagents: reagents.map(([id, qty]) => ({ itemId: id, name: `Item ${id}`, qty })),
    sourceUrl: `https://example.com/spell/${itemId}` };
}

function data(recipes, leaves) {
  return { metadata: { leaves: Object.fromEntries(leaves.map(([id, vendorCopper]) =>
    [id, { itemId: id, name: `Raw ${id}`, ...(vendorCopper == null ? {} : { vendorCopper }) }])) },
    recipes: Object.fromEntries(recipes.map(entry => [entry.itemId, entry])) };
}

test('rounds whole crafts using guaranteed output and marks variable yields', () => {
  const dataset = data([recipe(100, [[200, 2]], 2), recipe(101, [[200, 1]], 2, 4)], [[200]]);
  const prices = () => ({ min: 5, quantity: 50 });
  const fixed = quote({ itemId: 100, name: 'Fixed output', qty: 3 }, dataset, prices);
  assert.equal(fixed.steps[0].crafts, 2);
  assert.equal(fixed.materials[0].qty, 4);
  assert.equal(fixed.cost, 20);
  assert.equal(fixed.variableYield, false);
  const variable = quote({ itemId: 101, qty: 3 }, dataset, prices);
  assert.equal(variable.steps[0].crafts, 2);
  assert.equal(variable.materials[0].qty, 2);
  assert.equal(variable.variableYield, true);
});

test('batches a shared nested component before rounding its recipe yield', () => {
  const dataset = data([
    recipe(100, [[200, 1], [300, 1]]),
    recipe(200, [[400, 1]]),
    recipe(300, [[400, 1]]),
    recipe(400, [[500, 3]], 2)
  ], [[500]]);
  const result = quote({ itemId: 100, qty: 1 }, dataset, () => ({ min: 11, quantity: 100 }));
  assert.equal(result.steps.find(step => step.itemId === 400).crafts, 1);
  assert.equal(result.materials[0].qty, 3);
  assert.equal(result.cost, 33);
  assert.equal(result.steps.at(-1).itemId, 100);
});

test('uses the cheaper raw source and vendor fallback when no auction exists', () => {
  const dataset = data([recipe(100, [[200, 3]])], [[200, 100]]);
  const vendor = quote({ itemId: 100, qty: 1 }, dataset, () => null);
  assert.equal(vendor.cost, 300);
  assert.equal(vendor.materials[0].source, 'vendor');
  assert.equal(vendor.materials[0].quantity, null);
  assert.equal(vendor.enough, true);
  const auction = quote({ itemId: 100, qty: 1 }, dataset, () => ({ min: 80, quantity: 5 }));
  assert.equal(auction.cost, 240);
  assert.equal(auction.materials[0].source, 'auction');
  assert.equal(auction.materials[0].quantity, 5);
});

test('keeps a short-stock estimate and makes an unpriced total unknown', () => {
  const dataset = data([recipe(100, [[200, 2], [300, 2]])], [[200], [300]]);
  const missing = quote({ itemId: 100, qty: 1 }, dataset,
    id => id === 200 ? { min: 10, quantity: 1 } : null);
  assert.equal(missing.cost, null);
  assert.equal(missing.enough, false);
  assert.match(missing.reason, /Missing auction price for Raw 300/);
  assert.equal(missing.materials.find(material => material.itemId === 200).cost, 20);
  const short = quote({ itemId: 100, qty: 1 }, dataset,
    id => ({ min: id === 200 ? 10 : 30, quantity: id === 200 ? 1 : 3 }));
  assert.equal(short.cost, 80);
  assert.equal(short.enough, false);
  assert.match(short.reason, /Auction stock short for Raw 200 \(1\/2\)/);
});

test('rejects cycles, malformed recipes, and nonpositive requests', () => {
  const cyclic = data([recipe(100, [[200, 1]]), recipe(200, [[100, 1]])], []);
  assert.throws(() => quote({ itemId: 100, qty: 1 }, cyclic, () => null), /cycle/i);
  assert.throws(() => quote({ itemId: 100, qty: 0 }, cyclic, () => null), /positive/);
  const malformed = data([recipe(100, [[200, 0]])], [[200]]);
  assert.throws(() => quote({ itemId: 100, qty: 1 }, malformed, () => null), /Invalid reagent/);
  const unknown = quote({ itemId: 999, qty: 1 }, malformed, () => null);
  assert.equal(unknown.cost, null);
  assert.match(unknown.reason, /No verified crafting/);
});

test('selects the affordable available recipe when one item has two professions', () => {
  const first = { ...recipe(100, [[200, 2]]), profession: 'Tailoring' };
  const second = { ...recipe(100, [[300, 1]]), spellId: 2000, profession: 'Leatherworking' };
  const dataset = data([first], [[200], [300]]);
  dataset.recipes[100] = [first, second];
  const prices = id => ({ min: id === 200 ? 10 : 30, quantity: 100 });
  const cheaper = quote({ itemId: 100, qty: 1 }, dataset, prices);
  assert.equal(cheaper.cost, 20);
  assert.equal(cheaper.steps[0].profession, 'Tailoring');
  assert.equal(cheaper.alternatives.length, 2);
  const lowStock = quote({ itemId: 100, qty: 1 }, dataset,
    id => ({ min: id === 200 ? 10 : 30, quantity: id === 200 ? 1 : 100 }));
  assert.equal(lowStock.cost, 30);
  assert.equal(lowStock.steps[0].profession, 'Leatherworking');
});

test('faction eligibility excludes direct and nested Horde-only recipes from Alliance DIY quotes', () => {
  const restricted = { ...recipe(7929, [[200, 2]]), name: 'Orcish War Leggings', allowedFactions: ['horde'] };
  const dataset = data([restricted, recipe(100, [[7929, 1]])], [[200]]);
  let priceCalls = 0;
  const prices = () => { priceCalls++; return { min: 5, quantity: 100 }; };
  for (const itemId of [7929, 100]) {
    const alliance = quote({ itemId, qty: 1 }, dataset, prices, 'alliance');
    assert.equal(alliance.cost, null);
    assert.equal(alliance.enough, false);
    assert.equal(alliance.unavailable, true);
    assert.match(alliance.reason, /Orcish War Leggings.*Horde.*Alliance/);
    assert.equal(alliance.steps.length, 0);
    assert.equal(alliance.materials.length, 0);
    assert.ok(quote({ itemId, qty: 1 }, dataset, prices, 'horde').cost > 0);
    assert.ok(quote({ itemId, qty: 1 }, dataset, prices).cost > 0, 'omitted faction preserves old quotes');
  }
  assert.equal(priceCalls, 4, 'restricted quotes never request material prices');
  assert.throws(() => quote({ itemId: 7929, qty: 1 }, dataset, prices, 'neutral'), /Faction must/);
  dataset.recipes[7929].allowedFactions = ['horde', 'horde'];
  assert.throws(() => quote({ itemId: 7929, qty: 1 }, dataset, prices, 'alliance'), /Invalid faction eligibility/);
});

test('eligible alternate recipes remain available when another variant is faction restricted', () => {
  const restricted = { ...recipe(100, [[200, 1]]), allowedFactions: ['horde'] };
  const shared = { ...recipe(100, [[300, 1]]), spellId: 2000 };
  const dataset = data([restricted], [[200], [300]]);
  dataset.recipes[100] = [restricted, shared];
  const result = quote({ itemId: 100, qty: 1 }, dataset, id => ({ min: id === 200 ? 1 : 10, quantity: 10 }), 'alliance');
  assert.equal(result.cost, 10);
  assert.equal(result.enough, true);
  assert.equal(result.steps[0].spellId, 2000);
  assert.equal(result.alternatives.find(alt => alt.spellId === restricted.spellId).unavailable, true);
});

test('a gathered good uses its auction value without inventing a recipe', () => {
  const dataset = data([], [[200]]);
  const result = quote({ itemId: 200, qty: 5 }, dataset, () => ({ min: 17, quantity: 30 }));
  assert.equal(result.cost, 85);
  assert.equal(result.steps.length, 0);
  assert.equal(result.materials[0].qty, 5);
});

test('every crate choice and writ target resolves through the published crafting graph', () => {
  const dataset = JSON.parse(readFileSync(new URL('../dist/recipes.json', import.meta.url), 'utf8'));
  const catalog = JSON.parse(readFileSync(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
  const roots = [...catalog.crates.flatMap(crate => crate.options),
    ...catalog.writs.map(writ => ({ itemId: writ.targetId, qty: writ.qty, name: writ.targetName }))];
  assert.equal(roots.length, 246);
  for (const root of roots) {
    const result = quote(root, dataset, () => ({ min: 1, quantity: 100000 }));
    assert.equal(result.enough, true, `${root.name}: ${result.reason}`);
    assert.ok(result.cost >= 0, root.name);
    assert.ok(result.materials.length > 0, root.name);
  }
  assert.equal(dataset.recipes[8069].outputMin, 200, 'Crafted Solid Shot yield');
  assert.equal(dataset.recipes[4380].outputMin, 2, 'Big Bronze Bomb minimum yield');
  assert.equal(dataset.recipes[4380].outputMax, 4, 'Big Bronze Bomb maximum yield');
  assert.equal(dataset.recipes[7929].allowedFactions[0], 'horde', 'Orcish War Leggings plan is Horde-only');
  const allianceQuote = quote({ itemId: 7929, qty: 1 }, dataset, () => ({ min: 1, quantity: 100000 }), 'alliance');
  assert.equal(allianceQuote.unavailable, true);
  assert.equal(allianceQuote.cost, null);
});
