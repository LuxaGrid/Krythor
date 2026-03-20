import { defineConfig } from 'tsup';
import { cpSync, mkdirSync } from 'fs';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  // Do not bundle better-sqlite3 — it is a native addon and must be required at runtime.
  // noExternal bundles all other JS deps inline so node_modules is not needed in dist.
  external: ['better-sqlite3'],
  noExternal: [/^(?!better-sqlite3$|@krythor\/).+/],
  async onSuccess() {
    // Copy SQL migration files to dist/migrations so MigrationRunner can find them.
    mkdirSync('dist/migrations', { recursive: true });
    cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
  },
});
