/**
 * Normalize a Connect Code for consistent storage and comparisons.
 * Slippi remains the authority for whether the normalized value identifies
 * an existing player.
 *
 * The official separator is '#'. A single ASCII space or hyphen is accepted
 * as a user-friendly substitute and is normalized to '#'.
 */
export function normalizeConnectCode(value: string): string {
  const trimmedValue = value.trim().toUpperCase();
  return trimmedValue.replace(/^([A-Z]{1,7})[ -]([0-9]{1,7})$/, '$1#$2');
}

/** Validate the standard Slippi Connect Code shape. */
export function isValidConnectCode(value: string): boolean {
  return /^[A-Z]{1,7}#[0-9]{1,7}$/.test(normalizeConnectCode(value));
}
