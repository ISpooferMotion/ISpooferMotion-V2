import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { SlidersHorizontal } from 'lucide-react';

export default function RoutingSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <Card className="py-0 flex flex-col bg-bg-surface/50 border border-border-subtle shadow-sm overflow-hidden">
      <CardHeader className="px-4 py-3 border-b border-border-subtle/40 bg-bg-base/20">
        <CardTitle className="text-sm font-bold flex items-center gap-2 text-text-primary">
          <SlidersHorizontal size={15} className="text-primary" />
          {t('config.routingLimits')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3.5 space-y-2.5">
        <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <Label className="text-xs font-semibold text-text-primary">
            {t('settings.proxyUrl')}
          </Label>
          <Input
            placeholder={t('settings.proxyUrlPlaceholder')}
            value={config.advanced.proxyUrl}
            onChange={(e) => updateConfig('advanced', 'proxyUrl', e.target.value)}
            className="h-8 text-xs bg-bg-base"
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-xs font-semibold text-text-primary">
              {t('settings.concurrentSpoofing')}
            </Label>
            <p className="text-[11px] text-text-secondary leading-snug">
              {t('settings.concurrentSpoofingDescription')}
            </p>
          </div>
          <Switch
            checked={config.advanced.concurrentSpoofing}
            onCheckedChange={(value) => updateConfig('advanced', 'concurrentSpoofing', value)}
          />
        </div>

        {config.advanced.concurrentSpoofing && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
            <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
              <Label className="text-xs font-semibold text-text-primary">
                {t('settings.maxConcurrency')}
              </Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={config.advanced.maxConcurrency.toString()}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  const safe = Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 100;
                  updateConfig('advanced', 'maxConcurrency', safe);
                }}
                className="h-8 text-xs bg-bg-base"
              />
            </div>

            <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
              <Label className="text-xs font-semibold text-text-primary">
                {t('settings.maxDownloadConcurrency')}
              </Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={config.advanced.maxDownloadConcurrency.toString()}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  const safe = Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 10;
                  updateConfig('advanced', 'maxDownloadConcurrency', safe);
                }}
                className="h-8 text-xs bg-bg-base"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
