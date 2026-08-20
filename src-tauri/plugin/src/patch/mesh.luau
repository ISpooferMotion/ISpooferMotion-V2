--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global
--- MeshPart replacement helpers.
---
--- MeshId cannot be assigned directly, but Roblox supports replacing the mesh data
--- on an existing MeshPart via CreateMeshPartAsync + ApplyMesh. Keeping the original
--- instance avoids breaking joints, children, references, attributes, tags, and physics
--- state by destroying and recreating the part.

--- Replaces a MeshPart's mesh data without replacing the Instance itself.
---
--- targetMeshUri must be a normalized asset URI. targetTextureUri is optional; if it
--- is omitted, the existing texture is restored after ApplyMesh copies the temporary
--- part's texture data.
local function applyMeshPartInPlace(
	meshObj: MeshPart,
	targetMeshUri: string,
	targetTextureUri: string?
): (boolean, string?)
	local contentOk, meshContent = pcall(function()
		return Content.fromUri(targetMeshUri)
	end)
	if not contentOk then
		return false, "Could not create mesh Content: " .. tostring(meshContent)
	end

	local options: any = {
		CollisionFidelity = meshObj.CollisionFidelity,
		RenderFidelity = meshObj.RenderFidelity,
	}
	pcall(function()
		options.FluidFidelity = (meshObj :: any).FluidFidelity
	end)

	local originalTexture = ""
	pcall(function()
		originalTexture = meshObj.TextureID
	end)

	-- CreateMeshPartAsync yields. Yield once before it as well so bulk replacements
	-- cannot hammer Studio's mesh creation path in a single scheduler slice.
	task.wait()
	local maxAttempts = 5
	local attempt = 0
	local createOk = false
	local createdOrErr = nil

	while attempt < maxAttempts do
		attempt += 1
		createOk, createdOrErr = pcall(function()
			return AssetService:CreateMeshPartAsync(meshContent, options)
		end)
		if createOk and createdOrErr and createdOrErr:IsA("MeshPart") then
			break
		end

		local errStr = string.lower(tostring(createdOrErr))
		local isRateLimit = string.find(errStr, "limit")
			or string.find(errStr, "rate")
			or string.find(errStr, "429")
			or string.find(errStr, "exceed")
			or string.find(errStr, "too many")
			or string.find(errStr, "throttle")
			or string.find(errStr, "timeout")
			or string.find(errStr, "timed out")
			or string.find(errStr, "curlinfo")

		if isRateLimit and attempt < maxAttempts then
			logToPlugin(
				string.format(
					"[Warning] [ISpooferMotion] MeshPart rate limit hit on '%s'. Waiting 5s before retry (%d/%d)...",
					meshObj.Name,
					attempt,
					maxAttempts
				)
			)
			task.wait(5)
		else
			break
		end
	end

	if not createOk or not createdOrErr or not createdOrErr:IsA("MeshPart") then
		if createOk and createdOrErr then
			pcall(function()
				createdOrErr:Destroy()
			end)
		end
		return false, "CreateMeshPartAsync failed: " .. tostring(createdOrErr)
	end

	local temporaryMesh = createdOrErr :: MeshPart
	local stillValid = pcall(function()
		return meshObj.Parent
	end)
	if not stillValid or meshObj.Parent == nil then
		pcall(function()
			temporaryMesh:Destroy()
		end)
		return false, "Original MeshPart was destroyed while loading replacement mesh"
	end

	local applyOk, applyErr = pcall(function()
		meshObj:ApplyMesh(temporaryMesh)
	end)
	pcall(function()
		temporaryMesh:Destroy()
	end)
	if not applyOk then
		return false, tostring(applyErr)
	end

	local textureToApply = targetTextureUri or originalTexture
	local textureOk, textureErr = pcall(function()
		meshObj.TextureID = textureToApply
	end)
	if not textureOk then
		return false, "Mesh applied but texture update failed: " .. tostring(textureErr)
	end

	return true, nil
end
