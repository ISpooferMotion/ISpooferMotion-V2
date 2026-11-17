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
