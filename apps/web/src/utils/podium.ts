/**
 * Podium helpers shared by the challenge page leaderboard and the feed's
 * completion post: which medal a final rank earns, and competition ranking
 * ("1224") for a leaderboard already sorted by total, descending.
 */

/** 🏆 for the winner, 🥈/🥉 for the runners-up; null below the podium. */
export const podiumMedal = (rank: number): string | null =>
  rank === 1 ? '🏆' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null

/** Ranks for totals sorted descending: equal totals share a rank and the next rank skips (1, 1, 3). */
export const competitionRanks = (totals: number[]): number[] =>
  totals.map((total) => 1 + totals.filter((other) => other > total).length)
