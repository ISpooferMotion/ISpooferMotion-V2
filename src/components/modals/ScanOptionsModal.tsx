import { ScanSearch } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { useLanguage } from '../../contexts/LanguageContext';
import type { ScanOptions } from '../../utils/studioScan';

const ASSET_TYPES = [
  { key: 'sounds', label: 'Sounds' },
  { key: 'animations', label: 'Animations' },
  { key: 'images', label: 'Images' },
  { key: 'meshes', label: 'Meshes' },
  { key: 'scripts', label: 'Scripts' },
] as const;

const SCRIPT_MODES = [
  {
    key: 'assetIds',
    label: 'Asset IDs (fast)',
    desc: 'Extract IDs locally — much faster on large games',
  },
  {
    key: 'fullSource',
    label: 'Full source (accurate)',
    desc: 'Send whole source for AST parsing — finds more refs',
  },
  { key: 'off', label: 'Off (skip scripts)', desc: 'Skip script scanning entirely' },
] as const;

/**
 * Pre-scan options popup. Lets the user pick what to scan for and how
 * scripts are handled before kicking off the Studio scan. Defaults to
 * all types + asset-IDs mode (the fast path for large games).
 */
export default function ScanOptionsModal({
  open,
  onOpenChange,
  onScanStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScanStart: (options: ScanOptions) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [scanTypes, setScanTypes] = useState<Set<string>>(new Set(ASSET_TYPES.map((a) => a.key)));
  const [scriptMode, setScriptMode] = useState<string>('assetIds');
  const [scanning, setScanning] = useState(false);

  const toggleType = (key: string) => {
    setScanTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleStart = async () => {
    setScanning(true);
    try {
      const types = ASSET_TYPES.map((a) => a.key).filter((k) => scanTypes.has(k));
      await onScanStart({ scanTypes: types, scriptScanMode: scriptMode });
      onOpenChange(false);
    } finally {
      setScanning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch size={18} className="text-primary" />
            {t('spoof.scanStudio')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Asset type checkboxes */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">What to scan for</p>
            <div className="grid grid-cols-2 gap-2">
              {ASSET_TYPES.map((type) => (
                <label
                  key={type.key}
                  className="flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 hover:bg-accent/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={scanTypes.has(type.key)}
                    onChange={() => toggleType(type.key)}
                    className="accent-primary"
                  />
                  <span className="text-sm">{type.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Script scan mode */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">Script scan mode</p>
            <div className="space-y-2">
              {SCRIPT_MODES.map((mode) => (
                <label
                  key={mode.key}
                  className={`flex items-start gap-2 cursor-pointer rounded-md border px-3 py-2 transition-colors ${
                    scriptMode === mode.key
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-accent/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="scriptMode"
                    checked={scriptMode === mode.key}
                    onChange={() => setScriptMode(mode.key)}
                    className="accent-primary mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium">{mode.label}</span>
                    <p className="text-xs text-muted-foreground">{mode.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Start button */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={scanning}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleStart}
              disabled={scanning || scanTypes.size === 0}
              className="min-w-32"
            >
              <ScanSearch size={16} className="mr-2" />
              {scanning ? t('spoof.scanning') : 'Start Scan'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
