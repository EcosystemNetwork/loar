/**
 * Unit tests for lib/ga.ts — SPA page-view tracking. The privacy-relevant
 * bit is templateToPath: GA must see the route *template*, never a resolved
 * path param (which can be a wallet address).
 */
import { describe, expect, it } from 'vitest';
import { templateToPath, trackPageView } from '../ga';

describe('templateToPath', () => {
  it('rewrites $param segments to :param', () => {
    expect(templateToPath('/analytics/$universeId')).toBe('/analytics/:universeId');
    expect(templateToPath('/universe/$id/watch')).toBe('/universe/:id/watch');
    expect(templateToPath('/event/$universe/$event')).toBe('/event/:universe/:event');
  });

  it('leaves a param-free route untouched', () => {
    expect(templateToPath('/discover')).toBe('/discover');
    expect(templateToPath('/')).toBe('/');
  });

  it('does not touch a literal ":" that is already in the template', () => {
    expect(templateToPath('/x/:already')).toBe('/x/:already');
  });
});

describe('trackPageView', () => {
  it('is a no-op (and never throws) when GA is not enabled, e.g. under test', () => {
    // import.meta.env.PROD is false in vitest → isEnabled() short-circuits.
    expect(() => trackPageView('/universe/$id')).not.toThrow();
  });
});
