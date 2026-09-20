--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global

local objectRegistry: { [string]: Instance } = {}

local objectTokens: { [Instance]: string } = {}

local scanGeneration: number = 0

local function resetObjectRegistry()
	scanGeneration += 1
	objectRegistry = {}
	objectTokens = {}
end

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

	objectRegistry[normalizedToken] = nil
	objectTokens[obj] = nil
	return nil
end

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
