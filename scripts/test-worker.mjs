import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

const token = 'test-only-token-longer-than-thirty-two-characters';
const objects = new Map();
let revision = 0;
const bucket = {
  async get(key) {
    const object = objects.get(key);
    return object ? { etag: object.etag, text: async () => object.body } : null;
  },
  async put(key, body, options) {
    const current = objects.get(key);
    const condition = options?.onlyIf || {};
    if (condition.etagDoesNotMatch === '*' && current) return null;
    if (condition.etagMatches && (!current || current.etag !== condition.etagMatches)) return null;
    const etag = `version-${++revision}`;
    objects.set(key, { body, etag });
    return { etag };
  }
};
const env = { BUCKET: bucket, OWNER_SCAN_TOKEN: token };
const base = 'https://forever-waylaid-ledger.example';
const pagesOrigin = 'https://warlune.github.io';
const completedAt = Math.floor(Date.now() / 1000);
const scan = {
  schemaVersion: 1,
  market: 'forever.pvp.horde.us',
  realm: 'Classic Beta PvP 2',
  faction: 'Horde',
  auctionHouse: 'horde',
  zone: 'Orgrimmar',
  zoneMapID: 1454,
  scanType: 'incremental',
  completedAt,
  prices: [{ itemId: 2447, price: 123, quantity: 42 }]
};
const allianceScan = {
  ...scan,
  market: 'forever.pvp.alliance.us',
  faction: 'Alliance',
  auctionHouse: 'alliance',
  zone: 'Stormwind City',
  zoneMapID: 1453,
  prices: [{ itemId: 2447, price: 321, quantity: 21 }]
};
const publicScan = {
  schemaVersion: scan.schemaVersion,
  market: scan.market,
  faction: scan.faction,
  auctionHouse: scan.auctionHouse,
  completedAt: scan.completedAt,
  prices: scan.prices
};

function post(body, bearer = token) {
  return worker.fetch(new Request(`${base}/api/owner-scan`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }), env);
}

