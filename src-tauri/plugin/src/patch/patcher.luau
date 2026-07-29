--!nolint UnknownGlobal
--!nocheck
--!nolint

-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global
--- Handles applying targeted replacement instructions received from the daemon.
---
--- The desktop app analyzes the scanned assets, finds matches in its local database
--- or the community cache, and sends back an array of `Patch` objects telling us
--- exactly what to change.
local BLOCKED_SET_PROPERTIES: { [string]: boolean } = {
	Parent = true,
	ClassName = true,
	Source = true,
}

local VALID_PATCH_ACTIONS: { [string]: boolean } = {
	setProperty = true,
	replaceEmotes = true,
	replaceAccessories = true,
	replaceTags = true,
	replaceAttribute = true,
	replaceScriptSource = true,
	replaceMeshPart = true,
}

--- Cleans up raw ID strings or Roblox URLs into a plain numeric asset ID.
local function normalizeAssetId(value: any): string?
	if value == nil then
		return nil
	end

	local str = string.lower(tostring(value))
	if str == "" then
		return nil
	end

	local assetId = string.match(str, "^rbxassetid://(%d+)$")
		or string.match(str, "^rbxasset://(%d+)$")
		or string.match(str, "^id=(%d+)$")
		-- Anchored: only match when id= appears at the end of the query string or is the sole
		-- param. Prevents extracting IDs from keys like '?badid=12345abc'.
		or string.match(str, "[?&]id=(%d+)$")
		or string.match(str, "roblox%.com/asset/%?id=(%d+)$")
		or string.match(str, "roblox%.com/library/(%d+)$")
		or string.match(str, "roblox%.com/catalog/(%d+)$")
		or string.match(str, "create%.roblox%.com/marketplace/asset/(%d+)$")
		or string.match(str, "^%d+$")

	if not assetId or #assetId > 20 then
		return nil
	end

	return assetId
end

--- Converts a raw ID or URL into a standard `rbxassetid://` URI.
local function toAssetUri(value: any): string?
	local assetId = normalizeAssetId(value)
	return if assetId then "rbxassetid://" .. assetId else nil
end

--- Safely converts an incoming patch value into the type expected by the property.
---
--- For example, if the property expects a `Content` object (like a TextureId), this
--- wraps the raw string before we try to assign it.
local function coercePropertyValue(obj: Instance, property: string, value: any): any
	local readOk, currentValue = pcall(function()
		return (obj :: any)[property]
	end)
	if not readOk then
		return value
	end

	if type(currentValue) == "number" then
		local assetId = normalizeAssetId(value)
		return if assetId then tonumber(assetId) else tonumber(value) or value
	elseif typeof(currentValue) == "Content" then
		local uri = toAssetUri(value) or value
		local ok, contentObj = pcall(function()
			-- luacheck: ignore
			return (Content :: any).fromUri(uri)
		end)
		if ok and contentObj then
			return contentObj
		end
	end

	return value
end

--- Ensures a property name is safe to use and not a malicious payload.
local function validatePropertyName(property: any): (boolean, string?)
	if type(property) ~= "string" or property == "" or #property > 200 then
		return false, "Invalid patch property"
	end
	if string.find(property, "%z") then
		return false, "Invalid patch property"
	end
	return true, nil
end

