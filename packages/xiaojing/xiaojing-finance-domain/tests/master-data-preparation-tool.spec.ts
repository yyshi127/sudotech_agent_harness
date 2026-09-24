import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/master-data-preparation-tool.ts'

it('validates both business proposals and only forwards exact IDs for mandatory creation', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  const prepareMasterData = vi.fn(async () => ({ phase: 'prepared' }))
  const createMasterData = vi.fn(async () => ({ phase: 'accepted', complete: false }))
  ctx.provide('xiaojingFinanceDomain', { prepareMasterData, createMasterData } as never)
  const fiber = ctx.plugin(plugin, { maxBytes: 65536 })
  await fiber.await()
  try {
    const agent = { ctx } as Agent
    const signal = new AbortController().signal
    const proposal = { kind: 'auxiliary-item', input: { categoryCode: '02', itemCode: 'F3A02', itemName: '测试供应商', status: 'enabled', documentMaker: '施' } }
    const args = { action: 'prepare', ...proposal }
    expect((await ctx.tools.execute({ callId: ToolCallId('prepare'), name: 'finance_prepare_master_data', arguments: args, agent, signal })).isError).toBe(false)
    expect(prepareMasterData).toHaveBeenCalledWith(agent, { action: 'prepare', proposal }, signal, 65536)
    for (const request of [
      { arguments: args }, { agent, arguments: { ...args, input: { ...proposal.input, direction: 'debit' } } },
      { agent, arguments: { ...args, input: { ...proposal.input, documentMaker: undefined } } },
      { agent, arguments: { ...args, approval: true } },
      { agent, arguments: { ...args, proposal } },
    ]) expect((await ctx.tools.execute({ callId: ToolCallId('invalid'), name: 'finance_prepare_master_data', signal, ...request })).isError).toBe(true)
    expect(prepareMasterData).toHaveBeenCalledTimes(1)
    const subject = { kind: 'subject', input: { subjectCode: '100297', subjectName: '测试科目', parentCode: '1002',
      subjectCategory: '1', subjectType: '流动资产', direction: 'debit', status: 'enabled', documentMaker: '施', numberUnit: null } }
    expect((await ctx.tools.execute({ callId: ToolCallId('subject'), name: 'finance_prepare_master_data', arguments: { action: 'prepare', ...subject }, agent, signal })).isError).toBe(false)
    const root = { ...subject, input: { ...subject.input, subjectCode: '1099', parentCode: null } }
    expect((await ctx.tools.execute({ callId: ToolCallId('root'), name: 'finance_prepare_master_data', arguments: { action: 'prepare', ...root }, agent, signal })).isError).toBe(false)
    expect(prepareMasterData).toHaveBeenLastCalledWith(agent, { action: 'prepare', proposal: root }, signal, 65536)
    const exact = { id: 'ea40209e-4c7e-4edf-8a50-49015fc6e941', version: 2 }
    expect((await ctx.tools.execute({ callId: ToolCallId('create'), name: 'finance_create_master_data', arguments: exact, agent, signal })).isError).toBe(false)
    expect(createMasterData).toHaveBeenCalledWith(agent, exact, signal, 65536)
    for (const request of [{ id: 'local' }, { ...exact, approval: true }, { ...exact, accountId: 'other' }]) {
      expect((await ctx.tools.execute({ callId: ToolCallId('invalid-create'), name: 'finance_create_master_data', arguments: request, agent, signal })).isError).toBe(true)
    }
    expect(createMasterData).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name === 'finance_prepare_master_data' || tool.name === 'finance_create_master_data')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
