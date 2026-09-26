# Owner price sync (Windows)

`owner-scan-sync.mjs` watches the dedicated `ForeverWaylaidScan.lua` saved file and publishes completed Horde city scans to the public Waylaid Ledger. It never reads `Auctionator.lua`, whose historical prices cannot identify whether a scan came from a Horde or neutral auction house.

## Requirements

- The `ForeverWaylaidScan` addon must be installed beside Auctionator in the Forever beta AddOns folder. Enable both in the game.
- Node.js 18 or newer must be available on the PC that runs World of Warcraft.
- The site owner token must match the hosted site's `OWNER_SCAN_TOKEN` secret. Keep it off the website, out of this repository, and out of command-line arguments.

## Local configuration

Create `%LOCALAPPDATA%\ForeverWaylaidLedger\sync-config.json` with these fields:

```json
{
  "scanFile": "C:\\Games\\World of Warcraft\\_classic_beta_\\WTF\\Account\\YOUR_ACCOUNT_FOLDER\\SavedVariables\\ForeverWaylaidScan.lua",
  "token": "<the private owner token>"
}
```

The account folder may differ on another installation. The helper also accepts `FWL_SYNC_CONFIG`, `FWL_SCAN_FILE`, and `FWL_OWNER_SCAN_TOKEN` environment variables for local overrides. It sends the token only in a `Bearer` header over HTTPS to the fixed Waylaid Ledger URL.

## Start and verify

From the repository root, run `node tools/owner-scan-sync.mjs --once` to check a saved scan. Run it without `--once` for continuous 15-second polling. A scan in Orgrimmar, Thunder Bluff, Undercity, or Silvermoon City is captured when Auctionator reports completion; World of Warcraft writes the saved file after `/reload` or logout. The watcher then posts only item IDs, unit prices in copper, quantities, scan time, and market verification fields. Unknown locations and Goblin neutral auction houses are rejected.

To launch at sign-in, create a Windows Task Scheduler task under the same Windows account with a **logon** trigger. Set the program to your Node executable and the argument to the absolute path of `owner-scan-sync.mjs`; use the repository root as the working directory. Keep the task in that signed-in user session if the WoW or repo paths are on mapped drives. The watcher is a background helper and does not need a browser tab open.

The site reads the newest valid owner snapshot through its public read-only API. If the site has a newer scan timestamp, the helper skips the older saved file. Scans older than seven days are rejected. It retries network errors on the next poll and does not send raw Lua files or character/account details.
