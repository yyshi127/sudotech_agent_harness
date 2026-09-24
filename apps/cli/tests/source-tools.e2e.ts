/** Source CLI interop with Loader-resolved plugin artifacts; requires a current build. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const patch = fileURLToPath(new URL('./profiles/headless/tests/fixtures/headless-profile.patch.yml', import.meta.url))

it.each(['src', 'lib'] as const)('dispatches a real tool through the %s CLI and returns its result', async (mode) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-source-tools-'))
  try {
    const launch = resolveExampleLaunch({
      srcBin: join(repoRoot, 'apps/cli/src/bin.ts'), mode, sourceImport: 'tsx/esm',
      tsconfigPath: join(repoRoot, 'tsconfig.json'),
      configArgs: ['headless', '--patch', patch, 'Run the tool round trip.'],
      env: {
        NODE_OPTIONS: undefined, NODE_PATH: undefined,
        DSH_HOME: join(root, 'home'), DSH_AGENTS_HOME: join(root, '.agents'),
        DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'danger-full-access',
        DEEPSEEK_API_KEY: 'keyless-source-tools-no-api-call',
      },
    })
    const result = await execa(launch.command, launch.args, {
      cwd: root, env: launch.env, input: '', timeout: 60_000, killSignal: 'SIGKILL', reject: false,
    })
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.signal, result.stderr).toBeUndefined()
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toBe('CLI tool round trip complete: CLI_TOOL_ROUND_TRIP')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
