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
local function runManualReplacements(
	text: string,
	progressCallback: ((number, number, number, boolean) -> ())?,
	customBatchSize: number?
)
	local mappings: { [string]: string } = {}
	local count = 0
	for line in string.gmatch(text, "[^\n\r]+") do
		local oldId, newId = string.match(line, "(%d+)%s*[-=]>%s*(%d+)")
		if not oldId then
			oldId, newId = string.match(line, "(%d+)%s*:%s*(%d+)")
		end
		if not oldId then
			oldId, newId = string.match(line, "(%d+)%s*,%s*(%d+)")
		end
		if not oldId then
			oldId, newId = string.match(line, "(%d+)%s+(%d+)")
		end
		if oldId and newId and oldId ~= newId then
			mappings[oldId] = newId
			count += 1
		end
	end

	if count == 0 then
		warn("[ISpooferMotion] No valid mappings found. Format should be: 1234 -> 5678")
		if progressCallback then
			progressCallback(0, 0, 0, true)
		end
		return
	end

	local resolvedBatchSize = customBatchSize
	if not resolvedBatchSize then
		pcall(function()
			local saved = plugin:GetSetting("ManualBatchSize")
			if type(saved) == "number" and saved >= 10 and saved <= 500 then
				resolvedBatchSize = saved
			end
		end)
	end
	resolvedBatchSize = math.clamp(tonumber(resolvedBatchSize) or 50, 5, 1000)

	logToPlugin(
		string.format(
			"[ISpooferMotion] Starting batched manual replacement with %d mappings (batch size: %d)...",
			count,
			resolvedBatchSize
		)
	)
	setPluginGuiStatus(string.format("Starting manual replacement (%d mappings)...", count), true)

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

		if not strVal or strVal == "" then
			return
		end

		-- O(1) Fast lookup path: check if any numeric ID in the property exists in mappings
		local oldId = string.match(strVal, "%d+")
		if not oldId or not mappings[oldId] then
			return
		end

		local newId = mappings[oldId]
		local idPattern = "%f[%d]" .. oldId .. "%f[%D]"
		local newVal = string.gsub(strVal, idPattern, newId)

		if obj:IsA("MeshPart") and (prop == "MeshId" or prop == "TextureID") then
			if prop == "TextureID" then
				local assignOk = pcall(function()
					(obj :: any).TextureID = toAssetUriString(newVal)
				end)
				if assignOk then
					replacedCount += 1
					logToPlugin(
						string.format(
							"[ISpooferMotion] Manual Swap: %s.TextureID (%s -> %s)",
							obj.Name,
							oldId,
							newId
						)
					)
				end
				return
			end

			-- prop == "MeshId": MeshId cannot be assigned directly, recreate MeshPart
			local targetMeshUri = toAssetUriString(newVal)
			local targetTextureUri = nil
			pcall(function()
				local tex = (obj :: any).TextureID
				if tex and tex ~= "" then
					local texOld = string.match(tex, "%d+")
					if texOld and mappings[texOld] then
						targetTextureUri = toAssetUriString(
							string.gsub(tex, "%f[%d]" .. texOld .. "%f[%D]", mappings[texOld])
						)
					end
				end
			end)

			local oldParent = obj.Parent
			if not oldParent then
				return
			end

			local maxAttempts = 5
			local attempt = 0
			local createOk = false
			local createdPart = nil

			while attempt < maxAttempts do
				attempt += 1
				createOk, createdPart = pcall(function()
					return AssetService:CreateMeshPartAsync(targetMeshUri, {
						CollisionFidelity = obj.CollisionFidelity,
						RenderFidelity = obj.RenderFidelity,
					})
				end)
				if createOk and createdPart and createdPart:IsA("BasePart") then
					break
				end

				local errStr = string.lower(tostring(createdPart))
				local isRateLimit = string.find(errStr, "limit")
					or string.find(errStr, "rate")
					or string.find(errStr, "429")
					or string.find(errStr, "exceed")
					or string.find(errStr, "too many")
					or string.find(errStr, "throttle")
					or string.find(errStr, "timeout")
					or string.find(errStr, "timed out")

				if isRateLimit and attempt < maxAttempts then
					logToPlugin(
						string.format(
							"[Warning] [ISpooferMotion] Manual swap rate limit hit on '%s'. Waiting 5s before retry (%d/%d)...",
							obj.Name,
							attempt,
							maxAttempts
						)
					)
					task.wait(5)
				else
					break
				end
			end

			local objStillValid = pcall(function()
				return obj.Parent
			end)
			if not objStillValid or obj.Parent == nil then
				if createOk and createdPart then
					pcall(function()
						createdPart:Destroy()
					end)
				end
				return
			end

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

			local copyOk, copyErr = pcall(function()
				copyMeshPartPropertiesInto(obj, newPart, targetTextureUri)
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
				return
			end

			local parentOk = pcall(function()
				newPart.Parent = oldParent
			end)
			if not parentOk or newPart.Parent ~= oldParent then
				pcall(function()
					newPart:Destroy()
				end)
				warn("[ISpooferMotion] Manual Swap: could not parent replacement for " .. obj.Name)
				return
			end

			local moveOk, moveErr = pcall(function()
				moveMeshPartContentsInto(obj, newPart)
			end)
			if not moveOk then
				pcall(function()
					obj.Parent = oldParent
				end)
				warn(
					"[ISpooferMotion] Manual Swap: content move failed for "
						.. obj.Name
						.. ": "
						.. tostring(moveErr)
				)
				return
			end

			pcall(function()
				obj:Destroy()
			end)
			replacedCount += 1
			logToPlugin(
				string.format("[ISpooferMotion] Manual Swap: Recreated MeshPart %s", newPart.Name)
			)
			return
		else
			local assignOk, _ = pcall(function()
				(obj :: any)[prop] = newVal
			end)
			if assignOk then
				replacedCount += 1
				logToPlugin(
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

	local function processInstance(obj: Instance)
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

		-- Handle Script source replacement safely with single-pass substitution
		if obj:IsA("LuaSourceContainer") and obj.ClassName ~= "CoreScript" then
			local ok, src = pcall(function()
				return (obj :: any).Source
			end)
			if ok and src and type(src) == "string" and #src > 0 then
				local modified = false
				local newSrc = string.gsub(src, "%d+", function(digitRun)
					local mapped = mappings[digitRun]
					if mapped then
						modified = true
						return mapped
					end
					return nil
				end)

				if modified then
					local assignOk, _ = pcall(function()
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
						logToPlugin("[ISpooferMotion] Manual Swap: Updated Source in " .. obj.Name)
					end
				end
			end
		end
	end

	local candidateRoots = {
		workspace,
		game:GetService("ReplicatedStorage"),
		game:GetService("ReplicatedFirst"),
		game:GetService("ServerStorage"),
		game:GetService("ServerScriptService"),
		game:GetService("StarterGui"),
		game:GetService("StarterPack"),
		game:GetService("StarterPlayer"),
		game:GetService("SoundService"),
		game:GetService("Lighting"),
		game:GetService("MaterialService"),
	}

	-- Collect all instances first into a flat array
	local allInstances: { Instance } = {}
	for _, root in ipairs(candidateRoots) do
		if root then
			pcall(function()
				table.insert(allInstances, root)
				for _, desc in ipairs(root:GetDescendants()) do
					table.insert(allInstances, desc)
				end
			end)
		end
	end

	local totalInstances = #allInstances
	local BATCH_SIZE = resolvedBatchSize
	local YIELD_TIME = BATCH_SIZE >= 150 and 0.01 or 0.02

	logToPlugin(
		string.format(
			"[ISpooferMotion] Scanning %d instances across the game in batches of %d (speed configured)...",
			totalInstances,
			BATCH_SIZE
		)
	)

	local startTime = os.clock()
	local runOk, runErr = pcall(function()
		for i = 1, totalInstances do
			local inst = allInstances[i]
			if inst and inst.Parent ~= nil then
				processInstance(inst)
			end

			-- Yield every BATCH_SIZE items to allow Roblox Studio to render frames and prevent freezes
			if i % BATCH_SIZE == 0 or i == totalInstances then
				local elapsed = os.clock() - startTime
				local etaStr = "calc..."
				if i > 0 and elapsed > 0.05 then
					local rate = i / elapsed
					local remaining = math.max(0, totalInstances - i)
					local etaSecs = math.ceil(remaining / rate)
					if etaSecs < 60 then
						etaStr = string.format("%ds", etaSecs)
					else
						etaStr = string.format("%dm %02ds", math.floor(etaSecs / 60), etaSecs % 60)
					end
				end

				setPluginGuiStatus(
					string.format(
						"Manual Replace: (%d/%d ETA: %s) - %d replaced...",
						i,
						totalInstances,
						etaStr,
						replacedCount
					),
					true
				)
				if progressCallback then
					progressCallback(i, totalInstances, replacedCount, false)
				end
				task.wait(YIELD_TIME)
			end
		end
	end)

	if recording then
		pcall(function()
			ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
		end)
	end

	if not runOk then
		warn("[ISpooferMotion] Manual replacement error: " .. tostring(runErr))
	end

	local completionMsg = string.format(
		"[ISpooferMotion] Manual replacement complete! Modified %d properties across %d instances (batch: %d).",
		replacedCount,
		totalInstances,
		BATCH_SIZE
	)
	logToPlugin(completionMsg)
	setPluginGuiStatus(string.format("Manual Replace Complete! (%d replaced)", replacedCount))

	if progressCallback then
		progressCallback(totalInstances, totalInstances, replacedCount, true)
	end
end

--- Spawns runManualReplacements in a task so GUI click handlers (which cannot yield)
--- don't block and can receive live progress.
local function runManualReplacementsAsync(
	text: string,
	progressCallback: ((number, number, number, boolean) -> ())?,
	customBatchSize: number?
)
	task.spawn(runManualReplacements, text, progressCallback, customBatchSize)
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
