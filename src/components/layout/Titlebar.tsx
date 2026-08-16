import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import {
  Activity,
  Box,
  Check,
  Eye,
  EyeOff,
  Film,
  Filter,
  FolderOpen,
  Image as ImageIcon,
  Minus,
  Pin,
  PinOff,
  Search,
  Settings,
  SlidersHorizontal,
  Terminal,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSpooferStore } from '../../stores/spooferStore';
import { cn } from '../../utils/cn';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

export const ASSET_TYPE_OPTIONS = [
  { value: 'audio', label: 'Audio', icon: Volume2 },
  { value: 'image', label: 'Images', icon: ImageIcon },
  { value: 'animation', label: 'Animations', icon: Film },
  { value: 'mesh', label: 'Meshes', icon: Box },
];

/**
 * Context-aware 48px Header & Custom Window Controls bar.
 *
 * Renders tab-specific search, filters, place info, and inspector controls
 * depending on whether the user is on Spoofer, Activity, Settings, Accounts, or Console.
 */
export default function Titlebar() {
  const { t } = useLanguage();
  const { config } = useConfig();
  const activeTab = config.ui.activeTab;

  const loadedFileName = useSpooferStore((s) => s.loadedFileName);
  const searchQuery = useSpooferStore((s) => s.searchQuery) ?? '';
  const setSearchQuery = useSpooferStore((s) => s.setSearchQuery) ?? (() => {});
  const activeAssetFilters = useSpooferStore((s) => s.activeAssetFilters) ?? [];
  const setActiveAssetFilters = useSpooferStore((s) => s.setActiveAssetFilters) ?? (() => {});
  const isInspectorOpen = useSpooferStore((s) => s.isInspectorOpen) ?? true;
  const setIsInspectorOpen = useSpooferStore((s) => s.setIsInspectorOpen) ?? (() => {});
  const isPropertiesOpen = useSpooferStore((s) => s.isPropertiesOpen) ?? true;
  const setIsPropertiesOpen = useSpooferStore((s) => s.setIsPropertiesOpen) ?? (() => {});
  const [isPinned, setIsPinned] = useState(false);

  const togglePin = async () => {
    const next = !isPinned;
    setIsPinned(next);
    try {
      await getCurrentWindow().setAlwaysOnTop(next);
    } catch (e) {
      console.warn('Failed to toggle pin', e);
    }
  };

  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleClose = async () => {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const previewWin = await WebviewWindow.getByLabel('asset-preview');
      if (previewWin) await previewWin.destroy();
    } catch {}
    if (config.general.hideToTrayOnClose) {
      await getCurrentWindow().hide();
      return;
    }
    await invoke('quit_app');
  };

  const toggleFilter = (val: string) => {
    setActiveAssetFilters(
      activeAssetFilters.includes(val)
        ? activeAssetFilters.filter((v) => v !== val)
        : [...activeAssetFilters, val],
    );
  };

  const hasAssets = !!loadedFileName;

  const renderContextContent = () => {
    if (activeTab === 'spoofing') {
      return (
        <>
          {/* Left: Place name / file info — hidden when no place loaded */}
          {hasAssets && (
            <div
              className="flex items-center gap-2 text-xs font-semibold text-text-primary shrink-0 min-w-0 max-w-[200px]"
              data-tauri-drag-region
            >
              <FolderOpen size={14} className="text-primary shrink-0" />
              <span className="truncate">{loadedFileName}</span>
            </div>
          )}

          {/* Center: Flex-grow search bar with embedded Filter — only when assets loaded */}
          {hasAssets && (
            <div className="flex-1 min-w-0 mx-3 relative flex items-center" data-tauri-drag-region>
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search assets by name or ID..."
                className="h-8 w-full text-xs pl-8 pr-16 bg-bg-base/50 border-border-subtle focus:border-primary"
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {searchQuery.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X size={11} />
                  </button>
                )}
                {/* Compact Filter icon embedded inside search bar */}
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className={cn(
                          'h-6 px-1.5 rounded flex items-center justify-center relative transition-colors cursor-pointer',
                          activeAssetFilters.length > 0
                            ? 'text-primary bg-primary/15'
                            : 'text-muted-foreground hover:text-foreground hover:bg-bg-surface',
                        )}
                        title={t('explorer.allAssetTypes') ?? 'Filter asset types'}
                      />
                    }
                  >
                    <Filter size={12} />
                    {activeAssetFilters.length > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[12px] h-[12px] px-0.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold flex items-center justify-center">
                        {activeAssetFilters.length}
                      </span>
                    )}
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-44 p-1 bg-bg-surface border border-border shadow-xl z-[250] rounded-lg"
                    align="end"
                  >
                    <div className="flex flex-col divide-y divide-border-subtle/20 overflow-hidden rounded-md">
                      {ASSET_TYPE_OPTIONS.map((opt) => {
                        const label =
                          t(
                            'explorer.' +
                              (opt.value === 'image'
                                ? 'images'
                                : opt.value === 'animation'
                                  ? 'animations'
                                  : opt.value === 'mesh'
                                    ? 'meshes'
                                    : opt.value),
                          ) || opt.label;
                        const active = activeAssetFilters.includes(opt.value);
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => toggleFilter(opt.value)}
                            className={cn(
                              'flex items-center gap-2 h-8 px-2.5 text-xs text-left transition-colors cursor-pointer',
                              active
                                ? 'text-primary bg-primary/10 font-semibold'
                                : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                            )}
                          >
                            <Icon
                              size={13}
                              className={active ? 'text-primary' : 'text-muted-foreground'}
                            />
                            <span className="flex-1">{label}</span>
                            {active && <Check size={13} className="text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                    {activeAssetFilters.length > 0 ? (
                      <>
                        <div className="h-px bg-border my-1" />
                        <button
                          type="button"
                          onClick={() => setActiveAssetFilters([])}
                          className="flex items-center gap-2 h-7 px-2 rounded text-xs text-left text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer w-full"
                        >
                          <X size={12} className="text-muted-foreground" />
                          <span>Clear filters ({activeAssetFilters.length})</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="h-px bg-border my-1" />
                        <button
                          type="button"
                          onClick={() =>
                            setActiveAssetFilters(ASSET_TYPE_OPTIONS.map((o) => o.value))
                          }
                          className="flex items-center gap-2 h-7 px-2 rounded text-xs text-left text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer w-full"
                        >
                          <Check size={12} className="text-muted-foreground" />
                          <span>Select all</span>
                        </button>
                      </>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          {/* Spacer when no assets to push window controls right */}
          {!hasAssets && <div className="flex-1" data-tauri-drag-region />}

          {/* Right: Independent Viewport & Properties Toggles */}
          {hasAssets && (
            <div className="flex items-center gap-1.5 shrink-0" data-tauri-drag-region>
              {/* Toggle Preview Viewport (Eye) */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      className={cn(
                        'h-8 w-8 shrink-0 transition-colors',
                        isInspectorOpen
                          ? 'text-primary border-primary/30 bg-primary/10'
                          : 'text-muted-foreground border-border-subtle',
                      )}
                      onClick={() => setIsInspectorOpen(!isInspectorOpen)}
                    >
                      {isInspectorOpen ? <Eye size={13} /> : <EyeOff size={13} />}
                    </Button>
                  }
                />
                <TooltipContent>
                  {isInspectorOpen ? 'Hide Visual Preview' : 'Show Visual Preview'}
                </TooltipContent>
              </Tooltip>

              {/* Toggle Properties Table (Sliders) */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      className={cn(
                        'h-8 w-8 shrink-0 transition-colors',
                        isPropertiesOpen
                          ? 'text-primary border-primary/30 bg-primary/10'
                          : 'text-muted-foreground border-border-subtle',
                      )}
                      onClick={() => setIsPropertiesOpen(!isPropertiesOpen)}
                    >
                      <SlidersHorizontal size={13} />
                    </Button>
                  }
                />
                <TooltipContent>
                  {isPropertiesOpen ? 'Hide Properties Panel' : 'Show Properties Panel'}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </>
      );
    }

    if (activeTab === 'activity') {
      return (
        <>
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary shrink-0">
            <Activity size={14} className="text-primary" />
            <span>{t('nav.activity') ?? 'Activity Logs'}</span>
          </div>

          <div className="flex-1 min-w-0 mx-4 relative" data-tauri-drag-region={false}>
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs by ID, status, or asset..."
              className="h-8 w-full text-xs pl-8 pr-7 bg-bg-base/50 border-border-subtle focus:border-primary"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </>
      );
    }

    if (activeTab === 'settings') {
      return (
        <>
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary shrink-0">
            <Settings size={14} className="text-primary" />
            <span>{t('nav.settings') ?? 'Settings'}</span>
          </div>
          <div className="flex-1" data-tauri-drag-region />
        </>
      );
    }

    if (activeTab === 'accounts') {
      return (
        <>
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary shrink-0">
            <Users size={14} className="text-primary" />
            <span>{t('nav.accounts') ?? 'Accounts'}</span>
          </div>
          <div className="flex-1" data-tauri-drag-region />
        </>
      );
    }

    if (activeTab === 'console') {
      return (
        <>
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary shrink-0">
            <Terminal size={14} className="text-primary" />
            <span>{t('nav.console') ?? 'Console'}</span>
          </div>
          <div className="flex-1" data-tauri-drag-region />
        </>
      );
    }

    return <div className="flex-1" data-tauri-drag-region />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      data-tauri-drag-region
      className="h-12 w-full flex items-center justify-between px-3 bg-bg-surface/90 border-b border-border select-none shrink-0 z-50 relative"
    >
      {renderContextContent()}

      <div className="flex items-center gap-2 shrink-0 ml-2" data-tauri-drag-region={false}>
        <div className="h-4 w-px bg-border mx-0.5" />

        {/* Window controls: Minimize, Pin, Close */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={handleMinimize}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              />
            }
          >
            <Minus size={14} />
          </TooltipTrigger>
          <TooltipContent>{t('debug.minimize')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePin}
                className={cn(
                  'h-8 w-8 transition-colors',
                  isPinned
                    ? 'text-primary bg-primary/15 font-bold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              />
            }
          >
            {isPinned ? <Pin size={13} /> : <PinOff size={13} />}
          </TooltipTrigger>
          <TooltipContent>
            {isPinned ? 'Unpin Window' : 'Pin Window (Always on Top)'}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-8 w-8 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
              />
            }
          >
            <X size={14} />
          </TooltipTrigger>
          <TooltipContent>{t('common.close')}</TooltipContent>
        </Tooltip>
      </div>
    </motion.div>
  );
}
