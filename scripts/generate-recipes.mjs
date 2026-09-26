// Build the crate and writ crafting graph from the Forever beta client's DB2 tables.
// Pin the build so recipe costs never silently mix versions. A local CSV directory
// can be used for repeatable/offline regeneration: WAYLAID_DB2_DIR=path.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const build = '1.60.1.70009';
const tables = ['SpellReagents', 'SpellEffect', 'SkillLineAbility', 'SpellName', 'ItemSparse'];
const catalog = JSON.parse(await readFile(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
if (catalog.metadata.clientBuild !== build) throw new Error('Recipe and turn-in catalogue builds differ.');
const outputUrl = new URL('../dist/recipes.json', import.meta.url);
const professionNames = new Map([
  [164, 'Blacksmithing'], [165, 'Leatherworking'], [171, 'Alchemy'],
  [186, 'Mining'], [197, 'Tailoring'], [202, 'Engineering'], [333, 'Enchanting']
]);
// These are stocked vendor supplies. Other leaves use auction value even when
// the client lists a BuyPrice, since that field alone does not prove vendor stock.
const vendorReagents = new Set([
  2320, 2321, 2324, 2325, 2604, 2605, 2880, 3371, 3372, 3466,
  3857, 4289, 4291, 4340, 4341, 4342, 4400, 4470, 6260, 6261,
  8343, 8925, 14341, 18256
]);
const caveats = new Map([
  [11371, 'Smelt Dark Iron requires the Black Forge in Blackrock Depths and learning the spell from The Spectral Chalice.'],
  [7929, 'The Orcish War Leggings plans are Horde-only. Alliance crafters should verify access before relying on this estimate.'],
  [18587, 'Requires Goblin Engineering specialization.'],
  [18645, 'Requires Gnomish Engineering specialization.'],
  [18232, 'The Field Repair Bot schematic is found in Blackrock Depths.'],
  [21277, 'The Tranquil Mechanical Yeti schematic is learned from a quest.']
]);

function parseCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(value); value = ''; }
    else if (ch === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += ch;
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  if (row.length || value) { row.push(value); rows.push(row); }
  const [header, ...body] = rows;
  if (!header?.length) throw new Error('Empty DB2 table.');
  return body.filter(row => row.length === header.length)
    .map(row => Object.fromEntries(header.map((column, index) => [column, row[index]])));
}

async function loadTable(name) {
  const local = process.env.WAYLAID_DB2_DIR;
  let csv;
  if (local) csv = await readFile(join(local, `${name}.csv`), 'utf8');
  else {
    const url = `https://wago.tools/db2/${name}/csv?build=${build}&locale=enUS`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status} from ${url}`);
    csv = await response.text();
  }
  const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
  if (!rows.length) throw new Error(`${name} has no records.`);
  return rows;
}

const [reagentRows, effectRows, abilityRows, spellRows, itemRows] = await Promise.all(tables.map(loadTable));
const items = new Map(itemRows.map(row => [Number(row.ID), row]));
const spellNames = new Map(spellRows.map(row => [Number(row.ID), row.Name_lang]));
const reagentsBySpell = new Map();
for (const row of reagentRows) {
  const reagents = [];
  for (let i = 0; i < 8; i++) {
    const itemId = Number(row[`Reagent_${i}`]);
    const qty = Number(row[`ReagentCount_${i}`]);
    if (itemId > 0 && qty > 0) reagents.push({ itemId, qty });
  }
  if (reagents.length) reagentsBySpell.set(Number(row.SpellID), reagents);
}
const professionBySpell = new Map();
for (const row of abilityRows) {
  const profession = professionNames.get(Number(row.SkillLine));
  if (profession) professionBySpell.set(Number(row.Spell), profession);
}
const effectsByItem = new Map();
for (const row of effectRows) {
  if (Number(row.Effect) !== 24) continue;
  const itemId = Number(row.EffectItemType), spellId = Number(row.SpellID), output = Number(row.EffectBasePointsF);
  if (!itemId || !spellId || !Number.isSafeInteger(output) || output < 1 || !professionBySpell.has(spellId)) continue;
  if (!effectsByItem.has(itemId)) effectsByItem.set(itemId, []);
  effectsByItem.get(itemId).push({ spellId, output, variance: Number(row.Variance) || 0 });
}

const oldData = JSON.parse(await readFile(outputUrl, 'utf8'));
const oldBySpell = new Map(Object.values(oldData.recipes).flat().map(recipe => [recipe.spellId, recipe]));
const names = new Map();
for (const crate of catalog.crates) for (const option of crate.options) names.set(option.itemId, option.name);
for (const writ of catalog.writs) names.set(writ.targetId, writ.targetName);
const nameOf = itemId => items.get(itemId)?.Display_lang || names.get(itemId) || oldData.metadata.leaves?.[itemId]?.name || `Item ${itemId}`;

const recipes = new Map(), leaves = new Map(), active = new Set();
function candidateRecipes(itemId) {
  return (effectsByItem.get(itemId) || []).filter(effect => {
    const name = spellNames.get(effect.spellId) || '';
    return reagentsBySpell.has(effect.spellId) && !/\b(?:test|old|mass|transmute|melt key)\b/i.test(name);
  });
}
function visit(itemId) {
  if (recipes.has(itemId) || leaves.has(itemId)) return;
  if (active.has(itemId)) throw new Error(`Crafting recipe cycle at item ${itemId}.`);
  active.add(itemId);
  const candidates = candidateRecipes(itemId);
  if (!candidates.length) {
    const item = items.get(itemId);
    if (!item) throw new Error(`No beta client item record for ${itemId}.`);
    const vendorCopper = Number(item.BuyPrice);
    leaves.set(itemId, {
      itemId, name: nameOf(itemId), sourceUrl: `https://www.wowhead.com/forever/item=${itemId}`,
      ...(vendorReagents.has(itemId) && Number.isSafeInteger(vendorCopper) && vendorCopper > 0 ? { vendorCopper } : {})
    });
  } else {
    const variants = candidates.map(({ spellId, output, variance }) => {
      const outputMin = Math.max(1, Math.round(output * (1 - variance / 2)));
      const outputMax = Math.max(outputMin, Math.round(output * (1 + variance / 2)));
      const reagents = reagentsBySpell.get(spellId).map(reagent => ({ ...reagent, name: nameOf(reagent.itemId) }));
      for (const reagent of reagents) visit(reagent.itemId);
      const old = oldBySpell.get(spellId);
      const recipe = {
        itemId, name: nameOf(itemId), spellId, profession: professionBySpell.get(spellId),
        skill: old?.skill ?? (spellId === 1244421 ? 260 : 0),
        outputMin, outputMax, reagents,
        sourceUrl: `https://www.wowhead.com/forever/spell=${spellId}`
      };
      const caveat = caveats.get(itemId);
      if (caveat) recipe.caveat = caveat;
      return recipe;
    });
    recipes.set(itemId, variants.length === 1 ? variants[0] : variants);
  }
  active.delete(itemId);
}

