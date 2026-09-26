// Keep the in-game scan allowlist aligned with the site's turn-ins and raw materials.
import { readFile, writeFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(await readFile(new URL('../dist/recipes.json', import.meta.url), 'utf8'));
const ids = new Set();
for (const crate of catalog.crates) {
  ids.add(crate.id);
  for (const option of crate.options) ids.add(option.itemId);
}
for (const writ of catalog.writs) {
  ids.add(writ.id);
  ids.add(writ.targetId);
}
for (const id of Object.keys(recipes.metadata.leaves)) ids.add(Number(id));
const lines = [...ids].sort((a, b) => a - b).map(id => `  [${id}] = true,`);
const source = [
  'local _, Addon = ...', '',
  '-- Generated from the site catalog and recipes. Track crate and writ buyouts,',
  '-- every listed fill and delivery item, and raw crafting ingredients.',
  'Addon.catalog = {', ...lines, '}', ''
].join('\n');
await writeFile(new URL('../addon/ForeverWaylaidScan/Catalog.lua', import.meta.url), source);
console.log(`Wrote in-game scan catalog with ${ids.size} relevant item IDs.`);
