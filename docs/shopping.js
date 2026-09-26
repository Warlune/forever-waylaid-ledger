(function () {
  'use strict';

  const createPlan = () => ({
    vendor: 0, query: '', favorBalance: 0, extraFavor: 0, crate: 'best',
    standing: 'Neutral', standingProgress: 0, target: 'Exalted',
    shippingLabelAvailable: false, writ: 'best'
  });
  const selectedByFaction = { horde: new Map(), alliance: new Map() };
  const planByFaction = { horde: createPlan(), alliance: createPlan() };
  let faction = 'horde';
  let selected = selectedByFaction.horde;
  let plan = planByFaction.horde;
  function setFaction(nextFaction) {
    if (nextFaction !== 'horde' && nextFaction !== 'alliance') return;
    faction = nextFaction;
    selected = selectedByFaction[faction];
    plan = planByFaction[faction];
  }
  const standingStart = { Neutral: 0, Friendly: 3000, Honored: 9000, Revered: 21000, Exalted: 42000 };
  const standingSize = { Neutral: 3000, Friendly: 6000, Honored: 12000, Revered: 21000, Exalted: 0 };
  const standingNames = Object.keys(standingStart);
  const whole = value => Math.max(0, Math.min(1000000, Math.floor(Number(value) || 0)));
  const vendorType = vendor => (vendor.items || []).find(item => item.profession)?.profession ||
    ({ 256384: 'General Rewards', 256400: 'Mounts', 256389: 'General Rewards', 256736: 'Mounts' })[vendor.npcId] || 'Other Rewards';

  function vendorItems(vendors) {
    return vendors.flatMap((vendor, index) => (vendor.items || []).map(item => ({ item, vendor, index, key: index + ':' + item.id })));
  }

  function dropdownChoice(items, current, name, rewardKey, metrics, esc, num, moneyOption, moneyWords) {
    const options = items.filter(item => item[rewardKey] > 0).map(item => {
      const metric = metrics(item);
      const short = item.name.replace(/^(Waylaid Crate|Craftsman's Writ):\s*/i, '');
      const description = short + ' · ' + num(item[rewardKey]) + ' ' + name + ' · ' + moneyWords(metric.total);
      return '<option value="' + esc(item.id) + '" aria-label="' + esc(description) + '"' + (String(current) === String(item.id) ? ' selected' : '') + '>' +
        esc(short) + ' · ' + num(item[rewardKey]) + ' ' + name + ' · ' + moneyOption(metric.total) + '</option>';
    }).join('');
    return '<select id="shop-' + (rewardKey === 'favor' ? 'crate' : 'writ') + '"><option value="best"' + (current === 'best' ? ' selected' : '') +
      '>Lowest estimated cost for this target</option>' + options + '</select>';
  }

  function render(context) {
    if (context.faction) setFaction(context.faction);
    const { catalog, vendors, crateMetrics, writMetrics, fillMode, esc, num, gold, moneyOption, moneyWords } = context;
    if (!vendors) return '<div class="empty">Loading vendor catalogue…</div>';
    if (vendors.error) return '<div class="empty">Vendor catalogue is unavailable: ' + esc(vendors.error) + '</div>';
    const all = vendorItems(vendors.vendors || []);
    const cart = all.filter(entry => selected.has(entry.key)).map(entry => ({ ...entry, qty: selected.get(entry.key) }));
    const requiredStanding = cart.map(entry => entry.item.reputation).filter(name => standingNames.includes(name))
      .sort((a, b) => standingStart[b] - standingStart[a])[0] || null;
    if (requiredStanding && standingStart[requiredStanding] > standingStart[plan.target]) plan.target = requiredStanding;
    const cartFavor = cart.reduce((sum, entry) => sum + entry.qty * (Number(entry.item.cost) || 0), 0);
    const cartCopper = cart.reduce((sum, entry) => sum + entry.qty * (Number(entry.item.copper) || 0), 0);
    const targetFavor = cartFavor + whole(plan.extraFavor);
    const favorNeeded = Math.max(0, targetFavor - whole(plan.favorBalance));
    const crates = catalog.crates.filter(crate => crate.favor > 0);
    const crateCandidates = crates.map(crate => {
      const m = crateMetrics(crate);
      const count = Math.ceil(favorNeeded / crate.favor);
      return { record: crate, total: m.total, count, cost: m.total == null ? null : m.total * count };
    });
    const selectedCrate = plan.crate === 'best' ? crateCandidates.filter(entry => entry.cost != null)
      .sort((a, b) => a.cost - b.cost || a.count - b.count)[0] || null :
      crateCandidates.find(entry => String(entry.record.id) === String(plan.crate)) || null;
    const currentRep = Math.min(42000, standingStart[plan.standing] + Math.min(whole(plan.standingProgress), standingSize[plan.standing]));
    const targetRep = standingStart[plan.target];
    const introRep = plan.shippingLabelAvailable && currentRep < targetRep ? 2000 : 0;
    const repNeeded = Math.max(0, targetRep - currentRep - introRep);
    const writCandidates = catalog.writs.filter(writ => writ.rep > 0).map(writ => {
      const m = writMetrics(writ);
      const count = Math.ceil(repNeeded / writ.rep);
      return { record: writ, total: m.total, count, cost: m.total == null ? null : m.total * count };
    });
    const selectedWrit = plan.writ === 'best' ? writCandidates.filter(entry => entry.cost != null)
      .sort((a, b) => a.cost - b.cost || a.count - b.count)[0] || null :
      writCandidates.find(entry => String(entry.record.id) === String(plan.writ)) || null;
    const activeVendor = (vendors.vendors || [])[plan.vendor] || null;
    const q = plan.query.trim().toLowerCase();
    const shown = activeVendor ? (activeVendor.items || []).filter(item => !q || item.name.toLowerCase().includes(q)) : [];
    const tabs = (vendors.vendors || []).map((vendor, index) =>
      '<button type="button" class="vendor-tab' + (index === plan.vendor ? ' active' : '') + '" data-vendor="' + index +
      '" aria-pressed="' + (index === plan.vendor) + '" title="' + esc(vendor.name) + '" aria-label="' +
      esc(vendorType(vendor) + ' — ' + vendor.name + ', ' + (vendor.items || []).length + ' rewards') + '">' + esc(vendorType(vendor)) +
      '<small>' + num((vendor.items || []).length) + '</small></button>').join('');
    const itemRows = shown.map(item => {
      const key = plan.vendor + ':' + item.id;
      const qty = selected.get(key) || 0;
      const link = '<a href="https://www.wowhead.com/forever/item=' + Number(item.id) +
        '" data-wowhead="domain=forever&amp;item=' + Number(item.id) +
        '" target="_blank" rel="noopener noreferrer">' + esc(item.name) + '</a>';
      return '<div class="vendor-item"><span class="vendor-name">' + link +
        (item.reputation ? '<small>Requires ' + esc(item.reputation) + '</small>' : '') +
        '</span><strong>' + num(item.cost) + ' Favor' + (item.copper ? '<small>+ ' + gold(item.copper) + '</small>' : '') +
        '</strong><div class="shop-stepper"><button type="button" data-cart="minus" data-key="' + esc(key) +
        '" aria-label="Remove one ' + esc(item.name) + '">−</button><output>' + num(qty) + '</output><button type="button" data-cart="plus" data-key="' + esc(key) +
        '" aria-label="Add one ' + esc(item.name) + '">+</button></div></div>';
    }).join('');
    const cartRows = cart.map(entry => '<div class="shop-cart-row"><span>' + num(entry.qty) + ' × ' + esc(entry.item.name) +
      '<small>' + esc(entry.vendor.name) + '</small></span><strong>' + num(entry.qty * entry.item.cost) + ' Favor' +
      (entry.item.copper ? '<small>+ ' + gold(entry.qty * entry.item.copper) + '</small>' : '') + '</strong>' +
      '<button type="button" data-cart="clear" data-key="' + esc(entry.key) + '" aria-label="Remove ' + esc(entry.item.name) + '">×</button></div>').join('');
    const crateText = favorNeeded === 0 ? '<strong>Favor goal met</strong><span>No more crates needed for this list.</span>' :
      selectedCrate ? '<strong>' + num(selectedCrate.count) + ' crates · ' + gold(selectedCrate.cost) + '</strong><span>' +
        esc(selectedCrate.record.name.replace(/^Waylaid Crate:\s*/i, '')) + ' · ' + num(selectedCrate.record.favor) +
        ' Favor each · ' + gold(selectedCrate.total) + ' estimated each</span>' :
        '<strong>No priced crate available</strong><span>Choose a crate to see the count; its buyout is not currently priced.</span>';
    const writText = repNeeded === 0 ? '<strong>Reputation goal met</strong><span>No more writs needed for this goal.</span>' :
      selectedWrit ? '<strong>' + num(selectedWrit.count) + ' writs · ' + gold(selectedWrit.cost) + '</strong><span>' +
        esc(selectedWrit.record.name.replace(/^Craftsman's Writ:\s*/i, '')) + ' · ' + num(selectedWrit.record.rep) +
        ' rep each · ' + gold(selectedWrit.total) + ' estimated each</span>' :
        '<strong>No priced writ available</strong><span>Choose a writ to see the count; its buyout is not currently priced.</span>';
    return '<div class="shopping-intro"><div><h2>Vendor shopping</h2><p>Choose rewards, then plan Merchant’s Favor and faction reputation separately. Estimates use ' +
      (fillMode === 'craft' ? 'making the goods from auction-valued materials.' : 'buying finished goods.') +
      ' Detailed item tooltips load from Wowhead when you open Shopping.</p></div>' +
      '<span>' + num(vendors.vendors?.length || 0) + ' vendors · ' + num(all.length) + ' sale listings</span></div>' +
      '<div class="shopping-layout"><section class="shop-panel vendor-panel"><div class="shop-heading"><h3>Shop by type</h3><label>Find reward<input id="vendor-search" type="search" value="' + esc(plan.query) + '" placeholder="Search this vendor"></label></div>' +
      '<div class="vendor-tabs" role="group" aria-label="Vendor types">' + tabs + '</div>' +
      '<div class="vendor-location">' + (activeVendor ? '<strong>' + esc(activeVendor.name) + '</strong>' +
        (activeVendor.location ? '<span>' + esc(activeVendor.location) + '</span>' : '') +
        (activeVendor.npcId ? '<a href="https://www.wowhead.com/forever/npc=' + Number(activeVendor.npcId) + '" target="_blank" rel="noopener noreferrer">Vendor source ↗</a>' : '') : '') + '</div>' +
      '<div class="vendor-head"><span>REWARD</span><span>COST</span><span>ADD</span></div>' +
      '<div class="vendor-list">' + (itemRows || '<div class="shop-empty">No rewards match this search.</div>') + '</div></section>' +
      '<aside class="shop-panel shop-cart"><div class="shop-cart-head"><h3>Shopping list</h3><button type="button" id="shop-clear"' +
      (cart.length ? '' : ' disabled') + '>Clear list</button></div>' +
      (cartRows || '<p class="shop-empty">Add a vendor reward with +.</p>') +
      '<div class="shop-subtotal"><span>Vendor cost</span><strong>' + num(cartFavor) + ' Favor</strong></div>' +
      (cartCopper ? '<div class="shop-subtotal"><span>Extra vendor gold</span><strong>' + gold(cartCopper) + '</strong></div>' : '') +
      '<label class="shop-field">Favor already held<input id="shop-favor-balance" type="number" min="0" step="1" value="' + whole(plan.favorBalance) + '"></label>' +
      '<label class="shop-field">Other Favor wanted<input id="shop-extra-favor" type="number" min="0" step="1" value="' + whole(plan.extraFavor) + '"></label>' +
      '<div class="shop-goal"><span>More Favor needed</span><strong>' + num(favorNeeded) + '</strong></div>' +
      '<div class="shop-plan"><h4>Crate estimate</h4><label class="sr-only" for="shop-crate">Crate choice</label>' +
      dropdownChoice(crates, plan.crate, 'Favor', 'favor', crateMetrics, esc, num, moneyOption, moneyWords) +
      '<div class="shop-plan-result">' + crateText + '</div>' +
      (selectedCrate?.cost != null && cartCopper ? '<div class="shop-gold-outlay">Estimated crates + vendor gold: <strong>' + gold(selectedCrate.cost + cartCopper) + '</strong></div>' : '') +
      '<small>Based on one crate type and observed beta Favor payouts. Auction stock, repeat limits, and unverified higher-tier rewards can change the result.</small></div></aside></div>' +
      '<section class="shop-panel rep-panel"><div class="shop-heading"><div><h3>Reputation goal</h3><p>Craftsman’s Writs earn ' +
      (faction === 'alliance' ? 'Azeroth Commerce Authority' : 'Durotar Supply and Logistics') +
      ' reputation. Filled crates earn Merchant’s Favor.</p>' +
      (requiredStanding ? '<p class="shop-rep-gate">Your shopping list requires ' + esc(requiredStanding) + ' reputation.</p>' : '') + '</div></div>' +
      '<div class="rep-fields"><label>Current standing<select id="shop-standing">' + standingNames.map(name => '<option' + (plan.standing === name ? ' selected' : '') + '>' + name + '</option>').join('') + '</select></label>' +
      '<label>Progress in standing<input id="shop-standing-progress" type="number" min="0" max="' + standingSize[plan.standing] + '" step="1" value="' + whole(plan.standingProgress) + '"' + (plan.standing === 'Exalted' ? ' disabled' : '') + '></label>' +
      '<label>Target standing<select id="shop-target">' + standingNames.slice(1).map(name => '<option' + (plan.target === name ? ' selected' : '') + '>' + name + '</option>').join('') + '</select></label>' +
      '<label class="rep-check"><input id="shop-shipping" type="checkbox"' + (plan.shippingLabelAvailable ? ' checked' : '') + '> I can still do Shipping Label (+2,000 rep, once)</label></div>' +
      '<div class="rep-estimate"><div><small>Remaining after one-time quest</small><strong>' + num(repNeeded) + ' rep</strong></div><div class="shop-plan"><h4>Writ estimate</h4><label class="sr-only" for="shop-writ">Writ choice</label>' +
      dropdownChoice(catalog.writs, plan.writ, 'rep', 'rep', writMetrics, esc, num, moneyOption, moneyWords) +
      '<div class="shop-plan-result">' + writText + '</div></div></div>' +
      '<p class="shop-note">Counts assume you can repeat the selected writ enough times; the quests are marked daily, and actual availability may limit the pace. Gold estimates use the selected goods pricing and current lowest observed prices; actual stock may cost more.</p></section>' +
      (vendors.unassigned?.length ? '<p class="shop-note">' + num(vendors.unassigned.length) + ' beta sale items could not be assigned to a verified ' +
        (faction === 'alliance' ? 'Alliance' : 'Horde') + ' vendor, so they are not listed in these vendor tabs.</p>' : '');
  }

  function bind(root, rerender) {
    root.querySelector('#shop-clear')?.addEventListener('click', () => {
      selected.clear();
      rerender();
    });
    root.querySelectorAll('[data-vendor]').forEach(button => button.addEventListener('click', () => {
      plan.vendor = Number(button.dataset.vendor);
      plan.query = '';
      rerender();
    }));
    root.querySelectorAll('[data-cart]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.key;
      const current = selected.get(key) || 0;
      const next = button.dataset.cart === 'clear' ? 0 : button.dataset.cart === 'plus' ? current + 1 : current - 1;
      if (next > 0) selected.set(key, Math.min(999, next)); else selected.delete(key);
      rerender();
    }));
    const search = root.querySelector('#vendor-search');
    search?.addEventListener('input', () => {
      plan.query = search.value;
      const caret = search.selectionStart;
      rerender();
      const replacement = root.querySelector('#vendor-search');
      replacement?.focus();
      replacement?.setSelectionRange(caret, caret);
    });
    const fields = {
      '#shop-favor-balance': 'favorBalance', '#shop-extra-favor': 'extraFavor',
      '#shop-crate': 'crate', '#shop-standing': 'standing',
      '#shop-standing-progress': 'standingProgress', '#shop-target': 'target', '#shop-writ': 'writ'
    };
    Object.entries(fields).forEach(([selector, key]) => root.querySelector(selector)?.addEventListener('change', event => {
      plan[key] = event.target.value;
      if (key === 'standing') plan.standingProgress = 0;
      rerender();
    }));
    root.querySelector('#shop-shipping')?.addEventListener('change', event => {
      plan.shippingLabelAvailable = event.target.checked;
      rerender();
    });
  }

  window.ShoppingTab = { render, bind, setFaction };
})();
