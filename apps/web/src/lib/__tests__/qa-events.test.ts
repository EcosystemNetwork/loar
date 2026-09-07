// @vitest-environment jsdom
/**
 * Unit tests for lib/qa-events.ts — the window CustomEvent bus the admin QA
 * tab uses to pop open overlays.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QA_EVENTS, fireQaEvent } from '../qa-events';

afterEach(() => vi.restoreAllMocks());

describe('QA_EVENTS', () => {
  it('namespaces every event under loar:qa:', () => {
    for (const name of Object.values(QA_EVENTS)) {
      expect(name).toMatch(/^loar:qa:/);
    }
    expect(new Set(Object.values(QA_EVENTS)).size).toBe(Object.keys(QA_EVENTS).length);
  });
});

describe('fireQaEvent', () => {
  it('dispatches a CustomEvent on window with the given name', () => {
    const handler = vi.fn();
    window.addEventListener(QA_EVENTS.OPEN_CREDIT_STORE, handler);
    fireQaEvent(QA_EVENTS.OPEN_CREDIT_STORE);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toBeInstanceOf(CustomEvent);
    expect((handler.mock.calls[0][0] as Event).type).toBe(QA_EVENTS.OPEN_CREDIT_STORE);
    window.removeEventListener(QA_EVENTS.OPEN_CREDIT_STORE, handler);
  });

  it('only fires the listener for the matching event name', () => {
    const store = vi.fn();
    const cookie = vi.fn();
    window.addEventListener(QA_EVENTS.OPEN_CREDIT_STORE, store);
    window.addEventListener(QA_EVENTS.OPEN_COOKIE_CONSENT, cookie);
    fireQaEvent(QA_EVENTS.OPEN_GETTING_STARTED);
    expect(store).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
    window.removeEventListener(QA_EVENTS.OPEN_CREDIT_STORE, store);
    window.removeEventListener(QA_EVENTS.OPEN_COOKIE_CONSENT, cookie);
  });
});
