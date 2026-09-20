import { ScanSearch } from 'lucide-react';
import { useState } from 'react';

import { useLanguage } from '../../contexts/LanguageContext';
import type { ScanOptions } from '../../utils/studioScan';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

const ASSET_TYPES = [
  { key: 'sounds', label: 'Sounds' },
  { key: 'animations', label: 'Animations' },
  { key: 'images', label: 'Images' },
  { key: 'meshes', label: 'Meshes' },
  { key: 'scripts', label: 'Scripts' },
] as const;

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
      await onScanStart({ scanTypes: types });
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
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">Asset types to scan</p>
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
