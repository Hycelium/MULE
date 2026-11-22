import type { UnitKind } from "./types";

export interface WavePlan {
  waveNumber: number;
  theme: string;
  /** Per-lane unit counts ordered front-to-back. */
  counts: Partial<Record<UnitKind, number>>;
  /** Flattened unit list ordered cohesively (vanguard -> siege -> flanks -> rear archers). */
  roster: UnitKind[];
}

/** Front-to-back tactical ordering for cohesive wave rosters. */
const ROLE_ORDER: Record<UnitKind, number> = {
  templar: 0,
  brute: 1,
  levy: 2,
  soldier: 3,
  raider: 4,
  rammer: 5,
  trebuchet: 6,
  ward: 7,
  runner: 8,
  archer: 9,
  peon: 10,
  spy: 11,
};

/** Gentle per-lane ceiling for very deep endless waves (wave 50+) to prevent lag. */
const MAX_ENDLESS_LANE_UNITS = 48;

/**
 * Returns a new array of unit kinds sorted cohesively from front to back:
 * vanguard -> siege -> flanks -> rear archers.
 */
export function sortRosterFrontToBack(kinds: UnitKind[]): UnitKind[] {
  return [...kinds].sort((a, b) => ROLE_ORDER[a] - ROLE_ORDER[b]);
}

/**
 * Combat stat multiplier for waves (HP/damage scaling).
 * Gently eases early opening waves (Waves 1–4) so multi-role troops like Levies
 * and Archers match opening tower/keep pacing, stays 1.0 through Wave 12, then
 * climbs smoothly (+7% per wave) so endless matches escalate decisively.
 */
export function waveStrengthScalar(waveNumber: number): number {
  const n = Math.max(1, Math.floor(waveNumber));
  if (n === 1) return 0.68;
  if (n === 2) return 0.78;
  if (n === 3) return 0.86;
  if (n === 4) return 0.94;
  if (n <= 12) return 1;
  return 1 + (n - 12) * 0.07;
}

interface OpeningWaveTemplate {
  theme: string;
  counts: Partial<Record<UnitKind, number>>;
}

/**
 * Hand-crafted opening waves 1–12 with clear tactical identities and smooth
 * early-game balance (Waves 1–6 calibrated so keeps survive initial build-up).
 */
const OPENING_WAVES: readonly OpeningWaveTemplate[] = [
  // Wave 1: Light levy militia opening
  { theme: "Levy Militia", counts: { levy: 4 } },
  // Wave 2: Ranged volley (low keep damage, tests anti-light defense)
  { theme: "Archer Volley", counts: { archer: 5 } },
  // Wave 3: Classic combined arms front + back line
  { theme: "Levy & Archer", counts: { levy: 4, archer: 3 } },
  // Wave 4: Fast flanking push
  { theme: "Skirmish Raiders", counts: { levy: 2, raider: 3, runner: 2 } },
  // Wave 5: Arrow-resistant shield line backing archers
  { theme: "Shield & Bow", counts: { soldier: 3, ward: 2, archer: 3 } },
  // Wave 6: Heavy frontline shockwave
  { theme: "Brute Shockwave", counts: { brute: 2, levy: 4, archer: 3 } },
  // Wave 7: First battering ram protected by shields and levies
  { theme: "Battering Column", counts: { levy: 4, rammer: 1, ward: 2, archer: 4 } },
  // Wave 8: Sacred knight vanguard with flanking runners
  { theme: "Templar Vanguard", counts: { templar: 2, soldier: 3, runner: 3, archer: 4 } },
  // Wave 9: Heavy double-ram siege push
  { theme: "Heavy Siege Push", counts: { brute: 2, rammer: 2, ward: 3, archer: 5 } },
  // Wave 10: Escorted trebuchet battery
  { theme: "Trebuchet Battery", counts: { levy: 4, trebuchet: 1, ward: 4, runner: 3, archer: 5 } },
  // Wave 11: Full combined arms assault
  { theme: "Grand Combined Arms", counts: { templar: 2, brute: 2, rammer: 2, ward: 4, runner: 3, archer: 5 } },
  // Wave 12: Climax royal host before endless escalation
  {
    theme: "Royal Siege Host",
    counts: { templar: 3, levy: 4, rammer: 2, trebuchet: 2, ward: 4, runner: 4, archer: 6 },
  },
];

interface EndlessDoctrine {
  theme: string;
  /** Baseline per-lane counts entering endless (Wave 13–17). */
  base: Partial<Record<UnitKind, number>>;
  /** Per-5-wave-cycle growth for each role (favors elites and signature units). */
  perCycle: Partial<Record<UnitKind, number>>;
  /** Preferred elite promotions when total squad size approaches the lag cap. */
  promoteFrom: UnitKind[];
  promoteTo: UnitKind[];
}

