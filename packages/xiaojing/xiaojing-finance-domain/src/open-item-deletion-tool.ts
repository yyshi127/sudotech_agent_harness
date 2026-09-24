/** AR/AP deletion preview, exact-version execution and recovery with direction-specific restrictions. */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader identity. */
export const name = 'xiaojing-finance-open-item-deletion-tool'
/** The Host binds the ledger and owns durable previews, confirmation and single dispatch. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Complete record/output and counted read bounds. */
export interface Config { maxBytes: number; maxPages: number; maxRows: number; pageSize: number }
/** Exceeding a limit rejects the lookup rather than implying absence. */
export const Config: s<Config> = s.object({ maxBytes: s.number().min(1).step(1).default(262144),
  maxPages: s.number().min(2).step(1).default(10), maxRows: s.number().min(1).step(1).default(1000),
  pageSize: s.number().min(1).max(100).step(1).default(100) })

/**
 * Register preparation/recovery and exact-version execution within the Finance preset.
 * @param ctx - Scoped registry and current-client Host service.
 * @param config - Validated bounds passed unchanged to the Host.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_prepare_open_item_deletion',
    description: '准备、修改或只读检查应收/应付删除前信息。理解用户日常说法后用 finance_open_items 定位，歧义先澄清；记录 openItemId 不等于往来账户 ID、客户 ID、摘要或行号。prepare/revise 指定准确记录 ID、应收 receivable 或应付 payable、起止期间；inspect 只用原本地记录 id。展示目标金额、已知限制和待核实项。execution为requires-confirmation时可用finance_delete_open_item请求准确版本确认；不能把未提供字段当成零或无关联。确认会明确提示有成可能连带删除关联对冲、核销或收入记录，公开接口无法完整排除该影响。not-observed 仅指原方向和期间未返回目标，不能宣称全账套删除成功；结果未知只检查原id，不重发。',
    parameters: {
      action: { type: 'string', enum: ['prepare', 'revise', 'inspect'], required: true },
      id: { type: 'string', description: 'revise/inspect 必填：已有本地检查记录 ID。' },
      version: { type: 'integer', description: 'revise 必填：当前准确版本。' },
      openItemId: { type: 'string', description: 'prepare/revise 必填：查询返回的应收或应付记录唯一 ID。' },
      direction: { type: 'string', enum: ['receivable', 'payable'], description: 'prepare/revise 必填：应收或应付，不混用。' },
      periodStart: { type: 'string', description: 'prepare/revise 必填：起始期间 YYYY-MM。' },
      periodEnd: { type: 'string', description: 'prepare/revise 必填：截止期间 YYYY-MM。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的 Finance 会话中检查应收应付删除条件。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain
        .prepareOpenItemDeletion(agent, args, exec.signal, config)))
    },
    presentCall: args => ({ card: 'generic', title: args.action === 'inspect' ? '只读检查应收应付删除记录' : '检查应收应付删除条件',
      kind: 'other' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '应收应付删除检查未完成' : '应收应付删除条件与限制',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_delete_open_item',
    description: '执行finance_prepare_open_item_deletion已展示的准确id/version。Host在确认前及发送前重查账套、方向、期间、目标状态和已观察关联，并强制确认公开接口无法完整排除的连带删除风险。聊天同意不能绕过确认；已知关联或状态限制禁止发送。接口接收不等于删除已核验完成，回查只覆盖原方向及期间；超时、响应丢失或回查失败只读inspect原id，绝不重发。',
    parameters: { id: { type: 'string', required: true, description: '已展示的本地应收应付删除预览ID。' },
      version: { type: 'integer', required: true, description: '已展示的准确预览版本。' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的Finance会话中确认应收应付删除。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain
        .deleteOpenItem(agent, args, exec.signal, config)))
    },
    presentCall: () => ({ card: 'generic', title: '确认并删除指定应收应付', kind: 'delete' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '应收应付删除未完成' : '应收应付删除结果',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
}
