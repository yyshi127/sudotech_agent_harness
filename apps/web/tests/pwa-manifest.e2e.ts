import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const record = JSON.parse(await readFile(
    join(REPO_ROOT, '.dsh-build/client-build-environment.json'),
    'utf8',
  )) as { environment: Record<string, string> }
  const environment = record.environment
  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: environment.DSH_CLIENT_PWA_NAME,
    short_name: environment.DSH_CLIENT_PWA_SHORT_NAME,
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: environment.DSH_CLIENT_PWA_ICON_HREF,
      sizes: environment.DSH_CLIENT_PWA_ICON_SIZES,
      type: environment.DSH_CLIENT_PWA_ICON_TYPE,
      purpose: 'any',
    }],
  })
})

it('ships a favicon that switches to a light mark under dark color scheme', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The light fill must live inside the dark-scheme media query, so the icon
  // stays black in light mode and only turns white under a dark scheme.
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*path\s*{[^}]*fill:\s*#fff/i)
  expect(favicon).toContain('fill="#000"')
})