const ENDLESS_DOCTRINES: readonly EndlessDoctrine[] = [
  {
    theme: "Siege Column",
    base: { levy: 5, rammer: 3, trebuchet: 2, ward: 5, runner: 3, archer: 6 },
    perCycle: { templar: 0.7, levy: 0.6, rammer: 0.9, trebuchet: 0.65, ward: 1.2, runner: 0.6, archer: 1.3 },
    promoteFrom: ["levy"],
    promoteTo: ["templar", "ward"],
  },
  {
    theme: "Shieldwall Phalanx",
    base: { templar: 3, brute: 3, soldier: 4, ward: 6, runner: 2, archer: 7 },
    perCycle: { templar: 1.3, brute: 1.1, soldier: 0.4, ward: 1.5, runner: 0.5, archer: 1.4 },
    promoteFrom: ["soldier"],
    promoteTo: ["templar", "brute"],
  },
  {
    theme: "Templar Crusade",
    base: { templar: 5, levy: 6, soldier: 3, rammer: 1, ward: 2, runner: 5, archer: 5 },
    perCycle: { templar: 1.6, levy: 0.7, soldier: 0.4, rammer: 0.6, ward: 0.8, runner: 1.2, archer: 1.2 },
    promoteFrom: ["levy", "soldier"],
    promoteTo: ["templar", "ward"],
  },
  {
    theme: "Skirmish Avalanche",
    base: { brute: 2, levy: 5, raider: 6, rammer: 2, runner: 7, archer: 5 },
    perCycle: { templar: 0.7, brute: 0.9, levy: 0.6, raider: 0.7, rammer: 0.75, runner: 1.7, archer: 1.3 },
    promoteFrom: ["raider", "levy"],
    promoteTo: ["runner", "templar"],
  },
  {
    theme: "Grand Imperial Host",
    base: { templar: 3, brute: 3, levy: 4, rammer: 2, trebuchet: 2, ward: 4, runner: 4, archer: 6 },
    perCycle: { templar: 1.3, brute: 1.0, levy: 0.5, rammer: 0.8, trebuchet: 0.6, ward: 1.1, runner: 1.0, archer: 1.4 },
    promoteFrom: ["levy"],
    promoteTo: ["templar", "brute"],
  },
];

/** Per-lane ceilings for bulky siege engines so roads stay maneuverable in deep endless waves. */
const ROLE_LANE_CAPS: Partial<Record<UnitKind, number>> = {
  trebuchet: 6,
  rammer: 8,
};

function buildWavePlan(
  waveNumber: number,
  theme: string,
  rawCounts: Partial<Record<UnitKind, number>>,
): WavePlan {
  const orderedKinds = sortRosterFrontToBack(
    (Object.keys(rawCounts) as UnitKind[]).filter((k) => (rawCounts[k] ?? 0) > 0),
  );
  const counts: Partial<Record<UnitKind, number>> = {};
  const roster: UnitKind[] = [];

  for (const kind of orderedKinds) {
    const count = Math.max(0, Math.floor(rawCounts[kind] ?? 0));
    if (count <= 0) continue;
    counts[kind] = count;
    for (let i = 0; i < count; i++) {
      roster.push(kind);
    }
  }

  return {
    waveNumber,
    theme,
    counts,
    roster,
  };
}

