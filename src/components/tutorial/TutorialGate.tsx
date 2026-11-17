import { useCallback, useEffect, useMemo, useState } from 'react';

import { useConfig } from '../../contexts/ConfigContext';
import { useSpooferStore } from '../../stores/spooferStore';
import { loadCachedUsers } from '../../utils/robloxProfiles';
import { Tutorial, TutorialStep } from './Tutorial';

const hasAnyAccount = (config: ReturnType<typeof useConfig>['config']): boolean => {
  if (config.accounts.length > 0) return true;
  if (config.spoofing.selectedUser !== 'none') return true;
  if (config.spoofing.cookie.trim().length >= 50) return true;
  try {
    const cached = loadCachedUsers();
    if (cached.length > 0) return true;
  } catch {}
  return false;
};

export const TutorialGate = () => {
  const { config, updateConfig } = useConfig();
  const [open, setOpen] = useState(false);
  const rootInstances = useSpooferStore((s) => s.rootInstances);
  const selectedAssetIds = useSpooferStore((s) => s.selectedAssetIds);

  useEffect(() => {
    if (!config.ui.tutorialCompleted) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [config.ui.tutorialCompleted]);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('ism-start-tutorial', handler);
    return () => window.removeEventListener('ism-start-tutorial', handler);
  }, []);

  const handleComplete = useCallback(() => {
    setOpen(false);
    updateConfig('ui', 'tutorialCompleted', true);

    updateConfig('ui', 'activeTab', 'spoofing');
  }, [updateConfig]);

  const steps: TutorialStep[] = useMemo(
    () => [
      {
        id: 'welcome',
        title: 'Welcome to ISpooferMotion',
        body: "Lets set you up in 5 quick steps. You'll add a Roblox account, paste an Open Cloud API key, scan Studio, then select assets and run the spoofer.",
      },
      {
        id: 'accounts',
        title: 'Add a Roblox account',
        body: 'Open the Accounts tab and add a Roblox profile. You can paste a .ROBLOSECURITY cookie or auto-detect the one from Studio. This account is the downloader.',
        isComplete: () => hasAnyAccount(config),
        waitingHint: 'Add an account or auto-detect one from Studio to continue.',
      },
      {
        id: 'api-key',
        title: 'Open Cloud API key',
        body: 'Switch to Settings, open Credentials, and paste an Open Cloud API key with Assets read/write permission. This is the uploader — without it, spoofing can only download, not upload.',
        isComplete: () => config.spoofing.apiKey.trim().length >= 20,
        waitingHint: 'Paste your Open Cloud API key in Settings > Credentials.',
      },
      {
        id: 'scan-studio',
        title: 'Scan Studio',
        body: 'Open a Roblox Studio place with the ISpooferMotion plugin loaded, then click Scan Studio. Scanning is the primary way to populate the asset list — it pulls every animation, sound, image, mesh, and script reference from the running game.',
        isComplete: () => {
          if (rootInstances.length === 0) return false;
          const hasAssets = (list: typeof rootInstances): boolean => {
            for (const n of list) {
              if (n.assets.length > 0) return true;
              if (hasAssets(n.children)) return true;
            }
            return false;
          };
          return hasAssets(rootInstances);
        },
        waitingHint: 'Click Scan Studio or Open File to populate the asset list.',
      },
      {
        id: 'select',
        title: 'Select a few assets',
        body: 'Tick the checkboxes next to any assets in the tree. You can select individual rows or expand a folder and tick the whole tree.',
        isComplete: () => selectedAssetIds.size > 0,
        waitingHint: 'Tick at least one asset to continue.',
      },
      {
        id: 'run',
        title: 'Run the spoofer',
        body: 'Press Run Spoofer. Watch the progress bar overlay and the toast when its done. You can re-run this tutorial from Settings.',
      },
    ],
    [
      config.accounts.length,
      config.spoofing.selectedUser,
      config.spoofing.apiKey,
      rootInstances,
      selectedAssetIds.size,
    ],
  );

  if (!open) return null;

  const beforeStep = (nextId: string | null) => {
    const targetTab: Record<string, 'accounts' | 'settings' | 'spoofing'> = {
      accounts: 'accounts',
      'api-key': 'settings',
      'scan-studio': 'spoofing',
      select: 'spoofing',
      run: 'spoofing',
    };
    const tab = nextId ? targetTab[nextId] : undefined;
    if (!tab) return;
    updateConfig('ui', 'activeTab', tab);
  };

  return (
    <Tutorial
      steps={steps}
      onComplete={handleComplete}
      onSkip={handleComplete}
      beforeStep={beforeStep}
    />
  );
};
