import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** tar on Windows treats `D:\...` as a remote host unless paths use forward slashes. */
function tarPath(p, platform) {
  const abs = resolve(p);
  if (platform === 'win32') {
    return abs.replace(/\\/g, '/');
  }
  return abs;
}

/**
 * Extract archives in a cross-platform way (GitHub Actions Windows-safe).
 */
export function extractArchive(archive, ext, destDir, platform) {
  const archivePath = resolve(archive);
  const destPath = resolve(destDir);
  mkdirSync(destPath, { recursive: true });

  if (ext === 'zip') {
    if (platform === 'win32') {
      const psArchive = archivePath.replace(/'/g, "''");
      const psDest = destPath.replace(/'/g, "''");
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${psArchive}' -DestinationPath '${psDest}' -Force"`,
        { stdio: 'inherit' },
      );
      return;
    }
    execFileSync('tar', ['-xf', tarPath(archivePath, platform), '-C', tarPath(destPath, platform)], {
      stdio: 'inherit',
    });
    return;
  }

  if (ext === 'tar.gz' || ext === 'tgz') {
    const args = ['-xzf', tarPath(archivePath, platform), '-C', tarPath(destPath, platform)];
    if (platform === 'win32') {
      args.unshift('--force-local');
    }
    execFileSync('tar', args, { stdio: 'inherit' });
    return;
  }

  if (ext === 'tar.xz' || ext === 'txz') {
    const args = ['-xJf', tarPath(archivePath, platform), '-C', tarPath(destPath, platform)];
    if (platform === 'win32') {
      args.unshift('--force-local');
    }
    execFileSync('tar', args, { stdio: 'inherit' });
    return;
  }

  throw new Error(`Unsupported archive type: ${ext}`);
}
