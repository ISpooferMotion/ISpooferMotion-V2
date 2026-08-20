local function resolveInstancePath(pathStr: string): Instance?
	local clean = string.gsub(pathStr, "^game%.", "")
	local parts = string.split(clean, ".")
	if #parts == 0 then
		return nil
	end
	local okService, rootObj = pcall(function()
		return game:GetService(parts[1])
	end)
	local current: Instance? = if okService and rootObj then rootObj else (game :: any)[parts[1]]
	if not current then
		return nil
	end
	for i = 2, #parts do
		local okChild, child = pcall(function()
			return current:FindFirstChild(parts[i])
		end)
		if not okChild or not child then
			return nil
		end
		current = child
	end
	return current
end

--!nolint UnknownGlobal
--!nocheck
--!nolint

-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global
--- Recursively crawls the DataModel looking for spoofable assets.
---
--- To keep Studio responsive and avoid memory spikes on massive places, the
--- scanner yields frequently and streams records back to the daemon in chunks.
local SCAN_CHUNK_BYTES: number = 500000
local SCAN_MAX_TAGS_PER_OBJECT: number = 100
local SCAN_MAX_TAG_BYTES: number = 100

--- Scans all custom attributes on an instance for asset references.
local function scanAttributeRecords(records: { Record }, obj: Instance)
	local okAttrs, attrs = pcall(function()
		return obj:GetAttributes()
	end)

	if not okAttrs or type(attrs) ~= "table" then
		return
	end

	for key, value in pairs(attrs) do
		if type(key) == "string" then
			local normalized = contentValueToString(value)
			if normalized then
				if isAssetFormat(value) or stringContainsAssetReference(normalized) then
					addRecord(records, obj, "__Attribute__:" .. key, normalized, false)
				end
			end
		end
	end
end

--- Validates that an array of tags is safe to process.
local function validScannedTags(tags: any): boolean
	if type(tags) ~= "table" or #tags == 0 or #tags > SCAN_MAX_TAGS_PER_OBJECT then
		return false
	end

	for _, tag in ipairs(tags) do
		if type(tag) ~= "string" or tag == "" or #tag > SCAN_MAX_TAG_BYTES then
			return false
		end
	end

	return true
end

--- Scans CollectionService tags on an instance for asset references.
local function scanTagRecords(records: { Record }, obj: Instance)
	local okTags, tags = pcall(function()
		return CollectionService:GetTags(obj)
	end)

	if not okTags or not validScannedTags(tags) then
		return
	end

	local hasAssetTag = false
	for _, tag in ipairs(tags) do
		if isAssetFormat(tag) or stringContainsAssetReference(tag) then
			hasAssetTag = true
			break
		end
	end

	if not hasAssetTag then
		return
	end

	local okJson, jsonStr = pcall(function()
		return HttpService:JSONEncode(tags)
	end)

	if okJson and jsonStr then
		addRecord(records, obj, "__Tags__", jsonStr, false)
	end
end

--- Scans StringValue and IntValue objects for asset references.
local function scanValueObjectRecord(records: { Record }, obj: Instance)
	if not (obj:IsA("StringValue") or obj:IsA("IntValue") or obj:IsA("NumberValue")) then
		return
	end

	local ok, val = pcall(function()
		return (obj :: any).Value
	end)

	if not ok then
		return
	end

	local normalized = contentValueToString(val)
	if not normalized then
		return
	end

	if isAssetFormat(val) or stringContainsAssetReference(normalized) then
		addRecord(records, obj, "Value", normalized, false)
	end
end

