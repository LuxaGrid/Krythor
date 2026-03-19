import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/setup.ts'],
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  noExternal: [/^(?!better-sqlite3$|@krythor\/).+/],
});
