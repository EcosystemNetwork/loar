/**
 * Setup for the `dom` vitest project (*.test.tsx, jsdom env).
 * Registers @testing-library/jest-dom matchers and auto-unmounts React
 * trees between tests.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
