# Forever Waylaid Ledger

A community price and turn-in planner for Waylaid Crates and Craftsman's Writs on the WoW Forever beta. It compares finished-goods buyouts with crafting from raw materials, and uses faction-specific auction data when available.

Horde and Alliance use separate AHledger markets for PvP, Normal, and RP. The website reads AHledger only; personal scans are supported by the separate Forever Waylaid addon.

[Open the ledger](https://warlune.github.io/forever-waylaid-ledger/)

## Project layout

- `dist/` is the browser app and its beta catalogue. `node scripts/export-pages.mjs` copies the static files into `docs/` for GitHub Pages.
- `worker/index.js` and the old scan capture tools are retained as legacy code; the public website no longer reads owner scans.
- `scripts/` contains catalogue generation, build tools, and tests.

## GitHub Pages

The public site is published from `main` and `/docs` at `https://warlune.github.io/forever-waylaid-ledger/`.

When browser files change, run `node scripts/export-pages.mjs` and commit both `dist/` and `docs/`. The public website has no dependency on the legacy owner-scan API. Do not put the upload token or local sync configuration in this repository.

## Privacy

The public price API shares item prices and scan time, without a character name, account name, auction city, raw SavedVariables file, or upload token. Opening the Shopping tab loads Wowhead's script to show detailed item tooltips. The local upload token belongs only in `%LOCALAPPDATA%\ForeverWaylaidLedger\sync-config.json`, outside this repository.

## Checks

Run `node scripts/build-worker.cjs`, then `node --test scripts/test-crafting.mjs scripts/test-market-ui.mjs scripts/test-worker.mjs tools/owner-scan-sync.test.mjs` from the repository root. The Worker bundle is generated and excluded from Git.

## License and data

Project code is MIT licensed. World of Warcraft names and related game data belong to their respective owners. Auction prices come from [AHledger](https://ahledger.com/); recipe data is based on the Forever beta client. This project is not affiliated with Blizzard Entertainment.
