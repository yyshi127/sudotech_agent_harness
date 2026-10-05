import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { stageRuntimeShadowPlugin } from './plugin-runtime-shadow-fixture.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const sourceBin = join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')

it('refuses an incompatible DSH peer before changing profile dependencies', async () => {
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
      .map(line => line.replace(profileDir, '{{profileDir}}').replaceAll('\\', '/')
        .replace(/\/operation-[^/]+\//u, '/operation-{{id}}/'))
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
          "dsh: installation rejected: Plugin incompatible-bundle@1.0.0 is incompatible with dsh 0.2.0-rc.2: peerDependencies {"@deepseek-ai/dsh-app-boot":"^99.0.0"}. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for incompatible-bundle@1.0.0 on dsh 0.2.0-rc.2 with \`dsh plugin allow-version\` or the plugin manager, then retry the installation or restart dsh. Exact-version exemption: not active.",
          "dsh: nothing was installed.",
          "dsh: to accept the risk, run: dsh plugin --profile guard allow-version incompatible-bundle@1.0.0 --dsh-version 0.2.0-rc.2 --accept-risk",
          "dsh: plugin command failed; diagnostics: {{profileDir}}/.plugin-manager/logs/operation-{{id}}/pnpm.log",
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
