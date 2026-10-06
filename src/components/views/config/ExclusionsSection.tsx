// ISM-V2-PROVENANCE: A82E57D4A31924BC71580B29
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { ShieldAlert } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { SettingCard, SettingFieldRow } from '../settings/SettingComponents';

export default function ExclusionsSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <SettingCard
      icon={ShieldAlert}
      title={t('config.exclusions') || 'Exclusions'}
      description="Prevent specific Roblox users or groups from being spoofed or modified."
    >
      <SettingFieldRow
        label={t('settings.excludedUsers') || 'Excluded Users'}
        description={
          t('settings.excludedUsersPlaceholder') || 'Comma-separated user IDs (e.g. 12345, 67890)'
        }
        value={config.advanced.excludedUserIds}
        onChange={(val) => updateConfig('advanced', 'excludedUserIds', val)}
        placeholder="12345, 67890"
      />

      <SettingFieldRow
        label={t('settings.excludedGroups') || 'Excluded Groups'}
        description={
          t('settings.excludedGroupsPlaceholder') || 'Comma-separated group IDs (e.g. 54321, 98765)'
        }
        value={config.advanced.excludedGroupIds}
        onChange={(val) => updateConfig('advanced', 'excludedGroupIds', val)}
        placeholder="54321, 98765"
      />
    </SettingCard>
  );
}

// ISM-V2-PROVENANCE-END: A82E57D4A31924BC71580B29
