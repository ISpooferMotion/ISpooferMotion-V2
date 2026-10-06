// ISM-V2-PROVENANCE: 21798C710D048998C1151990
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { describe, expect, it } from 'vitest';

import { detectRigType, getBones } from './robloxRig';

describe('robloxRig', () => {
  it('returns R6 bones', () => {
    const bones = getBones('R6');
    expect(bones.length).toBe(7);
    expect(bones.find((b) => b.name === 'Torso')).toBeDefined();
  });

  it('returns R15 bones', () => {
    const bones = getBones('R15');
    expect(bones.length).toBe(16);
    expect(bones.find((b) => b.name === 'UpperTorso')).toBeDefined();
  });

  it('detects R15 rig from pose names', () => {
    expect(detectRigType(new Set(['UpperTorso', 'Head']))).toBe('R15');
  });

  it('detects R6 rig from pose names', () => {
    expect(detectRigType(new Set(['Torso', 'Head']))).toBe('R6');
  });
});

// ISM-V2-PROVENANCE-END: 21798C710D048998C1151990
