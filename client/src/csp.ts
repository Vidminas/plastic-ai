import { config } from 'zod/v4/core';

/**
 * Zod 4 (bundled with the MCP Apps bridge) probes for `new Function` the first time it builds
 * an object schema, to compile a faster parser. The CSP allows no `'unsafe-eval'`, so the
 * probe fails when the policy is enforced and logs a violation report when it is report-only.
 * `jitless` skips the probe and keeps the interpreted parser either way. Imported first in
 * `main.jsx`, and bundled into Zod's own chunk (`vite.config.ts`), so it runs before any
 * schema is built.
 */
config({ jitless: true });
