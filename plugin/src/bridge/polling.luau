--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global

local function requestPollEndpoint(baseUrl: string, endpoint: string): (boolean, any, number?)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = baseUrl .. endpoint,
			Method = "GET",
		})
	end)

	if not ok or not response then
		local errStr = string.lower(tostring(response))
		if
			string.find(errStr, "limit")
			or string.find(errStr, "429")
			or string.find(errStr, "exceed")
		then
			return false, "rate_limited", 429
		end
		return false, nil, nil
	end

	if not response.Success then
		if response.StatusCode == 429 then
			return false, "rate_limited", 429
		end
		return false, nil, response.StatusCode
	end

	local decodeOk, decoded = decodeJsonResponseBody(response)
	if not decodeOk then
		return false, nil, response.StatusCode
	end

	return true, decoded, response.StatusCode
end

local fetchingApiDump = false

local function fetchApiDumpProperties()
	if fetchingApiDump then
		return
	end
	fetchingApiDump = true
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json",
			Method = "GET",
		})
	end)

	if ok and response and response.Success then
		local decodeOk, decoded = pcall(function()
			return HttpService:JSONDecode(response.Body)
		end)

		if decodeOk and type(decoded) == "table" and type(decoded.Classes) == "table" then
			local newAssetProps = {}
			local newStringProps = {}

			local function isWritable(member)
				if member.Tags then
					for _, tag in ipairs(member.Tags) do
						if tag == "Hidden" or tag == "ReadOnly" or tag == "NotScriptable" then
							return false
						end
					end
				end
				return true
			end

			local function isAssetLike(name)
				local lower = string.lower(name)

				return string.sub(lower, -3) == "url"
					or string.sub(lower, -5) == "asset"
					or string.sub(lower, -7) == "content"
					or string.sub(lower, -4) == "path"
					or string.sub(lower, -4) == "link"
					or string.sub(lower, -3) == "ref"
					or string.find(lower, "assetid")
					or string.find(lower, "animationid")
					or string.find(lower, "soundid")
					or string.find(lower, "meshid")
					or string.find(lower, "textureid")
					or string.find(lower, "imageid")
					or string.find(lower, "animation")
					or string.find(lower, "sound")
					or string.find(lower, "audio")
					or string.find(lower, "music")
					or string.find(lower, "mesh")
					or string.find(lower, "texture")
					or string.find(lower, "image")
					or string.find(lower, "video")
					or string.find(lower, "decal")
					or string.find(lower, "icon")
					or string.find(lower, "thumbnail")
					or string.find(lower, "skybox")
					or string.find(lower, "accessory")
			end

			local function isHumanoidDescriptionAsset(className, name, valType)
				if className ~= "HumanoidDescription" then
					return false
				end
				if
					valType == "int64"
					and (
						string.find(name, "Animation")
						or name == "Face"
						or name == "Head"
						or name == "LeftArm"
						or name == "LeftLeg"
						or name == "RightArm"
						or name == "RightLeg"
						or name == "Torso"
						or name == "GraphicTShirt"
						or name == "Pants"
						or name == "Shirt"
					)
				then
					return true
				end
				return (valType == "string" or valType == "int64" or string.find(valType, "Array"))
					and string.find(name, "Accessory")
			end

			local function isAssetProperty(className, member)
				local valType = member.ValueType and member.ValueType.Name or ""
				local name = member.Name
				local isAsset = valType == "Content" or valType == "ContentId"
				if
					not isAsset
					and (valType == "string" or valType == "int64")
					and isAssetLike(name)
				then
					isAsset = true
				end
				if not isAsset and isHumanoidDescriptionAsset(className, name, valType) then
					isAsset = true
				end
				return isAsset
			end

			local classMap = {}
			for _, class in ipairs(decoded.Classes) do
				classMap[class.Name] = class
			end

			local function getProperties(className, checkFunc)
				local props = {}
				local current = classMap[className]
				while current do
					if current.Members then
						for _, member in ipairs(current.Members) do
							if member.MemberType == "Property" and isWritable(member) then
								if checkFunc(className, member) then
									table.insert(props, member.Name)
								end
							end
						end
					end
					if current.Superclass and classMap[current.Superclass] then
						current = classMap[current.Superclass]
					else
						current = nil
					end
				end
				return props
			end

			for _, class in ipairs(decoded.Classes) do
				local assets = getProperties(class.Name, function(_c, m)
					return isAssetProperty(class.Name, m)
				end)
				if #assets > 0 then
					newAssetProps[class.Name] = assets
				end

				local strings = getProperties(class.Name, function(_c, m)
					local v = m.ValueType and m.ValueType.Name or ""
					return v == "string" or v == "Content" or v == "ContentId"
				end)
				if #strings > 0 then
					newStringProps[class.Name] = strings
				end
			end

			ASSET_PROPERTIES = newAssetProps
			STRING_SCAN_PROPERTIES = newStringProps
			logToPlugin("[ISpooferMotion] Live API dump loaded from GitHub.")
		else
			logToPlugin(
				"[Warning] [ISpooferMotion] Failed to parse live API dump from GitHub; using bundled data."
			)
		end
	else
		logToPlugin(
			"[Warning] [ISpooferMotion] Could not fetch live API dump from GitHub; using bundled data."
		)
	end

	fetchingApiDump = false
end

local POLL_FAIL_THRESHOLD = 4
local pollFailureStreak = 0
local patchFailureStreak = 0
local deferredScanRequest = nil
local deferredPatchBatches = {}

local function operationBusy(): boolean
	return scanRunning or patchRunning or manualReplaceRunning
end

