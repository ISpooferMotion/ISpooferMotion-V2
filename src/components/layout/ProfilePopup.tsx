import { Check, ChevronRight, Plus, UserCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../utils/cn';
import { addDebugLog } from '../../utils/debugLogger';
import {
  loadCachedGroups,
  loadCachedUsers,
  logIsm,
  normalizeId,
  saveCachedGroups,
  validateCookieProfile,
  type RobloxGroup,
  type RobloxUserInfo,
} from '../../utils/robloxProfiles';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

/**
 * Profile popup launched from the user-logo button in the Titlebar.
 *
 * Lets the user switch the active Roblox profile, add another (jumps to the
 * Accounts tab), pick an upload group, and set the global forced place IDs.
 * Per-asset forced place IDs are handled separately via the explorer's lock
 * icon; the value here is the fallback for assets without a per-asset pin.
 */
export default function ProfilePopup({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useLanguage();
  const { config, updateConfig, updateCategory } = useConfig();
  const [users, setUsers] = useState<RobloxUserInfo[]>(loadCachedUsers);
  const [groups, setGroups] = useState<RobloxGroup[]>(() =>
    loadCachedGroups(config.spoofing.selectedUser),
  );
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [open, setOpen] = useState(false);

  // Refresh the cached user list whenever the popup opens.
  useEffect(() => {
    if (open) setUsers(loadCachedUsers());
  }, [open]);

  // Load manageable groups for the active profile (mirrors SpoofingView's effect).
  useEffect(() => {
    if (!open) return;
    const userId = config.spoofing.selectedUser;
    const cached = loadCachedGroups(userId);
    setGroups(cached);
    if (!config.spoofing.cookie || !userId || userId === 'none') {
      setLoadingGroups(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        setLoadingGroups(true);
        const rawGroups = await invoke<RobloxGroup[]>('get_manageable_groups', {
          cookie: config.spoofing.cookie,
        });
        const groupIds = rawGroups.map((g) => String(g.id));
        const iconMap = await invoke<Record<string, string>>('get_group_icons_batch', {
          groupIds,
        }).catch(() => ({}) as Record<string, string>);
        const withIcons = rawGroups.map((group) => ({
          ...group,
          iconUrl: iconMap[String(group.id)] || undefined,
        }));
        if (!cancelled) {
          setGroups(withIcons);
          saveCachedGroups(userId, withIcons);
        }
      } catch (e) {
        addDebugLog('warn', ['ProfilePopup: failed to load groups', e]);
        if (!cancelled) setGroups(cached);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, config.spoofing.cookie, config.spoofing.selectedUser]);

  const selectedUser = config.spoofing.selectedUser;
  const activeAccount = config.accounts.find((a) => String(a.id) === String(selectedUser));
  const fallbackUser = users.find((u) => normalizeId(u.id) === normalizeId(selectedUser));
  const avatarUrl = activeAccount?.avatarUrl || fallbackUser?.avatarUrl;

  const handleSelectUser = async (userId: string) => {
    if (!userId || userId === 'none') {
      updateCategory('spoofing', {
        selectedUser: 'none',
        selectedGroup: 'none',
        cookie: '',
      });
      setGroups([]);
      return;
    }
    let profileCookie = '';
    try {
      const secrets = await invoke<Record<string, unknown>>('load_profile_secrets');
      const profileCookies = secrets?.profileCookies as Record<string, unknown> | undefined;
      const stored = profileCookies?.[userId];
      const cookieRaw = secrets?.cookie;
      const candidate =
        typeof stored === 'string' && stored
          ? stored
          : typeof cookieRaw === 'string'
            ? cookieRaw
            : '';
      if (candidate) {
        const result = await validateCookieProfile(candidate);
        if (normalizeId(result.user.id) === normalizeId(userId)) profileCookie = result.cookie;
      }
    } catch (e) {
      addDebugLog('error', ['ProfilePopup: failed to load profile secrets', e]);
      logIsm('warn', 'The saved cookie for this Roblox profile could not be restored.', true);
    }
    updateCategory('spoofing', {
      selectedUser: userId,
      selectedGroup: 'none',
      cookie: profileCookie,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={
              collapsed
                ? 'flex items-center justify-start w-full h-10 px-3 rounded-md hover:bg-bg-elevated transition-colors shrink-0'
                : 'flex items-center gap-3 w-full h-11 px-3 rounded-md hover:bg-bg-elevated transition-colors border border-border-subtle bg-bg-surface/40 shrink-0'
            }
            aria-label="Profile"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="w-7 h-7 rounded-full object-cover ring-1 ring-border shrink-0"
              />
            ) : (
              <UserCircle size={22} className="text-muted-foreground shrink-0" />
            )}
            {!collapsed && (
              <span className="flex-1 text-left min-w-0">
                <span className="block text-[12px] text-text-primary font-medium truncate leading-tight">
                  {activeAccount?.name ||
                    fallbackUser?.displayName ||
                    t('accounts.anonymousDownloader')}
                </span>
                <span className="block text-[10px] text-text-muted truncate leading-tight">
                  {t('nav.accounts')}
                </span>
              </span>
            )}
          </button>
        }
      />
      <PopoverContent align="start" sideOffset={8} className="w-72 p-2">
        <div className="flex flex-col gap-1">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
            {t('spoof.targetContext')}
          </div>

          {/* Show saved accounts, or discovered cached users if no accounts added yet */}
          {(() => {
            // Merge config.accounts with discovered cached users that aren't already added
            const configIds = new Set(config.accounts.map((a) => normalizeId(a.id)));
            const discovered = users.filter((u) => !configIds.has(normalizeId(u.id)));
            const allAccounts = [
              ...config.accounts.map((acc) => ({
                id: acc.id,
                name: acc.name,
                avatarUrl: acc.avatarUrl,
              })),
              ...discovered.map((u) => ({
                id: String(u.id),
                name: u.displayName || u.name || String(u.id),
                avatarUrl: u.avatarUrl,
              })),
            ];

            if (allAccounts.length === 0) {
              return (
                <div className="px-2 py-2 text-xs text-text-muted">{t('accounts.noAccounts')}</div>
              );
            }

            return allAccounts.map((acc) => {
              const isActive = String(acc.id) === String(selectedUser);
              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => void handleSelectUser(String(acc.id))}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-xs transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-bg-surface text-text-primary',
                  )}
                >
                  {acc.avatarUrl ? (
                    <img src={acc.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-bg-surface flex items-center justify-center">
                      <UserCircle size={16} className="text-muted-foreground" />
                    </div>
                  )}
                  <span className="flex-1 truncate">{acc.name}</span>
                  {isActive && <Check size={14} className="text-primary" />}
                </button>
              );
            });
          })()}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              updateConfig('ui', 'activeTab', 'accounts');
            }}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-xs text-text-secondary hover:bg-bg-surface transition-colors"
          >
            <Plus size={14} className="text-muted-foreground" />
            <span className="flex-1">{t('accounts.addAccount')}</span>
            <ChevronRight size={14} className="text-muted-foreground" />
          </button>

          <div className="h-px bg-border my-1.5" />

          {/* Group */}
          <div className="flex flex-col gap-1 px-1">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              {t('spoof.selectedGroup')}
            </div>
            <select
              value={config.spoofing.selectedGroup}
              onChange={(e) => updateConfig('spoofing', 'selectedGroup', e.target.value)}
              className="h-8 w-full bg-bg-base text-text-primary text-xs rounded-md border border-border-strong px-2 focus:outline-none focus:border-primary/50"
            >
              <option value="none">{t('common.none')}</option>
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
            </select>
            {loadingGroups && <span className="text-[10px] text-text-muted">Loading groups…</span>}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
