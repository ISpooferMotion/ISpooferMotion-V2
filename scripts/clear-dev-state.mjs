import { execFileSync } from 'node:child_process';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const appId = 'com.github.IncrediDev.ISpooferMotion';

if (process.platform === 'win32') {
  const ps = String.raw`
  $ErrorActionPreference = 'SilentlyContinue'
  $appId = 'com.github.IncrediDev.ISpooferMotion'
  $targets = @(
    "$env:APPDATA\$appId",
    "$env:LOCALAPPDATA\$appId",
    "$env:LOCALAPPDATA\ispoofermotion-updater",
    "$env:LOCALAPPDATA\Temp\ISpooferMotion-Audio"
  )

  Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$appId*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

  Start-Sleep -Milliseconds 250

  $allowedRoots = @($env:APPDATA, $env:LOCALAPPDATA) | ForEach-Object {
    [System.IO.Path]::GetFullPath($_)
  }

  foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath $target)) { continue }
    $fullPath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $target).Path)
    $allowed = $false
    foreach ($root in $allowedRoots) {
      if ($fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        $allowed = $true
      }
    }
    if (-not $allowed) { throw "Refusing to delete outside app data: $fullPath" }
    Remove-Item -LiteralPath $fullPath -Recurse -Force
  }

  Write-Host 'Cleared ISpooferMotion generated dev state.'
  `;

  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    stdio: 'inherit',
  });
} else if (process.platform === 'darwin') {
  console.log('Clearing ISpooferMotion generated dev state (macOS)...');
  const homeDir = os.homedir();
  const appSupport = path.join(homeDir, 'Library', 'Application Support', appId);
  const caches = path.join(homeDir, 'Library', 'Caches', appId);
  const webkit = path.join(homeDir, 'Library', 'Caches', 'WebKit', appId);
  
  const targets = [appSupport, caches, webkit];
  for (const target of targets) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  console.log('Done.');
} else {
  console.log('Clearing ISpooferMotion generated dev state (Linux)...');
  const homeDir = os.homedir();
  const configDir = path.join(homeDir, '.config', appId);
  const dataDir = path.join(homeDir, '.local', 'share', appId);
  const cacheDir = path.join(homeDir, '.cache', appId);
  
  const targets = [configDir, dataDir, cacheDir];
  for (const target of targets) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  console.log('Done.');
}
