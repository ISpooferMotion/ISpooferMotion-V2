import { motion } from 'framer-motion';
import { Ban, Play, RotateCcw, ScanSearch } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { commands } from '../../../types/bindings';
import { useLanguage } from '../../../contexts/LanguageContext';
import { Button } from '../../ui/button';
import { useSpooferStore } from '../../../stores/spooferStore';

export interface SpoofingControlsProps {
  failedAssetIds: string[];
  failedReplacements: Set<string>;
  activeSpooferJobId: string | null;
  isSpoofing: boolean;
  isReplacing: boolean;
  isScanningStudio: boolean;
  isJobPaused: boolean;
  replaceError: boolean;
  itemVariants: import('framer-motion').Variants;
  handleRetryFailedAssets: () => void;

  handleScanStudio: () => void;
  setIsJobPaused: (val: boolean) => void;
  handleRetryReplacement: () => void;
  handleRunSpoofer: () => void;
  SpoofProgressText: React.FC;
  SpoofProgressOverlay: React.FC;
}

export function SpoofingControls({
  failedAssetIds,
  failedReplacements,
  activeSpooferJobId,
  isSpoofing,
  isReplacing,
  isScanningStudio,
  isJobPaused,
  replaceError,
  itemVariants,
  handleRetryFailedAssets,

  handleScanStudio,
  setIsJobPaused,
  handleRetryReplacement,
  handleRunSpoofer,
  SpoofProgressText,
  SpoofProgressOverlay,
}: SpoofingControlsProps) {
  const { t } = useLanguage();

  const totalFailed = failedAssetIds.length + failedReplacements.size;

  return (
    <motion.div
      variants={itemVariants}
      className="shrink-0 flex flex-wrap items-center justify-end gap-4 pt-4 mt-auto"
    >
      {totalFailed > 0 && !activeSpooferJobId && (
        <Button
          variant="outline"
          className="h-11 px-6 font-semibold grow md:grow-0 text-yellow-500 border-yellow-500/20 hover:bg-yellow-500/10"
          onClick={() => void handleRetryFailedAssets()}
          disabled={isSpoofing || isReplacing || isScanningStudio}
        >
          <RotateCcw size={16} className="mr-2" />
          {t('spoof.retryFailed').replace('{count}', totalFailed.toString())} ({totalFailed})
        </Button>
      )}

      {!activeSpooferJobId && (
        <Button
          variant="outline"
          className={cn('h-11 px-6 font-semibold transition-all duration-300 grow md:grow-0')}
          onClick={() => void handleScanStudio()}
          disabled={isSpoofing || isReplacing || isScanningStudio}
        >
          <ScanSearch size={16} className="mr-2" />
          {isScanningStudio ? t('spoof.scanning') : t('spoof.scanStudio')}
        </Button>
      )}

      {activeSpooferJobId && (
        <Button
          variant="outline"
          className="h-11 px-6 font-semibold grow md:grow-0"
          onClick={async () => {
            const store = useSpooferStore.getState();
            if (isJobPaused) {
              await commands.spooferResume(activeSpooferJobId);
              setIsJobPaused(false);
              const pauseDuration = store.jobPauseStartTime
                ? Date.now() - store.jobPauseStartTime
                : 0;
              if (store.spoofStartTime) {
                store.setSpoofStartTime(store.spoofStartTime + pauseDuration);
              }
              store.setJobPauseStartTime(null);
            } else {
              await commands.spooferPause(activeSpooferJobId);
              setIsJobPaused(true);
              store.setJobPauseStartTime(Date.now());
            }
          }}
        >
          {isJobPaused ? (
            <Play size={16} className="mr-2" />
          ) : (
            <Ban size={16} className="mr-2 rotate-90" />
          )}
          {isJobPaused ? t('spoof.resume') : t('spoof.pause')}
        </Button>
      )}

      <Button
        className={cn(
          'h-11 px-8 font-bold tracking-wide overflow-hidden relative min-w-50 grow md:grow-0',
          replaceError
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-primary text-primary-foreground',
        )}
        onClick={() => {
          if (replaceError) {
            void handleRetryReplacement();
          } else {
            void handleRunSpoofer();
          }
        }}
        disabled={isSpoofing || isReplacing || isScanningStudio}
      >
        <div className="relative z-10 flex items-center justify-center gap-2 w-full h-full">
          {!isSpoofing && !isReplacing && !replaceError && <Play size={16} fill="currentColor" />}
          <span>
            {isReplacing ? (
              <SpoofProgressText />
            ) : replaceError ? (
              t('spoof.retryReplacing')
            ) : isSpoofing ? (
              <SpoofProgressText />
            ) : (
              t('spoof.runSpoofer')
            )}
          </span>
        </div>
        {(isSpoofing || isReplacing) && <SpoofProgressOverlay />}
      </Button>
    </motion.div>
  );
}