--- Validates that an incoming raw JSON patch has all the required fields.
local function normalizePatch(rawPatch: any): (Patch?, string?)
	if type(rawPatch) ~= "table" then
		return nil, "Patch must be a table"
	end
	if rawPatch.token == nil or tostring(rawPatch.token) == "" then
		return nil, "Patch is missing token"
	end
	if type(rawPatch.action) ~= "string" or rawPatch.action == "" then
		return nil, "Patch is missing action"
	end
	if not VALID_PATCH_ACTIONS[rawPatch.action] then
		return nil, "Unsupported patch action: " .. tostring(rawPatch.action)
	end

	local property = ""
	if rawPatch.property ~= nil then
		local okProperty, propertyErr = validatePropertyName(rawPatch.property)
		if not okProperty then
			return nil, propertyErr
		end
		property = rawPatch.property
	elseif rawPatch.action == "setProperty" or rawPatch.action == "replaceAttribute" then
		-- These actions require a property name
		return nil, "Patch action '" .. rawPatch.action .. "' requires a property name"
	end

	return {
		token = tostring(rawPatch.token),
		fullName = if rawPatch.fullName ~= nil then tostring(rawPatch.fullName) else nil,
		action = rawPatch.action :: PatchAction,
		property = property,
		value = rawPatch.value,
		meshId = if rawPatch.meshId ~= nil then tostring(rawPatch.meshId) else nil,
		textureId = if rawPatch.textureId ~= nil then tostring(rawPatch.textureId) else nil,
	},
		nil
end

--- Safely decodes a JSON string into a Lua table, enforcing size limits.
local function decodeJsonTable(value: any, label: string): (any?, string?)
	if type(value) ~= "string" then
		return nil, label .. " must be a JSON string"
	end
	-- if #value > 1000000 then
	-- 	return nil, label .. " JSON is too large"
	-- end

	local ok, decoded = pcall(function()
		return HttpService:JSONDecode(value)
	end)
	if not ok or type(decoded) ~= "table" then
		return nil, "Invalid JSON " .. string.lower(label)
	end

	return decoded, nil
end

--- Ensures a decoded tags array is valid and within engine limits.
local function validateTags(decoded: any): (boolean, string?)
	if type(decoded) ~= "table" then
		return false, "Invalid JSON tags"
	end
	if #decoded > MAX_TAGS_PER_OBJECT then
		return false, "Too many tags"
	end

	local count = 0
	for key in pairs(decoded) do
		if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
			return false, "Tags must be an array"
		end
		count += 1
	end
	if count ~= #decoded then
		return false, "Tags must be an array"
	end

	for _, tag in ipairs(decoded) do
		if type(tag) ~= "string" or tag == "" or #tag > MAX_TAG_BYTES then
			return false, "Invalid tag"
		end
	end

	return true, nil
end

