/**
 * Normalize a Connect Code for consistent storage and comparisons.
 * Slippi remains the authority for whether the normalized value identifies
 * a valid player; format validation belongs in the Slippi integration layer.
 */
export function normalizeConnectCode(value: string): string {
  return value.trim().toUpperCase();
}
