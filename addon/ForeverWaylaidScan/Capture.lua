local _, Addon = ...

-- These are city UI map IDs in Classic clients. Neutral auction houses in
-- Booty Bay, Gadgetzan, and Everlook cannot pass this allowlist.
local HORDE_CAPITALS = {
  [1454] = "Orgrimmar",
  [1456] = "Thunder Bluff",
  [1458] = "Undercity",
  [1954] = "Silvermoon City",
}

local MARKET = "forever.pvp.horde.us"
local houseOpen = false
local pending = nil
local scanEvents = {}

local function notify(message)
  if DEFAULT_CHAT_FRAME then
    DEFAULT_CHAT_FRAME:AddMessage("|cffd7a95bWaylaid Ledger:|r " .. message)
  end
end

local function cityForPlayer()
  if not C_Map or type(C_Map.GetBestMapForUnit) ~= "function"
      or type(C_Map.GetMapInfo) ~= "function" then
    return nil
  end

  local mapID = C_Map.GetBestMapForUnit("player")
  local visited = {}
  for _ = 1, 8 do
    if type(mapID) ~= "number" or visited[mapID] then
      return nil
    end
    if HORDE_CAPITALS[mapID] then
      return mapID, HORDE_CAPITALS[mapID]
    end
    visited[mapID] = true
    local mapInfo = C_Map.GetMapInfo(mapID)
    mapID = mapInfo and mapInfo.parentMapID
  end
  return nil
end

local function context()
  if not houseOpen or UnitFactionGroup("player") ~= "Horde" then
    return nil
  end
  local realm = GetRealmName()
  local mapID, city = cityForPlayer()
  if type(realm) ~= "string" or realm:gsub("[^%w]", ""):lower() ~= "classicbetapvp2" or not mapID then
    return nil
  end
  return { realm = realm, zoneMapID = mapID, zone = city }
end

local function positiveNumber(value)
  return type(value) == "number" and value == value and value > 0
      and value < math.huge
end

local function readRow(kind, row)
  if type(row) ~= "table" then
    return nil
  end

  local itemID, unitBuyout, quantity
  if kind == "incremental" then
    itemID = row.itemKey and row.itemKey.itemID
    unitBuyout = row.minPrice
    quantity = row.totalQuantity
  else
    local info = row.replicateInfo or row.auctionInfo
    if type(info) ~= "table" then
      return nil
    end
    itemID = info[17]
    quantity = info[3]
    if positiveNumber(info[10]) and positiveNumber(quantity) then
      unitBuyout = info[10] / quantity
    end
  end

  if not positiveNumber(itemID) or itemID ~= math.floor(itemID)
      or not Addon.catalog[itemID] or not positiveNumber(unitBuyout)
      or not positiveNumber(quantity) then
    return nil
  end

  return itemID, math.ceil(unitBuyout), math.floor(quantity)
end

local function saveCompleteScan(kind, rows, scanContext)
  if type(rows) ~= "table" or #rows == 0 then
    return false
  end

  local items = {}
  local itemCount = 0
  for _, row in ipairs(rows) do
    local itemID, unitBuyout, quantity = readRow(kind, row)
    if itemID and quantity > 0 then
      local item = items[itemID]
      if item then
        item.quantity = item.quantity + quantity
        if unitBuyout < item.minUnitBuyout then
          item.minUnitBuyout = unitBuyout
        end
      else
        items[itemID] = { minUnitBuyout = unitBuyout, quantity = quantity }
        itemCount = itemCount + 1
      end
    end
  end

  -- An empty relevant catalog is more likely a truncated or incompatible
  -- response than a useful replacement for the previous valid snapshot.
  if itemCount == 0 then
    return false
  end

  FWL_HORDE_SCAN = {
    version = 1,
    market = MARKET,
    realm = scanContext.realm,
    faction = "Horde",
    auctionHouse = "horde",
    zone = scanContext.zone,
    zoneMapID = scanContext.zoneMapID,
    scannedAt = type(GetServerTime) == "function" and GetServerTime() or time(),
    scanType = kind,
    itemCount = itemCount,
    items = items,
  }
  notify("Saved " .. itemCount .. " relevant item prices from the " .. scanContext.zone .. " Horde auction house. Log out or /reload to write the SavedVariables file.")
  return true
end

local listener = {}

function listener:ReceiveEvent(eventName, rows)
  local event = scanEvents[eventName]
  if not event then
    return
  end

  if event.phase == "start" then
    local scanContext = context()
    pending = scanContext and { kind = event.kind, context = scanContext } or nil
    if not pending then
      notify("Scan ignored: this is not a recognized Horde capital auction house.")
    end
  elseif event.phase == "failed" then
    if pending and pending.kind == event.kind then
      pending = nil
    end
  elseif event.phase == "complete" then
    local started = pending
    pending = nil
    local ended = context()
    if not started or started.kind ~= event.kind or not ended
        or started.context.realm ~= ended.realm
        or started.context.zoneMapID ~= ended.zoneMapID then
      return
    end
    if not saveCompleteScan(event.kind, rows, ended) then
      notify("Scan finished without usable crate or writ item prices; the previous snapshot was kept.")
    end
  end
end

local function addAuctionatorEvents(kind, events, names)
  if type(events) ~= "table" or not events.ScanStart
      or not events.ScanComplete or not events.ScanFailed then
    return
  end
  for phase, eventName in pairs({
    start = events.ScanStart,
    complete = events.ScanComplete,
    failed = events.ScanFailed,
  }) do
    scanEvents[eventName] = { kind = kind, phase = phase }
    names[#names + 1] = eventName
  end
end

local function register()
  if type(Auctionator) ~= "table" or not Auctionator.EventBus then
    notify("Auctionator is unavailable, so scan capture is disabled.")
    return
  end
  local names = {}
  addAuctionatorEvents("full", Auctionator.FullScan and Auctionator.FullScan.Events, names)
  addAuctionatorEvents("incremental", Auctionator.IncrementalScan and Auctionator.IncrementalScan.Events, names)
  if #names == 0 then
    notify("Auctionator scan events are unavailable, so scan capture is disabled.")
    return
  end
  Auctionator.EventBus:Register(listener, names)
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("AUCTION_HOUSE_SHOW")
frame:RegisterEvent("AUCTION_HOUSE_CLOSED")
frame:RegisterEvent("PLAYER_INTERACTION_MANAGER_FRAME_SHOW")
frame:RegisterEvent("PLAYER_INTERACTION_MANAGER_FRAME_HIDE")
frame:SetScript("OnEvent", function(_, eventName, interactionType)
  if eventName == "PLAYER_LOGIN" then
    register()
  elseif eventName == "AUCTION_HOUSE_SHOW" then
    houseOpen = true
  elseif eventName == "AUCTION_HOUSE_CLOSED" then
    houseOpen = false
    pending = nil
  elseif Enum and Enum.PlayerInteractionType
      and interactionType == Enum.PlayerInteractionType.Auctioneer then
    if eventName == "PLAYER_INTERACTION_MANAGER_FRAME_SHOW" then
      houseOpen = true
    elseif eventName == "PLAYER_INTERACTION_MANAGER_FRAME_HIDE" then
      houseOpen = false
      pending = nil
    end
  end
end)