--- Executes a single patch against the mapped Studio instance.
local function applyPatch(patch: Patch): (boolean, string?)
	local obj = getRegisteredObject(patch.token)
	if not obj then
		return false, "Studio object no longer exists; scan again"
	end

	local initialParentValid = pcall(function()
		return obj.Parent
	end)
	if not initialParentValid or obj.Parent == nil then
		return false, "Studio object was destroyed or deparented before patching"
	end

	if patch.action == "setProperty" then
		if string.sub(patch.property, 1, 13) == "__Attribute__:" then
			local attr = string.sub(patch.property, 14)
			local okProperty, propertyErr = validatePropertyName(attr)
			if not okProperty then
				return false, propertyErr
			end
			local ok, err = pcall(function()
				obj:SetAttribute(attr, tonumber(patch.value) or patch.value)
			end)
			if ok then
				logToPlugin(
					string.format(
						"[ISpooferMotion] Replaced attribute '%s' on %s -> '%s'",
						attr,
						pcall(function()
							return obj:GetFullName()
						end)
								and obj:GetFullName()
							or obj.Name,
						tostring(patch.value)
					)
				)
			end
			return ok, err
		end

		if BLOCKED_SET_PROPERTIES[patch.property] then
			return false, "Property cannot be set with setProperty"
		end

		local coerced = coercePropertyValue(obj, patch.property, patch.value)
		local ok, err = pcall(function()
			(obj :: any)[patch.property] = coerced
		end)
		if ok then
			local objFullName = "?"
			pcall(function()
				objFullName = obj:GetFullName()
			end)
			logToPlugin(
				string.format(
					"[ISpooferMotion] Replaced property '%s' on %s -> '%s'",
					patch.property,
					objFullName,
					tostring(patch.value)
				)
			)
		end
		return ok, err
	elseif patch.action == "replaceEmotes" then
		if not obj:IsA("HumanoidDescription") then
			return false, "replaceEmotes target is not a HumanoidDescription"
		end
		local decoded, decodeErr = decodeJsonTable(patch.value, "Emotes")
		if not decoded then
			return false, decodeErr
		end
		local ok, err = pcall(function()
			(obj :: any):SetEmotes(decoded)
		end)
		if ok then
			local objFullName = "?"
			pcall(function()
				objFullName = obj:GetFullName()
			end)
			logToPlugin("[ISpooferMotion] Replaced emotes on " .. objFullName)
		end
		return ok, err
	elseif patch.action == "replaceAccessories" then
		if not obj:IsA("HumanoidDescription") then
			return false, "replaceAccessories target is not a HumanoidDescription"
		end
		local decoded, decodeErr = decodeJsonTable(patch.value, "Accessories")
		if not decoded then
			return false, decodeErr
		end
		local ok, err = pcall(function()
			(obj :: any):SetAccessories(decoded)
		end)
		if ok then
			local objFullName = "?"
			pcall(function()
				objFullName = obj:GetFullName()
			end)
			logToPlugin("[ISpooferMotion] Replaced accessories on " .. objFullName)
		end
		return ok, err
	elseif patch.action == "replaceTags" then
		local decoded, decodeErr = decodeJsonTable(patch.value, "Tags")
		if not decoded then
			return false, decodeErr
		end
		local validTags, tagErr = validateTags(decoded)
		if not validTags then
			return false, tagErr
		end
		local ok, err = pcall(function()
			-- Build a set of the incoming new tags so we can safely skip removal of
			-- non-asset tags that happen to match the asset-slot heuristics.
			local newTagSet: { [string]: boolean } = {}
			for _, newTag in ipairs(decoded) do
				newTagSet[newTag] = true
			end
			for _, oldTag in ipairs(CollectionService:GetTags(obj)) do
				-- Only remove a tag if it looks like an asset reference AND is not
				-- already in the replacement set (which would mean it is unchanged).
				if
					not newTagSet[oldTag]
					and (isAssetFormat(oldTag) or stringContainsAssetReference(oldTag))
				then
					CollectionService:RemoveTag(obj, oldTag)
				end
			end
			for _, newTag in ipairs(decoded) do
				CollectionService:AddTag(obj, newTag)
			end
		end)
		if ok then
			local objFullName = "?"
			pcall(function()
				objFullName = obj:GetFullName()
			end)
			logToPlugin(
				string.format("[ISpooferMotion] Replaced %d tag(s) on %s", #decoded, objFullName)
			)
		end
		return ok, err
	elseif patch.action == "replaceAttribute" then
		local okProperty, propertyErr = validatePropertyName(patch.property)
		if not okProperty then
			return false, propertyErr
		end
		local ok, err = pcall(function()
			obj:SetAttribute(patch.property, patch.value)
		end)
		if ok then
			local objFullName = "?"
			pcall(function()
				objFullName = obj:GetFullName()
			end)
			logToPlugin(
				string.format(
					"[ISpooferMotion] Replaced attribute '%s' on %s -> '%s'",
					patch.property,
					objFullName,
					tostring(patch.value)
				)
			)
		end
		return ok, err
	elseif patch.action == "replaceScriptSource" then
		if not obj:IsA("LuaSourceContainer") or obj.ClassName == "CoreScript" then
			return false, "Target is not a script"
		end

		local source = if type(patch.value) == "string"
			then patch.value
			else tostring(patch.value or "")
		-- if #source > MAX_SCRIPT_SOURCE_BYTES then
		-- 	return false, "Script source patch too large"
		-- end

		local ok, err
		if #source >= 200000 then
			ok, err = pcall(function()
				ScriptEditorService:UpdateSourceAsync(obj :: any, function()
					return source
				end)
			end)
		else
			ok, err = pcall(function()
				(obj :: any).Source = source
			end)
		end
		if ok then
			local objFullName = "?"
			pcall(function()
				objFullName = obj:GetFullName()
			end)
			logToPlugin("[ISpooferMotion] Replaced script source in " .. objFullName)
		end
		return ok, err
	elseif patch.action == "replaceMeshPart" then
		if not obj:IsA("MeshPart") then
			return false, "replaceMeshPart target is not a MeshPart"
		end

		local meshObj = obj :: MeshPart
		local targetMeshUri = if patch.meshId then toAssetUri(patch.meshId) else nil
		local targetTextureUri = if patch.textureId then toAssetUri(patch.textureId) else nil

		if patch.meshId and not targetMeshUri then
			return false, "Invalid meshId"
		end
		if patch.textureId and not targetTextureUri then
			return false, "Invalid textureId"
		end
		if not targetMeshUri and not targetTextureUri then
			return false, "replaceMeshPart requires meshId or textureId"
		end

		if not targetMeshUri then
			local ok, err = pcall(function()
				meshObj.TextureID = targetTextureUri :: string
			end)
			return ok, err
		end

		local oldParent = meshObj.Parent
		if not oldParent then
			return false, "MeshPart has no parent"
		end

		-- Yield briefly before creating MeshPart to prevent Studio crashing from rapid mesh creation calls
		task.wait()
		local createOk, createdPart = pcall(function()
			return AssetService:CreateMeshPartAsync(targetMeshUri, {
				CollisionFidelity = meshObj.CollisionFidelity,
				RenderFidelity = meshObj.RenderFidelity,
			})
		end)

		local objStillValid = pcall(function()
			return meshObj.Parent
		end)
		if not objStillValid or meshObj.Parent == nil then
			if createOk and createdPart then
				pcall(function()
					createdPart:Destroy()
				end)
			end
			return false, "Original MeshPart was destroyed while waiting for CreateMeshPartAsync"
		end

		local newPart: BasePart
		if createOk and createdPart and createdPart:IsA("BasePart") then
			newPart = createdPart :: BasePart
		else
			logToPlugin(
				"[Warning] [ISpooferMotion] AssetService:CreateMeshPartAsync failed for "
					.. meshObj.Name
					.. ". Falling back to Part+SpecialMesh (note: mesh physics/collisions will be degraded)."
			)
			local fallbackPart = Instance.new("Part")
			local specialMesh = Instance.new("SpecialMesh")
			specialMesh.MeshId = targetMeshUri
			specialMesh.Scale = Vector3.new(1, 1, 1)
			if targetTextureUri then
				specialMesh.TextureId = targetTextureUri
			end
			specialMesh.Parent = fallbackPart
			newPart = fallbackPart
		end

		local copyOk, copyErr = pcall(function()
			copyMeshPartPropertiesInto(meshObj, newPart, targetTextureUri)
			-- Explicitly re-apply color after CreateMeshPartAsync since the engine
			-- may reset it to default white during async mesh loading
			pcall(function()
				newPart.Color = meshObj.Color
				newPart.Material = meshObj.Material
				newPart.Transparency = meshObj.Transparency
				newPart.Reflectance = meshObj.Reflectance
			end)
		end)
		if not copyOk then
			pcall(function()
				newPart:Destroy()
			end)
			return false, copyErr
		end

		local parentOk, parentErr = pcall(function()
			newPart.Parent = oldParent
		end)
		if not parentOk or newPart.Parent ~= oldParent then
			pcall(function()
				newPart:Destroy()
			end)
			return false, parentErr or "Could not parent replacement MeshPart"
		end

		local moveOk, moveErr = pcall(function()
			moveMeshPartContentsInto(meshObj, newPart)
		end)
		if not moveOk then
			return false, moveErr
		end

		local destroyOk, destroyErr = pcall(function()
			meshObj:Destroy()
		end)
		if not destroyOk then
			return false, destroyErr
		end

		replaceRegisteredObject(patch.token, newPart)
		local objFullName = "?"
		pcall(function()
			objFullName = newPart:GetFullName()
		end)
		logToPlugin(
			string.format(
				"[ISpooferMotion] Replaced MeshPart '%s': mesh=%s texture=%s",
				objFullName,
				targetMeshUri or "(unchanged)",
				targetTextureUri or "(unchanged)"
			)
		)
		return true, nil
	end

	return false, "Unsupported patch action: " .. tostring(patch.action)
end

--- Processes a full batch of replacement instructions from the daemon.
---
--- Wraps the entire operation in a ChangeHistoryService recording so the user
--- can hit Ctrl+Z to undo all the spoofed assets at once if they want.
local function applyPatches(patches: any)
	if patchRunning then
		logToPlugin("[Warning] Patch batch already running")
		return
	end
	if type(patches) ~= "table" then
		logToPlugin("[Warning] Invalid patch batch")
		return
	end
	if #patches > MAX_PATCHES_PER_BATCH then
		logToPlugin(
			"[Warning] Large patch batch: "
				.. tostring(#patches)
				.. " patches - processing will yield frequently"
		)
	end
	if scanRunning then
		logToPlugin("[Warning] Scan already running; skipping patch batch")
		return
	end

	patchRunning = true
	setPluginGuiStatus(string.format("Applying %d replacement(s)...", #patches))
	local recording: any = nil
	local succeeded = 0
	local failed = 0
	local failedPatchesList = {}

	pcall(function()
		recording = ChangeHistoryService:TryBeginRecording("ISpooferMotion Pre-Patch")
	end)

	-- finishPatch is called unconditionally at the end of every code path to ensure
	-- FinishRecording is always paired with TryBeginRecording and patchRunning is cleared.
	local function finishPatch()
		if recording then
			pcall(function()
				ChangeHistoryService:FinishRecording(
					recording,
					Enum.FinishRecordingOperation.Commit
				)
			end)
			recording = nil
		end
		patchRunning = false
	end

	local batchOk, batchErr = pcall(function()
		for index, rawPatch in ipairs(patches) do
			local ok, patchOk, patchErr = pcall(function()
				local patch, validationErr = normalizePatch(rawPatch)
				if not patch then
					return false, validationErr
				end
				return applyPatch(patch)
			end)

			if ok and patchOk then
				succeeded += 1
			else
				failed += 1
				local err = if ok then patchErr else patchOk
				local patchName = if type(rawPatch) == "table"
					then rawPatch.fullName or rawPatch.token
					else "unknown patch"

				-- Record the failed patch ID (or token) to send back to the backend
				local failedId = "unknown"
				if type(rawPatch) == "table" then
					failedId = rawPatch.token or rawPatch.id or patchName
				end
				table.insert(failedPatchesList, failedId)

				logToPlugin(
					"[Warning] "
						.. "[ISpooferMotion] Patch failed for "
						.. tostring(patchName)
						.. ": "
						.. tostring(err)
				)
			end

			if index % 50 == 0 and index < #patches then
				-- Silent=true: transient progress updates should not produce log spam.
				setPluginGuiStatus(
					string.format("Applying replacements (%d/%d)...", index, #patches),
					true
				)
				task.wait()
			end
		end
	end)

	if not batchOk then
		failed += 1
		logToPlugin("[Warning] " .. "[ISpooferMotion] Patch batch failed: " .. tostring(batchErr))
	end

	-- Always commit the history recording and release the patch lock.
	finishPatch()

	logToPlugin(
		string.format(
			"[ISpooferMotion] Targeted replacement complete: %d patches applied, %d failed",
			succeeded,
			failed
		)
	)

	-- Report failed patches back to the desktop app. Include counts so the
	-- app can log "N/M patches applied" instead of guessing from list length.
	pcall(function()
		postJson("/patch-results", {
			failedPatches = failedPatchesList,
			succeeded = succeeded,
			failed = failed,
			total = succeeded + failed,
		})
	end)

	if succeeded > 0 then
		setPluginGuiStatus("Replacements complete. Waiting for new scan or replacements...")
	else
		setPluginGuiStatus("Waiting for new scan or replacements...")
	end
end
