import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/vouchers-tool.ts'

it('registers reversibly and resolves the current Beijing month without exposing connection parameters', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  const queryVouchers = vi.fn(async () => ({ accountId: 'one', accountName: '演示', month: '2026-09', page: 1, pageSize: 20,
    total: 0, voucherCount: 0, hasMore: false, rows: [], notice: '会计期间未逐笔复核' }))
  const queryVoucherDetail = vi.fn(async () => ({ accountId: 'one', accountName: '演示', voucherId: '270825',
    date: '2026-09-07', number: '记-2', period: '2026-09', audited: false, settled: false, documentMaker: '测试', rows: [], notice: '不包含附件' }))
  ctx.provide('xiaojingFinanceDomain', { queryVouchers, queryVoucherDetail } as never)
  const fiber = ctx.plugin(plugin, { pageSize: 20 })
  await fiber.await()
  try {
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('finance_vouchers')
    const agent = { ctx } as Agent
    const signal = new AbortController().signal
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-31T16:30:00Z'))
    const result = await ctx.tools.execute({ callId: ToolCallId('month'), name: 'finance_vouchers', arguments: { month: 'current' }, agent, signal })
    expect(result.isError).toBe(false)
    expect(queryVouchers).toHaveBeenCalledWith(agent, { month: '2026-09', page: 1, pageSize: 20 }, signal)
    const range = await ctx.tools.execute({ callId: ToolCallId('range'), name: 'finance_vouchers',
      arguments: { month: '2026-01', monthEnd: '2026-03', summary: '销售', page: 2, pageSize: 1 }, agent, signal })
    expect(range.isError).toBe(false)
    expect(queryVouchers).toHaveBeenLastCalledWith(agent,
      { month: '2026-01', monthEnd: '2026-03', summary: '销售', page: 2, pageSize: 1 }, signal)
    const absent = await ctx.tools.execute({ callId: ToolCallId('absent'), name: 'finance_vouchers', arguments: {}, signal })
    expect(absent.isError).toBe(true)
    const detail = await ctx.tools.execute({ callId: ToolCallId('detail'), name: 'finance_voucher_detail',
      arguments: { voucherId: '270825' }, agent, signal })
    expect(detail.isError).toBe(false)
    expect(queryVoucherDetail).toHaveBeenCalledWith(agent, '270825', signal)
    const unbound = await ctx.tools.execute({ callId: ToolCallId('detail-unbound'), name: 'finance_voucher_detail',
      arguments: { voucherId: '270825' }, signal })
    expect(unbound.isError).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('finance_vouchers')
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('finance_voucher_detail')
  } finally {
    vi.useRealTimers()
    await ctx.fiber.dispose()
  }
})
