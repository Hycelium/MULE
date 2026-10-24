# Reads SECRETS.local and pushes TURN secrets to the mule-turn Worker.
$ErrorActionPreference = "Stop"
$path = Join-Path $PSScriptRoot "SECRETS.local"
if (-not (Test-Path $path)) { throw "Create SECRETS.local from SECRETS.local.example first." }

$id = $null
$token = $null
Get-Content $path | ForEach-Object {
  if ($_ -match '^\s*TURN_KEY_ID=(.+)\s*$') { $id = $Matches[1].Trim().Trim('"') }
  if ($_ -match '^\s*TURN_KEY_API_TOKEN=(.+)\s*$') { $token = $Matches[1].Trim().Trim('"') }
}
if (-not $id -or -not $token) { throw "SECRETS.local must set TURN_KEY_ID and TURN_KEY_API_TOKEN" }

$id | npx --yes wrangler@4 secret put TURN_KEY_ID
$token | npx --yes wrangler@4 secret put TURN_KEY_API_TOKEN
npx --yes wrangler@4 deploy
Write-Host "Secrets applied. Smoke: node ../scripts/ice-smoke.mjs"
