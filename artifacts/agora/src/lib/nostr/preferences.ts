/**
 * Privacy-related preferences that need to live outside the in-memory
 * identity store (so they persist across logins and panic wipes only when
 * the user explicitly clears localStorage).
 */

const NIP05_VERIFY_KEY = "agora.privacy.nip05Verification.v1";

export function getNip05Verification(): boolean {
  try {
    return localStorage.getItem(NIP05_VERIFY_KEY) === "true";
  } catch {
    return false;
  }
}

export function setNip05Verification(value: boolean): void {
  try {
    localStorage.setItem(NIP05_VERIFY_KEY, value ? "true" : "false");
  } catch {
    /* ignore quota errors */
  }
}
