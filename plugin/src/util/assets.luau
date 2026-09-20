--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global
--- Provides utility functions for identifying and normalizing asset strings.
---
--- These functions are used extensively during scanning to decide if a string
--- or number looks like a Roblox asset ID. We lean on heuristics here to catch
--- hidden assets in text fields, custom attributes, and tags.

--- Counts the number of top-level keys in the bundled API dump property map.
local function countBundledClasses(propertyMap: { [string]: { string } }): number
	local count = 0
	for _ in pairs(propertyMap) do
		count += 1
	end
	return count
end

--- Checks if a raw number is shaped like a valid Roblox asset ID.
local function valueLooksLikePositiveAssetNumber(value: number): boolean
	if value <= 0 or value % 1 ~= 0 then
		return false
	end

	local strVal = tostring(math.floor(value))
	return #strVal >= 3 and #strVal <= 20
end

--- Coerces various data types (Content, string) into a normalized string.
---
--- We explicitly reject placeholder IDs like `016666666666666` which Roblox
--- sometimes returns for pending assets. Raw numbers are intentionally NOT supported
--- here to prevent blindly treating any integer property (like a timestamp) as an asset ID.
local function contentValueToString(value: any): string?
	if value == nil then
		return nil
	end

	local valueType = typeof(value)
	if valueType == "Content" then
		local okUri, uri = pcall(function()
			return value.Uri
		end)
		if okUri and type(uri) == "string" and uri ~= "" then
			if string.find(uri, "016666666666666") or string.find(uri, "16666666666666") then
				return nil
			end
			return uri
		end
		return nil
	end

	if type(value) == "string" then
		if string.find(value, "016666666666666") or string.find(value, "16666666666666") then
			return nil
		end
		return if value ~= "" and value ~= "nil" then value else nil
	end

	return nil
end

--- Checks if a string is just the same digit repeating (e.g. 00000, 11111)
local function isRepeatingDigits(str: string): boolean
	return string.match(str, "^(%d)%1+$") ~= nil
end

--- Checks if a string contains any recognized Roblox asset URL format.
local function stringContainsAssetReference(val: string): boolean
	local str = string.lower(val)
	local assetId = string.match(str, "^rbxassetid://(%d+)")
		or string.match(str, "^rbxasset://(%d+)")
		or string.match(str, "^id=(%d+)")
		or string.match(str, "[?&]id=(%d+)")
		or string.match(str, "roblox%.com/asset/%?id=(%d+)")
		or string.match(str, "roblox%.com/library/(%d+)")
		or string.match(str, "roblox%.com/catalog/(%d+)")
		or string.match(str, "create%.roblox%.com/marketplace/asset/(%d+)")

	if assetId then
		return not isRepeatingDigits(assetId)
	end

	-- Strict fallback for raw numbers inside strings
	if string.match(str, "^%d+$") and #str >= 7 and #str <= 20 then
		return not isRepeatingDigits(str)
	end

	return false
end

--- Determines if a generic value is strictly an asset ID or URL.
---
--- Unlike `stringContainsAssetReference`, this validates that the entire value
--- represents an asset rather than just containing a reference inside a larger string.
local function isAssetFormat(val: any): boolean
	if type(val) == "string" then
		local lower = string.lower(val)
		if string.match(lower, "^%d+$") and #lower >= 7 and #lower <= 20 then
			return not isRepeatingDigits(lower)
		end
		return stringContainsAssetReference(lower)
	elseif type(val) == "number" then
		return valueLooksLikePositiveAssetNumber(val)
			and not isRepeatingDigits(tostring(math.floor(val)))
	elseif typeof(val) == "Content" then
		local okUri, uri = pcall(function()
			return val.Uri
		end)
		if okUri and type(uri) == "string" and uri ~= "" then
			return stringContainsAssetReference(uri) or isAssetFormat(uri)
		end
	end

	return false
end

-- Suppress IDE warnings for functions that are only called after this file is included
local _ = countBundledClasses
local _ = contentValueToString
