# Creates a Cloudflare Realtime TURN key, sets Worker secrets, and deploys mule-turn.
# Requires: CLOUDFLARE_API_TOKEN (Calls Write + Account Workers Scripts Edit) and CLOUDFLARE_ACCOUNT_ID.
param(
  [string]$AccountId = $env:CLOUDFLARE_ACCOUNT_ID,
  [string]$ApiToken = $env:CLOUDFLARE_API_TOKEN,
  [string]$KeyName = "mule-skirmish"
)

$ErrorActionPreference = "Stop"
if (-not $AccountId) { throw "Set CLOUDFLARE_ACCOUNT_ID" }
if (-not $ApiToken) { throw "Set CLOUDFLARE_API_TOKEN (Calls Write + Workers Scripts Edit)" }

$headers = @{
  Authorization = "Bearer $ApiToken"
  "Content-Type" = "application/json"
}

Write-Host "Creating TURN key '$KeyName'..."
$body = @{ name = $KeyName } | ConvertTo-Json
$created = Invoke-RestMethod -Method Post `
  -Uri "https://api.cloudflare.com/client/v4/accounts/$AccountId/calls/turn_keys" `
  -Headers $headers `
  -Body $body

if (-not $created.success) {
  $created | ConvertTo-Json -Depth 6
  throw "Failed to create TURN key"
}

$turnKeyId = $created.result.uid
$turnKeySecret = $created.result.key
if (-not $turnKeyId -or -not $turnKeySecret) {
  throw "TURN key response missing uid/key"
}

Write-Host "TURN_KEY_ID=$turnKeyId"
$env:CLOUDFLARE_API_TOKEN = $ApiToken
$env:CLOUDFLARE_ACCOUNT_ID = $AccountId

Write-Host "Setting Worker secrets and deploying..."
$turnKeyId | npx --yes wrangler@4 secret put TURN_KEY_ID
$turnKeySecret | npx --yes wrangler@4 secret put TURN_KEY_API_TOKEN
npx --yes wrangler@4 deploy

Write-Host "Done. Use VITE_TURN_URL=https://mule-turn.<your-subdomain>.workers.dev/ice"
