// ISM-V2-PROVENANCE: 4A015410C780F798DC48F992
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

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

// ISM-V2-PROVENANCE-END: 4A015410C780F798DC48F992
