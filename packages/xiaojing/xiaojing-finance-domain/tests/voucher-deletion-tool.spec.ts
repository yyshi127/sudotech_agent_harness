import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/voucher-deletion-tool.ts'

it('delegates exact deletion requests to the Host and removes both registrations on disposal', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  const prepareVoucherDeletion = vi.fn(async () => ({ id: 'preview', version: 2 }))
  const deleteVoucher = vi.fn(async () => ({ phase: 'outcome-unknown' }))
  ctx.provide('xiaojingFinanceDomain', { prepareVoucherDeletion, deleteVoucher } as never)
  const limits = { maxBytes: 131072, maxEntries: 100, maxPages: 10 }
  const fiber = ctx.plugin(plugin, limits)
  await fiber.await()
  try {
    const agent = { ctx } as Agent
    const signal = new AbortController().signal
    const args = { action: 'prepare', voucherId: '123' }
    const run = (name: string, arguments_: object, withAgent = true) => ctx.tools.execute({
      callId: ToolCallId('deletion'), name, arguments: arguments_, signal, ...(withAgent ? { agent } : {}) })
    expect((await run('finance_prepare_voucher_deletion', args)).isError).toBe(false)
    expect(prepareVoucherDeletion).toHaveBeenCalledWith(agent, args, signal, limits)
    const exact = { id: 'preview', version: 2 }
    expect((await run('finance_delete_voucher', exact)).isError).toBe(false)
    expect(deleteVoucher).toHaveBeenCalledWith(agent, exact, signal, limits)
    expect((await run('finance_delete_voucher', { id: 'preview' })).isError).toBe(true)
    expect((await run('finance_delete_voucher', { ...exact, version: '2' })).isError).toBe(true)
    expect((await run('finance_delete_voucher', exact, false)).isError).toBe(true)
    expect((await run('finance_prepare_voucher_deletion', args, false)).isError).toBe(true)
    expect(deleteVoucher).toHaveBeenCalledTimes(1)
    expect(prepareVoucherDeletion).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name === 'finance_prepare_voucher_deletion' || tool.name === 'finance_delete_voucher')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
