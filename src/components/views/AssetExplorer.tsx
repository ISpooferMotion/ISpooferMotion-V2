import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openFilePicker } from '@tauri-apps/plugin-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, FileUp, FolderOpen, Loader2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useStudioConnectionState } from '../../contexts/StudioConnectionContext';
import { useStudioAssetPoll } from '../../hooks/useStudioAssetPoll';
import { useSpooferStore } from '../../stores/spooferStore';
import type { ScriptRefProgressPayload, TauriEventPayload } from '../../types/tauriEvents';
import type { PluginAsset, PluginAssetStore } from '../../utils/pluginBridge';
import { stopRobloxAudio } from '../../utils/robloxAudio';
import type {
  ParsedAssetRef,
  ParseProgress,
  RbxInstance,
} from '../../utils/robloxPlaceParser/types';
import { logIsm } from '../../utils/robloxProfiles';
import { appendSpoofingLog } from '../../utils/spoofingLogs';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { ExplorerTreeNode, getAssetId } from './asset-explorer/ExplorerTree';
import { ExplorerToolbar } from './asset-explorer/ExplorerToolbar';

interface AssetExplorerProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onScanReceived?: () => void;
}

const ASSET_EXPLORER_WIDTH = 280;
const AnimationPreview = lazy(() => import('../shared/AnimationPreview'));

function dedupePluginAssets(assets: PluginAsset[]): PluginAsset[] {
  // Filter out exact duplicates to keep the tree view clean.
  const seen = new Set<string>();
  const deduped: PluginAsset[] = [];

  for (const asset of assets) {
    const key = [
      asset.assetId ?? '',
      asset.fullName ?? '',
      asset.script ?? '',
      asset.property ?? '',
      asset.callType ?? '',
      asset.sourceHint ?? '',
      asset.kind ?? '',
    ].join('\u0000');

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(asset);
  }

  return deduped;
}

function dedupeParsedAssets(assets: ParsedAssetRef[]): ParsedAssetRef[] {
  const byKey = new Map<string, ParsedAssetRef & { instanceCount?: number }>();

  for (const asset of assets) {
    const key = [
      asset.type,
      asset.assetId,
      asset.path,
      asset.propertyName,
      asset.className,
      asset.instanceName,
    ].join('\u0000');
    const existing = byKey.get(key);
    if (existing) {
      existing.instanceCount = (existing.instanceCount ?? 1) + 1;
    } else {
      byKey.set(key, { ...asset });
    }
  }

  return Array.from(byKey.values());
}

function pluginAssetsToNode(
  folderName: string,
  className: string,
  assets: PluginAsset[],
  assetType: ParsedAssetRef['type'],
): RbxInstance {
  // Convert flat asset lists into a nested tree structure.
  return {
    referent: `studio-${folderName}`,
    className,
    name: folderName,
    assets: dedupePluginAssets(assets).map((a: PluginAsset): ParsedAssetRef => ({
      type: assetType,
      assetId: a.assetId ?? '',
      rawValue: `rbxassetid://${a.assetId}`,
      className: a.kind ?? className,
      instanceName: a.name ?? a.assetId ?? '',
      propertyName: a.property ?? a.callType ?? a.sourceHint ?? '',
      path: a.fullName ?? a.script ?? folderName,
    })),
    children: [],
  };
}

const VALID_ROOT_SERVICES = new Set([
  'Workspace',
  'Lighting',
  'ReplicatedFirst',
  'ReplicatedStorage',
  'ServerScriptService',
  'ServerStorage',
  'StarterGui',
  'StarterPack',
  'StarterPlayer',
  'SoundService',
  'Teams',
  'MaterialService',
  'StudioSession',
]);

/**
 * The core visual component for browsing parsed Roblox places or live Studio sessions.
 *
 * Maps our internal `RbxInstance` tree structure into a collapsible UI.
 * Handles drag-and-drop of `.rbxl` files and delegates the heavy lifting of parsing
 * back to the Tauri backend to keep the React thread unblocked.
 */
