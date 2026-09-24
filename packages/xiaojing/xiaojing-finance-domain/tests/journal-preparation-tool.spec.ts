import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/journal-preparation-tool.ts'

it('passes journal direction and exact versions to the Host without accepting approval or arbitrary payload fields', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  const prepareJournal = vi.fn(async () => ({ id: 'local', version: 2, phase: 'prepared' }))
  const createJournal = vi.fn(async () => ({ phase: 'accepted', complete: false }))
  ctx.provide('xiaojingFinanceDomain', { prepareJournal, createJournal } as never)
  const fiber = ctx.plugin(plugin, { maxBytes: 65536 })
  await fiber.await()
  try {
    const agent = { ctx } as Agent
    const signal = new AbortController().signal
    const args = { action: 'prepare', input: { date: '2022-01-01', direction: 'expense', amount: '0.07',
      cashAccountId: '174622', categoryId: '578260', summary: '测试支出', keeperName: '测试员' } }
    expect((await ctx.tools.execute({ callId: ToolCallId('prepare'), name: 'finance_prepare_journal', arguments: args, agent, signal })).isError).toBe(false)
    expect(prepareJournal).toHaveBeenCalledWith(agent, args, signal, 65536)
    for (const request of [
      { arguments: args },
      { agent, arguments: { ...args, input: { ...args.input, amount: 0.07 } } },
      { agent, arguments: { ...args, input: { ...args.input, direction: 'payment' } } },
      { agent, arguments: { ...args, input: { ...args.input, approval: true } } },
    ]) {
      expect((await ctx.tools.execute({ callId: ToolCallId('invalid'), name: 'finance_prepare_journal', signal, ...request })).isError).toBe(true)
    }
    expect(prepareJournal).toHaveBeenCalledTimes(1)
    const createArgs = { id: 'ea40209e-4c7e-4edf-8a50-49015fc6e941', version: 2 }
    expect((await ctx.tools.execute({ callId: ToolCallId('create'), name: 'finance_create_journal', arguments: createArgs, agent, signal })).isError).toBe(false)
    expect(createJournal).toHaveBeenCalledWith(agent, createArgs, signal, 65536)
    for (const request of [{ id: 'local' }, { ...createArgs, approval: true }, { ...createArgs, accountId: 'other' }]) {
      expect((await ctx.tools.execute({ callId: ToolCallId('invalid-create'), name: 'finance_create_journal', arguments: request, agent, signal })).isError).toBe(true)
    }
    expect(createJournal).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name === 'finance_prepare_journal' || tool.name === 'finance_create_journal')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
