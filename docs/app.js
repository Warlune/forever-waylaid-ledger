const API = 'https://api.ahledger.com/v1/pricetable/';
const OWNER_SCAN_API = location.hostname === 'warlune.github.io' &&
  location.pathname.startsWith('/forever-waylaid-ledger/')
  ? 'https://forever-waylaid-ledger.warlune.chatgpt.site/api/owner-scan'
  : '/api/owner-scan';
const OWNER_MARKET = 'forever.pvp.horde.us';
const FACTIONS = {
  horde: { name: 'Horde', factionName: 'Durotar Supply and Logistics', themeColor: '#17130e' },
  alliance: { name: 'Alliance', factionName: 'Azeroth Commerce Authority', themeColor: '#0b1729' }
};
const MARKET_TYPES = ['pvp', 'normal', 'rp'];
const state = {
  catalog: null, recipes: null, recipeError: '', vendors: null, catalogIds: new Set(), prices: new Map(), market: 'forever.pvp.horde.us',
  faction: 'horde', vendorCatalogs: { horde: null, alliance: null },
  tab: 'crates', sort: 'efficiency', tier: 'all', fillMode: 'buy', search: '', owned: false,
  scanTime: null, priceState: 'loading', priceError: '', marketGeneration: 0,
  source: 'public', preference: 'auto', feeds: { public: null, owner: null }, feedErrors: {}, fingerprints: {}, blended: null, merged: false
};
const $ = selector => document.querySelector(selector);
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat().format(value);
const moneyParts = copper => {
  if (copper == null || !Number.isFinite(copper)) return null;
  const total = Math.max(0, Math.round(copper));
  const g = Math.floor(total / 10000), s = Math.floor(total % 10000 / 100), c = total % 100;
  return [g ? { value: g, unit: 'gold', symbol: '🟡' } : null,
    s ? { value: s, unit: 'silver', symbol: '⚪' } : null,
    c || (!g && !s) ? { value: c, unit: 'copper', symbol: '🟠' } : null].filter(Boolean);
};
const moneyWords = copper => {
  const parts = moneyParts(copper);
  return Array.isArray(parts) ? parts.map(part => num(part.value) + ' ' + part.unit).join(' ') : 'Unpriced';
};
const moneyOption = copper => {
  const parts = moneyParts(copper);
  return Array.isArray(parts) ? parts.map(part => num(part.value) + part.symbol).join(' ') : '—';
};
const gold = copper => {
  const parts = moneyParts(copper);
  if (!Array.isArray(parts)) return '—';
  return '<span class="money"><span class="sr-only">' + esc(moneyWords(copper)) + '</span><span class="money-visual" aria-hidden="true">' +
    parts.map(part => '<span class="money-part">' + num(part.value) + '<i class="coin coin-' + part.unit + '"></i></span>').join('') +
    '</span></span>';
};
const ratio = (copper, reward) => copper == null || !reward ? '—' : gold(copper / reward);
const itemLink = (id, name) => '<a href="https://ahledger.com/items/' + Number(id) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>';

function parsePriceTable(raw, market) {
  const lines = raw.trim().split(/\r?\n/);
  const header = (lines.shift() || '').split('|');
  if (header[0] !== 'AHL1' || header[1] !== market.replaceAll('.', '/')) throw new Error('Unexpected auction market or data format.');
  const prices = new Map();
  for (const line of lines) {
    const [id, median, min, quantity] = line.split(':');
    if (!/^\d+$/.test(id) ||
        [median, min, quantity].some(value => value != null && value !== '' && !/^\d+$/.test(value))) continue;
    const itemId = Number(id);
    const medianPrice = median == null || median === '' ? null : Number(median);
    const floor = min == null || min === '' ? null : Number(min);
    const listed = quantity == null || quantity === '' ? null : Number(quantity);
    if (!Number.isSafeInteger(itemId) || itemId <= 0 ||
        (medianPrice != null && (!Number.isSafeInteger(medianPrice) || medianPrice < 0)) ||
        (floor != null && (!Number.isSafeInteger(floor) || floor <= 0)) ||
        (listed != null && (!Number.isSafeInteger(listed) || listed < 0))) continue;
    prices.set(itemId, { median: medianPrice, min: floor, quantity: listed });
  }
  return { prices, scanTime: Number(header[2]) || null };
}

function price(id) {
  const p = state.prices.get(Number(id));
  return p && p.min != null && Number.isFinite(p.min) ? p : null;
}

function stockSufficient(listing, needed) {
  return !!listing && (listing.quantity == null || listing.quantity >= needed);
}

function stockNote(listing, needed) {
  if (!listing) return 'No listing';
  if (listing.quantity == null) return 'Stock unknown';
  return listing.quantity >= needed ? num(listing.quantity) + ' listed' : 'Only ' + num(listing.quantity) + ' listed; need ' + num(needed);
}

function ageText(timestamp) {
  if (!timestamp) return 'time unknown';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp * 1000) / 60000));
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

