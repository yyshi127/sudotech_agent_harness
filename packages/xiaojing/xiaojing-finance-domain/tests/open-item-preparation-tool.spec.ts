import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/open-item-preparation-tool.ts'

it('exposes sourced preparation but no credential, ledger, endpoint or approval overrides', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  const prepareOpenItem = vi.fn(async () => ({ version: 1, phase: 'prepared' }))
  const createOpenItem = vi.fn(async () => ({ phase: 'accepted', complete: false }))
  const queryObservedOpenItemAccounts = vi.fn(async () => ({ coverage: 'returned-page-only', observations: [] }))
  ctx.provide('xiaojingFinanceDomain', { prepareOpenItem, createOpenItem, queryObservedOpenItemAccounts } as never)
  const fiber = ctx.plugin(plugin, { maxBytes: 65536 })
  await fiber.await()
  try {
    const agent = { ctx } as Agent
    const signal = new AbortController().signal
    const query = { direction: 'receivable', periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 }
    const args = { action: 'prepare', input: { direction: 'receivable', date: '2022-01-09', amount: '0.05',
      accountId: '174626', categoryId: '578250', auxiliaryCategoryCode: '01', auxiliaryItemId: '191501',
      summary: '往来测试', keeperName: '测试员', accountReferenceQuery: query } }
    const run = (name: string, parameters: object, owner: Agent | undefined = agent) =>
      ctx.tools.execute({ callId: ToolCallId('open-item'), name, arguments: parameters, agent: owner, signal })
    expect((await run('finance_open_item_accounts', query)).isError).toBe(false)
    expect(queryObservedOpenItemAccounts).toHaveBeenCalledWith(agent, query, signal)
    expect((await run('finance_prepare_open_item', args)).isError).toBe(false)
    expect(prepareOpenItem).toHaveBeenCalledWith(agent, args, signal, 65536)
    for (const input of [{ ...args.input, amount: 0.05 }, { ...args.input, accountReferenceQuery: undefined },
      { ...args.input, accountReferenceQuery: { ...query, direction: 'payable' } }, { ...args.input, approval: true },
      { ...args.input, ledgerId: '35601' }, { ...args.input, auxiliaryItemNames: '客户:猜测' }]) {
      expect((await run('finance_prepare_open_item', { ...args, input })).isError).toBe(true)
    }
    expect(prepareOpenItem).toHaveBeenCalledTimes(1)
    const request = { id: 'ea40209e-4c7e-4edf-8a50-49015fc6e941', version: 1 }
    expect((await run('finance_create_open_item', request)).isError).toBe(false)
    expect(createOpenItem).toHaveBeenCalledWith(agent, request, signal, 65536)
    for (const invalid of [{ id: 'fake', version: 1 }, { ...request, approval: true }, { ...request, endpoint: 'https://example.test' }]) {
      expect((await run('finance_create_open_item', invalid)).isError).toBe(true)
    }
    expect(createOpenItem).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => ['finance_open_item_accounts', 'finance_prepare_open_item', 'finance_create_open_item']
      .includes(tool.name))).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
