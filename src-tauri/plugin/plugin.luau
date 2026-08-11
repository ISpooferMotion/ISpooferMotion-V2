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
	-- Record the whole run as ONE undo step (the daemon patcher already does
	-- this). If a replacement ever misbehaves, the user can Ctrl+Z the entire
	-- batch instead of losing objects permanently.
	local recording = nil
	pcall(function()
		recording = ChangeHistoryService:TryBeginRecording("ISpooferMotion Manual Replace")
	end)
	local replacedCount = 0
	--- Coerces a raw numeric id into a rbxassetid:// URI; leaves URIs untouched.
	local function toAssetUriString(v)
		if
			v
			and type(v) == "string"
			and not string.match(v, "^%a+://")
			and string.match(v, "^%d+$")
		then
			return "rbxassetid://" .. v
		end
		return v
	end

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
			-- Digit-boundary match: a plain substring find() also matched oldId
			-- INSIDE a longer id (e.g. "123" inside "51236"), corrupting unrelated
			-- assets and triggering spurious MeshPart rebuilds. %f frontiers pin
			-- the match to whole digit runs.
			local idPattern = "%f[%d]" .. oldId .. "%f[%D]"
			if string.find(strVal, idPattern) then
				local newVal = string.gsub(strVal, idPattern, newId)

				if obj:IsA("MeshPart") and (prop == "MeshId" or prop == "TextureID") then
					if prop == "TextureID" then
						-- TextureID is writable at edit time, so change it in place.
						-- Rebuilding the entire MeshPart even for a pure texture swap
						-- destroys the instance for nothing.
						local assignOk = pcall(function()
							(obj :: any).TextureID = toAssetUriString(newVal)
						end)
						if assignOk then
							replacedCount += 1
							print(
								string.format(
									"[ISpooferMotion] Manual Swap: %s.TextureID (%s -> %s)",
									obj.Name,
									oldId,
									newId
								)
							)
						end
						break
					end
					-- prop == "MeshId": MeshId cannot be assigned directly, so the
					-- part must be rebuilt via CreateMeshPartAsync and swapped in.
					local targetMeshUri = toAssetUriString(newVal)
					-- Run the current texture through the mappings as well: the
					-- original part is destroyed by this swap, so a TextureID
					-- replacement queued for the same part would otherwise be lost.
					local targetTextureUri = nil
					pcall(function()
						local tex = (obj :: any).TextureID
						if tex and tex ~= "" then
							for texOld, texNew in pairs(mappings) do
								local texPattern = "%f[%d]" .. texOld .. "%f[%D]"
								if string.find(tex, texPattern) then
									targetTextureUri =
										toAssetUriString(string.gsub(tex, texPattern, texNew))
									break
								end
							end
						end
					end)
					-- Capture the parent BEFORE any move logic runs.
					-- copyMeshPartInto -> moveMeshPartContentsInto sets obj.Parent =
					-- nil as its first step, and reading obj.Parent only AFTER that
					-- call parents the replacement to nil (never enters the place),
					-- then the original is destroyed and the object plus all its
					-- children vanish from the game.
					local oldParent = obj.Parent
					if not oldParent then
						break -- already deparented/destroyed; nothing to swap
					end
					local createOk, createdPart = pcall(function()
						return AssetService:CreateMeshPartAsync(targetMeshUri, {
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
					-- Re-read after the async yield in case the object was moved.
					oldParent = obj.Parent
					local newPart: BasePart
					if createOk and createdPart and createdPart:IsA("BasePart") then
						newPart = createdPart
					else
						warn(
							"[ISpooferMotion] Manual Swap: Failed to create MeshPart asynchronously. Falling back to Part+SpecialMesh."
						)
						local fallbackPart = Instance.new("Part")
						local specialMesh = Instance.new("SpecialMesh")
						specialMesh.MeshId = targetMeshUri
						specialMesh.Scale = Vector3.new(1, 1, 1)
						local tId = targetTextureUri or toAssetUriString((obj :: any).TextureID)
						if tId and tId ~= "" then
							specialMesh.TextureId = tId
						end
						specialMesh.Parent = fallbackPart
						newPart = fallbackPart
					end
					-- Safe order (matches the daemon patcher): 1) copy properties
					-- only, 2) parent the replacement and VERIFY it took, 3) move
					-- children/joints, 4) only then destroy the original.
					local copyOk, copyErr = pcall(function()
						copyMeshPartPropertiesInto(obj, newPart, targetTextureUri)
						-- Re-apply appearance defensively: the engine can reset
						-- these during async mesh creation.
						pcall(function()
							newPart.Color = obj.Color
							newPart.Material = obj.Material
							newPart.Transparency = obj.Transparency
							newPart.Reflectance = obj.Reflectance
						end)
					end)
					if not copyOk then
						pcall(function()
							newPart:Destroy()
						end)
						warn(
							"[ISpooferMotion] Manual Swap: property copy failed for "
								.. obj.Name
								.. ": "
								.. tostring(copyErr)
						)
						break
					end
					local parentOk = pcall(function()
						newPart.Parent = oldParent
					end)
					if not parentOk or newPart.Parent ~= oldParent then
						-- Never destroy the original unless the replacement made it
						-- into the tree.
						pcall(function()
							newPart:Destroy()
						end)
						warn(
							"[ISpooferMotion] Manual Swap: could not parent replacement for "
								.. obj.Name
						)
						break
					end
					local moveOk, moveErr = pcall(function()
						moveMeshPartContentsInto(obj, newPart)
					end)
					if not moveOk then
						-- Keep the original rather than risk losing children that did
						-- not get moved; put it back where it was.
						pcall(function()
							obj.Parent = oldParent
						end)
						warn(
							"[ISpooferMotion] Manual Swap: content move failed for "
								.. obj.Name
								.. ": "
								.. tostring(moveErr)
						)
						break
					end
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

	-- pcall so an unexpected error can never leave the ChangeHistory recording
	-- open (an open recording breaks Studio undo until restart).
	local runOk, runErr = pcall(function()
		for _, root in ipairs(roots) do
			for _, descendant in ipairs(root:GetDescendants()) do
				processInstance(descendant)
			end
		end
	end)
	if recording then
		pcall(function()
			ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
		end)
	end
	if not runOk then
		warn("[ISpooferMotion] Manual replacement stopped early: " .. tostring(runErr))
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
