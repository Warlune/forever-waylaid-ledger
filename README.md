# Forever Waylaid Ledger

A community price and turn-in planner for Waylaid Crates and Craftsman's Writs on the WoW Forever beta. It compares finished-goods buyouts with crafting from raw materials, and uses faction-specific auction data when available.

[Open the current site](https://forever-waylaid-ledger.warlune.chatgpt.site/)

## Project layout

- `dist/` is the browser app and its beta catalogue. `node scripts/export-pages.mjs` copies the static files into `docs/` for GitHub Pages.
- `worker/index.js` is the scan API. The Pages app reads the existing hosted API; GitHub Pages cannot run this Worker or store scans.
- `addon/ForeverWaylaidScan/` captures completed Horde city scans in game. `tools/owner-scan-sync.mjs` reads the SavedVariables file and uploads validated prices to the API.
- `scripts/` contains catalogue generation, build tools, and tests.

## GitHub Pages

The static site is in `docs/`. In repository **Settings → Pages**, choose **Deploy from a branch**, then **main** and **/docs**. Its address will be `https://warlune.github.io/forever-waylaid-ledger/`.

When browser files change, run `node scripts/export-pages.mjs` and commit both `dist/` and `docs/`. The existing hosted API remains necessary for shared owner scans. Do not put the upload token or local sync configuration in this repository.

## Checks

Run `node scripts/build-worker.cjs`, then `node --test scripts/test-crafting.mjs scripts/test-worker.mjs tools/owner-scan-sync.test.mjs` from the repository root. The Worker bundle is generated and excluded from Git.

## License and data

Project code is MIT licensed. World of Warcraft names and related game data belong to their respective owners. Auction prices come from [AHledger](https://ahledger.com/) and verified owner scans; recipe data is based on the Forever beta client. This project is not affiliated with Blizzard Entertainment.
