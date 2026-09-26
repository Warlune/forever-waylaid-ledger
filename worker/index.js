/* The build replaces __WAYLAID_ASSETS__ with the site's static files. */
const ASSETS = __WAYLAID_ASSETS__;

const MARKET = 'forever.pvp.horde.us';
const PAGES_ORIGIN = 'https://warlune.github.io';
const REALM_KEY = 'classicbetapvp2';
const BUCKET_KEY = 'owner-scans/forever-pvp-horde-us.json';
const HORDE_CITY_MAPS = Object.freeze({
  Orgrimmar: 1454,
  'Thunder Bluff': 1456,
  Undercity: 1458,
  'Silvermoon City': 1954
});
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_PRICES = 50000;
const MAX_SCAN_AGE_SECONDS = 7 * 86400;
const MAX_FUTURE_SECONDS = 600;

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  });
}

function error(message, status, extraHeaders) {
  return json({ error: message }, status, extraHeaders);
}

function allowPagesRead(request, response) {
  response.headers.append('vary', 'Origin');
  if (request.headers.get('origin') === PAGES_ORIGIN) {
    response.headers.set('access-control-allow-origin', PAGES_ORIGIN);
  }
  return response;
}

function validMarket(value) {
  return value === MARKET;
}

async function tokenMatches(provided, expected) {
  if (typeof expected !== 'string' || expected.length < 32 ||
      typeof provided !== 'string' || !provided.startsWith('Bearer ')) return false;
  const token = provided.slice(7);
  if (!token || token.length > 256) return false;
  const encoder = new TextEncoder();
  const hashes = await Promise.all([token, expected].map(value =>
    crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const left = new Uint8Array(hashes[0]);
  const right = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function readLimitedBody(request) {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new RangeError('Scan exceeds the size limit.');
  if (!request.body) throw new TypeError('Scan body is empty.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError('Scan exceeds the size limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function validateScan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid scan.');
  if (input.schemaVersion !== 1) throw new TypeError('Unsupported scan format.');
  if (!validMarket(input.market)) throw new TypeError('Wrong auction market.');
  if (input.faction !== 'Horde' || input.auctionHouse !== 'horde') {
    throw new TypeError('Only a verified Horde faction auction house scan is accepted.');
  }
  if (typeof input.realm !== 'string' || input.realm.length < 1 || input.realm.length > 100 ||
      input.realm.trim() !== input.realm || /[\x00-\x1f<>\\]/.test(input.realm)) {
    throw new TypeError('Invalid realm.');
  }
  if (input.realm.replace(/[^a-z0-9]/gi, '').toLowerCase() !== REALM_KEY) {
    throw new TypeError('Scan is from a different realm.');
  }
  if (!Object.hasOwn(HORDE_CITY_MAPS, input.zone) ||
      input.zoneMapID !== HORDE_CITY_MAPS[input.zone]) {
    throw new TypeError('Auction house location is unknown or neutral.');
  }
  if (input.scanType !== 'incremental' && input.scanType !== 'full') {
    throw new TypeError('Only a completed Auctionator market scan is accepted.');
  }
  if (!Number.isSafeInteger(input.completedAt)) throw new TypeError('Invalid scan completion time.');
  const now = Math.floor(Date.now() / 1000);
  if (input.completedAt < now - MAX_SCAN_AGE_SECONDS || input.completedAt > now + MAX_FUTURE_SECONDS) {
    throw new TypeError('Scan completion time is outside the allowed window.');
  }
  if (!Array.isArray(input.prices) || !input.prices.length || input.prices.length > MAX_PRICES) {
    throw new TypeError('Invalid price list.');
  }
  const prices = [];
  const seen = new Set();
  for (const entry of input.prices) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !Number.isSafeInteger(entry.itemId) || entry.itemId <= 0 ||
        !Number.isSafeInteger(entry.price) || entry.price <= 0 ||
        (entry.quantity != null && (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0)) ||
        seen.has(entry.itemId)) {
      throw new TypeError('Invalid or duplicate item price.');
    }
    seen.add(entry.itemId);
    prices.push(entry.quantity == null
      ? { itemId: entry.itemId, price: entry.price }
      : { itemId: entry.itemId, price: entry.price, quantity: entry.quantity });
  }
  return {
    schemaVersion: 1,
    market: MARKET,
    realm: input.realm,
    faction: 'Horde',
    auctionHouse: 'horde',
    zone: input.zone,
    zoneMapID: input.zoneMapID,
    scanType: input.scanType,
    completedAt: input.completedAt,
    prices
  };
}

async function readSavedScan(bucket) {
  const object = await bucket.get(BUCKET_KEY);
  if (!object) return null;
  const saved = JSON.parse(await object.text());
  if (!saved || !Number.isSafeInteger(saved.completedAt) ||
      saved.market !== MARKET || saved.faction !== 'Horde' || saved.auctionHouse !== 'horde' ||
      !Array.isArray(saved.prices)) throw new Error('Stored owner scan is invalid.');
  return { object, saved };
}

async function getOwnerScan(request, env, url) {
  if (!validMarket(url.searchParams.get('market'))) return error('Unsupported market.', 400);
  if (!env.BUCKET) return error('Owner scans are temporarily unavailable.', 503);
  try {
    const current = await readSavedScan(env.BUCKET);
    if (!current) return error('No verified Horde scan has been published yet.', 404);
    const { schemaVersion, market, faction, auctionHouse, completedAt, prices } = current.saved;
    return json({ schemaVersion, market, faction, auctionHouse, completedAt, prices });
  } catch (failure) {
    console.error('Owner scan read failed:', failure);
    return error('Owner scans are temporarily unavailable.', 503);
  }
}

async function postOwnerScan(request, env) {
  if (!env.OWNER_SCAN_TOKEN || !env.BUCKET) return error('Owner scan publishing is unavailable.', 503);
  if (!(await tokenMatches(request.headers.get('authorization'), env.OWNER_SCAN_TOKEN))) {
    return error('Unauthorized.', 401, { 'www-authenticate': 'Bearer' });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    return error('Send a JSON scan.', 415);
  }
  let scan;
  try {
    scan = validateScan(await readLimitedBody(request));
  } catch (failure) {
    const message = failure instanceof RangeError ? failure.message :
      failure instanceof SyntaxError ? 'Invalid scan JSON.' : failure.message || 'Invalid scan.';
    return error(message, failure instanceof RangeError ? 413 : 400);
  }
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await readSavedScan(env.BUCKET);
      if (current && scan.completedAt < current.saved.completedAt) {
        return error('An older scan cannot replace the public scan.', 409);
      }
      if (current && scan.completedAt === current.saved.completedAt) {
        return json({ ok: true, unchanged: true, market: MARKET, completedAt: scan.completedAt });
      }
      const written = await env.BUCKET.put(BUCKET_KEY, JSON.stringify(scan), {
        onlyIf: current ? { etagMatches: current.object.etag } : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' }
      });
      if (written) return json({ ok: true, market: MARKET, completedAt: scan.completedAt, prices: scan.prices.length }, 201);
    }
    return error('Another scan was published at the same time. Retry.', 409);
  } catch (failure) {
    console.error('Owner scan write failed:', failure);
    return error('Owner scan publishing is temporarily unavailable.', 503);
  }
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function staticAsset(request, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return error('Method not allowed.', 405, { allow: 'GET, HEAD' });
  const key = pathname === '/' ? '/index.html' : pathname;
  const asset = ASSETS[key];
  if (!asset) return new Response('Not found.', { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(request.method === 'HEAD' ? null : decodeBase64(asset.body), {
    headers: {
      'content-type': asset.type,
      'cache-control': key === '/index.html' ? 'no-cache, must-revalidate' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      etag: asset.etag
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/owner-scan') {
      if (request.method === 'GET') return allowPagesRead(request, await getOwnerScan(request, env, url));
      if (request.method === 'POST') return postOwnerScan(request, env);
      return error('Method not allowed.', 405, { allow: 'GET, POST' });
    }
    if (url.pathname.startsWith('/api/')) return error('Not found.', 404);
    return staticAsset(request, url.pathname);
  }
};
