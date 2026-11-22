import { TREBUCHET_RANGE, isWardKind } from "./balance";
import type { AdaptivePlan } from "./doctrineAdapt";
import type { GameSim } from "./sim";
import type { Building, BuildingKind, Team, Unit, Vec2 } from "./types";

const ARCHER_RANGE = 112;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const BUILDING_PRIORITY: Record<BuildingKind, number> = {
  ballista: 100,
  catapult: 90,
  watchtower: 76,
  church: 66,
  barracks: 56,
  barricade: 45,
  house: 24,
};

const ESCORT_PREF: Record<string, number> = {
  ward: 0,
  templar: 1,
  levy: 2,
  runner: 3,
  archer: 4,
};

/**
 * Fair AoE2-style tactical troop micro for Doctrine AI.
 *
 * Uses ONLY map-visible enemy units & structures and issues the exact same
 * guard/follow, focus-attack, and release orders available to human players:
 *  1. Auto-releases any unit whose previous focus-attack target died so no
 *     Doctrine soldier ever stalls on a stale manual rallyPoint.
 *  2. Assigns protective escort squads (Wards/Levies/Runners/Archers) to Guard & Follow
 *     living friendly Trebuchets (and assaulting Rammers).
 *  3. Directs friendly Trebuchets to focus-fire highest-priority enemy targets
 *     (enemy Trebs -> Ballistas -> Catapults -> Watchtowers -> Churches -> Barracks)
 *     ONLY while assaulting or when a target is already within bombard range, and
 *     releases Trebuchets back to staging when regrouping/defending home.
 *  4. Dispatches fast Runners & nearby Levies to focus-dive exposed enemy Trebuchets.
 *  5. Micros free combat units onto their natural counters in local skirmishes:
 *     - Levies focus nearby enemy Wards/Templars (1.25x bonus vs Wards).
 *     - Archers focus nearby unarmored enemy Archers/Runners/Levies/Spies instead of Wards.
 */
