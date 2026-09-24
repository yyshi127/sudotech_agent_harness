import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/open-item-write-off-tool.ts'

it('delegates separate write-off preparation and exact-version execution and unregisters both', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  const prepareOpenItemWriteOff = vi.fn(async () => ({ id: 'preview', version: 1, execution: { state: 'unavailable' } }))
  const writeOffOpenItem = vi.fn(async () => ({ outcome: { state: 'accepted' } }))
  ctx.provide('xiaojingFinanceDomain', { prepareOpenItemWriteOff, writeOffOpenItem } as never)
  const limits = { maxBytes: 262144, maxRows: 1000 }
  const fiber = ctx.plugin(plugin, limits)
  await fiber.await()
  try {
    const agent = { ctx } as Agent
    const signal = new AbortController().signal
    const run = (args: object, bound = true) => ctx.tools.execute({ callId: ToolCallId('write-off-preview'),
      name: 'finance_prepare_open_item_write_off', arguments: args, signal, ...(bound ? { agent } : {}) })
    for (const direction of ['receivable', 'payable']) {
      const args = { action: 'prepare', input: { direction, openItemId: '72606', cashAccountId: '174622',
        amount: '0.19', currencyCode: 'RMB', date: '2022-01-09', keeperName: '测试记账人',
        sourceQuery: { direction, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 } } }
      expect((await run(args)).isError).toBe(false)
      expect(prepareOpenItemWriteOff).toHaveBeenLastCalledWith(agent, args, signal, limits)
      expect((await run(args, false)).isError).toBe(true)
    }
    expect((await run({ action: 'execute', id: 'preview' })).isError).toBe(true)
    expect((await run({ action: 'prepare', input: { direction: 'both' } })).isError).toBe(true)
    expect(prepareOpenItemWriteOff).toHaveBeenCalledTimes(2)
    const execute = (args: object, bound = true) => ctx.tools.execute({ callId: ToolCallId('write-off-execute'),
      name: 'finance_write_off_open_item', arguments: args, signal, ...(bound ? { agent } : {}) })
    const args = { id: 'prepared-operation', version: 2 }
    expect((await execute(args)).isError).toBe(false)
    expect(writeOffOpenItem).toHaveBeenLastCalledWith(agent, args, signal, limits)
    expect((await execute(args, false)).isError).toBe(true)
    expect((await execute({ id: 'prepared-operation' })).isError).toBe(true)
    expect(writeOffOpenItem).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name === 'finance_prepare_open_item_write_off')).toBe(false)
    expect(ctx.tools.schemas().some(tool => tool.name === 'finance_write_off_open_item')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
