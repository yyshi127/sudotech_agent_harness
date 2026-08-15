import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { stageRuntimeShadowPlugin } from './plugin-runtime-shadow-fixture.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const sourceBin = join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')

it('refuses a plugin runtime shadow and reports the completed rollback', async () => {
  const fixture = stageRuntimeShadowPlugin()
  try {
    const result = await execa(process.execPath, [
      '--import', 'tsx/esm', sourceBin,
      'plugin', '--profile', 'guard', 'add', fixture.pluginSpec,
    ], {
      input: '',
      timeout: 60_000,
      killSignal: 'SIGKILL',
      reject: false,
      env: { ...process.env, DSH_HOME: fixture.harnessHome },
    })
    const profileDir = join(fixture.harnessHome, 'profiles', 'guard')
    const diagnostics = result.stderr.split(/\r?\n/)
      .filter(line => line.startsWith('dsh:'))
      .map(line => line.replace(profileDir, '{{profileDir}}'))
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as unknown

    expect({
      exitCode: result.exitCode,
      diagnostics,
      manifest,
      lockfilePresent: existsSync(join(profileDir, 'pnpm-lock.yaml')),
      runtimeShadowPresent: existsSync(join(
        profileDir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json',
      )),
    }).toMatchInlineSnapshot(`
      {
        "diagnostics": [
          "dsh: initialized profile guard at {{profileDir}}",
          "dsh: refused incompatible plugin change because it installed app runtime package(s): @deepseek-ai/dsh-app-boot",
          "dsh: plugins must use the app's DSH/Cordis runtime through peerDependencies instead of dependencies",
          "dsh: restored the profile to its pre-install dependency state",
        ],
        "exitCode": 1,
        "lockfilePresent": false,
        "manifest": {
          "dependencies": {},
          "dsh": {
            "profile": {
              "bundles": [
                "@deepseek-ai/dsh-base",
              ],
            },
          },
          "name": "dsh-profile-guard",
          "private": true,
        },
        "runtimeShadowPresent": false,
      }
    `)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}, 90_000)
