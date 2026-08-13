import type { RbxInstance } from './robloxPlaceParser/types';

/**
 * Browser-only mock data so the explorer-first UI can be previewed without the
 * Tauri backend (no real Studio scan available). Seeds the spoofer store with a
 * small fake place tree containing a handful of animations / sounds / images /
 * meshes. Never runs inside the desktop app.
 */

const a = (
  id: string,
  type: RbxInstance['assets'][number]['type'],
  name: string,
): RbxInstance['assets'][number] => ({
  type,
  assetId: id,
  rawValue: `rbxassetid://${id}`,
  className: type === 'animation' ? 'Animation' : type === 'audio' ? 'Sound' : 'Decal',
  instanceName: name,
  propertyName: type === 'animation' ? 'AnimationId' : type === 'audio' ? 'SoundId' : 'Texture',
  path: `Workspace.Mock.${name}`,
});

export function buildMockRootInstances(): RbxInstance[] {
  const rifle: RbxInstance = {
    referent: 'studio-mock-rifle',
    className: 'Model',
    name: 'Rifle',
    assets: [
      a('12985951993', 'animation', 'Rifle_Idle'),
      a('13167047004', 'animation', 'Rifle_Sprint'),
      a('129656764752311', 'animation', 'Rifle_Reload'),
    ],
    children: [],
  };

  const sounds: RbxInstance = {
    referent: 'studio-mock-sounds',
    className: 'Model',
    name: 'SoundEffects',
    assets: [a('14293859882', 'audio', 'Shot_Fire'), a('14337902718', 'audio', 'Shot_Reload')],
    children: [],
  };

  const images: RbxInstance = {
    referent: 'studio-mock-images',
    className: 'Model',
    name: 'Icons',
    assets: [
      a('13978783701', 'image', 'Crosshair'),
      a('13978788098', 'image', 'MuzzleFlash'),
      a('13570064510', 'mesh', 'RifleMesh'),
    ],
    children: [],
  };

  return [
    {
      referent: 'studio-mock-workspace',
      className: 'Workspace',
      name: 'Workspace',
      assets: [],
      children: [rifle, sounds, images],
    },
  ];
}

export const MOCK_PLACE_FILE_NAME = 'MockPlace.rbxl (preview)';
