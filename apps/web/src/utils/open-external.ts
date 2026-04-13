/**
 * Open a URL in a new tab without triggering popup blockers.
 *
 * Uses a temporary anchor element instead of window.open(), which browsers
 * treat as a user-initiated navigation and never block.
 */
export function openExternal(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
