import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

async function runSplashFlow() {
  const statusText = document.getElementById('status-text');

  if (statusText) {
    statusText.innerText = 'Checking for updates...';
  }

  let update: Awaited<ReturnType<typeof check>> | null = null;

  try {
    update = await Promise.race([
      check(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Updater check timed out')), 10000),
      ),
    ]);
  } catch (err) {
    console.error('Failed to check for updates:', err);
  }

  if (update?.available === true) {
    console.log(`Update available: ${update.version}`);
    if (statusText) {
      statusText.innerText = `Update v${update.version} is available`;
    }

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

      const userChoice = await new Promise<'download' | 'skip'>((resolve) => {
        btnSkip.onclick = () => resolve('skip');
        btnDownload.onclick = () => resolve('download');
      });

      updateActions.classList.add('hidden');
      updateActions.classList.remove('flex');

      if (userChoice === 'download') {
        spinner.classList.remove('hidden');
        if (statusText) {
          statusText.innerText = `Downloading update v${update.version}...`;
        }
        let downloaded = 0;
        let contentLength = 0;
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              contentLength = event.data.contentLength || 0;
              console.log(`Started downloading ${event.data.contentLength} bytes`);
              break;
            case 'Progress':
              downloaded += event.data.chunkLength;
              if (statusText && contentLength > 0) {
                const percent = Math.round((downloaded / contentLength) * 100);
                statusText.innerText = `Downloading app & plugin bundle: ${percent}%`;
              }
              break;
            case 'Finished':
              console.log('Download finished');
              break;
          }
        });

        console.log('Update installed, restarting...');
        if (statusText) {
          statusText.innerText = 'Restarting to apply update...';
        }
        await relaunch();
        return;
      } else {
        spinner.classList.remove('hidden');
      }
    }
  }

  if (statusText) {
    statusText.innerText = 'Installing plugin to Roblox...';
  }

  try {
    await invoke('sync_roblox_plugin');
  } catch (err) {
    console.error('Failed to sync Roblox plugin:', err);
  }

  if (statusText) {
    statusText.innerText = 'Starting...';
  }

  try {
    await invoke('close_splashscreen');
  } catch (err) {
    console.error('Failed to close splashscreen:', err);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  void runSplashFlow();
});
