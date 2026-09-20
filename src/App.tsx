import { lazy, Suspense } from 'react';

import Sidebar from './components/layout/Sidebar';
import Titlebar from './components/layout/Titlebar';
import { PortDiagnosticBanner } from './components/shared/PortDiagnosticBanner';
import { RobloxStatusBanner } from './components/shared/RobloxStatusBanner';
import { TutorialGate } from './components/tutorial/TutorialGate';
import { useConfig } from './contexts/ConfigContext';
import { useLanguage } from './contexts/LanguageContext';
import { useAppInitialization } from './hooks/useAppInitialization';

const ActivityView = lazy(() => import('./components/views/ActivityView'));
const AssetExplorer = lazy(() => import('./components/views/AssetExplorer'));
const ConsoleView = lazy(() => import('./components/views/ConsoleView'));
const DebugConsole = lazy(() => import('./components/views/DebugConsole'));

const SettingsView = lazy(() => import('./components/views/SettingsView'));
const SpoofingView = lazy(() => import('./components/views/SpoofingView'));
const AccountsView = lazy(() => import('./components/views/accounts/AccountsView'));

export default function App() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();
  const activeTab = config.ui.activeTab;
  const isExplorerOpen = config.ui.assetExplorerOpen;

  const { maintenance, isRobloxApiDown } = useAppInitialization();

  const setActiveTab = (tabId: string) => updateConfig('ui', 'activeTab', tabId);
  const setIsExplorerOpen = (isOpen: boolean) => updateConfig('ui', 'assetExplorerOpen', isOpen);

  if (maintenance.mode) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-background text-foreground p-8 text-center space-y-4 font-sans antialiased">
        <div className="text-yellow-500 mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{t('misc.maintenanceBreak')}</h1>
        <p className="text-muted-foreground max-w-md">
          {maintenance.message || t('misc.maintenanceDesc')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden text-foreground relative font-sans selection:bg-primary/30 antialiased bg-background">
      {}
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="flex flex-col flex-1 min-w-0 h-full relative z-10">
        <Titlebar />

        <div className="flex-1 relative overflow-hidden bg-transparent flex flex-col">
          <RobloxStatusBanner isVisible={isRobloxApiDown} />
          <PortDiagnosticBanner />

          <div className="flex-1 relative overflow-hidden">
            <Suspense fallback={<div className="w-full h-full bg-background/50" />}>
              {activeTab === 'spoofing' && (
                <div key="spoofing" className="w-full h-full flex">
                  <AssetExplorer
                    isOpen={isExplorerOpen}
                    setIsOpen={setIsExplorerOpen}
                    mode="main"
                  />
                  {}
                  <div className="hidden" aria-hidden>
                    <SpoofingView />
                  </div>
                </div>
              )}
              {activeTab === 'activity' && <ActivityView key="activity" />}
              {activeTab === 'accounts' && <AccountsView key="accounts" />}
              {activeTab === 'settings' && <SettingsView key="settings" />}
              {activeTab === 'console' && <ConsoleView key="console" />}
            </Suspense>
          </div>

          <Suspense fallback={null}>
            <DebugConsole
              isOpen={config.debug?.debugMode || false}
              onClose={() => updateConfig('debug', 'debugMode', false)}
            />
          </Suspense>
        </div>

        <div
          className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none z-60 opacity-[0.03] mix-blend-screen"
          style={{
            background: 'linear-gradient(to top, var(--primary), transparent)',
          }}
        />
      </div>

      <TutorialGate />
    </div>
  );
}
