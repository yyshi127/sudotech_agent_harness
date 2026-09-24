/** Finance-only journal previews and exact-version mandatory creation; the Host owns credentials and sending. */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import { journalCreateRequestSchema } from './journal-preparation.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader-visible plugin identity. */
export const name = 'xiaojing-finance-journal-preparation-tool'
/** Required registry and client-bound Finance Host. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Deployment limit for complete previews, durable records and sender responses. */
export interface Config { maxBytes: number }
/** Explicit operation-size policy. */
export const Config: s<Config> = s.object({ maxBytes: s.number().min(1).step(1).default(131072) })

/**
 * Register local preparation and separately confirmed journal creation.
 * @param ctx - Finance preset scope.
 * @param config - Deployment operation limits.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_prepare_journal',
    description: '准备、修改或查看当前客户财务日记账。按用户自然语言理解收入或支出，不要求精确关键词；先用finance_references查询cash-accounts和cash-categories，选择真实账户ID与收支方向匹配的类别ID，不猜标识。同名不猜选，日期、金额、记账人缺失时澄清。prepare仅保存本地预览；revise传最新id/version和完整新内容；inspect查看原记录并只读回查，不创建。不要把日记账记载当成实际收付款，不自动生成凭证、关联附件或新增基础资料。',
    parameters: {
      action: { type: 'string', enum: ['prepare', 'revise', 'inspect'], required: true },
      id: { type: 'string', description: '修改或查看时使用本会话此前返回的本地ID。' },
      version: { type: 'integer', description: '修改时必填，使用最近预览版本。' },
      input: { type: 'object', additionalProperties: false, description: '准备或修改时的完整内容；查看时省略。', properties: {
        cashAccountId: { type: 'string', required: true, description: 'cash-accounts查询返回的账户ID，不是会计科目编码或科目ID。' },
        date: { type: 'string', required: true, description: '用户指定或确认的YYYY-MM-DD日期。' },
        direction: { type: 'string', enum: ['income', 'expense'], required: true },
        amount: { type: 'string', required: true, description: '按所选账户币别记录的正数，两位小数，例如100.00；不猜币种或换算。' },
        summary: { type: 'string', required: true }, keeperName: { type: 'string', required: true },
        categoryId: { type: 'string', description: '可选真实收支类别ID，不传名称或编码；无类别时明确告知。' },
      } },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的Finance会话中准备日记账。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() =>
        ctx.xiaojingFinanceDomain.prepareJournal(agent, args, exec.signal, config.maxBytes)))
    },
    presentCall: args => ({ card: 'generic', title: args.action === 'inspect' ? '查看日记账记录' : '准备日记账预览', kind: 'other' }),
    presentResult: (args, result) => ({ card: 'generic', title: result.isError ? '日记账记录操作失败'
      : args.action === 'inspect' ? '日记账记录与回查' : '日记账预览（未创建）',
    content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_create_journal',
    description: '仅在用户要求创建日记账时，提交finance_prepare_journal展示的准确id/version。系统必须请求本次强制确认，聊天中的“已确认”不能绕过。只记载收入或支出，不执行实际收付款，不生成凭证、审核、核销或删除。接口返回记录标识后，仍须依据独立回查判断本记录是否完成一致性核对。结果未知或回查失败时inspect原记录，不重发、不另建相同内容规避防重复。',
    parameters: { id: { type: 'string', required: true }, version: { type: 'integer', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的Finance会话中创建日记账。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain.createJournal(
        agent, journalCreateRequestSchema.parse(args), exec.signal, config.maxBytes)))
    },
    presentCall: () => ({ card: 'generic', title: '确认并创建日记账', kind: 'other' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '日记账创建未完成' : '日记账创建结果',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
}
