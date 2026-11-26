import type { PlayerProfile } from './player-profile.js';

export const RANK_THRESHOLDS = [
  { name: 'Bronze 1', minimumRating: 0 },
  { name: 'Bronze 2', minimumRating: 765.43 },
  { name: 'Bronze 3', minimumRating: 913.72 },
  { name: 'Silver 1', minimumRating: 1054.87 },
  { name: 'Silver 2', minimumRating: 1188.88 },
  { name: 'Silver 3', minimumRating: 1315.75 },
  { name: 'Gold 1', minimumRating: 1435.48 },
  { name: 'Gold 2', minimumRating: 1548.07 },
  { name: 'Gold 3', minimumRating: 1653.52 },
  { name: 'Platinum 1', minimumRating: 1751.83 },
  { name: 'Platinum 2', minimumRating: 1843 },
  { name: 'Platinum 3', minimumRating: 1927.03 },
  { name: 'Diamond 1', minimumRating: 2003.92 },
  { name: 'Diamond 2', minimumRating: 2073.67 },
  { name: 'Diamond 3', minimumRating: 2136.28 },
  { name: 'Master 1', minimumRating: 2191.75 },
  { name: 'Master 2', minimumRating: 2275 },
  { name: 'Master 3', minimumRating: 2350 },
] as const;

export type PlacedRank = (typeof RANK_THRESHOLDS)[number]['name'];
export type RankName = PlacedRank | 'Grandmaster' | 'Pending' | 'Unranked' | 'Awaiting data';

/**
 * Grandmaster is a dynamic distinction rather than a static rating tier.
 * Slippi exposes dailyGlobalPlacement for players in its global top-300
 * placement set. Keep the signal as an upstream field instead of duplicating
 * the top-300 calculation in this application.
 */
export const GRANDMASTER_MINIMUM_RATING = 2191.75;

/** Slippi placement is considered complete after five ranked games. */
export const PLACEMENT_GAME_COUNT = 5;

/**
 * Convert the numeric rating and ranked record into a display rank.
 *
 * Community implementations use wins + losses (ranked games), not sets, to
 * distinguish pending placement from an established rank.
 */
export function resolveRank(
  profile: Pick<PlayerProfile, 'rating' | 'wins' | 'losses' | 'dailyGlobalPlacement'>,
): RankName {
  if (profile.rating === null || !Number.isFinite(profile.rating) || profile.rating < 0) {
    return 'Unranked';
  }

  const completedGames = (profile.wins ?? 0) + (profile.losses ?? 0);

  if (completedGames === 0) {
    return 'Unranked';
  }

  if (completedGames < PLACEMENT_GAME_COUNT) {
    return 'Pending';
  }

  const hasGlobalPlacement =
    typeof profile.dailyGlobalPlacement === 'number' &&
    Number.isSafeInteger(profile.dailyGlobalPlacement) &&
    profile.dailyGlobalPlacement > 0;

  if (profile.rating >= GRANDMASTER_MINIMUM_RATING && hasGlobalPlacement) {
    return 'Grandmaster';
  }

  for (let index = RANK_THRESHOLDS.length - 1; index >= 0; index -= 1) {
    const threshold = RANK_THRESHOLDS[index];

    if (threshold && profile.rating >= threshold.minimumRating) {
      return threshold.name;
    }
  }

  return 'Unranked';
}

/** Higher values sort earlier on the leaderboard. */
export const RANK_ORDER: readonly RankName[] = [
  'Grandmaster',
  'Master 3',
  'Master 2',
  'Master 1',
  'Diamond 3',
  'Diamond 2',
  'Diamond 1',
  'Platinum 3',
  'Platinum 2',
  'Platinum 1',
  'Gold 3',
  'Gold 2',
  'Gold 1',
  'Silver 3',
  'Silver 2',
  'Silver 1',
  'Bronze 3',
  'Bronze 2',
  'Bronze 1',
  'Pending',
  'Unranked',
  'Awaiting data',
];

const RANK_PRIORITY = new Map<RankName, number>(
  RANK_ORDER.map((rank, index): [RankName, number] => [rank, RANK_ORDER.length - index]),
);

export function compareRanksDescending(left: RankName, right: RankName): number {
  return (RANK_PRIORITY.get(right) ?? 0) - (RANK_PRIORITY.get(left) ?? 0);
}
