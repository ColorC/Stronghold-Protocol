<#
  Runs the server in the background for the scheduled task created by scripts\install-service-windows.ps1.
  Settings come from scripts\service.env.ps1 (written by the installer; NODE_EXE, PORT, HOST, SP_COMBAT, SP_VERIFY).
  Output goes to logs\server.log (rotated at 10 MB to logs\server.old.log); the server is restarted 5 s after it exits.
#>
$ErrorActionPreference = 'Continue'   # node reports through its exit code
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:NODE_EXE = 'node'
# Dual-stack default (IPv6 and IPv4 on one socket). scripts\service.env.ps1 may override HOST.
$env:HOST = '::'
$EnvFile = Join-Path $PSScriptRoot 'service.env.ps1'
if (Test-Path $EnvFile) { . $EnvFile }
$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$Log = Join-Path $LogDir 'server.log'

while ($true) {
  if ((Test-Path $Log) -and ((Get-Item $Log).Length -gt 10485760)) { Move-Item -Force $Log (Join-Path $LogDir 'server.old.log') }
  Add-Content -Path $Log -Value "[$(Get-Date -Format s)] starting: $($env:NODE_EXE) server\index.js (PORT=$($env:PORT) HOST=$($env:HOST))"
  & $env:NODE_EXE server\index.js *>> $Log
  Add-Content -Path $Log -Value "[$(Get-Date -Format s)] server exited with code $LASTEXITCODE, restarting in 5 s"
  Start-Sleep -Seconds 5
}
