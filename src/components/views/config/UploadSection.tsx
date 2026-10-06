// ISM-V2-PROVENANCE: 9CE88C968BD9918F65E79F73
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { ArrowDownUp } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { SettingCard, SettingSwitchRow } from '../settings/SettingComponents';

export default function UploadSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <SettingCard
      icon={ArrowDownUp}
      title={t('config.assetProcessing') || 'Asset Processing & Spoofing'}
      description="Configure asset ownership checks, metadata preservation, and archive recovery."
    >
      <SettingSwitchRow
        label={t('settings.skipOwned') || 'Skip Owned Assets'}
        description={
          t('settings.skipOwnedDescription') ||
          'Skip assets already present in target inventory to save upload quotas.'
        }
        checked={config.advanced.skipOwned}
        onCheckedChange={(value) => updateConfig('advanced', 'skipOwned', value)}
      />

      <SettingSwitchRow
        label={t('settings.preserveMetadata') || 'Preserve Original Names & Details'}
        description={
          t('config.preserveMetadataDesc') ||
          'Keep original asset titles and descriptions instead of placeholder names.'
        }
        checked={config.spoofing.preserveMetadata}
        onCheckedChange={(value) => updateConfig('spoofing', 'preserveMetadata', value)}
      />

      <SettingSwitchRow
        label={t('settings.archiveRecovery') || 'Roblox Archive Recovery'}
        description={
          t('config.archiveRecoveryDesc') ||
          'Attempt to recover deleted or archived asset payloads from historical endpoints.'
        }
        checked={config.advanced.enableArchiveRecovery}
        onCheckedChange={(value) => updateConfig('advanced', 'enableArchiveRecovery', value)}
      />
    </SettingCard>
  );
}

// ISM-V2-PROVENANCE-END: 9CE88C968BD9918F65E79F73
