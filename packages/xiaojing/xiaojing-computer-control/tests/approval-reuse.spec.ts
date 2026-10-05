import { Buffer } from 'node:buffer'
import { PassThrough, Writable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Approval, { type ApprovalAnswer, type ApprovalPolicy, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ComputerControl, { parseComputerResult } from '../src/index.ts'

const contexts: Context[] = []
let sequence = 0
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

/** Only the external PowerShell process is replaced; tools, observations, approval and Session audit remain real. */
async function fixture(policy: ApprovalPolicy = 'ask') {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  await ctx.plugin(LocalSubprocess).await()
  await ctx.plugin(Approval, { policy }).await()
  let generation = 0
  let windowId = 'window-one'
  let names = ['Delete Fixture', 'Send Fixture']
  const windows = [
    { id: 'window-one', title: 'Ledger Fixture', processId: 42 },
    { id: 'window-two', title: 'Ledger Fixture', processId: 42 },
  ]
  const dispatched: string[] = []
  const stdout = new PassThrough()
  const done = Promise.withResolvers<SubprocessOutcome>()
  const stdin = new Writable({ write(chunk: Buffer | string, _encoding, callback) {
    const request: unknown = JSON.parse(chunk.toString())
    if (typeof request !== 'object' || request === null || !('id' in request) || typeof request.id !== 'string'
      || !('action' in request) || typeof request.action !== 'string') {
      callback(new Error('Owned helper request is missing its protocol fields'))
      return
    }
    dispatched.push(request.action)
    if ('windowId' in request && typeof request.windowId === 'string') windowId = request.windowId
    const window = windows.find(item => item.id === windowId)
    generation += 1
    const result = request.action === 'list_windows'
      ? { action: 'list_windows', summary: 'Owned windows', windows }
      : {
        action: 'observe', summary: 'Owned controls', windowId, windowTitle: window?.title,
        observationId: `observation-${generation}`,
        targets: names.map((name, index) => ({
          id: `target-${generation}-${index}`, name, controlType: 'Button', enabled: true,
          actions: ['invoke', 'toggle', 'select', 'focus'],
        })),
      }
    const response = JSON.stringify({ id: request.id, ok: true, result })
    queueMicrotask(() => { stdout.write(response + '\n') })
    callback()
  } })
  const helper: SubprocessHandle = {
    stdin, stdout, stderr: undefined, control: undefined, collected: {}, done: done.promise,
    terminate() { stdin.end(); stdout.end(); done.resolve({ exitCode: 0, signal: null }) },
    waitForExit: async () => { await done.promise; return true },
  }
  vi.spyOn(ctx.subprocess, 'resolveExecutable').mockResolvedValue('owned-helper.exe')
  vi.spyOn(ctx.subprocess, 'spawn').mockReturnValue(helper)
  await ctx.plugin(ComputerControl, {}).await()
  const session = Session.create(SessionId(`computer-reuse-${sequence++}`))
  session.append('turn/start', { turn: 1 })
  const agent: Agent = {
    id: session.id, session, ctx, options: {}, status: 'idle',
    inbox: {
      nextTurn: [], nextStep: [], clear() {}, append() {}, prepend() {}, replace: () => false, remove: () => false, splice: () => [],
    },
    cancel() {}, whenIdle: async () => {}, runMaintenance: task => task(new AbortController().signal),
    send() {}, followup() {}, steer() {}, inject() {},
  }
  const answer = vi.fn(async (_request: ApprovalRequest): Promise<ApprovalAnswer> => 'allowed-session')
  ctx.on('approval/request', answer)
  const execute = (args: object, owner = agent) => ctx.tools.execute({
    name: 'computer_control', arguments: args, agent: owner,
    callId: ToolCallId(`computer-reuse-call-${sequence++}`), signal: new AbortController().signal,
  })
  const observe = async (selected = 'window-one') => {
    await execute({ action: 'list_windows' })
    const result = await execute({ action: 'observe', window_id: selected })
    const content = result.content.find(block => block.type === 'text')
    if (result.isError || content?.type !== 'text') throw new Error('Owned window could not be observed')
    return parseComputerResult(JSON.parse(content.text))
  }
  const argumentsFor = async (name = 'Delete Fixture', action = 'invoke', selected = 'window-one') => {
    const observed = await observe(selected)
    const target = observed.targets?.find(item => item.name === name)
    if (target === undefined) throw new Error('Owned control is missing')
    return { action, observation_id: observed.observationId, target_id: target.id }
  }
  return {
    ctx, session, agent, execute, argumentsFor, observe, answer, windows, dispatched,
    setNames: (value: string[]) => { names = value },
  }
}

describe.skipIf(process.platform !== 'win32')('Windows observed-control session authorization', () => {
  it('reuses deletion authorization across refreshed target IDs while calling mandatory approval each time', async () => {
    const { ctx, argumentsFor, execute, answer, dispatched } = await fixture('never')
    const mandatory = vi.spyOn(ctx.approval, 'requestMandatory')
    const first = await argumentsFor()
    expect((await execute(first)).isError).toBe(false)
    const second = await argumentsFor()
    expect(second.target_id).not.toBe(first.target_id)
    expect((await execute(second)).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect(mandatory).toHaveBeenCalledTimes(2)
    expect(dispatched.filter(action => action === 'invoke')).toHaveLength(2)
    const reusable = answer.mock.calls[0]?.[0].reusable
    expect(reusable?.label).toBe('Windows: invoke “Delete Fixture” in “Ledger Fixture”')
    expect(reusable?.label).not.toContain('42')
    expect(reusable?.label).not.toContain('window-one')
  })

  it('separates windows, processes, titles, controls and action categories', async () => {
    const { argumentsFor, execute, answer, windows } = await fixture()
    expect((await execute(await argumentsFor())).isError).toBe(false)
    expect((await execute(await argumentsFor('Delete Fixture', 'invoke', 'window-two'))).isError).toBe(false)
    windows[1]!.processId = 43
    expect((await execute(await argumentsFor('Delete Fixture', 'invoke', 'window-two'))).isError).toBe(false)
    windows[1]!.title = 'Other Ledger'
    expect((await execute(await argumentsFor('Delete Fixture', 'invoke', 'window-two'))).isError).toBe(false)
    expect((await execute(await argumentsFor('Send Fixture', 'invoke', 'window-two'))).isError).toBe(false)
    expect((await execute(await argumentsFor('Send Fixture', 'toggle', 'window-two'))).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(6)
    const scopes = answer.mock.calls.slice(0, 5).map(call => call[0].reusable?.scope)
    expect(new Set(scopes).size).toBe(5)
    expect(answer.mock.calls[4]?.[0].reusable?.category).not.toBe(answer.mock.calls[5]?.[0].reusable?.category)
  })

  it('keeps duplicate labels and unverified focused keyboard input one-shot', async () => {
    const { argumentsFor, execute, answer, setNames, observe } = await fixture()
    answer.mockImplementation(async () => 'allowed-once')
    setNames(['Delete Fixture', 'Delete Fixture'])
    expect((await execute(await argumentsFor())).isError).toBe(false)
    const observation = await observe()
    expect((await execute({ action: 'press_key', observation_id: observation.observationId, key: '{ENTER}' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(2)
    expect(answer.mock.calls.every(call => call[0].reusable === undefined)).toBe(true)
  })

  it('does not reuse stale observation IDs even after an authorized control action', async () => {
    const { argumentsFor, execute, answer, dispatched } = await fixture()
    const stale = await argumentsFor()
    expect((await execute(stale)).isError).toBe(false)
    expect((await execute(stale)).isError).toBe(true)
    expect(answer).toHaveBeenCalledOnce()
    expect(dispatched.filter(action => action === 'invoke')).toHaveLength(1)
  })

  it('does not carry an authorization into another Session', async () => {
    for (let owner = 0; owner < 2; owner += 1) {
      const { argumentsFor, execute, answer } = await fixture()
      expect((await execute(await argumentsFor())).isError).toBe(false)
      expect(answer).toHaveBeenCalledOnce()
    }
  })

  it('rejects a foreign Session before consulting a previously authorized target', async () => {
    const { argumentsFor, execute, answer, agent } = await fixture()
    expect((await execute(await argumentsFor())).isError).toBe(false)
    const fresh = await argumentsFor()
    const session = Session.create(SessionId(`foreign-computer-${sequence++}`))
    session.append('turn/start', { turn: 1 })
    expect((await execute(fresh, { ...agent, id: session.id, session })).isError).toBe(true)
    expect(answer).toHaveBeenCalledOnce()
  })
})
