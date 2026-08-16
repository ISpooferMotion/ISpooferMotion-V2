import {
  Box,
  Check,
  Film,
  Filter,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Search,
  Volume2,
  X,
} from 'lucide-react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSpooferStore } from '../../../stores/spooferStore';
import { cn } from '../../../utils/cn';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';

export const ASSET_TYPE_OPTIONS = [
  { value: 'audio', label: 'Audio', icon: Volume2 },
  { value: 'image', label: 'Images', icon: ImageIcon },
  { value: 'animation', label: 'Animations', icon: Film },
  { value: 'mesh', label: 'Meshes', icon: Box },
];

export interface ExplorerToolbarProps {
  loadedFileName: string | null;
  activeAssetFilters?: string[];
  setActiveAssetFilters?: (filters: string[]) => void;
  searchQuery?: string;
  setSearchQuery?: (query: string) => void;
  isInspectorOpen?: boolean;
  setIsInspectorOpen?: (open: boolean) => void;
}

/**
 * De-cluttered Middle Panel Explorer Toolbar.
 *
 * Provides file information, a flexible search field, compact filter dropdown,
 * and inspector toggle button. Lock and Clipboard buttons are consolidated into
 * the Right Inspector Panel header.
 */
export function ExplorerToolbar({
  loadedFileName,
  activeAssetFilters: propsActiveAssetFilters,
  setActiveAssetFilters: propsSetActiveAssetFilters,
  searchQuery: propsSearchQuery,
  setSearchQuery: propsSetSearchQuery,
  isInspectorOpen = true,
  setIsInspectorOpen,
}: ExplorerToolbarProps) {
  const { t } = useLanguage();
  const storeSearchQuery = useSpooferStore((s) => s.searchQuery);
  const storeSetSearchQuery = useSpooferStore((s) => s.setSearchQuery);
  const storeActiveAssetFilters = useSpooferStore((s) => s.activeAssetFilters);
  const storeSetActiveAssetFilters = useSpooferStore((s) => s.setActiveAssetFilters);

  const searchQuery = propsSearchQuery ?? storeSearchQuery;
  const setSearchQuery = propsSetSearchQuery ?? storeSetSearchQuery;
  const activeAssetFilters = propsActiveAssetFilters ?? storeActiveAssetFilters;
  const setActiveAssetFilters = propsSetActiveAssetFilters ?? storeSetActiveAssetFilters;

  if (!loadedFileName) return null;

  const toggleFilter = (val: string) => {
    setActiveAssetFilters(
      activeAssetFilters.includes(val)
        ? activeAssetFilters.filter((v) => v !== val)
        : [...activeAssetFilters, val],
    );
  };

  return (
    <div className="px-3 py-2 flex items-center gap-2 border-b border-border bg-bg-surface/30">
      {/* Place name */}
      <div className="flex items-center gap-1.5 text-xs text-text-primary shrink-0 min-w-0 max-w-[200px]">
        <FolderOpen size={13} className="shrink-0 text-primary" />
        <span className="truncate font-semibold">{loadedFileName}</span>
      </div>

      {/* Flexible Search Field with embedded Filter (flex-grow: 1) */}
      <div className="min-w-0 flex-1 relative flex items-center">
        <Search
          size={12}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <Input
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          placeholder="Search assets by name or ID..."
          className="h-8 text-xs pl-8 pr-16 bg-bg-base/40 border-border-subtle focus:border-primary w-full"
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
                      ? 'text-primary bg-primary/15 font-semibold'
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
                    onClick={() => setActiveAssetFilters(ASSET_TYPE_OPTIONS.map((o) => o.value))}
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

      {/* Inspector Panel Toggle Button */}
      {setIsInspectorOpen && (
        <Button
          variant="outline"
          size="icon"
          className={cn(
            'h-8 w-8 shrink-0 transition-colors',
            isInspectorOpen
              ? 'text-primary border-primary/30 bg-primary/10'
              : 'text-muted-foreground',
          )}
          onClick={() => setIsInspectorOpen(!isInspectorOpen)}
          title={isInspectorOpen ? 'Hide Inspector Panel' : 'Show Inspector Panel'}
        >
          <Info size={13} />
        </Button>
      )}
    </div>
  );
}
