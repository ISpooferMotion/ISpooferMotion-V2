export type RobloxAssetType =
  | 'animation'
  | 'audio'
  | 'image'
  | 'mesh'
  | 'plugin'
  | 'script_ref'
  | 'raw_keyframe_sequence'
  | 'ghost'
  | 'unknown';

// A single external asset reference from a place file.
export interface ParsedAssetRef {
  type: RobloxAssetType;

  assetId: string;

  rawValue: string;

  className: string;

  instanceName: string;

  propertyName: string;

  path: string;
}

export type RobloxFileType = 'rbxlx' | 'rbxl' | 'unknown';

export interface ParseProgress {
  phase: string;
  current: number;
  total: number;
  eta?: string;
}

export type ParseProgressCallback = (progress: ParseProgress) => void;

export interface PlaceParseResult {
  fileType: RobloxFileType;

  rootInstances: RbxInstance[];

  warnings: string[];
}

// AST node holding instance hierarchy and found assets.
export interface RbxInstance {
  referent: string;
  className: string;
  name: string;

  assets: ParsedAssetRef[];
  children: RbxInstance[];

  rawXml?: string;
  _xmlStartPos?: number;
}
