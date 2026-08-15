import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  History,
  ScanLine,
  Settings,
  Terminal,
  Users,
} from 'lucide-react';

import IsmLogoDark from '../../assets/ism_logo_dark.webp';
import IsmLogoLight from '../../assets/ism_logo_light.webp';
import { useLanguage } from '../../contexts/LanguageContext';
import { useStudioConnectionState } from '../../contexts/StudioConnectionContext';
import { cn } from '../../utils/cn';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import ProfilePopup from './ProfilePopup';

/**
 * The primary navigation sidebar for the application.
 *
 * Discord-style: nav tabs on top, the active Roblox profile (account switcher)
 * pinned to the bottom. Controls routing between the Spoofing workspace,
 * Activity, Accounts, Settings, Advanced options, and the Console.
 */
export default function Sidebar({
  activeTab,
  onTabChange,
}: {
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  const { t } = useLanguage();
  const { studioConnected } = useStudioConnectionState();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    invoke<string>('get_app_version')
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion(''));
  }, []);

  const tabs = [
    { id: 'spoofing', label: t('nav.spoofing'), icon: <ScanLine size={18} /> },
    { id: 'activity', label: t('nav.activity'), icon: <History size={18} /> },
    { id: 'accounts', label: t('nav.accounts'), icon: <Users size={18} /> },
    { id: 'settings', label: t('nav.settings'), icon: <Settings size={18} /> },
    { id: 'console', label: t('nav.console'), icon: <Terminal size={18} /> },
  ];

  return (
    <TooltipProvider delay={200}>
      <motion.div
        animate={{ width: isCollapsed ? 64 : 220 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="h-full bg-bg-surface/30 border-r border-border-subtle p-2 flex flex-col shrink-0 relative z-20"
      >
        {/* Header: logo + version + sync dot, with a collapse toggle.
         * Collapses to just the icon. */}
        <div
          className={cn(
            'flex items-center gap-2 mb-2 pl-[12px] pr-3 h-10 shrink-0 justify-between',
          )}
        >
          <div
            className={cn('flex items-center gap-2 min-w-0', isCollapsed && 'cursor-pointer')}
            onClick={() => {
              if (isCollapsed) {
                setIsCollapsed(false);
                setLogoHovered(false);
              }
            }}
            onMouseEnter={() => isCollapsed && setLogoHovered(true)}
            onMouseLeave={() => setLogoHovered(false)}
            title={isCollapsed ? 'Expand' : undefined}
          >
            <div className="w-7 h-7 flex items-center justify-center shrink-0 relative">
              <AnimatePresence mode="wait" initial={false}>
                {isCollapsed && logoHovered ? (
                  <motion.div
                    key="chevron"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: 'easeInOut' }}
                  >
                    <ChevronRight size={18} className="text-primary" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="logo"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: 'easeInOut' }}
                    className="w-full h-full flex items-center justify-center"
                  >
                    {isTauriRuntime() ? (
                      <>
                        <img
                          src={IsmLogoLight}
                          className="w-full h-full object-contain block dark:hidden select-none pointer-events-none"
                          alt="Logo"
                        />
                        <img
                          src={IsmLogoDark}
                          className="w-full h-full object-contain hidden dark:block select-none pointer-events-none"
                          alt="Logo"
                        />
                      </>
                    ) : (
                      <img
                        src="/ispoofermotion-logo-dark.png"
                        className="w-full h-full object-contain"
                        alt="Logo"
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {!isCollapsed && (
              <div className="flex flex-col leading-tight min-w-0">
                <span className="text-[12px] font-semibold tracking-tight text-foreground truncate">
                  ISpooferMotion
                </span>
                <div className="flex items-center gap-1">
                  <span
                    title={studioConnected ? t('misc.syncedToStudio') : t('misc.notSyncedToStudio')}
                    className={
                      'w-1.5 h-1.5 rounded-full shrink-0 ' +
                      (studioConnected
                        ? 'bg-primary shadow-[0_0_6px_var(--primary)]'
                        : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]')
                    }
                  />
                  <span className="text-[10px] text-muted-foreground truncate">
                    {appVersion ? `v${appVersion}` : 'v?'}
                  </span>
                </div>
              </div>
            )}
          </div>
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-muted-foreground hover:bg-bg-elevated/70 shrink-0"
              onClick={() => setIsCollapsed(true)}
              aria-label="Collapse"
            >
              <ChevronLeft size={16} />
            </Button>
          )}
        </div>

        {/* Nav tabs */}
        <div className="flex-1 flex flex-col gap-1 min-h-0 overflow-y-auto scrollbar-hide">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;

            const buttonContent = (
              <motion.div
                role="button"
                tabIndex={0}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
                whileTap={{ scale: 0.96 }}
                onClick={() => onTabChange(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onTabChange(tab.id);
                  }
                }}
                className={cn(
                  'w-full text-left h-10 transition-colors duration-150 flex items-center gap-3 rounded-md relative outline-none cursor-pointer [-webkit-tap-highlight-color:transparent] pl-[15px] pr-3',
                  isActive
                    ? 'bg-bg-elevated text-text-primary border border-border-strong shadow-subtle'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/70 border border-transparent',
                )}
              >
                <div
                  className={cn(
                    'transition-opacity shrink-0',
                    isActive ? 'opacity-100' : 'opacity-60',
                  )}
                >
                  {tab.icon}
                </div>
                {!isCollapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className={cn(
                      'text-[13px] tracking-wide whitespace-nowrap overflow-hidden',
                      isActive ? 'font-semibold' : 'font-medium',
                    )}
                  >
                    {tab.label}
                  </motion.span>
                )}
              </motion.div>
            );

            return isCollapsed ? (
              <Tooltip key={tab.id}>
                <TooltipTrigger>{buttonContent}</TooltipTrigger>
                <TooltipContent side="right" className="font-semibold text-xs py-1 px-2">
                  {tab.label}
                </TooltipContent>
              </Tooltip>
            ) : (
              <div key={tab.id} data-tutorial-target={`${tab.id}-tab`}>
                {buttonContent}
              </div>
            );
          })}
        </div>

        {/* Bottom: account profile (Discord-style) */}
        <div className="pt-2 mt-auto">
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger>
                <ProfilePopup collapsed />
              </TooltipTrigger>
              <TooltipContent side="right" className="font-semibold text-xs py-1 px-2">
                {t('nav.accounts')}
              </TooltipContent>
            </Tooltip>
          ) : (
            <ProfilePopup />
          )}
        </div>
      </motion.div>
    </TooltipProvider>
  );
}
