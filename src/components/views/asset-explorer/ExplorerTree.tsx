import {
  AlertCircle,
  Check,
  ChevronRight,
  Download,
  Inbox,
  Loader2,
  Lock,
  SkipForward,
  Upload,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import type { AppConfig } from '../../../contexts/ConfigContext';
import { useSpooferStore } from '../../../stores/spooferStore';
import { cn } from '../../../utils/cn';
import type { ParsedAssetRef, RbxInstance } from '../../../utils/robloxPlaceParser/types';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';

let isDragSelecting = false;
let dragTargetChecked = true;

if (typeof window !== 'undefined') {
  window.addEventListener('mouseup', () => {
    isDragSelecting = false;
  });
}

export const getAssetId = (asset: ParsedAssetRef | { id: string; name: string }) => {
  if ('assetId' in asset) return asset.assetId;
  return asset.id ?? '';
};

export function getBrightPlaceIdColor(placeId: string): string {
  let hash = 0;
  for (let i = 0; i < placeId.length; i++) {
    hash = (hash << 5) - hash + placeId.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 85%, 65%)`;
}

export function formatShortId(id: string): string {
  if (!id || id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

export const ExplorerTreeNode = memo(function ExplorerTreeNode({
  node,
  level,
  config,
  selectedAssetIds,
  toggleAsset,
  toggleNode,
  getAllAssetIds,
  setEnlargedImage,
  setPreviewingAnimation,
  activeAssetFilters,
  searchQuery = '',
  playingAudioId,
  initialExpanded = false,
  onInspectAsset,
  activeInspectAssetId = null,
}: {
  node: RbxInstance;
  level: number;
  config: AppConfig;
  selectedAssetIds: Set<string>;
  toggleAsset: (id: string, checked: boolean) => void;
  toggleNode: (node: RbxInstance, checked: boolean) => void;
  getAllAssetIds: (node: RbxInstance) => string[];
  setEnlargedImage: (value: { id: string; name: string } | null) => void;
  setPreviewingAnimation: (value: { id: string; name: string } | null) => void;
  activeAssetFilters: string[];
  searchQuery?: string;
  playingAudioId: string | null;
  initialExpanded?: boolean;
  onInspectAsset?: (asset: ParsedAssetRef) => void;
  activeInspectAssetId?: string | null;
}) {
  const [userExpanded, setExpanded] = useState(initialExpanded);
  // Force-expand while a search is active so matches are visible without the
  // user having to click every folder open.
  const expanded = userExpanded || (searchQuery ?? '').trim().length > 0;
  // Cap the initial render to keep expanding huge folders (e.g. thousands of
  // Unverified Script IDs) from freezing the app. User can click 'show more'
  // to reveal the rest in chunks.
  const ASSET_RENDER_CHUNK = 300;
  const [renderLimit, setRenderLimit] = useState(ASSET_RENDER_CHUNK);

  const matchesFilter = (type: string) =>
    activeAssetFilters.length === 0 || activeAssetFilters.includes(type);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const matchesSearch = (asset: ParsedAssetRef) => {
    if (!normalizedSearch) return true;
    const id = ('assetId' in asset ? asset.assetId : '') || '';
    const name = (
      'name' in asset ? String((asset as { name?: string }).name || '') : ''
    ).toLowerCase();
    const path = (asset.path || '').toLowerCase();
    const propertyName = (asset.propertyName || '').toLowerCase();
    return (
      id.includes(normalizedSearch) ||
      name.includes(normalizedSearch) ||
      path.includes(normalizedSearch) ||
      propertyName.includes(normalizedSearch)
    );
  };
  const filteredAssets = useMemo(() => {
    return node.assets.filter((asset) => matchesFilter(asset.type) && matchesSearch(asset));
  }, [node.assets, activeAssetFilters, normalizedSearch]);
  const visibleAssets = useMemo(
    () => filteredAssets.slice(0, renderLimit),
    [filteredAssets, renderLimit],
  );
  const hiddenAssetCount = filteredAssets.length - visibleAssets.length;
  const totalChildren = node.children.length;
  const allIds = getAllAssetIds(node);

  const hasMatchingDescendant = useMemo(() => {
    const check = (n: RbxInstance): boolean => {
      if (n.assets.some((a) => matchesFilter(a.type) && matchesSearch(a))) return true;
      return n.children.some((child) => check(child));
    };
    return check(node);
  }, [node, activeAssetFilters, normalizedSearch]);

  if (!hasMatchingDescendant) return null;

  const selectedCount = allIds.filter((id) => selectedAssetIds.has(id)).length;
  const isChecked = selectedCount === allIds.length;

  const getTypeIconSrc = (asset: ParsedAssetRef) => {
    if (asset.type === 'animation' || asset.type === 'raw_keyframe_sequence')
      return '/icons/Animation.png';
    if (asset.type === 'audio') return '/icons/Sound.png';
    if (asset.type === 'mesh') return '/icons/MeshPart.png';
    if (asset.type === 'image') return '/icons/Decal.png';
    return '/icons/Object.png';
  };

  const getAssetTitle = (asset: ParsedAssetRef) => {
    const name = asset.instanceName || asset.propertyName || asset.path.split('.').pop();
    return name || `${asset.type} ${asset.assetId}`;
  };

  const setActiveInspectAsset = useSpooferStore((s) => s.setActiveInspectAsset);
  const setIsInspectorOpen = useSpooferStore((s) => s.setIsInspectorOpen);
  const assetForcePlaceIds = useSpooferStore((s) => s.assetForcePlaceIds) ?? {};
  const assetStatuses = useSpooferStore((s) => s.assetStatuses) ?? {};
  const lastReplacements = useSpooferStore((s) => s.lastReplacements) ?? {};

  const renderAssetRow = (asset: ParsedAssetRef) => {
    // Compact single-line row item: [Icon] + [Asset Name] + optional [Lock]
    const assetId = getAssetId(asset);
    const pinnedPlaceId = assetId ? assetForcePlaceIds[assetId] : undefined;
    const instanceCount = (asset as ParsedAssetRef & { instanceCount?: number }).instanceCount;
    const isInspected = activeInspectAssetId === assetId;

    const handleRowClick = () => {
      setActiveInspectAsset(asset);
      setIsInspectorOpen(true);
    };

    return (
      <div
        className={cn(
          'h-7 rounded-sm hover:bg-accent/60 group transition-colors flex items-center pr-2 cursor-pointer select-none',
          isInspected && 'bg-primary/15 font-semibold',
        )}
        style={{ marginLeft: `${(level + 1) * 16 + 18}px` }}
        onClick={handleRowClick}
        onMouseEnter={() => {
          if (isDragSelecting) {
            toggleAsset(assetId, dragTargetChecked);
          }
        }}
      >
        <div
          className="mr-2 cursor-pointer flex items-center justify-center shrink-0 checkbox-trigger"
          onMouseDown={(e: React.MouseEvent) => {
            e.stopPropagation();
            isDragSelecting = true;
            dragTargetChecked = !selectedAssetIds.has(assetId);
            toggleAsset(assetId, dragTargetChecked);
          }}
          onMouseEnter={() => {
            if (isDragSelecting) {
              toggleAsset(assetId, dragTargetChecked);
            }
          }}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
          }}
        >
          <Checkbox checked={selectedAssetIds.has(assetId)} />
        </div>

        <div className="w-4 h-4 shrink-0 mr-2 flex items-center justify-center">
          <img
            src={getTypeIconSrc(asset)}
            alt=""
            className="w-full h-full object-contain"
            onError={(event: React.SyntheticEvent<HTMLImageElement, Event>) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        </div>

        {/* Asset Name */}
        <div className="flex-1 flex items-center gap-1.5 min-w-0 mr-2">
          <span className="text-xs text-foreground/90 truncate">{getAssetTitle(asset)}</span>
          {(instanceCount ?? 1) > 1 && (
            <span className="text-[9px] text-muted-foreground bg-bg-surface px-1 rounded border border-border-subtle shrink-0">
              {instanceCount}x
            </span>
          )}
        </div>

        {/* Per-asset status indicator during spoofing */}
        {(() => {
          const status = assetId ? assetStatuses[assetId] : undefined;
          if (!status || status.stage === 'idle') return null;
          const config: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
            resolving_location: {
              icon: <Loader2 size={10} className="animate-spin" />,
              color: 'text-blue-400',
              label: status.message || 'Checking direct Place IDs...',
            },
            discovering_usage: {
              icon: <Loader2 size={10} className="animate-spin" />,
              color: 'text-purple-400',
              label: status.message || 'Discovering Place IDs (Asset Usage)...',
            },
            discovering_graph: {
              icon: <Loader2 size={10} className="animate-spin" />,
              color: 'text-indigo-400',
              label: status.message || 'Discovering Place IDs (Creator Graph)...',
            },
            downloading: {
              icon: <Download size={10} />,
              color: 'text-cyan-400',
              label: status.message || 'Downloading...',
            },
            uploading: {
              icon: <Upload size={10} />,
              color: 'text-amber-400',
              label: status.message || 'Uploading...',
            },
            done: {
              icon: <Check size={10} />,
              color: 'text-green-400',
              label: status.message || 'Completed',
            },
            error: {
              icon: <AlertCircle size={10} />,
              color: 'text-red-400',
              label: status.message || 'Error',
            },
            skipped: {
              icon: <SkipForward size={10} />,
              color: 'text-muted-foreground',
              label: status.message || 'Skipped',
            },
          };
          const cfg = config[status.stage];
          if (!cfg) return null;
          const isError = status.stage === 'error';
          const isDiscoveryError = isError && status.message?.toLowerCase().includes('no place id');
          const badgeText = isError
            ? isDiscoveryError
              ? 'Discovery failed'
              : 'Download failed'
            : status.message || cfg.label;
          const fullMessage = status.message || cfg.label;
          return (
            <Tooltip>
              <TooltipTrigger
                render={
                  <div
                    className={cn(
                      'flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap mr-1',
                      cfg.color,
                    )}
                  >
                    {cfg.icon}
                    <span>{badgeText}</span>
                  </div>
                }
              />
              <TooltipContent className="text-xs max-w-xs break-words">
                {fullMessage}
              </TooltipContent>
            </Tooltip>
          );
        })()}

        {/* Compact color-coded lock indicator when forced place ID is enabled for this asset */}
        {pinnedPlaceId && (
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  className="flex items-center justify-center h-5 w-6 rounded border shrink-0 transition-transform hover:scale-110 cursor-help"
                  style={{
                    color: getBrightPlaceIdColor(pinnedPlaceId),
                    backgroundColor: `${getBrightPlaceIdColor(pinnedPlaceId)}18`,
                    borderColor: `${getBrightPlaceIdColor(pinnedPlaceId)}50`,
                  }}
                >
                  <Lock size={11} style={{ color: getBrightPlaceIdColor(pinnedPlaceId) }} />
                </div>
              }
            />
            <TooltipContent className="whitespace-nowrap font-mono text-xs">
              Place ID: {formatShortId(pinnedPlaceId)}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Compact spoofed indicator when a replacement ID exists for this asset */}
        {(() => {
          const replacementId = assetId ? lastReplacements[assetId] : undefined;
          if (!replacementId) return null;
          return (
            <Tooltip>
              <TooltipTrigger
                render={
                  <div className="flex items-center justify-center h-5 w-6 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shrink-0 transition-transform hover:scale-110 cursor-help ml-1">
                    <Inbox size={11} />
                  </div>
                }
              />
              <TooltipContent className="whitespace-nowrap font-mono text-xs">
                Spoofed: rbxassetid://{replacementId}
              </TooltipContent>
            </Tooltip>
          );
        })()}

        {/* Quick actions removed — play/preview/copy are all available
         * in the Inspector panel. Tree rows stay clean. */}
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center py-1 px-1 hover:bg-accent/40 cursor-pointer rounded-sm group select-none"
        style={{ paddingLeft: `${level * 16}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        <div
          className="mr-2 cursor-pointer flex items-center justify-center shrink-0"
          onMouseDown={(event: React.MouseEvent) => {
            event.stopPropagation();
            isDragSelecting = true;
            dragTargetChecked = !isChecked;
            toggleNode(node, dragTargetChecked);
          }}
          onMouseEnter={() => {
            if (isDragSelecting) {
              toggleNode(node, dragTargetChecked);
            }
          }}
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
          }}
        >
          <Checkbox checked={isChecked} />
        </div>
        <div className="w-4 h-4 flex items-center justify-center shrink-0 mr-1">
          {(filteredAssets.length > 0 || totalChildren > 0) && (
            <ChevronRight
              size={12}
              className={cn('transition-transform text-muted-foreground', expanded && 'rotate-90')}
            />
          )}
        </div>
        <div className="w-4 h-4 shrink-0 mr-2 flex items-center justify-center">
          <img
            src={`/icons/${node.className === 'StudioSession' ? 'Place' : node.className}.png`}
            alt=""
            className="w-full h-full object-contain"
            onError={(event: React.SyntheticEvent<HTMLImageElement, Event>) => {
              const target = event.target as HTMLImageElement;
              if (!target.src.endsWith('Object.png')) {
                target.src = '/icons/Object.png';
              } else {
                target.style.display = 'none';
              }
            }}
          />
        </div>
        <span className="text-xs text-foreground whitespace-nowrap overflow-hidden text-ellipsis">
          {node.name}
        </span>
      </div>

      {expanded && (
        <div className="flex flex-col overflow-hidden">
          {visibleAssets.length > 0 && (
            <div className="flex flex-col">
              {visibleAssets.map((asset) => (
                <div key={`${asset.type}:${asset.path}:${asset.propertyName}:${getAssetId(asset)}`}>
                  {renderAssetRow(asset)}
                </div>
              ))}
              {hiddenAssetCount > 0 && (
                <div
                  className="text-[10px] text-muted-foreground py-2 flex items-center gap-2"
                  style={{ marginLeft: `${(level + 1) * 16 + 18}px` }}
                >
                  <span>
                    Showing {visibleAssets.length} of {filteredAssets.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setRenderLimit((prev) => prev + ASSET_RENDER_CHUNK)}
                  >
                    Show {Math.min(ASSET_RENDER_CHUNK, hiddenAssetCount)} more
                  </Button>
                  {hiddenAssetCount > ASSET_RENDER_CHUNK && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => setRenderLimit(filteredAssets.length)}
                    >
                      Show all
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {node.children.map((child: RbxInstance) => (
            <ExplorerTreeNode
              key={child.referent}
              node={child}
              level={level + 1}
              config={config}
              selectedAssetIds={selectedAssetIds}
              toggleAsset={toggleAsset}
              toggleNode={toggleNode}
              getAllAssetIds={getAllAssetIds}
              setEnlargedImage={setEnlargedImage}
              setPreviewingAnimation={setPreviewingAnimation}
              activeAssetFilters={activeAssetFilters}
              searchQuery={searchQuery}
              playingAudioId={playingAudioId}
              onInspectAsset={onInspectAsset}
              activeInspectAssetId={activeInspectAssetId}
            />
          ))}
        </div>
      )}
    </div>
  );
});
