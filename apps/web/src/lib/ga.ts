/**
 * Google Analytics 4 page-view tracking for this SPA.
 *
 * gtag.js is loaded from index.html; this module fires manual page_view events
 * on every route change with the route template (e.g. "/analytics/:universeId")
 * instead of the resolved URL, so wallet addresses and other path params never
 * reach GA.
 *
 * Requires: gtag-init.js sets `send_page_view: false` to avoid double-counting
 * the initial load, and GA4 Enhanced Measurement "page changes based on
 * browser history events" must be DISABLED in the dashboard.
 */

declare global {
  interface Window {
    gtag?: (command: string, eventOrId: string, params?: Record<string, unknown>) => void;
    dataLayer?: unknown[];
  }
}

function isEnabled(): boolean {
  if (!import.meta.env.PROD) return false;
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return false;
  return typeof window.gtag === 'function';
}

function templateToPath(template: string): string {
  return template.replace(/\$(\w+)/g, ':$1');
}

export function trackPageView(template: string): void {
  if (!isEnabled()) return;
  const page_path = templateToPath(template);
  window.gtag!('event', 'page_view', {
    page_path,
    page_title: document.title,
    page_location: `${window.location.origin}${page_path}`,
  });
}
