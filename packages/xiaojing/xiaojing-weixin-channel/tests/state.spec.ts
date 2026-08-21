import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyWeixinState, WeixinInstanceLease, WeixinStateStore } from '../src/state.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-weixin-'))
  roots.push(value)
  return value
}

describe('Weixin private state', () => {
  it('returns an empty v2 state when no state file exists', async () => {
    const dir = await root()
    const store = new WeixinStateStore(join(dir, 'missing', 'state.json'))

    await expect(store.load()).resolves.toEqual(emptyWeixinState())
  })

  it('atomically round-trips schema v2 media metadata without a bot token field', async () => {
    const dir = await root()
    const filename = join(dir, 'state.json')
    const store = new WeixinStateStore(filename)
    const state = {
      ...emptyWeixinState(),
      accountId: 'bot@im.bot',
      ownerUserId: 'owner',
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      sessionId: '7cae5e58-e87c-438e-b5d5-006114a9ef79',
      pending: [{
        id: 'message:1', rpcId: '57fe0bed-ad48-419a-a68d-6a302b28b752',
        fromUserId: 'owner', contextToken: 'private-context', text: '查账',
        attachments: [{
          kind: 'file' as const,
          name: '账单.xlsx',
          path: join(dir, 'uploads', '账单.xlsx'),
          mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          bytes: 123,
        }],
        receivedAt: 1, phase: 'received' as const,
      }],
    }
    await store.save(state)
    await expect(store.load()).resolves.toEqual(state)
    expect(await readFile(filename, 'utf8')).not.toContain('bot_token')
  })

  it('atomically migrates schema v1 text tasks to schema v2', async () => {
    const dir = await root()
    const filename = join(dir, 'state.json')
    const store = new WeixinStateStore(filename)
    await writeFile(filename, `${JSON.stringify({
      schemaVersion: 1,
      sessionReady: false,
      updatesCursor: '',
      pending: [{
        id: 'message:1', rpcId: '57fe0bed-ad48-419a-a68d-6a302b28b752',
        fromUserId: 'owner', contextToken: 'private-context', text: '查账',
        receivedAt: 1, phase: 'received',
      }],
      completedMessageIds: [],
    })}\n`)
    const migrated = await store.load()
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.pending[0]?.attachments).toEqual([])
    expect(JSON.parse(await readFile(filename, 'utf8'))).toMatchObject({ schemaVersion: 2 })
  })

  it('fails loud and preserves an unsupported file', async () => {
    const dir = await root()
    const filename = join(dir, 'state.json')
    const store = new WeixinStateStore(filename)
    await writeFile(filename, '{"schemaVersion":3}\n')
    await expect(store.load()).rejects.toThrow('状态文件无法读取')
    expect(await readFile(filename, 'utf8')).toBe('{"schemaVersion":3}\n')
  })

  it('fails loud on malformed JSON and rejects invalid state before writing', async () => {
    const dir = await root()
    const filename = join(dir, 'state.json')
    const store = new WeixinStateStore(filename)
    await writeFile(filename, '{')

    await expect(store.load()).rejects.toThrow('状态文件无法读取')
    await expect(store.save({ ...emptyWeixinState(), sessionReady: 'yes' } as never)).rejects.toThrow()
    expect(await readFile(filename, 'utf8')).toBe('{')
  })

  it('contains a non-Error parser failure in the public state error', async () => {
    const dir = await root()
    const filename = join(dir, 'state.json')
    await writeFile(filename, '{}')
    const parse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => { throw 'plain parser failure' })

    await expect(new WeixinStateStore(filename).load()).rejects.toThrow('plain parser failure')
    parse.mockRestore()
  })

  it('allows only one live process lease and releases it explicitly', async () => {
    const dir = await root()
    const filename = join(dir, 'channel.lock')
    const first = new WeixinInstanceLease(filename)
    const second = new WeixinInstanceLease(filename)
    await expect(first.acquire()).resolves.toBe(true)
    await expect(second.acquire()).resolves.toBe(false)
    await first.release()
    await expect(second.acquire()).resolves.toBe(true)
    await second.release()
  })

  it('rejects malformed and invalid live lease records', async () => {
    const dir = await root()
    const malformedPath = join(dir, 'malformed.lock')
    await writeFile(malformedPath, '{')
    await expect(new WeixinInstanceLease(malformedPath).acquire()).resolves.toBe(false)

    const invalidPath = join(dir, 'invalid.lock')
    await writeFile(invalidPath, JSON.stringify({ pid: 0, startedAt: 1 }))
    await expect(new WeixinInstanceLease(invalidPath).acquire()).resolves.toBe(false)
  })

  it('propagates a lock creation failure other than an existing lease', async () => {
    const dir = await root()
    const invalidPath = `${join(dir, 'invalid')}\0.lock`

    await expect(new WeixinInstanceLease(invalidPath).acquire()).rejects.toThrow()
  })

  it('treats EPERM as a live process and recovers a dead-process lease', async () => {
    const dir = await root()
    const livePath = join(dir, 'live.lock')
    await writeFile(livePath, JSON.stringify({ pid: 999_001, startedAt: 1 }))
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' })
    })

    await expect(new WeixinInstanceLease(livePath).acquire()).resolves.toBe(false)

    kill.mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ESRCH' })
    })
    const deadPath = join(dir, 'dead.lock')
    await writeFile(deadPath, JSON.stringify({ pid: 999_002, startedAt: 1 }))
    const recovered = new WeixinInstanceLease(deadPath)
    await expect(recovered.acquire()).resolves.toBe(true)
    kill.mockRestore()
    await recovered.release()
  })

  it('releases only an owned lease that still names this process', async () => {
    const dir = await root()
    await expect(new WeixinInstanceLease(join(dir, 'never-owned.lock')).release()).resolves.toBeUndefined()

    const corruptPath = join(dir, 'corrupt-on-release.lock')
    const corrupt = new WeixinInstanceLease(corruptPath)
    await corrupt.acquire()
    await writeFile(corruptPath, '{')
    await expect(corrupt.release()).resolves.toBeUndefined()
    expect(await readFile(corruptPath, 'utf8')).toBe('{')

    const foreignPath = join(dir, 'foreign-on-release.lock')
    const foreign = new WeixinInstanceLease(foreignPath)
    await foreign.acquire()
    await writeFile(foreignPath, JSON.stringify({ pid: process.pid + 1, startedAt: 1 }))
    await foreign.release()
    expect(await readFile(foreignPath, 'utf8')).toContain(String(process.pid + 1))
  })
})
