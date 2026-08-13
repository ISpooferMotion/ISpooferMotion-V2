import { invoke } from '@tauri-apps/api/core';
import { Sliders, HelpCircle } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { logIsm } from '../../../utils/robloxProfiles';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';

export default function BehaviorCard() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  const handleDesktopNotificationsChange = async (enabled: boolean) => {
    updateConfig('general', 'desktopNotifications', enabled);
    if (!enabled) {
      logIsm('info', t('misc.notificationsDisabledTitle'));
      return;
    }

    try {
      const shown = await invoke<boolean>('show_notification', {
        options: {
          title: 'ISpooferMotion',
          body: t('misc.desktopNotificationsEnabled'),
        },
      });
      logIsm(
        shown ? 'success' : 'warn',
        shown ? t('misc.notificationsEnabledTitle') : t('misc.notificationsFailed'),
      );
    } catch (err) {
      logIsm('error', `Desktop notifications failed: ${String(err)}`);
    }
  };

  const handleShowTutorial = () => {
    // Re-runs the first-launch tutorial.
    updateConfig('ui', 'tutorialCompleted', false);
    window.dispatchEvent(new Event('ism-start-tutorial'));
  };

  return (
    <Card className="bg-bg-surface/50 border border-border-subtle shadow-sm overflow-hidden">
      <CardHeader className="pb-3 border-b border-border-subtle/40 bg-bg-base/20">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-text-primary">
          <Sliders size={16} className="text-primary" />
          {t('settings.behavior')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-sm font-semibold text-text-primary">
              {t('settings.desktopNotifications')}
            </Label>
          </div>
          <Switch
            checked={config.general.desktopNotifications}
            onCheckedChange={handleDesktopNotificationsChange}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-sm font-semibold text-text-primary">
              {t('settings.hideToTray')}
            </Label>
            <p className="text-xs text-text-secondary leading-relaxed">
              {t('settings.hideToTrayDesc')}
            </p>
          </div>
          <Switch
            checked={config.general.hideToTrayOnClose}
            onCheckedChange={(v) => updateConfig('general', 'hideToTrayOnClose', v)}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-sm font-semibold text-text-primary">
              {t('settings.telemetry')}
            </Label>
            <p className="text-xs text-text-secondary leading-relaxed">
              {t('settings.telemetryDesc')}
            </p>
          </div>
          <Switch
            checked={config.general.telemetryEnabled}
            onCheckedChange={(v) => updateConfig('general', 'telemetryEnabled', v)}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-sm font-semibold text-text-primary">First-launch tutorial</Label>
            <p className="text-xs text-text-secondary leading-relaxed">
              Walk through adding an account, the API key, loading a place, and running your first
              spoof.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShowTutorial}
            className="flex items-center gap-1.5"
          >
            <HelpCircle size={14} />
            Show tutorial
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
