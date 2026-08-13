import { ArrowDownUp, Settings2, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'framer-motion';

import { itemVariants, pageVariants } from '../../utils/animations';
import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../utils/cn';
import AdvancedSection from './settings/AdvancedSection';
import ExclusionsSection from './config/ExclusionsSection';
import RoutingSection from './config/RoutingSection';
import UploadSection from './config/UploadSection';

/**
 * Advanced options as a full main-view tab (moved out of the Titlebar's gear
 * modal so the topbar stays decluttered). Same sections as the old modal —
 * asset processing, routing, exclusions, and advanced features — laid out as
 * a page with a left sub-tab nav.
 */
export default function AdvancedView() {
  const { t } = useLanguage();
  const [tab, setTab] = useState('upload');

  const tabs = [
    { id: 'upload', label: t('config.assetProcessing'), icon: <ArrowDownUp size={15} /> },
    { id: 'routing', label: t('config.routingLimits'), icon: <SlidersHorizontal size={15} /> },
    { id: 'exclusions', label: t('config.exclusions'), icon: <ShieldAlert size={15} /> },
    { id: 'features', label: t('settings.advanced'), icon: <Settings2 size={15} /> },
  ];

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      className="w-full h-full overflow-hidden"
    >
      <div className="w-full h-full p-4 lg:p-6 flex">
        <div className="w-48 shrink-0 flex flex-col gap-1 pr-4 border-r border-border-subtle">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-all',
                tab === tb.id
                  ? 'bg-primary/10 text-primary'
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

        <motion.div
          key={tab}
          variants={itemVariants}
          initial="hidden"
          animate="show"
          className="flex-1 overflow-y-auto pl-6"
        >
          {tab === 'upload' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-4">
                <ArrowDownUp size={18} className="text-primary" />
                <h3 className="text-base font-semibold text-text-primary">
                  {t('config.assetProcessing')}
                </h3>
              </div>
              <UploadSection />
            </div>
          )}
          {tab === 'routing' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-4">
                <SlidersHorizontal size={18} className="text-primary" />
                <h3 className="text-base font-semibold text-text-primary">
                  {t('config.routingLimits')}
                </h3>
              </div>
              <RoutingSection />
            </div>
          )}
          {tab === 'exclusions' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-4">
                <ShieldAlert size={18} className="text-primary" />
                <h3 className="text-base font-semibold text-text-primary">
                  {t('config.exclusions')}
                </h3>
              </div>
              <ExclusionsSection />
            </div>
          )}
          {tab === 'features' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-4">
                <Settings2 size={18} className="text-primary" />
                <h3 className="text-base font-semibold text-text-primary">
                  {t('settings.advanced')}
                </h3>
              </div>
              <AdvancedSection />
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}
