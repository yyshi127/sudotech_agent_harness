import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/journal-deletion-tool.ts'

it('delegates exact journal deletion requests and removes both tools on disposal', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  const prepareJournalDeletion = vi.fn(async () => ({ id: 'preview', version: 2 }))
  const deleteJournal = vi.fn(async () => ({ phase: 'outcome-unknown' }))
  ctx.provide('xiaojingFinanceDomain', { prepareJournalDeletion, deleteJournal } as never)
  const limits = { maxBytes: 262144, maxRows: 1000, maxPages: 10, pageSize: 100 }
  const fiber = ctx.plugin(plugin, limits)
  await fiber.await()
  try {
    const agent = { ctx } as Agent
    const signal = new AbortController().signal
    const run = (name: string, args: object, bound = true) => ctx.tools.execute({
      callId: ToolCallId('journal-deletion'), name, arguments: args, signal, ...(bound ? { agent } : {}) })
    const prepare = { action: 'prepare', journalId: '123', cashAccountId: '174622', month: '2022-01' }
    expect((await run('finance_prepare_journal_deletion', prepare)).isError).toBe(false)
    expect(prepareJournalDeletion).toHaveBeenCalledWith(agent, prepare, signal, limits)
    const exact = { id: 'preview', version: 2 }
    expect((await run('finance_delete_journal', exact)).isError).toBe(false)
    expect(deleteJournal).toHaveBeenCalledWith(agent, exact, signal, limits)
    expect((await run('finance_delete_journal', { id: 'preview' })).isError).toBe(true)
    expect((await run('finance_delete_journal', { ...exact, version: '2' })).isError).toBe(true)
    expect((await run('finance_delete_journal', exact, false)).isError).toBe(true)
    expect((await run('finance_prepare_journal_deletion', prepare, false)).isError).toBe(true)
    expect(deleteJournal).toHaveBeenCalledTimes(1)
    expect(prepareJournalDeletion).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => ['finance_prepare_journal_deletion', 'finance_delete_journal'].includes(tool.name))).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
