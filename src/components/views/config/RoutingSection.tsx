import { Gauge } from 'lucide-react';
import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import {
  SettingCard,
  SettingFieldRow,
  SettingSliderItem,
  SettingSwitchRow,
} from '../settings/SettingComponents';

export default function RoutingSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <SettingCard
      icon={Gauge}
      title={t('config.routingLimits') || 'Routing and Limits'}
      description="Configure network proxies and concurrency levels for downloading and uploading assets."
    >
      <SettingFieldRow
        label={t('settings.proxyUrl') || 'HTTP / SOCKS5 Proxy URL'}
        description={
          t('settings.proxyUrlPlaceholder') ||
          'e.g. http://127.0.0.1:8080 or socks5://user:pass@host:1080'
        }
        value={config.advanced.proxyUrl}
        onChange={(val) => updateConfig('advanced', 'proxyUrl', val)}
        placeholder="http://127.0.0.1:8080"
      />

      <SettingSwitchRow
        label={t('settings.concurrentSpoofing') || 'Concurrent Processing'}
        description={
          t('settings.concurrentSpoofingDescription') ||
          'Spoof and download multiple assets simultaneously to speed up processing.'
        }
        checked={config.advanced.concurrentSpoofing}
        onCheckedChange={(val) => updateConfig('advanced', 'concurrentSpoofing', val)}
      />

      {config.advanced.concurrentSpoofing && (
        <>
          <SettingSliderItem
            label={t('settings.maxConcurrency') || 'Max Concurrency'}
            description="Parallel thread ceiling for asset spoofing pipeline."
            value={config.advanced.maxConcurrency}
            onChange={(val) => updateConfig('advanced', 'maxConcurrency', val)}
            min={1}
            max={100}
            ticks={[1, 50, 100]}
          />

          <SettingSliderItem
            label={t('settings.maxDownloadConcurrency') || 'Max Download Concurrency'}
            description="Parallel streams for downloading Roblox asset payloads."
            value={config.advanced.maxDownloadConcurrency}
            onChange={(val) => updateConfig('advanced', 'maxDownloadConcurrency', val)}
            min={1}
            max={100}
            ticks={[1, 50, 100]}
          />

          <SettingSliderItem
            label="Discovery Concurrency"
            description="Parallel threads for place ID discovery lookups."
            value={config.advanced.discoveryConcurrency ?? 30}
            onChange={(val) => updateConfig('advanced', 'discoveryConcurrency', val)}
            min={1}
            max={50}
            ticks={[1, 25, 50]}
          />

          <SettingSliderItem
            label="Upload Operation Poll Interval"
            description="How frequently to check Roblox Open Cloud for upload completion (lower = faster, 200–400ms recommended)."
            value={config.advanced.operationPollIntervalMs ?? 250}
            onChange={(val) => updateConfig('advanced', 'operationPollIntervalMs', val)}
            min={100}
            max={1000}
            ticks={[100, 250, 500, 1000]}
          />

          <SettingSliderItem
            label="Batch Size & Speed"
            description={
              (config.advanced.batchSize ?? 50) <= 25
                ? 'Ultra Smooth — lower CPU load & smoother viewport rendering during replacement.'
                : (config.advanced.batchSize ?? 50) <= 80
                  ? 'Balanced — standard replacement throughput and stability.'
                  : (config.advanced.batchSize ?? 50) <= 180
                    ? 'Fast — accelerated replacement batches with shorter yields.'
                    : 'Max Speed — highest replacement speed.'
            }
            value={config.advanced.batchSize ?? 50}
            onChange={(val) => {
              updateConfig('advanced', 'batchSize', val);
              import('@tauri-apps/api/core').then(({ invoke }) => {
                invoke('set_plugin_batch_size', { batchSize: val }).catch(console.error);
              });
            }}
            min={10}
            max={500}
            step={5}
            ticks={[10, 50, 100, 180, 250, 350, 425, 500]}
          />
        </>
      )}
    </SettingCard>
  );
}
