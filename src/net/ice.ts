/**
 * ICE for MULE skirmish.
 *
 * A PC on home Wi‑Fi can often connect peer-to-peer. Two phones on cell data
 * usually cannot: carrier NAT blocks the direct path, so the match must relay
 * through TURN. Short-lived Cloudflare credentials come from mule-turn
 * (VITE_TURN_URL). Nothing long-lived ships in the page. A free public TURN
 * is only a fallback when that mint is down — better than STUN-only.
 */

export const ATTEMPT_MS = 12_000;
/** Phones skip the long direct wait. Carrier NAT will not open it. */
export const PHONE_ATTEMPT_MS = 2_500;
export const RELAY_STATUS = "Trying relay…";

const DEFAULT_TURN_URL = "https://mule-turn.hycelium.workers.dev/ice";

const FALLBACK_USER = "guest";
const FALLBACK_CREDENTIAL = "password";
const PORT_53 = /:53(?:\?|$)/;

const turn = (urls: string): RTCIceServer => ({
  urls,
  username: FALLBACK_USER,
  credential: FALLBACK_CREDENTIAL,
});

function turnEndpoint() {
  const fromEnv = (import.meta.env.VITE_TURN_URL as string | undefined)?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_TURN_URL;
}

/** How long the direct attempt may run before the relay attempt. */
export function directAttemptMs() {
  if (typeof navigator === "undefined") return ATTEMPT_MS;
  const ua = navigator.userAgent || "";
  const coarse = typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);
  const phone =
    coarse ||
    (navigator.maxTouchPoints ?? 0) > 0 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return phone ? PHONE_ATTEMPT_MS : ATTEMPT_MS;
}

/** `turns` on 443 first. Cell networks allow that port and block the usual TURN ports. */
export function orderRelayUrls(urls: string | string[]): string[] {
  const list = (Array.isArray(urls) ? urls : [urls]).filter((url) => typeof url === "string" && !PORT_53.test(url));
  const rank = (url: string) => {
    if (url.startsWith("turns:") && url.includes(":443")) return 0;
    if (url.startsWith("turn:") && url.includes(":443")) return 1;
    if (url.startsWith("turns:")) return 2;
    if (url.includes(":80")) return 3;
    return 4;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

function fallbackRelays(): RTCIceServer[] {
  // Prefer port 443 / TLS — cell carriers often drop classic TURN ports.
  const openRelay = (urls: string): RTCIceServer => ({
    urls,
    username: "openrelayproject",
    credential: "openrelayproject",
  });
  return [
    openRelay("turns:openrelay.metered.ca:443?transport=tcp"),
    openRelay("turn:openrelay.metered.ca:443?transport=tcp"),
    openRelay("turn:openrelay.metered.ca:80?transport=tcp"),
    openRelay("turn:openrelay.metered.ca:443"),
    turn("turns:turn.evan-brass.net:443?transport=tcp"),
    turn("turn:turn.evan-brass.net?transport=tcp"),
    turn("turn:turn.evan-brass.net"),
  ];
}

function isRelayUrl(url: string) {
  return url.startsWith("turn:") || url.startsWith("turns:");
}

function normalizeMinted(servers: RTCIceServer[]): RTCIceServer[] {
  const out: RTCIceServer[] = [];
  for (const server of servers) {
    const raw = Array.isArray(server.urls) ? server.urls : [server.urls];
    const urls = orderRelayUrls(raw.filter((url): url is string => typeof url === "string")).filter(isRelayUrl);
    if (!urls.length) continue;
    const next: RTCIceServer = { urls };
    if (typeof server.username === "string") next.username = server.username;
    if (typeof server.credential === "string") next.credential = server.credential;
    out.push(next);
  }
  return out;
}

function asIceServers(raw: unknown): RTCIceServer[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { iceServers?: unknown }).iceServers;
  if (!Array.isArray(list) || list.length === 0) return null;
  return normalizeMinted(list as RTCIceServer[]);
}

let cached: { servers: RTCIceServer[]; until: number } | null = null;

/**
 * Fetch (or reuse) Cloudflare-minted TURN. Returns null when the Worker fails
 * so callers can fall back to the public relay instead of STUN-only.
 */
export async function mintRelay(): Promise<RTCIceServer[] | null> {
  const now = Date.now();
  if (cached && cached.until > now + 60_000) return cached.servers;

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 4_000);
  try {
    const res = await fetch(turnEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const servers = asIceServers(await res.json());
    if (!servers?.length) return null;
    cached = { servers, until: now + 90 * 60_000 };
    return servers;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** @deprecated Prefer mintRelay — kept for older call sites. */
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  return (await mintRelay()) ?? fallbackRelays();
}

export function iceConfiguration(relayOnly: boolean, minted?: RTCIceServer[] | null): RTCConfiguration {
  const relays = minted && minted.length ? normalizeMinted(minted) : fallbackRelays();
  const stun: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ];
  return {
    iceServers: relayOnly ? relays : [...stun, ...relays],
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
