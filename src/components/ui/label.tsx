// ISM-V2-PROVENANCE: 04D00AD3646841CF3AA0F2C3
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import * as React from 'react';

import { cn } from '@/lib/utils';

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Label };

// ISM-V2-PROVENANCE-END: 04D00AD3646841CF3AA0F2C3
