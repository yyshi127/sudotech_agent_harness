/** Separate read-only deletion preparation and mandatory-confirmation execution in the Finance preset. */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader identity. */
export const name = 'xiaojing-finance-voucher-deletion-tool'
/** Host owns ledger selection, approval and persistence. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Bounds for source validation, complete previews and each independent inventory pass. */
export interface Config { maxEntries: number; maxBytes: number; maxPages: number }
/** Explicit deployment limits; exceeding inventory bounds never proves absence. */
export const Config: s<Config> = s.object({
  maxEntries: s.number().min(2).step(1).default(100),
  maxBytes: s.number().min(1).step(1).default(131072),
  maxPages: s.number().min(1).step(1).default(10),
})

/**
 * Register separate preview and destructive tools with generic cards exposing exact versions and outcomes.
 * @param ctx - Finance preset scope.
 * @param config - Validated bounds passed to the Host.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_prepare_voucher_deletion',
    description: '准备、修改或只读检查指定财务凭证的删除记录，不发送删除。先理解用户自然语言意图，用 finance_vouchers 定位并澄清歧义；凭证号、摘要不代替唯一 voucherId。prepare/revise 使用当前绑定账套和实时凭证详情，不要求凭证由小兢创建，也不接收 appId、flowId 或账套参数。完整展示目标账套、日期、凭证号、分录、附件数量和风险；不联动删除其他业务。inspect 只读取已有删除记录并回查，结果未知时用原 id 复查，不另建同目标删除尝试。',
    parameters: {
      action: { type: 'string', enum: ['prepare', 'revise', 'inspect'], required: true },
      id: { type: 'string', description: 'revise/inspect 必填：已有本地删除记录 ID。' },
      version: { type: 'integer', description: 'revise 必填：已有删除预览的准确版本。' },
      voucherId: { type: 'string', description: 'prepare/revise 必填：查询确认的有成凭证唯一 ID。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的 Finance 会话中准备删除。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain
        .prepareVoucherDeletion(agent, args, exec.signal, config)))
    },
    presentCall: args => ({ card: 'generic', title: args.action === 'inspect' ? '只读检查凭证删除记录' : '准备凭证删除预览',
      kind: 'other' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '删除准备或检查未完成' : '凭证删除预览与检查',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_delete_voucher',
    description: '仅在用户明确要求删除时，提交 finance_prepare_voucher_deletion 已展示的准确 id/version。系统强制请求本次确认，聊天里说“已确认”不能绕过。目标或状态变化需重新预览；取消、拒绝或过期版本不得发送。共享目标记录防止换会话重复发送。删除只移除指定凭证，不联动删除日记账、应收应付，不审核、结账或实际支付，不提供自动撤销。接口接收后仍须依据两次独立列表回查判断是否完成。结果未知、超时或回查失败用原 id inspect，不重发、不重新准备同目标。',
    parameters: { id: { type: 'string', required: true, description: '本地删除预览 ID。' },
      version: { type: 'integer', required: true, description: '已向用户展示的准确预览版本。' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的 Finance 会话中删除凭证。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain
        .deleteVoucher(agent, args, exec.signal, config)))
    },
    presentCall: () => ({ card: 'generic', title: '确认并删除指定凭证', kind: 'delete' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '凭证删除未完成' : '凭证删除结果',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
}