local function startRequestedScan(decoded: any)
	if type(decoded.scanTypes) == "table" then
		activeScanTypes = decoded.scanTypes
	end
	if type(decoded.scanPath) == "string" and decoded.scanPath ~= "" then
		activeScanPath = decoded.scanPath
	else
		activeScanPath = nil
	end
	logToPlugin("Scan requested by Desktop App")
	autoReplaceEnabled = true
	setPluginGuiStatus("Scanning Assets...")
	task.spawn(scan)
end

local function queuePatchBatch(patches: any)
	table.insert(deferredPatchBatches, patches)
	logToPlugin(
		string.format(
			"[ISpooferMotion] Deferred %d replacement(s) until the current operation finishes",
			#patches
		)
	)
end

local function startPatchBatch(patches: any)
	logToPlugin("Received " .. #patches .. " replacements from Desktop App")
	autoReplaceEnabled = false
	setPluginGuiStatus("Applying " .. #patches .. " targeted replacements...")
	task.spawn(applyPatches, patches)
end

local function markConnectionLost(baseUrl: string, reason: string)
	logToPlugin(
		"[Warning] [ISpooferMotion] Lost connection to " .. baseUrl .. " (" .. reason .. ")"
	)
	setConnectionStatus(false)
	setPluginGuiStatus("Lost connection; reconnecting...")
	BASE_URL = nil
	pollFailureStreak = 0
	patchFailureStreak = 0
end

local function getPollUrl(): string
	local pId = 0
	pcall(function()
		pId = game.PlaceId
	end)
	local pName = ""
	pcall(function()
		if game.Name and game.Name ~= "" then
			pName = game.Name
		end
	end)
	return string.format(
		"/poll?place_id=%s&place_name=%s",
		tostring(pId),
		HttpService:UrlEncode(pName)
	)
end

function startPolling(): ()
	if polling then
		return
	end

	polling = true

	task.spawn(function()
		local wasConnected = false

		local reasonLogged = false
		while polling do
			if not BASE_URL then
				local connected, changed, reason = discoverServer()
				lastDiscovery = os.clock()
				if connected and changed and BASE_URL then
					logToPlugin("[ISpooferMotion] Connected to " .. BASE_URL)
					setConnectionStatus(true)
					setPluginGuiStatus("Waiting for scan or replacements...")
					task.spawn(fetchApiDumpProperties)
					wasConnected = true
					reasonLogged = false
					pollFailureStreak = 0
					patchFailureStreak = 0
				elseif not connected then
					setConnectionStatus(false)

					setPluginGuiStatus("Waiting for Desktop App...", true)

					if not reasonLogged then
						reasonLogged = true
						logToPlugin(
							"[Warning] [ISpooferMotion] "
								.. (reason or "Desktop App not found; reconnecting...")
						)
					end
					wasConnected = false
				end
			end
			task.wait(BASE_URL and 1 or 2)
		end
	end)

	task.spawn(function()
		while polling do
			if deferredScanRequest and not operationBusy() then
				local request = deferredScanRequest
				deferredScanRequest = nil
				startRequestedScan(request)
				task.wait(0.5)
				continue
			end

			local baseUrl = BASE_URL
			if baseUrl then
				local pollOk, decoded, _statusCode = requestPollEndpoint(baseUrl, getPollUrl())

				if not pollOk then
					if decoded == "rate_limited" or _statusCode == 429 then
						task.wait(5)
					else
						pollFailureStreak += 1
						if pollFailureStreak >= POLL_FAIL_THRESHOLD then
							markConnectionLost(baseUrl, "poll failed " .. pollFailureStreak .. "x")
						end
					end
				else
					pollFailureStreak = 0
					if type(decoded) == "table" then
						if decoded.batchSize and type(setPluginBatchSize) == "function" then
							setPluginBatchSize(decoded.batchSize)
						end
						if decoded.requestAssets == true then
							if operationBusy() then
								deferredScanRequest = decoded
								logToPlugin(
									"[ISpooferMotion] Deferred scan request until the current operation finishes"
								)
							else
								startRequestedScan(decoded)
							end
						end
					end
				end
			end

			task.wait(BASE_URL and 0.5 or 2)
		end
	end)

	task.spawn(function()
		task.wait(0.25)
		while polling do
			if #deferredPatchBatches > 0 and not operationBusy() then
				local patches = table.remove(deferredPatchBatches, 1)
				startPatchBatch(patches)
				task.wait(0.5)
				continue
			end

			local baseUrl = BASE_URL
			if baseUrl then
				local patchOk, decoded, _statusCode =
					requestPollEndpoint(baseUrl, "/poll-replacements")

				if not patchOk then
					if decoded == "rate_limited" or _statusCode == 429 then
						task.wait(5)
					else
						patchFailureStreak += 1
						if patchFailureStreak >= POLL_FAIL_THRESHOLD then
							markConnectionLost(
								baseUrl,
								"patch poll failed " .. patchFailureStreak .. "x"
							)
						end
					end
				else
					patchFailureStreak = 0
					if type(decoded) == "table" then
						if decoded.batchSize and type(setPluginBatchSize) == "function" then
							setPluginBatchSize(decoded.batchSize)
						end
						local patches = decoded.patches
						local mappings = decoded.mappings

						if type(patches) == "table" and #patches > 0 then
							if operationBusy() then
								queuePatchBatch(patches)
							else
								startPatchBatch(patches)
							end
						elseif type(mappings) == "table" and #mappings > 0 then
							local _wait = true
						end
					end
				end
			end

			task.wait(BASE_URL and 0.5 or 2)
		end
	end)
end
