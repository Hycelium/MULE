import type { DoctrineTune } from "./doctrineTune";
import type { AiStyle } from "./selfPlayBook";
import type { BuildingKind, Pad, TrainKind } from "./types";

const LOG_KEY = "roadkeep_human_logs_v1";
const MAX_LOGS = 100;
const GITHUB_REPO = "Hycelium/MULE";

export interface HumanBuildStep {
  t: number;
  kind: BuildingKind | "barricade";
  zone: Pad["zone"] | "road";
}

export interface MatchTimelinePoint {
  t: number;
  youHp: number;
  foeHp: number;
  youArmy: number;
  foeArmy: number;
  youPeons: number;
  foePeons: number;
  youTowers: number;
  foeTowers: number;
  foeTrebs: number;
  foeRams: number;
  foeLayer: string | null;
  foeStance?: string;
}

export interface HumanMatchLog {
  version: 1;
  id: string;
  playedAt: string;
  map: {
    name: string;
    seed: number;
    lanes: number;
    keepLevel: number;
    scoutSalt: number;
  };
  aiStyle: AiStyle;
  doctrineTune: DoctrineTune;
  outcome: {
    humanWon: boolean | null;
    durationSec: number;
    endReason: string;
    waves: number;
    humanKeepHp: number;
    docKeepHp: number;
    humanSlain: number;
    humanGoldEarned: number;
  };
  humanBuildOrder: HumanBuildStep[];
  humanTrained: Partial<Record<TrainKind | "peon", number>>;
  humanUpgrades: {
    towerDamage: number;
    towerRate: number;
    barracksDamage: number;
    barracksRate: number;
  };
  humanPeaks: {
    maxArmy: number;
    maxPeons: number;
    firstCrossSec: number | null;
  };
  timeline: MatchTimelinePoint[];
}

export function loadHumanLogs(): HumanMatchLog[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HumanMatchLog[]) : [];
  } catch {
    return [];
  }
}

export function saveHumanLog(entry: HumanMatchLog): void {
  try {
    const logs = loadHumanLogs();
    logs.push(entry);
    const trimmed = logs.slice(-MAX_LOGS);
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
  } catch {
    /* private mode or quota full — ignore */
  }
}

export function humanRecordSummary() {
  const logs = loadHumanLogs();
  let docWins = 0;
  let humanWins = 0;
  for (const log of logs) {
    if (log.outcome.humanWon === true) humanWins++;
    else if (log.outcome.humanWon === false) docWins++;
  }
  return { total: logs.length, docWins, humanWins };
}

export function exportHumanLogsJson(): string {
  return JSON.stringify(
    {
      schema: "roadkeep-human-logs-v1",
      exportedAt: new Date().toISOString(),
      matches: loadHumanLogs(),
    },
    null,
    2,
  );
}

export function downloadHumanLogs(): boolean {
  if (typeof document === "undefined") return false;
  const json = exportHumanLogsJson();
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `doctrine-human-logs-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export function buildGithubIssueUrl(entry?: HumanMatchLog): string {
  const logs = loadHumanLogs();
  const target = entry ?? logs[logs.length - 1];
  if (!target) {
    return `https://github.com/${GITHUB_REPO}/issues/new`;
  }
  const result = target.outcome.humanWon === true ? "Human Win" : target.outcome.humanWon === false ? "Doc Win" : "Draw";
  const title = `Human Match Log: ${result} vs ${target.aiStyle} on ${target.map.name} (${target.outcome.durationSec}s)`;
  // Trim timeline if needed so the URL stays safely under browser length limits.
  const compact: HumanMatchLog = {
    ...target,
    timeline: target.timeline.slice(0, 24),
  };
  const body = [
    `Auto-exported from Roadkeep (GitHub Pages) for Doctrine training.`,
    ``,
    "```json",
    JSON.stringify(compact),
    "```",
  ].join("\n");
  const params = new URLSearchParams({ title, body });
  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
}
