import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/references-tool.ts'

it('registers reversibly, refuses unbound calls and preserves exact selectors', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  const queryReferences = vi.fn(async () => ({ kind: 'auxiliary-items', rows: [], coverage: 'unverified' }))
  ctx.provide('xiaojingFinanceDomain', { queryReferences } as never)
  const fiber = ctx.plugin(plugin)
  await fiber.await()
  try {
    const description = ctx.tools.schemas().find(tool => tool.name === 'finance_references')?.description
    expect(description).toContain('科目与出纳账户 directionRaw：0借1贷；收支类别：0收1支')
    expect(description).toContain('subjectType')
    expect(description).toContain('subjectTreeRootCode')
    expect(description).toContain('不能按记忆中的名称逐个抽样')
    expect(description).not.toContain('禁止映射为借/贷')
    const agent = { ctx } as Agent
    const signal = new AbortController().signal
    const args = { kind: 'auxiliary-items', categoryCode: '01', name: '同名候选' }
    const result = await ctx.tools.execute({ callId: ToolCallId('reference'), name: 'finance_references', arguments: args, agent, signal })
    expect(result.isError).toBe(false)
    expect(queryReferences).toHaveBeenCalledWith(agent, args, signal)
    for (const request of [{ arguments: { kind: 'subjects' } }, { agent, arguments: { kind: 'auxiliary-items' } }]) {
      expect((await ctx.tools.execute({ callId: ToolCallId('invalid'), name: 'finance_references', signal, ...request })).isError).toBe(true)
    }
    expect(queryReferences).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name === 'finance_references')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
