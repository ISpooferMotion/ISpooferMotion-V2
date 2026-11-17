import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

export async function runSplashFlow() {
  const statusText = document.getElementById('status-text');
  const setStatus = (message: string) => {
    if (statusText) statusText.textContent = message;
  };

  setStatus('Checking for updates...');
  let update: Awaited<ReturnType<typeof check>> | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    update = await Promise.race([
      check(),
      new Promise<null>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Updater check timed out')), 10000);
      }),
    ]);
  } catch (error) {
    console.warn('Failed to check for updates:', error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (update?.available === true) {
    setStatus(`Update v${update.version} is available`);
    const spinner = document.getElementById('spinner');
    const updateActions = document.getElementById('update-actions');
    const btnSkip = document.getElementById('btn-skip');
    const btnDownload = document.getElementById('btn-download');

    if (spinner && updateActions && btnSkip && btnDownload) {
      spinner.classList.add('hidden');
      updateActions.classList.remove('hidden');
      updateActions.classList.add('flex');
      btnSkip.classList.remove('drag-region');
      btnDownload.classList.remove('drag-region');

      const choice = await new Promise<'download' | 'skip'>((resolve) => {
        btnSkip.onclick = () => resolve('skip');
        btnDownload.onclick = () => resolve('download');
      });

      btnSkip.onclick = null;
      btnDownload.onclick = null;
      updateActions.classList.add('hidden');
      updateActions.classList.remove('flex');
      spinner.classList.remove('hidden');

      if (choice === 'download') {
        try {
          setStatus(`Downloading update v${update.version}...`);
          let downloaded = 0;
          let contentLength = 0;
          await update.downloadAndInstall((event) => {
            switch (event.event) {
              case 'Started':
                contentLength = event.data.contentLength || 0;
                break;
              case 'Progress':
                downloaded += event.data.chunkLength;
                if (contentLength > 0) {
                  setStatus(
                    `Downloading app & plugin bundle: ${Math.min(100, Math.round((downloaded / contentLength) * 100))}%`,
                  );
                }
                break;
            }
          });
          setStatus('Restarting to apply update...');
          await relaunch();
          return;
        } catch (error) {
          console.error('Unable to install or restart after update:', error);
          setStatus('Update failed. Starting current version...');
        }
      }
    }
  }

  setStatus('Installing plugin to Roblox...');
  try {
    await invoke('sync_roblox_plugin');
  } catch (error) {
    console.error('Failed to sync Roblox plugin:', error);
  }

  setStatus('Starting...');
  try {
    const opened = await invoke<boolean>('close_splashscreen');
    if (!opened) setStatus('Unable to open the main window. Please restart the app.');
  } catch (error) {
    console.error('Failed to open main window:', error);
    setStatus('Unable to open the main window. Please restart the app.');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  void runSplashFlow();
});