--- Extracts asset IDs from a script source in-place (Luau), without shipping
--- the full source to the daemon. This is the "asset IDs" scan mode: far less
--- payload for large scripts (a few IDs instead of megabytes of source), at the
--- cost of less context than the daemon's full-moon AST extraction. Users who
--- need the full extraction switch to "fullSource" mode.
local function extractScriptAssetIds(source: string): { string }
	local ids: { string } = {}
	local seen: { [string]: boolean } = {}

	local function add(id: string)
		-- Asset IDs are at least 7 digits; skip repeating-digit runs (e.g. 1111111)
		-- which are almost never asset IDs.
		if #id < 7 then
			return
		end
		local first = string.sub(id, 1, 1)
		local allSame = true
		for i = 2, #id do
			if string.sub(id, i, i) ~= first then
				allSame = false
				break
			end
		end
		if not allSame and not seen[id] then
			seen[id] = true
			table.insert(ids, id)
		end
	end

	-- Explicit rbxassetid:// URIs.
	for id in string.gmatch(source, "rbxassetid://(%d+)") do
		add(id)
	end
	-- roblox.com/asset?id= URIs (case-insensitive-ish, matches the daemon path).
	for id in string.gmatch(source, "[Aa]sset/%?[Ii][Dd]=(%d+)") do
		add(id)
	end
	-- Bare numbers >= 7 digits preceded by assignment/call/table context, to
	-- catch LoadAsset(1234567) / local x = 1234567 without matching digits
	-- embedded inside longer identifiers or strings.
	for id in string.gmatch(source, "[=:{,(]%s*(%d%d%d%d%d%d%d+)") do
		add(id)
	end

	return ids
end

