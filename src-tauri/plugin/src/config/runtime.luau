--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global
--- Centralized configuration and state for the plugin runtime.
---
--- This module holds all the global variables, constants, and service
--- references we need. Keeping them here avoids circular dependencies
--- and makes it easy to tweak limits like chunk sizes and timeouts.

--- A lookup of properties that inherently contain asset references.
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

--- We cache Roblox services up front to avoid repeated GetService calls.
local AssetService = game:GetService("AssetService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")

--- The port range we scan when trying to find the ISpooferMotion daemon.
local PORT_START = plugin:GetSetting("ISpooferMotion_PORT_START") or 14285
local PORT_END = plugin:GetSetting("ISpooferMotion_PORT_END") or 14289

--- Maximum number of records we pack into a single HTTP request during a scan.
local SEND_CHUNK_SIZE = plugin:GetSetting("ISpooferMotion_SEND_CHUNK_SIZE") or 5000

--- The largest script we are willing to read or overwrite. Eight megabytes
--- is enough for almost any legitimate script.
local MAX_SCRIPT_SOURCE_BYTES = plugin:GetSetting("ISpooferMotion_MAX_SCRIPT_BYTES") or 8000000
local MAX_TAGS_PER_OBJECT = 100
local MAX_TAG_BYTES = 100
local MAX_PATCHES_PER_BATCH = plugin:GetSetting("ISpooferMotion_MAX_PATCHES") or 10000

--- We enforce strict limits on HTTP payloads to prevent the plugin from
--- consuming too much memory and crashing Studio on massive games.
local MAX_HTTP_BODY_BYTES = plugin:GetSetting("ISpooferMotion_MAX_HTTP_BODY") or 10000000
local MAX_HTTP_RESPONSE_BYTES = plugin:GetSetting("ISpooferMotion_MAX_HTTP_RESP") or 1000000

--- The active URL of the daemon we are currently communicating with.
local BASE_URL = nil
local polling = false

--- State flags to prevent multiple scans or patch batches from overlapping.
local scanRunning = false
local patchRunning = false
local autoReplaceEnabled = false
local lastDiscovery = 0

--- Scan options pushed from the desktop app via the /poll response. Defaults
--- match the backend's defaults (all types, assetIds mode) so a scan still
--- works if the app sends nothing.
local activeScanTypes: { string } = { "sounds", "animations", "images", "meshes", "scripts" }
local activeScriptScanMode: string = "assetIds"

--- The specific top-level containers we care about when scanning for assets.
--- We explicitly ignore places like CoreGui to avoid engine warnings and crashes.
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
