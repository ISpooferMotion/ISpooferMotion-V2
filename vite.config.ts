import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
        ...(process.env.VITE_WEB_PREVIEW === 'true'
          ? {
              '@tauri-apps/api/core': resolve(__dirname, './src/tauri-mock.ts'),
              '@tauri-apps/api/window': resolve(__dirname, './src/tauri-mock.ts'),
              '@tauri-apps/plugin-global-shortcut': resolve(__dirname, './src/tauri-mock.ts'),
              '@tauri-apps/api/event': resolve(__dirname, './src/tauri-mock.ts'),
              '@tauri-apps/api/app': resolve(__dirname, './src/tauri-mock.ts'),
            }
          : {}),
      },
      dedupe: ['react', 'react-dom', 'framer-motion'],
    },
    plugins: [react(), tailwindcss()],
    build: {
      target: 'esnext',
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          if (
            warning.code === 'INVALID_ANNOTATION' ||
            warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT' ||
            warning.code === 'PLUGIN_TIMINGS'
          ) {
            return;
          }
          defaultHandler(warning);
        },
        input: {
          main: resolve(__dirname, './index.html'),
          splash: resolve(__dirname, './splash.html'),
          preview: resolve(__dirname, './preview.html'),
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
              if (id.includes('framer-motion')) return 'vendor-framer';
              if (id.includes('three')) return 'vendor-three';
              return 'vendor';
            }
          },
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'https://ispoofermotion.com',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
    },
  };
});