--- Extracts the source code from scripts so the daemon can rewrite raw IDs.
---
--- Scan mode (ISpooferMotion_SCRIPT_SCAN_MODE setting):
---   "assetIds"  (default) — extract IDs locally, send a compact record. Fast,
---                low payload, but less context than the daemon's AST extraction.
---   "fullSource"          — send the full source; the daemon AST-parses it.
---                Most accurate, but ships megabytes for large scripts.
---   "off"                 — skip script scanning entirely.
local function scanScriptSourceRecord(records: { Record }, obj: Instance)
	if not obj:IsA("LuaSourceContainer") or obj.ClassName == "CoreScript" then
		return
	end

	-- Skip script scanning if the user deselected "scripts" in the scan popup.
	local scanScripts = false
	for _, t in ipairs(activeScanTypes) do
		if t == "scripts" then
			scanScripts = true
			break
		end
	end
	if not scanScripts then
		return
	end

	-- Use the mode pushed from the desktop app (falls back to the plugin setting
	-- if the app didn't send one, so manual plugin-only scans still work).
	local mode = activeScriptScanMode
		or plugin:GetSetting("ISpooferMotion_SCRIPT_SCAN_MODE")
		or "assetIds"
	if mode == "off" then
		return
	end

	local sourceOk, source = pcall(function()
		return (obj :: any).Source
	end)

	if not sourceOk then
		local fullName = "Unknown"
		pcall(function()
			fullName = obj:GetFullName()
		end)
		logToPlugin("[Warning] " .. "[ISpooferMotion] Could not read source of " .. fullName)
		return
	end

	if not source or source == "" then
		return
	end
	if #source > MAX_SCRIPT_SOURCE_BYTES then
		local fullName = "Unknown"
		pcall(function()
			fullName = obj:GetFullName()
		end)
		logToPlugin(
			"[Warning] " .. "[ISpooferMotion] Skipping oversized script source: " .. fullName
		)
		return
	end

	if mode == "fullSource" then
		addRecord(records, obj, "Source", source, false)
	else
		-- assetIds: extract IDs locally and send a compact record. The daemon
		-- builds the script-ref list from these IDs and, at patch time, sends an
		-- old->new mapping back (the plugin re-reads the source and applies it).
		local ids = extractScriptAssetIds(source)
		if #ids > 0 then
			addRecord(records, obj, "SourceIds", HttpService:JSONEncode(ids), false)
		end
	end
end

local FLUSH_MAX_RETRIES: number = 10
local FLUSH_RETRY_WAIT: number = 1.5

--- Attempts to push the current scan chunk to the daemon, retrying on failure.
local function flushScanRecordsOrError(records: { Record })
	for attempt = 1, FLUSH_MAX_RETRIES do
		if flushRecords(records) then
			return
		end
		if attempt < FLUSH_MAX_RETRIES then
			logToPlugin(
				"[Warning] "
					.. string.format(
						"[ISpooferMotion] Scan chunk send failed (attempt %d/%d), pausing %.1fs before retry...",
						attempt,
						FLUSH_MAX_RETRIES,
						FLUSH_RETRY_WAIT
					)
			)
			task.wait(FLUSH_RETRY_WAIT)
		end
	end
	error("Could not send Studio scan records after " .. FLUSH_MAX_RETRIES .. " attempts")
end

--- Runs all property extractors against a single instance.
local function processScannedObject(records: { Record }, obj: Instance)
	if obj:IsA("Sound") or obj:IsA("AudioPlayer") or obj:IsA("AudioEmitter") then
		if not isScanTypeEnabled("sounds") then
			return
		end
	elseif obj:IsA("Animation") then
		if not isScanTypeEnabled("animations") then
			return
		end
	elseif
		obj:IsA("Decal")
		or obj:IsA("Texture")
		or obj:IsA("ImageLabel")
		or obj:IsA("ImageButton")
		or obj:IsA("Sky")
	then
		if not isScanTypeEnabled("images") then
			return
		end
	elseif
		obj:IsA("SpecialMesh")
		or obj:IsA("FileMesh")
		or obj:IsA("MeshPart")
		or obj:IsA("CharacterMesh")
	then
		if not isScanTypeEnabled("meshes") then
			return
		end
	end

	scanAttributeRecords(records, obj)
	scanTagRecords(records, obj)

	-- scannedProps is created first so scanSpecialInstanceAssets can populate it.
	-- This prevents scanBundledStringProperties from re-reading properties that
	-- were already captured (e.g. Sound.SoundId, MeshPart.TextureID).
	local scannedProps: { [string]: boolean } = {}
	scanSpecialInstanceAssets(records, obj, scannedProps)

	local assetProps = ASSET_PROPERTIES[obj.ClassName]
	if assetProps then
		for _, prop in ipairs(assetProps) do
			if not scannedProps[prop] then
				scannedProps[prop] = true
				captureProperty(records, obj, prop)
			end
		end
	end

	scanBundledStringProperties(records, obj, scannedProps)
	scanValueObjectRecord(records, obj)
	scanScriptSourceRecord(records, obj)
	scanEmbeddedStringAssets(records, obj)
end

--- Crawls all requested services in the DataModel to find assets.
local function scanAssets(): ()
	local bundledAssetClasses = countBundledClasses(ASSET_PROPERTIES)
	local bundledStringClasses = countBundledClasses(STRING_SCAN_PROPERTIES)

	if bundledAssetClasses == 0 then
		logToPlugin(
			"[Warning] [ISpooferMotion] No API dump loaded (ASSET_PROPERTIES is empty). Fallback data was not shipped or fetch failed."
		)
	else
		logToPlugin(
			string.format(
				"[ISpooferMotion] Using bundled API dump (%d asset classes, %d string-scan classes)",
				bundledAssetClasses,
				bundledStringClasses
			)
		)
	end

	local placeId = 0
	pcall(function()
		placeId = game.PlaceId
	end)

	local placeName = nil
	pcall(function()
		if game.Name and game.Name ~= "" then
			placeName = game.Name
		end
	end)

	if not postJson("/scan-start", { placeId = placeId, placeName = placeName }) then
		pcall(function()
			postJson("/scan-abort", {})
		end)
		return
	end

	resetObjectRegistry()
	resetScanRecordState()

	local records: { Record } = {}
	local captured = 0
	local processed = 0
	local lastYieldTime = os.clock()
	local lastProgressTime = 0

	local stack: { { obj: Instance, currentService: string } } = {}

	if activeScanPath and activeScanPath ~= "" then
		local targetObj = resolveInstancePath(activeScanPath)
		if targetObj then
			local fullPath = "Unknown"
			pcall(function()
				fullPath = targetObj:GetFullName()
			end)
			logToPlugin("[ISpooferMotion] Scanning targeted path: " .. fullPath)
			table.insert(stack, { obj = targetObj, currentService = fullPath })
		else
			logToPlugin(
				"[Warning] [ISpooferMotion] Target path not found: "
					.. tostring(activeScanPath)
					.. ", scanning all services."
			)
			for i = #SERVICES_TO_SCAN, 1, -1 do
				local serviceName = SERVICES_TO_SCAN[i]
				local ok, service = pcall(function()
					return game:GetService(serviceName)
				end)
				if ok and service then
					table.insert(stack, { obj = service, currentService = serviceName })
				end
			end
		end
		activeScanPath = nil
	else
		for i = #SERVICES_TO_SCAN, 1, -1 do
			local serviceName = SERVICES_TO_SCAN[i]
			local ok, service = pcall(function()
				return game:GetService(serviceName)
			end)
			if ok and service then
				table.insert(stack, { obj = service, currentService = serviceName })
			end
		end
	end

	while #stack > 0 do
		local current = table.remove(stack)
		local obj = current.obj
		local currentService = current.currentService

		processed += 1
		processScannedObject(records, obj)

		if #records >= SEND_CHUNK_SIZE or getPendingRecordBytes() >= SCAN_CHUNK_BYTES then
			captured += #records
			flushScanRecordsOrError(records)
		end

		local now = os.clock()
		if now - lastProgressTime >= 0.25 then
			pcall(function()
				postJson("/scan-progress", {
					scanning = true,
					current_service = currentService,
					scanned = processed,
				})
			end)
			lastProgressTime = now
		end

		if now - lastYieldTime >= 0.012 then
			task.wait(0)
			lastYieldTime = os.clock()
		end

		local ok, children = pcall(function()
			return obj:GetChildren()
		end)
		if ok and type(children) == "table" then
			for i = #children, 1, -1 do
				table.insert(stack, { obj = children[i], currentService = currentService })
			end
		end
	end

	captured += #records
	flushScanRecordsOrError(records)

	local completeOk, response = postJson("/scan-complete", {})
	if not completeOk then
		error("Could not finalize Studio scan")
	end

	local totals = response and response.totals or {}

	if response and response.recordsTruncated then
		local truncatedCount = tonumber(response.truncatedCount) or 0
		local keepCount = tonumber(response.keptCount) or 0
		if truncatedCount > 0 then
			logToPlugin(
				"[Warning] "
					.. string.format(
						"[ISpooferMotion] Scan hit the server record limit: %d records kept, %d dropped. Very large places may miss some assets - try splitting into separate places or filtering to specific services.",
						keepCount,
						truncatedCount
					)
			)
		else
			logToPlugin(
				"[Warning] "
					.. "[ISpooferMotion] Scan hit the server record limit - some assets may be missing. Try splitting very large places or contact support."
			)
		end
	end

	logToPlugin(
		string.format(
			"[ISpooferMotion] Scan complete: %d records captured, %d animations, %d sounds, %d images, %d meshes, %d script refs",
			captured,
			tonumber(totals.animations) or 0,
			tonumber(totals.sounds) or 0,
			tonumber(totals.images) or 0,
			tonumber(totals.meshes) or 0,
			tonumber(totals.scriptRefs) or 0
		)
	)
	if autoReplaceEnabled then
		-- Clear records after sending
		table.clear(records)
		setPluginGuiStatus("Waiting for new scan or replacements...")
	end
end

--- Kicks off a full workspace scan, managing state locks and error handling.
local function scan(): ()
	if scanRunning then
		logToPlugin("[Warning] Scan already running")
		return
	end

	if patchRunning then
		logToPlugin("[Warning] Patch already running, cannot scan")
		return
	end
	if manualReplaceRunning then
		logToPlugin("[Warning] Manual replacement already running, cannot scan")
		return
	end

	scanRunning = true
	local ok, err = pcall(scanAssets)
	scanRunning = false

	if not ok then
		resetObjectRegistry()
		resetScanRecordState()
		pcall(function()
			postJson("/scan-abort", {})
		end)
		logToPlugin("[Warning] " .. "[ISpooferMotion] Scan failed: " .. tostring(err))
		setPluginGuiStatus("Scan Failed. Waiting for scan or replacements...")
	end
end
