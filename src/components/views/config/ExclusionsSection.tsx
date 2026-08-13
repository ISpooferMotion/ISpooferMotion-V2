import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { ShieldAlert } from 'lucide-react';

export default function ExclusionsSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <Card className="py-0 flex flex-col bg-bg-surface/50 border border-border-subtle shadow-sm overflow-hidden">
      <CardHeader className="px-4 py-3 border-b border-border-subtle/40 bg-bg-base/20">
        <CardTitle className="text-sm font-bold flex items-center gap-2 text-text-primary">
          <ShieldAlert size={15} className="text-primary" />
          {t('config.exclusions')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3.5 space-y-2.5">
        <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <Label className="text-xs font-semibold text-text-primary">
            {t('settings.excludedUsers')}
          </Label>
          <Input
            placeholder={t('settings.excludedUsersPlaceholder')}
            value={config.advanced.excludedUserIds}
            onChange={(e) => updateConfig('advanced', 'excludedUserIds', e.target.value)}
            className="h-8 text-xs bg-bg-base"
          />
        </div>

        <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <Label className="text-xs font-semibold text-text-primary">
            {t('settings.excludedGroups')}
          </Label>
          <Input
            placeholder={t('settings.excludedGroupsPlaceholder')}
            value={config.advanced.excludedGroupIds}
            onChange={(e) => updateConfig('advanced', 'excludedGroupIds', e.target.value)}
            className="h-8 text-xs bg-bg-base"
          />
        </div>
      </CardContent>
    </Card>
  );
}
