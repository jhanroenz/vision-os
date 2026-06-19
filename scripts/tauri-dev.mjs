#!/usr/bin/env node
/** Cross-platform `tauri dev` (Linux Wayland/X11 workarounds only on Linux). */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function cargoBinDir() {
  return join(homedir(), '.cargo', 'bin');
}

function findCargo() {
  const onPath = spawnSync('cargo', ['--version'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (onPath.status === 0) return 'cargo';

  const cargoExe =
    process.platform === 'win32'
      ? join(cargoBinDir(), 'cargo.exe')
      : join(cargoBinDir(), 'cargo');
  if (existsSync(cargoExe)) return cargoExe;

  return null;
}

function printRustInstallHelp() {
  console.error(`
Tauri requires the Rust toolchain (cargo), which was not found.

Install Rust, then open a new terminal and run again:

  Windows (winget):
    winget install Rustlang.Rustup

  Or download rustup from https://rustup.rs

Windows also needs:
  - Visual Studio 2022 Build Tools with "Desktop development with C++"
    https://visualstudio.microsoft.com/visual-cpp-build-tools/
  - WebView2 (usually preinstalled on Windows 11)

After installing Rust, restart your terminal so cargo is on PATH
(or run from: ${cargoBinDir()}).
`);
}

function hasMsvcBuildTools() {
  if (process.platform !== 'win32') return true;

  const vswhere = join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  );
  if (!existsSync(vswhere)) return false;

  const result = spawnSync(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { encoding: 'utf8', windowsHide: true },
  );

  return result.status === 0 && Boolean(result.stdout?.trim());
}

function printMsvcInstallHelp() {
  const installPath =
    process.env.VISIONOS_MSVC_INSTALL_PATH ??
    'D:\\Microsoft Visual Studio\\2022\\BuildTools';
  console.error(`
Rust on Windows needs the MSVC linker (link.exe), which was not found.

Install Visual Studio 2022 Build Tools to D:\\ (recommended on this machine):

  powershell -ExecutionPolicy Bypass -File scripts/install-msvc-build-tools.ps1

Or manually (Admin PowerShell):

  winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --installPath ${installPath}"

Custom path:

  set VISIONOS_MSVC_INSTALL_PATH=D:\\BuildTools\\VS2022
  powershell -ExecutionPolicy Bypass -File scripts/install-msvc-build-tools.ps1

Then open a new terminal and run: npm run tauri:dev
`);
}

function isPortInUse(port) {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    const count = Number.parseInt(String(result.stdout ?? '').trim(), 10);
    return Number.isFinite(count) && count > 0;
  }

  const result = spawnSync('lsof', [`-iTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
  return result.status === 0 && Boolean(result.stdout?.trim());
}

function printPortInUseHelp(port) {
  console.error(`
Port ${port} is already in use — Tauri dev cannot start Vite on that port.

Stop the other process first, then run again:

  Windows:
    Get-NetTCPConnection -LocalPort ${port} | Select-Object OwningProcess
    Stop-Process -Id <PID> -Force

  Or close any existing "npm run dev" / "npm run tauri:dev" terminal.

Web-only dev uses the same port (${port}). Only one dev server can run at a time.
`);
}

const DEV_VITE_PORT = 5173;
if (isPortInUse(DEV_VITE_PORT)) {
  printPortInUseHelp(DEV_VITE_PORT);
  process.exit(1);
}

const cargo = findCargo();
if (!cargo) {
  printRustInstallHelp();
  process.exit(1);
}

if (!hasMsvcBuildTools()) {
  printMsvcInstallHelp();
  process.exit(1);
}

const env = { ...process.env };

function prependPath(dir) {
  if (!dir || env.PATH?.toLowerCase().includes(dir.toLowerCase())) return;
  env.PATH = `${dir}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}`;
}

// Same Node install as this script (beforeDevCommand runs `npm run dev`).
prependPath(dirname(process.execPath));

// Fresh rustup installs may not be on PATH until the shell restarts.
prependPath(cargoBinDir());

if (process.platform === 'linux') {
  env.GDK_BACKEND = env.GDK_BACKEND ?? 'x11';
  env.WEBKIT_DISABLE_DMABUF_RENDERER = env.WEBKIT_DISABLE_DMABUF_RENDERER ?? '1';
  env.WINIT_UNIX_BACKEND = env.WINIT_UNIX_BACKEND ?? 'x11';
}

const tauriCli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
if (!existsSync(tauriCli)) {
  console.error('Tauri CLI not found. Run: npm install');
  process.exit(1);
}

const child = spawn(process.execPath, [tauriCli, 'dev'], {
  cwd: root,
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
