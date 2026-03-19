// Register tsx's CJS hook so that runtime require() calls inside source files
// (e.g. sqliteCache.ts's inline `require('../config/env')`) can resolve
// TypeScript files in Vitest's ESM environment.
require('tsx/cjs');
