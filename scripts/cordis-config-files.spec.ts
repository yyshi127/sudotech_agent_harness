import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cordisConfigFiles } from './cordis-config-files.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('cordisConfigFiles', () => {
  it('finds Loader YAML without treating translation records as configs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-config-files-'))
    roots.push(root)
    for (const directory of [
      '.claude', 'apps/cli/config/examples', 'docs', 'node_modules/pkg', 'vendor/pkg',
      'packages/example/lib', 'apps/desktop/dist', 'apps/desktop/.desktop-build',
      'packages/example/node_modules/pkg', 'tmp/profiles', 'snapshots/session/example',
    ]) {
      mkdirSync(join(root, directory), { recursive: true })
    }
    for (const file of [
      '.claude/hidden.cordis.yml',
      'docs/cordis-primer.i18n.yaml',
      'apps/cli/config/examples/agent.cordis.yaml',
      'apps/cli/config/examples/headless.cordis.yml',
      'node_modules/pkg/hidden.cordis.yml',
      'vendor/pkg/hidden.cordis.yml',
      'packages/example/lib/hidden.cordis.yml',
      'apps/desktop/dist/hidden.cordis.yml',
      'apps/desktop/.desktop-build/hidden.cordis.yml',
      'packages/example/node_modules/pkg/hidden.cordis.yml',
      'tmp/profiles/hidden.cordis.yml',
      'snapshots/session/example/cordis.yml',
    ]) {
      writeFileSync(join(root, file), '[]\n')
    }

    expect(cordisConfigFiles(root)).toEqual([
      join('apps', 'cli', 'config', 'examples', 'agent.cordis.yaml'),
      join('apps', 'cli', 'config', 'examples', 'headless.cordis.yml'),
      join('snapshots', 'session', 'example', 'cordis.yml'),
    ])
  })
})
