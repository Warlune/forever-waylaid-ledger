(function (root) {
  'use strict';

  const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
  const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;

  function quoteSingle(option, dataset, listingFor, chosenRecipe = null, faction = null) {
    if (!option || !positiveInteger(option.itemId) || !positiveInteger(option.qty)) {
      throw new TypeError('A crafting option needs a positive itemId and quantity.');
    }
    if (!dataset || !dataset.recipes || !dataset.metadata || !dataset.metadata.leaves ||
        typeof dataset.recipes !== 'object' || typeof dataset.metadata.leaves !== 'object') {
      throw new TypeError('Crafting recipe and raw material data are required.');
    }
    if (typeof listingFor !== 'function') throw new TypeError('A price lookup function is required.');

    const recipes = chosenRecipe ? { ...dataset.recipes, [option.itemId]: chosenRecipe } : dataset.recipes;
    const leaves = dataset.metadata.leaves;
    const visited = new Map();
    const order = [];
    const unknown = [];
    const restricted = [];

    // Reverse postorder is a topological walk from the requested item toward
    // raw materials. Every parent adds its demand before a shared component is
    // rounded to whole crafts, even if several recipes use that component.
    function visit(id, path) {
      const status = visited.get(id);
      if (status === 'active') throw new Error('Crafting recipe cycle: ' + [...path, id].join(' → '));
      if (status === 'done') return;
      visited.set(id, 'active');
      const recipe = recipes[id];
      if (Array.isArray(recipe)) throw new TypeError('Nested alternate recipes need a reviewed crafting path for item ' + id + '.');
      if (recipe) {
        if (recipe.itemId !== id || typeof recipe.name !== 'string' || !recipe.name.trim() ||
            !positiveInteger(recipe.outputMin) || !positiveInteger(recipe.outputMax) ||
            recipe.outputMax < recipe.outputMin || !Array.isArray(recipe.reagents) ||
            recipe.reagents.length === 0 || !positiveInteger(recipe.spellId) ||
            typeof recipe.profession !== 'string' || !recipe.profession.trim() ||
            !nonnegativeInteger(recipe.skill)) {
          throw new TypeError('Invalid crafting recipe for item ' + id + '.');
        }
        const allowed = recipe.allowedFactions;
        if (allowed !== undefined && (!Array.isArray(allowed) || !allowed.length ||
            allowed.some(name => name !== 'horde' && name !== 'alliance') ||
            new Set(allowed).size !== allowed.length)) {
          throw new TypeError('Invalid faction eligibility for recipe ' + id + '.');
        }
        if (faction && allowed && !allowed.includes(faction)) {
          restricted.push({ name: recipe.name, allowed });
          visited.set(id, 'done');
          return;
        }
        for (const reagent of recipe.reagents) {
          if (!reagent || !positiveInteger(reagent.itemId) || !positiveInteger(reagent.qty)) {
            throw new TypeError('Invalid reagent in recipe for item ' + id + '.');
          }
          visit(reagent.itemId, [...path, id]);
        }
      } else {
        const leaf = leaves[id];
        if (!leaf) unknown.push(id);
        else if (leaf.itemId !== id || typeof leaf.name !== 'string' || !leaf.name.trim() ||
                 (leaf.vendorCopper != null && !nonnegativeInteger(leaf.vendorCopper))) {
          throw new TypeError('Invalid raw material for item ' + id + '.');
        }
      }
      visited.set(id, 'done');
      order.push(id);
    }

    visit(option.itemId, []);
    if (restricted.length) {
      const blocked = restricted[0];
      const allowed = blocked.allowed.map(name => name === 'horde' ? 'Horde' : 'Alliance').join(' or ');
      const selected = faction === 'horde' ? 'Horde' : 'Alliance';
      return {
        cost: null, enough: false, unavailable: true,
        reason: blocked.name + ' can only be crafted by ' + allowed + '; its DIY cost is unavailable for ' + selected + '.',
        materials: [], steps: [], variableYield: false
      };
    }
    if (unknown.length) {
      return {
        cost: null, enough: false,
        reason: 'No verified crafting or raw material data for item ' + unknown.join(', ') + '.',
        materials: [], steps: [], variableYield: false
      };
    }

    order.reverse();
    const demand = new Map([[option.itemId, option.qty]]);
    const steps = [];
    let variableYield = false;
    for (const id of order) {
      const recipe = recipes[id];
      if (!recipe) continue;
      const crafts = Math.ceil((demand.get(id) || 0) / recipe.outputMin);
      if (!crafts) continue;
      if (!positiveInteger(crafts)) throw new RangeError('Crafting quantity is too large.');
      if (recipe.outputMin !== recipe.outputMax) variableYield = true;
      steps.push({
        itemId: id, name: recipe.name, crafts,
        outputMin: recipe.outputMin, outputMax: recipe.outputMax,
        profession: recipe.profession, skill: recipe.skill,
        spellId: recipe.spellId, sourceUrl: recipe.sourceUrl || null
      });
      for (const reagent of recipe.reagents) {
        const next = (demand.get(reagent.itemId) || 0) + crafts * reagent.qty;
        if (!positiveInteger(next)) throw new RangeError('Raw material quantity is too large.');
        demand.set(reagent.itemId, next);
      }
    }

    const materials = [];
    let cost = 0;
    let enough = true;
    const missing = [];
    const short = [];
    for (const id of order) {
      if (recipes[id]) continue;
      const qty = demand.get(id) || 0;
      if (!qty) continue;
      const leaf = leaves[id];
      const listing = listingFor(id);
      const auctionCopper = listing && nonnegativeInteger(listing.min) ? listing.min : null;
      const auctionQuantity = listing && nonnegativeInteger(listing.quantity) ? listing.quantity : null;
      const vendorCopper = leaf.vendorCopper == null ? null : leaf.vendorCopper;
      const useVendor = vendorCopper != null && (auctionCopper == null || vendorCopper <= auctionCopper);
      const unitCopper = useVendor ? vendorCopper : auctionCopper;
      const source = unitCopper == null ? 'unpriced' : useVendor ? 'vendor' : 'auction';
      const materialCost = unitCopper == null ? null : unitCopper * qty;
      if (materialCost != null && !Number.isSafeInteger(materialCost)) {
        throw new RangeError('Crafting cost is too large.');
      }
      materials.push({ itemId: id, name: leaf.name, qty, unitCopper,
        cost: materialCost, source, quantity: source === 'auction' ? auctionQuantity : null });
      if (materialCost == null) {
        enough = false;
        missing.push(leaf.name);
      } else {
        cost += materialCost;
        if (!Number.isSafeInteger(cost)) throw new RangeError('Crafting cost is too large.');
        if (source === 'auction' && auctionQuantity != null && auctionQuantity < qty) {
          enough = false;
          short.push(leaf.name + ' (' + auctionQuantity + '/' + qty + ')');
        }
      }
    }

    return {
      cost: missing.length ? null : cost,
      enough,
      reason: missing.length ? 'Missing auction price for ' + missing.join(', ') + '.' :
        short.length ? 'Auction stock short for ' + short.join(', ') + '.' : null,
      materials,
      steps: steps.reverse(),
      variableYield
    };
  }

  function quote(option, dataset, listingFor, faction = null) {
    if (faction !== null && faction !== 'horde' && faction !== 'alliance') {
      throw new TypeError('Faction must be horde or alliance.');
    }
    const variants = dataset?.recipes?.[option?.itemId];
    if (!Array.isArray(variants)) return quoteSingle(option, dataset, listingFor, null, faction);
    if (!variants.length) throw new TypeError('An alternate recipe list cannot be empty.');
    const choices = variants.map(recipe => ({ recipe, result: quoteSingle(option, dataset, listingFor, recipe, faction) }));
    choices.sort((a, b) => Number(b.result.enough) - Number(a.result.enough) ||
      (a.result.cost ?? Infinity) - (b.result.cost ?? Infinity));
    const best = choices[0].result;
    return { ...best, alternatives: choices.map(({ recipe, result }) => ({
      spellId: recipe.spellId, profession: recipe.profession,
      cost: result.cost, enough: result.enough, unavailable: result.unavailable === true, reason: result.reason
    })) };
  }

  root.Crafting = Object.freeze({ quote });
})(window);
