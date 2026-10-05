import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { webClientProfile } from './scaffold.ts'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))
const XIAOJING = webClientProfile() === 'xiaojing'

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  const filename = XIAOJING ? 'xiaojing-manifest.webmanifest' : 'manifest.webmanifest'
  expect(index).toContain(`<link rel="manifest" href="./${filename}" />`)

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, filename), 'utf8'))
  // No `id`: a browser resolves an explicit `id` against the start URL's origin,
  // so only an absent `id`, which defaults to the resolved `start_url`, gives
  // each mount its own identity. `public-mount.e2e.ts` reads the resolved form.
  expect(manifest).toEqual({
    name: XIAOJING ? '小兢会计-您的AI办公搭子' : 'DeepSeek Harness',
    short_name: XIAOJING ? '小兢会计' : 'DSH',
    start_url: './',
    scope: './',
    display: 'fullscreen',
    icons: [{
      src: XIAOJING ? 'xiaojing-character-logo.png' : 'favicon.svg',
      sizes: XIAOJING ? '1254x1254' : 'any',
      type: XIAOJING ? 'image/png' : 'image/svg+xml',
      purpose: 'any',
    }],
  })
})

it(webClientProfile() === 'xiaojing'
  ? 'ships the Xiaojing character icon without theme-specific replacements'
  : 'ships fixed-color favicons selected by document media queries', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  if (webClientProfile() === 'xiaojing') {
    expect(index).toContain('<link rel="icon" href="./xiaojing-character-logo.png">')
    expect(index.match(/<link\b[^>]*\brel="icon"[^>]*>/gu)).toHaveLength(1)
    expect(index).not.toContain('href="./favicon-dark.svg"')
    expect(index).not.toContain('href="./favicon.svg"')
    expect(await readFile(join(DIST_ROOT, 'xiaojing-character-logo.png')))
      .toEqual(await readFile(new URL('../public/xiaojing-character-logo.png', import.meta.url)))
    const icon = await readFile(join(DIST_ROOT, 'xiaojing-character-logo.png'))
    expect([icon.readUInt32BE(16), icon.readUInt32BE(20)]).toEqual([1254, 1254])
    return
  }
  expect(index).toContain('<link rel="icon" type="image/svg+xml" href="./favicon-dark.svg" media="(prefers-color-scheme: dark)" />')
  expect(index).toContain('<link rel="icon" type="image/svg+xml" href="./favicon.svg" media="(prefers-color-scheme: light)" />')
  const light = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  const dark = await readFile(join(DIST_ROOT, 'favicon-dark.svg'), 'utf8')
  expect(light).not.toContain('<style>')
  expect(light).toContain('fill="#000"')
  expect(dark).toContain('fill="#fff"')
  expect(dark.replace('fill="#fff"', 'fill="#000"')).toBe(light)
})
