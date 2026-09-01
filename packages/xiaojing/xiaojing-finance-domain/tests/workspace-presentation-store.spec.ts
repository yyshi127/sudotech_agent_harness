import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FinanceWorkspacePresentationStore } from '../src/workspace-presentation-store.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function store(): Promise<{ root: string; value: FinanceWorkspacePresentationStore }> {
  const root = await mkdtemp(join(tmpdir(), 'finance-workspace-presentation-'))
  roots.push(root)
  const value = new FinanceWorkspacePresentationStore(root)
  await value.init()
  return { root, value }
}

describe('FinanceWorkspacePresentationStore', () => {
  it('persists independent rename and list-membership overrides', async () => {
    const { root, value } = await store()
    await value.rename('client:alpha', '甲公司工作区')
    await value.remove('client:alpha')

    const restarted = new FinanceWorkspacePresentationStore(root)
    await restarted.init()
    expect(await restarted.list()).toEqual([{
      key: 'client:alpha',
      title: '甲公司工作区',
      listed: false,
    }])

    await restarted.restore('client:alpha')
    expect(await restarted.list()).toEqual([{
      key: 'client:alpha',
      title: '甲公司工作区',
      listed: true,
    }])
  })

  it('rejects corrupt durable data without overwriting it', async () => {
    const { value } = await store()
    const corrupt = '{"schemaVersion":1,"revision":0,"workspaces":[{"key":"x","listed":false},{"key":"x","listed":true}]}\n'
    await mkdir(dirname(value.filePath), { recursive: true })
    await writeFile(value.filePath, corrupt, 'utf8')

    await expect(value.list()).rejects.toThrow(/duplicate Finance workspace key/)
    expect(await readFile(value.filePath, 'utf8')).toBe(corrupt)
  })
})
