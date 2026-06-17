#!/usr/bin/env node
/**
 * Cross-platform SearXNG helpers for VisionOS (dev + local bundled runtime).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Dev Docker SearXNG (see searxng/docker-compose.yml). */
export const DEV_SEARXNG_PORT = 8080;
/** Packaged bundled SearXNG (see src/lib/server/ports.js). */
export const PACKAGED_SEARXNG_PORT = 37583;

export function repoRoot() {
  return process.env.VISIONOS_ROOT
    ? resolve(process.env.VISIONOS_ROOT)
    : resolve(__dirname, '..');
}

export function bundleRuntimeDir(root = repoRoot()) {
  return join(root, 'src-tauri', 'bundle-runtime');
}

export function searxngUrl(port) {
  return `http://127.0.0.1:${port}/`;
}

export function hasCommand(cmd) {
  try {
    const check =
      process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(check, { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

function windowsDockerExe() {
  if (process.platform !== 'win32') return null;
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
  ].filter(Boolean);
  for (const root of roots) {
    const exe = join(root, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe');
    if (existsSync(exe)) return exe;
  }
  return null;
}

export function containerEngine() {
  const winDocker = windowsDockerExe();
  if (winDocker) return winDocker;
  if (hasCommand('docker')) return 'docker';
  if (hasCommand('podman')) return 'podman';
  return null;
}

/** True when the container CLI can reach a running engine (not just installed). */
export function isContainerEngineReady() {
  const engine = containerEngine();
  if (!engine) return false;
  const result = spawnSync(engine, ['info'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return result.status === 0;
}

export function bundledPython(root = repoRoot()) {
  const runtime = bundleRuntimeDir(root);
  if (process.platform === 'win32') {
    return join(runtime, 'searxng-venv', 'Scripts', 'python.exe');
  }
  return join(runtime, 'searxng-venv', 'bin', 'python');
}

export function bundledSearxngSrc(root = repoRoot()) {
  return join(bundleRuntimeDir(root), 'searxng-src');
}

export function bundledSettings(root = repoRoot()) {
  return join(bundleRuntimeDir(root), 'searxng', 'core-config', 'settings.yml');
}

export function hasBundledRuntime(root = repoRoot()) {
  return (
    existsSync(bundledPython(root)) &&
    existsSync(bundledSearxngSrc(root)) &&
    existsSync(join(bundledSearxngSrc(root), 'searx', 'webapp.py')) &&
    existsSync(bundledSettings(root))
  );
}

export function devSettings(root = repoRoot()) {
  return join(root, 'searxng', 'core-config', 'settings.yml');
}

export function readPackagedPortFromSettings(settingsPath) {
  if (!existsSync(settingsPath)) return PACKAGED_SEARXNG_PORT;
  const text = readFileSync(settingsPath, 'utf8');
  const match = text.match(/^\s*port:\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : PACKAGED_SEARXNG_PORT;
}

export async function isHealthy(url, timeoutMs = 2000) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export async function waitForHealthy(url, label, maxWaitMs = 60_000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return;
    await sleep(400);
  }
  throw new Error(`${label} did not become healthy at ${url}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function composeFile(root = repoRoot()) {
  return join(root, 'searxng', 'docker-compose.yml');
}

function runProcess(cmd, args, { cwd, env, stdio = 'inherit' } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    env,
    stdio,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${cmd} ${args.join(' ')}`);
  }
}

export function runCompose(args, { root = repoRoot(), env = {} } = {}) {
  const engine = containerEngine();
  if (!engine) {
    throw new Error('Docker or Podman is required for containerized SearXNG.');
  }
  const file = composeFile(root);
  runProcess(engine, ['compose', '-f', file, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
  });
}

export function loadBundledImage(root = repoRoot()) {
  const engine = containerEngine();
  if (!engine) return;

  const imageTar = join(bundleRuntimeDir(root), 'docker', 'searxng-image.tar');
  const bundledImage = 'visionos-searxng:local';
  if (!existsSync(imageTar)) return;

  const inspect = spawnSync(engine, ['image', 'inspect', bundledImage], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (inspect.status === 0) {
    process.env.SEARXNG_IMAGE = bundledImage;
    return;
  }

  console.log(`Loading bundled SearXNG image from ${imageTar}…`);
  runProcess(engine, ['load', '-i', imageTar]);
  process.env.SEARXNG_IMAGE = bundledImage;
}

export function startBundledSearxng({
  root = repoRoot(),
  port = readPackagedPortFromSettings(bundledSettings(root)),
  detached = false,
} = {}) {
  const python = bundledPython(root);
  const srcDir = bundledSearxngSrc(root);
  const settings = bundledSettings(root);

  if (!hasBundledRuntime(root)) {
    throw new Error(
      'Bundled SearXNG runtime not found. Run: npm run prepare:release',
    );
  }

  const child = spawn(python, ['-m', 'searx.webapp'], {
    cwd: srcDir,
    detached,
    stdio: detached ? 'ignore' : 'pipe',
    env: {
      ...process.env,
      SEARXNG_SETTINGS_PATH: settings,
      SEARXNG_BIND_ADDRESS: '127.0.0.1',
    },
  });

  if (detached) child.unref();

  return { child, url: searxngUrl(port) };
}

export async function ensureDockerSearxng({
  root = repoRoot(),
  port = Number(process.env.SEARXNG_PORT ?? DEV_SEARXNG_PORT),
} = {}) {
  const url = searxngUrl(port);
  if (await isHealthy(url)) {
    console.log(`SearXNG already running at ${url}`);
    return url;
  }

  loadBundledImage(root);

  console.log('Starting SearXNG via Docker…');
  try {
    runCompose(['down'], { root });
  } catch {
    // first start
  }

  runCompose(['up', '-d'], {
    root,
    env: { SEARXNG_PORT: String(port) },
  });

  await waitForHealthy(url, 'SearXNG');
  console.log(`SearXNG ready at ${url}`);
  return url;
}

export async function ensureBundledSearxng({
  root = repoRoot(),
  detached = false,
} = {}) {
  const port = readPackagedPortFromSettings(bundledSettings(root));
  const url = searxngUrl(port);

  if (await isHealthy(url)) {
    console.log(`SearXNG already running at ${url}`);
    return url;
  }

  console.log('Starting bundled SearXNG (Python)…');
  const { child } = startBundledSearxng({ root, port, detached: true });

  if (!detached && child.stdout && child.stderr) {
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  }

  await waitForHealthy(url, 'SearXNG', 120_000);
  console.log(`SearXNG ready at ${url}`);
  console.log(`If web search fails, set SEARXNG_API_BASE=${url.replace(/\/$/, '')} in .env`);
  return url;
}

/**
 * Start SearXNG for dev: Docker when available, else bundled Python runtime.
 */
export async function ensureSearxng({
  root = repoRoot(),
  preferBundled = process.env.SEARXNG_USE_BUNDLED === 'true',
} = {}) {
  const devPort = Number(process.env.SEARXNG_PORT ?? DEV_SEARXNG_PORT);
  const devUrl = searxngUrl(devPort);

  if (await isHealthy(devUrl)) {
    console.log(`SearXNG already running at ${devUrl}`);
    return devUrl;
  }

  if (preferBundled && hasBundledRuntime(root)) {
    return ensureBundledSearxng({ root });
  }

  if (isContainerEngineReady()) {
    return ensureDockerSearxng({ root, port: devPort });
  }

  if (containerEngine() && !isContainerEngineReady()) {
    console.warn(
      'Docker/Podman is installed but the engine is not running. Start Docker Desktop, or use bundled SearXNG.',
    );
  }

  if (hasBundledRuntime(root)) {
    console.log('Using bundled SearXNG Python runtime.');
    return ensureBundledSearxng({ root });
  }

  throw new Error(
    'SearXNG is not available. Start Docker Desktop, or build the bundled runtime:\n' +
      '  npm run prepare:release\n' +
      'Then run dev again, or set SEARXNG_USE_BUNDLED=true',
  );
}
