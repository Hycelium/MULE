/**
 * ICE for MULE skirmish.
 *
 * Short-lived Cloudflare Realtime TURN credentials are minted by the mule-turn
 * Worker (VITE_TURN_URL). Secrets never ship in this client. If the Worker is
 * unreachable we fall back to public STUN only — better than a dead guest TURN.
 */

export const ATTEMPT_MS = 12_000;

const DEFAULT_TURN_URL = "https://mule-turn.hycelium.workers.dev/ice";

const STUN_ONLY: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

let cached: { servers: RTCIceServer[]; until: number } | null = null;

function turnEndpoint() {
  const fromEnv = (import.meta.env.VITE_TURN_URL as string | undefined)?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_TURN_URL;
}

function asIceServers(raw: unknown): RTCIceServer[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { iceServers?: unknown }).iceServers;
  if (!Array.isArray(list) || list.length === 0) return null;
  const out: RTCIceServer[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const urls = (entry as RTCIceServer).urls;
    if (!urls) continue;
    out.push(entry as RTCIceServer);
  }
  return out.length > 0 ? out : null;
}

/** Fetch (or reuse) Cloudflare-minted iceServers. STUN-only if the Worker fails. */
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (cached && cached.until > now + 60_000) return cached.servers;

  try {
    const res = await fetch(turnEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`TURN worker ${res.status}`);
    const servers = asIceServers(await res.json());
    if (!servers) throw new Error("TURN worker returned empty iceServers");
    // Cache for most of a 2h TTL so host/guest retries reuse the same mint.
    cached = { servers, until: now + 90 * 60_000 };
    return servers;
  } catch {
    return STUN_ONLY;
  }
}

export function iceConfiguration(servers: RTCIceServer[], relayOnly: boolean): RTCConfiguration {
  return {
    iceServers: servers.length > 0 ? servers : STUN_ONLY,
    iceTransportPolicy: relayOnly ? "relay" : "all",
  };
}

/** Relay-only starts after the direct attempt's window, and only once. */
export function nextLinkStep(
  clock: { opened: boolean; attempt: 0 | 1; elapsedMs: number },
  attemptMs = ATTEMPT_MS,
): "stay" | "relay" | "fail" {
  if (clock.opened) return "stay";
  if (clock.elapsedMs + 250 < attemptMs) return "stay";
  return clock.attempt === 0 ? "relay" : "fail";
}
