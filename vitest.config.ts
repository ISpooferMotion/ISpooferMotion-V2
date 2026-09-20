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
