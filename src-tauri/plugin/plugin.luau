--// Hello from cody.
--!nocheck
--!nolint
--# selene: allow(unused_variable, global_usage)
local ASSET_PROPERTIES: { [string]: { string } } = {}
local STRING_SCAN_PROPERTIES: { [string]: { string } } = {}

-- Dummy declarations to satisfy IDE Luau Language Server (shadowed by includes)
local startPolling: any
local hidePluginGui: any
local togglePluginGui: any
local logToPlugin: any
local polling: any
local BASE_URL: any

--#include "src/version/version.luau"
--#include "src/config/runtime.luau"
--#include "src/ui/gui.luau"
--#include "src/types/assets.luau"
--#include "src/state/registry.luau"
--#include "src/util/assets.luau"
--#include "src/net/http.luau"
--#include "src/scan/properties.luau"
--#include "src/scan/scanner.luau"
--#include "src/patch/mesh.luau"
--#include "src/patch/patcher.luau"
--#include "src/bridge/discovery.luau"
--#include "src/bridge/polling.luau"

-- Runtime assertions to validate the build step included modules in the correct order
assert(
	MAX_SCRIPT_SOURCE_BYTES ~= nil,
	"Include order violation: config/runtime.luau not loaded early"
)
assert(normalizeAssetId ~= nil, "Include order violation: util/assets.luau not loaded")
assert(getMaxRecordValueBytes ~= nil, "Include order violation: scan/properties.luau not loaded")
assert(applyPatch ~= nil, "Include order violation: patch/patcher.luau not loaded")

