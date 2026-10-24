/** Local smoke: nextLinkStep + Worker health (optional). */
import assert from "node:assert/strict";

const ATTEMPT_MS = 12_000;

function nextLinkStep(clock, attemptMs = ATTEMPT_MS) {
  if (clock.opened) return "stay";
  if (clock.elapsedMs + 250 < attemptMs) return "stay";
  return clock.attempt === 0 ? "relay" : "fail";
}

assert.equal(nextLinkStep({ opened: false, attempt: 0, elapsedMs: 0 }), "stay");
assert.equal(nextLinkStep({ opened: false, attempt: 0, elapsedMs: ATTEMPT_MS }), "relay");
assert.equal(nextLinkStep({ opened: false, attempt: 1, elapsedMs: ATTEMPT_MS }), "fail");
assert.equal(nextLinkStep({ opened: true, attempt: 0, elapsedMs: ATTEMPT_MS }), "stay");

const url = process.env.VITE_TURN_URL || "https://mule-turn.hycelium.workers.dev/ice";
try {
  const health = await fetch(new URL("/", url).toString());
  console.log("worker health", health.status, await health.text());
  const ice = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const body = await ice.text();
  console.log("worker ice", ice.status, body.slice(0, 240));
  if (ice.ok) {
    const parsed = JSON.parse(body);
    assert.ok(Array.isArray(parsed.iceServers) && parsed.iceServers.length > 0);
    const blob = JSON.stringify(parsed.iceServers);
    assert.ok(blob.includes("turn.cloudflare.com") || blob.includes("stun.cloudflare.com"));
    console.log("ice mint ok");
  } else {
    console.log("ice mint not ready yet (set TURN Worker secrets)");
  }
} catch (err) {
  console.log("worker unreachable from this host (TLS/network):", err.message);
}

console.log("ice-smoke nextLinkStep ok");
