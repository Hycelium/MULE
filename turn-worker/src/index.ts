/**
 * Mints a short-lived Cloudflare TURN credential for one match.
 * Same layout as KA9KREW/roadkeep turn worker.
 * TURN_KEY_ID and TURN_KEY_API_TOKEN stay here. The browser only receives
 * the expiring username and password.
 */
const TTL_SECONDS = 24 * 60 * 60;

export interface Env {
  TURN_KEY_ID: string;
  TURN_KEY_API_TOKEN: string;
}

function allowedOrigin(origin: string | null) {
  if (!origin) return "";
  if (origin === "https://hycelium.github.io") return origin;
  if (origin === "https://ka9krew.github.io") return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return "";
}

function withCors(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

function rank(url: string) {
  if (url.startsWith("turns:") && url.includes(":443")) return 0;
  if (url.startsWith("turn:") && url.includes(":443")) return 1;
  if (url.startsWith("turns:")) return 2;
  if (url.includes(":80")) return 3;
  return 4;
}

type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

function shape(iceServers: unknown): IceServer[] {
  if (!Array.isArray(iceServers)) return [];
  return iceServers
    .map((server: IceServer) => {
      const raw = Array.isArray(server?.urls) ? server.urls : [server?.urls];
      const urls = raw
        .filter((url): url is string => typeof url === "string" && !/:53(?:\?|$)/.test(url))
        .sort((a, b) => rank(a) - rank(b));
      if (!urls.length) return null;
      const next: IceServer = { urls };
      if (typeof server.username === "string") next.username = server.username;
      if (typeof server.credential === "string") next.credential = server.credential;
      return next;
    })
    .filter((s): s is IceServer => !!s);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request.headers.get("origin"));
    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return withCors(new Response(null, { status: 204 }), origin);
    }
    if (!origin) return new Response("origin", { status: 403 });
    if (request.method !== "POST") return withCors(new Response("method", { status: 405 }), origin);
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
      return withCors(new Response("turn is not configured", { status: 503 }), origin);
    }
    let upstream: Response;
    try {
      upstream = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ttl: TTL_SECONDS }),
        },
      );
    } catch {
      return withCors(new Response("turn unavailable", { status: 502 }), origin);
    }
    if (!upstream.ok) return withCors(new Response("turn unavailable", { status: 502 }), origin);
    const data = (await upstream.json()) as { iceServers?: unknown };
    return withCors(Response.json({ iceServers: shape(data.iceServers) }), origin);
  },
};
