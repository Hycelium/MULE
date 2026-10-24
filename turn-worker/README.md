# mule-turn

Mints short-lived Cloudflare Realtime TURN `iceServers` for MULE skirmish.

**Live URL:** `https://mule-turn.hycelium.workers.dev/ice`

## One-time secrets

Wrangler OAuth cannot create Calls TURN keys. Create a key in the dashboard, then set Worker secrets:

1. Open [Realtime TURN](https://dash.cloudflare.com/82d7b1deeb4e80c5cb281e5e54578348/realtime/turn) (or **Calls → TURN**).
2. Create a TURN key named `mule-skirmish`. Copy the **Key ID** (`uid`) and the **API token** (`key`) shown once.
3. From this folder:

```powershell
npx wrangler secret put TURN_KEY_ID
# paste the uid

npx wrangler secret put TURN_KEY_API_TOKEN
# paste the key secret

npx wrangler deploy
```

4. Confirm:

```powershell
curl -X POST https://mule-turn.hycelium.workers.dev/ice -H "Content-Type: application/json" -d "{}"
```

You should see `iceServers` with `turn.cloudflare.com` URLs.

## Redeploy

```powershell
npx wrangler deploy
```
