// ISM-V2-PROVENANCE: 0174094961317FD5D122DCA7
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { ScanSearch } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';

export function SpoofingCustomAssets() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <div className="flex flex-col gap-2 flex-1">
      <div className="flex items-center gap-2">
        <ScanSearch size={16} className="text-primary" />
        <Label className="text-xs font-bold uppercase tracking-widest text-text-muted">
          {t('spoof.additionalIdsToSpoof')}
        </Label>
      </div>
      <Textarea
        value={config.spoofing.extraAssetIds}
        onChange={(e) => updateConfig('spoofing', 'extraAssetIds', e.target.value)}
        placeholder={t('spoof.additionalIdsPlaceholder')}
        className="flex-1 w-full min-h-16 text-sm resize-none bg-bg-surface"
      />
    </div>
  );
}

// ISM-V2-PROVENANCE-END: 0174094961317FD5D122DCA7
