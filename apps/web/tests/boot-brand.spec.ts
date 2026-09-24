import { afterEach, expect, it, vi } from 'vitest'
import type { Plugin } from 'vite'

afterEach(() => {
  vi.unstubAllEnvs()
})

it.each([true, false])('supplies boot metadata before plugins activate (branded=%s)', async (branded) => {
  vi.stubEnv('DSH_CLIENT_BOOT_LOGO', branded ? '/sudo-logo-gray.png' : '')
  vi.stubEnv('DSH_CLIENT_BOOT_LOGO_ALT', branded ? '数豆科技' : '')
  vi.stubEnv('DSH_CLIENT_FAVICON', '')
  vi.resetModules()
  const { default: config } = await import('../vite.config.ts')
  const plugin = config.plugins?.flat().find(candidate => candidate && 'name' in candidate
    && candidate.name === 'dsh-client-document-title') as Plugin
  const hook = plugin.transformIndexHtml
  if (typeof hook !== 'function') throw new Error('Missing document metadata transform')
  const result = await hook('<title>DSH Local Build</title>', { path: '/', filename: 'index.html' })
  if (typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected HTML and metadata tags')
  if (branded) {
    expect(result.tags).toEqual([
      { tag: 'meta', attrs: { name: 'dsh-boot-logo', content: '/sudo-logo-gray.png' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'dsh-boot-logo-alt', content: '数豆科技' }, injectTo: 'head' },
    ])
  } else {
    expect(result.tags).toEqual([])
  }
})

it.each([undefined, '', '  ', ' /xiaojing-character-logo.png '].flatMap(favicon =>
  ['/favicon.svg', './favicon.svg'].map(original => ({ favicon, original }))))(
  'selects the browser tab icon before plugins activate ($favicon, $original)', async ({ favicon, original }) => {
    vi.stubEnv('DSH_CLIENT_BOOT_LOGO', '')
    vi.stubEnv('DSH_CLIENT_FAVICON', favicon)
    vi.resetModules()
    const { default: config } = await import('../vite.config.ts')
    const plugin = config.plugins?.flat().find(candidate => candidate && 'name' in candidate
      && candidate.name === 'dsh-client-document-title') as Plugin
    const hook = plugin.transformIndexHtml
    if (typeof hook !== 'function') throw new Error('Missing document metadata transform')
    const originalIcon = `<link rel="icon" type="image/svg+xml" href="${original}" />`
    const result = await hook(originalIcon, { path: '/', filename: 'index.html' })
    if (typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected HTML and metadata tags')
    if (favicon?.trim()) {
      expect(result.html).not.toContain(originalIcon)
      expect(result.tags).toEqual([
        { tag: 'link', attrs: { rel: 'icon', href: '/xiaojing-character-logo.png' }, injectTo: 'head' },
      ])
    } else {
      expect(result.html).toBe(originalIcon)
      expect(result.tags).toEqual([])
    }
  },
)
