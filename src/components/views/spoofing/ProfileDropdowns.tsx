import { motion } from 'framer-motion';
import { Loader2, Users, UserSquare2 } from 'lucide-react';

import type { AppConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useConfigStore } from '../../../stores/configStore';
import { cn } from '../../../utils/cn';
import { normalizeId, type RobloxGroup, type RobloxUserInfo } from '../../../utils/robloxProfiles';

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../ui/select';

/**
 * Compact account switcher for the Spoofing view.
 *
 * Lists every account saved on the Accounts tab and lets the user switch
 * the active credentials without leaving Spoofing. Selecting an account
 * mirrors what the Accounts tab's Select button does: pushes that
 * account's cookie/API key into the active spoofing config and disables
 * auto-detect so a manual choice sticks.
 */
export function AccountSwitcher({ accounts }: { accounts: AppConfig['accounts'] }) {
  const { t } = useLanguage();
  const { accountSecrets, updateConfig, updateCategory } = useConfigStore();
  const activeUserId = useConfigStore((s) => s.config.spoofing.selectedUser);

  if (!accounts || accounts.length === 0) return null;

  const handleChange = (nextId: string | null) => {
    if (!nextId || nextId === 'none') return;
    const account = accounts.find((a) => a.id === nextId);
    if (!account) return;
    const secrets = accountSecrets[nextId];

    updateConfig('spoofing', 'selectedUser', nextId);
    updateCategory('advanced', { autoCookieStudio: false, autoCookieBrowser: false });
    if (secrets?.cookie && account.isDownloader) {
      updateConfig('spoofing', 'cookie', secrets.cookie);
    }
    if (secrets?.apiKey && account.isUploader) {
      updateConfig('spoofing', 'apiKey', secrets.apiKey);
    }
  };

  const active = accounts.find((a) => a.id === activeUserId);
  const label = active?.name || t('accounts.selectedAccount') || 'Choose account';

  return (
    <div className="flex flex-col gap-1.5 mb-2">
      <span className="text-xs font-medium text-text-secondary">
        {t('accounts.title') || 'Active account'}
      </span>
      <Select value={activeUserId} onValueChange={handleChange}>
        <SelectTrigger className="w-full h-10 bg-bg-surface border-border-strong text-text-primary hover:border-primary px-3 transition-colors">
          <div className="flex items-center gap-2 w-full min-w-0">
            <div className="w-6 h-6 shrink-0">
              {active?.avatarUrl ? (
                <img
                  src={active.avatarUrl}
                  alt={active.name}
                  className="w-6 h-6 rounded-full object-cover"
                />
              ) : (
                <EmptyAvatar size={14} />
              )}
            </div>
            <span className="truncate text-[13px] font-medium">{label}</span>
          </div>
        </SelectTrigger>
        <SelectContent>
          {accounts.map((acc) => (
            <SelectItem key={acc.id} value={acc.id} className="text-[13px]">
              <div className="flex items-center gap-3 w-full">
                <div className="w-6 h-6 shrink-0">
                  {acc.avatarUrl ? (
                    <img
                      src={acc.avatarUrl}
                      alt={acc.name}
                      className="w-full h-full rounded-full object-cover ring-1 ring-border-subtle"
                    />
                  ) : (
                    <EmptyAvatar size={14} />
                  )}
                </div>
                <span
                  className={cn(
                    'truncate',
                    acc.id === activeUserId ? 'font-semibold text-primary' : 'font-medium',
                  )}
                >
                  {acc.name}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export type AudioQuotaDisplay =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; remaining: number; capacity: number };

export function parseAudioQuota(payload: unknown): AudioQuotaDisplay | null {
  // Quota limits are returned as nested arrays depending on the endpoint version.
  // Parse safely to display remaining uploads.
  if (!payload || typeof payload !== 'object') return null;

  const response = payload as Record<string, unknown>;
  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(response.assetQuotas)
      ? response.assetQuotas
      : Array.isArray(response.quotas)
        ? response.quotas
        : [payload];
  const record =
    records.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const assetType = String((item as Record<string, unknown>).assetType || '').toLowerCase();
      return !assetType || assetType === 'audio';
    }) || records[0];

  if (!record || typeof record !== 'object') return null;
  const quota = record as Record<string, unknown>;
  const capacity = Number(quota.capacity);
  const usage = Number(quota.usage);
  if (!Number.isFinite(capacity) || !Number.isFinite(usage)) return null;

  return {
    status: 'ready',
    remaining: Math.max(0, capacity - usage),
    capacity,
  };
}

function EmptyAvatar({ group = false, size = 12 }: { group?: boolean; size?: number }) {
  return (
    <div className="rounded-full bg-bg-elevated flex items-center justify-center w-full h-full">
      {group ? (
        <Users size={size} className="text-text-muted" />
      ) : (
        <UserSquare2 size={size} className="text-text-muted" />
      )}
    </div>
  );
}

export function AvatarDropdown({
  users,
  value,
  audioQuota,
  showAudioQuota,
}: {
  users: RobloxUserInfo[];
  value: string;
  onChange: (value: string) => void;
  loading: boolean;
  audioQuota: AudioQuotaDisplay;
  showAudioQuota?: boolean;
}) {
  const { t } = useLanguage();
  const selected = users.find((user) => normalizeId(user.id) === normalizeId(value));
  const label = selected ? selected.displayName || selected.name : t('common.none');
  const audioQuotaLabel = !selected
    ? t('spoof.audioQuotaSelectUser')
    : !showAudioQuota
      ? t('spoof.audioQuotaEnableAudio')
      : audioQuota.status === 'idle'
        ? t('spoof.audioQuotaAddCookie')
        : audioQuota.status === 'loading'
          ? t('spoof.audioQuotaChecking')
          : audioQuota.status === 'ready'
            ? t('spoof.audioQuotaLeft')
                .replace('{remaining}', String(audioQuota.remaining))
                .replace('{capacity}', String(audioQuota.capacity))
            : t('spoof.audioQuotaUnavailable');

  return (
    <div className="flex w-full flex-col gap-1.5">
      <span className="text-sm font-medium text-text-primary shrink-0">
        {t('spoof.selectedUser')}
      </span>
      <div className="flex items-center gap-3 h-12 w-full">
        <motion.div
          key={`${selected?.id || 'none'}-img`}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative w-8 h-8 shrink-0"
        >
          {selected?.avatarUrl ? (
            <img
              src={selected.avatarUrl}
              alt={label}
              className="w-8 h-8 rounded-full object-cover ring-2 ring-primary/20"
            />
          ) : (
            <EmptyAvatar size={14} />
          )}
        </motion.div>
        <motion.div
          key={`${selected?.id || 'none'}-info`}
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          className="min-w-0 flex-1"
        >
          <div className="truncate text-sm font-semibold text-text-primary leading-4">{label}</div>
          <div className="truncate text-[10px] leading-3 font-medium text-text-muted mt-0.5">
            {audioQuotaLabel}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export function GroupDropdown({
  groups,
  value,
  onChange,
  loading,
}: {
  groups: RobloxGroup[];
  value: string;
  onChange: (value: string) => void;
  loading: boolean;
}) {
  const { t } = useLanguage();
  const selected = groups.find((group) => normalizeId(group.id) === normalizeId(value));

  return (
    <div className="flex flex-col items-start gap-1.5 w-full">
      <span className="text-sm font-medium text-text-primary shrink-0">
        {t('spoof.selectedGroup')}
      </span>
      <Select value={value} onValueChange={(v) => onChange(v || 'none')}>
        <SelectTrigger className="w-full bg-bg-surface border-border-strong text-text-primary hover:border-primary h-10 px-3 transition-colors">
          <div className="flex items-center gap-2 overflow-hidden w-full">
            <div className="relative w-6 h-6 shrink-0">
              {loading ? (
                <Loader2 size={16} className="text-text-muted animate-spin" />
              ) : selected?.iconUrl ? (
                <img
                  src={selected.iconUrl}
                  alt={selected.name}
                  className="w-6 h-6 rounded-full object-cover"
                />
              ) : (
                <EmptyAvatar group />
              )}
            </div>
            <div className="min-w-0 flex-1 text-left truncate text-[13px] font-medium">
              {selected?.name || t('common.none')}
            </div>
          </div>
        </SelectTrigger>

        <SelectContent>
          <SelectItem value="none" className="text-[13px]">
            <div className="flex items-center gap-3 w-full">
              <div className="w-6 h-6 shrink-0">
                <EmptyAvatar group size={14} />
              </div>
              <span className={cn(value === 'none' && 'font-semibold text-primary')}>
                {t('common.none')}
              </span>
            </div>
          </SelectItem>
          {groups.map((group) => (
            <SelectItem key={group.id} value={String(group.id)} className="text-[13px]">
              <div className="flex items-center gap-3 w-full">
                <div className="w-6 h-6 shrink-0">
                  {group.iconUrl ? (
                    <img
                      src={group.iconUrl}
                      alt={group.name}
                      className="w-full h-full rounded-full object-cover ring-1 ring-border-subtle"
                    />
                  ) : (
                    <EmptyAvatar group size={14} />
                  )}
                </div>
                <span
                  className={cn(
                    'truncate',
                    normalizeId(group.id) === normalizeId(value)
                      ? 'font-semibold text-primary'
                      : 'font-medium',
                  )}
                >
                  {group.name}
                </span>
              </div>
            </SelectItem>
          ))}
          {groups.length === 0 && !loading && (
            <div className="px-3 py-4 text-center text-[12px] text-text-muted">
              {t('spoof.noGroupsFound')}
            </div>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
