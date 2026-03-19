import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  // Bundle all JS dependencies inline — removes need for node_modules in dist.
  // Externals: native addon (better-sqlite3) and workspace packages (each bundles itself).
  noExternal: [/^(?!better-sqlite3$|@krythor\/).+/],
});
