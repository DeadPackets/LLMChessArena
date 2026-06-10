// Lightweight admin-mode helper. The admin token is a shared secret matching the
// server's ADMIN_TOKEN; when present it unlocks destructive actions (e.g. deleting
// broken games). It is stored only in localStorage and sent via the X-Admin-Token
// header — never placed in a request body or query string.

const ADMIN_TOKEN_KEY = "chess_admin_token";

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    /* ignore (private mode / storage disabled) */
  }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function isAdmin(): boolean {
  return !!getAdminToken();
}

/**
 * Bootstrap admin mode from a `?admin=<token>` URL param, then strip it from the
 * address bar/history so the secret doesn't linger. `?admin=logout` clears it.
 * Returns true if the admin token changed (so callers can re-render).
 */
export function captureAdminTokenFromUrl(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("admin")) return false;
    const value = params.get("admin") ?? "";
    if (value === "logout" || value === "clear" || value === "") {
      clearAdminToken();
    } else {
      setAdminToken(value);
    }
    // Remove the param from the URL without a navigation.
    params.delete("admin");
    const qs = params.toString();
    const newUrl =
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState({}, "", newUrl);
    return true;
  } catch {
    return false;
  }
}
