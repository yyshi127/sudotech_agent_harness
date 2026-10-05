/** Product upload availability remains disabled after applying a previously saved preference. */
import { fileURLToPath } from 'node:url'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { evaluate, isJsExpr } from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

it.each(['xiaojing', 'web'])('resolves the API Session-log policy for %s with a saved enabled preference', (profile) => {
  const base = loadOverlayPatches('session-log-policy', fileURLToPath(new URL('../../base/cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'session-log-deepseek')
  const web = loadOverlayPatches('session-log-policy', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
  const policy = web.filter(patch => patch.id === 'session-log-deepseek')
  const ui = web.flatMap(patch => patch.insert ?? []).filter(row => row.id === 'ui-settings-session-log')
  expect(base).toHaveLength(1)
  expect(policy).toHaveLength(1)
  expect(ui).toHaveLength(1)
  const rows = applyEntryPatches([...base, ...ui], [...policy, { id: 'session-log-deepseek', config: { enabled: true } }],
    (message) => { throw new Error(message) })
  for (const row of rows) {
    const expression = row.disabled
    if (!isJsExpr(expression)) {
      throw new Error(`Missing deployment policy for ${row.id}`)
    }
    expect(evaluate({ process: { env: { DSH_CLIENT_BUILD_PROFILE: profile } } }, expression.__jsExpr)).toBe(profile === 'xiaojing')
  }
  expect(rows.find(row => row.id === 'session-log-deepseek')!.config).toEqual({ enabled: true })
})