export function runDoctrineMicro(sim: GameSim, team: Team, plan: AdaptivePlan) {
  const s = sim.getState();
  const enemy: Team = team === "foe" ? "you" : "foe";
  const myUnits = s.units.filter((u) => u.team === team && u.fromBarracks && u.hp > 0);
  if (myUnits.length === 0) return;

  const myIds = new Set(myUnits.map((u) => u.id));
  const enemyUnits = s.units.filter((u) => u.team === enemy && u.hp > 0);
  const enemyBuildings = s.buildings.filter((b) => b.team === enemy && b.hp > 0);
  const enemyBarricades = s.barricades.filter((b) => b.team === enemy && b.built && b.hp > 0);
  const enemyTrebs = enemyUnits.filter((u) => u.kind === "trebuchet");

  const defendingHome = plan.emergencyDefend || plan.stance === "regroup" || plan.desiredLayer === "home";
  const myKeep = s.keeps[team];

  // 1. Auto-release completed micro orders & overextended offensive chases cleanly!
  const toRelease: number[] = [];
  for (const u of myUnits) {
    if (!u.manualOrder) continue;

    // Keep valid siege guards intact (except release rammer guards during emergency home defense).
    if (u.guardUnitId != null && myIds.has(u.guardUnitId)) {
      const guarded = myUnits.find((g) => g.id === u.guardUnitId);
      if (guarded && (guarded.kind === "trebuchet" || (!defendingHome && guarded.kind === "rammer"))) {
        continue;
      }
      toRelease.push(u.id);
      continue;
    }

    const hasActiveTarget =
      u.orderTargetUnitId != null ||
      u.orderTargetBuildingId != null ||
      u.orderTargetBarricadeId != null ||
      Boolean(u.orderTargetKeep);

    // Crucial: once a focus target dies, immediately release manualOrder so the unit rejoins the push/formation!
    if (!hasActiveTarget) {
      toRelease.push(u.id);
      continue;
    }

    // Trebuchets: keep auto road/escort staging while marching up! Only hold manual focus-fire
    // when the target is already in bombard range (or we're assaulting closely), otherwise release
    // so the Treb follows roads and waits behind its escort screen!
    if (u.kind === "trebuchet") {
      const tgtB = u.orderTargetBuildingId != null
        ? enemyBuildings.find((b) => b.id === u.orderTargetBuildingId)
        : undefined;
      const tgtU = u.orderTargetUnitId != null
        ? enemyUnits.find((e) => e.id === u.orderTargetUnitId)
        : undefined;
      const tgtBar = u.orderTargetBarricadeId != null
        ? enemyBarricades.find((b) => b.id === u.orderTargetBarricadeId)
        : undefined;
      const pos = tgtU?.pos ?? tgtB?.pos ?? tgtBar?.pos;
      if (defendingHome || !pos || dist(u.pos, pos) > TREBUCHET_RANGE + 24) {
        toRelease.push(u.id);
      }
      continue;
    }

    if (u.kind === "spy") continue;

    if (defendingHome) {
      if (u.orderTargetBuildingId != null || u.orderTargetKeep || u.orderTargetBarricadeId != null) {
        toRelease.push(u.id);
        continue;
      }
      if (u.orderTargetUnitId != null) {
        const tgt = enemyUnits.find((e) => e.id === u.orderTargetUnitId);
        if (!tgt || dist(tgt.pos, myKeep.pos) > 520) {
          toRelease.push(u.id);
        }
      }
    } else if (u.orderTargetUnitId != null) {
      const tgt = enemyUnits.find((e) => e.id === u.orderTargetUnitId);
      const maxChase = u.kind === "archer" ? ARCHER_RANGE + 8 : u.kind === "levy" ? 115 : 240;
      if (!tgt || (tgt.kind !== "trebuchet" && dist(u.pos, tgt.pos) > maxChase)) {
        toRelease.push(u.id);
      }
    }
  }
  if (toRelease.length > 0) {
    sim.aiUnitRelease(team, toRelease);
  }

  // 2. Guard & Follow Siege Engines (Trebuchets always; Rammers while assaulting).
  const trebs = myUnits.filter((u) => u.kind === "trebuchet");
  const rams = plan.desiredLayer === "assault" ? myUnits.filter((u) => u.kind === "rammer") : [];
  const guardTargets: { unit: Unit; quota: number }[] = [
    ...trebs.map((u) => ({ unit: u, quota: 2 })),
    ...rams.slice(0, 2).map((u) => ({ unit: u, quota: 1 })),
  ];

  const eligibleEscorts = myUnits.filter(
    (u) =>
      u.kind !== "trebuchet" &&
      u.kind !== "rammer" &&
      u.kind !== "spy" &&
      u.guardUnitId == null &&
      u.orderTargetUnitId == null &&
      u.orderTargetBuildingId == null &&
      !u.orderTargetKeep,
  );
  const totalNonSiege = myUnits.filter(
    (u) => u.kind !== "trebuchet" && u.kind !== "rammer" && u.kind !== "spy",
  ).length;
  let totalGuarding = myUnits.filter((u) => u.guardUnitId != null && myIds.has(u.guardUnitId)).length;
  const maxGuardsTotal = Math.min(6, Math.max(2, Math.floor(totalNonSiege * 0.35)));

  const assignedGuardIds = new Set<number>();
  for (const gt of guardTargets) {
    if (totalGuarding >= maxGuardsTotal) break;
    const currentGuards = myUnits.filter((u) => u.guardUnitId === gt.unit.id).length;
    const need = Math.min(gt.quota - currentGuards, maxGuardsTotal - totalGuarding);
    if (need <= 0) continue;

    const candidates = eligibleEscorts
      .filter((u) => !assignedGuardIds.has(u.id))
      .sort((a, b) => {
        const pa = ESCORT_PREF[a.kind] ?? 5;
        const pb = ESCORT_PREF[b.kind] ?? 5;
        if (pa !== pb) return pa - pb;
        return dist(a.pos, gt.unit.pos) - dist(b.pos, gt.unit.pos);
      })
      .slice(0, need);

    if (candidates.length > 0) {
      const ids = candidates.map((c) => c.id);
      if (sim.aiUnitGuard(team, ids, gt.unit.id)) {
        for (const id of ids) assignedGuardIds.add(id);
        totalGuarding += ids.length;
      }
    }
  }

  // 3. Trebuchet Precision Focus-Fire: ONLY lock onto priority targets already within TREBUCHET_RANGE
  // so Trebuchets keep road-following & escort-gap staging until they are in safe firing position!
  if (!defendingHome) {
    const focusReach = TREBUCHET_RANGE + 12;
    for (const treb of trebs) {
      const nearEnemyTreb = enemyTrebs
        .filter((e) => dist(treb.pos, e.pos) <= focusReach)
        .sort((a, b) => dist(treb.pos, a.pos) - dist(treb.pos, b.pos))[0];
      if (nearEnemyTreb) {
        if (treb.orderTargetUnitId !== nearEnemyTreb.id) {
          sim.aiUnitAttackUnit(team, [treb.id], nearEnemyTreb.id);
        }
        continue;
      }

      let bestB: Building | null = null;
      let bestScore = -Infinity;
      for (const b of enemyBuildings) {
        const d = dist(treb.pos, b.pos);
        if (d > focusReach) continue;
        const prio = BUILDING_PRIORITY[b.kind] ?? 20;
        const score = prio - d * 0.08;
        if (score > bestScore) {
          bestScore = score;
          bestB = b;
        }
      }
      if (bestB) {
        if (treb.orderTargetBuildingId !== bestB.id) {
          sim.aiUnitAttackBuilding(team, [treb.id], bestB.id);
        }
        continue;
      }

      const nearBar = enemyBarricades
        .filter((bar) => dist(treb.pos, bar.pos) <= focusReach)
        .sort((a, b) => dist(treb.pos, a.pos) - dist(treb.pos, b.pos))[0];
      if (nearBar && treb.orderTargetBarricadeId !== nearBar.id) {
        sim.aiUnitAttackBarricade(team, [treb.id], nearBar.id);
      }
    }
  }

  // 4. Anti-Trebuchet Hunter Squad: fast Runners & nearby Levies focus-dive exposed enemy Trebs!
  if (enemyTrebs.length > 0 && !plan.emergencyDefend) {
    const freeHunters = myUnits.filter(
      (u) =>
        (u.kind === "runner" || u.kind === "levy") &&
        u.guardUnitId == null &&
        !assignedGuardIds.has(u.id) &&
        u.orderTargetUnitId == null,
    );
    for (const et of enemyTrebs) {
      const alreadyHunting = myUnits.filter((u) => u.orderTargetUnitId === et.id).length;
      const wantHunters = 3 - alreadyHunting;
      if (wantHunters <= 0) continue;
      const pick = freeHunters
        .filter((u) => u.kind === "runner" || dist(u.pos, et.pos) <= 320)
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "runner" ? -1 : 1;
          return dist(a.pos, et.pos) - dist(b.pos, et.pos);
        })
        .slice(0, wantHunters);
      if (pick.length > 0) {
        sim.aiUnitAttackUnit(team, pick.map((u) => u.id), et.id);
        for (const p of pick) {
          const idx = freeHunters.indexOf(p);
          if (idx >= 0) freeHunters.splice(idx, 1);
        }
      }
    }
  }

  // 5. Disciplined Counter-Target Focus Micro (NEVER break formation or pull Archers forward!):
  //  - Archers focus-fire lowest-HP soft targets ALREADY INSIDE ARCHER_RANGE (never stepping past Wards!).
  //  - Levies focus enemy Wards/Templars ALREADY in tight melee range (<= 95px) for the 1.25x bonus.
  const enemyCombat = enemyUnits.filter((u) => u.fromBarracks || u.kind === "archer" || isWardKind(u.kind));
  if (enemyCombat.length > 0) {
    const enemyWards = enemyCombat.filter((u) => isWardKind(u.kind));
    const enemySoft = enemyCombat.filter(
      (u) =>
        u.kind === "archer" || u.kind === "runner" || u.kind === "levy" || u.kind === "spy" || u.kind === "raider",
    );

    for (const u of myUnits) {
      if (u.guardUnitId != null || assignedGuardIds.has(u.id)) continue;
      if (u.orderTargetUnitId != null || u.orderTargetBuildingId != null || u.orderTargetKeep) continue;

      if (u.kind === "levy" && enemyWards.length > 0) {
        const nearWard = enemyWards
          .filter((e) => dist(u.pos, e.pos) <= 95)
          .sort((a, b) => dist(u.pos, a.pos) - dist(u.pos, b.pos))[0];
        if (nearWard) {
          sim.aiUnitAttackUnit(team, [u.id], nearWard.id);
        }
      } else if (u.kind === "archer" && enemySoft.length > 0) {
        const nearSoft = enemySoft
          .filter((e) => dist(u.pos, e.pos) <= ARCHER_RANGE)
          .sort((a, b) => a.hp - b.hp || dist(u.pos, a.pos) - dist(u.pos, b.pos))[0];
        if (nearSoft) {
          sim.aiUnitAttackUnit(team, [u.id], nearSoft.id);
        }
      }
    }
  }

  // 6. Forward Church Snipe (Assault Micro):
  // When assaulting, redirect nearby free troops onto exposed enemy Churches (midEco pads) so they
  // don't walk past them while the Churches print endless free Levies & Templars!
  if (plan.desiredLayer === "assault" && !defendingHome) {
    const enemyChurches = enemyBuildings.filter((b) => b.kind === "church");
    for (const ch of enemyChurches) {
      const alreadyOn = myUnits.filter((u) => u.orderTargetBuildingId === ch.id).length;
      const need = 6 - alreadyOn;
      if (need <= 0) continue;
      const nearbyDefenders = enemyCombat.filter((e) => dist(e.pos, ch.pos) <= 130).length;
      if (nearbyDefenders > 4) continue;
      const raiders = myUnits
        .filter(
          (u) =>
            u.kind !== "trebuchet" &&
            u.kind !== "spy" &&
            u.guardUnitId == null &&
            !assignedGuardIds.has(u.id) &&
            u.orderTargetUnitId == null &&
            u.orderTargetBuildingId == null &&
            !u.orderTargetKeep &&
            dist(u.pos, ch.pos) <= 250,
        )
        .sort((a, b) => dist(a.pos, ch.pos) - dist(b.pos, ch.pos))
        .slice(0, need);
      if (raiders.length > 0) {
        sim.aiUnitAttackBuilding(
          team,
          raiders.map((r) => r.id),
          ch.id,
        );
      }
    }
  }
}
