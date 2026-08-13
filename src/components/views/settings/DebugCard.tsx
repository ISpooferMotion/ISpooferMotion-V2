import { invoke } from '@tauri-apps/api/core';
import { Bug, FolderOpen, Trash2 } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { logIsm } from '../../../utils/robloxProfiles';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';

export default function DebugCard() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  async function handleClearCache(successMessage = 'Cache cleared.') {
    try {
      await Promise.all([
        invoke('clear_asset_cache'),
        invoke('clear_plugin_cache'),
        invoke('clear_app_cache'),
      ]);

      Object.keys(localStorage).forEach((key) => {
        if (
          key.startsWith('ISpooferMotion_DetectedGroups_') ||
          key === 'ISpooferMotion_AssetExplorerState'
        ) {
          localStorage.removeItem(key);
        }
      });
      sessionStorage.clear();
      logIsm('success', successMessage);
    } catch (err) {
      logIsm('error', `Failed to clear cache: ${String(err)}`);
    }
  }

  const handleCacheChange = async (enabled: boolean) => {
    updateConfig('debug', 'enableCache', enabled);
    if (enabled) {
      logIsm('success', 'Cache enabled.');
      return;
    }
    await handleClearCache('Cache disabled. Cached runtime data cleared.');
  };

  return (
    <Card className="bg-bg-surface/50 border border-border-subtle shadow-sm overflow-hidden">
      <CardHeader className="pb-3 border-b border-border-subtle/40 bg-bg-base/20">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-text-primary">
          <Bug size={16} className="text-primary" />
          {t('debug.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-sm font-semibold text-text-primary">
              {t('settings.debugMode')}
            </Label>
          </div>
          <Switch
            checked={config.debug.debugMode}
            onCheckedChange={(v) => updateConfig('debug', 'debugMode', v)}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label className="text-sm font-semibold text-text-primary">
              {t('settings.enableCache')}
            </Label>
          </div>
          <Switch checked={config.debug.enableCache} onCheckedChange={handleCacheChange} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <Button
            variant="outline"
            className="h-10 text-xs font-semibold"
            onClick={() => void handleClearCache()}
          >
            <Trash2 size={15} className="mr-2 text-muted-foreground" />
            {t('settings.clearCache')}
          </Button>

          <Button
            variant="outline"
            className="h-10 text-xs font-semibold"
            onClick={() =>
              invoke('open_logs_folder').catch((err) =>
                logIsm('error', `Failed to open logs folder: ${String(err)}`),
              )
            }
          >
            <FolderOpen size={15} className="mr-2 text-muted-foreground" />
            {t('settings.openLogsFolder')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
