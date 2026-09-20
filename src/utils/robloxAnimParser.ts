import { invoke } from '@tauri-apps/api/core';

export interface RobloxPose {
  name: string;
  position: [number, number, number];
  rotation: [number, number, number, number, number, number, number, number, number];
  children: RobloxPose[];
  easingStyle: number;
  easingDirection: number;
}

interface RobloxKeyframe {
  time: number;
  poses: RobloxPose[];
}

export interface RobloxAnimationClip {
  loop: boolean;
  priority: number;
  duration: number;
  keyframes: RobloxKeyframe[];
}

export async function parseAnimationXml(xml: string): Promise<RobloxAnimationClip | null> {
  try {
    const result = await invoke<RobloxAnimationClip | null>('parse_animation_data', { xml });
    return result;
  } catch (e) {
    console.error('Failed to parse animation XML in Rust backend:', e);
    return null;
  }
}