function composeEndlessWave(waveNumber: number): WavePlan {
  const endlessIdx = waveNumber - 13; // 0-based starting at Wave 13
  const doctrine = ENDLESS_DOCTRINES[endlessIdx % ENDLESS_DOCTRINES.length]!;
  const cycleFloat = endlessIdx / ENDLESS_DOCTRINES.length;

  // Gather every unit kind participating in this doctrine.
  const allKinds = new Set<UnitKind>([
    ...(Object.keys(doctrine.base) as UnitKind[]),
    ...(Object.keys(doctrine.perCycle) as UnitKind[]),
  ]);

  const raw: Partial<Record<UnitKind, number>> = {};
  for (const kind of allKinds) {
    const baseCount = doctrine.base[kind] ?? 0;
    const growth = doctrine.perCycle[kind] ?? 0;
    let count = Math.round(baseCount + cycleFloat * growth);
    const cap = ROLE_LANE_CAPS[kind];
    if (cap !== undefined) count = Math.min(cap, count);
    if (count > 0) raw[kind] = count;
  }

  // Deep endless waves (cycle >= 2, Wave 23+) steadily upgrade basic troops into elites
  // so army deadliness keeps climbing even after per-lane unit counts reach the lag ceiling.
  if (cycleFloat >= 2 && doctrine.promoteFrom.length > 0 && doctrine.promoteTo.length > 0) {
    const shiftRatio = Math.min(0.65, (cycleFloat - 1.5) * 0.08);
    let promoted = 0;
    for (const src of doctrine.promoteFrom) {
      const current = raw[src] ?? 0;
      if (current <= 1) continue;
      const move = Math.min(current - 1, Math.floor(current * shiftRatio));
      if (move > 0) {
        raw[src] = current - move;
        promoted += move;
      }
    }
    for (let i = 0; i < promoted; i++) {
      const dst = doctrine.promoteTo[i % doctrine.promoteTo.length]!;
      const cap = ROLE_LANE_CAPS[dst];
      const next = (raw[dst] ?? 0) + 1;
      raw[dst] = cap !== undefined ? Math.min(cap, next) : next;
    }
  }

  // Gently cap total units per lane at MAX_ENDLESS_LANE_UNITS while preserving doctrine mix.
  const entries = (Object.entries(raw) as [UnitKind, number][]).filter(([, c]) => c > 0);
  const total = entries.reduce((sum, [, c]) => sum + c, 0);
  if (total > MAX_ENDLESS_LANE_UNITS) {
    const scale = MAX_ENDLESS_LANE_UNITS / total;
    const scaled: Partial<Record<UnitKind, number>> = {};
    let used = 0;
    // Keep at least 1 of every active role, then allocate the remainder by largest fractional part.
    const remainders: { kind: UnitKind; frac: number }[] = [];
    for (const [kind, c] of entries) {
      const exact = c * scale;
      const floored = Math.max(1, Math.floor(exact));
      scaled[kind] = floored;
      used += floored;
      remainders.push({ kind, frac: exact - Math.floor(exact) });
    }
    // Trim if min-1 clamping ever exceeded cap, or distribute remaining slots to top fractions.
    if (used < MAX_ENDLESS_LANE_UNITS) {
      remainders.sort((a, b) => b.frac - a.frac || ROLE_ORDER[a.kind] - ROLE_ORDER[b.kind]);
      let idx = 0;
      while (used < MAX_ENDLESS_LANE_UNITS && remainders.length > 0) {
        const pick = remainders[idx % remainders.length]!.kind;
        const cap = ROLE_LANE_CAPS[pick];
        if (cap === undefined || (scaled[pick] ?? 0) < cap) {
          scaled[pick] = (scaled[pick] ?? 0) + 1;
          used++;
        }
        idx++;
        if (idx > remainders.length * 4) break;
      }
    } else if (used > MAX_ENDLESS_LANE_UNITS) {
      const byCountDesc = [...entries].sort((a, b) => (scaled[b[0]] ?? 0) - (scaled[a[0]] ?? 0));
      let i = 0;
      while (used > MAX_ENDLESS_LANE_UNITS && i < byCountDesc.length * 4) {
        const k = byCountDesc[i % byCountDesc.length]![0];
        if ((scaled[k] ?? 0) > 1) {
          scaled[k] = (scaled[k] ?? 0) - 1;
          used--;
        }
        i++;
      }
    }
    return buildWavePlan(waveNumber, doctrine.theme, scaled);
  }

  return buildWavePlan(waveNumber, doctrine.theme, raw);
}

/**
 * Scale per-lane counts cleanly on 2-lane and 3-lane maps so total wave pressure
 * stays balanced across map sizes while preserving every active role per lane.
 */
function scaleCountsForLanes(
  counts: Partial<Record<UnitKind, number>>,
  laneCount: number,
): Partial<Record<UnitKind, number>> {
  if (laneCount <= 1) return counts;
  const factor = laneCount === 2 ? 0.56 : 0.42;
  const out: Partial<Record<UnitKind, number>> = {};
  for (const [kind, count] of Object.entries(counts) as [UnitKind, number][]) {
    if (!count || count <= 0) continue;
    out[kind] = Math.max(1, Math.round(count * factor));
  }
  return out;
}

/**
 * Plans a cohesive per-lane wave composition for any 1-based `waveNumber`
 * (Waves 1–12 follow iconic escalating themes; Waves 13+ scale endlessly
 * through 5 cycling tactical doctrines).
 */
export function planWave(waveNumber: number, laneCount = 1): WavePlan {
  const n = Math.max(1, Math.floor(waveNumber));
  if (n <= OPENING_WAVES.length) {
    const spec = OPENING_WAVES[n - 1]!;
    return buildWavePlan(n, spec.theme, scaleCountsForLanes(spec.counts, laneCount));
  }
  const endless = composeEndlessWave(n);
  if (laneCount <= 1) return endless;
  return buildWavePlan(n, endless.theme, scaleCountsForLanes(endless.counts, laneCount));
}
