import { useEffect, useState } from 'react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { isMemoryInjectionSupported } from '../../../utils/tauriRuntime';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Settings2 } from 'lucide-react';

export default function AdvancedSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();
  const [memoryInjectionSupported, setMemoryInjectionSupported] = useState(false);

  useEffect(() => {
    isMemoryInjectionSupported().then(setMemoryInjectionSupported);
  }, []);

  return (
    <Card className="py-0 flex flex-col bg-bg-surface/50 border border-border-subtle shadow-sm overflow-hidden">
      <CardHeader className="px-4 py-3 border-b border-border-subtle/40 bg-bg-base/20">
        <CardTitle className="text-sm font-bold flex items-center gap-2 text-text-primary">
          <Settings2 size={15} className="text-primary" />
          {t('settings.advanced')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3.5 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-xs font-semibold text-text-primary">
              {t('settings.clipboardMonitoring')}
            </Label>
            <p className="text-[11px] text-text-secondary leading-snug">
              {t('settings.clipboardMonitoringDesc')}
            </p>
          </div>
          <Switch
            checked={config.advanced.clipboardMonitoring}
            onCheckedChange={(v) => updateConfig('advanced', 'clipboardMonitoring', v)}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-xs font-semibold text-text-primary">
              {t('settings.memoryInjection')}
            </Label>
            <p className="text-[11px] text-text-secondary leading-snug">
              {memoryInjectionSupported
                ? t('settings.memoryInjectionDescSupported')
                : t('settings.memoryInjectionDescUnsupported')}
            </p>
          </div>
          <Switch
            disabled={!memoryInjectionSupported}
            checked={memoryInjectionSupported ? config.advanced.memoryInjectionEnabled : false}
            onCheckedChange={(v) => {
              if (!memoryInjectionSupported) return;
              updateConfig('advanced', 'memoryInjectionEnabled', v);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
