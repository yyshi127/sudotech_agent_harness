/** Pack the real manifests and read required runtime assets from clean extracted packages. */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFixtureSafely } from '../test-fixture-cleanup.ts'

const root = resolve(import.meta.dirname, '../..')
const pnpm = join(root, 'node_modules/pnpm/bin/pnpm.cjs')
const fixtures: string[] = []

afterEach(() => {
  for (const path of fixtures.splice(0)) removeFixtureSafely(path)
})

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 30_000, windowsHide: true })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr || result.stdout).toBe(0)
  return result.stdout
}

describe('Xiaojing published runtime assets', () => {
  it.each([
    {
      directory: 'packages/xiaojing/xiaojing-visualize',
      files: [
        'assets/visualize-skill.md', 'assets/references/design.md', 'assets/references/charts.md',
        'assets/examples/comparison-chart.html', 'assets/examples/interactive-simulator.html',
      ],
      excluded: ['assets/demo.mp4', 'assets/demo.webp', 'assets/social-preview.jpg'],
    },
    {
      directory: 'packages/xiaojing/xiaojing-browser-control',
      files: [
        'extension/manifest.json', 'extension/service-worker.js',
        'extension/popup.html', 'extension/popup.js', 'extension/popup.css',
      ],
      excluded: [],
    },
  ])('keeps required files in a clean $directory package', ({ directory, files, excluded }) => {
    const scratch = mkdtempSync(join(tmpdir(), 'xiaojing-packed-assets-'))
    fixtures.push(scratch)
    const packed = join(scratch, 'packed')
    const extracted = join(scratch, 'extracted')
    mkdirSync(packed)
    mkdirSync(extracted)
    run(process.execPath, [pnpm, '--dir', join(root, directory), 'pack', '--pack-destination', packed])
    const tarballs = readdirSync(packed).filter(file => file.endsWith('.tgz'))
    expect(tarballs).toHaveLength(1)
    const archive = join(packed, tarballs[0] ?? '')
    const members = run('tar', ['-tzf', archive]).trim().split(/\r?\n/u)
    run('tar', ['-xzf', archive, '-C', extracted])
    for (const path of files) {
      expect(members).toContain(`package/${path}`)
      expect(readFileSync(join(extracted, 'package', path))).toEqual(readFileSync(join(root, directory, path)))
    }
    for (const path of excluded) expect(members).not.toContain(`package/${path}`)
  }, 45_000)
})
