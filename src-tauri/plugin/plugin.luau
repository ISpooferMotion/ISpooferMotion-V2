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
local function runManualReplacementsCore(text: string)
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
		return false
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

		if not strVal or not string.find(strVal, "%d") then
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
						local assignOk = pcall(function()
							(obj :: MeshPart).TextureID = toAssetUriString(newVal)
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

					local targetMeshUri = toAssetUriString(newVal)
					local targetTextureUri = nil
					pcall(function()
						local texture = (obj :: MeshPart).TextureID
						if texture and texture ~= "" then
							for texOld, texNew in pairs(mappings) do
								local texPattern = "%f[%d]" .. texOld .. "%f[%D]"
								if string.find(texture, texPattern) then
									targetTextureUri = toAssetUriString(
										string.gsub(texture, texPattern, texNew)
									)
									break
								end
							end
						end
					end)

					local replaceOk, replaceErr = applyMeshPartInPlace(
						obj :: MeshPart,
						targetMeshUri,
						targetTextureUri
					)
					if replaceOk then
						replacedCount += 1
						print(
							string.format(
								"[ISpooferMotion] Manual Swap: Updated MeshPart %s in place",
								obj.Name
							)
						)
					else
						warn(
							"[ISpooferMotion] Manual Swap: MeshPart update failed for "
								.. obj.Name
								.. ": "
								.. tostring(replaceErr)
						)
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

	-- pcall so an unexpected error can never leave the ChangeHistory recording
	-- open (an open recording breaks Studio undo until restart).
	local lastYieldTime = os.clock()
	local runOk, runErr = pcall(function()
		for _, root in ipairs(roots) do
			for _, descendant in ipairs(root:GetDescendants()) do
				processInstance(descendant)
				if os.clock() - lastYieldTime > 0.012 then
					task.wait()
					lastYieldTime = os.clock()
				end
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
		return false
	end

	print(
		string.format(
			"[ISpooferMotion] Manual replacement complete! Modified %d properties.",
			replacedCount
		)
	)
	return true
end

local function manualReplacementBusy(): boolean
	return manualReplaceRunning or scanRunning or patchRunning
end

local function runManualReplacements(text: string): boolean
	if manualReplacementBusy() then
		warn("[ISpooferMotion] Another scan or replacement operation is already running.")
		return false
	end

	manualReplaceRunning = true
	local ok, result = pcall(runManualReplacementsCore, text)
	manualReplaceRunning = false
	if not ok then
		warn("[ISpooferMotion] Manual replacement failed: " .. tostring(result))
		return false
	end
	return result == true
end

--- Runs manual replacement off the GUI event thread and reports real completion.
local function runManualReplacementsAsync(text: string, onComplete: any?): boolean
	if manualReplacementBusy() then
		warn("[ISpooferMotion] Another scan or replacement operation is already running.")
		return false
	end

	manualReplaceRunning = true
	task.spawn(function()
		local ok, result = pcall(runManualReplacementsCore, text)
		manualReplaceRunning = false
		local success = ok and result == true
		if not ok then
			warn("[ISpooferMotion] Manual replacement failed: " .. tostring(result))
		end
		if type(onComplete) == "function" then
			pcall(onComplete, success)
		end
	end)
	return true
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
