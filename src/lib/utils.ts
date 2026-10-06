// ISM-V2-PROVENANCE: 5617C7DDB19DF1D76C60896C
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ISM-V2-PROVENANCE-END: 5617C7DDB19DF1D76C60896C
