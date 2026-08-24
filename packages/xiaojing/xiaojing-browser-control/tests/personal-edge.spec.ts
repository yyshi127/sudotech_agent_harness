import { createHmac, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebSocket } from 'ws'
import type { RawData } from 'ws'
import {
  PERSONAL_EDGE_EXTENSION_ID,
  PERSONAL_EDGE_PROTOCOL_VERSION,
  PersonalEdgeAdapter,
} from '../src/personal-edge.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.useRealTimers()
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

function credentials(initial?: string) {
  let value = initial
  return {
    service: {
      resolve: async () => value === undefined ? undefined : { value, source: 'memory' },
      set: async (_ref: string, next: string) => { value = next },
      unset: async () => { value = undefined },
    },
    current: () => value,
  }
}

async function adapter(initialSecret?: string) {
  const ctx = new Context()
  const secret = credentials(initialSecret)
  ctx.provide('credentials', secret.service as never)
  const value = new PersonalEdgeAdapter(ctx, 'C:\\xiaojing-edge-extension')
  await value.start()
  cleanup.push(async () => {
    await value.disconnect().catch(() => undefined)
    await value.close()
    await ctx.fiber.dispose()
  })
  const port = (value as unknown as { port: number }).port
  return { value, secret, port }
}

async function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}`)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

async function message(socket: WebSocket): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off('message', onMessage)
      reject(error)
    }
    const onMessage = (data: RawData) => {
      socket.off('error', onError)
      try {
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : data instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(data)).toString('utf8')
            : data.toString('utf8')
        resolve(JSON.parse(text) as Record<string, unknown>)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    socket.once('message', onMessage)
    socket.once('error', onError)
  })
}

function proof(secret: string, participant: 'extension' | 'host', nonce: string): string {
  return createHmac('sha256', secret).update(`${participant}:${nonce}`).digest('base64url')
}

function hello(
  socket: WebSocket,
  fields: Partial<{ extensionId: string; protocol: number; version: string; secret: string }> = {},
): string {
  const nonce = randomBytes(32).toString('base64url')
  socket.send(JSON.stringify({
    type: 'hello',
    extensionId: fields.extensionId ?? PERSONAL_EDGE_EXTENSION_ID,
    protocol: fields.protocol ?? PERSONAL_EDGE_PROTOCOL_VERSION,
    version: fields.version ?? '0.2.1',
    nonce,
    ...(fields.secret === undefined ? {} : { proof: proof(fields.secret, 'extension', nonce) }),
  }))
  return nonce
}

describe('personal Edge bridge', () => {
  it('pairs once, stores only the long-term secret, and detaches after a task', async () => {
    const { value, secret, port } = await adapter()
    value.startPairing()
    const pairing = value.snapshot(false).personal
    expect(pairing.pairingCode).toMatch(/^[A-Z2-9]{8}$/u)
    expect(pairing.pairingExpiresAt).toBeGreaterThan(Date.now())

    const socket = await connect(port)
    hello(socket)
    await expect(message(socket)).resolves.toMatchObject({ type: 'hello-result', state: 'pairing-required' })
    socket.send(JSON.stringify({ type: 'pair', code: pairing.pairingCode }))
    const paired = await message(socket)
    expect(paired).toMatchObject({ type: 'pair-result', ok: true })
    expect(typeof paired.secret).toBe('string')
    expect(secret.current()).toBe(paired.secret)
    expect(value.snapshot(false).personal).toMatchObject({ state: 'connected', connected: true, paired: true })

    const pagesPromise = value.pages()
    const tabsRequest = await message(socket)
    expect(tabsRequest).toMatchObject({ type: 'request', method: 'tabs' })
    socket.send(JSON.stringify({
      type: 'response', id: tabsRequest.id, ok: true,
      value: [{ tabId: 7, windowId: 3, openerTabId: 5, url: 'https://example.com/report', title: 'Report', active: true }],
    }))
    const page = (await pagesPromise)[0]
    if (page === undefined) throw new Error('personal Edge fixture did not return a page')
    expect(page.openerTabId).toBe(5)

    const acquirePromise = value.acquire(page)
    const attachRequest = await message(socket)
    expect(attachRequest).toMatchObject({ type: 'request', method: 'attach' })
    socket.send(JSON.stringify({ type: 'response', id: attachRequest.id, ok: true, value: null }))
    await acquirePromise

    const observationPromise = value.observe(page, 40, 2_000)
    const observationRequest = await message(socket)
    expect(observationRequest).toMatchObject({ type: 'request', method: 'observe' })
    socket.send(JSON.stringify({
      type: 'response', id: observationRequest.id, ok: true,
      value: {
        url: page.url,
        title: page.title,
        text: 'Expense report',
        truncated: false,
        targets: [{
          frameId: 0,
          role: 'button',
          name: 'Edit',
          context: 'row: Expense 1',
          inputType: '',
          ordinal: 0,
          disabled: false,
          actions: ['click', 'hover'],
        }],
      },
    }))
    const observation = await observationPromise
    expect(observation).toMatchObject({ text: 'Expense report', targets: [{ target: { name: 'Edit' } }] })
    const edit = observation.targets[0]
    if (edit === undefined) throw new Error('personal Edge observation did not return the edit target')

    const actPromise = value.act(page, { action: 'click', descriptor: edit.descriptor })
    const actRequest = await message(socket)
    expect(actRequest).toMatchObject({ type: 'request', method: 'act' })
    socket.send(JSON.stringify({ type: 'response', id: actRequest.id, ok: true, value: null }))
    await actPromise

    const showPromise = value.show(page)
    const showRequest = await message(socket)
    expect(showRequest).toMatchObject({ type: 'request', method: 'show' })
    socket.send(JSON.stringify({ type: 'response', id: showRequest.id, ok: true, value: null }))
    await showPromise

    const cancelled = new AbortController()
    const waiting = value.act(page, { action: 'wait_for', expectedText: 'Never appears', timeoutMs: 30_000 }, cancelled.signal)
    const rejectedWaiting = expect(waiting).rejects.toThrow(/test task cancelled/u)
    const waitRequest = await message(socket)
    expect(waitRequest).toMatchObject({ type: 'request', method: 'act' })
    cancelled.abort(new Error('test task cancelled'))
    await expect(message(socket)).resolves.toMatchObject({ type: 'cancel', id: waitRequest.id })
    await rejectedWaiting

    const releasePromise = value.release(page)
    const detachRequest = await message(socket)
    expect(detachRequest).toMatchObject({ type: 'request', method: 'detach' })
    socket.send(JSON.stringify({ type: 'response', id: detachRequest.id, ok: true, value: null }))
    await releasePromise

    const openPromise = value.open('https://example.com/new', 'reuse')
    const openRequest = await message(socket)
    expect(openRequest).toMatchObject({ type: 'request', method: 'open' })
    socket.send(JSON.stringify({
      type: 'response', id: openRequest.id, ok: true,
      value: { tabId: 8, windowId: 3, url: 'https://example.com/new', title: 'New', active: false },
    }))
    const opened = await openPromise
    expect(opened.url).toBe('https://example.com/new')

    const closePromise = value.closePage(opened)
    const closeRequest = await message(socket)
    expect(closeRequest).toMatchObject({ type: 'request', method: 'close' })
    socket.send(JSON.stringify({ type: 'response', id: closeRequest.id, ok: true, value: null }))
    await closePromise

    await value.disconnect()
    expect(secret.current()).toBeUndefined()
    expect(value.snapshot(false).personal).toMatchObject({ connected: false, paired: false })
  })

  it('expires pairing codes and invalidates a code after five failed attempts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T10:00:00Z'))
    const ctx = new Context()
    ctx.provide('credentials', credentials().service as never)
    const value = new PersonalEdgeAdapter(ctx, 'C:\\xiaojing-edge-extension')
    value.startPairing()
    vi.advanceTimersByTime(120_001)
    expect(value.snapshot(false).personal).not.toHaveProperty('pairingCode')
    await ctx.fiber.dispose()

    vi.useRealTimers()
    const running = await adapter()
    running.value.startPairing()
    const socket = await connect(running.port)
    hello(socket)
    await message(socket)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      socket.send(JSON.stringify({ type: 'pair', code: 'ZZZZZZZZ' }))
      await expect(message(socket)).resolves.toMatchObject({ type: 'pair-result', ok: false, error: 'pairing-code-invalid' })
    }
    expect(running.value.snapshot(false).personal).not.toHaveProperty('pairingCode')
  })

  it('rejects the wrong extension and reports protocol or secret mismatches without exposing credentials', async () => {
    const wrongExtension = await adapter()
    const rejected = await connect(wrongExtension.port)
    hello(rejected, { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
    const closeCode = await new Promise<number>((resolve) => { rejected.once('close', (code) => { resolve(code) }) })
    expect(closeCode).toBe(1008)

    const incompatible = await adapter()
    const incompatibleSocket = await connect(incompatible.port)
    hello(incompatibleSocket, { protocol: PERSONAL_EDGE_PROTOCOL_VERSION + 1 })
    await expect(message(incompatibleSocket)).resolves.toMatchObject({ type: 'hello-result', state: 'incompatible' })
    expect(incompatible.value.snapshot(false).personal).toMatchObject({ state: 'incompatible', connected: false })

    const stored = await adapter('correct-secret')
    const authorized = await connect(stored.port)
    const nonce = hello(authorized, { secret: 'correct-secret' })
    const accepted = await message(authorized)
    expect(accepted).toMatchObject({
      type: 'hello-result', state: 'connected', hostProof: proof('correct-secret', 'host', nonce),
    })
    expect(JSON.stringify(accepted)).not.toContain('correct-secret')
    authorized.close()

    const storedMismatch = await adapter('correct-secret')
    const wrongSecret = await connect(storedMismatch.port)
    hello(wrongSecret, { secret: 'wrong-secret' })
    await expect(message(wrongSecret)).resolves.toMatchObject({ type: 'hello-result', state: 'pairing-required' })
    const status = storedMismatch.value.snapshot(false)
    expect(status.personal).toMatchObject({ paired: true, connected: false })
    expect(JSON.stringify(status)).not.toContain('correct-secret')
  })

  it('requires a valid hello before pairing and contains malformed loopback messages', async () => {
    const first = await adapter()
    first.value.startPairing()
    const withoutHello = await connect(first.port)
    withoutHello.send(JSON.stringify({ type: 'pair', code: first.value.snapshot(false).personal.pairingCode }))
    await expect(new Promise<number>((resolve) => {
      withoutHello.once('close', (code) => { resolve(code) })
    })).resolves.toBe(1008)

    const second = await adapter()
    const malformed = await connect(second.port)
    malformed.send('{')
    await expect(new Promise<number>((resolve) => {
      malformed.once('close', (code) => { resolve(code) })
    })).resolves.toBe(1008)
  })
})
