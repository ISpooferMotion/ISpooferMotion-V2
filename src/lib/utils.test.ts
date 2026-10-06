// ISM-V2-PROVENANCE: 40BB395D0168D36C6F0AFEAD
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('combines classes correctly', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('handles conditional classes via clsx', () => {
    expect(cn('a', { b: true, c: false })).toBe('a b');
  });

  it('merges tailwind conflict classes', () => {
    expect(cn('p-4', 'p-8')).toBe('p-8');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles undefined and null inputs', () => {
    expect(cn('a', null, undefined, 'b')).toBe('a b');
  });
});

// ISM-V2-PROVENANCE-END: 40BB395D0168D36C6F0AFEAD
