import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { open as openFilePicker } from '@tauri-apps/plugin-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  FileUp,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Lock,
  MapPin,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  ScanSearch,
  Settings2,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useStudioConnectionState } from '../../contexts/StudioConnectionContext';
import { useStudioAssetPoll } from '../../hooks/useStudioAssetPoll';
import { useSpooferStore } from '../../stores/spooferStore';
import { cn } from '../../utils/cn';
import type { PluginAsset, PluginAssetStore } from '../../utils/pluginBridge';
import { DEFAULT_PLUGIN_PORT, findPluginBridgePort } from '../../utils/pluginBridge';
import { playRobloxAudio, stopRobloxAudio } from '../../utils/robloxAudio';
import type { ParsedAssetRef, RbxInstance } from '../../utils/robloxPlaceParser/types';
import {
  ExplorerTreeNode,
  formatShortId,
  getAssetId,
  getAssetKey,
  getBrightPlaceIdColor,
} from './asset-explorer/ExplorerTree';
import { logIsm } from '../../utils/robloxProfiles';
import { isTauriRuntime } from '../../utils/tauriRuntime';

interface AssetExplorerProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onScanReceived?: () => void;
  mode?: 'drawer' | 'main';
}

const AnimationPreview = lazy(() => import('../shared/AnimationPreview'));

function compactSingleChildFolders(nodes: RbxInstance[]): RbxInstance[] {
  return nodes.map((node) => {
    let current = node;
    const isRootService =
      [
        'Workspace',
        'ReplicatedStorage',
        'Lighting',
        'ServerScriptService',
        'ServerStorage',
        'StarterGui',
        'StarterPack',
        'StarterPlayer',
        'SoundService',
        'MaterialService',
        'StudioSession',
        'Place',
      ].includes(current.className) ||
      ['Workspace', 'ReplicatedStorage', 'Lighting', 'ReplicatedFirst', 'Studio Session'].includes(
        current.name,
      );

    if (!isRootService) {
      while (current.assets.length === 0 && current.children.length === 1) {
        const onlyChild = current.children[0];
        current = {
          ...onlyChild,
          referent: `${current.referent}->${onlyChild.referent}`,
          name: `${current.name} / ${onlyChild.name}`,
        };
      }
    }

    return {
      ...current,
      children: compactSingleChildFolders(current.children),
    };
  });
}

function buildDataModelTree(
  allAssets: { asset: PluginAsset; type: ParsedAssetRef['type'] }[],
): RbxInstance[] {
  const nodeMap = new Map<string, RbxInstance>();
  const rootNodes: RbxInstance[] = [];

  const getOrCreateNode = (pathParts: string[], className?: string): RbxInstance => {
    const fullPath = pathParts.join('.');
    if (nodeMap.has(fullPath)) {
      const existing = nodeMap.get(fullPath)!;
      if (className && (existing.className === 'Folder' || existing.className === 'Instance')) {
        existing.className = className;
      }
      return existing;
    }

    const name = pathParts[pathParts.length - 1];
    let resolvedClass = className || 'Folder';
    if (pathParts.length === 1) {
      resolvedClass = name;
    }

    const newNode: RbxInstance = {
      referent: `datamodel-${fullPath}`,
      className: resolvedClass,
      name,
      assets: [],
      children: [],
    };
    nodeMap.set(fullPath, newNode);

    if (pathParts.length === 1) {
      rootNodes.push(newNode);
    } else {
      const parentParts = pathParts.slice(0, pathParts.length - 1);
      const parentNode = getOrCreateNode(parentParts);
      parentNode.children.push(newNode);
    }

    return newNode;
  };

  for (const item of allAssets) {
    const a = item.asset;
    const rawPath = a.fullName || a.script || a.name || 'Workspace';
    const parts = rawPath.split('.').filter(Boolean);
    if (parts.length === 0) continue;

    // For script refs without physical instance hierarchy, group under script container
    const isScriptRef = item.type === 'script_ref';
    const targetNode = isScriptRef
      ? getOrCreateNode(parts.length > 1 ? parts.slice(0, -1) : parts, 'Script')
      : getOrCreateNode(parts, a.kind || undefined);

    const assetId = a.assetId ?? '';
    const propName = a.property ?? a.callType ?? a.sourceHint ?? '';

    // If this asset property is already on this node, skip duplicate
    if (
      targetNode.assets.some(
        (ref) => ref.assetId === assetId && ref.propertyName === propName && ref.type === item.type,
      )
    ) {
      continue;
    }

    // Skip alias properties on the same instance
    const isAliasProperty =
      (propName === 'AnimationContent' &&
        targetNode.assets.some((r) => r.propertyName === 'AnimationId')) ||
      (propName === 'AudioContent' &&
        targetNode.assets.some((r) => r.propertyName === 'SoundId')) ||
      (propName === 'MeshContent' && targetNode.assets.some((r) => r.propertyName === 'MeshId'));
    if (isAliasProperty) {
      continue;
    }

    targetNode.assets.push({
      type: item.type,
      assetId,
      rawValue: `rbxassetid://${assetId}`,
      className: a.kind ?? targetNode.className,
      instanceName: a.name ?? parts[parts.length - 1] ?? assetId,
      propertyName: propName,
      path: rawPath,
    });
  }

  return compactSingleChildFolders(rootNodes);
}

