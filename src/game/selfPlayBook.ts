/** Win counts from headless CPU vs CPU. The live foe uses the leading style. */
export type AiStyle = "reactive" | "army" | "siege" | "towers" | "doctrine";

export const selfPlayBook: { games: number; wins: Record<AiStyle, number> } = {
  games: 60,
  wins: { reactive: 1, army: 4, siege: 1, towers: 4, doctrine: 47 },
};

export function bestSelfPlayStyle(): AiStyle {
  const entries = Object.entries(selfPlayBook.wins) as [AiStyle, number][];
  const best = Math.max(...entries.map(([, n]) => n));
  const leaders = entries.filter(([, n]) => n === best).map(([name]) => name);
  if (best <= 0 || leaders.length !== 1) return "reactive";
  return leaders[0];
}
