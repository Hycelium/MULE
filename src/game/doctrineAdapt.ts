import { BUILD_COST, CHURCH_UPGRADE_GOLD, UPGRADE_COST, isWardKind } from "./balance";
import type { DoctrineTune } from "./doctrineTune";
import type { OpponentTendency } from "./opponentProfile";
import type { GameSim } from "./sim";
import type { DefendLayerId, Team, TrainKind } from "./types";

export type AdaptiveStance =
  | "standard"
  | "hold-rush"
  | "punish-greed"
  | "anti-fortress"
  | "anti-ballista"
  | "anti-ward"
  | "anti-swarm"
  | "anti-siege"
  | "regroup";

export type EcoGoal =
  | "none"
  | "guard-dogs"
  | "church"
  | "trebuchet"
  | "catapult"
  | "ballista"
  | "barracks-upgrade";

export type ResourceBias = "wood" | "gold" | "balanced";

export interface EnemyIntel {
  watchtowers: number;
  ballistas: number;
  catapults: number;
  defenseTowers: number;
  barracks: number;
  churches: number;
  houses: number;
  barricades: number;
  wards: number;
  levies: number;
  archers: number;
  runners: number;
  rams: number;
  trebs: number;
  spies: number;
  totalArmy: number;
  approachingHome: number;
}

export interface AdaptivePlan {
  stance: AdaptiveStance;
  wantBallistas: number;
  wantCatapults: number;
  wantBarracks: number;
  wantTrebs: number;
  wantRams: number;
  wantSpies: number;
  needGuardDogs: boolean;
  emergencyDefend: boolean;
  bankForTreb: boolean;
  wardPct: number;
  archerPct: number;
  runnerPct: number;
  earlyScreenGoal: number;
  pushFloor: number;
  requireTrebs: number;
  upgradePref: "damage" | "rate" | "adaptive";
  desiredLayer: DefendLayerId;
  ecoGoal: EcoGoal;
  reserveGold: number;
  reserveWood: number;
  resourceBias: ResourceBias;
}

interface AssaultMemory {
  wasAssaulting: boolean;
  hadSiegeOnPush: boolean;
  retreatUntil: number;
}

const assaultMemory: Record<Team, AssaultMemory> = {
  you: { wasAssaulting: false, hadSiegeOnPush: false, retreatUntil: 0 },
  foe: { wasAssaulting: false, hadSiegeOnPush: false, retreatUntil: 0 },
};

/** Clear per-match tactical memory on match start/reset. */
export function resetDoctrineMemory(team?: Team) {
  const clear = (side: Team) => {
    assaultMemory[side] = { wasAssaulting: false, hadSiegeOnPush: false, retreatUntil: 0 };
  };
  if (team) clear(team);
  else {
    clear("you");
    clear("foe");
  }
}

/**
 * Map-visible intel only (enemy structures on the field + living spawned units).
 * Never peeks into hidden training queues, keeping Human vs AI 100% fair.
 */
export function scoutEnemy(sim: GameSim, team: Team): EnemyIntel {
  const s = sim.getState();
  const enemy: Team = team === "foe" ? "you" : "foe";
  const blds = s.buildings.filter((b) => b.team === enemy && b.hp > 0);
  const watchtowers = blds.filter((b) => b.kind === "watchtower").length;
  const ballistas = blds.filter((b) => b.kind === "ballista").length;
  const catapults = blds.filter((b) => b.kind === "catapult").length;
  const barracks = blds.filter((b) => b.kind === "barracks").length;
  const churches = blds.filter((b) => b.kind === "church").length;
  const houses = blds.filter((b) => b.kind === "house").length;
  const barricades = s.barricades.filter((b) => b.team === enemy && b.built && b.hp > 0).length;

  const units = s.units.filter((u) => u.team === enemy && u.hp > 0);
  const combatUnits = units.filter((u) => u.fromBarracks);
  const approachingHome = units.filter((u) =>
    team === "foe" ? u.pos.y <= 520 : u.pos.y >= s.keeps.you.pos.y - 520,
  ).length;

  return {
    watchtowers,
    ballistas,
    catapults,
    defenseTowers: watchtowers + ballistas + catapults,
    barracks,
    churches,
    houses,
    barricades,
    wards: combatUnits.filter((u) => isWardKind(u.kind)).length,
    levies: combatUnits.filter((u) => u.kind === "levy").length,
    archers: combatUnits.filter((u) => u.kind === "archer").length,
    runners: combatUnits.filter((u) => u.kind === "runner").length,
    rams: combatUnits.filter((u) => u.kind === "rammer").length,
    trebs: combatUnits.filter((u) => u.kind === "trebuchet").length,
    spies: combatUnits.filter((u) => u.kind === "spy").length,
    totalArmy: combatUnits.length,
    approachingHome,
  };
}

