import { defineConfig } from 'tsup';
import { cpSync, mkdirSync } from 'fs';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  // Do not bundle better-sqlite3 — it is a native addon and must be required at runtime
  external: ['better-sqlite3'],
  async onSuccess() {
    // Copy SQL migration files to dist/migrations so MigrationRunner can find them.
    // In the bundled CJS output, __dirname resolves to dist/ and MigrationRunner
    // uses join(__dirname, 'migrations'), so files must live at dist/migrations/.
    mkdirSync('dist/migrations', { recursive: true });
    cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
  },
});
