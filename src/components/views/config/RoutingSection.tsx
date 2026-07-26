import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';

export default function RoutingSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>{t('settings.proxyUrl')}</Label>
        <Input
          placeholder={t('settings.proxyUrlPlaceholder')}
          value={config.advanced.proxyUrl}
          onChange={(e) => updateConfig('advanced', 'proxyUrl', e.target.value)}
        />
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border border-border-subtle bg-bg-base p-3">
        <div className="space-y-0.5">
          <Label className="text-base">{t('settings.concurrentSpoofing')}</Label>
          <div className="text-sm text-text-secondary">
            {t('settings.concurrentSpoofingDescription')}
          </div>
        </div>
        <Switch
          checked={config.advanced.concurrentSpoofing}
          onCheckedChange={(value) => updateConfig('advanced', 'concurrentSpoofing', value)}
        />
      </div>

      {config.advanced.concurrentSpoofing && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>{t('settings.maxConcurrency')}</Label>
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
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('settings.maxDownloadConcurrency')}</Label>
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
            />
          </div>
        </>
      )}
    </div>
  );
}
