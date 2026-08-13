import { ask } from '@tauri-apps/plugin-dialog';
import { TriangleAlert } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

export default function DangerCard() {
  const { t } = useLanguage();
  const { resetConfig } = useConfig();

  return (
    <Card className="bg-red-500/5 border border-red-500/20 shadow-sm overflow-hidden">
      <CardHeader className="pb-3 border-b border-red-500/10 bg-red-500/5">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-red-500">
          <TriangleAlert size={16} className="text-red-500" />
          {t('settings.dangerZone')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-red-500/20 bg-red-500/5">
          <div className="space-y-0.5 min-w-0 flex-1">
            <span className="text-sm font-semibold text-foreground block">Reset Settings</span>
            <p className="text-xs text-muted-foreground">
              Reset all settings to their default values. This cannot be undone.
            </p>
          </div>
          <Button
            variant="destructive"
            className="h-8 px-3 font-bold text-xs shadow-sm bg-red-500 hover:bg-red-600 text-white shrink-0 rounded-md"
            onClick={async () => {
              const confirmed = await ask(
                'Reset all settings to their default values? This cannot be undone.',
                {
                  title: 'Reset Settings',
                  kind: 'warning',
                },
              );
              if (confirmed) {
                resetConfig();
                window.ismLog?.('success', t('settings.resetSuccess'));
              }
            }}
          >
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
