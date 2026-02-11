const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');

const PLUGIN_PREFIX = 'ISpooferMotion-Plugin-';
const PLUGIN_EXTS = new Set(['.lua', '.rbxm', '.rbxmx']);

function getPluginDirectory() {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === 'win32') {
    return path.join(home, 'AppData', 'Local', 'Roblox', 'Plugins');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Roblox', 'Plugins');
  }
  return null;
}

function parseVersionFromName(fileName) {
  const base = path.basename(fileName);
  const match = base.match(/ISpooferMotion-Plugin-(\d+\.\d+\.\d+)/i);
  return match ? match[1] : null;
}

function compareVersions(a, b) {
  const parse = (v) => v.split('.').map((n) => parseInt(n, 10));
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

async function getInstalledPluginInfo() {
  const dir = getPluginDirectory();
  if (!dir) {
    return { version: null, filePath: null, directory: null };
  }

  let files = [];
  try {
    files = await fs.promises.readdir(dir);
  } catch (err) {
    return { version: null, filePath: null, directory: dir };
  }

  const matches = files
    .filter((name) => name.startsWith(PLUGIN_PREFIX))
    .map((name) => ({
      name,
      version: parseVersionFromName(name),
    }))
    .filter((entry) => Boolean(entry.version));

  if (!matches.length) {
    return { version: null, filePath: null, directory: dir };
  }

  matches.sort((a, b) => compareVersions(b.version, a.version));
  const newest = matches[0];
  return {
    version: newest.version,
    filePath: path.join(dir, newest.name),
    directory: dir,
  };
}

function getExtensionFromUrl(downloadUrl) {
  try {
    const parsed = new URL(downloadUrl);
    const ext = path.extname(parsed.pathname);
    if (ext && ext.length <= 8) {
      return ext;
    }
  } catch (err) {
    return '';
  }
  return '';
}

function resolvePluginExtension(downloadUrl) {
  const ext = getExtensionFromUrl(downloadUrl);
  if (PLUGIN_EXTS.has(ext)) {
    return ext;
  }
  return '.lua';
}

async function removeOldPlugins(directory, keepFile) {
  let files = [];
  try {
    files = await fs.promises.readdir(directory);
  } catch (err) {
    return;
  }

  const removals = files.filter((name) => {
    if (!name.startsWith(PLUGIN_PREFIX)) return false;
    const full = path.join(directory, name);
    return keepFile ? full !== keepFile : true;
  });

  await Promise.all(
    removals.map(async (name) => {
      try {
        await fs.promises.unlink(path.join(directory, name));
      } catch (err) {
        return;
      }
    })
  );
}

async function downloadAndInstallPlugin(downloadUrl, version, onProgress) {
  const directory = getPluginDirectory();
  if (!directory) {
    throw new Error('Plugin directory not supported on this platform');
  }

  await fs.promises.mkdir(directory, { recursive: true });

  const ext = resolvePluginExtension(downloadUrl);
  const fileName = `${PLUGIN_PREFIX}${version}${ext}`;
  const finalPath = path.join(directory, fileName);
  const tempPath = `${finalPath}.tmp`;

  const response = await axios({
    method: 'get',
    url: downloadUrl,
    responseType: 'stream',
    timeout: 300000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'ISpooferMotion/2.0.3'
    }
  });

  const totalSize = parseInt(response.headers['content-length'], 10) || 0;
  let downloadedSize = 0;

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tempPath);
    response.data.on('data', (chunk) => {
      downloadedSize += chunk.length;
      if (typeof onProgress === 'function' && totalSize > 0) {
        const percent = Math.round((downloadedSize / totalSize) * 100);
        onProgress(percent);
      }
    });

    response.data.on('error', (err) => {
      file.destroy();
      reject(err);
    });

    file.on('error', reject);
    file.on('finish', resolve);

    response.data.pipe(file);
  });

  await fs.promises.rename(tempPath, finalPath);
  await removeOldPlugins(directory, finalPath);

  return finalPath;
}

module.exports = {
  compareVersions,
  getInstalledPluginInfo,
  downloadAndInstallPlugin,
  getPluginDirectory,
};
