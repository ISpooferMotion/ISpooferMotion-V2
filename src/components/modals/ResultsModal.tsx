import { save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { motion, type Variants } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  ListChecks,
  RotateCcw,
  SkipForward,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { useLanguage } from '../../contexts/LanguageContext';
import { useSpooferStore } from '../../stores/spooferStore';
import { appendSpoofingLog } from '../../utils/spoofingLogs';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * Renders the final spoofing results and any error logs after a job completes.
 *
 * Provides quick actions to copy the mapping table or directly inject the spoofed IDs
 * back into a raw `.rbxlx` file if the user didn't use the Studio plugin.
 *
 * Also breaks down every skipped / failed asset with its reason and offers a
 * "Retry only these" button so users don't have to re-run the whole job to
 * catch the ones that didn't land.
 */
export default function ResultsModal({
  isOpen,
  onClose,
  onRetryFailed,
}: {
  isOpen: boolean;
  onClose: () => void;
  onRetryFailed?: () => void;
}) {
  const { t } = useLanguage();
  const lastReplacements = useSpooferStore((s) => s.lastReplacements);
  const assetMetadataMap = useSpooferStore((s) => s.assetMetadataMap);
  const loadedFilePath = useSpooferStore((s) => s.loadedFilePath);
  const setSpoofingLogs = useSpooferStore((s) => s.setSpoofingLogs);
  const lastAssetResults = useSpooferStore((s) => s.lastAssetResults);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const replacementsArray = Object.entries(lastReplacements);

  // Split the raw asset-result list into three visually-distinct buckets so
  // users can see exactly which assets skipped vs failed and why. `skipped`
  // covers dedupe hits and filter matches (kept the existing spoofed id).
  // `failed` covers assets we actually couldn't spoof this run.
  const { skipped, failed } = useMemo(() => {
    const skipped: typeof lastAssetResults = [];
    const failed: typeof lastAssetResults = [];
    for (const r of lastAssetResults || []) {
      if (r.success === false) failed.push(r);
      else if (r.skipped) skipped.push(r);
    }
    return { skipped, failed };
  }, [lastAssetResults]);
  const hasIssues = skipped.length > 0 || failed.length > 0;

  const handleCopyAll = () => {
    const text = replacementsArray.map(([oldId, newId]) => `${oldId} -> ${newId}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveRbxlx = async () => {
    if (!loadedFilePath || !loadedFilePath.endsWith('.rbxlx')) return;
    setIsSaving(true);
    try {
      const savePath = await save({
        filters: [{ name: 'Roblox Place XML', extensions: ['rbxlx'] }],
        defaultPath: loadedFilePath.replace('.rbxlx', '_Spoofed.rbxlx'),
      });
      if (!savePath) {
        setIsSaving(false);
        return; // user cancelled
      }

      setSpoofingLogs((prev) =>
        appendSpoofingLog(prev, `\n[INFO] Saving spoofed place file to ${savePath}...\n`),
      );
      let content = await readTextFile(loadedFilePath);
      let count = 0;
      for (const [oldId, newId] of Object.entries(lastReplacements)) {
        // Avoid replacing substring matches (e.g., 123 inside 12345).
        const regex = new RegExp(`(?<!\\d)${oldId}(?!\\d)`, 'g');
        const matchCount = (content.match(regex) || []).length;
        if (matchCount > 0) {
          content = content.replace(regex, newId);
          count += matchCount;
        }
      }
      await writeTextFile(savePath, content);
      setSpoofingLogs((prev) =>
        appendSpoofingLog(
          prev,
          `[SUCCESS] Saved spoofed file! Replaced ${count} ID occurrences.\n`,
        ),
      );
      onClose(); // auto close modal so they can see logs
    } catch (err) {
      setSpoofingLogs((prev) =>
        appendSpoofingLog(prev, `[ERROR] Failed to save .rbxlx: ${String(err)}\n`),
      );
    }
    setIsSaving(false);
  };

  const stagger: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.05 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 10 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 400, damping: 28 },
    },
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col bg-background border-border text-foreground">
        <DialogHeader className="flex flex-col gap-1 pb-4 border-b border-border shrink-0">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <ListChecks className="text-primary" /> {t('results.title')}
          </DialogTitle>
          <p className="text-sm font-medium text-muted-foreground">
            {t('results.assetsSpoofed').replace('{count}', replacementsArray.length.toString())}
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4 overflow-y-auto flex-1 min-h-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">
              {t('misc.assetIdMappings')}
            </span>
            {replacementsArray.length > 0 && (
              <Button size="sm" variant="outline" onClick={handleCopyAll} className="gap-2">
                {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                {copied ? t('common.copied') : t('results.copyAll')}
              </Button>
            )}
          </div>

          {replacementsArray.length > 0 ? (
            <motion.div
              variants={stagger}
              initial="hidden"
              animate="show"
              className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-2"
            >
              {replacementsArray.slice(0, 100).map(([oldId, newId]) => {
                const meta = assetMetadataMap[oldId];
                return (
                  <motion.div
                    key={oldId}
                    variants={item}
                    className="flex items-center justify-between p-3 rounded-md bg-muted border border-border gap-4"
                  >
                    <div className="flex flex-col flex-1 min-w-0">
                      <span
                        className="text-xs text-muted-foreground font-medium truncate"
                        title={meta?.name}
                      >
                        {meta ? `${meta.type.toUpperCase()} • ${meta.name}` : t('misc.originalId')}
                      </span>
                      <span className="text-sm font-mono font-semibold text-destructive">
                        {oldId}
                      </span>
                    </div>
                    <ArrowRight size={16} className="text-muted-foreground opacity-50 shrink-0" />
                    <div className="flex flex-col text-right flex-1 min-w-0">
                      <span className="text-xs text-muted-foreground font-medium truncate">
                        {t('misc.spoofedId')}
                      </span>
                      <span className="text-sm font-mono font-semibold text-success">{newId}</span>
                    </div>
                  </motion.div>
                );
              })}
              {replacementsArray.length > 100 && (
                <div className="p-3 text-center text-xs font-medium text-muted-foreground bg-muted border border-border rounded-md">
                  {t('results.moreReplacements').replace(
                    '{count}',
                    (replacementsArray.length - 100).toString(),
                  )}
                </div>
              )}
            </motion.div>
          ) : (
            <div className="p-8 text-center text-muted-foreground bg-muted rounded-lg border border-border border-dashed">
              {t('results.noReplacements')}
            </div>
          )}

          {hasIssues && (
            <div className="flex flex-col gap-3 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  Skipped &amp; failed ({skipped.length + failed.length})
                </span>
                {failed.length > 0 && onRetryFailed && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onRetryFailed();
                      onClose();
                    }}
                    className="gap-2"
                  >
                    <RotateCcw size={14} />
                    Retry {failed.length} failed
                  </Button>
                )}
              </div>
              <motion.div
                variants={stagger}
                initial="hidden"
                animate="show"
                className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-2"
              >
                {[...failed, ...skipped].slice(0, 200).map((r) => {
                  const isFailed = r.success === false;
                  const id = String(r.id ?? '');
                  const name = r.name || `Asset ${id}`;
                  const typeLabel = (r.type || r.assetType || '').toUpperCase();
                  const reason = r.errorReason || (isFailed ? 'Unknown failure' : 'Skipped');
                  return (
                    <motion.div
                      key={`${isFailed ? 'f' : 's'}-${id}-${r.stage ?? 'x'}`}
                      variants={item}
                      className={`flex flex-col gap-1 p-3 rounded-md border ${
                        isFailed
                          ? 'bg-destructive/10 border-destructive/30'
                          : 'bg-muted border-border'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isFailed ? (
                          <AlertTriangle size={14} className="text-destructive shrink-0" />
                        ) : (
                          <SkipForward size={14} className="text-muted-foreground shrink-0" />
                        )}
                        <span className="text-xs text-muted-foreground font-medium truncate">
                          {typeLabel ? `${typeLabel} • ` : ''}
                          {name}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground/70 ml-auto shrink-0">
                          {id}
                        </span>
                      </div>
                      <span
                        className={`text-xs ${
                          isFailed ? 'text-destructive/90' : 'text-muted-foreground'
                        }`}
                      >
                        {reason}
                      </span>
                    </motion.div>
                  );
                })}
                {failed.length + skipped.length > 200 && (
                  <div className="p-3 text-center text-xs font-medium text-muted-foreground bg-muted border border-border rounded-md">
                    …and {failed.length + skipped.length - 200} more (see the logs pane for the full
                    list).
                  </div>
                )}
              </motion.div>
            </div>
          )}

          <div className="rounded-md border border-primary/20 bg-primary/10 px-4 py-3 mt-2">
            <p className="text-sm font-medium text-foreground">{t('results.autoReplacedDesc')}</p>
          </div>
        </div>

        {loadedFilePath && loadedFilePath.endsWith('.rbxlx') && replacementsArray.length > 0 && (
          <div className="flex justify-end gap-3 pt-2">
            <Button onClick={handleSaveRbxlx} disabled={isSaving}>
              Save Spoofed .rbxlx
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
