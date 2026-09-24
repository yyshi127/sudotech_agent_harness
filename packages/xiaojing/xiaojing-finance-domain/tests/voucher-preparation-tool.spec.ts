import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/voucher-preparation-tool.ts'

it('passes versioned proposals and cancellation to the Host, rejects invalid tool shapes and unregisters', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  const prepareVoucher = vi.fn(async () => ({ id: 'local', version: 2, phase: 'prepared' }))
  const createVoucher = vi.fn(async () => ({ phase: 'accepted', complete: false }))
  ctx.provide('xiaojingFinanceDomain', { prepareVoucher, createVoucher } as never)
  const limits = { maxEntries: 20, maxBytes: 65536 }
  const fiber = ctx.plugin(plugin, limits)
  await fiber.await()
  try {
    const agent = { ctx } as Agent
    const signal = new AbortController().signal
    const args = { action: 'revise', id: 'local', version: 1, input: {
      date: '2026-09-09', documentMaker: '测试员', sourcePaths: [],
      entries: ['debit', 'credit'].map(side => ({ summary: '测试', subjectCode: '1001', side, amount: '0.30', auxiliary: [] })),
    } }
    const result = await ctx.tools.execute({ callId: ToolCallId('prepare'), name: 'finance_prepare_voucher', arguments: args, agent, signal })
    expect(result.isError).toBe(false)
    expect(prepareVoucher).toHaveBeenCalledWith(agent, args, signal, limits)
    for (const request of [
      { arguments: { action: 'inspect', id: 'local' } },
      { agent, arguments: { action: 'submit', id: 'local' } },
      { agent, arguments: { ...args, input: { ...args.input, approval: true } } },
      { agent, arguments: { ...args, input: { ...args.input, entries: [{ ...args.input.entries[0], amount: 0.3 }] } } },
    ]) {
      expect((await ctx.tools.execute({ callId: ToolCallId('invalid'), name: 'finance_prepare_voucher', signal, ...request })).isError).toBe(true)
    }
    expect(prepareVoucher).toHaveBeenCalledTimes(1)
    const createArgs = { id: 'ea40209e-4c7e-4edf-8a50-49015fc6e941', version: 2 }
    expect((await ctx.tools.execute({ callId: ToolCallId('create'), name: 'finance_create_voucher', arguments: createArgs, agent, signal })).isError).toBe(false)
    expect(createVoucher).toHaveBeenCalledWith(agent, createArgs, signal, limits)
    for (const request of [{ id: 'local' }, { ...createArgs, approval: true }, { ...createArgs, accountId: 'other' }]) {
      expect((await ctx.tools.execute({ callId: ToolCallId('invalid-create'), name: 'finance_create_voucher', arguments: request, agent, signal })).isError).toBe(true)
    }
    expect(createVoucher).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name === 'finance_prepare_voucher')).toBe(false)
    expect(ctx.tools.schemas().some(tool => tool.name === 'finance_create_voucher')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