--- Manual Replacement Handler (declared before _G registration so the table is valid at load time)
local function runManualReplacements(text: string)
	local mappings = {}
	local count = 0
	for line in string.gmatch(text, "[^\n\r]+") do
		local oldId, newId = string.match(line, "(%d+)%s*[-=]>%s*(%d+)")
		if not oldId then
			oldId, newId = string.match(line, "(%d+)%s*:%s*(%d+)")
		end
		if oldId and newId then
			mappings[oldId] = newId
			count += 1
		end
	end

	if count == 0 then
		warn("[ISpooferMotion] No valid mappings found. Format should be: 1234 -> 5678")
		return
	end

	print(string.format("[ISpooferMotion] Starting manual replacement with %d mappings...", count))
	local replacedCount = 0

	local function checkAndReplaceProperty(obj: Instance, prop: string)
		local ok, val = pcall(function()
			return (obj :: any)[prop]
		end)
		if not ok or val == nil then
			return
		end

		local strVal = nil
		if type(val) == "string" then
			strVal = val
		elseif typeof(val) == "Content" then
			local ok2, uri = pcall(function()
				return (val :: any).Uri
			end)
			if ok2 then
				strVal = uri
			end
		elseif type(val) == "number" then
			strVal = tostring(val)
		end

		if not strVal then
			return
		end

		for oldId, newId in pairs(mappings) do
			if string.find(strVal, oldId, 1, true) then
				local newVal = string.gsub(strVal, oldId, newId)

				if obj:IsA("MeshPart") and (prop == "MeshId" or prop == "TextureID") then
					-- We must use copyMeshPartInto to safely clone the MeshPart because MeshId cannot be assigned
					local targetMeshUri = if prop == "MeshId" then newVal else nil
					local targetTextureUri = if prop == "TextureID" then newVal else nil

					-- Only pass the overrideTextureId if TextureID is actually changing, otherwise nil allows copyMeshPartInto to copy original
					local createOk, createdPart = pcall(function()
						-- If MeshId hasn't been changed yet, use the original
						local mId = targetMeshUri or obj.MeshId
						-- Coerce number to rbxassetid:// if it isn't already
						if not string.match(mId, "^%a+://") and string.match(mId, "^%d+$") then
							mId = "rbxassetid://" .. mId
						end
						return AssetService:CreateMeshPartAsync(mId, {
							CollisionFidelity = obj.CollisionFidelity,
							RenderFidelity = obj.RenderFidelity,
						})
					end)

					local objStillValid = pcall(function()
						return obj.Parent
					end)
					if not objStillValid or obj.Parent == nil then
						if createOk and createdPart then
							pcall(function()
								createdPart:Destroy()
							end)
						end
						break -- object was deleted during async yield, abort this property
					end

					local newPart: BasePart
					if createOk and createdPart and createdPart:IsA("BasePart") then
						newPart = createdPart
					else
						warn(
							"[ISpooferMotion] Manual Swap: Failed to create MeshPart asynchronously. Falling back to Part+SpecialMesh."
						)
						local fallbackPart = Instance.new("Part")
						local specialMesh = Instance.new("SpecialMesh")

						local mId = targetMeshUri or obj.MeshId
						if not string.match(mId, "^%a+://") and string.match(mId, "^%d+$") then
							mId = "rbxassetid://" .. mId
						end
						specialMesh.MeshId = mId
						specialMesh.Scale = Vector3.new(1, 1, 1)

						local tId = targetTextureUri or obj.TextureID
						if tId and tId ~= "" then
							if not string.match(tId, "^%a+://") and string.match(tId, "^%d+$") then
								tId = "rbxassetid://" .. tId
							end
							specialMesh.TextureId = tId
						end

						specialMesh.Parent = fallbackPart
						newPart = fallbackPart
					end

					-- Safely copy properties and children
					local copyOk, copyErr = pcall(function()
						-- Ensure TextureID is formatted if it's changing
						local formatTex = targetTextureUri
						if
							formatTex
							and not string.match(formatTex, "^%a+://")
							and string.match(formatTex, "^%d+$")
						then
							formatTex = "rbxassetid://" .. formatTex
						end
						copyMeshPartInto(obj, newPart, formatTex)
					end)

					if copyOk then
						-- Swap parent
						local parentOk = pcall(function()
							newPart.Parent = obj.Parent
						end)
						if parentOk then
							pcall(function()
								obj:Destroy()
							end)
							replacedCount += 1
							print(
								string.format(
									"[ISpooferMotion] Manual Swap: Recreated MeshPart %s",
									newPart.Name
								)
							)
						end
					end
					break
				else
					local assignOk, err = pcall(function()
						-- For standard properties, just assign the new string
						-- Roblox engine handles string -> Content coercion automatically
						(obj :: any)[prop] = newVal
					end)
					if assignOk then
						replacedCount += 1
						print(
							string.format(
								"[ISpooferMotion] Manual Swap: %s.%s (%s -> %s)",
								obj.Name,
								prop,
								oldId,
								newId
							)
						)
					end
				end
			end
		end
	end

	local function processInstance(obj: Instance)
		-- Check all known asset properties using the API dump maps
		local props = ASSET_PROPERTIES[obj.ClassName]
		if props then
			for _, prop in ipairs(props) do
				checkAndReplaceProperty(obj, prop)
			end
		end

		local stringProps = STRING_SCAN_PROPERTIES[obj.ClassName]
		if stringProps then
			for _, prop in ipairs(stringProps) do
				checkAndReplaceProperty(obj, prop)
			end
		end

		-- Handle Script source replacement safely
		if obj:IsA("LuaSourceContainer") and obj.ClassName ~= "CoreScript" then
			local ok, src = pcall(function()
				return (obj :: any).Source
			end)
			if ok and src and type(src) == "string" then
				local newSrc = src
				local modified = false
				for oldId, newId in pairs(mappings) do
					-- Use safer patterns to avoid corrupting variable names

					-- Replace plain numbers only if preceded by assignment, table syntax, or comma
					local safePattern = "([=:{,]%s*)" .. oldId .. "(%f[%D])"
					if string.find(newSrc, safePattern) then
						newSrc = string.gsub(newSrc, safePattern, "%1" .. newId .. "%2")
						modified = true
					end

					-- Explicit rbxassetid:// URI replacement
					local rbxUriPattern = "rbxassetid://" .. oldId
					if string.find(newSrc, rbxUriPattern, 1, true) then
						newSrc = string.gsub(newSrc, rbxUriPattern, "rbxassetid://" .. newId)
						modified = true
					end

					-- Explicit web URL replacement
					local rbxUrlPattern = "(roblox%.com/[Aa]sset/%?[Ii][Dd]=)" .. oldId
					if string.find(newSrc, rbxUrlPattern) then
						newSrc = string.gsub(newSrc, rbxUrlPattern, "%1" .. newId)
						modified = true
					end
				end

				if modified then
					local assignOk, err = pcall(function()
						if ScriptEditorService then
							ScriptEditorService:UpdateSourceAsync(obj :: any, function()
								return newSrc
							end)
						else
							(obj :: any).Source = newSrc
						end
					end)
					if assignOk then
						replacedCount += 1
						print("[ISpooferMotion] Manual Swap: Updated Source in " .. obj.Name)
					end
				end
			end
		end
	end

	local roots = {
		workspace,
		game:GetService("StarterPlayer"),
		game:GetService("StarterGui"),
		game:GetService("ReplicatedStorage"),
		game:GetService("Lighting"),
	}

	for _, root in ipairs(roots) do
		for _, descendant in ipairs(root:GetDescendants()) do
			processInstance(descendant)
		end
	end

	print(
		string.format(
			"[ISpooferMotion] Manual replacement complete! Modified %d properties.",
			replacedCount
		)
	)
end

--- Spawns runManualReplacements in a task so GUI click handlers (which cannot yield)
--- don't crash Studio when CreateMeshPartAsync is hit.
local function runManualReplacementsAsync(text: string)
	task.spawn(runManualReplacements, text)
end

-- Register the plugin API table BEFORE startPolling() and GUI creation so any button
-- click that fires immediately after plugin load never sees a nil handler.
_G.ISpooferMotionPlugin = {
	runManualReplacements = runManualReplacementsAsync,
	-- Expose the sync version for scripting contexts that manage their own coroutine.
	runManualReplacementsSync = runManualReplacements,
}

print("[ISpooferMotion] Plugin loaded. Starting background connection to Desktop App...")
startPolling()

local toolbar = plugin:CreateToolbar("ISpooferMotion")
local toggleButton =
	toolbar:CreateButton("Toggle UI", "Show/Hide ISpooferMotion UI", "rbxassetid://137844667859456")

toggleButton.Click:Connect(function()
	togglePluginGui()
end)

plugin.Unloading:Connect(function()
	polling = false
	BASE_URL = nil
	hidePluginGui()
end)
