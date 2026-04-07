// Global test setup for indexer tests.
// Ponder virtual modules are aliased via vitest.config.ts resolve.alias.
// Nothing additional needed here for now, but keeping the file for future mocks.
import { vi } from 'vitest';

// Suppress expected console.error calls from handlers that fall back gracefully
vi.spyOn(console, 'error').mockImplementation(() => {});
