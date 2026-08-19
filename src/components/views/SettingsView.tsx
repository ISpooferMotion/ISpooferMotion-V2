import {
  ArrowDownUp,
  Bug,
  Gauge,
  KeyRound,
  Laptop,
  Palette,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

import { pageVariants } from '../../utils/animations';
import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../utils/cn';
import AdvancedSection from './settings/AdvancedSection';
import AppearanceCard from './settings/AppearanceCard';
import BehaviorCard from './settings/BehaviorCard';
import CredentialsCard from './settings/CredentialsCard';
import DangerCard from './settings/DangerCard';
import DebugCard from './settings/DebugCard';
import PermissionsCard from './settings/PermissionsCard';
import ExclusionsSection from './config/ExclusionsSection';
import RoutingSection from './config/RoutingSection';
import UploadSection from './config/UploadSection';

/**
 * Settings — unified scrollspy viewport rendering standardized setting cards.
 * Scrolling through the page highlights the active left tab, and clicking a tab
 * smoothly scrolls directly to that section.
 */
export default function SettingsView() {
  const { t } = useLanguage();
  const [tab, setTab] = useState('credentials');
  const isManualScroll = useRef(false);

  const tabs = [
    { id: 'credentials', label: t('spoof.options') || 'Credentials', icon: <KeyRound size={15} /> },
    { id: 'permissions', label: 'Permissions', icon: <ShieldCheck size={15} /> },
    { id: 'appearance', label: t('settings.appearance'), icon: <Palette size={15} /> },
    { id: 'behavior', label: t('settings.behavior'), icon: <Laptop size={15} /> },
    { id: 'upload', label: t('config.assetProcessing'), icon: <ArrowDownUp size={15} /> },
    { id: 'routing', label: t('config.routingLimits'), icon: <Gauge size={15} /> },
    { id: 'exclusions', label: t('config.exclusions'), icon: <ShieldAlert size={15} /> },
    { id: 'features', label: t('settings.advanced'), icon: <Wrench size={15} /> },
    { id: 'debug', label: t('debug.title'), icon: <Bug size={15} /> },
    { id: 'danger', label: t('settings.dangerZone'), icon: <TriangleAlert size={15} /> },
  ];

  const handleTabClick = (id: string) => {
    setTab(id);
    isManualScroll.current = true;
    const el = document.getElementById(`section-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setTimeout(() => {
      isManualScroll.current = false;
    }, 600);
  };

  useEffect(() => {
    const scrollContainer = document.getElementById('settings-scroll-container');
    if (!scrollContainer) return;

    const handleScroll = () => {
      if (isManualScroll.current) return;
      const isAtBottom =
        scrollContainer.scrollTop + scrollContainer.clientHeight >=
        scrollContainer.scrollHeight - 40;
      if (isAtBottom) {
        setTab('danger');
      }
    };

    const observerOptions = {
      root: scrollContainer,
      rootMargin: '-5% 0px -40% 0px',
      threshold: 0,
    };

    const observerCallback = (entries: IntersectionObserverEntry[]) => {
      if (isManualScroll.current) return;

      const isAtBottom =
        scrollContainer.scrollTop + scrollContainer.clientHeight >=
        scrollContainer.scrollHeight - 40;
      if (isAtBottom) {
        setTab('danger');
        return;
      }

      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = entry.target.id.replace('section-', '');
          setTab(id);
          break;
        }
      }
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);
    tabs.forEach((tb) => {
      const el = document.getElementById(`section-${tb.id}`);
      if (el) observer.observe(el);
    });

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [t]);

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      className="w-full h-full overflow-hidden"
    >
      <div className="w-full h-full p-4 lg:p-6 flex">
        {/* Left Sub-Tab Nav */}
        <div className="w-52 shrink-0 flex flex-col gap-1 pr-4 border-r border-border-subtle overflow-y-auto scrollbar-hide">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => handleTabClick(tb.id)}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-all',
                tab === tb.id
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary',
              )}
            >
              <span className={cn(tab === tb.id ? 'text-primary' : 'text-text-muted')}>
                {tb.icon}
              </span>
              {tb.label}
            </button>
          ))}
        </div>

        {/* Right Scrollspy Viewport */}
        <div
          id="settings-scroll-container"
          className="flex-1 overflow-y-auto pl-6 flex flex-col gap-6 pb-32 scroll-smooth"
        >
          <div id="section-credentials" className="scroll-mt-4">
            <CredentialsCard />
          </div>

          <div id="section-permissions" className="scroll-mt-4">
            <PermissionsCard />
          </div>

          <div id="section-appearance" className="scroll-mt-4">
            <AppearanceCard />
          </div>

          <div id="section-behavior" className="scroll-mt-4">
            <BehaviorCard />
          </div>

          <div id="section-upload" className="scroll-mt-4">
            <UploadSection />
          </div>

          <div id="section-routing" className="scroll-mt-4">
            <RoutingSection />
          </div>

          <div id="section-exclusions" className="scroll-mt-4">
            <ExclusionsSection />
          </div>

          <div id="section-features" className="scroll-mt-4">
            <AdvancedSection />
          </div>

          <div id="section-debug" className="scroll-mt-4">
            <DebugCard />
          </div>

          <div id="section-danger" className="scroll-mt-4">
            <DangerCard />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
