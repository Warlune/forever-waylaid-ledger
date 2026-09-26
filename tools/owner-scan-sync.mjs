#!/usr/bin/env node
/**
 * Publish completed Horde capital scans captured by ForeverWaylaidScan.
 * This deliberately never reads Auctionator.lua: Auctionator's saved price
 * database does not preserve Horde-versus-neutral auction house provenance.
 *
 * The token and local WoW path live in %LOCALAPPDATA%\ForeverWaylaidLedger\sync-config.json,
 * outside this public source repository. Node 18+ is required.
 */

import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(HERE, '../dist/catalog.json');
const RECIPES_PATH = path.resolve(HERE, '../dist/recipes.json');
const DEFAULT_CONFIG = path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'ForeverWaylaidLedger', 'sync-config.json');
const SITE_ORIGIN = 'https://forever-waylaid-ledger.warlune.chatgpt.site';
const MARKET = 'forever.pvp.horde.us';
const MAX_LUA_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 5000;
const POLL_MS = 15000;
const CITY_MAP_IDS = Object.freeze({
  Orgrimmar: 1454,
  'Thunder Bluff': 1456,
  Undercity: 1458,
  'Silvermoon City': 1954,
});

/** Read only the restricted Lua data form that WoW SavedVariables writes. */
export function parseSavedVariables(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_LUA_BYTES) throw new Error('Scan file is too large.');
  let index = 0;
  let tokens = 0;
  const source = input.replace(/^\uFEFF/, '');

  function space() {
    while (index < source.length) {
      if (/\s/.test(source[index])) { index++; continue; }
      if (source.startsWith('--', index)) {
        const end = source.indexOf('\n', index + 2);
        index = end < 0 ? source.length : end + 1;
        continue;
      }
      break;
    }
  }
  function expect(char) {
    space();
    if (source[index] !== char) throw new Error('Unexpected SavedVariables syntax.');
    index++;
  }
  function identifier() {
    space();
    const match = /^[A-Za-z_][A-Za-z_0-9]*/.exec(source.slice(index));
    if (!match) throw new Error('Expected a SavedVariables field name.');
    index += match[0].length;
    return match[0];
  }
  function number() {
    space();
    const match = /^-?\d+/.exec(source.slice(index));
    if (!match) throw new Error('Expected a SavedVariables integer.');
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) throw new Error('SavedVariables integer is out of range.');
    return value;
  }
  function quoted() {
    space();
    const quote = source[index++];
    if (quote !== '"' && quote !== "'") throw new Error('Expected a quoted SavedVariables string.');
    let value = '';
    let closed = false;
    while (index < source.length) {
      const char = source[index++];
      if (char === quote) { closed = true; break; }
      if (char !== '\\') { value += char; continue; }
      if (index >= source.length) throw new Error('Unterminated SavedVariables escape.');
      const escaped = source[index++];
      const single = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"', "'": "'" };
      if (Object.hasOwn(single, escaped)) value += single[escaped];
      else if (/[0-9]/.test(escaped)) {
        let digits = escaped;
        while (digits.length < 3 && index < source.length && /[0-9]/.test(source[index])) digits += source[index++];
        const code = Number(digits);
        if (code > 255) throw new Error('Invalid SavedVariables escape.');
        value += String.fromCharCode(code);
      } else throw new Error('Unsupported SavedVariables escape.');
      if (value.length > 4096) throw new Error('SavedVariables string is too long.');
    }
    if (!closed) throw new Error('Unterminated SavedVariables string.');
    return value;
  }
  function value(depth) {
    if (++tokens > MAX_ITEMS * 20) throw new Error('Scan file has too many fields.');
    if (depth > 5) throw new Error('Scan file nesting is too deep.');
    space();
    const char = source[index];
    if (char === '{') return table(depth + 1);
    if (char === '"' || char === "'") return quoted();
    if (char === '-' || /[0-9]/.test(char || '')) return number();
    const word = identifier();
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'nil') return null;
    throw new Error('Unsupported SavedVariables expression.');
  }
  function table(depth) {
    expect('{');
    const out = Object.create(null);
    let count = 0;
    for (;;) {
      space();
      if (source[index] === '}') { index++; break; }
      if (++count > MAX_ITEMS + 30) throw new Error('Scan file has too many entries.');
      let key;
      if (source[index] === '[') {
        index++;
        space();
        key = source[index] === '"' || source[index] === "'" ? quoted() : number();
        expect(']');
      } else key = identifier();
      expect('=');
      if (Object.hasOwn(out, key)) throw new Error('Duplicate SavedVariables key.');
      out[key] = value(depth);
      space();
      if (source[index] === ',' || source[index] === ';') index++;
      else if (source[index] !== '}') throw new Error('Expected a SavedVariables entry separator.');
    }
    return out;
  }

  space();
  if (identifier() !== 'FWL_HORDE_SCAN') throw new Error('This is not the ForeverWaylaidScan saved file.');
  expect('=');
  const snapshot = value(0);
  space();
  if (index !== source.length) throw new Error('Unexpected data after the scan snapshot.');
  return snapshot;
}

