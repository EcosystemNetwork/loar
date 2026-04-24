/**
 * QA command events fired by the admin toolbar's QA tab.
 * Overlays that want to be openable from QA listen for their event
 * on `window` and flip their local open state.
 */
export const QA_EVENTS = {
  OPEN_CREDIT_STORE: 'loar:qa:open-credit-store',
  OPEN_GETTING_STARTED: 'loar:qa:open-getting-started',
  OPEN_COOKIE_CONSENT: 'loar:qa:open-cookie-consent',
} as const;

export type QaEventName = (typeof QA_EVENTS)[keyof typeof QA_EVENTS];

export function fireQaEvent(name: QaEventName) {
  window.dispatchEvent(new CustomEvent(name));
}
