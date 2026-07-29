--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global
--- Extracts specific properties from instances during a scan pass.
---
--- It knows about special engine types (like HumanoidDescription or MaterialVariant)
--- and handles bundling up their properties into the standard `Record` format.
local MAX_RECORD_VALUE_BYTES: number = 1000000
local MAX_RECORD_TEXT_VALUE_BYTES: number = 100000
local recordKeys: { [string]: boolean } = {}
local pendingRecordBytes: number = 0

--- Resets the tracking state for unique records and pending bytes.
local function resetScanRecordState()
	recordKeys = {}
	pendingRecordBytes = 0
end

--- Checks how many bytes of data we have queued up to send to the daemon.
local function getPendingRecordBytes(): number
	return pendingRecordBytes
end

--- Returns a safe class name, name, and full path for any instance without crashing.
local function getSafeObjectMetadata(obj: Instance): (string, string, string)
	local className = "Unknown"
	local name = "Unknown"
	local fullName = "Unknown"

	pcall(function()
		className = obj.ClassName
	end)

	pcall(function()
		name = obj.Name
	end)

	pcall(function()
		fullName = obj:GetFullName()
	end)

	return className, name, fullName
end

--- Determines the maximum allowed byte size for a given property's value.
local function getMaxRecordValueBytes(property: string): number
	if property == "Source" then
		return MAX_SCRIPT_SOURCE_BYTES
	end

	if
		property == "Text"
		or property == "PlaceholderText"
		or property == "ToolTip"
		or property == "Value"
	then
		return MAX_RECORD_TEXT_VALUE_BYTES
	end

	return MAX_RECORD_VALUE_BYTES
end

--- Formats a property value and adds it to the current scan chunk if it looks valid.
local function addRecord(
	records: { Record },
	obj: Instance,
	property: string,
	value: any,
	allowNumberAssetId: boolean?
): number
	if type(property) ~= "string" or property == "" then
		return 0
	end

	local normalized = contentValueToString(value, allowNumberAssetId)
	if not normalized or normalized == "" then
		return 0
	end

	local maxBytes = getMaxRecordValueBytes(property)
	if #normalized > maxBytes then
		warn("[ISpooferMotion] Skipping oversized value for " .. property)
		return 0
	end

	local token = registerObject(obj)
	local key = token .. "\0" .. property .. "\0" .. normalized
	if recordKeys[key] then
		return 0
	end
	recordKeys[key] = true

	local className, name, fullName = getSafeObjectMetadata(obj)
	local addedBytes = #token + #className + #name + #fullName + #property + #normalized

	table.insert(records, {
		token = token,
		className = className,
		name = name,
		fullName = fullName,
		property = property,
		value = normalized,
	})

	pendingRecordBytes += addedBytes
	return addedBytes
end

--- Sends the current batch of records to the daemon and clears the local queue.
local function flushRecords(records: { Record }): boolean
	if #records == 0 then
		pendingRecordBytes = 0
		return true
	end

	local ok = postJson("/scan-records", { records = records })
	table.clear(records)
	pendingRecordBytes = 0
	return ok
end

--- Reads a generic property and adds it to the record list if it exists.
local function captureProperty(
	records: { Record },
	obj: Instance,
	property: string,
	scannedProps: { [string]: boolean }?
)
	local ok, value = pcall(function()
		return (obj :: any)[property]
	end)

	if ok then
		addRecord(records, obj, property, value, true)
		-- Mark as scanned so scanBundledStringProperties does not re-read this property.
		if scannedProps then
			scannedProps[property] = true
		end
	end
end

--- Finds nested asset strings inside text properties.
local function scanEmbeddedStringAssets(records: { Record }, obj: Instance)
	for prop in pairs(EMBEDDED_ASSET_PROPS) do
		local ok, val = pcall(function()
			return (obj :: any)[prop]
		end)

		if ok then
			local normalized = contentValueToString(val, false)
			if
				normalized
				and (stringContainsAssetReference(normalized) or isAssetFormat(normalized))
			then
				addRecord(records, obj, prop, normalized, false)
			end
		end
	end
end

--- Scans properties listed in the bundled API dump for string matches.
local function scanBundledStringProperties(
	records: { Record },
	obj: Instance,
	scannedProps: { [string]: boolean }
)
	local props = STRING_SCAN_PROPERTIES[obj.ClassName]
	if not props then
		return
	end

	for _, prop in ipairs(props) do
		if not scannedProps[prop] and not EMBEDDED_ASSET_PROPS[prop] then
			local ok, val = pcall(function()
				return (obj :: any)[prop]
			end)

			if ok then
				local normalized = contentValueToString(val, false)
				if
					normalized
					and (stringContainsAssetReference(normalized) or isAssetFormat(normalized))
				then
					addRecord(records, obj, prop, normalized, false)
				end
			end
		end
	end
end

