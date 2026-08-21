import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
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
})
