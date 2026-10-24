/**
 * Mints short-lived Cloudflare Realtime TURN iceServers for MULE skirmish.
 * TURN_KEY_ID + TURN_KEY_API_TOKEN stay in Worker secrets — never in the game client.
 */

export interface Env {
  TURN_KEY_ID: string;
  TURN_KEY_API_TOKEN: string;
}

const ALLOWED_ORIGINS = new Set([
  "https://hycelium.github.io",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

/** Match length + buffer; Cloudflare max TTL is 48h. */
const TTL_SEC = 2 * 60 * 60;

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://hycelium.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

/** Port 53 TURN URLs time out in browsers; drop them before handing to PeerJS. */
function scrubIceServers(servers: RTCIceServer[]): RTCIceServer[] {
  return servers.map((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    const filtered = urls.filter((u) => typeof u === "string" && !/:53([?/]|$)/.test(u));
    return { ...server, urls: filtered.length === 1 ? filtered[0]! : filtered };
  });
}

type RTCIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

async function mintIce(env: Env): Promise<{ iceServers: RTCIceServer[] }> {
  const id = env.TURN_KEY_ID?.trim();
  const token = env.TURN_KEY_API_TOKEN?.trim();
  if (!id || !token) {
    throw new Error("TURN secrets are not configured on this Worker.");
  }
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: TTL_SEC }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare TURN mint failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { iceServers?: RTCIceServer[] };
  if (!data.iceServers?.length) {
    throw new Error("Cloudflare TURN mint returned no iceServers.");
  }
  return { iceServers: scrubIceServers(data.iceServers) };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "mule-turn" }, 200, origin);
    }

    if (request.method === "POST" && (url.pathname === "/ice" || url.pathname === "/")) {
      try {
        const minted = await mintIce(env);
        return json(minted, 200, origin);
      } catch (err) {
        const message = err instanceof Error ? err.message : "TURN mint failed";
        return json({ error: message }, 502, origin);
      }
    }

    return json({ error: "Not found" }, 404, origin);
  },
};
