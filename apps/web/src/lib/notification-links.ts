/** Where a notification should take the user, when it points at something with a page. */
export function notificationTokenAddress(n: {
  targetType?: string | null;
  targetId?: string | null;
}): string | null {
  if (n.targetType !== 'token' || !n.targetId) return null;
  return /^0x[0-9a-fA-F]{40}$/.test(n.targetId) ? n.targetId : null;
}
