// ISM-V2-PROVENANCE: 1174CE2C459CD28BDD4A1C2D
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { createContext, useContext } from 'react';

import { type ScanStatus, useStudioConnection } from '../hooks/useStudioConnection';

type StudioConnectionContextValue = {
  studioConnected: boolean;
  scanStatus: ScanStatus | null;
  studioPlaceId: string;
  studioPlaceName: string | null;
};

const StudioConnectionContext = createContext<StudioConnectionContextValue | undefined>(undefined);

export const StudioConnectionProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const connection = useStudioConnection();

  return (
    <StudioConnectionContext.Provider value={connection}>
      {children}
    </StudioConnectionContext.Provider>
  );
};

export const useStudioConnectionState = () => {
  const context = useContext(StudioConnectionContext);
  if (context === undefined) {
    throw new Error('useStudioConnectionState must be used within a StudioConnectionProvider');
  }
  return context;
};

// ISM-V2-PROVENANCE-END: 1174CE2C459CD28BDD4A1C2D