export function catalogItemIds(catalog, recipeData) {
  const ids = new Set();
  for (const crate of catalog.crates || []) {
    ids.add(crate.id);
    for (const option of crate.options || []) ids.add(option.itemId);
  }
  for (const writ of catalog.writs || []) {
    ids.add(writ.id);
    ids.add(writ.targetId);
  }
  const leaves = recipeData?.metadata?.leaves;
  if (!leaves || typeof leaves !== 'object' || Array.isArray(leaves)) {
    throw new Error('Recipe raw material catalog is missing or invalid.');
  }
  for (const [key, leaf] of Object.entries(leaves)) {
    const itemId = Number(key);
    if (!Number.isSafeInteger(itemId) || itemId < 1 || leaf?.itemId !== itemId) {
      throw new Error(`Invalid recipe raw material ID ${key}.`);
    }
    ids.add(itemId);
  }
  return ids;
}

/** Explicitly reject unknown locations and neutral auction data before upload. */
export function buildPayload(snapshot, allowedIds, now = Math.floor(Date.now() / 1000)) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Scan snapshot is missing.');
  if (snapshot.version !== 1 || snapshot.market !== MARKET || snapshot.auctionHouse !== 'horde' || snapshot.faction !== 'Horde') {
    throw new Error('Scan market is not the Forever Horde auction house.');
  }
  if (!Object.hasOwn(CITY_MAP_IDS, snapshot.zone) || CITY_MAP_IDS[snapshot.zone] !== snapshot.zoneMapID) {
    throw new Error('Scan location is not a verified Horde capital. Neutral auction scans are excluded.');
  }
  if (!['full', 'incremental'].includes(snapshot.scanType)) throw new Error('Scan type is not recognized.');
  if (!Number.isSafeInteger(snapshot.scannedAt) || snapshot.scannedAt < now - 7 * 86400 || snapshot.scannedAt > now + 300) {
    throw new Error('Scan completion time is invalid.');
  }
  if (typeof snapshot.realm !== 'string' || snapshot.realm.length > 100 || snapshot.realm.toLowerCase().replace(/[^a-z0-9]/g, '') !== 'classicbetapvp2') {
    throw new Error('Scan realm is not Classic Beta PvP 2.');
  }
  if (!snapshot.items || typeof snapshot.items !== 'object' || Array.isArray(snapshot.items)) throw new Error('Scan has no items table.');
  const entries = Object.entries(snapshot.items);
  if (!Number.isSafeInteger(snapshot.itemCount) || snapshot.itemCount !== entries.length || entries.length > MAX_ITEMS) {
    throw new Error('Scan item count does not match its saved items.');
  }
  const prices = [];
  for (const [key, item] of entries) {
    const itemId = Number(key);
    if (!Number.isSafeInteger(itemId) || itemId < 1 || !allowedIds.has(itemId)) continue;
    const price = item?.minUnitBuyout;
    const quantity = item?.quantity;
    if (!Number.isSafeInteger(price) || price < 1 || price > 2_147_483_647 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2_147_483_647) {
      throw new Error(`Invalid saved price for catalog item ${itemId}.`);
    }
    prices.push({ itemId, price, quantity });
  }
  if (prices.length === 0) throw new Error('Completed scan contains no catalog items.');
  prices.sort((a, b) => a.itemId - b.itemId);
  return {
    schemaVersion: 1,
    market: MARKET,
    realm: snapshot.realm.trim(),
    faction: 'Horde',
    auctionHouse: 'horde',
    zone: snapshot.zone,
    zoneMapID: snapshot.zoneMapID,
    scanType: snapshot.scanType,
    completedAt: snapshot.scannedAt,
    prices,
  };
}

