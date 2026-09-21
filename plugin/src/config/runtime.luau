--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global

local EMBEDDED_ASSET_PROPS = {
	Text = true,
	PlaceholderText = true,
	Image = true,
	HoverImage = true,
	PressedImage = true,
	ToolTip = true,
	Video = true,
	Name = true,
}

local AssetService = game:GetService("AssetService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local PORT_START = 14285
local PORT_END = 14289

local SEND_CHUNK_SIZE = 5000

local MAX_SCRIPT_SOURCE_BYTES = 8000000
local MAX_TAGS_PER_OBJECT = 100
local MAX_TAG_BYTES = 100
local MAX_PATCHES_PER_BATCH = 10000

local MAX_HTTP_BODY_BYTES = 10000000
local MAX_HTTP_RESPONSE_BYTES = 1000000

BASE_URL = nil
polling = false

local scanRunning = false
local patchRunning = false
local manualReplaceRunning = false
local autoReplaceEnabled = false
local lastDiscovery = 0

local activeScanTypes: { string } = { "sounds", "animations", "images", "meshes", "scripts" }
local activeScanPath: string? = nil
local manualBatchSize: number = 250

local SERVICES_TO_SCAN = {
	"Workspace",
	"Lighting",
	"MaterialService",
	"ReplicatedFirst",
	"ReplicatedStorage",
	"ServerScriptService",
	"ServerStorage",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"SoundService",
	"Teams",
}
