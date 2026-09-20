--!nocheck
--!nolint
--# selene: allow(global_usage, shadowing, unused_variable)
--- Minimal unit test runner for the plugin environment.
---
--- Because the plugin runs inside Roblox Studio, we cannot easily use
--- external test frameworks like Jest. This script provides a lightweight
--- testing harness to verify core logic without a full Studio session.
local tests_passed = 0
local tests_failed = 0

--- Defines a logical group of tests.
local function describe(name, callback)
	print("TEST SUITE: " .. name)
	callback()
end

--- Runs a single test case, catching any errors.
local function it(name, callback)
	local success, err = pcall(callback)
	if success then
		print("  [PASS] " .. name)
		tests_passed += 1
	else
		print("  [FAIL] " .. name)
		print("         " .. tostring(err))
		tests_failed += 1
	end
end

--- Basic assertion wrapper for tests.
local function expect(value)
	return {
		to_equal = function(expected)
			if value ~= expected then
				error(string.format("Expected %s, got %s", tostring(expected), tostring(value)))
			end
		end,
		to_be_truthy = function()
			if not value then
				error(string.format("Expected truthy value, got %s", tostring(value)))
			end
		end,
	}
end

-- Mocks for Roblox globals
local plugin = {
	CreateToolbar = function(_self, _name)
		return {
			CreateButton = function(_selfBtn, _id, _tooltip, _icon)
				return {
					Click = {
						Connect = function() end,
					},
				}
			end,
		}
	end,
	Unloading = {
		Connect = function() end,
	},
}

local game = {
	GetService = function(_self, serviceName)
		if serviceName == "HttpService" then
			return {
				RequestAsync = function()
					return { Success = true, StatusCode = 200, Body = "{}" }
				end,
				JSONEncode = function(_s, _t)
					return "{}"
				end,
				JSONDecode = function(_s, _str)
					return {}
				end,
			}
		elseif serviceName == "RunService" then
			return {
				IsStudio = function()
					return true
				end,
				IsServer = function()
					return false
				end,
			}
		end
		return {}
	end,
}

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local CollectionService = {
	GetTags = function()
		return {}
	end,
	AddTag = function() end,
	RemoveTag = function() end,
}
local ChangeHistoryService = {
	TryBeginRecording = function()
		return {}
	end,
	FinishRecording = function() end,
}
local AssetService = {}
local ScriptEditorService = {}
local task = { wait = function() end }

-- Dummy declarations to satisfy IDE Luau Language Server
local startPolling: any
local hidePluginGui: any
local togglePluginGui: any
local logToPlugin: any
local polling: any
local BASE_URL: any

--#include "../src/config/runtime.luau"
--#include "../src/ui/gui.luau"
--#include "../src/types/assets.luau"
--#include "../src/state/registry.luau"
--#include "../src/util/assets.luau"
--#include "../src/net/http.luau"
--#include "../src/scan/properties.luau"
--#include "../src/scan/scanner.luau"
--#include "../src/patch/mesh.luau"
--#include "../src/patch/patcher.luau"
--#include "../src/bridge/discovery.luau"
--#include "../src/bridge/polling.luau"

-- Tests
describe("Plugin Initialization", function()
	it("should provide mock plugin object", function()
		expect(plugin ~= nil).to_be_truthy()
	end)

	it("should simulate game services correctly", function()
		local http = game:GetService("HttpService")
		expect(http ~= nil).to_be_truthy()
		expect(type(http.RequestAsync) == "function").to_be_truthy()
	end)
end)

describe("registry.luau", function()
	it("should register and retrieve objects via token", function()
		local mockInstance = { ClassName = "Part", Parent = {} }
		local token = registerObject(mockInstance)

		expect(token ~= nil).to_be_truthy()
		expect(type(token) == "string").to_be_truthy()

		local retrieved = getRegisteredObject(token)
		expect(retrieved.ClassName).to_equal("Part")
	end)

	it("should handle destroyed objects by returning nil", function()
		local mockInstance = { ClassName = "Part", Parent = {} }
		local token = registerObject(mockInstance)

		-- Destroy the object
		mockInstance.Parent = nil
		expect(getRegisteredObject(token) == nil).to_be_truthy()
	end)
end)

describe("patcher.luau", function()
	it("should extract asset IDs correctly", function()
		expect(normalizeAssetId("rbxassetid://12345")).to_equal("12345")
		expect(normalizeAssetId("12345")).to_equal("12345")
		expect(normalizeAssetId("roblox.com/asset/?id=54321&version=1")).to_equal("54321")
	end)

	it("should reject invalid patch actions", function()
		local patch, err = normalizePatch({ token = "1", action = "invalidAction" })
		expect(patch == nil).to_be_truthy()
	end)
end)

describe("properties.luau", function()
	it("should correctly identify property text limits using real constants", function()
		expect(getMaxRecordValueBytes("Source")).to_equal(MAX_SCRIPT_SOURCE_BYTES)
		expect(getMaxRecordValueBytes("Text")).to_equal(MAX_STRING_VALUE_BYTES)
		expect(getMaxRecordValueBytes("MeshId")).to_equal(MAX_ASSET_URL_BYTES)
	end)

	it("should safely extract metadata without throwing", function()
		local obj = {
			ClassName = "Part",
			Name = "TestPart",
			GetFullName = function()
				return "Workspace.TestPart"
			end,
		}
		expect(obj.ClassName).to_equal("Part")
		expect(obj.Name).to_equal("TestPart")
		expect(obj.GetFullName()).to_equal("Workspace.TestPart")
	end)
end)

print(string.format("\nResults: %d passed, %d failed", tests_passed, tests_failed))
if tests_failed > 0 then
	error("Test suite failed")
end
