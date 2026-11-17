import { invoke } from '@tauri-apps/api/core';
import { HelpCircle, Laptop } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { logIsm } from '../../../utils/robloxProfiles';
import { Button } from '../../ui/button';
import { SettingCard, SettingSwitchRow } from './SettingComponents';

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
    updateConfig('ui', 'tutorialCompleted', false);
    window.dispatchEvent(new Event('ism-start-tutorial'));
  };

  return (
    <SettingCard
      icon={Laptop}
      title={t('settings.behavior') || 'App Behavior'}
      description="Configure application tray behavior, desktop notifications, and tutorials."
    >
      <SettingSwitchRow
        label={t('settings.desktopNotifications') || 'Desktop Notifications'}
        description="Show system notifications when downloads or spoof jobs finish."
        checked={config.general.desktopNotifications}
        onCheckedChange={handleDesktopNotificationsChange}
      />

      <SettingSwitchRow
        label={t('settings.hideToTray') || 'Minimize to System Tray'}
        description={
          t('settings.hideToTrayDesc') ||
          'Keep the application running in the background when closing the window.'
        }
        checked={config.general.hideToTrayOnClose}
        onCheckedChange={(v) => updateConfig('general', 'hideToTrayOnClose', v)}
      />

      <SettingSwitchRow
        label={t('settings.telemetry') || 'Anonymous Diagnostics'}
        description={
          t('settings.telemetryDesc') || 'Send anonymous error logs to help improve compatibility.'
        }
        checked={config.general.telemetryEnabled}
        onCheckedChange={(v) => updateConfig('general', 'telemetryEnabled', v)}
      />

      <div className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-bg-elevated/20 transition-colors">
        <div className="space-y-0.5 min-w-0 flex-1">
          <span className="text-xs font-semibold text-text-primary block">
            Interactive Onboarding Tutorial
          </span>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Walk through adding an account, setting up API keys, loading places, and running your
            first spoof.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleShowTutorial}
          className="h-8 px-3 text-xs flex items-center gap-1.5 shrink-0"
        >
          <HelpCircle size={13} />
          <span>Launch Tutorial</span>
        </Button>
      </div>
    </SettingCard>
  );
}