const crateItems = [...new Set(catalog.crates.flatMap(crate => crate.options.map(option => option.itemId)))].sort((a, b) => a - b);
const writItems = [...new Set(catalog.writs.map(writ => writ.targetId))].sort((a, b) => a - b);
if (catalog.crates.length !== 30 || crateItems.length !== 96 || catalog.writs.length !== 150 || writItems.length !== 150) {
  throw new Error('Unexpected crate or writ catalogue size.');
}
for (const itemId of new Set([...crateItems, ...writItems])) visit(itemId);
const missingWrits = writItems.filter(itemId => !recipes.has(itemId));
if (missingWrits.length) throw new Error(`No verified craft for writ targets: ${missingWrits.map(id => `${id} ${nameOf(id)}`).join(', ')}`);
const alternateItems = [...recipes].filter(([, recipe]) => Array.isArray(recipe)).map(([itemId]) => itemId);
if (alternateItems.some(itemId => itemId !== 18258)) throw new Error(`Review newly found alternate recipes for: ${alternateItems.join(', ')}`);

const ordered = map => Object.fromEntries([...map].sort(([a], [b]) => a - b).map(([id, value]) => [id, value]));
const output = {
  metadata: {
    source: 'https://wago.tools/db2', clientBuild: build,
    crateCount: catalog.crates.length, fillOptionCount: crateItems.length,
    craftedFillOptionCount: crateItems.filter(id => recipes.has(id)).length,
    writCount: catalog.writs.length, verifiedWritTargetCount: writItems.length,
    recipeCount: recipes.size, leafCount: leaves.size, leaves: ordered(leaves)
  },
  recipes: ordered(recipes)
};
await writeFile(outputUrl, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${outputUrl.pathname}: ${output.metadata.craftedFillOptionCount}/${crateItems.length} craftable crate fills, ${writItems.length}/${writItems.length} writ targets, ${recipes.size} recipes, ${leaves.size} raw materials.`);