function configPath(args) {
  const offset = args.indexOf('--config');
  if (offset >= 0) {
    if (!args[offset + 1]) throw new Error('--config requires a file path.');
    return path.resolve(args[offset + 1]);
  }
  return process.env.FWL_SYNC_CONFIG || DEFAULT_CONFIG;
}

async function loadConfig(args) {
  const filename = configPath(args);
  let config;
  try { config = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { throw new Error(`Cannot read sync config at ${filename}: ${error.message}`); }
  const scanFile = process.env.FWL_SCAN_FILE || config.scanFile;
  const token = process.env.FWL_OWNER_SCAN_TOKEN || config.token;
  if (typeof scanFile !== 'string' || !path.isAbsolute(scanFile) || path.basename(scanFile).toLowerCase() !== 'foreverwaylaidscan.lua') {
    throw new Error('Config scanFile must be an absolute path to ForeverWaylaidScan.lua.');
  }
  if (typeof token !== 'string' || token.length < 32 || /\s/.test(token)) {
    throw new Error('Config token is missing or invalid.');
  }
  return { scanFile, token };
}

async function readStableSnapshot(scanFile) {
  const before = await stat(scanFile);
  if (!before.isFile() || before.size > MAX_LUA_BYTES) throw new Error('The scan file is invalid or too large.');
  const contents = await readFile(scanFile, 'utf8');
  const after = await stat(scanFile);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('The scan file changed while reading; retrying.');
  return parseSavedVariables(contents);
}

async function fetchRemoteTimestamp() {
  const url = `${SITE_ORIGIN}/api/owner-scan?market=${encodeURIComponent(MARKET)}`;
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return 0;
  if (!response.ok) throw new Error(`Site price check failed (HTTP ${response.status}).`);
  const snapshot = await response.json();
  return Number.isSafeInteger(snapshot.completedAt) ? snapshot.completedAt : 0;
}

async function publish(payload, token) {
  const response = await fetch(`${SITE_ORIGIN}/api/owner-scan`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 409) return 'newer';
  if (!response.ok) {
    const result = await response.text().catch(() => '');
    throw new Error(`Site rejected scan (HTTP ${response.status})${result ? ': ' + result.slice(0, 180) : '.'}`);
  }
  return 'published';
}

export async function syncOnce({ scanFile, token }, allowedIds, previousDigest = '') {
  const snapshot = await readStableSnapshot(scanFile);
  const payload = buildPayload(snapshot, allowedIds);
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (digest === previousDigest) return { digest, status: 'unchanged', payload };
  const remoteTimestamp = await fetchRemoteTimestamp();
  if (remoteTimestamp >= payload.completedAt) return { digest, status: 'already current', payload };
  const status = await publish(payload, token);
  return { digest, status, payload };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('Usage: node owner-scan-sync.mjs [--once] [--config ABSOLUTE_CONFIG_PATH]\n');
    return;
  }
  const config = await loadConfig(args);
  const [catalog, recipes] = await Promise.all([CATALOG_PATH, RECIPES_PATH].map(async file => JSON.parse(await readFile(file, 'utf8'))));
  const allowedIds = catalogItemIds(catalog, recipes);
  let lastDigest = '';
  let lastError = '';
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await syncOnce(config, allowedIds, lastDigest);
      lastDigest = result.digest;
      lastError = '';
      if (result.status !== 'unchanged') {
        process.stdout.write(`[${new Date().toISOString()}] ${result.status}: ${result.payload.prices.length} catalog prices from ${result.payload.realm}, scan ${new Date(result.payload.completedAt * 1000).toISOString()}\n`);
      }
    } catch (error) {
      const message = error?.code === 'ENOENT' ? 'Waiting for ForeverWaylaidScan.lua; scan at a Horde capital, then /reload or log out.' : error.message;
      if (message !== lastError) process.stderr.write(`[${new Date().toISOString()}] ${message}\n`);
      lastError = message;
      if (args.includes('--once')) process.exitCode = 1;
    } finally { running = false; }
  }
  await tick();
  if (!args.includes('--once')) {
    process.stdout.write(`Watching ${config.scanFile} every ${POLL_MS / 1000} seconds.\n`);
    setInterval(tick, POLL_MS);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