/**
 * On-the-fly counter planner grounded in Roadkeep's combat math + fair cross-match
 * opponent tendencies + goal-based economy reservation + mid-map staging & retreat.
 */
export function adaptDoctrinePlan(
  team: Team,
  tune: DoctrineTune,
  intel: EnemyIntel,
  own: {
    time: number;
    gold: number;
    wood: number;
    ecoFull: boolean;
    ecoPads?: number;
    hasForwardHouse: boolean;
    churches: number;
    ballistas: number;
    catapults: number;
    needsGuardDogUpgrade: boolean;
    barracksBelowMax: boolean;
    armyUsed: number;
    armyCap: number;
    trebs: number;
    rams: number;
    keepHpRatio: number;
    enemyKeepHpRatio: number;
    currentLayer: DefendLayerId | null;
  },
  profile?: OpponentTendency | null,
): AdaptivePlan {
  let stance: AdaptiveStance = "standard";
  let wardPct = tune.wardPct;
  let archerPct = tune.archerPct;
  let runnerPct = 0;
  let earlyScreenGoal = tune.earlyScreen;

  // Fair historical tendency prep (only active with >= 2 completed games; live intel always overrides).
  const hasProfile = Boolean(profile && profile.sampleSize >= 2);
  if (hasProfile && profile) {
    if (profile.earlyRushRate >= 0.55) {
      earlyScreenGoal = Math.max(earlyScreenGoal, tune.earlyScreen + 2);
    }
    if (profile.wardRate >= 0.55 && intel.totalArmy < 4) {
      archerPct = Math.min(archerPct, 10);
    } else if (profile.archerRate >= 0.55 && intel.totalArmy < 4) {
      wardPct = Math.max(wardPct, 42);
    }
  }

  const lateDefense = own.ecoFull && (own.churches >= 1 || own.time >= 200 || intel.totalArmy >= 10);
  let wantBallistas = lateDefense ? Math.max(tune.ballistaGoal, 2) : tune.ballistaGoal;
  let wantCatapults = lateDefense ? 1 : 0;
  const wantBarracks =
    own.ecoFull && (intel.totalArmy >= 16 || intel.barracks >= 2 || intel.churches >= 2 || own.time >= 210)
      ? Math.max(tune.barracksGoal, 2)
      : tune.barracksGoal;

  const profileFortressHint = Boolean(hasProfile && profile && profile.fortressRate >= 0.65 && own.time >= 130);
  const fortified =
    intel.defenseTowers >= 3 ||
    (own.time >= 210 && intel.defenseTowers >= 2) ||
    (profileFortressHint && intel.defenseTowers >= 2);
  const trebCap = Math.max(2, Math.min(3, tune.siegeTrebCap));
  let wantTrebs = own.ecoFull
    ? fortified
      ? Math.max(tune.trebGoal, intel.defenseTowers >= 4 ? trebCap : 2)
      : intel.defenseTowers >= 2
        ? Math.min(tune.trebGoal, 2)
        : 0
    : 0;
  let wantRams = own.ecoFull ? tune.ramGoal : 0;
  let wantSpies =
    own.ecoFull && (intel.trebs > 0 || intel.defenseTowers >= 3)
      ? Math.max(tune.spyGoal, intel.trebs > 0 ? 2 : 1)
      : 0;
  const needGuardDogs =
    intel.spies > 0 ||
    (own.time >= 230 && intel.barracks >= 1) ||
    Boolean(hasProfile && profile && profile.siegeRate >= 0.6 && own.time >= 170);
  let upgradePref: "damage" | "rate" | "adaptive" = "adaptive";

  // 1. Emergency anti-rush: enemy crosses early before our eco finishes.
  const emergencyDefend =
    (!own.ecoFull && (intel.approachingHome >= 5 || own.keepHpRatio < 0.85)) ||
    (own.keepHpRatio < 0.7 && intel.approachingHome >= 4);
  if (emergencyDefend) {
    stance = "hold-rush";
    wantBallistas = Math.max(wantBallistas, 1);
  }

  // 2. Counter enemy Siege (Trebuchets / heavy Rams).
  if (intel.trebs >= 1 || intel.rams >= 3) {
    stance = "anti-siege";
    if (intel.trebs >= 1) {
      wantSpies = own.ecoFull ? Math.max(wantSpies, Math.min(4, intel.trebs + 1)) : wantSpies;
      // Fast runners (54 spd, 1.55x melee vs trebs) rush enemy trebs down.
      runnerPct = 25;
      archerPct = Math.min(archerPct, 10); // Archers deal only 0.28x to trebs.
      wantCatapults = Math.max(wantCatapults, 1);
    }
    if (intel.rams >= 3) {
      wantBallistas = Math.max(wantBallistas, 2);
      archerPct = Math.min(archerPct, 10); // Archers deal only 0.38x to rams.
      upgradePref = "damage";
    }
  }

  // 3. Counter enemy Fortress / Ballista Wall.
  if (intel.defenseTowers >= 3) {
    if (stance === "standard") stance = intel.ballistas >= 2 ? "anti-ballista" : "anti-fortress";
    wantBallistas = Math.max(wantBallistas, 2);
    wantCatapults = Math.max(wantCatapults, 1);
    wantTrebs = own.ecoFull ? Math.max(wantTrebs, intel.defenseTowers >= 4 ? trebCap : 2) : 0;
    wantSpies = own.ecoFull ? Math.max(wantSpies, 2) : 0;
    if (intel.ballistas >= 2) {
      // Ballistas pierce Ward armor; lean into cheaper Levies + Rams behind Trebuchets.
      wardPct = Math.min(wardPct, 20);
      archerPct = Math.min(archerPct, 20);
      wantRams = own.ecoFull ? Math.max(wantRams, 5) : 0;
    } else {
      // Watchtower/Catapult wall without Ballistas: Wards (0.88 resist) walk right through.
      wardPct = Math.max(wardPct, 45);
    }
  }

  // 4. Counter enemy Unit Composition dynamically.
  if (intel.wards >= 4 && intel.wards >= intel.levies) {
    if (stance === "standard") stance = "anti-ward";
    archerPct = 0; // Archers only deal 0.40x to Wards; Levies deal 1.25x bonus vs Wards.
    // If the enemy backs their Ward wall with a big Archer volley, keep enough Wards + Catapult to soak arrows!
    wardPct = intel.archers >= 6 ? Math.max(wardPct, 35) : Math.min(wardPct, 20);
    wantBallistas = Math.max(wantBallistas, 2);
    if (intel.archers >= 6) wantCatapults = Math.max(wantCatapults, 1);
    upgradePref = "damage";
  } else if (intel.archers >= 5) {
    if (stance === "standard") stance = "anti-swarm";
    wardPct = Math.max(wardPct, 45);
    archerPct = Math.min(archerPct, 15);
    wantCatapults = Math.max(wantCatapults, intel.archers >= 10 || intel.totalArmy >= 22 ? 2 : 1);
  } else if (intel.levies + intel.runners >= 8) {
    if (stance === "standard") stance = "anti-swarm";
    wantCatapults = Math.max(wantCatapults, intel.totalArmy >= 22 ? 2 : 1);
    if (intel.runners >= 4) {
      wantBallistas = Math.max(wantBallistas, 2);
      upgradePref = "rate";
    }
    archerPct = Math.max(archerPct, 30);
  }

  // 5. Punish greedy low-defense openings (enemy booms houses/churches with no Ballistas/Catapults).
  const nakedChurchGreed =
    (own.ecoPads ?? 3) >= 3 &&
    own.ecoFull &&
    own.time < 195 &&
    intel.ballistas === 0 &&
    intel.catapults === 0 &&
    intel.churches >= 1 &&
    intel.totalArmy <= 12;
  const greedyEnemy =
    nakedChurchGreed ||
    (own.ecoFull &&
      own.time < 220 &&
      intel.defenseTowers <= 1 &&
      intel.totalArmy <= 4 &&
      (intel.houses >= 3 || intel.churches >= 1));
  if (greedyEnemy && stance === "standard") {
    stance = "punish-greed";
    runnerPct = Math.max(runnerPct, 20);
  }
  if (nakedChurchGreed) {
    // Pure RTS punish: vs 0-tower early Church greed, don't sink gold into extra towers — pump units & raze the Church!
    wantBallistas = Math.min(wantBallistas, 1);
    wantCatapults = 0;
  }

  // 6. Timber banking & push threshold discipline.
  const bankForTreb =
    own.ecoFull &&
    fortified &&
    own.trebs < Math.min(wantTrebs, trebCap) &&
    own.armyUsed >= 8;

  let pushFloor = tune.attackAt;
  let requireTrebs = 0;
  if (nakedChurchGreed) {
    pushFloor = Math.max(8, Math.min(10, intel.totalArmy + 3));
  } else if (greedyEnemy) {
    pushFloor = Math.max(12, tune.attackAt - tune.greedDrop);
  } else if (intel.defenseTowers >= 3) {
    pushFloor = Math.min(own.armyCap - 2, Math.max(tune.attackAt, tune.fortressPush));
    requireTrebs = own.ecoFull ? 2 : 0;
  }
  if (!greedyEnemy && intel.totalArmy >= 16) {
    // Never trickle small squads into a larger visible enemy army — match their mass first.
    const parityTarget = Math.min(34, Math.ceil(intel.totalArmy * 0.85));
    pushFloor = Math.min(own.armyCap - 2, Math.max(pushFloor, parityTarget));
  }

  // 7. Goal-based economy reservation + worker resource steering (#4).
  let ecoGoal: EcoGoal = "none";
  let reserveGold = 0;
  let reserveWood = 0;
  let resourceBias: ResourceBias = "balanced";

  const church1MinArmy = (own.ecoPads ?? 3) <= 2 ? 9 : 6;
  const matchEnemyChurch =
    intel.churches > own.churches &&
    own.armyUsed >= 8 &&
    own.ballistas + own.catapults >= 2 &&
    !(fortified && own.trebs < 2 && own.churches >= 1);
  if (needGuardDogs && own.needsGuardDogUpgrade) {
    ecoGoal = "guard-dogs";
    reserveGold = UPGRADE_COST[0];
    resourceBias = own.gold < reserveGold ? "gold" : "balanced";
  } else if (
    !nakedChurchGreed &&
    own.ecoFull &&
    own.hasForwardHouse &&
    own.churches < tune.churchGoal &&
    !emergencyDefend &&
    intel.approachingHome < 4 &&
    (matchEnemyChurch ||
      (own.churches === 0 &&
        own.armyUsed >= church1MinArmy &&
        own.armyUsed + 5 >= intel.totalArmy) ||
      (own.churches >= 1 &&
        own.armyUsed >= 16 &&
        own.armyUsed >= intel.totalArmy &&
        !(fortified && own.trebs < 2) &&
        own.gold >= tune.churchSaveAt))
  ) {
    // Church #1: rush cleanly right after home eco + initial screen (or match enemy Church!)
    // Church #2: consecrate only when army matches/leads the enemy and siege isn't urgent.
    ecoGoal = "church";
    reserveGold = CHURCH_UPGRADE_GOLD;
    resourceBias = "gold";
  } else if (bankForTreb) {
    ecoGoal = "trebuchet";
    reserveGold = 150;
    reserveWood = 200;
    resourceBias = own.wood < 200 ? "wood" : own.gold < 150 ? "gold" : "balanced";
  } else if (own.ecoFull && own.catapults < wantCatapults && (intel.totalArmy >= 6 || intel.defenseTowers >= 3)) {
    ecoGoal = "catapult";
    reserveGold = BUILD_COST.catapult.gold;
    reserveWood = BUILD_COST.catapult.wood;
    resourceBias = own.wood < reserveWood ? "wood" : own.gold < reserveGold ? "gold" : "balanced";
  } else if (own.ecoFull && own.ballistas < wantBallistas) {
    ecoGoal = "ballista";
    reserveGold = BUILD_COST.ballista.gold;
    reserveWood = BUILD_COST.ballista.wood;
    resourceBias = own.wood < reserveWood ? "wood" : own.gold < reserveGold ? "gold" : "balanced";
  } else if (own.ecoFull && own.barracksBelowMax) {
    ecoGoal = "barracks-upgrade";
    resourceBias = own.gold < 140 && own.wood > 160 ? "gold" : "balanced";
  }

  // 8. Mid-map staging & tactical retreat (#2).
  const mem = assaultMemory[team];
  const keepThreatened =
    (own.keepHpRatio < 0.85 && intel.approachingHome >= 4) || emergencyDefend;
  const alreadyPushing = own.currentLayer === "assault";
  const hasSiege =
    requireTrebs > 0
      ? own.trebs >= requireTrebs || (own.trebs >= 1 && own.rams >= 2)
      : intel.defenseTowers < 2 || own.trebs >= 1 || own.rams >= 1;
  const cappedOut = own.armyUsed >= Math.max(tune.attackAt, own.armyCap - 2);

  // Detect stalled push: siege got sniped OR our assault force got badly outnumbered while keep is healthy.
  const siegeWipedMidPush =
    alreadyPushing &&
    mem.wasAssaulting &&
    mem.hadSiegeOnPush &&
    intel.defenseTowers >= 2 &&
    own.trebs === 0 &&
    own.rams === 0 &&
    own.enemyKeepHpRatio > tune.retreatKeepHp &&
    own.armyUsed >= 7 &&
    !cappedOut;

  const outnumberedMidPush =
    alreadyPushing &&
    intel.totalArmy >= 18 &&
    own.armyUsed < Math.floor(intel.totalArmy * 0.5) &&
    own.enemyKeepHpRatio > tune.retreatKeepHp &&
    !cappedOut;

  if (siegeWipedMidPush || outnumberedMidPush) {
    mem.retreatUntil = own.time + 18;
    mem.wasAssaulting = false;
    mem.hadSiegeOnPush = false;
  }

  const regrouping = own.time < mem.retreatUntil && !cappedOut && own.trebs === 0;
  if (regrouping) {
    stance = "regroup";
  }

  // Army parity discipline: avoid suicide-charging a smaller army into a much larger enemy ball.
  const severelyOutnumbered =
    intel.totalArmy >= 16 &&
    own.armyUsed < Math.floor(intel.totalArmy * 0.72) &&
    own.enemyKeepHpRatio > 0.35;
  const defendUnderTowers =
    severelyOutnumbered && (intel.approachingHome >= 5 || !cappedOut);

  const attackReady =
    !keepThreatened &&
    !regrouping &&
    !defendUnderTowers &&
    (cappedOut ||
      (alreadyPushing && own.armyUsed >= Math.max(6, Math.floor(pushFloor / 2.2))) ||
      (own.armyUsed >= pushFloor && hasSiege));

  let desiredLayer: DefendLayerId;
  if (attackReady) {
    desiredLayer = "assault";
    if (!mem.wasAssaulting) {
      mem.hadSiegeOnPush = own.trebs >= 1 || own.rams >= 2;
    } else if (own.trebs >= 1) {
      mem.hadSiegeOnPush = true;
    }
    mem.wasAssaulting = true;
  } else {
    mem.wasAssaulting = false;
    mem.hadSiegeOnPush = false;
    // Hold midfield/bridges once eco is rolling & we have a real staging force; otherwise defend Home.
    const canHoldMid =
      !keepThreatened &&
      !defendUnderTowers &&
      !regrouping &&
      own.ecoFull &&
      own.armyUsed >= tune.midStageAt &&
      intel.approachingHome < 6;
    desiredLayer = canHoldMid ? "mid" : "home";
  }

  // Normalize percentages cleanly so levy gets the remainder.
  const sum = wardPct + archerPct + runnerPct;
  if (sum > 90) {
    const scale = 90 / sum;
    wardPct = Math.round(wardPct * scale);
    archerPct = Math.round(archerPct * scale);
    runnerPct = Math.round(runnerPct * scale);
  }

  return {
    stance,
    wantBallistas,
    wantCatapults,
    wantBarracks,
    wantTrebs,
    wantRams,
    wantSpies,
    needGuardDogs,
    emergencyDefend,
    bankForTreb,
    wardPct,
    archerPct,
    runnerPct,
    earlyScreenGoal,
    pushFloor,
    requireTrebs,
    upgradePref,
    desiredLayer,
    ecoGoal,
    reserveGold,
    reserveWood,
    resourceBias,
  };
}

export function pickAdaptiveScreenUnit(plan: AdaptivePlan, slot: number): TrainKind {
  const roll = (slot * 17) % 100;
  if (roll < plan.wardPct) return "ward";
  if (roll < plan.wardPct + plan.archerPct) return "archer";
  if (roll < plan.wardPct + plan.archerPct + plan.runnerPct) return "runner";
  return "levy";
}
