# Install Visual Studio 2022 Build Tools (MSVC linker) on D:\
# Required for `npm run tauri:dev` on Windows.
#
# Usage (PowerShell as Administrator recommended):
#   .\scripts\install-msvc-build-tools.ps1
#
# Custom path:
#   $env:VISIONOS_MSVC_INSTALL_PATH = 'D:\BuildTools\VS2022'
#   .\scripts\install-msvc-build-tools.ps1

$ErrorActionPreference = 'Stop'

$InstallPath = if ($env:VISIONOS_MSVC_INSTALL_PATH) {
  $env:VISIONOS_MSVC_INSTALL_PATH
} else {
  'D:\Microsoft Visual Studio\2022\BuildTools'
}

$drive = Split-Path -Qualifier $InstallPath
if (-not (Test-Path $drive)) {
  throw "Drive $drive does not exist."
}

Write-Host "Installing VS 2022 Build Tools (C++ workload) to:"
Write-Host "  $InstallPath"
Write-Host ""
Write-Host "This is a large download (several GB) and may take 15–30+ minutes."
Write-Host ""

# Remove a broken winget registration (no VC tools on disk) before reinstalling.
$existing = winget list --id Microsoft.VisualStudio.2022.BuildTools -e 2>$null
if ($LASTEXITCODE -eq 0 -and $existing -match 'BuildTools') {
  Write-Host "Removing incomplete Visual Studio Build Tools registration…"
  winget uninstall --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements | Out-Host
}

$override = @(
  '--wait',
  '--passive',
  '--add', 'Microsoft.VisualStudio.Workload.VCTools',
  '--includeRecommended',
  '--installPath', $InstallPath
) -join ' '

winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
  --accept-source-agreements `
  --accept-package-agreements `
  --override $override

Write-Host ""
Write-Host "Done. Open a new terminal, then run: npm run tauri:dev"
