import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Extract archives in a cross-platform way (GitHub Actions Windows-safe).
 */
export function extractArchive(archive, ext, destDir, platform) {
  const archivePath = resolve(archive);
  const destPath = resolve(destDir);

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
    execSync(`tar -xf "${archivePath}" -C "${destPath}"`, { stdio: 'inherit' });
    return;
  }

  if (ext === 'tar.gz' || ext === 'tgz') {
    const forceLocal = platform === 'win32' ? '--force-local ' : '';
    execSync(`tar ${forceLocal}-xzf "${archivePath}" -C "${destPath}"`, {
      stdio: 'inherit',
      shell: platform === 'win32',
    });
    return;
  }

  if (ext === 'tar.xz' || ext === 'txz') {
    const forceLocal = platform === 'win32' ? '--force-local ' : '';
    execSync(`tar ${forceLocal}-xJf "${archivePath}" -C "${destPath}"`, {
      stdio: 'inherit',
      shell: platform === 'win32',
    });
    return;
  }

  throw new Error(`Unsupported archive type: ${ext}`);
}
