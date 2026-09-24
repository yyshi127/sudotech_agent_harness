/** Finance-only full-settlement previews, mandatory confirmation and read-only recovery through generic cards. */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader identity. */
export const name = 'xiaojing-finance-open-item-write-off-tool'
/** Current-client Host and scoped tool registry. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Complete preview/record and returned-page bounds. */
export interface Config { maxBytes: number; maxRows: number }
/** Oversized evidence is rejected rather than truncated into an actionable preview. */
export const Config: s<Config> = s.object({ maxBytes: s.number().min(1).step(1).default(262144),
  maxRows: s.number().min(1).step(1).default(1000) })

/**
 * Register full-settlement preparation, exact-version execution and original-record inspection.
 * @param ctx - Finance preset scope; ledger and credentials are supplied by the Host.
 * @param config - Validated complete result and row limits.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_prepare_open_item_write_off',
    description: '理解用户关于收到欠款、付清应付款或核销余额的自然表达。先用finance_open_items定位唯一往来记录，用finance_references的cash-accounts选择真实资金账户；有歧义或日期、资金账户、记账人不明确时澄清，不猜ID。prepare准备整笔未结余额方案，revise传原id/version及完整input，inspect只读检查原本地id。往来记录openItemId不等于往来账户ID、资金账户ID或客户ID。execution为requires-confirmation时可用finance_write_off_open_item请求准确版本确认；限制不可绕过。核销是记录已收已付，不发起银行收付款；当前执行要求本位币往来及未启用外币的末级资金科目，不支持部分核销、反核销。期间状态未提供，不宣称已检查可记账期间。结果未知不能另建同笔方案重发；余额匹配不证明操作归因，receiptId不是journalId。',
    parameters: {
      action: { type: 'string', enum: ['prepare', 'revise', 'inspect'], required: true },
      id: { type: 'string', description: 'revise/inspect必填：原本地核销记录ID。' }, version: { type: 'integer' },
      input: { type: 'object', additionalProperties: false, properties: {
        direction: { type: 'string', enum: ['receivable', 'payable'], required: true },
        openItemId: { type: 'string', required: true }, cashAccountId: { type: 'string', required: true },
        amount: { type: 'string', required: true, description: '准确完整未结余额，两位小数正数。' },
        currencyCode: { type: 'string', required: true, description: '原记录返回币种，不自动换算。' },
        date: { type: 'string', required: true, description: '明确的核销日期YYYY-MM-DD，不得早于原业务日期。' },
        keeperName: { type: 'string', required: true },
        sourceQuery: { type: 'object', required: true, additionalProperties: false, properties: {
          direction: { type: 'string', enum: ['receivable', 'payable'], required: true },
          periodStart: { type: 'string', required: true }, periodEnd: { type: 'string', required: true },
          page: { type: 'integer', required: true }, pageSize: { type: 'integer', required: true },
        } },
      } },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的Finance会话中准备或检查核销。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() =>
        ctx.xiaojingFinanceDomain.prepareOpenItemWriteOff(agent, args, exec.signal, config)))
    },
    presentCall: args => ({ card: 'generic', title: args.action === 'inspect' ? '只读检查原核销记录' : '准备整笔核销方案',
      kind: 'other' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '核销准备或检查未完成' : '核销方案与执行限制',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_write_off_open_item',
    description: '执行finance_prepare_open_item_write_off已展示的准确id/version，Host强制确认对象、完整余额、日期及资金账户。聊天同意不能绕过确认。确认前和发送前重查；已变化需重新预览。不发起银行收付款，不部分核销、反核销或自动处理其他关联。接口接收不等于核验完成，须以四项独立回查给出业务结论；超时、响应丢失或回查失败只读inspect原id，不重发或另建同笔方案。',
    parameters: { id: { type: 'string', required: true, description: '已展示的本地核销预览ID。' },
      version: { type: 'integer', required: true, description: '已展示的准确预览版本。' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的Finance会话中确认核销。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() =>
        ctx.xiaojingFinanceDomain.writeOffOpenItem(agent, args, exec.signal, config)))
    },
    presentCall: () => ({ card: 'generic', title: '确认并核销指定往来', kind: 'execute' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '核销未完成' : '核销结果',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
}