function renderStatus() {
  const status = $('#status');
  status.className = 'notice';
  if (state.priceState === 'loading') {
    status.textContent = 'Loading current auction scans…';
    return;
  }
  if (state.priceState === 'error') {
    status.classList.add('notice-error');
    status.textContent = 'Auction prices could not load. ' + state.priceError + ' Try Refresh prices.';
    return;
  }
  if (state.prices.size === 0) {
    status.classList.add('notice-error');
    status.textContent = state.market === OWNER_MARKET && state.preference === 'owner' && !state.feeds.owner ?
      'No verified owner scan is published for this Horde market yet. AHledger remains available in Price source.' :
      'No player auction scan is available for this ' + FACTIONS[state.faction].name + ' market yet. Requirements remain visible below.';
    return;
  }
  const market = (state.market.includes('.pvp.') ? 'PvP' : state.market.includes('.normal.') ? 'Normal' : 'RP') + ' ' + FACTIONS[state.faction].name + ' · US';
  const when = state.scanTime ? new Date(state.scanTime * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown time';
  const hoursOld = state.scanTime ? (Date.now() - state.scanTime * 1000) / 3600000 : null;
  const source = state.source === 'owner' ?
    'Verified Horde Auctionator scan' + (state.merged ? ' + <a href="https://ahledger.com" target="_blank" rel="noopener noreferrer">AHledger fallback</a>' : '') :
    '<a href="https://ahledger.com" target="_blank" rel="noopener noreferrer">AHledger ' + FACTIONS[state.faction].name + ' scan</a>';
  const other = state.source === 'owner' ? state.feeds.public : state.feeds.owner;
  const otherName = state.source === 'owner' ? 'AHledger' : 'owner scan';
  status.innerHTML = '<strong>' + market + '</strong> · ' + source + ' · ' + num(state.prices.size) + ' priced items' +
    (state.merged ? ' (' + num(state.feeds.owner.prices.size) + ' from owner scan)' : '') + ' · ' + esc(when) +
    ' (' + ageText(state.scanTime) + '). ' + (other ? otherName + ': ' + ageText(other.scanTime) + '. ' : '') +
    (state.preference === 'owner' && !state.feeds.owner && state.source === 'public' ? 'Owner scan unavailable; using AHledger. ' : '') +
    'Prices are lowest-buyout estimates.' + (hoursOld > 12 ? ' Scan is over 12 hours old; check in game before buying.' : '');
  if (hoursOld > 12) status.classList.add('notice-stale');
}

function crateMetrics(crate, method = 'buy') {
  const craftMode = method === 'craft';
  const cratePrice = price(crate.id);
  const options = crate.options.map(option => {
    const listing = price(option.itemId);
    const buyFillCost = listing ? listing.min * option.qty : null;
    const craftQuote = craftMode && state.recipes && window.Crafting ? window.Crafting.quote(option, state.recipes, price) : null;
    return { ...option, listing, buyFillCost, craftQuote,
      fillCost: craftMode ? craftQuote?.cost ?? null : buyFillCost,
      enough: craftMode ? !!craftQuote?.enough : stockSufficient(listing, option.qty) };
  }).sort((a, b) => a.enough === b.enough ? (a.fillCost ?? Infinity) - (b.fillCost ?? Infinity) : a.enough ? -1 : 1);
  const best = options.find(option => option.enough && option.fillCost != null) || null;
  const crateReady = state.owned || stockSufficient(cratePrice, 1);
  return { cratePrice, options, best, method: craftMode ? 'craft' : 'buy',
    total: best && crateReady ? best.fillCost + (state.owned ? 0 : cratePrice.min) : null };
}

function writMetrics(writ, method = 'buy') {
  const writPrice = price(writ.id), materialPrice = price(writ.targetId);
  const validQty = Number.isInteger(writ.qty) && writ.qty > 0;
  const craftMode = method === 'craft';
  const craftQuote = craftMode && validQty && state.recipes && window.Crafting ?
    window.Crafting.quote({ itemId: writ.targetId, qty: writ.qty }, state.recipes, price) : null;
  const materialsReady = validQty && (craftMode ? !!craftQuote?.enough : stockSufficient(materialPrice, writ.qty));
  const writReady = state.owned || stockSufficient(writPrice, 1);
  const materialsCost = craftMode ? craftQuote?.cost ?? null : validQty && materialPrice ? materialPrice.min * writ.qty : null;
  return { writPrice, materialPrice, materialsCost, materialsReady, craftQuote, method: craftMode ? 'craft' : 'buy',
    total: materialsReady && writReady ? materialsCost + (state.owned ? 0 : writPrice.min) : null };
}

function compareRecords(a, b) {
  if (state.sort === 'name') return a.record.name.localeCompare(b.record.name);
  const rewardKey = state.tab === 'crates' ? 'favor' : 'rep';
  const metric = entry => {
    if (entry.metrics.total == null) return Infinity;
    return state.sort === 'cost' ? entry.metrics.total : entry.record[rewardKey] ? entry.metrics.total / entry.record[rewardKey] : Infinity;
  };
  return metric(a) - metric(b) || a.record.name.localeCompare(b.record.name);
}

const VALUE_BANDS = ['Best value', 'Good value', 'Middle', 'Low value', 'High cost'];

function valueScale(entries, rewardKey) {
  const ranked = entries.filter(entry => entry.metrics.total != null && entry.record[rewardKey] > 0)
    .sort((a, b) => a.metrics.total / a.record[rewardKey] - b.metrics.total / b.record[rewardKey]);
  const scores = new Map();
  let firstAtCost = 0;
  let previousCost = null;
  ranked.forEach((entry, index) => {
    const cost = entry.metrics.total / entry.record[rewardKey];
    if (cost !== previousCost) firstAtCost = index;
    const band = ranked.length === 1 ? 0 : Math.round(firstAtCost * 4 / (ranked.length - 1));
    scores.set(entry.record.id, { band, label: VALUE_BANDS[band] });
    previousCost = cost;
  });
  return scores;
}

function valueBadge(score, reason) {
  const label = score?.label || reason;
  return '<span class="value-badge" aria-label="Relative value: ' + esc(label) + '">' + esc(label) + '</span>';
}

function resultHeader(isCrates) {
  const craftMode = state.fillMode === 'craft';
  return '<div class="result-head" aria-hidden="true"><span>' + (isCrates ? 'CRATE' : 'WRIT') +
    '</span><span>' + (craftMode ? isCrates ? 'LOWEST EST. DIY' : 'DIY MATERIALS' : isCrates ? 'LOWEST EST. FILL' : 'REQUIRED GOODS') +
    '</span><span>' + (isCrates ? 'FAVOR' : 'REP') +
    '</span><span>' + (craftMode ? 'CRAFT TOTAL' : 'BUY TOTAL') + '</span><span>COST / ' + (isCrates ? 'FAVOR' : 'REP') +
    '</span><span>VALUE</span><span></span></div>';
}

function overview(label, value, note) {
  return '<div><small>' + esc(label) + '</small><strong>' + value + '</strong><span>' + esc(note) + '</span></div>';
}

function craftBreakdown(option) {
  const quote = option.craftQuote;
  if (!quote) return '<p class="craft-warning">' + esc(state.recipeError || 'Verified recipes are unavailable right now.') + '</p>';
  const materials = quote.materials.map(material => '<div class="craft-material-row"><span class="craft-material-name">' +
    itemLink(material.itemId, material.name) + '</span><span class="craft-material-qty">' + num(material.qty) + ' ×</span>' +
    '<span class="craft-material-price">' + gold(material.unitCopper) + ' each</span><strong class="craft-material-total">' +
    gold(material.cost) + '</strong><span class="craft-material-source">' +
    esc(material.source === 'vendor' ? 'Vendor' : material.source === 'auction' ? 'Auction' : 'Unpriced') +
    (material.source === 'auction' && material.quantity != null ? ' · ' + num(material.quantity) + ' listed' : '') + '</span></div>').join('');
  const steps = quote.steps.map(step => {
    const choices = state.recipes?.recipes?.[step.itemId];
    const recipe = Array.isArray(choices) ? choices.find(choice => choice.spellId === step.spellId) : choices;
    const caveat = recipe?.caveat ? '<span class="craft-warning">' + esc(recipe.caveat) + '</span>' : '';
    return '<li class="craft-step"><span class="craft-step-main">' + num(step.crafts) + ' × <a href="https://www.wowhead.com/forever/spell=' + Number(step.spellId) +
      '" target="_blank" rel="noopener noreferrer">' + esc(step.name) + '</a>' + caveat + '</span><small class="craft-step-meta">' + esc(step.profession) +
      (step.skill ? ' ' + num(step.skill) : '') + (step.outputMin > 1 ? ' · ' + num(step.outputMin) + ' per craft' : '') + '</small></li>';
  }).join('');
  const alternatives = quote.alternatives?.length > 1 ? '<p class="craft-caveat">Recipe choices: ' + quote.alternatives.map(alt =>
    '<a href="https://www.wowhead.com/forever/spell=' + Number(alt.spellId) + '" target="_blank" rel="noopener noreferrer">' +
    esc(alt.profession) + '</a> ' + gold(alt.cost) + (alt.enough ? '' : ' (missing price or stock)')).join(' · ') + '</p>' : '';
  return '<details class="craft-breakdown"><summary>' + (quote.steps.length ? 'Raw materials and ' + num(quote.steps.length) + ' craft steps' : 'Raw good valued at auction') + '</summary>' +
    (quote.reason ? '<p class="craft-warning">' + esc(quote.reason) + '</p>' : '') +
    '<h4>Materials to source</h4><div class="craft-material-list">' + materials + '</div>' +
    (steps ? '<h4>Crafting steps</h4><ol class="craft-step-list">' + steps + '</ol>' : '') + alternatives +
    (quote.variableYield ? '<p class="craft-caveat">Some recipes can yield more than the guaranteed minimum; this estimate uses the minimum.</p>' : '') +
    '<p class="craft-source">Recipes: Forever beta client build 1.60.1.70009 via <a href="https://wago.tools/db2" target="_blank" rel="noopener noreferrer">wago.tools</a>. Material prices: selected auction market or known vendor price.</p>' +
    '</details>';
}

function optionRow(option, cratePrice, best, method) {
  const allCost = option.fillCost == null || (!state.owned && !cratePrice) ? null : option.fillCost + (state.owned ? 0 : cratePrice.min);
  const craftMode = method === 'craft';
  const stock = craftMode ? option.craftQuote?.reason ||
    (option.craftQuote?.steps.length ? 'Craft materials priced' : option.craftQuote ? 'Gathered or dropped good · auction value' : 'Crafting data unavailable') :
    stockNote(option.listing, option.qty);
  return '<div class="option-row ' + (craftMode ? 'craft-option-row ' : '') + (best ? 'best-option ' : '') + (!option.enough ? 'low-stock' : '') + '">' +
    '<div class="option-name"><span class="option-badge">' + (best ? craftMode ? 'LOWEST EST. DIY' : 'LOWEST EST. FILL' : 'ONE-BUNDLE OPTION') + '</span><strong>' +
    num(option.qty) + ' × ' + itemLink(option.itemId, option.name) + '</strong><small>' + esc(stock) +
    '</small></div>' +
    '<div class="option-number"><small>' + (craftMode ? 'Buy finished bundle' : 'Unit buyout') + '</small><strong>' + gold(craftMode ? option.buyFillCost : option.listing?.min) + '</strong></div>' +
    '<div class="option-number"><small>' + (craftMode ? 'Make or source' : 'Fill only') + '</small><strong>' + gold(option.fillCost) + '</strong></div>' +
    '<div class="option-number"><small>' + (state.owned ? 'With your crate' : 'With crate') + '</small><strong>' + gold(allCost) + '</strong></div>' +
    (craftMode ? craftBreakdown(option) : '') + '</div>';
}

function crateRow(crate, m, score) {
  const favorText = crate.favor ? num(crate.favor) + ' Favor' : 'Favor unverified';
  const shortName = crate.name.replace(/^Waylaid Crate:\s*/i, '');
  const fillText = m.best ? num(m.best.qty) + ' × ' + m.best.name : !state.owned && !m.cratePrice ? 'Crate unlisted · ' + m.options.length + ' fill choices' : m.method === 'craft' ? 'No fully priced DIY fill · ' + m.options.length + ' choices' : 'No complete fill listed · ' + m.options.length + ' choices';
  const scoreReason = crate.favor ? 'Unpriced' : 'Unverified';
  return '<details class="result-row ' + (score ? 'value-' + score.band : 'value-neutral') + '" data-id="' + esc(crate.id) + '"><summary class="row-summary">' +
    '<div class="row-main"><span class="tier">' + esc(crate.tier.toUpperCase()) + ' · LV ' + num(crate.level) + (m.method === 'craft' ? ' · DIY' : '') + '</span><h2><span class="sr-only">Waylaid Crate: </span>' + esc(shortName) +
    '</h2></div><span class="row-requirement" title="' + esc(fillText) + '">' + esc(fillText) + '</span>' +
    '<span class="row-reward">' + favorText + '</span><strong class="row-total">' + gold(m.total) +
    '</strong><strong class="row-eff">' + ratio(m.total, crate.favor) + '</strong>' + valueBadge(score, scoreReason) +
    '<span class="chevron" aria-hidden="true">⌄</span></summary>' +
    '<div class="detail"><div class="cost-overview">' +
    overview('Crate buyout', gold(m.cratePrice?.min), stockNote(m.cratePrice, 1)) +
    overview(m.method === 'craft' ? 'Lowest DIY material cost' : 'Lowest-price fill estimate', gold(m.best?.fillCost), m.best ? num(m.best.qty) + ' × ' + m.best.name : 'No option has enough priced stock') +
    overview('Estimated total ' + (state.owned ? 'with your crate' : 'buying the crate'), gold(m.total), favorText) +
    '</div><div class="detail-heading"><h3>Every accepted bundle</h3><span>Choose any one row</span></div><div class="option-list">' +
    m.options.map(option => optionRow(option, m.cratePrice, option === m.best, m.method)).join('') + '</div>' +
    '<p class="detail-note">' + (crate.favor ? 'Favor is based on the supplied beta spreadsheet and may change with sealed crate quality or later builds.' : 'Favor payout for this crate has not been verified. Costs and options are still comparable.') +
    (m.method === 'craft' ? ' Gathered and dropped goods use current ' + FACTIONS[state.faction].name + ' auction value. Craft estimates use the listed materials; you still need the required professions, recipes, specializations, and crafting stations.' : '') +
    '</p></div></details>';
}

function writRow(writ, m, score) {
  const rep = writ.rep ? num(writ.rep) + ' reputation' : 'Reputation unverified';
  const craftMode = m.method === 'craft';
  const finishedStock = stockNote(m.materialPrice, writ.qty);
  const stock = craftMode ? m.craftQuote?.reason || 'Raw materials priced' : finishedStock;
  const finishedCost = m.materialPrice ? m.materialPrice.min * writ.qty : null;
  const quest = writ.questId ? '<a href="https://www.wowhead.com/forever/quest=' + Number(writ.questId) + '" target="_blank" rel="noopener noreferrer">Quest details ↗</a>' : '';
  const shortName = writ.name.replace(/^Craftsman's Writ:\s*/i, '');
  const goods = num(writ.qty) + ' × ' + writ.targetName;
  return '<details class="result-row ' + (score ? 'value-' + score.band : 'value-neutral') + '" data-id="' + esc(writ.id) + '"><summary class="row-summary">' +
    '<div class="row-main"><span class="tier">CRAFTSMAN’S WRIT</span><h2><span class="sr-only">Craftsman’s Writ: </span>' + esc(shortName) + '</h2></div>' +
    '<span class="row-requirement" title="' + esc(goods) + '">' + esc(goods) + '</span><span class="row-reward">' + num(writ.rep) +
    ' rep</span><strong class="row-total">' + gold(m.total) + '</strong><strong class="row-eff">' + ratio(m.total, writ.rep) +
    '</strong>' + valueBadge(score, m.materialsReady ? 'Writ unlisted' : 'Unpriced') + '<span class="chevron" aria-hidden="true">⌄</span></summary>' +
    '<div class="detail"><div class="cost-overview">' +
    overview('Writ buyout', gold(m.writPrice?.min), stockNote(m.writPrice, 1)) +
    overview(craftMode ? 'Make the required goods' : 'Required goods', gold(m.materialsCost), stock) +
    overview('Estimated total ' + (state.owned ? 'with your writ' : 'buying the writ'), gold(m.total), rep) +
    '</div><div class="writ-requirement"><span>DELIVER</span><strong>' + num(writ.qty) + ' × ' + itemLink(writ.targetId, writ.targetName) +
    '</strong><span>' + (craftMode ? 'Buy finished bundle: ' + gold(finishedCost) + ' · ' + finishedStock : gold(m.materialPrice?.min) + ' each · ' + stock) + '</span></div>' +
    (craftMode ? craftBreakdown({ craftQuote: m.craftQuote }) : '') +
    '<div class="detail-links">' + quest + '<a href="https://ahledger.com/items/' + encodeURIComponent(writ.id) + '" target="_blank" rel="noopener noreferrer">Writ market ↗</a></div>' +
    '<p class="detail-note">Writs award faction reputation, separate from the Merchant’s Favor earned with crates. Costs use ' +
    (craftMode ? 'the current auction value of raw materials or known vendor prices. You still need the professions, recipes, specializations, and any required crafting station.' :
      'auction buyouts for finished goods.') + '</p></div></details>';
}

let wowheadTooltipsRequested = false;
function refreshShoppingTooltips() {
  if (wowheadTooltipsRequested) {
    try { window.$WowheadPower?.refreshLinks?.(true); } catch (_) {}
    return;
  }
  wowheadTooltipsRequested = true;
  const script = document.createElement('script');
  script.src = 'https://wow.zamimg.com/js/tooltips.js';
  script.async = true;
  script.onload = () => {
    if (state.tab === 'shopping') {
      try { window.$WowheadPower?.refreshLinks?.(true); } catch (_) {}
    }
  };
  script.onerror = () => { wowheadTooltipsRequested = false; };
  document.head.appendChild(script);
}

function renderResults() {
  if (!state.catalog) return;
  if (state.tab === 'shopping') {
    $('#results').innerHTML = window.ShoppingTab.render({
      catalog: state.catalog, vendors: state.vendors, faction: state.faction, fillMode: state.fillMode,
      crateMetrics: crate => {
        const m = crateMetrics(crate, state.fillMode);
        return { total: m.best && m.cratePrice ? m.best.fillCost + m.cratePrice.min : null };
      },
      writMetrics: writ => {
        const m = writMetrics(writ, state.fillMode);
        return { total: m.materialsReady && m.writPrice ? m.materialsCost + m.writPrice.min : null };
      },
      esc, num, gold, moneyOption, moneyWords
    });
    window.ShoppingTab.bind($('#results'), renderResults);
    if (state.vendors && !state.vendors.error) refreshShoppingTooltips();
    return;
  }
  if (state.tab === 'info') {
    $('#results').innerHTML = window.InfoTab.render(state.faction);
    return;
  }
  const isCrates = state.tab === 'crates';
  const craftMode = state.fillMode === 'craft';
  const records = isCrates ? state.catalog.crates : state.catalog.writs;
  const allEntries = records.map(record => ({ record, metrics: isCrates ? crateMetrics(record, state.fillMode) : writMetrics(record, state.fillMode) }));
  const scores = valueScale(allEntries, isCrates ? 'favor' : 'rep');
  const query = state.search.trim().toLowerCase();
  const matches = allEntries.filter(({ record }) => {
    if (isCrates && state.tier !== 'all' && record.tier !== state.tier) return false;
    return !query || [record.name, isCrates ? record.tier : record.targetName,
      ...(isCrates ? record.options.map(option => option.name) : [])].join(' ').toLowerCase().includes(query);
  });
  const entries = matches.sort(compareRecords);
  const priced = entries.filter(entry => entry.metrics.total != null).length;
  $('#result-count').textContent = entries.length + ' of ' + records.length + ' ' + (isCrates ? 'crates' : 'writs') + ' · ' + priced + ' fully priced';
  $('#sort-note').textContent = state.sort === 'name' ? 'Alphabetical' : state.sort === 'cost' ? 'Lowest estimated total first' :
    'Lowest estimated cost per ' + (isCrates ? 'observed Favor' : 'reputation') + ' first';
  const craftNote = craftMode ? '<p class="craft-mode-note">Craft every recipe step where a deterministic recipe exists. Gathered, dropped, and cooldown-made goods use auction value. Raw materials use the selected faction’s scan or known vendor prices; the crate or writ buyout is included unless you already have it. Check linked recipes for skill, specialization, and station requirements.</p>' : '';
  $('#results').innerHTML = entries.length ? craftNote + resultHeader(isCrates) + entries.map(entry => isCrates ? crateRow(entry.record, entry.metrics, scores.get(entry.record.id)) : writRow(entry.record, entry.metrics, scores.get(entry.record.id))).join('') :
    '<div class="empty">No turn-ins match your search.</div>';
}

function switchTab(tab) {
  if (!['crates', 'writs', 'shopping', 'info'].includes(tab)) return;
  state.tab = tab;
  const comparison = tab === 'crates' || tab === 'writs';
  if (comparison) {
    state.sort = tab === 'crates' ? 'efficiency' : 'cost';
    $('#sort').innerHTML = tab === 'crates' ?
      '<option value="efficiency">Cost per observed Favor</option><option value="cost">Lowest total cost</option><option value="name">Name</option>' :
      '<option value="cost">Lowest total cost</option><option value="efficiency">Cost per reputation</option><option value="name">Name</option>';
    $('#sort').value = state.sort;
  }
  $('#tier').parentElement.hidden = tab !== 'crates';
  $('#fill-mode-filter').hidden = tab === 'info';
  $('#sort').parentElement.hidden = !comparison;
  $('#owned').parentElement.hidden = !comparison;
  $('.search-wrap').hidden = !comparison;
  $('.summary').hidden = !comparison;
  $('#owned-label').textContent = 'I already have the ' + (tab === 'crates' ? 'crate' : 'writ');
  $('#search').placeholder = tab === 'crates' ? 'Search crates or materials' : 'Search writs or required goods';
  document.querySelectorAll('.tab').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $('#results').setAttribute('aria-labelledby', 'tab-' + tab);
  renderResults();
}

function registerComparisonTool() {
  const context = document.modelContext;
  if (!context || !context.registerTool) return;
  const controller = new AbortController();
  const markets = MARKET_TYPES.flatMap(type => Object.keys(FACTIONS).map(faction => `forever.${type}.${faction}.us`));
  const tiers = ['all', 'Apprentice', 'Journeyman', 'Expert', 'Artisan'];
  const sorts = ['efficiency', 'cost', 'name'];
  const tool = {
    name: 'configure_turnin_comparison',
    title: 'Compare Forever turn-ins',
    description: 'Set the visible Horde or Alliance market, crate or writ list, search and cost settings, then show matching turn-ins.',
    inputSchema: {
      type: 'object',
      properties: {
        market: { type: 'string', enum: markets },
        tab: { type: 'string', enum: ['crates', 'writs'] },
        search: { type: 'string', maxLength: 100 },
        tier: { type: 'string', enum: tiers },
        fillMode: { type: 'string', enum: ['buy', 'craft'] },
        sort: { type: 'string', enum: sorts },
        owned: { type: 'boolean' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected comparison settings.');
      const valid = { market: markets, tab: ['crates', 'writs'], tier: tiers, sort: sorts, fillMode: ['buy', 'craft'] };
      for (const key of Object.keys(input)) {
        if (!['market', 'tab', 'search', 'tier', 'sort', 'owned', 'fillMode'].includes(key)) throw new Error('Unknown setting: ' + key);
        if (valid[key] && !valid[key].includes(input[key])) throw new Error('Invalid ' + key + '.');
      }
      if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 100)) throw new Error('Search must be a short string.');
      if (input.owned !== undefined && typeof input.owned !== 'boolean') throw new Error('owned must be true or false.');
      if (input.tab !== undefined) switchTab(input.tab);
      if (input.search !== undefined) { state.search = input.search; $('#search').value = input.search; }
      if (input.tier !== undefined) { state.tier = input.tier; $('#tier').value = input.tier; }
      if (input.fillMode !== undefined) {
        if (input.fillMode === 'craft' && !state.recipes) throw new Error('Crafting recipes are unavailable.');
        state.fillMode = input.fillMode; $('#fill-mode').value = input.fillMode;
      }
      if (input.sort !== undefined) { state.sort = input.sort; $('#sort').value = input.sort; }
      if (input.owned !== undefined) { state.owned = input.owned; $('#owned').checked = input.owned; }
      if (input.market !== undefined && input.market !== state.market) {
        await setFaction(input.market.includes('.alliance.') ? 'alliance' : 'horde', { market: input.market, animate: false });
      } else renderResults();
      return { market: state.market, tab: state.tab, visible: $('#results').querySelectorAll('.result-row').length,
        priceState: state.priceState, scanTime: state.scanTime };
    }
  };
  try { Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {}); } catch (_) {}
}

function parseOwnerSnapshot(raw, market) {
  const data = JSON.parse(raw);
  if (data.market !== market || data.auctionHouse !== 'horde' || data.faction !== 'Horde' ||
      !Number.isInteger(data.completedAt) || !Array.isArray(data.prices)) {
    throw new Error('The owner scan has an unexpected market or format.');
  }
  const prices = new Map();
  for (const row of data.prices) {
    if (!Number.isInteger(row.itemId) || !Number.isInteger(row.price) || row.price <= 0 ||
        (row.quantity != null && (!Number.isInteger(row.quantity) || row.quantity < 0))) continue;
    if (state.catalogIds.has(row.itemId)) prices.set(row.itemId, {
      median: null, min: row.price, quantity: row.quantity ?? null
    });
  }
  return { prices, scanTime: data.completedAt };
}

function applyFeedSelection() {
  const previousSource = state.source;
  const previousPrices = state.prices;
  const owner = state.feeds.owner;
  const publicFeed = state.feeds.public;
  let source = state.preference;
  if (source === 'auto') source = owner && (!publicFeed || owner.scanTime > publicFeed.scanTime) ? 'owner' : 'public';
  if (source === 'owner' && !owner && publicFeed) source = 'public';
  const feed = state.feeds[source];
  state.source = source;
  state.merged = source === 'owner' && !!owner && !!publicFeed;
  if (state.merged) {
    if (!state.blended || state.blended.owner !== owner || state.blended.public !== publicFeed) {
      state.blended = { owner, public: publicFeed, prices: new Map([...publicFeed.prices, ...owner.prices]) };
    }
    state.prices = state.blended.prices;
  } else state.prices = feed?.prices || new Map();
  state.scanTime = feed?.scanTime || null;
  state.priceState = feed ? 'ready' : publicFeed || owner ? 'ready' : 'error';
  state.priceError = !feed && !publicFeed && !owner ?
    (state.feedErrors.public || state.feedErrors.owner || 'No feed is available yet.') : '';
  $('#price-source').value = state.preference;
  renderStatus();
  if (previousSource !== source || previousPrices !== state.prices) renderResults();
}

async function loadPrices(sources = ['public', 'owner'], quiet = false) {
  const market = state.market;
  const generation = state.marketGeneration;
  const requestedSources = sources.filter(source => source === 'public' || (source === 'owner' && market === OWNER_MARKET));
  if (!requestedSources.length) return;
  if (!quiet && !state.feeds.public && !state.feeds.owner) {
    state.priceState = 'loading';
    renderStatus();
  }
  const results = await Promise.allSettled(requestedSources.map(async source => {
    const url = source === 'public' ? API + market : OWNER_SCAN_API + '?market=' + encodeURIComponent(market);
    const response = await fetch(url, { cache: 'no-store' });
    if (source === 'owner' && response.status === 404) return { source, missing: true };
    if (!response.ok) throw new Error((source === 'public' ? 'AHledger' : 'Owner scan') + ' returned ' + response.status + '.');
    const raw = await response.text();
    return { source, raw, feed: source === 'public' ? parsePriceTable(raw, market) : parseOwnerSnapshot(raw, market) };
  }));
  if (generation !== state.marketGeneration || market !== state.market) return;
  results.forEach((result, index) => {
    const source = requestedSources[index];
    if (result.status === 'rejected') {
      state.feedErrors[source] = result.reason?.message || 'Network error.';
    } else if (result.value.missing) {
      state.feeds[source] = null;
      state.fingerprints[source] = null;
      delete state.feedErrors[source];
    } else {
      const { raw, feed } = result.value;
      if (state.fingerprints[source] !== raw && (!state.feeds[source] || feed.scanTime >= state.feeds[source].scanTime)) {
        state.feeds[source] = feed;
        state.fingerprints[source] = raw;
      }
      delete state.feedErrors[source];
    }
  });
  applyFeedSelection();
}

function resetMarketPrices() {
  ++state.marketGeneration;
  state.feeds = { public: null, owner: null };
  state.fingerprints = {};
  state.feedErrors = {};
  state.blended = null;
  state.merged = false;
  state.prices = new Map();
  state.scanTime = null;
  state.priceState = 'loading';
  renderStatus();
  renderResults();
  return loadPrices();
}

let transitionTimer = null;
function setFaction(faction, { market = null, animate = true } = {}) {
  if (!FACTIONS[faction]) throw new Error('Unknown faction.');
  const currentType = state.market.split('.')[1];
  const nextMarket = market || `forever.${MARKET_TYPES.includes(currentType) ? currentType : 'pvp'}.${faction}.us`;
  if (!MARKET_TYPES.some(type => nextMarket === `forever.${type}.${faction}.us`)) throw new Error('Invalid faction market.');
  const factionChanged = state.faction !== faction;
  const marketChanged = state.market !== nextMarket;
  state.faction = faction;
  state.market = nextMarket;
  state.vendors = state.vendorCatalogs[faction];
  document.documentElement.dataset.faction = faction;
  document.querySelector('meta[name="theme-color"]').content = FACTIONS[faction].themeColor;
  $('#faction-eyebrow').textContent = FACTIONS[faction].factionName.toUpperCase();
  $('#market').innerHTML = MARKET_TYPES.map(type => {
    const value = `forever.${type}.${faction}.us`;
    const name = type === 'pvp' ? 'PvP' : type === 'normal' ? 'Normal' : 'RP';
    return `<option value="${value}">${name} · ${FACTIONS[faction].name} · US</option>`;
  }).join('');
  $('#market').value = nextMarket;
  document.querySelectorAll('[data-faction-choice]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.factionChoice === faction));
  });
  const ownerOption = $('#price-source option[value="owner"]');
  ownerOption.disabled = nextMarket !== OWNER_MARKET;
  ownerOption.hidden = nextMarket !== OWNER_MARKET;
  ownerOption.textContent = 'Owner scan + AHledger';
  if (nextMarket !== OWNER_MARKET && state.preference === 'owner') state.preference = 'auto';
  $('#price-source').value = state.preference;
  $('#scan-help-copy').innerHTML = faction === 'horde' ?
    'AHledger prices refresh from its Horde market feed. The site owner’s completed Auctionator scans publish after WoW saves them on <code>/reload</code> or logout. Missing items use the AHledger Horde feed. Only scans captured at confirmed Horde city auction houses qualify; Goblin neutral auction houses are excluded. Visitors can view prices without uploading files.' :
    'AHledger prices refresh from its Alliance market feed. The site owner’s automatic Auctionator scan currently covers only the Horde PvP market. Alliance prices here come from the separate Alliance auction market; Goblin neutral auction houses are excluded. Visitors can view prices without uploading files.';
  $('#price-credit').innerHTML = faction === 'horde' ?
    'Prices from <a href="https://ahledger.com" target="_blank" rel="noopener noreferrer">AHledger</a> or the site owner’s verified Horde auction scans. Missing owner-scan items use AHledger. Cost = lowest observed unit buyout × quantity. Actual purchase can cost more when the cheapest listings run out.' :
    'Alliance prices from <a href="https://ahledger.com" target="_blank" rel="noopener noreferrer">AHledger</a>. Cost = lowest observed unit buyout × quantity. Actual purchase can cost more when the cheapest listings run out.';
  window.ShoppingTab?.setFaction?.(faction);
  if (factionChanged && animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const overlay = $('#faction-transition');
    $('#transition-crest').src = faction === 'horde' ? './horde-crest.svg' : './alliance-crest.svg';
    overlay.classList.remove('is-active');
    void overlay.offsetWidth;
    overlay.classList.add('is-active');
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => overlay.classList.remove('is-active'), 720);
  }
  try { localStorage.setItem('forever-waylaid-faction', faction); } catch (_) {}
  if (!state.catalog) return Promise.resolve();
  if (marketChanged) return resetMarketPrices();
  if (factionChanged) renderResults();
  return Promise.resolve();
}


