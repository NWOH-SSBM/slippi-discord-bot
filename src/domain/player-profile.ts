/**
 * Profile fields returned by Slippi's ranked Netplay profile.
 * Nullable fields are expected for accounts without an active ranked profile
 * or for placement/ranking information that Slippi does not expose.
 */
export interface PlayerProfile {
  connectCode: string;
  displayName: string;
  rating: number | null;
  ratingUpdateCount: number | null;
  wins: number | null;
  losses: number | null;
  dailyGlobalPlacement: number | null;
  dailyRegionalPlacement: number | null;
  continent: string | null;
}
