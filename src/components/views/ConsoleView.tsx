import { useConfig } from '../../contexts/ConfigContext';
import DebugConsole from './DebugConsole';

export default function ConsoleView() {
  const { updateConfig } = useConfig();
  return (
    <div className="w-full h-full relative overflow-hidden">
      <DebugConsole isOpen fill onClose={() => updateConfig('ui', 'activeTab', 'spoofing')} />
    </div>
  );
}
