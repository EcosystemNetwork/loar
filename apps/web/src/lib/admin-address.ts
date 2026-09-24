/**
 * Admin wallet allowlist check. Kept in its own tiny module so the root route
 * can gate the (large) admin toolbar chunk without importing the toolbar.
 */
const ADMIN_ADDRESSES = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
  .split(',')
  .map((a: string) => a.trim().toLowerCase())
  .filter(Boolean);

export function isAdminAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  if (ADMIN_ADDRESSES.length === 0) return false;
  return ADMIN_ADDRESSES.includes(address.toLowerCase());
}
