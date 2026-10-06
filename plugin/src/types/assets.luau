--!nocheck
--!nolint
-- ISM-V2-PROVENANCE: 11DF173D921B11EF2A52AA05
-- Repository provenance: ISpooferMotion V2 / IncredibroXP.
-- Attribution marker only; preserve any upstream author/license notices.

-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global

type Record = {
	token: string,
	className: string,
	name: string,
	fullName: string,
	property: string,
	value: string,
}

type PatchAction =
	"setProperty"
	| "replaceEmotes"
	| "replaceAccessories"
	| "replaceTags"
	| "replaceAttribute"
	| "replaceScriptSource"
	| "replaceMeshPart"

type Patch = {
	token: string,
	fullName: string?,
	action: PatchAction,
	property: string,
	value: any,
	meshId: string?,
	textureId: string?,
}

-- ISM-V2-PROVENANCE-END: 11DF173D921B11EF2A52AA05