export default function AssetExplorer({
  isOpen: _isOpen,
  setIsOpen: _setIsOpen,
  onScanReceived,
  mode: _mode = 'drawer',
}: AssetExplorerProps) {
  const { t } = useLanguage();
  const [isDragOver] = useState(false);
  const [, setEnlargedImage] = useState<{ id: string; name: string } | null>(null);
  const [, setPreviewingAnimation] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const searchQuery = useSpooferStore((s) => s.searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const activeAssetFilters = useSpooferStore((s) => s.activeAssetFilters);
  const ghostAssetIds = useSpooferStore((s) => s.ghostAssetIds);
  const showToast = useSpooferStore((s) => s.showToast);

  const [saveToStudioOpen, setSaveToStudioOpen] = useState(false);
  const [studioSavePath, setStudioSavePath] = useState('game.Workspace');
  const [isSavingToStudio, setIsSavingToStudio] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [placeIdInput, setPlaceIdInput] = useState('');
  const [confirmClearPins, setConfirmClearPins] = useState(false);
  const [spoofModeOpen, setSpoofModeOpen] = useState(false);
  const [scanTypes, setScanTypes] = useState<Set<string>>(
    new Set(['sounds', 'animations', 'images', 'meshes', 'scripts']),
  );
  const [scriptMode, setScriptMode] = useState<string>('assetIds');
  const [showScanOptions, setShowScanOptions] = useState(false);

  const toggleScanType = (key: string) => {
    setScanTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const [targetedPath, setTargetedPath] = useState('');
  const [targetedScanOpen, setTargetedScanOpen] = useState(false);

  const isInspectorOpen = useSpooferStore((s) => s.isInspectorOpen);
  const isPropertiesOpen = useSpooferStore((s) => s.isPropertiesOpen);
  const isRightPanelOpen = isInspectorOpen || isPropertiesOpen;

  const activeInspectAsset = useSpooferStore((s) => s.activeInspectAsset);
  const setActiveInspectAsset = useSpooferStore((s) => s.setActiveInspectAsset);

  const handleRunTargetedScan = (pathOverride?: string) => {
    const p = pathOverride || targetedPath;
    if (!p.trim()) return;
    const types = ['sounds', 'animations', 'images', 'meshes', 'scripts'].filter((k) =>
      scanTypes.has(k),
    );
    document.dispatchEvent(
      new CustomEvent('ism-start-scan', {
        detail: { scanTypes: types, scriptScanMode: scriptMode, scanPath: p.trim() },
      }),
    );
    setTargetedScanOpen(false);
  };

  const discoveryTimeoutSecs = useSpooferStore((s) => s.discoveryTimeoutSecs);
  const setDiscoveryTimeoutSecs = useSpooferStore((s) => s.setDiscoveryTimeoutSecs);
  const assetForcePlaceIds = useSpooferStore((s) => s.assetForcePlaceIds) ?? {};
  const setAssetForcePlaceIds = useSpooferStore((s) => s.setAssetForcePlaceIds);
  const clearAssetForcePlaceIds = useSpooferStore((s) => s.clearAssetForcePlaceIds);

  const { config, updateConfig } = useConfig();
  const rootInstances = useSpooferStore((s) => s.rootInstances);
  const setRootInstances = useSpooferStore((s) => s.setRootInstances);
  const setLoadedFileName = useSpooferStore((s) => s.setLoadedFileName);
  const selectedAssetIds = useSpooferStore((s) => s.selectedAssetIds);
  const setSelectedAssetIds = useSpooferStore((s) => s.setSelectedAssetIds);
  const selectedAssetKeys = useSpooferStore((s) => s.selectedAssetKeys);
  const setSelectedAssetKeys = useSpooferStore((s) => s.setSelectedAssetKeys);
  const isScanningStudio = useSpooferStore((s) => s.isScanningStudio);
  const lastScanTime = useSpooferStore((s) => s.lastScanTime);
  const isSpoofing = useSpooferStore((s) => s.isSpoofing);
  const isReplacing = useSpooferStore((s) => s.isReplacing);
  const isGrantingPermissions = useSpooferStore((s) => s.isGrantingPermissions);
  const lastReplacements = useSpooferStore((s) => s.lastReplacements) ?? {};
  const storedReplacementsCount = Object.keys(lastReplacements).length;
  const isDiscoveringPlaceIds = useSpooferStore((s) => s.isDiscoveringPlaceIds);
  const spoofProgress = useSpooferStore((s) => s.spoofProgress);
  const spoofStatusText = useSpooferStore((s) => s.spoofStatusText);
  const spoofCurrentCount = useSpooferStore((s) => s.spoofCurrentCount);
  const spoofTotalCount = useSpooferStore((s) => s.spoofTotalCount);
  const spoofStartTime = useSpooferStore((s) => s.spoofStartTime);
  const replaceCurrentCount = useSpooferStore((s) => s.replaceCurrentCount);
  const replaceTotalCount = useSpooferStore((s) => s.replaceTotalCount);
  const replaceStartTime = useSpooferStore((s) => s.replaceStartTime);
  const permissionsCurrentCount = useSpooferStore((s) => s.permissionsCurrentCount);
  const permissionsTotalCount = useSpooferStore((s) => s.permissionsTotalCount);
  const permissionsStartTime = useSpooferStore((s) => s.permissionsStartTime);
  const busy = isScanningStudio || isSpoofing || isReplacing || isGrantingPermissions;

  const [activeEta, setActiveEta] = useState<string | null>(null);

  useEffect(() => {
    if (!isSpoofing && !isReplacing && !isGrantingPermissions) {
      setActiveEta(null);
      return;
    }
    const computeEta = (
      startTime: number | null,
      current: number,
      total: number,
    ): string | null => {
      if (!startTime || total <= 0 || current <= 0) return null;
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs < 1000) return null;
      const rate = current / (elapsedMs / 1000);
      if (rate <= 0) return null;
      const remaining = Math.max(0, total - current);
      if (remaining === 0) return null;
      const remainingSec = Math.ceil(remaining / rate);
      if (remainingSec < 60) return `ETA: ${remainingSec}s`;
      if (remainingSec < 3600) {
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;
        return `ETA: ${mins}m ${secs.toString().padStart(2, '0')}s`;
      }
      const hrs = Math.floor(remainingSec / 3600);
      const mins = Math.floor((remainingSec % 3600) / 60);
      return `ETA: ${hrs}h ${mins}m`;
    };

    const updateCurrentEta = () => {
      if (isSpoofing) {
        setActiveEta(computeEta(spoofStartTime, spoofCurrentCount, spoofTotalCount));
      } else if (isReplacing) {
        setActiveEta(computeEta(replaceStartTime, replaceCurrentCount, replaceTotalCount));
      } else if (isGrantingPermissions) {
        setActiveEta(
          computeEta(permissionsStartTime, permissionsCurrentCount, permissionsTotalCount),
        );
      }
    };

    updateCurrentEta();
    const interval = setInterval(updateCurrentEta, 1000);
    return () => clearInterval(interval);
  }, [
    isSpoofing,
    isReplacing,
    isGrantingPermissions,
    spoofStartTime,
    spoofCurrentCount,
    spoofTotalCount,
    replaceStartTime,
    replaceCurrentCount,
    replaceTotalCount,
    permissionsStartTime,
    permissionsCurrentCount,
    permissionsTotalCount,
  ]);

  const { studioConnected, scanStatus, studioPlaceId, studioPlaceName } =
    useStudioConnectionState();

  const studioDisplayName = useMemo(() => {
    if (studioPlaceName && studioPlaceName.trim() !== '') return studioPlaceName;
    if (studioPlaceId && studioPlaceId !== '0') return `Place ${studioPlaceId}`;
    return 'Studio Session';
  }, [studioPlaceName, studioPlaceId]);

  const lastStudioSnapshotRef = useRef('');

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

      const snapshot =
        [animationAssets, soundAssets, imageAssets, meshAssets, scriptRefAssets]
          .flatMap((assets, i) => assets.map((a) => `${i}:${a.assetId ?? ''}`).sort())
          .join('|') || 'EMPTY';
      if (snapshot === lastStudioSnapshotRef.current) return;
      lastStudioSnapshotRef.current = snapshot;

      const includeAnims = scanTypes.has('animations');
      const includeSounds = scanTypes.has('sounds');
      const includeImages = scanTypes.has('images');
      const includeMeshes = scanTypes.has('meshes');
      const includeScripts = scanTypes.has('scripts');

      const allInitialAssets: { asset: PluginAsset; type: ParsedAssetRef['type'] }[] = [
        ...(includeAnims
          ? animationAssets.map((asset) => ({ asset, type: 'animation' as const }))
          : []),
        ...(includeSounds ? soundAssets.map((asset) => ({ asset, type: 'audio' as const })) : []),
        ...(includeImages ? imageAssets.map((asset) => ({ asset, type: 'image' as const })) : []),
        ...(includeMeshes ? meshAssets.map((asset) => ({ asset, type: 'mesh' as const })) : []),
      ];

      const children = buildDataModelTree(allInitialAssets);

      if (children.length === 0 && scriptRefAssets.length === 0) {
        // Return early so an empty background poll doesn't inject a studio-root on startup,
        // while preserving any studio-root manually created by "Connect to explorer without scanning".
        return;
      }

      const studioNode: RbxInstance = {
        referent: 'studio-root',
        className: 'Place',
        name: studioDisplayName,
        assets: [],
        children,
      };

      setRootInstances((prev) => [studioNode, ...prev.filter((n) => n.referent !== 'studio-root')]);
      setLoadedFileName((prev) => prev ?? studioDisplayName);
      useSpooferStore.getState().setLastScanTime(Date.now());

      // Resolve script ref asset types on the Rust backend
      if (scriptRefAssets.length > 0 && isTauriRuntime()) {
        const uniqueIds = Array.from(
          new Set(scriptRefAssets.map((a) => a.assetId).filter((id): id is string => Boolean(id))),
        );
        invoke<Record<string, string>>('resolve_script_references', { assetIds: uniqueIds })
          .then((resolvedMap) => {
            const existingAnimIds = new Set(animationAssets.map((a) => a.assetId).filter(Boolean));
            const existingSoundIds = new Set(soundAssets.map((a) => a.assetId).filter(Boolean));
            const existingImageIds = new Set(imageAssets.map((a) => a.assetId).filter(Boolean));
            const existingMeshIds = new Set(meshAssets.map((a) => a.assetId).filter(Boolean));

            const finalAnims = includeAnims ? [...animationAssets] : [];
            const finalSounds = includeSounds ? [...soundAssets] : [];
            const finalImages = includeImages ? [...imageAssets] : [];
            const finalMeshes = includeMeshes ? [...meshAssets] : [];
            for (const asset of scriptRefAssets) {
              if (!asset.assetId) continue;
              const resolved = resolvedMap[asset.assetId];
              if (resolved === 'animation' && includeAnims && !existingAnimIds.has(asset.assetId))
                finalAnims.push({ ...asset, type: 'animation' });
              else if (
                resolved === 'audio' &&
                includeSounds &&
                !existingSoundIds.has(asset.assetId)
              )
                finalSounds.push({ ...asset, type: 'audio' });
              else if (
                resolved === 'image' &&
                includeImages &&
                !existingImageIds.has(asset.assetId)
              )
                finalImages.push({ ...asset, type: 'image' });
              else if (resolved === 'mesh' && includeMeshes && !existingMeshIds.has(asset.assetId))
                finalMeshes.push({ ...asset, type: 'mesh' });
            }

            const allResolvedAssets: { asset: PluginAsset; type: ParsedAssetRef['type'] }[] = [
              ...(includeAnims
                ? finalAnims.map((asset) => ({ asset, type: 'animation' as const }))
                : []),
              ...(includeSounds
                ? finalSounds.map((asset) => ({ asset, type: 'audio' as const }))
                : []),
              ...(includeImages
                ? finalImages.map((asset) => ({ asset, type: 'image' as const }))
                : []),
              ...(includeMeshes
                ? finalMeshes.map((asset) => ({ asset, type: 'mesh' as const }))
                : []),
            ];

            let allTreeAssets = [...allResolvedAssets];
            if (includeScripts) {
              const unknownRefs = scriptRefAssets.filter((a) => {
                if (!a.assetId) return false;
                const r = resolvedMap[a.assetId];
                return (
                  r !== 'animation' &&
                  r !== 'audio' &&
                  r !== 'image' &&
                  r !== 'mesh' &&
                  r !== 'false_positive'
                );
              });
              if (unknownRefs.length > 0) {
                const unverifiedAssets = unknownRefs.map((a) => ({
                  asset: a,
                  type: 'script_ref' as ParsedAssetRef['type'],
                }));
                allTreeAssets = [...allTreeAssets, ...unverifiedAssets];
              }
            }

            const rebuiltChildren = buildDataModelTree(allTreeAssets);

            if (rebuiltChildren.length === 0) {
              return;
            }
            setRootInstances((prev) => [
              { ...studioNode, children: rebuiltChildren },
              ...prev.filter((n) => n.referent !== 'studio-root'),
            ]);
          })
          .catch((err) => {
            logIsm('error', `Failed to resolve script references: ${String(err)}`);
          });
      }
    },
    [setRootInstances, setLoadedFileName],
  );

  useStudioAssetPoll(studioConnected || isScanningStudio, (bundle) => {
    processStudioData(bundle.anims, bundle.sounds, bundle.images, bundle.meshes, bundle.scriptRefs);
    if (onScanReceived) onScanReceived();
  });

  const selectedIds = Array.from(selectedAssetIds);
  const selectedCount = selectedAssetKeys.size > 0 ? selectedAssetKeys.size : selectedAssetIds.size;
  const pinnedCount = selectedIds.filter((id) => assetForcePlaceIds[id]).length;

  const applyPin = () => {
    const trimmed = placeIdInput.replace(/\D/g, '');
    if (!trimmed || selectedIds.length === 0) return;
    setAssetForcePlaceIds((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) next[id] = trimmed;
      return next;
    });
    setPlaceIdInput('');
    setLockOpen(false);
  };

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

  const selectedGhostIds = useMemo(
    () => Array.from(selectedAssetIds).filter((id) => ghostAssetIds.has(id)),
    [selectedAssetIds, ghostAssetIds],
  );

  const handleSaveGhostIdsToStudio = async () => {
    if (selectedGhostIds.length === 0 || !studioSavePath.trim()) return;
    setIsSavingToStudio(true);
    try {
      const pluginPort = (await findPluginBridgePort()) || DEFAULT_PLUGIN_PORT;
      const cleanPath = studioSavePath.trim().startsWith('game.')
        ? studioSavePath.trim()
        : `game.${studioSavePath.trim()}`;

      await invoke('create_ghost_instances_in_studio', {
        assetIds: selectedGhostIds,
        parentPath: cleanPath,
        pluginPort,
      });

      logIsm(
        'success',
        `Sent ${selectedGhostIds.length} Ghost ID instance(s) to Studio at ${cleanPath}.`,
        true,
      );
      showToast('success', `Created ${selectedGhostIds.length} instance(s) in Studio.`);
      setSaveToStudioOpen(false);
    } catch (err) {
      logIsm('error', `Failed to create Ghost ID instances in Studio: ${String(err)}`, true);
      showToast('error', `Save to Studio failed: ${String(err)}`);
    } finally {
      setIsSavingToStudio(false);
    }
  };

  const handleForceApplyReplacements = useCallback(async () => {
    const store = useSpooferStore.getState();
    const replacements = store.lastReplacements || {};
    const count = Object.keys(replacements).length;
    if (count === 0) {
      showToast('error', 'No stored replacements found. Spoof some assets or paste IDs first!');
      return;
    }

    // If specific assets are selected and have stored replacements, prioritize them;
    // otherwise apply all stored replacements.
    let toApply: Record<string, string> = {};
    if (selectedAssetIds.size > 0) {
      for (const id of selectedAssetIds) {
        if (replacements[id]) {
          toApply[id] = replacements[id];
        }
      }
    }
    if (Object.keys(toApply).length === 0) {
      toApply = replacements;
    }

    try {
      const { applyReplacements } = await import('../../stores/spooferStore');
      await applyReplacements(toApply);
      showToast(
        'success',
        `Pushed ${Object.keys(toApply).length} asset replacement(s) to Studio without re-spoofing!`,
      );
    } catch (err) {
      showToast('error', `Failed to apply replacements: ${String(err)}`);
    }
  }, [selectedAssetIds, showToast]);

  const displayedInstances = useMemo(() => {
    const VALID_ROOTS = new Set([
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
      'Folder',
    ]);
    const list = rootInstances.filter(
      (node) => VALID_ROOTS.has(node.className) || node.referent.startsWith('studio-'),
    );

    if (ghostAssetIds.size > 0) {
      const ghostNode: RbxInstance = {
        referent: 'ghost-ids-root',
        className: 'Folder',
        name: 'Ghost IDs',
        assets: Array.from(ghostAssetIds).map((id) => ({
          type: 'ghost' as ParsedAssetRef['type'],
          assetId: id,
          rawValue: `rbxassetid://${id}`,
          className: 'GhostAsset',
          instanceName: `Ghost ID ${id}`,
          propertyName: 'GhostID',
          path: 'GhostIDs',
        })),
        children: [],
      };
      return [...list, ghostNode];
    }

    return list;
  }, [rootInstances, ghostAssetIds]);

  const stats = useMemo(() => {
    let total = 0;
    const walk = (list: RbxInstance[]) => {
      for (const n of list) {
        total += n.assets.length;
        walk(n.children);
      }
    };
    walk(displayedInstances);
    return { total, displayed: total };
  }, [displayedInstances]);

  const getAllAssetKeys = useCallback(
    (node: RbxInstance): string[] => {
      const filters = activeAssetFilters;
      const filterFn = (type: string) => {
        if (!filters || filters.length === 0) return true;
        if (type === 'ghost') return true;
        return filters.includes(type);
      };

      let keys: string[] = (node?.assets || [])
        .filter((a) => filterFn(a?.type || ''))
        .map((a) => getAssetKey(a))
        .filter(Boolean);
      for (const child of node?.children || []) {
        keys = keys.concat(getAllAssetKeys(child));
      }
      return keys;
    },
    [activeAssetFilters],
  );

  const getAllAssetIds = useCallback(
    (node: RbxInstance): string[] => {
      const filters = activeAssetFilters;
      const filterFn = (type: string) => {
        if (!filters || filters.length === 0) return true;
        if (type === 'ghost') return true;
        return filters.includes(type);
      };

      let ids: string[] = (node?.assets || [])
        .filter((a) => filterFn(a?.type || ''))
        .map((a) => getAssetId(a))
        .filter(Boolean);
      for (const child of node?.children || []) {
        ids = ids.concat(getAllAssetIds(child));
      }
      return ids;
    },
    [activeAssetFilters],
  );

  const toggleAsset = useCallback(
    (assetOrKey: ParsedAssetRef | string, checked: boolean) => {
      const key = typeof assetOrKey === 'string' ? assetOrKey : getAssetKey(assetOrKey);
      const assetId =
        typeof assetOrKey === 'string'
          ? assetOrKey.split(':').pop() || assetOrKey
          : getAssetId(assetOrKey);

      setSelectedAssetKeys((prev) => {
        const next = new Set(prev);
        if (checked) next.add(key);
        else next.delete(key);
        return next;
      });

      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        if (checked) {
          if (assetId) next.add(assetId);
        } else {
          const currentKeys = useSpooferStore.getState().selectedAssetKeys;
          const stillHas = Array.from(currentKeys).some(
            (k) => k !== key && (k.endsWith(`:${assetId}`) || k === assetId),
          );
          if (!stillHas && assetId) {
            next.delete(assetId);
          }
        }
        return next;
      });
    },
    [setSelectedAssetKeys, setSelectedAssetIds],
  );

  const toggleNode = useCallback(
    (node: RbxInstance, checked: boolean) => {
      const keys = getAllAssetKeys(node);
      const ids = getAllAssetIds(node);

      setSelectedAssetKeys((prev) => {
        const next = new Set(prev);
        for (const k of keys) {
          if (checked) next.add(k);
          else next.delete(k);
        }
        return next;
      });

      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (checked) next.add(id);
          else {
            const currentKeys = useSpooferStore.getState().selectedAssetKeys;
            const stillHas = Array.from(currentKeys).some(
              (k) => !keys.includes(k) && (k.endsWith(`:${id}`) || k === id),
            );
            if (!stillHas) {
              next.delete(id);
            }
          }
        }
        return next;
      });
    },
    [getAllAssetKeys, getAllAssetIds, setSelectedAssetKeys, setSelectedAssetIds],
  );

  const computeTargetPaths = useCallback(() => {
    const keys = useSpooferStore.getState().selectedAssetKeys;
    if (keys.size === 0) return undefined;
    const map: Record<string, string[]> = {};
    const walk = (nodes: RbxInstance[]) => {
      for (const node of nodes) {
        for (const asset of node.assets) {
          const key = getAssetKey(asset);
          if (keys.has(key)) {
            const id = getAssetId(asset);
            if (id) {
              map[id] = map[id] || [];
              if (asset.path && !map[id].includes(asset.path)) {
                map[id].push(asset.path);
              }
            }
          }
        }
        if (node.children) walk(node.children);
      }
    };
    walk(displayedInstances);
    return map;
  }, [displayedInstances]);

  return (
    <motion.div
      initial={false}
      animate={{ width: '100%', opacity: 1 }}
      className="h-full bg-background flex flex-col shrink-0 overflow-hidden relative w-full border-l-0"
    >
      <AnimatePresence>
        {isDragOver && (
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

      <AnimatePresence>
        <motion.div
          key="asset-explorer-body"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex-1 overflow-y-auto scrollbar-hide w-full flex flex-col"
        >
          {displayedInstances.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.35 }}
              className="flex-1 flex flex-col items-center justify-center gap-6 p-8 overflow-y-auto"
            >
              <img
                src="/ism_logo_theme_swap.svg"
                alt="ISpooferMotion"
                className="w-28 h-28 object-contain select-none drop-shadow-md"
                draggable={false}
              />

              {(studioConnected && scanStatus?.scanning) || isScanningStudio ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={20} className="animate-spin text-primary" />
                  <span className="text-xs font-bold text-primary">{t('misc.scanningStudio')}</span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  {/* Open file split button with options */}
                  <div className="flex items-center rounded-lg overflow-hidden border border-border-strong shadow-sm bg-bg-surface">
                    <button
                      type="button"
                      data-tutorial-target="explorer-open-file"
                      onClick={async () => {
                        try {
                          const selected = await openFilePicker({
                            multiple: false,
                            filters: [
                              {
                                name: 'Roblox Place',
                                extensions: ['rbxl', 'rbxlx', 'rbxm', 'rbxmx'],
                              },
                            ],
                          });
                          const path = Array.isArray(selected) ? selected[0] : selected;
                          if (!path) return;
                          const result = await invoke<{
                            instances: Array<{
                              className: string;
                              name: string;
                              referent: string;
                              children?: unknown[];
                              assets?: Array<{
                                assetId?: string;
                                type: string;
                                instanceName?: string;
                                path?: string;
                                rawValue?: string;
                              }>;
                            }>;
                          }>('parse_place_file', { filePath: path });
                          // Filter incoming assets by active scanTypes
                          const filterCategory = (type: string) => {
                            if (type === 'animation' || type === 'raw_keyframe_sequence')
                              return scanTypes.has('animations');
                            if (type === 'audio') return scanTypes.has('sounds');
                            if (type === 'image') return scanTypes.has('images');
                            if (type === 'mesh') return scanTypes.has('meshes');
                            if (type === 'script_ref') return scanTypes.has('scripts');
                            return true;
                          };

                          const filterTree = (nodes: RbxInstance[]): RbxInstance[] => {
                            return nodes
                              .map((node) => ({
                                ...node,
                                assets: node.assets.filter((a) => filterCategory(a.type)),
                                children: filterTree(node.children),
                              }))
                              .filter((node) => node.assets.length > 0 || node.children.length > 0);
                          };

                          const incoming = (result?.instances ?? []) as RbxInstance[];
                          const filteredIncoming = filterTree(incoming);
                          useSpooferStore.getState().setRootInstances(filteredIncoming);
                          useSpooferStore
                            .getState()
                            .setLoadedFileName(path.split(/[\\/]/).pop() ?? path);
                          logIsm('success', `Loaded place file: ${path}`);
                        } catch (err) {
                          logIsm('error', `Failed to load place file: ${String(err)}`);
                        }
                      }}
                      className="flex items-center justify-center gap-2 px-5 h-11 text-text-primary font-bold text-sm hover:bg-bg-elevated disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <FolderOpen size={18} />
                      Open File
                    </button>

                    <Popover>
                      <PopoverTrigger
                        render={
                          <button
                            type="button"
                            className="h-11 w-10 text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors border-l border-border flex items-center justify-center cursor-pointer"
                            title="File extraction options"
                          >
                            <Settings2 size={16} />
                          </button>
                        }
                      />
                      <PopoverContent
                        align="center"
                        side="bottom"
                        sideOffset={8}
                        className="w-72 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[210]"
                      >
                        <div className="flex flex-col gap-3">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2 block">
                              Asset Types
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {[
                                { key: 'sounds', label: 'Sounds' },
                                { key: 'animations', label: 'Animations' },
                                { key: 'images', label: 'Images' },
                                { key: 'meshes', label: 'Meshes' },
                                { key: 'scripts', label: 'Scripts' },
                              ].map((type) => (
                                <button
                                  key={type.key}
                                  type="button"
                                  onClick={() => toggleScanType(type.key)}
                                  className={cn(
                                    'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer',
                                    scanTypes.has(type.key)
                                      ? 'bg-primary/15 border-primary/40 text-primary'
                                      : 'bg-bg-base border-border-subtle text-text-muted hover:text-text-primary hover:border-border',
                                  )}
                                >
                                  {scanTypes.has(type.key) && (
                                    <Check size={9} className="inline mr-1" />
                                  )}
                                  {type.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2 block">
                              Script Mode
                            </span>
                            <div className="flex rounded-md overflow-hidden border border-border-subtle bg-bg-base">
                              {[
                                { key: 'assetIds', label: 'Fast IDs' },
                                { key: 'fullSource', label: 'Full Source' },
                                { key: 'off', label: 'Off' },
                              ].map((mode) => (
                                <button
                                  key={mode.key}
                                  type="button"
                                  onClick={() => setScriptMode(mode.key)}
                                  className={cn(
                                    'flex-1 h-7 text-[10px] font-semibold transition-colors cursor-pointer',
                                    scriptMode === mode.key
                                      ? 'bg-primary text-primary-foreground'
                                      : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
                                  )}
                                >
                                  {mode.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Split button container — unifies Scan Studio + settings gear into one widget */}
                  <div className="flex items-center rounded-lg overflow-hidden border border-primary/20 shadow-sm">
                    {/* Main action — starts scan with current settings */}
                    <button
                      type="button"
                      onClick={() => {
                        if (!studioConnected) {
                          showToast(
                            'error',
                            'No Roblox Studio plugin connected. Please connect Studio first.',
                          );
                          return;
                        }
                        const types = [
                          'sounds',
                          'animations',
                          'images',
                          'meshes',
                          'scripts',
                        ].filter((k) => scanTypes.has(k));
                        document.dispatchEvent(
                          new CustomEvent('ism-start-scan', {
                            detail: { scanTypes: types, scriptScanMode: scriptMode },
                          }),
                        );
                      }}
                      data-tutorial-target="explorer-scan-studio"
                      disabled={scanTypes.size === 0}
                      className={cn(
                        'flex items-center justify-center gap-2 px-6 h-11 bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors',
                        !studioConnected && 'opacity-70',
                      )}
                      title={
                        !studioConnected
                          ? 'Requires Roblox Studio plugin to be connected'
                          : undefined
                      }
                    >
                      <ScanSearch size={18} />
                      {t('spoof.scanStudio')}
                    </button>

                    {/* Gear split — opens floating popover, zero layout shift */}
                    <Popover open={showScanOptions} onOpenChange={setShowScanOptions}>
                      <PopoverTrigger
                        render={
                          <button
                            type="button"
                            className="h-11 w-10 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors border-l border-primary-foreground/20 flex items-center justify-center"
                          >
                            <Settings2 size={16} />
                          </button>
                        }
                      />
                      <PopoverContent
                        align="center"
                        side="bottom"
                        sideOffset={8}
                        className="w-72 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[210]"
                      >
                        <div className="flex flex-col gap-3">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2 block">
                              Asset Types
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {[
                                { key: 'sounds', label: 'Sounds' },
                                { key: 'animations', label: 'Animations' },
                                { key: 'images', label: 'Images' },
                                { key: 'meshes', label: 'Meshes' },
                                { key: 'scripts', label: 'Scripts' },
                              ].map((type) => (
                                <button
                                  key={type.key}
                                  type="button"
                                  onClick={() => toggleScanType(type.key)}
                                  className={cn(
                                    'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors',
                                    scanTypes.has(type.key)
                                      ? 'bg-primary/15 border-primary/40 text-primary'
                                      : 'bg-bg-base border-border-subtle text-text-muted hover:text-text-primary hover:border-border',
                                  )}
                                >
                                  {scanTypes.has(type.key) && (
                                    <Check size={9} className="inline mr-1" />
                                  )}
                                  {type.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2 block">
                              Script Mode
                            </span>
                            <div className="flex rounded-md overflow-hidden border border-border-subtle bg-bg-base">
                              {[
                                { key: 'assetIds', label: 'Fast IDs' },
                                { key: 'fullSource', label: 'Full Source' },
                                { key: 'off', label: 'Off' },
                              ].map((mode) => (
                                <button
                                  key={mode.key}
                                  type="button"
                                  onClick={() => setScriptMode(mode.key)}
                                  className={cn(
                                    'flex-1 h-7 text-[10px] font-semibold transition-colors',
                                    scriptMode === mode.key
                                      ? 'bg-primary text-primary-foreground'
                                      : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
                                  )}
                                >
                                  {mode.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              )}

              {/* Text link: Connect to explorer without scanning */}
              {!((studioConnected && scanStatus?.scanning) || isScanningStudio) && (
                <button
                  type="button"
                  onClick={() => {
                    if (!studioConnected) {
                      showToast(
                        'error',
                        'No Roblox Studio plugin connected. Please connect Studio first.',
                      );
                      return;
                    }
                    setRootInstances((prev) =>
                      prev.length > 0
                        ? prev
                        : [
                            {
                              referent: 'studio-root',
                              className: 'Place',
                              name: studioDisplayName,
                              assets: [],
                              children: [],
                            },
                          ],
                    );
                    setLoadedFileName(studioDisplayName);
                  }}
                  className={cn(
                    'text-xs text-text-muted hover:text-primary underline font-medium transition-colors cursor-pointer mt-1',
                    !studioConnected && 'opacity-60 cursor-not-allowed hover:text-text-muted',
                  )}
                  title={
                    !studioConnected ? 'Requires Roblox Studio plugin to be connected' : undefined
                  }
                >
                  Connect to explorer without scanning
                </button>
              )}
            </motion.div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden h-full w-full relative">
              {/* Global spoofing / replacing / permissions progress bar as absolute overlay */}
              {(isSpoofing || isReplacing || isGrantingPermissions) && (
                <div className="absolute top-0 left-0 right-0 z-50 pointer-events-none">
                  <div className="h-1 bg-bg-base w-full overflow-hidden shadow-md">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{
                        width: `${
                          isSpoofing
                            ? spoofProgress
                            : isReplacing
                              ? replaceTotalCount > 0
                                ? Math.min(
                                    100,
                                    Math.max(5, (replaceCurrentCount / replaceTotalCount) * 100),
                                  )
                                : 50
                              : isGrantingPermissions
                                ? permissionsTotalCount > 0
                                  ? Math.min(
                                      100,
                                      Math.max(
                                        5,
                                        (permissionsCurrentCount / permissionsTotalCount) * 100,
                                      ),
                                    )
                                  : 50
                                : 0
                        }%`,
                      }}
                    />
                  </div>
                  <div className="absolute top-1.5 right-3 px-2.5 py-0.5 rounded bg-bg-surface/90 border border-border-subtle text-[10px] text-text-primary font-mono shadow-sm pointer-events-auto flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <span>
                      {isSpoofing
                        ? `${spoofStatusText || 'Initializing...'}${spoofTotalCount > 0 ? ` · ${spoofCurrentCount}/${spoofTotalCount}` : ''}${activeEta ? ` · ${activeEta}` : ''}`
                        : isReplacing
                          ? `Replacing${replaceTotalCount > 0 ? ` · ${replaceCurrentCount}/${replaceTotalCount}` : '...'}${activeEta ? ` · ${activeEta}` : ''}`
                          : isGrantingPermissions
                            ? `Asset Permissions${permissionsTotalCount > 0 ? ` · ${permissionsCurrentCount}/${permissionsTotalCount}` : '...'}${activeEta ? ` · ${activeEta}` : ''}`
                            : ''}
                    </span>
                  </div>
                </div>
              )}
              <div className="flex-1 flex overflow-hidden w-full relative min-h-0">
                {/* Left Panel: Tree Navigator */}
                <div
                  className={cn(
                    'h-full border-r border-border-subtle flex flex-col overflow-hidden shrink-0 transition-all duration-200',
                    isRightPanelOpen ? 'w-1/2' : 'w-full border-r-0',
                  )}
                >
                  <div
                    data-tutorial-target="explorer-tree"
                    className="flex flex-col flex-1 p-2 overflow-y-auto scrollbar-hide"
                  >
                    {stats.total === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3 select-none h-full bg-bg-surface/5">
                        <FolderOpen size={36} className="text-primary/30 animate-pulse" />
                        <div className="space-y-1 max-w-xs">
                          <h4 className="text-xs font-bold text-text-primary">
                            {isScanningStudio || (studioConnected && scanStatus?.scanning)
                              ? 'Scanning Studio...'
                              : 'No Assets Scanned Yet'}
                          </h4>
                          <p className="text-[11px] text-text-secondary leading-relaxed">
                            {isScanningStudio || (studioConnected && scanStatus?.scanning)
                              ? 'Crawling Roblox Studio for spoofable assets...'
                              : 'You connected without a full scan. You can scan Studio, run a targeted model scan, or add manual IDs.'}
                          </p>
                        </div>

                        {!isScanningStudio && (
                          <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
                            {/* Split button: Scan Studio + Settings Gear */}
                            <div className="flex items-center rounded-lg overflow-hidden border border-primary/20 shadow-sm w-full">
                              <button
                                type="button"
                                onClick={() => {
                                  const types = [
                                    'sounds',
                                    'animations',
                                    'images',
                                    'meshes',
                                    'scripts',
                                  ].filter((k) => scanTypes.has(k));
                                  document.dispatchEvent(
                                    new CustomEvent('ism-start-scan', {
                                      detail: { scanTypes: types, scriptScanMode: scriptMode },
                                    }),
                                  );
                                }}
                                disabled={scanTypes.size === 0 || !studioConnected}
                                className="flex-1 flex items-center justify-center gap-2 h-8 bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
                              >
                                <ScanSearch size={14} />
                                <span>Scan Studio</span>
                              </button>

                              <Popover>
                                <PopoverTrigger
                                  render={
                                    <button
                                      type="button"
                                      className="h-8 w-8 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors border-l border-primary-foreground/20 flex items-center justify-center cursor-pointer"
                                    >
                                      <Settings2 size={13} />
                                    </button>
                                  }
                                />
                                <PopoverContent
                                  align="end"
                                  side="bottom"
                                  sideOffset={6}
                                  className="w-72 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[250]"
                                >
                                  <div className="flex flex-col gap-3">
                                    <div>
                                      <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2 block">
                                        Asset Types
                                      </span>
                                      <div className="flex flex-wrap gap-1.5">
                                        {[
                                          { key: 'sounds', label: 'Sounds' },
                                          { key: 'animations', label: 'Animations' },
                                          { key: 'images', label: 'Images' },
                                          { key: 'meshes', label: 'Meshes' },
                                          { key: 'scripts', label: 'Scripts' },
                                        ].map((type) => (
                                          <button
                                            key={type.key}
                                            type="button"
                                            onClick={() => toggleScanType(type.key)}
                                            className={cn(
                                              'px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors cursor-pointer',
                                              scanTypes.has(type.key)
                                                ? 'bg-primary/15 border-primary/40 text-primary'
                                                : 'bg-bg-base border-border-subtle text-text-muted hover:text-text-primary hover:border-border',
                                            )}
                                          >
                                            {scanTypes.has(type.key) && (
                                              <Check size={8} className="inline mr-1" />
                                            )}
                                            {type.label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    <div>
                                      <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2 block">
                                        Script Mode
                                      </span>
                                      <div className="flex rounded-md overflow-hidden border border-border-subtle bg-bg-base">
                                        {[
                                          { key: 'assetIds', label: 'Fast IDs' },
                                          { key: 'fullSource', label: 'Full Source' },
                                          { key: 'off', label: 'Off' },
                                        ].map((mode) => (
                                          <button
                                            key={mode.key}
                                            type="button"
                                            onClick={() => setScriptMode(mode.key)}
                                            className={cn(
                                              'flex-1 h-6 text-[9px] font-semibold transition-colors cursor-pointer',
                                              scriptMode === mode.key
                                                ? 'bg-primary text-primary-foreground'
                                                : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
                                            )}
                                          >
                                            {mode.label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </div>

                            {/* Targeted Path Scan with Options */}
                            <Popover open={targetedScanOpen} onOpenChange={setTargetedScanOpen}>
                              <PopoverTrigger
                                render={
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs font-medium gap-1.5 w-full"
                                  >
                                    <MapPin size={13} />
                                    <span>Scan Specific Path / Model</span>
                                  </Button>
                                }
                              />
                              <PopoverContent
                                align="center"
                                side="bottom"
                                sideOffset={6}
                                className="w-76 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[250]"
                              >
                                <div className="flex flex-col gap-2.5">
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                                    Targeted Path Scan
                                  </div>
                                  <p className="text-[11px] text-text-secondary leading-snug">
                                    Scan only a specific instance or container instead of the whole
                                    game:
                                  </p>
                                  <Input
                                    value={targetedPath}
                                    onChange={(e) => setTargetedPath(e.target.value)}
                                    placeholder="e.g. game.Workspace.AKAnims or Guns"
                                    className="h-8 text-xs font-mono bg-bg-base"
                                    onKeyDown={(e) => e.key === 'Enter' && handleRunTargetedScan()}
                                  />

                                  <div>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted mb-1.5 block">
                                      Asset Types
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                      {[
                                        { key: 'sounds', label: 'Sounds' },
                                        { key: 'animations', label: 'Animations' },
                                        { key: 'images', label: 'Images' },
                                        { key: 'meshes', label: 'Meshes' },
                                        { key: 'scripts', label: 'Scripts' },
                                      ].map((type) => (
                                        <button
                                          key={type.key}
                                          type="button"
                                          onClick={() => toggleScanType(type.key)}
                                          className={cn(
                                            'px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors cursor-pointer',
                                            scanTypes.has(type.key)
                                              ? 'bg-primary/15 border-primary/40 text-primary'
                                              : 'bg-bg-base border-border-subtle text-text-muted hover:text-text-primary hover:border-border',
                                          )}
                                        >
                                          {scanTypes.has(type.key) && (
                                            <Check size={8} className="inline mr-1" />
                                          )}
                                          {type.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted mb-1.5 block">
                                      Script Mode
                                    </span>
                                    <div className="flex rounded-md overflow-hidden border border-border-subtle bg-bg-base">
                                      {[
                                        { key: 'assetIds', label: 'Fast IDs' },
                                        { key: 'fullSource', label: 'Full Source' },
                                        { key: 'off', label: 'Off' },
                                      ].map((mode) => (
                                        <button
                                          key={mode.key}
                                          type="button"
                                          onClick={() => setScriptMode(mode.key)}
                                          className={cn(
                                            'flex-1 h-6 text-[9px] font-semibold transition-colors cursor-pointer',
                                            scriptMode === mode.key
                                              ? 'bg-primary text-primary-foreground'
                                              : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
                                          )}
                                        >
                                          {mode.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="flex justify-end gap-2 pt-1 border-t border-border-subtle/50">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() => setTargetedScanOpen(false)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-7 text-xs font-semibold"
                                      disabled={!targetedPath.trim() || !studioConnected}
                                      onClick={() => handleRunTargetedScan()}
                                    >
                                      Scan Path
                                    </Button>
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>

                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs text-text-secondary hover:text-text-primary gap-1.5 w-full"
                              onClick={() =>
                                document.dispatchEvent(new CustomEvent('ism-open-paste-ids'))
                              }
                            >
                              <ClipboardPaste size={13} />
                              <span>Add Manual / Ghost IDs</span>
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      displayedInstances.map((node) => (
                        <ExplorerTreeNode
                          key={node.referent}
                          node={node}
                          level={0}
                          config={config}
                          selectedAssetIds={selectedAssetIds}
                          selectedAssetKeys={selectedAssetKeys}
                          toggleAsset={toggleAsset}
                          toggleNode={toggleNode}
                          getAllAssetIds={getAllAssetIds}
                          getAllAssetKeys={getAllAssetKeys}
                          setEnlargedImage={setEnlargedImage}
                          setPreviewingAnimation={setPreviewingAnimation}
                          activeAssetFilters={activeAssetFilters}
                          searchQuery={deferredSearchQuery}
                          playingAudioId={playingAudioId}
                          initialExpanded={true}
                          onInspectAsset={setActiveInspectAsset}
                          activeInspectAssetId={
                            activeInspectAsset ? getAssetId(activeInspectAsset) : null
                          }
                        />
                      ))
                    )}
                  </div>
                </div>

                {/* Right Panel: Half-Screen Inspector Panel */}
                {isRightPanelOpen && (
                  <div className="w-1/2 h-full flex flex-col bg-bg-surface/10 overflow-hidden">
                    <AssetInspectorPanel
                      asset={activeInspectAsset}
                      onClose={() => {
                        useSpooferStore.getState().setIsInspectorOpen(false);
                        useSpooferStore.getState().setIsPropertiesOpen(false);
                      }}
                      playingAudioId={playingAudioId}
                      setPlayingAudioId={setPlayingAudioId}
                      allInstances={displayedInstances}
                      showViewport={isInspectorOpen}
                      showProperties={isPropertiesOpen}
                    />
                  </div>
                )}
              </div>

              {/* Bottom Bar: Unified Global Control Bar */}
              <div className="h-12 shrink-0 border-t border-border-subtle bg-bg-surface/30 px-3 flex items-center justify-between gap-3 font-sans">
                <div className="flex items-center gap-3">
                  <Popover open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 border-border-subtle"
                          title={t('explorer.clearExplorer') ?? 'Clear Explorer'}
                        />
                      }
                    >
                      <Trash2 size={14} />
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      side="top"
                      sideOffset={8}
                      className="w-56 p-3 bg-bg-surface border border-border rounded-lg shadow-lg"
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                          {t('explorer.clearExplorer')}
                        </div>
                        <div className="text-xs text-text-secondary leading-normal">
                          {t('common.areYouSure') ?? 'Are you sure?'}{' '}
                          <span className="text-text-muted">
                            This will remove all {stats.total} scanned assets.
                          </span>
                        </div>
                        <div className="flex items-center gap-2 justify-end pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2.5"
                            onClick={() => setClearConfirmOpen(false)}
                          >
                            {t('common.cancel')}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 text-xs px-3 font-semibold bg-red-500 text-white"
                            onClick={() => {
                              setRootInstances([]);
                              setLoadedFileName(null);
                              setActiveInspectAsset(null);
                              useSpooferStore.getState().clearAssetStatuses();
                              useSpooferStore.getState().setLastReplacements({});
                              useSpooferStore.getState().setAssetForcePlaceIds({});
                              useSpooferStore.getState().clearGhostAssets();
                              localStorage.removeItem('ISpooferMotion_SavedReplacements');
                              localStorage.removeItem('ISpooferMotion_SavedPlaceIds');
                              void invoke('clear_plugin_cache').catch(console.warn);
                              setClearConfirmOpen(false);
                            }}
                          >
                            {t('common.clear') ?? 'Clear'}
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                    <span>{stats.total} assets found</span>
                    {lastScanTime && (
                      <>
                        <span>•</span>
                        <span>
                          Scanned{' '}
                          {new Date(lastScanTime).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Selection Actions Pill Group — only shown when assets are selected */}
                  {selectedCount > 0 && (
                    <div className="flex items-center rounded-lg border border-border-subtle bg-bg-surface p-0.5 shrink-0 gap-0.5 shadow-sm">
                      {/* Force Place ID Pin */}
                      <Popover open={lockOpen} onOpenChange={setLockOpen}>
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              className="h-7 px-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground rounded transition-colors relative"
                            >
                              <Lock
                                size={13}
                                className={
                                  pinnedCount > 0 ? 'text-primary' : 'text-muted-foreground'
                                }
                              />
                              {pinnedCount > 0 && (
                                <span className="min-w-[12px] h-[12px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                                  {pinnedCount}
                                </span>
                              )}
                            </button>
                          }
                        />
                        <PopoverContent
                          align="end"
                          side="top"
                          sideOffset={8}
                          className="w-64 p-3 bg-bg-surface border border-border shadow-xl rounded-lg"
                        >
                          <div className="flex flex-col gap-2">
                            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                              {t('settings.forcePlaceIds')} · {selectedCount} selected
                            </div>
                            <Input
                              value={placeIdInput}
                              onChange={(e) => setPlaceIdInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && applyPin()}
                              placeholder={
                                t('settings.forcePlaceIdsPlaceholder') || 'e.g. 123456789'
                              }
                              className="h-8 text-xs bg-bg-base font-mono"
                            />
                            <div className="flex items-center justify-between gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[11px] text-destructive"
                                disabled={pinnedCount === 0}
                                onClick={() => setConfirmClearPins(true)}
                              >
                                <Trash2 size={12} className="mr-1" />
                                {t('common.clear')}
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 text-[11px]"
                                onClick={applyPin}
                                disabled={!placeIdInput.trim()}
                              >
                                {t('common.apply')}
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>

                      {/* Unified Copy Drop-Up */}
                      {(() => {
                        const lastReplacements = useSpooferStore.getState().lastReplacements || {};
                        const selectedArray = Array.from(selectedAssetIds);
                        const hasAnyReplacement = selectedArray.some((id) => lastReplacements[id]);
                        const allHaveReplacements = selectedArray.every(
                          (id) => lastReplacements[id],
                        );

                        const handleDefaultCopy = () => {
                          if (allHaveReplacements) {
                            const pairs = selectedArray.map(
                              (id) => `${id} -> ${lastReplacements[id]}`,
                            );
                            void navigator.clipboard.writeText(pairs.join(',\n'));
                            showToast('success', `Copied ${pairs.length} replacement pair(s)!`);
                          } else {
                            const ids = selectedArray.map((id) => lastReplacements[id] || id);
                            void navigator.clipboard.writeText(ids.join(',\n'));
                            showToast('success', `Copied ${ids.length} selected ID(s)!`);
                          }
                        };

                        const handleCopySelected = () => {
                          const ids = selectedArray.map((id) => id);
                          void navigator.clipboard.writeText(ids.join(',\n'));
                          showToast('success', `Copied ${ids.length} selected ID(s)!`);
                        };

                        const handleCopyPairs = () => {
                          const pairs = selectedArray
                            .filter((id) => lastReplacements[id])
                            .map((id) => `${id} -> ${lastReplacements[id]}`);
                          void navigator.clipboard.writeText(pairs.join(',\n'));
                          showToast('success', `Copied ${pairs.length} replacement pair(s)!`);
                        };

                        const handleCopyReplacedOnly = () => {
                          const replacedIds = selectedArray
                            .map((id) => lastReplacements[id])
                            .filter((id): id is string => Boolean(id));
                          void navigator.clipboard.writeText(replacedIds.join(',\n'));
                          showToast('success', `Copied ${replacedIds.length} replaced ID(s)!`);
                        };

                        return (
                          <Popover>
                            <div className="flex items-center shrink-0 rounded overflow-hidden">
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      type="button"
                                      onClick={handleDefaultCopy}
                                      className="h-7 px-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      <Copy size={13} />
                                      <span>Copy</span>
                                    </button>
                                  }
                                />
                                <TooltipContent>
                                  {allHaveReplacements
                                    ? 'Copy replacement pairs (orig -> new)'
                                    : `Copy selected IDs (${selectedCount})`}
                                </TooltipContent>
                              </Tooltip>

                              <PopoverTrigger
                                render={
                                  <button
                                    type="button"
                                    className="h-7 px-1 text-muted-foreground hover:text-foreground border-l border-border-subtle/50 flex items-center justify-center transition-colors"
                                  >
                                    <ChevronDown size={11} />
                                  </button>
                                }
                              />
                            </div>

                            <PopoverContent
                              align="end"
                              side="top"
                              sideOffset={8}
                              className="w-52 p-1 bg-bg-surface border border-border shadow-xl rounded-lg z-[220]"
                            >
                              <div className="flex flex-col gap-0.5">
                                <button
                                  type="button"
                                  onClick={handleCopySelected}
                                  className="flex items-center gap-2 w-full h-8 px-2 rounded-md text-xs font-medium text-left transition-colors text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
                                >
                                  <Copy size={13} className="text-muted-foreground" />
                                  <span className="flex-1">
                                    Copy Selected IDs ({selectedCount})
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={handleCopyPairs}
                                  disabled={!hasAnyReplacement}
                                  className={cn(
                                    'flex items-center gap-2 w-full h-8 px-2 rounded-md text-xs font-medium text-left transition-colors',
                                    hasAnyReplacement
                                      ? 'text-emerald-400 hover:bg-emerald-500/10'
                                      : 'text-text-muted/40 cursor-not-allowed',
                                  )}
                                >
                                  <Copy size={13} />
                                  <span className="flex-1">Copy Replacement Pairs</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={handleCopyReplacedOnly}
                                  disabled={!hasAnyReplacement}
                                  className={cn(
                                    'flex items-center gap-2 w-full h-8 px-2 rounded-md text-xs font-medium text-left transition-colors',
                                    hasAnyReplacement
                                      ? 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                                      : 'text-text-muted/40 cursor-not-allowed',
                                  )}
                                >
                                  <Copy size={13} className="text-muted-foreground" />
                                  <span className="flex-1">Copy Replaced IDs Only</span>
                                </button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        );
                      })()}

                      {/* Save Ghost IDs to Studio popover button */}
                      {selectedGhostIds.length > 0 && (
                        <Popover open={saveToStudioOpen} onOpenChange={setSaveToStudioOpen}>
                          <PopoverTrigger
                            render={
                              <button
                                type="button"
                                className="h-7 px-2 flex items-center gap-1 text-xs font-semibold text-primary hover:bg-primary/10 rounded transition-colors"
                              >
                                <FolderPlus size={13} />
                                <span>Save ({selectedGhostIds.length})</span>
                              </button>
                            }
                          />
                          <PopoverContent
                            align="end"
                            side="top"
                            sideOffset={8}
                            className="w-72 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[220]"
                          >
                            <div className="flex flex-col gap-2.5">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                                Save {selectedGhostIds.length} Ghost ID(s) to Studio
                              </div>
                              <div className="text-xs text-text-secondary">
                                Enter Roblox Studio DataModel path to create instances:
                              </div>
                              <Input
                                value={studioSavePath}
                                onChange={(e) => setStudioSavePath(e.target.value)}
                                placeholder="e.g. game.Workspace.RifleAnims or Workspace"
                                className="h-8 text-xs bg-bg-base font-mono"
                                onKeyDown={(e) =>
                                  e.key === 'Enter' && void handleSaveGhostIdsToStudio()
                                }
                              />
                              <div className="flex justify-end gap-2 pt-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setSaveToStudioOpen(false)}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs font-semibold"
                                  disabled={isSavingToStudio || !studioSavePath.trim()}
                                  onClick={() => void handleSaveGhostIdsToStudio()}
                                >
                                  {isSavingToStudio ? 'Creating...' : 'Create in Studio'}
                                </Button>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  )}

                  {/* Studio Tools Pill Group */}
                  <div className="flex items-center rounded-lg border border-border-subtle bg-bg-surface p-0.5 shrink-0 gap-0.5 shadow-sm">
                    {/* Discover Place IDs */}
                    {config.spoofing.selectedUser !== 'none' && (
                      <div className="flex items-center rounded overflow-hidden">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                className="h-7 px-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                onClick={() =>
                                  document.dispatchEvent(
                                    new CustomEvent('ism-discover-place-ids', {
                                      detail: { timeoutSecs: discoveryTimeoutSecs },
                                    }),
                                  )
                                }
                                disabled={busy || isDiscoveringPlaceIds}
                              >
                                {isDiscoveringPlaceIds ? (
                                  <Loader2 size={13} className="animate-spin text-primary" />
                                ) : (
                                  <MapPin size={13} />
                                )}
                                <span>Discover</span>
                              </button>
                            }
                          />
                          <TooltipContent>
                            {isDiscoveringPlaceIds
                              ? 'Discovering Place IDs...'
                              : `Discover Place IDs (${discoveryTimeoutSecs}s limit/asset)`}
                          </TooltipContent>
                        </Tooltip>

                        <Popover>
                          <PopoverTrigger
                            render={
                              <button
                                type="button"
                                className="h-7 px-1 text-muted-foreground hover:text-foreground border-l border-border-subtle/50 flex items-center justify-center transition-colors"
                              >
                                <ChevronDown size={11} />
                              </button>
                            }
                          />
                          <PopoverContent
                            align="end"
                            side="top"
                            sideOffset={8}
                            className="w-64 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[220]"
                          >
                            <div className="flex flex-col gap-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                                  Discovery Timeout
                                </span>
                                <span className="text-xs font-mono font-bold text-primary">
                                  {discoveryTimeoutSecs}s / asset
                                </span>
                              </div>
                              <input
                                type="range"
                                min={30}
                                max={300}
                                step={10}
                                value={discoveryTimeoutSecs}
                                onChange={(e) => setDiscoveryTimeoutSecs(Number(e.target.value))}
                                className="w-full accent-primary h-1.5 bg-bg-base rounded-lg cursor-pointer"
                              />
                              <div className="flex justify-between text-[9px] text-text-muted font-mono">
                                <span>30s (fast)</span>
                                <span>120s</span>
                                <span>300s (deep)</span>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    )}

                    {/* Manual Replace Paste Button */}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
                            onClick={() =>
                              document.dispatchEvent(new CustomEvent('ism-open-paste-ids'))
                            }
                          >
                            <ClipboardPaste size={13} />
                          </button>
                        }
                      />
                      <TooltipContent>Manual Replace & Add IDs</TooltipContent>
                    </Tooltip>

                    {/* Dedicated Quick Re-Apply Replacements Button (without spoof/download) */}
                    {storedReplacementsCount > 0 && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              disabled={busy}
                              className="h-7 px-2.5 flex items-center gap-1.5 text-xs text-primary bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded transition-colors disabled:opacity-50 cursor-pointer font-medium"
                              onClick={() => void handleForceApplyReplacements()}
                            >
                              <RotateCcw size={12} className={isReplacing ? 'animate-spin' : ''} />
                              <span>Apply IDs ({storedReplacementsCount})</span>
                            </button>
                          }
                        />
                        <TooltipContent>
                          Force push stored ID replacements into Studio (Memory Injection + Plugin)
                          without re-spoofing or downloading.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* Split Spoof/Download button with mode dropdown */}
                  <Popover open={spoofModeOpen} onOpenChange={setSpoofModeOpen}>
                    <div className="flex items-center shrink-0 rounded-md overflow-hidden">
                      <Button
                        size="sm"
                        data-tutorial-target="run-spoofer"
                        className="h-8 px-3 rounded-r-none rounded-l-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm"
                        onClick={() => {
                          const targetPaths = computeTargetPaths();
                          useSpooferStore.getState().setTargetPathsMap(targetPaths || {});
                          if (selectedAssetIds.size > 0) {
                            document.dispatchEvent(
                              new CustomEvent('ism-run-spoofer', {
                                detail: {
                                  assetIds: Array.from(selectedAssetIds),
                                  targetPaths,
                                },
                              }),
                            );
                          } else {
                            document.dispatchEvent(
                              new CustomEvent('ism-run-spoofer', {
                                detail: { targetPaths },
                              }),
                            );
                          }
                        }}
                        disabled={busy}
                      >
                        {config.spoofing.downloadOnly ? (
                          <Download size={13} />
                        ) : (
                          <Play size={13} fill="currentColor" />
                        )}
                        {isSpoofing
                          ? (t('spoof.runSpoofer') ?? 'Run Spoofer') + '…'
                          : config.spoofing.downloadOnly
                            ? selectedCount > 0
                              ? `Download Selected (${selectedCount})`
                              : `Download All (${stats.displayed})`
                            : selectedCount > 0
                              ? `Spoof Selected (${selectedCount})`
                              : `Spoof All Assets (${stats.displayed})`}
                      </Button>
                      <PopoverTrigger
                        render={
                          <Button
                            size="sm"
                            className="h-8 w-6 rounded-l-none rounded-r-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 border-l border-primary-foreground/20 px-0 flex items-center justify-center"
                            disabled={busy}
                          >
                            <ChevronDown size={12} />
                          </Button>
                        }
                      />
                    </div>
                    <PopoverContent
                      align="end"
                      side="top"
                      sideOffset={6}
                      className="w-48 p-1 bg-bg-surface border border-border shadow-xl flex flex-col gap-0.5"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          updateConfig('spoofing', 'downloadOnly', false);
                          setSpoofModeOpen(false);
                        }}
                        className={cn(
                          'flex items-center gap-2 w-full h-7 px-2 rounded-md text-xs text-left transition-colors cursor-pointer',
                          !config.spoofing.downloadOnly
                            ? 'text-primary bg-primary/10 font-semibold'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                        )}
                      >
                        <Play
                          size={12}
                          className={cn(
                            !config.spoofing.downloadOnly
                              ? 'text-primary'
                              : 'text-muted-foreground',
                          )}
                          fill="currentColor"
                        />
                        <span className="flex-1">Spoof (Upload)</span>
                        {!config.spoofing.downloadOnly && (
                          <Check size={12} className="text-primary" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateConfig('spoofing', 'downloadOnly', true);
                          setSpoofModeOpen(false);
                        }}
                        className={cn(
                          'flex items-center gap-2 w-full h-7 px-2 rounded-md text-xs text-left transition-colors cursor-pointer',
                          config.spoofing.downloadOnly
                            ? 'text-primary bg-primary/10 font-semibold'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                        )}
                      >
                        <Download
                          size={12}
                          className={cn(
                            config.spoofing.downloadOnly ? 'text-primary' : 'text-muted-foreground',
                          )}
                        />
                        <span className="flex-1">Download Only</span>
                        {config.spoofing.downloadOnly && (
                          <Check size={12} className="text-primary" />
                        )}
                      </button>

                      <div className="my-0.5 border-t border-border-subtle" />

                      <button
                        type="button"
                        onClick={() => {
                          setSpoofModeOpen(false);
                          void handleForceApplyReplacements();
                        }}
                        className="flex items-center gap-2 w-full h-7 px-2 rounded-md text-xs text-left transition-colors text-text-secondary hover:text-text-primary hover:bg-bg-elevated cursor-pointer"
                      >
                        <RotateCcw size={12} className="text-primary" />
                        <span className="flex-1 font-medium">Re-apply Replacements</span>
                        {storedReplacementsCount > 0 && (
                          <span className="text-[10px] text-muted-foreground font-mono bg-bg-base px-1 rounded border border-border-subtle">
                            {storedReplacementsCount}
                          </span>
                        )}
                      </button>

                      <div className="my-0.5 border-t border-border-subtle" />
                      <button
                        type="button"
                        onClick={() => {
                          setSpoofModeOpen(false);
                          useSpooferStore.getState().setIsSpoofing(false);
                          useSpooferStore.getState().setIsReplacing(false);
                          useSpooferStore.getState().setIsScanningStudio(false);
                          showToast('info', 'Button state reset. You can start a new spoof.');
                        }}
                        className="flex items-center gap-2 w-full h-7 px-2 rounded-md text-xs text-left transition-colors text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <X size={12} className="text-red-400" />
                        <span className="flex-1 font-medium">Force Reset (Stuck?)</span>
                      </button>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <Dialog open={confirmClearPins} onOpenChange={setConfirmClearPins}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('settings.forcePlaceIds')}</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-text-secondary">
            {t('common.areYouSure') ?? 'Are you sure?'}{' '}
            <span className="text-text-muted">
              ({pinnedCount} pinned asset{pinnedCount === 1 ? '' : 's'})
            </span>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmClearPins(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                clearAssetForcePlaceIds(selectedIds);
                setConfirmClearPins(false);
                setLockOpen(false);
              }}
            >
              {t('common.clear')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function findPropertiesForInstance(instancePath: string, roots: RbxInstance[]): ParsedAssetRef[] {
  const list: ParsedAssetRef[] = [];
  const walk = (nodes: RbxInstance[]) => {
    for (const node of nodes) {
      for (const a of node.assets) {
        if (a.path === instancePath) {
          list.push(a);
        }
      }
      walk(node.children);
    }
  };
  walk(roots);
  return list;
}

function AssetInspectorPanel({
  asset,
  onClose,
  playingAudioId,
  setPlayingAudioId,
  allInstances = [],
  showViewport = true,
  showProperties = true,
}: {
  asset: ParsedAssetRef | null;
  onClose: () => void;
  playingAudioId: string | null;
  setPlayingAudioId: (id: string | null) => void;
  allInstances?: RbxInstance[];
  showViewport?: boolean;
  showProperties?: boolean;
}) {
  const { config } = useConfig();
  const [selectedAssetRef, setSelectedAssetRef] = useState<ParsedAssetRef | null>(asset);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(true);
  const [dataOpen, setDataOpen] = useState(true);
  const [isPoppedOut, setIsPoppedOut] = useState(false);

  const [imageZoom, setImageZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const assetForcePlaceIds = useSpooferStore((s) => s.assetForcePlaceIds) ?? {};
  const lastReplacements = useSpooferStore((s) => s.lastReplacements) ?? {};

  // Whenever the inspected asset changes, reset the selected property and zoom
  useEffect(() => {
    setSelectedAssetRef(asset);
    setImageZoom(1);
    setPan({ x: 0, y: 0 });
  }, [asset]);

  const activeAsset = selectedAssetRef || asset;
  const activeAssetId = activeAsset ? getAssetId(activeAsset) : '';
  const isImage = activeAsset?.type === 'image';
  const isMesh = activeAsset?.type === 'mesh';
  const isAudio = activeAsset?.type === 'audio';
  const isAnimation =
    activeAsset?.type === 'animation' || activeAsset?.type === 'raw_keyframe_sequence';

  // Listen for secondary native preview window events
  useEffect(() => {
    const unlistenClosed = listen('preview-window-closed', () => {
      setIsPoppedOut(false);
    });
    const unlistenReady = listen('preview-window-ready', () => {
      if (activeAsset) {
        void emit('preview-asset-change', activeAsset);
      }
    });
    return () => {
      unlistenClosed.then((fn) => fn());
      unlistenReady.then((fn) => fn());
    };
  }, [activeAsset]);

  // Broadcast asset update whenever activeAsset changes
  useEffect(() => {
    if (activeAsset && isPoppedOut) {
      try {
        localStorage.setItem('preview-current-asset', JSON.stringify(activeAsset));
        void emit('preview-asset-change', activeAsset);
      } catch {
        // ignore
      }
    }
  }, [activeAsset, isPoppedOut]);

  const handleTogglePopout = async () => {
    if (isPoppedOut) {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const win = await WebviewWindow.getByLabel('asset-preview');
        if (win) await win.close();
      } catch {
        // ignore
      }
      setIsPoppedOut(false);
      return;
    }

    try {
      if (activeAsset) {
        localStorage.setItem('preview-current-asset', JSON.stringify(activeAsset));
      }
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      let win = await WebviewWindow.getByLabel('asset-preview');
      if (win) {
        await win.show();
        await win.setFocus();
        if (activeAsset) void emit('preview-asset-change', activeAsset);
      } else {
        win = new WebviewWindow('asset-preview', {
          url: 'preview.html',
          title: 'Asset Preview',
          width: 440,
          height: 480,
          minWidth: 280,
          minHeight: 280,
          alwaysOnTop: true,
          decorations: false,
          transparent: true,
          shadow: true,
        });
      }
      setIsPoppedOut(true);
    } catch (e) {
      console.warn('Could not launch secondary window, fallback to in-app popout', e);
      setIsPoppedOut(true);
    }
  };

  // Gather all properties on this instance
  const instanceProperties = useMemo(() => {
    if (!asset) return [];
    const props = findPropertiesForInstance(asset.path, allInstances);
    if (props.length === 0) return [asset];
    return props;
  }, [asset, allInstances]);

  useEffect(() => {
    if (!activeAssetId || (!isImage && !isMesh)) {
      setThumbnailUrl(null);
      return;
    }

    setLoading(true);
    setError(false);
    invoke<string | null>('fetch_roblox_thumbnail', { assetId: activeAssetId })
      .then((url) => {
        if (url) {
          setThumbnailUrl(url);
        } else if (isImage) {
          setThumbnailUrl(`https://assetdelivery.roblox.com/v1/asset/?id=${activeAssetId}`);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (isImage) {
          setThumbnailUrl(`https://assetdelivery.roblox.com/v1/asset/?id=${activeAssetId}`);
        } else {
          setError(true);
        }
      })
      .finally(() => setLoading(false));
  }, [activeAssetId, isImage, isMesh]);

  if (!asset || !activeAsset) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-muted text-xs text-center p-6 gap-2 select-none h-full bg-bg-surface/5">
        <FolderOpen size={36} className="opacity-30 text-primary mb-2 animate-pulse" />
        <span className="text-sm font-semibold text-text-secondary">No Instance Selected</span>
        <span className="max-w-[240px] text-[11px] leading-relaxed">
          Select an instance in the Explorer tree to inspect its Roblox properties.
        </span>
      </div>
    );
  }

  const handleCopy = async (text: string, field: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handlePlayAudio = async () => {
    if (playingAudioId === activeAssetId) {
      stopRobloxAudio();
      setPlayingAudioId(null);
      return;
    }

    setPlayingAudioId(activeAssetId);
    await playRobloxAudio(activeAssetId, config).catch((err) => {
      console.error('Failed to play audio:', err);
      setPlayingAudioId(null);
    });
  };

  const parentName = asset.path.split('.').slice(-2, -1)[0] || 'Workspace';

  const renderViewport = (isFloating: boolean = false) => (
    <div
      className={cn(
        'relative overflow-hidden flex items-center justify-center bg-bg-base/70',
        isFloating ? 'w-full h-full' : 'flex-1 min-h-[160px] border-b border-border-subtle',
      )}
    >
      {isAnimation && (
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          }
        >
          <AnimationPreview assetId={activeAssetId} assetName={activeAsset.instanceName} inline />
        </Suspense>
      )}

      {(isImage || isMesh) && (
        <div
          className="w-full h-full flex items-center justify-center p-3 bg-checkerboard bg-[size:16px_16px] relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.2 : 0.2;
            setImageZoom((prev) => Math.max(0.25, Math.min(8, +(prev + delta).toFixed(2))));
          }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              setIsDraggingImage(true);
              dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            }
          }}
          onMouseMove={(e) => {
            if (isDraggingImage) {
              setPan({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y,
              });
            }
          }}
          onMouseUp={() => setIsDraggingImage(false)}
          onMouseLeave={() => setIsDraggingImage(false)}
        >
          {loading ? (
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          ) : error ? (
            <div className="text-xs text-destructive flex flex-col items-center gap-2">
              <ImageIcon size={24} className="opacity-40" />
              <span>Failed to load preview</span>
            </div>
          ) : thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              className="max-w-full max-h-full object-contain rounded shadow-lg border border-border pointer-events-none transition-transform duration-75"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${imageZoom})`,
              }}
              draggable={false}
              onError={() => setError(true)}
            />
          ) : (
            <div className="text-xs text-text-muted flex flex-col items-center gap-2">
              <ImageIcon size={24} className="opacity-40" />
              <span>No preview available</span>
            </div>
          )}

          {/* Floating Zoom Controls Overlay */}
          {thumbnailUrl && !loading && !error && (
            <div
              className="absolute bottom-2 right-2 flex items-center gap-1 bg-bg-surface/90 border border-border-subtle rounded-md px-1 py-0.5 shadow-md backdrop-blur-xs select-none z-10"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setImageZoom((prev) => Math.max(0.25, +(prev - 0.25).toFixed(2)))}
                className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground text-xs font-bold rounded cursor-pointer"
                title="Zoom Out"
              >
                -
              </button>
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="h-5 px-1.5 flex items-center gap-0.5 text-[10px] font-mono font-semibold text-text-secondary hover:text-foreground rounded cursor-pointer"
                    >
                      <span>{Math.round(imageZoom * 100)}%</span>
                      <ChevronDown size={9} />
                    </button>
                  }
                />
                <PopoverContent
                  align="end"
                  side="top"
                  sideOffset={4}
                  className="w-20 p-1 bg-bg-surface border border-border shadow-xl rounded-md z-[350]"
                >
                  <div className="flex flex-col gap-0.5">
                    {[0.5, 1, 1.5, 2, 4].map((z) => (
                      <button
                        key={z}
                        type="button"
                        onClick={() => {
                          setImageZoom(z);
                          setPan({ x: 0, y: 0 });
                        }}
                        className={cn(
                          'flex items-center justify-between px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors text-left',
                          imageZoom === z
                            ? 'bg-primary text-primary-foreground font-bold'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                        )}
                      >
                        <span>{Math.round(z * 100)}%</span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <button
                type="button"
                onClick={() => setImageZoom((prev) => Math.min(8, +(prev + 0.25).toFixed(2)))}
                className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground text-xs font-bold rounded cursor-pointer"
                title="Zoom In"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => {
                  setImageZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="h-5 px-1 flex items-center justify-center text-muted-foreground hover:text-foreground text-[9px] font-medium border-l border-border-subtle/50 ml-0.5 cursor-pointer"
                title="Reset Zoom"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}

      {isAudio && (
        <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-2 bg-gradient-to-b from-bg-base/30 to-bg-base/70">
          <div className="w-12 h-10 flex items-center justify-center bg-primary/10 border border-primary/20 rounded-lg">
            <Volume2 size={20} className="text-primary" />
          </div>
          <Button
            size="sm"
            variant={playingAudioId === activeAssetId ? 'destructive' : 'default'}
            className="h-7 px-3 gap-1.5 font-semibold text-xs shadow-sm"
            onClick={handlePlayAudio}
          >
            {playingAudioId === activeAssetId ? (
              <>
                <Square size={11} fill="currentColor" /> Stop Audio
              </>
            ) : (
              <>
                <Play size={11} fill="currentColor" /> Play Audio
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-bg-surface/10 select-none relative overflow-hidden font-sans">
      {/* Header Bar */}
      <div className="h-8 px-2.5 bg-bg-surface/60 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-[11px] font-semibold text-text-muted">
            {showProperties ? 'Properties -' : 'Preview -'}
          </span>
          <span className="text-xs font-bold text-foreground truncate">
            {asset.className} "{asset.instanceName}"
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6 transition-colors',
              isPoppedOut ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => void handleTogglePopout()}
            title={isPoppedOut ? 'Dock Preview' : 'Popout to Secondary OS Window (Always on Top)'}
          >
            {isPoppedOut ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Close panel"
          >
            <X size={13} />
          </Button>
        </div>
      </div>

      {/* Docked Viewport (shown when not popped out and showViewport is true) */}
      {showViewport && !isPoppedOut && renderViewport(false)}

      {/* Studio Properties Grid Table (shown when showProperties is true) */}
      {showProperties && (
        <div
          className={cn(
            'overflow-y-auto divide-y divide-border-subtle/30 text-xs font-sans transition-all duration-200',
            !showViewport || isPoppedOut ? 'flex-1' : 'shrink-0 max-h-[70%]',
          )}
        >
          {/* Section: Asset Content / Appearance */}
          <div>
            <button
              type="button"
              onClick={() => setAppearanceOpen(!appearanceOpen)}
              className="w-full h-6 px-2 bg-bg-elevated/40 hover:bg-bg-elevated/70 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted select-none transition-colors text-left"
            >
              <ChevronRight
                size={11}
                className={cn('transition-transform duration-150', appearanceOpen && 'rotate-90')}
              />
              <span>Appearance & Values</span>
              <span className="ml-auto font-normal text-muted-foreground">
                ({instanceProperties.length})
              </span>
            </button>

            {appearanceOpen && (
              <div className="flex flex-col divide-y divide-border-subtle/20">
                {instanceProperties.map((p) => {
                  const propAssetId = getAssetId(p);
                  const isCurrentActive =
                    activeAssetId === propAssetId && activeAsset.propertyName === p.propertyName;
                  const pinnedPid = propAssetId ? assetForcePlaceIds[propAssetId] : undefined;
                  const replId = propAssetId ? lastReplacements[propAssetId] : undefined;

                  return (
                    <div
                      key={`${p.path}:${p.propertyName}:${propAssetId}`}
                      onClick={() => setSelectedAssetRef(p)}
                      className={cn(
                        'flex items-center min-h-[28px] px-2 py-1 gap-2 cursor-pointer transition-colors group',
                        isCurrentActive ? 'bg-primary/10' : 'hover:bg-accent/40',
                      )}
                    >
                      {/* Left Column: Property Name */}
                      <div className="w-[38%] text-[11px] font-medium text-text-secondary truncate flex items-center gap-1">
                        <span className="truncate">{p.propertyName || 'Asset'}</span>
                      </div>

                      {/* Right Column: Value + Quick Actions */}
                      <div className="flex-1 flex items-center gap-1 min-w-0">
                        <span className="text-[11px] font-mono text-foreground truncate flex-1 select-all">
                          {p.rawValue || `rbxassetid://${propAssetId}`}
                        </span>

                        {/* Active Preview Eye */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAssetRef(p);
                          }}
                          className={cn(
                            'h-5 w-5 rounded flex items-center justify-center shrink-0 transition-colors',
                            isCurrentActive
                              ? 'text-primary bg-primary/20'
                              : 'text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100',
                          )}
                          title="Preview this asset"
                        >
                          <Eye size={11} />
                        </button>

                        {/* Copy Value */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopy(propAssetId, `prop-${p.propertyName}`);
                          }}
                          className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Copy Asset ID"
                        >
                          {copiedField === `prop-${p.propertyName}` ? (
                            <Check size={11} className="text-primary" />
                          ) : (
                            <Copy size={11} />
                          )}
                        </button>

                        {/* Forced Place Pin */}
                        {pinnedPid && (
                          <div
                            className="h-4 px-1 rounded text-[9px] font-mono flex items-center gap-0.5 shrink-0"
                            style={{
                              color: getBrightPlaceIdColor(pinnedPid),
                              backgroundColor: `${getBrightPlaceIdColor(pinnedPid)}18`,
                            }}
                            title={`Pinned Place ID: ${pinnedPid}`}
                          >
                            <Lock size={9} />
                            <span>{formatShortId(pinnedPid)}</span>
                          </div>
                        )}

                        {/* Spoofed Indicator */}
                        {replId && (
                          <div
                            className="h-4 px-1 rounded text-[9px] font-mono flex items-center gap-0.5 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 shrink-0"
                            title={`Spoofed to: rbxassetid://${replId}`}
                          >
                            <Inbox size={9} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section: Data / Metadata */}
          <div>
            <button
              type="button"
              onClick={() => setDataOpen(!dataOpen)}
              className="w-full h-6 px-2 bg-bg-elevated/40 hover:bg-bg-elevated/70 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted select-none transition-colors text-left"
            >
              <ChevronRight
                size={11}
                className={cn('transition-transform duration-150', dataOpen && 'rotate-90')}
              />
              <span>Instance Details</span>
            </button>

            {dataOpen && (
              <div className="flex flex-col divide-y divide-border-subtle/20">
                <div className="flex items-center min-h-[26px] px-2 py-1 gap-2">
                  <span className="w-[38%] text-[11px] text-text-muted">Class Name</span>
                  <span className="flex-1 text-[11px] text-text-primary font-medium truncate">
                    {asset.className || 'Unknown'}
                  </span>
                </div>
                <div className="flex items-center min-h-[26px] px-2 py-1 gap-2">
                  <span className="w-[38%] text-[11px] text-text-muted">Name</span>
                  <span className="flex-1 text-[11px] text-text-primary font-medium truncate">
                    {asset.instanceName || 'Unknown'}
                  </span>
                </div>
                <div className="flex items-center min-h-[26px] px-2 py-1 gap-2">
                  <span className="w-[38%] text-[11px] text-text-muted">Parent</span>
                  <span className="flex-1 text-[11px] text-text-secondary truncate">
                    {parentName}
                  </span>
                </div>
                <div className="flex items-center min-h-[28px] px-2 py-1 gap-2 group">
                  <span className="w-[38%] text-[11px] text-text-muted">DataModel Path</span>
                  <div className="flex-1 flex items-center gap-1 min-w-0">
                    <span className="text-[10px] font-mono text-text-secondary truncate flex-1 select-all">
                      {asset.path || 'Unknown'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopy(asset.path, 'path')}
                      className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Copy full path"
                    >
                      {copiedField === 'path' ? (
                        <Check size={11} className="text-primary" />
                      ) : (
                        <Copy size={11} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