const page = await worker.fetch(new Request(`${base}/`), env);
assert.equal(page.status, 200);
assert.equal(page.headers.get('cache-control'), 'no-cache, must-revalidate');
assert.equal((await worker.fetch(new Request(`${base}/styles.css`), env)).status, 200);
assert.equal((await worker.fetch(new Request(`${base}/.openai/hosting.json`), env)).status, 404);
assert.equal((await worker.fetch(new Request(`${base}/api/owner-scan?market=${scan.market}`), env)).status, 404);
assert.equal((await post(scan, 'wrong-token')).status, 401);
assert.equal((await post({ ...scan, auctionHouse: 'neutral' })).status, 400);
assert.equal((await post({ ...scan, zone: 'Gadgetzan', zoneMapID: 1446 })).status, 400);
assert.equal((await post({ ...scan, zoneMapID: 1446 })).status, 400);
assert.equal((await post({ ...scan, faction: 'Alliance' })).status, 400);
assert.equal((await post({ ...scan, market: allianceScan.market })).status, 400);
assert.equal((await post({ ...scan, market: allianceScan.market, faction: 'Alliance', auctionHouse: 'alliance' })).status, 400);
assert.equal((await post({ ...scan, realm: 'Classic Beta Normal' })).status, 400);
assert.equal((await post({ ...scan, completedAt: completedAt - 8 * 86400 })).status, 400);
assert.equal((await post({ ...scan, prices: [scan.prices[0], scan.prices[0]] })).status, 400);
assert.equal((await post(scan)).status, 201);
const first = await worker.fetch(new Request(`${base}/api/owner-scan?market=${scan.market}`), env);
assert.equal(first.status, 200);
assert.equal(first.headers.get('access-control-allow-origin'), null);
assert.equal(first.headers.get('vary'), 'Origin');
assert.deepEqual(await first.json(), publicScan);
const pagesRead = await worker.fetch(new Request(`${base}/api/owner-scan?market=${scan.market}`, {
  headers: { origin: pagesOrigin }
}), env);
assert.equal(pagesRead.status, 200);
assert.equal(pagesRead.headers.get('access-control-allow-origin'), pagesOrigin);
assert.equal(pagesRead.headers.get('vary'), 'Origin');
assert.deepEqual(await pagesRead.json(), publicScan);
const otherRead = await worker.fetch(new Request(`${base}/api/owner-scan?market=${scan.market}`, {
  headers: { origin: 'https://untrusted.example' }
}), env);
assert.equal(otherRead.status, 200);
assert.equal(otherRead.headers.get('access-control-allow-origin'), null);
const pagesError = await worker.fetch(new Request(`${base}/api/owner-scan?market=forever.normal.horde.us`, {
  headers: { origin: pagesOrigin }
}), env);
assert.equal(pagesError.status, 400);
assert.equal(pagesError.headers.get('access-control-allow-origin'), pagesOrigin);
const pagesPost = await worker.fetch(new Request(`${base}/api/owner-scan`, {
  method: 'POST',
  headers: { origin: pagesOrigin, 'content-type': 'application/json' },
  body: JSON.stringify(scan)
}), env);
assert.equal(pagesPost.status, 401);
assert.equal(pagesPost.headers.get('access-control-allow-origin'), null);
assert.equal((await post(scan)).status, 200);
assert.equal((await post({ ...scan, completedAt: completedAt - 1 })).status, 409);
assert.equal((await post({ ...scan, completedAt: completedAt + 1, prices: [{ itemId: 2447, price: 100 }] })).status, 201);
await Promise.all([
  post({ ...scan, completedAt: completedAt + 2, prices: [{ itemId: 2447, price: 90 }] }),
  post({ ...scan, completedAt: completedAt + 3, prices: [{ itemId: 2447, price: 80 }] })
]);
const newest = await worker.fetch(new Request(`${base}/api/owner-scan?market=${scan.market}`), env);
assert.equal((await newest.json()).completedAt, completedAt + 3);
assert.equal((await worker.fetch(new Request(`${base}/api/owner-scan?market=${allianceScan.market}`), env)).status, 404);
assert.equal((await post({ ...allianceScan, auctionHouse: 'neutral' })).status, 400);
assert.equal((await post({ ...allianceScan, faction: 'Horde' })).status, 400);
assert.equal((await post({ ...allianceScan, zone: 'Booty Bay', zoneMapID: 1434 })).status, 400);
assert.equal((await post({ ...allianceScan, zoneMapID: 1434 })).status, 400);
assert.equal((await post({ ...allianceScan, realm: 'Classic Beta Normal' })).status, 400);
assert.equal((await post(allianceScan)).status, 201);
assert.deepEqual(await (await worker.fetch(new Request(`${base}/api/owner-scan?market=${allianceScan.market}`), env)).json(), {
  ...publicScan,
  market: allianceScan.market,
  faction: 'Alliance',
  auctionHouse: 'alliance',
  prices: allianceScan.prices
});
assert.equal((await post({ ...allianceScan, completedAt: completedAt - 1 })).status, 409);
assert.equal((await post({ ...allianceScan, completedAt: completedAt + 1, zone: 'Ironforge', zoneMapID: 1455 })).status, 201);
assert.equal((await post({ ...allianceScan, completedAt: completedAt + 2, zone: 'Darnassus', zoneMapID: 1457 })).status, 201);
assert.equal((await post({ ...allianceScan, completedAt: completedAt + 3, zone: 'The Exodar', zoneMapID: 1947 })).status, 201);
assert.equal((await post({ ...allianceScan, completedAt: completedAt + 4, zone: 'Orgrimmar', zoneMapID: 1454 })).status, 400);
assert.equal((await (await worker.fetch(new Request(`${base}/api/owner-scan?market=${scan.market}`), env)).json()).completedAt, completedAt + 3);
assert.equal((await worker.fetch(new Request(`${base}/api/owner-scan?market=${allianceScan.market}`, {
  headers: { origin: pagesOrigin }
}), env)).headers.get('access-control-allow-origin'), pagesOrigin);
assert.equal((await worker.fetch(new Request(`${base}/api/owner-scan?market=forever.normal.horde.us`), env)).status, 400);
assert.equal((await worker.fetch(new Request(`${base}/api/owner-scan?market=forever.normal.alliance.us`), env)).status, 400);
assert.equal((await worker.fetch(new Request(`${base}/api/owner-scan`, { method: 'DELETE' }), env)).status, 405);
console.log('Worker faction-isolated storage, authorization, neutral exclusion, freshness, restricted CORS, and static routes passed.');
