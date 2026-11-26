/**
 * Normalize a Connect Code for consistent storage and comparisons.
 * Slippi remains the authority for whether the normalized value identifies
 * a valid player; use isValidConnectCode() for syntax validation.
 */
export function normalizeConnectCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Validate the standard Slippi Connect Code shape: 1–7 letters, #, and 1–7
 * digits.
 */
export function isValidConnectCode(value: string): boolean {
  return /^[A-Z]{1,7}#[0-9]{1,7}$/.test(normalizeConnectCode(value));
}