--- Hardcoded extraction logic for engine classes that need special handling.
local function scanSpecialInstanceAssets(
	records: { Record },
	obj: Instance,
	scannedProps: { [string]: boolean }?
)
	if obj:IsA("HumanoidDescription") then
		for _, prop in ipairs({
			"Face",
			"Head",
			"LeftArm",
			"LeftLeg",
			"RightArm",
			"RightLeg",
			"Torso",
			"GraphicTShirt",
			"Pants",
			"Shirt",
		}) do
			captureProperty(records, obj, prop, scannedProps)
		end

		local okEmotes, emotes = pcall(function()
			return obj:GetEmotes()
		end)

		if okEmotes and type(emotes) == "table" and next(emotes) then
			local okJson, jsonStr = pcall(function()
				return HttpService:JSONEncode(emotes)
			end)

			if okJson and jsonStr then
				addRecord(records, obj, "__Emotes__", jsonStr, false)
			end
		end

		local okAcc, accessories = pcall(function()
			return obj:GetAccessories()
		end)

		if okAcc and type(accessories) == "table" and #accessories > 0 then
			local okJson, jsonStr = pcall(function()
				return HttpService:JSONEncode(accessories)
			end)

			if okJson and jsonStr then
				addRecord(records, obj, "__Accessories__", jsonStr, false)
			end
		end
	end

	if obj:IsA("PackageLink") then
		captureProperty(records, obj, "PackageId", scannedProps)
		captureProperty(records, obj, "AssetId", scannedProps)
	end

	if obj:IsA("SurfaceAppearance") then
		for _, prop in ipairs({ "ColorMap", "MetalnessMap", "NormalMap", "RoughnessMap" }) do
			captureProperty(records, obj, prop, scannedProps)
		end
	end

	if obj:IsA("CharacterMesh") then
		captureProperty(records, obj, "MeshId", scannedProps)
		captureProperty(records, obj, "BaseTextureId", scannedProps)
		captureProperty(records, obj, "OverlayTextureId", scannedProps)
	end

	if obj:IsA("Decal") or obj:IsA("Texture") then
		captureProperty(records, obj, "Texture", scannedProps)
	end

	if obj:IsA("SpecialMesh") or obj:IsA("FileMesh") then
		captureProperty(records, obj, "MeshId", scannedProps)
		captureProperty(records, obj, "TextureId", scannedProps)
	end

	if obj:IsA("MeshPart") then
		captureProperty(records, obj, "MeshId", scannedProps)
		captureProperty(records, obj, "MeshContent", scannedProps)
		captureProperty(records, obj, "TextureID", scannedProps)
	end

	if obj:IsA("Animation") then
		captureProperty(records, obj, "AnimationId", scannedProps)
		-- AnimationContent is the newer Content-typed alias for AnimationId.
		-- Roblox's runtime reads whichever is set, so patching only AnimationId
		-- leaves AnimationContent holding the original asset -- the character
		-- plays the un-spoofed animation and the user sees "it didn't replace".
		-- Scanner needs to capture both so the daemon plans patches for both;
		-- the patcher already handles Content values (see patcher.luau).
		captureProperty(records, obj, "AnimationContent", scannedProps)
	end

	if obj:IsA("Sound") then
		captureProperty(records, obj, "SoundId", scannedProps)
		captureProperty(records, obj, "AudioContent", scannedProps)
	end

	if obj:IsA("ImageLabel") or obj:IsA("ImageButton") then
		captureProperty(records, obj, "Image", scannedProps)
		captureProperty(records, obj, "HoverImage", scannedProps)
		captureProperty(records, obj, "PressedImage", scannedProps)
	end

	if obj:IsA("VideoFrame") then
		captureProperty(records, obj, "Video", scannedProps)
	end

	if obj:IsA("AudioPlayer") or obj:IsA("AudioEmitter") then
		captureProperty(records, obj, "Asset", scannedProps)
		captureProperty(records, obj, "AssetId", scannedProps)
	end

	-- AudioDeviceInput uses the new audio API (added 2024) and holds an asset URI.
	if obj:IsA("AudioDeviceInput") then
		captureProperty(records, obj, "Asset", scannedProps)
	end

	if obj:IsA("ParticleEmitter") or obj:IsA("Beam") or obj:IsA("Trail") then
		captureProperty(records, obj, "Texture", scannedProps)
	end

	if obj:IsA("Shirt") then
		captureProperty(records, obj, "ShirtTemplate", scannedProps)
	end

	if obj:IsA("Pants") then
		captureProperty(records, obj, "PantsTemplate", scannedProps)
	end

	if obj:IsA("ShirtGraphic") then
		captureProperty(records, obj, "Graphic", scannedProps)
	end

	if obj:IsA("Sky") then
		for _, prop in ipairs({
			"SkyboxBk",
			"SkyboxDn",
			"SkyboxFt",
			"SkyboxLf",
			"SkyboxRt",
			"SkyboxUp",
			"SunTextureId",
			"MoonTextureId",
		}) do
			captureProperty(records, obj, prop, scannedProps)
		end
	end

	if obj:IsA("Humanoid") then
		for _, prop in ipairs({
			"ClimbAnimation",
			"FallAnimation",
			"IdleAnimation",
			"JumpAnimation",
			"RunAnimation",
			"SwimAnimation",
			"WalkAnimation",
			"MoodAnimation",
		}) do
			captureProperty(records, obj, prop, scannedProps)
		end
	end

	if obj:IsA("WrapTarget") or obj:IsA("WrapLayer") then
		captureProperty(records, obj, "ReferenceMeshId", scannedProps)
		captureProperty(records, obj, "CageMeshId", scannedProps)
	end

	-- MaterialVariant holds per-channel texture maps that are independently spoofable.
	if obj:IsA("MaterialVariant") then
		for _, prop in ipairs({ "ColorMap", "MetalnessMap", "NormalMap", "RoughnessMap" }) do
			captureProperty(records, obj, prop, scannedProps)
		end
	end
end
