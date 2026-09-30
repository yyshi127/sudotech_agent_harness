import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { generationLogPath } from '../src/format.ts'
import { compressZstdFrame } from '../src/zstd.ts'

const id = SessionId('xiaojing-finance-v0')
const financeRows = [
  { type: 'finance/client-bound', data: {
    schemaVersion: 1, clientVersion: 1, client: { id: 'client-1' }, workspacePath: '/work/client-1',
  } },
  ...(['finance/file-imported', 'finance/file-published', 'finance/file-archived', 'finance/consultation-file-imported'] as const)
    .map(type => ({ type, data: { schemaVersion: 1, file: { id: type } } })),
] as const

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

it.each([
  [false, 'read'], [false, 'write'], [true, 'read'], [true, 'write'],
] as const)('opens Xiaojing v0 Finance events with pre-step user=%s in %s mode without changing the source', async (preStepUser, access) => {
  root = await mkdtemp(join(tmpdir(), 'dsh-xiaojing-finance-v0-'))
  const path = generationLogPath(root, undefined, id, 0, 'zstd')
  const header = { type: 'session', version: 0, id, createdAt: 1, delegationDepth: 0 }
  const user = { type: 'user/message', data: {
    id: 'question', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }],
  }, surfaceOp: 'append' }
  const rows = [
    ...financeRows,
    { type: 'turn/start', data: { turn: 1 } },
    ...(preStepUser ? [user] : []),
    { type: 'step/start', data: { turn: 1, step: 1 } },
    ...(!preStepUser ? [user] : []),
    { type: 'request/header', data: {
      header: { config: { provider: 'mock', model: 'mock' }, system: 'System' }, reason: 'initial',
    } },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const source = Buffer.concat([
    await compressZstdFrame(JSON.stringify(header) + '\n'),
    await compressZstdFrame(rows.map((row, seq) => JSON.stringify({ ...row, seq, time: seq + 2 })).join('\n') + '\n'),
  ])
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, source)

  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root })
  try {
    const reader = await ctx.sessionPersistence.open(id, access)
    try {
      const result = await reader.read()
      expect(reader.header.version).toBe(SESSION_FORMAT_VERSION)
      expect(result.events.filter(event => event.type.startsWith('finance/')).map(event => ({
        type: event.type, data: event.data,
      }))).toEqual(financeRows)
      const stepSeq = result.events.find(event => event.type === 'step/start')?.seq
      const systemSeq = result.events.find(event => event.type === 'system/message')?.seq
      const userSeq = result.events.find(event => event.type === 'user/message')?.seq
      expect(stepSeq).toBeDefined()
      expect(systemSeq).toBeDefined()
      expect(userSeq).toBeDefined()
      expect(stepSeq!).toBeLessThan(systemSeq!)
      expect(systemSeq!).toBeLessThan(userSeq!)
      if (access === 'write') await reader.flush()
    } finally {
      await reader.close()
    }
  } finally {
    await ctx.fiber.dispose()
  }
  expect(await readFile(path)).toEqual(source)
  const successor = generationLogPath(root, undefined, id, SESSION_FORMAT_VERSION, 'zstd')
  if (access === 'write') expect((await readFile(successor)).length).toBeGreaterThan(0)
  else await expect(readFile(successor)).rejects.toMatchObject({ code: 'ENOENT' })
})
