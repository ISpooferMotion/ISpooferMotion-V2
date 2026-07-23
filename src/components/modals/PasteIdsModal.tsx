import { ClipboardPaste } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { logIsm } from '../../utils/robloxProfiles';
import { queueStudioReplacements } from '../../utils/studioBridge';

/**
 * Manual ID replacement modal (V1 parity feature).
 *
 * Lets the user paste a list of `oldId -> newId` mappings and push them
 * straight to the Studio plugin without running a full spoofer job.
 * Useful when the user already has replacement IDs from a previous run,
 * from an external tool, or a friend who spoofed the assets for them.
 *
 * Accepts loose formats — each non-empty line is parsed on any of these
 * separators: `->`, `=>`, `=`, `,`, `\t`, or whitespace runs.
 */
export default function PasteIdsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rawInput, setRawInput] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  const parseInput = (text: string): { pairs: Record<string, string>; badLines: number } => {
    const pairs: Record<string, string> = {};
    let badLines = 0;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;

      const parts = line
        .split(/->|=>|[=,\t\s]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length < 2) {
        badLines++;
        continue;
      }
      const [oldId, newId] = parts;
      // Roblox asset IDs are all-digit strings; skip anything that isn't.
      if (!/^\d+$/.test(oldId) || !/^\d+$/.test(newId)) {
        badLines++;
        continue;
      }
      pairs[oldId] = newId;
    }
    return { pairs, badLines };
  };

  const { pairs, badLines } = parseInput(rawInput);
  const pairCount = Object.keys(pairs).length;

  const handleApply = async () => {
    if (pairCount === 0) return;
    setIsApplying(true);
    try {
      await queueStudioReplacements(pairs);
      logIsm(
        'success',
        `Sent ${pairCount} replacement${pairCount === 1 ? '' : 's'} to the Studio plugin.`,
        true,
      );
      setRawInput('');
      onOpenChange(false);
    } catch (e: unknown) {
      logIsm(
        'error',
        `Could not send replacements to Studio: ${e instanceof Error ? e.message : String(e)}`,
        true,
      );
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardPaste size={18} />
            Paste replacement IDs
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-secondary leading-relaxed">
            Paste a list of ID pairs, one per line. Any of these separators work:{' '}
            <code className="text-[11px] bg-bg-muted px-1 rounded">-{'>'}</code>{' '}
            <code className="text-[11px] bg-bg-muted px-1 rounded">=</code>{' '}
            <code className="text-[11px] bg-bg-muted px-1 rounded">,</code> or spaces. Lines
            starting with <code className="text-[11px] bg-bg-muted px-1 rounded">#</code> or{' '}
            <code className="text-[11px] bg-bg-muted px-1 rounded">//</code> are ignored.
          </p>
          <textarea
            value={rawInput}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRawInput(e.target.value)}
            placeholder={'12345 67890\n11111 -> 22222\n33333, 44444'}
            className="w-full h-48 p-2 rounded-md font-mono text-[12px] bg-bg-surface border border-border-strong text-text-primary focus:border-primary focus:outline-none resize-none"
            spellCheck={false}
          />
          <div className="flex items-center justify-between text-xs">
            <div className="text-text-secondary">
              {pairCount > 0 && (
                <span className="text-primary font-medium">
                  {pairCount} valid pair{pairCount === 1 ? '' : 's'}
                </span>
              )}
              {pairCount > 0 && badLines > 0 && <span className="text-text-muted"> · </span>}
              {badLines > 0 && (
                <span className="text-yellow-500">
                  {badLines} line{badLines === 1 ? '' : 's'} skipped (bad format)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleApply()}
                disabled={pairCount === 0 || isApplying}
              >
                {isApplying ? 'Sending...' : `Send to Studio`}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