export default function AssetExplorer({ isOpen, setIsOpen, onScanReceived }: AssetExplorerProps) {
  const { t } = useLanguage();
  const [parseState, setParseState] = useState<ParseProgress | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [previewingAnimation, setPreviewingAnimation] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [activeAssetFilters, setActiveAssetFilters] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const [resolvingScriptRefs, setResolvingScriptRefs] = useState(false);
  const [resolverProgress, setResolverProgress] = useState<{
    resolved: number;
    total: number;
  } | null>(null);

  const [, setUnknownScriptRefs] = useState<PluginAsset[]>([]);

  const { config } = useConfig();
  const rootInstances = useSpooferStore((s) => s.rootInstances);
  const setRootInstances = useSpooferStore((s) => s.setRootInstances);
  const loadedFileName = useSpooferStore((s) => s.loadedFileName);
  const setLoadedFileName = useSpooferStore((s) => s.setLoadedFileName);
  const setLoadedFilePath = useSpooferStore((s) => s.setLoadedFilePath);
  const setParsingFileName = useSpooferStore((s) => s.setParsingFileName);
  const selectedAssetIds = useSpooferStore((s) => s.selectedAssetIds);
  const setSelectedAssetIds = useSpooferStore((s) => s.setSelectedAssetIds);
  const lastReplacements = useSpooferStore((s) => s.lastReplacements);

  const { studioConnected, scanStatus } = useStudioConnectionState();
  const lastStudioSnapshotRef = useRef('');

  useEffect(() => {
    const handlePlaybackChange = (event: Event) => {
      setPlayingAudioId((event as CustomEvent<{ assetId: string | null }>).detail.assetId);
    };
    window.addEventListener('ism-audio-playback-change', handlePlaybackChange);
    return () => {
      window.removeEventListener('ism-audio-playback-change', handlePlaybackChange);
      stopRobloxAudio();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const unlisten = listen(
      'script-ref-progress',
      (event: TauriEventPayload<ScriptRefProgressPayload>) => {
        setResolverProgress({
          resolved: event.payload.resolved ?? 0,
          total: event.payload.total ?? 0,
        });
      },
    );
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const [resolvedOwners, setResolvedOwners] = useState<
    Record<string, { creatorId: string; creatorType: string }>
  >({});
  const resolvedRef = useRef(resolvedOwners);
  useEffect(() => {
    resolvedRef.current = resolvedOwners;
  }, [resolvedOwners]);

  const uniqueAssetIds = useMemo(() => {
    const ids = new Set<string>();
    const gatherIds = (nodes: RbxInstance[]) => {
      for (const node of nodes) {
        for (const asset of node.assets) {
          const id = getAssetId(asset);
          if (id && asset.type !== 'plugin' && !id.startsWith('RAW_KFS_')) {
            ids.add(id);
          }
        }
        if (node.children) gatherIds(node.children);
      }
    };
    gatherIds(rootInstances);
    return ids;
  }, [rootInstances]);

  useEffect(() => {
    if (!config.advanced.skipOwned || !config.spoofing.cookie || !isTauriRuntime()) return;
    if (uniqueAssetIds.size === 0) return;

    const newIds = Array.from(uniqueAssetIds).filter((id) => !resolvedRef.current[id]);
    if (newIds.length === 0) return;

    let cancelled = false;
    invoke<any[]>('resolve_asset_creators', {
      assets: newIds.map((id) => ({ assetId: id })),
      cookie: config.spoofing.cookie,
    })
      .then((resolved) => {
        if (cancelled) return;
        setResolvedOwners((prev) => {
          const next = { ...prev };
          for (const id of newIds) {
            next[id] = { creatorId: '0', creatorType: 'None' };
          }
          for (const item of resolved) {
            if (item.assetId && item.creatorId && item.creatorType) {
              next[item.assetId] = {
                creatorId: item.creatorId,
                creatorType: item.creatorType,
              };
            }
          }
          return next;
        });
      })
      .catch((err) => {
        console.error('Failed to resolve scanned asset creators:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [rootInstances, config.advanced.skipOwned, config.spoofing.cookie]);

  const lastReplacementIds = useMemo(() => {
    return new Set(Object.values(lastReplacements));
  }, [lastReplacements]);

  const excludedUserIdsSet = useMemo(() => {
    return new Set(
      config.advanced.excludedUserIds
        .split(/[\s,]+/)
        .map((id) => id.replace(/\D/g, ''))
        .filter((id) => id.length > 0),
    );
  }, [config.advanced.excludedUserIds]);

  const excludedGroupIdsSet = useMemo(() => {
    return new Set(
      config.advanced.excludedGroupIds
        .split(/[\s,]+/)
        .map((id) => id.replace(/\D/g, ''))
        .filter((id) => id.length > 0),
    );
  }, [config.advanced.excludedGroupIds]);

  const filterOwnedAssets = useCallback(
    (nodes: RbxInstance[]): RbxInstance[] => {
      let treeChanged = false;
      const newNodes = nodes
        .map((node) => {
          const filteredAssets = node.assets.filter((asset) => {
            if (asset.type === 'plugin') return false;

            if (config.advanced.skipOwned) {
              const id = asset.assetId;
              if (!id) return true;

              if (lastReplacementIds.has(id)) return false;

              const owner = resolvedOwners[id];
              if (owner) {
                const ownerIdNormalized = String(owner.creatorId);
                if (
                  owner.creatorType === 'User' &&
                  ownerIdNormalized === String(config.spoofing.selectedUser)
                )
                  return false;
                if (
                  owner.creatorType === 'Group' &&
                  ownerIdNormalized === String(config.spoofing.selectedGroup)
                )
                  return false;
                if (owner.creatorType === 'User' && excludedUserIdsSet.has(ownerIdNormalized))
                  return false;
                if (owner.creatorType === 'Group' && excludedGroupIdsSet.has(ownerIdNormalized))
                  return false;
              }
            }
            return true;
          });

          const finalAssets = dedupeParsedAssets(filteredAssets);
          const newChildren = filterOwnedAssets(node.children);

          const nodeChanged =
            finalAssets.length !== node.assets.length || newChildren !== node.children;
          if (nodeChanged) treeChanged = true;

          if (!nodeChanged) return node;

          return {
            ...node,
            assets: finalAssets,
            children: newChildren,
          };
        })
        .filter((node) => node.assets.length > 0 || node.children.length > 0);

      if (newNodes.length !== nodes.length) treeChanged = true;
      return treeChanged ? newNodes : nodes;
    },
    [
      config.advanced.skipOwned,
      lastReplacementIds,
      resolvedOwners,
      config.spoofing.selectedUser,
      config.spoofing.selectedGroup,
      excludedUserIdsSet,
      excludedGroupIdsSet,
    ],
  );

  const displayedInstances = useMemo(() => {
    const cleanRootInstances = rootInstances.filter(
      (node) => VALID_ROOT_SERVICES.has(node.className) || node.referent.startsWith('studio-'),
    );
    return filterOwnedAssets(cleanRootInstances);
  }, [rootInstances, filterOwnedAssets]);

  const setSpoofingLogs = useSpooferStore((s) => s.setSpoofingLogs);

  const stats = useMemo(() => {
    const countByType = (nodes: RbxInstance[]) => {
      const counts: Record<string, number> = {
        animation: 0,
        audio: 0,
        image: 0,
        mesh: 0,
        script_ref: 0,
      };
      const walk = (list: RbxInstance[]) => {
        for (const n of list) {
          for (const a of n.assets) {
            const t = a.type || 'script_ref';
            counts[t] = (counts[t] || 0) + 1;
          }
          walk(n.children);
        }
      };
      walk(nodes);
      return counts;
    };

    const totalCounts = countByType(rootInstances);
    const displayedCounts = countByType(displayedInstances);

    const total = Object.values(totalCounts).reduce((a, b) => a + b, 0);
    const displayed = Object.values(displayedCounts).reduce((a, b) => a + b, 0);

    const excludedByType: Record<string, number> = {};
    for (const key of Object.keys(totalCounts)) {
      const diff = (totalCounts[key] || 0) - (displayedCounts[key] || 0);
      if (diff > 0) excludedByType[key] = diff;
    }

    return {
      total,
      displayed,
      excluded: total - displayed,
      totalCounts,
      displayedCounts,
      excludedByType,
    };
  }, [rootInstances, displayedInstances]);

  const lastLoggedRef = useRef('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (stats.total === 0) return;
    if (stats.excluded === 0) return;

    // Check if we are still scanning or parsing
    const isScanning = scanStatus?.scanning || false;
    const isParsing = parseState !== null;
    if (isScanning || isParsing) return;

    // Check if we have unresolved asset creators
    const hasUnresolved =
      config.advanced.skipOwned && config.spoofing.cookie
        ? Array.from(uniqueAssetIds).some((id) => !resolvedOwners[id])
        : false;

    if (hasUnresolved) return;

    // Clear any pending log
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      const logKey = `${stats.total}:${stats.displayed}`;
      if (lastLoggedRef.current === logKey) return;
      lastLoggedRef.current = logKey;

      const typeLabels: Record<string, string> = {
        animation: 'animations',
        audio: 'sounds',
        image: 'images',
        mesh: 'meshes',
        script_ref: 'script refs',
      };
      const parts = Object.entries(stats.excludedByType)
        .map(([type, count]) => `${count} ${typeLabels[type] || type}`)
        .join(', ');

      const msg = `[INFO] Filtered ${stats.excluded} assets you already own (${parts}). Showing ${stats.displayed} remaining.\n`;
      setSpoofingLogs((prev) => appendSpoofingLog(prev, msg));
      logIsm('info', msg.trim(), false);
    }, 1000); // Wait 1s for layout/renders to settle

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [stats, setSpoofingLogs, scanStatus, parseState, rootInstances, config, resolvedOwners]);

  const processStudioData = useCallback(
    (
      anims: PluginAssetStore,
      sounds: PluginAssetStore,
      images: PluginAssetStore,
      meshes: PluginAssetStore,
      scriptRefs: PluginAssetStore,
    ) => {
      const animationAssets = anims.assets ?? [];
      const soundAssets = sounds.assets ?? [];
      const imageAssets = images.assets ?? [];
      const meshAssets = meshes.assets ?? [];
      const scriptRefAssets = scriptRefs.assets ?? [];
      const snapshotEntries: Array<[string, PluginAsset[]]> = [
        ['animation', animationAssets],
        ['audio', soundAssets],
        ['image', imageAssets],
        ['mesh', meshAssets],
        ['script_ref', scriptRefAssets],
      ];

      // Check for changes before rebuilding the tree.
      const snapshot =
        snapshotEntries
          .flatMap(([type, assets]) =>
            assets.map((asset) => `${type}:${asset.assetId ?? ''}`).sort(),
          )
          .join('|') || 'EMPTY';
      if (snapshot === lastStudioSnapshotRef.current) return;
      lastStudioSnapshotRef.current = snapshot;

      const buildTree = (resolvedMap: Record<string, string> = {}) => {
        const children: RbxInstance[] = [];

        const appendResolved = (originalAssets: PluginAsset[], targetType: string) => {
          const arr = [...originalAssets];
          const resolved = scriptRefAssets
            .filter((asset) => asset.assetId && resolvedMap[asset.assetId] === targetType)
            .map((asset) => ({ ...asset, type: targetType }));
          for (const a of resolved) {
            arr.push(a);
          }
          return arr;
        };

        const finalAnims = appendResolved(animationAssets, 'animation');
        const finalSounds = appendResolved(soundAssets, 'audio');
        const finalImages = appendResolved(imageAssets, 'image');
        const finalMeshes = appendResolved(meshAssets, 'mesh');

        const rawKfsAssets = appendResolved(
          scriptRefAssets.filter((asset) => asset.kind === 'UnuploadedAnimation'),
          'raw_keyframe_sequence',
        );

        const unknownRefs = scriptRefAssets.filter((asset) => {
          if (asset.kind === 'UnuploadedAnimation') return false;

          const resolved = asset.assetId ? resolvedMap[asset.assetId] : undefined;
          if (
            resolved === 'animation' ||
            resolved === 'audio' ||
            resolved === 'image' ||
            resolved === 'mesh'
          )
            return false;

          if (resolved === 'false_positive') return false;

          return true;
        });
        setUnknownScriptRefs(unknownRefs);

        if (finalAnims.length > 0)
          children.push(pluginAssetsToNode('Animations', 'Model', finalAnims, 'animation'));
        if (finalSounds.length > 0)
          children.push(pluginAssetsToNode('Sounds', 'Model', finalSounds, 'audio'));
        if (finalImages.length > 0)
          children.push(pluginAssetsToNode('Images', 'Model', finalImages, 'image'));
        if (finalMeshes.length > 0)
          children.push(pluginAssetsToNode('Meshes', 'Model', finalMeshes, 'mesh'));
        if (rawKfsAssets.length > 0)
          children.push(
            pluginAssetsToNode('Animations', 'Model', rawKfsAssets, 'raw_keyframe_sequence'),
          );
        if (unknownRefs.length > 0)
          children.push(
            pluginAssetsToNode(
              'Unverified Script IDs',
              'Folder',
              unknownRefs,
              'script_ref' as ParsedAssetRef['type'],
            ),
          );

        const studioNode: RbxInstance = {
          referent: 'studio-root',
          className: 'StudioSession',
          name: 'Studio Session',
          assets: [],
          children,
        };

        setRootInstances((prev) => [
          studioNode,
          ...prev.filter((n) => n.referent !== 'studio-root'),
        ]);
      };

      buildTree({});
      setLoadedFileName((prev) => prev ?? 'Studio Session');

      if (scriptRefAssets.length > 0) {
        // Attempt to resolve script ref asset types on the Rust backend.
        setResolvingScriptRefs(true);
        const uniqueIds = Array.from(
          new Set<string>(
            scriptRefAssets
              .map((asset) => asset.assetId)
              .filter((assetId): assetId is string => Boolean(assetId)),
          ),
        );
        setResolverProgress({ resolved: 0, total: uniqueIds.length });

        if (!isTauriRuntime()) {
          setResolvingScriptRefs(false);
          setResolverProgress(null);
          buildTree({});
          return;
        }

        invoke<Record<string, string>>('resolve_script_references', {
          assetIds: uniqueIds,
        })
          .then((resolvedMap) => {
            setResolvingScriptRefs(false);
            setResolverProgress(null);
            buildTree(resolvedMap);
          })
          .catch((err) => {
            logIsm('error', `Failed to resolve script references: ${String(err)}`);
            setResolvingScriptRefs(false);
            setResolverProgress(null);
            buildTree({});
          });
      }
    },
    [setRootInstances, setLoadedFileName],
  );

  useStudioAssetPoll(studioConnected, (bundle) => {
    processStudioData(bundle.anims, bundle.sounds, bundle.images, bundle.meshes, bundle.scriptRefs);
    if (onScanReceived) onScanReceived();
  });

  const toggleAsset = useCallback(
    (assetId: string, checked: boolean) => {
      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        if (checked) next.add(assetId);
        else next.delete(assetId);
        return next;
      });
    },
    [setSelectedAssetIds],
  );

  const getAllAssetIds = useCallback(
    (node: RbxInstance): string[] => {
      let ids: string[] = node.assets
        .filter((a) => activeAssetFilters.length === 0 || activeAssetFilters.includes(a.type))
        .map((a) => getAssetId(a))
        .filter(Boolean);
      for (const child of node.children) {
        ids = ids.concat(getAllAssetIds(child));
      }
      return ids;
    },
    [activeAssetFilters],
  );

  const toggleNode = useCallback(
    (node: RbxInstance, checked: boolean) => {
      const ids = getAllAssetIds(node);
      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [getAllAssetIds, setSelectedAssetIds],
  );

  const unlistenRef = useRef<(() => void) | null>(null);

  const loadFromPath = async (filePath: string) => {
    const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
    if (
      !fileName.endsWith('.rbxl') &&
      !fileName.endsWith('.rbxlx') &&
      !fileName.endsWith('.rbxm') &&
      !fileName.endsWith('.rbxmx')
    ) {
      logIsm('warn', `Only .rbxl, .rbxlx files are supported. Got: "${fileName}"`);
      return;
    }
    setParsingFileName(fileName);
    setParseState({ phase: 'Parsing file', current: 0, total: 1 });
    try {
      if (!isTauriRuntime()) {
        throw new Error('File parsing is only supported in the desktop app.');
      }

      const result = await invoke<{
        fileType: string;
        rootInstances: RbxInstance[];
        warnings: string[];
      }>('parse_place_file', { filePath });

      for (const w of result.warnings) {
        logIsm('warn', w);
      }

      setLoadedFileName(fileName);
      setLoadedFilePath(filePath);

      // Start with an empty selection so the user can explicitly choose what to spoof
      setSelectedAssetIds(new Set());
      setRootInstances(result.rootInstances);

      let totalAssets = 0;
      const countAssets = (node: RbxInstance) => {
        totalAssets += node.assets.length;
        node.children.forEach(countAssets);
      };
      result.rootInstances.forEach(countAssets);

      logIsm(
        'success',
        `Loaded "${fileName}" - ${totalAssets} asset reference${totalAssets !== 1 ? 's' : ''}.`,
      );
    } catch (err) {
      logIsm('error', `Failed to read "${fileName}": ${String(err)}`);
    } finally {
      setParseState(null);
      setParsingFileName(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let currentWindow;
    try {
      currentWindow = getCurrentWindow();
    } catch {
      return;
    }
    currentWindow
      .onDragDropEvent((event) => {
        if (cancelled) return;
        const { type } = event.payload;
        if (type === 'enter' || type === 'over') {
          setIsDragOver(true);
        } else if (
          type === 'leave' ||
          (type as string) === 'cancelled' ||
          (type as string) === 'dropCancelled'
        ) {
          setIsDragOver(false);
        } else if (type === 'drop') {
          setIsDragOver(false);
          const paths: string[] = (event.payload as { paths?: string[] }).paths ?? [];
          const placeFile = paths.find(
            (p) =>
              p.endsWith('.rbxl') ||
              p.endsWith('.rbxlx') ||
              p.endsWith('.rbxm') ||
              p.endsWith('.rbxmx'),
          );
          if (placeFile) {
            loadFromPath(placeFile);
          } else if (paths.length > 0) {
            logIsm('warn', `Only .rbxl, .rbxlx, .rbxm, and .rbxmx files are supported.`);
          }
        }
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          unlistenRef.current = unlisten;
        }
      });

    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const handleBrowse = async () => {
    try {
      const selected = await openFilePicker({
        multiple: false,
        filters: [{ name: 'Roblox Files', extensions: ['rbxl', 'rbxlx', 'rbxm', 'rbxmx'] }],
      });
      if (!selected) return;
      const filePath =
        typeof selected === 'string' ? selected : (selected as { path: string }).path;
      if (filePath) await loadFromPath(filePath);
    } catch (err) {
      if (String(err).toLowerCase().includes('cancel')) return;
      logIsm('error', `File picker error: ${String(err)}`);
    }
  };

  return (
    <motion.div
      initial={false}
      animate={{
        width: isOpen ? ASSET_EXPLORER_WIDTH : 0,
        opacity: isOpen ? 1 : 0,
      }}
      transition={{ type: 'spring', stiffness: 350, damping: 35 }}
      className="h-full bg-background flex flex-col shrink-0 overflow-hidden relative border-l border-border-subtle"
    >
      {}
      <AnimatePresence>
        {isDragOver && isOpen && (
          <motion.div
            key="asset-drag-drop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-bg-surface/90 backdrop-blur-sm border-2 border-dashed border-primary m-1 rounded-md pointer-events-none"
          >
            <div className="flex flex-col items-center gap-3 text-primary">
              <FileUp size={28} />
              <span className="font-semibold text-sm">{t('misc.dropRbxl')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {}
      <div className="h-12 border-b border-border-subtle flex items-center justify-between px-2 shrink-0">
        <AnimatePresence mode="wait">
          {isOpen && (
            <motion.div
              key="title"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="flex items-center gap-2 pl-1 overflow-hidden"
            >
              <span className="text-sm font-bold tracking-wide text-text-primary whitespace-nowrap">
                {t('explorer.title')}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-1.5 justify-end z-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 min-w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </Button>
        </div>
      </div>

      {}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="asset-explorer-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 overflow-y-auto scrollbar-hide w-full flex flex-col"
          >
            {resolvingScriptRefs ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground px-6">
                <Loader2 className="w-4 h-4 animate-spin text-current" />
                <div className="flex flex-col items-center text-center gap-1">
                  <span className="text-xs font-semibold text-foreground">
                    {t('explorer.resolvingScriptRefs')}
                  </span>
                  {resolverProgress && resolverProgress.total > 0 && (
                    <span className="text-[10px]">
                      {Math.round((resolverProgress.resolved / resolverProgress.total) * 100)}% (
                      {resolverProgress.resolved} / {resolverProgress.total})
                    </span>
                  )}
                </div>
              </div>
            ) : parseState ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground px-6">
                <Loader2 className="w-4 h-4 animate-spin text-current" />
                <div className="flex flex-col items-center text-center gap-1">
                  <span className="text-xs font-semibold text-text-primary">
                    {parseState.phase}
                  </span>
                  {parseState.total > 1 && (
                    <span className="text-[10px]">
                      {Math.round((parseState.current / parseState.total) * 100)}% (
                      {parseState.phase === 'Reading file'
                        ? `${(parseState.current / 1048576).toFixed(1)}MB / ${(parseState.total / 1048576).toFixed(1)}MB`
                        : `${parseState.current} / ${parseState.total}`}
                      )
                    </span>
                  )}
                  {parseState.eta && (
                    <span className="text-[10px] text-primary/80 font-medium">
                      ETA: {parseState.eta}
                    </span>
                  )}
                </div>
              </div>
            ) : displayedInstances.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.35 }}
                className="flex-1 flex flex-col"
              >
                <div className="flex-1 flex items-center justify-center">
                  <span className="text-text-muted/60 text-xs font-medium select-none text-center">
                    {studioConnected && scanStatus?.scanning ? (
                      <div className="flex flex-col gap-1 items-center">
                        <span className="text-primary font-bold">{t('misc.scanningStudio')}</span>
                        <span className="text-text-muted">
                          {scanStatus.current_service} (
                          {Math.round((scanStatus.scanned / Math.max(1, scanStatus.total)) * 100)}
                          %)
                        </span>
                      </div>
                    ) : studioConnected ? (
                      t('misc.waitingForScan')
                    ) : (
                      t('misc.noPlaceLoaded')
                    )}
                  </span>
                </div>
                {}
                <div
                  className="mx-3 mb-3 h-28 shrink-0 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-strong hover:border-primary/60 hover:bg-primary/5 transition-colors cursor-pointer text-text-muted hover:text-primary select-none"
                  onClick={handleBrowse}
                >
                  <FolderOpen size={24} className="opacity-60" />
                  <div className="text-center px-4">
                    <p className="text-[11px] font-semibold">{t('misc.dropOrClick')}</p>
                    <p className="text-[9px] mt-1 opacity-60">{t('misc.rbxlOnly')}</p>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-col h-full">
                <ExplorerToolbar
                  loadedFileName={loadedFileName}
                  activeAssetFilters={activeAssetFilters}
                  setActiveAssetFilters={setActiveAssetFilters}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                />

                <div className="flex flex-col flex-1 p-2">
                  {displayedInstances.map((node) => (
                    <ExplorerTreeNode
                      key={node.referent}
                      node={node}
                      level={0}
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
                      initialExpanded={true}
                    />
                  ))}
                </div>

                <Button
                  onClick={() => {
                    setRootInstances([]);
                    setLoadedFileName(null);
                    lastStudioSnapshotRef.current = '';
                  }}
                  variant="destructive"
                  className="mx-3 mb-3 mt-1 text-[11px]"
                >
                  {t('explorer.clearExplorer')}
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {enlargedImage && (
          <ImageOverlay
            key="enlarged-image"
            assetId={enlargedImage.id}
            onClose={() => setEnlargedImage(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewingAnimation && (
          <Suspense
            key="animation-preview"
            fallback={<AnimationPreviewFallback onClose={() => setPreviewingAnimation(null)} />}
          >
            <AnimationPreview
              assetId={previewingAnimation.id}
              assetName={previewingAnimation.name}
              onClose={() => setPreviewingAnimation(null)}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AnimationPreviewFallback({ onClose }: { onClose: () => void }) {
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-9999 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 pointer-events-auto"
    >
      <Loader2 className="w-10 h-10 animate-spin text-white" />
    </motion.div>,
    document.body,
  );
}

function ImageOverlay({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    invoke<string | null>('fetch_roblox_thumbnail', { assetId })
      .then((fetchedUrl) => {
        if (fetchedUrl) {
          setUrl(fetchedUrl);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, [assetId]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-9999 bg-black/85 backdrop-blur-md flex items-center justify-center p-6 md:p-12 cursor-zoom-out pointer-events-auto"
    >
      <button
        className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-10"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={24} />
      </button>
      <div className="relative w-full h-full flex items-center justify-center">
        {url ? (
          <motion.img
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            src={url}
            alt="Enlarged asset"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          />
        ) : error ? (
          <div className="text-white bg-red-500/20 px-4 py-2 rounded text-sm font-medium">
            Failed to load image
          </div>
        ) : (
          <Loader2 className="w-10 h-10 animate-spin text-white" />
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
