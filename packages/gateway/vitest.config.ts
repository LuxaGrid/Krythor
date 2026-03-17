import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Run tests against the compiled dist — workspace packages are CJS/ESM
    // mixed and cannot be transpiled by vitest's vite pipeline directly.
    // Instead, resolve workspace packages through their built dist output.
    alias: {
      '@krythor/core':   new URL('../core/dist/index.js',   import.meta.url).pathname,
      '@krythor/memory': new URL('../memory/dist/index.js', import.meta.url).pathname,
      '@krythor/models': new URL('../models/dist/index.js', import.meta.url).pathname,
      '@krythor/guard':  new URL('../guard/dist/index.js',  import.meta.url).pathname,
      '@krythor/skills': new URL('../skills/dist/index.js', import.meta.url).pathname,
    },
  },
})
