import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/open-item-deletion-tool.ts'

it('delegates direction-bound preparation and exact-version deletion and removes both tools', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  const prepareOpenItemDeletion = vi.fn(async () => ({ id: 'preview', version: 1, execution: { state: 'requires-confirmation' } }))
  const deleteOpenItem = vi.fn(async () => ({ phase: 'accepted' }))
  ctx.provide('xiaojingFinanceDomain', { prepareOpenItemDeletion, deleteOpenItem } as never)
  const limits = { maxBytes: 262144, maxRows: 1000, maxPages: 10, pageSize: 100 }
  const fiber = ctx.plugin(plugin, limits)
  await fiber.await()
  try {
    const agent = { ctx } as Agent
    const signal = new AbortController().signal
    const run = (args: object, bound = true) => ctx.tools.execute({ callId: ToolCallId('open-item-deletion'),
      name: 'finance_prepare_open_item_deletion', arguments: args, signal, ...(bound ? { agent } : {}) })
    for (const direction of ['receivable', 'payable']) {
      const args = { action: 'prepare', openItemId: '72604', direction, periodStart: '2022-01', periodEnd: '2022-01' }
      expect((await run(args)).isError).toBe(false)
      expect(prepareOpenItemDeletion).toHaveBeenLastCalledWith(agent, args, signal, limits)
      expect((await run(args, false)).isError).toBe(true)
    }
    expect((await run({ action: 'execute', id: 'preview' })).isError).toBe(true)
    expect((await run({ action: 'prepare', direction: 'both' })).isError).toBe(true)
    expect(prepareOpenItemDeletion).toHaveBeenCalledTimes(2)
    const execute = (args: object, bound = true) => ctx.tools.execute({ callId: ToolCallId('open-item-delete'),
      name: 'finance_delete_open_item', arguments: args, signal, ...(bound ? { agent } : {}) })
    const exact = { id: 'prepared-operation', version: 2 }
    expect((await execute(exact)).isError).toBe(false)
    expect(deleteOpenItem).toHaveBeenLastCalledWith(agent, exact, signal, limits)
    expect((await execute({ id: 'prepared-operation' })).isError).toBe(true)
    expect((await execute({ ...exact, version: '2' })).isError).toBe(true)
    expect((await execute(exact, false)).isError).toBe(true)
    expect(deleteOpenItem).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name === 'finance_prepare_open_item_deletion')).toBe(false)
    expect(ctx.tools.schemas().some(tool => tool.name === 'finance_delete_open_item')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
