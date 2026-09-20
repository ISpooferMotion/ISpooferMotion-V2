import { test, expect } from '@playwright/test';
import { createTauriTest } from '@srsholmes/tauri-playwright';

const { test: tauriTest, expect: tauriExpect } = createTauriTest({
  cdpEndpoint: 'http://localhost:9222',
  devUrl: 'http://localhost:5173',
});

test.describe('ISpooferMotion E2E', () => {
  tauriTest('App launches and renders splash screen', async ({ context }) => {
    let mainPage;
    for (let i = 0; i < 30; i++) {
      const pages = context.pages();
      mainPage = pages.find((p) => p.url().includes('localhost:5173'));
      if (mainPage) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(mainPage).toBeDefined();

    await expect(mainPage!.locator('text=ISpooferMotion')).toBeVisible({ timeout: 15000 });
  });
});
