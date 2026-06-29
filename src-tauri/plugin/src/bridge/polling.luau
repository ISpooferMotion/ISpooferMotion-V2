local function requestPollEndpoint(baseUrl: string, endpoint: string): (boolean, any, number?)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = baseUrl .. endpoint,
			Method = "GET",
			Headers = {
				["X-API-Key"] = API_KEY or "",
			},
		})
	end)

	if not ok or not response then
		return false, nil, nil
	end

	if response.StatusCode == 401 then
		return false, nil, 401
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

local function fetchApiDumpProperties()
	print("[ISpooferMotion] Fetching Dynamic API Dump from GitHub...")
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json",
			Method = "GET"
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
				return string.sub(lower, -2) == "id"
					or string.sub(lower, -3) == "url"
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
				if className ~= "HumanoidDescription" then return false end
				if valType == "int64" and (string.find(name, "Animation") or name == "Face" or name == "Head" or name == "LeftArm" or name == "LeftLeg" or name == "RightArm" or name == "RightLeg" or name == "Torso" or name == "GraphicTShirt" or name == "Pants" or name == "Shirt") then
					return true
				end
				return (valType == "string" or valType == "int64" or string.find(valType, "Array")) and string.find(name, "Accessory")
			end
			
			local function isAssetProperty(className, member)
				local valType = member.ValueType and member.ValueType.Name or ""
				local name = member.Name
				local isAsset = valType == "Content" or valType == "ContentId"
				if not isAsset and (valType == "string" or valType == "int64") and isAssetLike(name) then
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
				local assets = getProperties(class.Name, function(c, m) return isAssetProperty(c, m) end)
				if #assets > 0 then newAssetProps[class.Name] = assets end
				
				local strings = getProperties(class.Name, function(c, m)
					local v = m.ValueType and m.ValueType.Name or ""
					return v == "string" or v == "Content" or v == "ContentId"
				end)
				if #strings > 0 then newStringProps[class.Name] = strings end
			end
			
			ASSET_PROPERTIES = newAssetProps
			STRING_SCAN_PROPERTIES = newStringProps
			print("[ISpooferMotion] Fetched and parsed API Dump from GitHub successfully.")
		else
			warn("[ISpooferMotion] Failed to parse API Dump from GitHub.")
		end
	else
		warn("[ISpooferMotion] Failed to fetch API Dump from GitHub.")
	end
end

local function startPolling(): ()
	if polling then
		return
	end

	polling = true

	task.spawn(function()
		while polling do
			if not BASE_URL or os.clock() - lastDiscovery >= 5 then
				local connected, changed = discoverServer()
				lastDiscovery = os.clock()
				if connected and changed and BASE_URL then
					print("[ISpooferMotion] Connected to " .. BASE_URL)
					setPluginGuiStatus("Connected to Desktop App.")
					task.spawn(fetchApiDumpProperties)
					task.spawn(scan)
				end
			end
			task.wait(BASE_URL and 1 or 2)
		end
	end)

	task.spawn(function()
		while polling do
			local baseUrl = BASE_URL
			if baseUrl then
				local pollOk, decoded, statusCode = requestPollEndpoint(baseUrl, "/poll")

				if statusCode == 401 then
					warn("[ISpooferMotion] Pairing expired; rediscovering local app")
					setPluginGuiStatus("Pairing expired; reconnecting...")
					clearPairingState()
				elseif not pollOk then
					warn("[ISpooferMotion] Lost connection to " .. baseUrl)
					setPluginGuiStatus("Lost connection; reconnecting...")
					BASE_URL = nil
				elseif type(decoded) == "table" and decoded.requestAssets == true then
					if scanRunning then
						print("[ISpooferMotion] Scan already running")
					elseif patchRunning then
						print("[ISpooferMotion] Patch running; skipping scan request")
					else
						print("[ISpooferMotion] App requested scan")
						autoReplaceEnabled = true
						setPluginGuiStatus("Scanning Assets...")
						task.spawn(scan)
					end
				end
			end

			task.wait(BASE_URL and 0.5 or 2)
		end
	end)

	task.spawn(function()
		while polling do
			local baseUrl = BASE_URL
			if baseUrl and autoReplaceEnabled then
				local patchOk, decoded, statusCode =
					requestPollEndpoint(baseUrl, "/poll-replacements")

				if statusCode == 401 then
					warn("[ISpooferMotion] Pairing expired; rediscovering local app")
					clearPairingState()
				elseif patchOk and type(decoded) == "table" then
					local patches = decoded.patches
					local mappings = decoded.mappings

					if type(patches) == "table" and #patches > 0 then
						if scanRunning then
							warn("[ISpooferMotion] Scan running; skipping patch batch")
						elseif patchRunning then
							warn("[ISpooferMotion] Patch batch already running")
						else
							print("[ISpooferMotion] Received " .. #patches .. " targeted patches")
							autoReplaceEnabled = false
							setPluginGuiStatus("Applying " .. #patches .. " targeted replacements...")
							task.spawn(applyPatches, patches)
						end
					elseif type(mappings) == "table" and #mappings > 0 then
						warn(
							"[ISpooferMotion] No targeted patches were available. Run Scan before retrying replacement."
						)
					end
				end
			end

			task.wait(BASE_URL and 0.5 or 2)
		end
	end)
end
