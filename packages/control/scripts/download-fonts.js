#!/usr/bin/env node
// Downloads JetBrains Mono woff2 files for self-hosting
// Run: node packages/control/scripts/download-fonts.js

import { createWriteStream, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fontsDir = join(__dirname, '..', 'public', 'fonts')
mkdirSync(fontsDir, { recursive: true })

const fonts = [
  {
    url: 'https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjOVSQeA.woff2',
    file: 'JetBrainsMono-Regular.woff2'
  },
  {
    url: 'https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8SKxjOVSQeA.woff2',
    file: 'JetBrainsMono-Medium.woff2'
  },
  {
    url: 'https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8-axjOVSQeA.woff2',
    file: 'JetBrainsMono-SemiBold.woff2'
  },
  {
    url: 'https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8IaxjOVSQeA.woff2',
    file: 'JetBrainsMono-Bold.woff2'
  },
]

for (const font of fonts) {
  const dest = join(fontsDir, font.file)
  console.log(`Downloading ${font.file}...`)
  await new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    https.get(font.url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        https.get(res.headers.location, res2 => {
          res2.pipe(file)
          file.on('finish', () => { file.close(); resolve() })
        }).on('error', reject)
      } else {
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
      }
    }).on('error', reject)
  })
  console.log(`  -> ${dest}`)
}
console.log('Done.')
