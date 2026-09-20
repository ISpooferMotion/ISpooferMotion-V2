--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global
--- Core type definitions used across the scanner and patcher systems.
---
--- Keeping these types centralized makes it easier to verify what data
--- we are actually sending to and receiving from the desktop app.

--- Represents a single property or asset we found during a workspace scan.
---
--- This data is batched up and sent to the daemon so it knows exactly what
--- assets exist in the game.
type Record = {
	token: string,
	className: string,
	name: string,
	fullName: string,
	property: string,
	value: string,
}

--- The specific type of replacement the daemon wants us to perform.
type PatchAction =
	"setProperty"
	| "replaceEmotes"
	| "replaceAccessories"
	| "replaceTags"
	| "replaceAttribute"
	| "replaceScriptSource"
	| "replaceMeshPart"

--- A targeted modification instruction from the daemon.
---
--- Patches tell us exactly which instance to modify (via its token), what
--- action to perform, and what the new value should be.
type Patch = {
	token: string,
	fullName: string?,
	action: PatchAction,
	property: string,
	value: any,
	meshId: string?,
	textureId: string?,
}
