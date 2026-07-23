import { Check, Filter, FolderOpen, Search, X } from 'lucide-react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { cn } from '../../../utils/cn';
import { Button } from '../../ui/button';
import { Command, CommandGroup, CommandItem, CommandList } from '../../ui/command';
import { Input } from '../../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';

export const ASSET_TYPE_OPTIONS = [
  { value: 'audio', label: 'Audio' },
  { value: 'image', label: 'Images' },
  { value: 'animation', label: 'Animations' },
  { value: 'mesh', label: 'Meshes' },
];

export interface ExplorerToolbarProps {
  loadedFileName: string | null;
  activeAssetFilters: string[];
  setActiveAssetFilters: (filters: string[]) => void;
  searchQuery?: string;
  setSearchQuery?: (query: string) => void;
}

export function ExplorerToolbar({
  loadedFileName,
  activeAssetFilters,
  setActiveAssetFilters,
  searchQuery,
  setSearchQuery,
}: ExplorerToolbarProps) {
  const { t } = useLanguage();

  if (!loadedFileName) return null;

  const toggleFilter = (val: string) => {
    setActiveAssetFilters(
      activeAssetFilters.includes(val)
        ? activeAssetFilters.filter((v) => v !== val)
        : [...activeAssetFilters, val],
    );
  };

  return (
    <div className="px-3 pt-3 pb-2 flex flex-col gap-2 border-b border-border">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <FolderOpen size={11} />
        <span className="truncate font-medium">{loadedFileName}</span>
      </div>
      {setSearchQuery && (
        <div className="flex min-w-0 items-center gap-2">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 relative">
            <Input
              value={searchQuery ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              placeholder="Search assets by name or ID..."
              className="h-8 text-xs pr-7"
            />
            {(searchQuery ?? '').length > 0 && (
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
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <Filter size={13} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between h-8 text-xs px-3 font-normal"
                />
              }
            >
              {activeAssetFilters.length === 0 ||
              activeAssetFilters.length === ASSET_TYPE_OPTIONS.length
                ? t('explorer.allAssetTypes')
                : `${activeAssetFilters.length} selected`}
            </PopoverTrigger>
            <PopoverContent className="w-48 p-0" align="start">
              <Command>
                <CommandList>
                  <CommandGroup>
                    {ASSET_TYPE_OPTIONS.map((opt) => {
                      const label = t(
                        'explorer.' +
                          (opt.value === 'image'
                            ? 'images'
                            : opt.value === 'animation'
                              ? 'animations'
                              : opt.value === 'mesh'
                                ? 'meshes'
                                : opt.value),
                      );
                      return (
                        <CommandItem
                          key={opt.value}
                          onSelect={() => toggleFilter(opt.value)}
                          className="text-xs"
                        >
                          <div
                            className={cn(
                              'mr-2 flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-primary',
                              activeAssetFilters.includes(opt.value)
                                ? 'bg-primary text-primary-foreground'
                                : 'opacity-50 [&_svg]:invisible',
                            )}
                          >
                            <Check className="h-3 w-3" />
                          </div>
                          {label}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
