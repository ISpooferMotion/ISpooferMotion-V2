import { Copy, ListChecks, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { useLanguage } from '../../../contexts/LanguageContext';
import { useConfigStore } from '../../../stores/configStore';
import { useSpooferStore } from '../../../stores/spooferStore';
import { cn } from '../../../utils/cn';

interface ExecutionLogsProps {
  logs: string[];
  setLogs: (logs: string[]) => void;
  lastReplacements: Record<string, string>;
  setResultsModalOpen: (open: boolean) => void;
}

export default function ExecutionLogs({
  logs,
  setLogs,
  lastReplacements,
  setResultsModalOpen,
}: ExecutionLogsProps) {
  const { t } = useLanguage();
  const outputRef = useRef<HTMLDivElement>(null);

  const { config, accountSecrets } = useConfigStore();

  const downloaderName =
    config.accounts.find((a) => {
      const secrets = accountSecrets[a.id];
      return secrets?.cookie === config.spoofing.cookie;
    })?.name || t('accounts.anonymousDownloader');

  const uploaderName =
    config.accounts.find((a) => {
      const secrets = accountSecrets[a.id];
      return secrets?.apiKey === config.spoofing.apiKey;
    })?.name || t('accounts.anonymousUploader');

  const { spoofCurrentCount, spoofTotalCount, spoofStartTime, isSpoofing } = useSpooferStore(
    useShallow((s) => ({
      spoofCurrentCount: s.spoofCurrentCount,
      spoofTotalCount: s.spoofTotalCount,
      spoofStartTime: s.spoofStartTime,
      isSpoofing: s.isSpoofing,
    })),
  );

  const [eta, setEta] = useState<string | null>(null);
  // Rolling window of (timestamp, completedCount) samples used for the ETA.
  // Cumulative-average from job start produced wildly inflated ETAs (users
  // reported 900+ minute estimates) because early samples are dominated by
  // one-time setup: batch metadata, place-ID discovery on cold cache, and
  // rate-limit warmup. A short trailing window reacts to actual throughput.
  const samplesRef = useRef<Array<{ t: number; count: number }>>([]);

  useEffect(() => {
    if (!isSpoofing || !spoofStartTime || spoofTotalCount === 0) {
      setEta(null);
      samplesRef.current = [];
      return;
    }

    const ETA_WINDOW_MS = 30_000;
    const MIN_SAMPLES_FOR_ETA = 3;
    const MIN_ITEMS_FOR_ETA = 5;

    const interval = setInterval(() => {
      const store = useSpooferStore.getState();
      const now =
        store.isJobPaused && store.jobPauseStartTime ? store.jobPauseStartTime : Date.now();
      const remainingItems = spoofTotalCount - spoofCurrentCount;

      if (remainingItems <= 0) {
        setEta(null);
        return;
      }

      // Add a fresh sample and drop anything older than the window.
      samplesRef.current.push({ t: now, count: spoofCurrentCount });
      samplesRef.current = samplesRef.current.filter((s) => now - s.t <= ETA_WINDOW_MS);

      const samples = samplesRef.current;
      // Hold off on displaying an ETA until we have enough signal — otherwise
      // the number swings wildly during the first few seconds of a job.
      if (samples.length < MIN_SAMPLES_FOR_ETA || spoofCurrentCount < MIN_ITEMS_FOR_ETA) {
        setEta(null);
        return;
      }

      const oldest = samples[0];
      const itemsInWindow = spoofCurrentCount - oldest.count;
      const msInWindow = now - oldest.t;
      if (itemsInWindow <= 0 || msInWindow <= 0) {
        setEta(null);
        return;
      }

      const msPerItem = msInWindow / itemsInWindow;
      const remainingMs = msPerItem * remainingItems;
      const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));

      if (remainingSec < 60) {
        setEta(`~${remainingSec}s remaining`);
      } else if (remainingSec < 3600) {
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;
        setEta(`~${mins}m ${secs}s remaining`);
      } else {
        const hours = Math.floor(remainingSec / 3600);
        const mins = Math.floor((remainingSec % 3600) / 60);
        setEta(`~${hours}h ${mins}m remaining`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isSpoofing, spoofStartTime, spoofCurrentCount, spoofTotalCount]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-sm font-semibold text-text-primary flex items-center gap-2">
          {t('spoof.output')}
          {isSpoofing && spoofTotalCount > 0 && (
            <span className="text-xs font-medium text-text-secondary opacity-80">
              ({spoofCurrentCount}/{spoofTotalCount}
              {eta ? ` - ${eta}` : ''})
            </span>
          )}
          <div className="ml-2 flex items-center gap-2 text-[11px] text-text-secondary bg-bg-muted px-2 py-0.5 rounded border border-border-subtle">
            <span title={t('accounts.downloader')}>↓ {downloaderName}</span>
            <span className="opacity-40">|</span>
            <span title={t('accounts.uploader')}>↑ {uploaderName}</span>
          </div>
        </span>
        <div className="flex items-center gap-3">
          {Object.keys(lastReplacements).length > 0 && (
            <button
              onClick={() => setResultsModalOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              <ListChecks size={14} /> {t('spoof.viewResults')}
            </button>
          )}
          {logs && logs.length > 0 && (
            <>
              <button
                onClick={() => void navigator.clipboard.writeText(logs.join(''))}
                className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-primary transition-colors"
              >
                <Copy size={14} /> Copy Logs
              </button>
              <button
                onClick={() => setLogs([])}
                className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-danger transition-colors"
              >
                <Trash2 size={14} /> {t('spoof.clearLogs')}
              </button>
            </>
          )}
        </div>
      </div>
      <div
        ref={outputRef}
        className="w-full flex-1 min-h-30 p-2 rounded-md font-mono text-[13px] font-medium text-text-primary overflow-y-auto whitespace-pre-wrap wrap-break-word"
      >
        {logs && logs.length > 0 ? (
          <div className="flex flex-col gap-1">
            {logs.map((line, idx) => {
              if (!line) return null;
              const isSuccess = line.includes('[SUCCESS]');
              const isWarn = line.includes('[WARN]');
              const isError = line.includes('[ERROR]');

              const containerClass = cn(
                'py-1.5 px-3 rounded',
                isError
                  ? 'text-red-500 bg-red-500/5'
                  : isWarn
                    ? 'text-yellow-500 bg-yellow-500/5'
                    : isSuccess
                      ? 'text-green-500 bg-green-500/5'
                      : 'text-text-primary',
              );

              return (
                <div key={idx} className={containerClass}>
                  {line}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="opacity-50">{t('spoof.outputPlaceholder')}</span>
        )}
      </div>
    </div>
  );
}
