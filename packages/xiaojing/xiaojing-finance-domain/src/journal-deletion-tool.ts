/** Finance-only journal deletion preview and mandatory-confirmation execution; generic cards preserve exact targets. */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader identity. */
export const name = 'xiaojing-finance-journal-deletion-tool'
/** The Host owns saved ledger selection, approval, target claims and dispatch. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Complete evidence limits; exceeding a limit never establishes absence. */
export interface Config { maxBytes: number; maxPages: number; maxRows: number; pageSize: number }
/** Deployment bounds for each counted inventory and complete durable record. */
export const Config: s<Config> = s.object({ maxBytes: s.number().min(1).step(1).default(262144),
  maxPages: s.number().min(2).step(1).default(10), maxRows: s.number().min(1).step(1).default(1000),
  pageSize: s.number().min(1).max(100).step(1).default(100) })

/**
 * Register separate read-only preparation/recovery and destructive execution tools.
 * @param ctx - Finance preset scope; registrations are removed with its tool registry scope.
 * @param config - Validated bounds passed unchanged to the Host.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_prepare_journal_deletion',
    description: '准备、修改或只读检查指定资金日记账的删除，不发送删除。理解用户日常说法后先用 finance_journals 和 finance_references 定位；歧义先澄清，名称、摘要、行号不能代替唯一 journalId。prepare/revise 必须给出查到的准确 journalId、cashAccountId 和 month，完整展示目标、金额、日期、账户及影响。仅支持已核实的未审核、无已识别关联和无附件记录，其他状态不能绕过。inspect 使用原删除记录 id，仅在原月份和账户回查；not-observed 不表示全账套不存在，结果未知不能重新准备同一目标。',
    parameters: {
      action: { type: 'string', enum: ['prepare', 'revise', 'inspect'], required: true },
      id: { type: 'string', description: 'revise/inspect 必填：已有本地删除记录 ID。' },
      version: { type: 'integer', description: 'revise 必填：当前准确预览版本。' },
      journalId: { type: 'string', description: 'prepare/revise 必填：查到的有成流水唯一 ID。' },
      cashAccountId: { type: 'string', description: 'prepare/revise 必填：当前账套中已查询确认的资金账户 ID。' },
      month: { type: 'string', description: 'prepare/revise 必填：流水所在月份 YYYY-MM。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的 Finance 会话中准备流水删除。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain
        .prepareJournalDeletion(agent, args, exec.signal, config)))
    },
    presentCall: args => ({ card: 'generic', title: args.action === 'inspect' ? '只读检查日记账删除记录' : '准备日记账删除预览',
      kind: 'other' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '日记账删除检查未完成' : '日记账删除预览与检查',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_delete_journal',
    description: '仅在用户明确要求删除时，执行 finance_prepare_journal_deletion 已展示的准确 id/version。Host 强制请求本次确认，聊天中的同意不绕过确认。状态、版本或配置变化需重新预览；拒绝、取消不发送。不联动删除凭证或应收应付，不审核、结账、核销或实际收付款，不提供自动撤销。接口接收后仍须依据独立回查判断是否完成；原月份及账户未再发现目标，不等于全账套不存在。超时、响应丢失或回查失败保留原 id 只读 inspect，不重发，不重新准备同目标。',
    parameters: { id: { type: 'string', required: true, description: '已展示的本地删除预览 ID。' },
      version: { type: 'integer', required: true, description: '已展示的准确预览版本。' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的 Finance 会话中删除日记账。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain
        .deleteJournal(agent, args, exec.signal, config)))
    },
    presentCall: () => ({ card: 'generic', title: '确认并删除指定日记账', kind: 'delete' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '日记账删除未完成' : '日记账删除结果',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
}
