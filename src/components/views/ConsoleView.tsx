import { useConfig } from '../../contexts/ConfigContext';
import DebugConsole from './DebugConsole';

/**
 * Console as a full main-view tab (moved out of the Titlebar's terminal toggle
 * so the topbar stays decluttered). Renders the existing DebugConsole component
 * filling the main area; closing it returns to the Spoofer tab.
 */
export default function ConsoleView() {
  const { updateConfig } = useConfig();
  return (
    <div className="w-full h-full relative overflow-hidden">
      <DebugConsole isOpen fill onClose={() => updateConfig('ui', 'activeTab', 'spoofing')} />
    </div>
  );
}
