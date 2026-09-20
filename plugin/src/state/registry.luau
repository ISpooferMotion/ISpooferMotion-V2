--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global
--- Manages the lifecycle and identification of instances we track.
---
--- Because we send data to an external daemon and wait for patches to come back,
--- we need a reliable way to map the daemon's instructions back to the exact
--- Studio instances. We use unique tokens for this since memory addresses and
--- references cannot be sent over HTTP.

--- Maps a unique string token back to a real Studio instance.
local objectRegistry: { [string]: Instance } = {}

--- Maps a Studio instance to its currently assigned token.
local objectTokens: { [Instance]: string } = {}

--- Tracks which scan pass we are on to ensure old tokens do not accidentally
--- apply to new scans.
local scanGeneration: number = 0

--- Clears the entire registry and bumps the generation counter.
---
--- We call this right before starting a new scan so that stale references
--- are dropped and memory is freed.
local function resetObjectRegistry()
	scanGeneration += 1
	objectRegistry = {}
	objectTokens = {}
end

--- Assigns a unique token to an instance if it does not already have one.
---
--- The token includes the current scan generation to prevent cross-scan collisions.
local function registerObject(obj: Instance): string
	local existing = objectTokens[obj]
	if existing then
		return existing
	end

	local token = tostring(scanGeneration) .. ":" .. HttpService:GenerateGUID(false)
	objectTokens[obj] = token
	objectRegistry[token] = obj
	return token
end

--- Looks up a living instance from its token.
---
--- If the instance was destroyed (its parent is nil), we clean it out of the
--- registry immediately rather than waiting for the next full reset.
local function getRegisteredObject(token: string): Instance?
	local normalizedToken = tostring(token)
	local obj = objectRegistry[normalizedToken]
	if not obj then
		return nil
	end

	local valid, parent = pcall(function()
		return obj.Parent
	end)

	if valid and parent ~= nil then
		return obj
	end

	-- Object is destroyed - prune both tables immediately so memory is reclaimed
	-- rather than waiting until the next resetObjectRegistry() call.
	objectRegistry[normalizedToken] = nil
	objectTokens[obj] = nil
	return nil
end

--- Swaps an existing token's reference to point to a new object.
---
--- This is used when we have to completely replace an instance (like a MeshPart)
--- but still want to treat it as the same logical object for future patches.
local function replaceRegisteredObject(token: string, obj: Instance)
	local normalizedToken = tostring(token)
	local oldObj = objectRegistry[normalizedToken]
	if oldObj then
		objectTokens[oldObj] = nil
	end

	local oldToken = objectTokens[obj]
	if oldToken and oldToken ~= normalizedToken then
		objectRegistry[oldToken] = nil
	end

	objectRegistry[normalizedToken] = obj
	objectTokens[obj] = normalizedToken
end
