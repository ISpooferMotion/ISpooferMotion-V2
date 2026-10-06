// ISM-V2-PROVENANCE: 17200BAFB32F0247C61BE5D0
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

export default mergeConfig(
  // @ts-expect-error stfu
  viteConfig(),
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      globals: true,
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['node_modules', 'e2e', 'dist', '.idea', '.git', '.cache'],
      alias: {},
      server: {
        deps: {},
      },
    },
  }),
);

// ISM-V2-PROVENANCE-END: 17200BAFB32F0247C61BE5D0
