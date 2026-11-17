import { invoke } from '@tauri-apps/api/core';
import { History, ScanLine, Settings, Terminal, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useLanguage } from '../../contexts/LanguageContext';
import { useStudioConnectionState } from '../../contexts/StudioConnectionContext';
import { cn } from '../../lib/utils';
import ProfilePopup from './ProfilePopup';

export default function Sidebar({
  activeTab,
  onTabChange,
}: {
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  const { t } = useLanguage();
  const { studioConnected } = useStudioConnectionState();
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    let cancelled = false;
    invoke<string>('get_app_version')
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = [
    { id: 'spoofing', label: t('nav.spoofing'), icon: ScanLine },
    { id: 'activity', label: t('nav.activity'), icon: History },
    { id: 'accounts', label: t('nav.accounts'), icon: Users },
    { id: 'settings', label: t('nav.settings'), icon: Settings },
    { id: 'console', label: t('nav.console'), icon: Terminal },
  ];

  return (
    <aside className="h-full w-[220px] shrink-0 border-r border-border-subtle bg-bg-surface/30 p-2 flex flex-col relative z-20">
      <div className="flex h-10 shrink-0 items-center gap-2 mb-2 px-3">
        <img
          src="/ism_logo_theme_swap.svg"
          className="w-7 h-7 object-contain select-none shrink-0"
          alt="ISpooferMotion"
          draggable={false}
        />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-[12px] font-semibold tracking-tight text-foreground truncate">
            ISpooferMotion
          </span>
          <div className="flex items-center gap-1">
            <span
              role="status"
              aria-label={studioConnected ? t('misc.syncedToStudio') : t('misc.notSyncedToStudio')}
              className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                studioConnected
                  ? 'bg-primary shadow-[0_0_6px_var(--primary)]'
                  : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]',
              )}
            />
            <span className="text-[10px] text-muted-foreground truncate">
              {appVersion ? `v${appVersion}` : 'v?'}
            </span>
          </div>
        </div>
      </div>

      <nav
        aria-label="Main navigation"
        className="flex-1 flex flex-col gap-1 min-h-0 overflow-y-auto scrollbar-hide"
      >
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              data-tutorial-target={`${id}-tab`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onTabChange(id)}
              className={cn(
                'w-full text-left h-10 transition-colors duration-150 flex items-center gap-3 rounded-md relative outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer pl-[15px] pr-3',
                isActive
                  ? 'bg-bg-elevated text-text-primary border border-border-strong shadow-subtle'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/70 border border-transparent',
              )}
            >
              <Icon size={18} className={cn('shrink-0', !isActive && 'opacity-60')} />
              <span
                className={cn(
                  'text-[13px] tracking-wide truncate',
                  isActive ? 'font-semibold' : 'font-medium',
                )}
              >
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="pt-2 mt-auto space-y-1">
        <ProfilePopup />
      </div>
    </aside>
  );
}
