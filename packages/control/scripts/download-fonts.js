#!/usr/bin/env node
// Copies JetBrains Mono woff2 files from @fontsource/jetbrains-mono for self-hosting.
// Run: node packages/control/scripts/download-fonts.js

import { copyFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fontsDir = join(__dirname, '..', 'public', 'fonts')
mkdirSync(fontsDir, { recursive: true })

// Resolve @fontsource package from repo root
const srcDir = join(__dirname, '..', '..', '..', 'node_modules', '@fontsource', 'jetbrains-mono', 'files')

const fonts = [
  { src: 'jetbrains-mono-latin-400-normal.woff2', dest: 'JetBrainsMono-Regular.woff2' },
  { src: 'jetbrains-mono-latin-500-normal.woff2', dest: 'JetBrainsMono-Medium.woff2' },
  { src: 'jetbrains-mono-latin-600-normal.woff2', dest: 'JetBrainsMono-SemiBold.woff2' },
  { src: 'jetbrains-mono-latin-700-normal.woff2', dest: 'JetBrainsMono-Bold.woff2' },
]

for (const font of fonts) {
  const src  = join(srcDir, font.src)
  const dest = join(fontsDir, font.dest)
  copyFileSync(src, dest)
  console.log(`  ✔ ${font.dest}`)
}
console.log('Done.')
