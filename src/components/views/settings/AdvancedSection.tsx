import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { isMemoryInjectionSupported } from '../../../utils/tauriRuntime';
import { SettingCard, SettingSwitchRow } from './SettingComponents';

export default function AdvancedSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();
  const [memoryInjectionSupported, setMemoryInjectionSupported] = useState(false);

  useEffect(() => {
    isMemoryInjectionSupported().then(setMemoryInjectionSupported);
  }, []);

  return (
    <SettingCard
      icon={Wrench}
      title={t('settings.advanced') || 'Advanced Options'}
      description="Experimental injection options and system automation triggers."
    >
      <SettingSwitchRow
        label={t('settings.clipboardMonitoring') || 'Auto-Detect Clipboard Asset IDs'}
        description={
          t('settings.clipboardMonitoringDesc') ||
          'Automatically add copied Roblox asset URLs from clipboard into the queue.'
        }
        checked={config.advanced.clipboardMonitoring}
        onCheckedChange={(v) => updateConfig('advanced', 'clipboardMonitoring', v)}
      />

      <SettingSwitchRow
        label={t('settings.memoryInjection') || 'Process Memory Injection'}
        description={
          memoryInjectionSupported
            ? t('settings.memoryInjectionDescSupported') ||
              'Direct high-speed process memory bridge for Studio replacements.'
            : t('settings.memoryInjectionDescUnsupported') ||
              'Process memory injection is unavailable on this OS/architecture.'
        }
        disabled={!memoryInjectionSupported}
        checked={memoryInjectionSupported ? config.advanced.memoryInjectionEnabled : false}
        onCheckedChange={(v) => {
          if (!memoryInjectionSupported) return;
          updateConfig('advanced', 'memoryInjectionEnabled', v);
        }}
      />
    </SettingCard>
  );
}
