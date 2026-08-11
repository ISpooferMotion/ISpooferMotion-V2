--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global

-- These variables are globals provided by the environment or other concatenated files
-- HttpService, decodeJsonResponseBody, logToPlugin, discoverServer, setPluginGuiStatus,
-- scanRunning, patchRunning, scan, applyPatches, BASE_URL
--- Manages the main communication loops with the daemon.
---
--- This module runs three concurrent loops:
--- Discovery/Health: Keeps the connection alive and reconnects if dropped.
--- Scan Poller: Waits for the daemon to request a workspace scan.
--- Patch Poller: Waits for targeted replacements from the daemon.

--- Helper to hit a polling endpoint and return the parsed JSON response.
local function requestPollEndpoint(baseUrl: string, endpoint: string): (boolean, any, number?)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = baseUrl .. endpoint,
			Method = "GET",
		})
	end)

	if not ok or not response then
		return false, nil, nil
	end

	if not response.Success then
		return false, nil, response.StatusCode
	end

	local decodeOk, decoded = decodeJsonResponseBody(response)
	if not decodeOk then
		return false, nil, response.StatusCode
	end

	return true, decoded, response.StatusCode
end

-- Guard against concurrent fetchApiDumpProperties calls (e.g. rapid daemon reconnects).
local fetchingApiDump = false

--- Pulls the latest API dump from GitHub to power the property scanner.
---
--- If this fails, we fall back to the bundled API dump data in `properties.luau`.
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
				-- Note: we do NOT check `string.sub(lower, -2) == "id"` here because that matches
				-- non-asset properties like UserId, TeamId, SessionId, etc. The specific patterns
				-- below are sufficient and more precise.
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
	-- Release the guard so a future reconnect can trigger another fetch if needed.
	fetchingApiDump = false
end

-- A single failed HTTP poll is not proof the connection is dead. macOS App
-- Nap, sleep coalescing, Roblox HttpService request coalescing, and short
-- CPU spikes during scan all cause transient failures. Only treat the
-- connection as lost after several consecutive failures.
local POLL_FAIL_THRESHOLD = 4
local pollFailureStreak = 0
local patchFailureStreak = 0

local function markConnectionLost(baseUrl: string, reason: string)
	logToPlugin(
		"[Warning] [ISpooferMotion] Lost connection to " .. baseUrl .. " (" .. reason .. ")"
	)
	setConnectionStatus(false)
	setPluginGuiStatus("Lost connection; reconnecting...")
	BASE_URL = nil
	pollFailureStreak = 0
	patchFailureStreak = 0
	-- autoReplaceEnabled deliberately preserved: after reconnect, if we're
	-- mid-workflow, the next /poll-replacements cycle should still deliver
	-- pending patches instead of forcing the user to manually re-scan.
end

--- Starts the background polling loops.
---
--- Idempotent; if polling is already running, this does nothing.
function startPolling(): ()
	if polling then
		return
	end

	polling = true

	task.spawn(function()
		local wasConnected = false
		-- Log the "why we can't connect" reason once per disconnect episode, not
		-- every discovery cycle, so the console isn't spammed while waiting.
		local reasonLogged = false
		while polling do
			-- Only re-run discovery when we genuinely have no connection.
			-- Re-running on a timer caused reconnect spam because the
			-- probe race could pick a different URL for the same server.
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
					-- Silent: this runs every discovery cycle while disconnected, so
					-- it must not spam the console. The reason below logs once.
					setPluginGuiStatus("Waiting for Desktop App...", true)
					-- Surface the actual reason once per episode. Covers the
					-- initial never-connected case too, not just a dropped link.
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
			local baseUrl = BASE_URL
			if baseUrl then
				local pollOk, decoded, _statusCode = requestPollEndpoint(baseUrl, "/poll")

				if not pollOk then
					pollFailureStreak += 1
					if pollFailureStreak >= POLL_FAIL_THRESHOLD then
						markConnectionLost(baseUrl, "poll failed " .. pollFailureStreak .. "x")
					end
				else
					-- Any successful poll (with or without a scan request) is a heartbeat.
					pollFailureStreak = 0
					if type(decoded) == "table" and decoded.requestAssets == true then
						if scanRunning then
							logToPlugin("[Warning] Scan already running, ignoring poll request")
						elseif patchRunning then
							logToPlugin("[Warning] Patch already running, ignoring poll request")
						else
							-- Pick up scan options pushed from the desktop app.
							if type(decoded.scanTypes) == "table" then
								activeScanTypes = decoded.scanTypes
							end
							if type(decoded.scriptScanMode) == "string" then
								activeScriptScanMode = decoded.scriptScanMode
							end
							logToPlugin("Scan requested by Desktop App")
							autoReplaceEnabled = true
							setPluginGuiStatus("Scanning Assets...")
							task.spawn(scan)
						end
					end
				end
			end

			task.wait(BASE_URL and 0.5 or 2)
		end
	end)

	-- Offset the second loop by 250ms so the two requests don't burst
	-- against the local server on the same tick. Smoother CPU profile and
	-- much less likely to hit Roblox HttpService request coalescing.
	task.spawn(function()
		task.wait(0.25)
		while polling do
			local baseUrl = BASE_URL
			if baseUrl then
				local patchOk, decoded = requestPollEndpoint(baseUrl, "/poll-replacements")

				if not patchOk then
					patchFailureStreak += 1
					if patchFailureStreak >= POLL_FAIL_THRESHOLD then
						markConnectionLost(
							baseUrl,
							"patch poll failed " .. patchFailureStreak .. "x"
						)
					end
				else
					-- Successful patch poll is also a heartbeat.
					patchFailureStreak = 0
					if type(decoded) == "table" then
						local patches = decoded.patches
						local mappings = decoded.mappings

						if type(patches) == "table" and #patches > 0 then
							if scanRunning then
								logToPlugin("[Warning] Scan running, ignoring patches")
							elseif patchRunning then
								logToPlugin("[Warning] Patch already running, ignoring patches")
							else
								logToPlugin(
									"Received " .. #patches .. " replacements from Desktop App"
								)
								autoReplaceEnabled = false
								setPluginGuiStatus(
									"Applying " .. #patches .. " targeted replacements..."
								)
								task.spawn(applyPatches, patches)
							end
						elseif type(mappings) == "table" and #mappings > 0 then
							-- Do nothing, wait for patches to arrive on next poll cycle.
							local _wait = true
						end
					end
				end
			end

			task.wait(BASE_URL and 0.5 or 2)
		end
	end)
end