async function initialize() {
  $('#market').addEventListener('change', event => { setFaction(state.faction, { market: event.target.value, animate: false }); });
  document.querySelectorAll('[data-faction-choice]').forEach(button => button.addEventListener('click', () => {
    setFaction(button.dataset.factionChoice);
  }));
  $('#price-source').addEventListener('change', event => {
    state.preference = event.target.value;
    applyFeedSelection();
  });
  $('#refresh').addEventListener('click', () => loadPrices());
  $('#search').addEventListener('input', event => { state.search = event.target.value; renderResults(); });
  $('#tier').addEventListener('change', event => { state.tier = event.target.value; renderResults(); });
  $('#fill-mode').addEventListener('change', event => { state.fillMode = event.target.value; renderResults(); });
  $('#sort').addEventListener('change', event => { state.sort = event.target.value; renderResults(); });
  $('#owned').addEventListener('change', event => { state.owned = event.target.checked; renderResults(); });
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  $('.tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = ['crates', 'writs', 'shopping', 'info'];
    const index = tabs.indexOf(state.tab);
    const tab = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] :
      tabs[(index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length];
    switchTab(tab);
    $('#tab-' + tab).focus();
  });
  let lastForegroundRefresh = 0;
  const refreshForeground = () => {
    if (document.hidden || !state.catalog || Date.now() - lastForegroundRefresh < 30000) return;
    lastForegroundRefresh = Date.now();
    loadPrices(['owner', 'public'], true);
  };
  window.addEventListener('focus', refreshForeground);
  document.addEventListener('visibilitychange', refreshForeground);
  setInterval(() => { if (!document.hidden && state.catalog) loadPrices(['owner'], true); }, 60000);
  setInterval(() => { if (!document.hidden && state.catalog) loadPrices(['public'], true); }, 300000);
  let savedFaction = 'horde';
  try { if (FACTIONS[localStorage.getItem('forever-waylaid-faction')]) savedFaction = localStorage.getItem('forever-waylaid-faction'); } catch (_) {}
  await setFaction(savedFaction, { animate: false });
  try {
    const response = await fetch('./catalog.json');
    if (!response.ok) throw new Error('The turn-in catalogue could not load.');
    state.catalog = await response.json();
    if (state.catalog.crates.length !== 30 || state.catalog.writs.length !== 150) throw new Error('The turn-in catalogue is incomplete.');
    state.catalog.crates.forEach(crate => {
      state.catalogIds.add(crate.id);
      crate.options.forEach(option => state.catalogIds.add(option.itemId));
    });
    state.catalog.writs.forEach(writ => {
      state.catalogIds.add(writ.id);
      state.catalogIds.add(writ.targetId);
    });
    try {
      const response = await fetch('./recipes.json?v=2');
      if (!response.ok) throw new Error('Crafting recipes could not load.');
      const recipes = await response.json();
      if (recipes.metadata?.clientBuild !== state.catalog.metadata.clientBuild ||
          recipes.metadata?.crateCount !== state.catalog.crates.length ||
          recipes.metadata?.fillOptionCount !== state.catalog.crates.reduce((n, crate) => n + crate.options.length, 0) ||
          recipes.metadata?.writCount !== state.catalog.writs.length ||
          recipes.metadata?.verifiedWritTargetCount !== state.catalog.writs.length ||
          !recipes.metadata.leaves || !recipes.recipes ||
          state.catalog.crates.some(crate => crate.options.some(option =>
            !recipes.recipes[option.itemId] && !recipes.metadata.leaves[option.itemId])) ||
          state.catalog.writs.some(writ => !recipes.recipes[writ.targetId])) {
        throw new Error('The crafting recipe catalogue is incomplete.');
      }
      state.recipes = recipes;
      Object.keys(recipes.metadata.leaves).forEach(id => state.catalogIds.add(Number(id)));
    } catch (error) {
      state.recipeError = error.message;
      $('#fill-mode option[value="craft"]').disabled = true;
    }
    const vendorFiles = { horde: './vendors.json', alliance: './vendors-alliance.json' };
    await Promise.all(Object.entries(vendorFiles).map(async ([faction, file]) => {
      try {
        const response = await fetch(file);
        if (!response.ok) throw new Error('Vendor catalogue could not load.');
        const vendors = await response.json();
        if (!Array.isArray(vendors.vendors) || !vendors.vendors.length) throw new Error('Vendor catalogue is incomplete.');
        state.vendorCatalogs[faction] = vendors;
      } catch (error) {
        state.vendorCatalogs[faction] = { vendors: [], unassigned: [], error: error.message };
      }
    }));
    state.vendors = state.vendorCatalogs[state.faction];
    renderResults();
    await loadPrices();
    registerComparisonTool();
  } catch (error) {
    $('#status').className = 'notice notice-error';
    $('#status').textContent = error.message;
    $('#results').innerHTML = '<div class="empty">Turn-in data is unavailable right now.</div>';
  }
}
initialize();
