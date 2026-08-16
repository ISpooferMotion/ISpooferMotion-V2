import { createContext, useContext } from 'react';

import { type ScanStatus, useStudioConnection } from '../hooks/useStudioConnection';

type StudioConnectionContextValue = {
  studioConnected: boolean;
  scanStatus: ScanStatus | null;
  studioPlaceId: string;
  studioPlaceName: string | null;
};

const StudioConnectionContext = createContext<StudioConnectionContextValue | undefined>(undefined);

/**
 * Global context tracking the IPC connection state with the Roblox Studio Plugin.
 *
 * Exposes the active `scanStatus` and the exact `studioPlaceId` we are currently
 * hooked into, allowing any component to react to Studio connecting or disconnecting.
 */
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
