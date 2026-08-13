import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { ArrowDownUp } from 'lucide-react';

export default function UploadSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <Card className="py-0 flex flex-col bg-bg-surface/50 border border-border-subtle shadow-sm overflow-hidden">
      <CardHeader className="px-4 py-3 border-b border-border-subtle/40 bg-bg-base/20">
        <CardTitle className="text-sm font-bold flex items-center gap-2 text-text-primary">
          <ArrowDownUp size={15} className="text-primary" />
          {t('config.assetProcessing')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3.5 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-xs font-semibold text-text-primary">
              {t('settings.skipOwned')}
            </Label>
            <p className="text-[11px] text-text-secondary leading-snug">
              {t('settings.skipOwnedDescription')}
            </p>
          </div>
          <Switch
            checked={config.advanced.skipOwned}
            onCheckedChange={(value) => updateConfig('advanced', 'skipOwned', value)}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-xs font-semibold text-text-primary">
              {t('settings.preserveMetadata')}
            </Label>
            <p className="text-[11px] text-text-secondary leading-snug">
              {t('config.preserveMetadataDesc')}
            </p>
          </div>
          <Switch
            checked={config.spoofing.preserveMetadata}
            onCheckedChange={(value) => updateConfig('spoofing', 'preserveMetadata', value)}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-xs font-semibold text-text-primary">
              {t('settings.archiveRecovery')}
            </Label>
            <p className="text-[11px] text-text-secondary leading-snug">
              {t('config.archiveRecoveryDesc')}
            </p>
          </div>
          <Switch
            checked={config.advanced.enableArchiveRecovery}
            onCheckedChange={(value) => updateConfig('advanced', 'enableArchiveRecovery', value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
