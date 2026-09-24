/** Model-facing count-reconciled open-item analytics; arithmetic and data collection stay in the Host. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader-visible plugin identity. */
export const name = 'xiaojing-finance-open-item-analysis-tool'
/** Required Finance service and tool registry. */
export const inject = ['tools', 'xiaojingFinanceDomain']

/** Register read-only same-currency analytics. @param ctx - Finance preset scope. */
export function apply(ctx: Context): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_open_item_analysis',
    description: `只读汇总或比较当前绑定账套的应收/应付记录。理解欠款总额、分科目看、按辅助项目归集、两段期间对比等自然语言；后端自行完整取数和精确计算，不让模型拼接金额或凭据。groupBy 选择 currency、subject 或 auxiliary，始终按原币分组，不跨币种加总。可选 baseline 表示基准期间，差额为 current 减 baseline。比较的是两组查询记录的金额/余额，不是历史期末余额趋势、实际收付款或官方财务报表。余额表和日记账不由本工具计算。无法确认方向或期间时澄清，不猜测。
余额时点：期间筛选限定记录所属期间，不把返回余额还原为该期间末的历史余额。结论应写“本次查询记录的未结余额”，不能写“某月末还欠多少”。来源说明：有成接口提供业务明细，小兢会计在本地计算分组与差额；groups 不是接口合计，不写“接口本地分组”。summaries 币种为空时不能借用业务行币种。发送前检查全文，尤其最终结论是否违反上述限制。
导出会生成当前条件的完整分析文件。文件链接使用回执给出的完整 path，不自行拼接。`,
    parameters: {
      direction: { type: 'string', required: true, enum: ['receivable', 'payable'], description: '应收 receivable；应付 payable。' },
      groupBy: { type: 'string', required: true, enum: ['currency', 'subject', 'auxiliary'], description: '按币种、科目或完整辅助项目 ID 组合分组；不推断客户或供应商身份。' },
      periodStart: { type: 'string', required: true, description: '当前查询组开始会计期间 YYYY-MM。' },
      periodEnd: { type: 'string', required: true, description: '当前查询组结束会计期间 YYYY-MM，含本期。' },
      baselineStart: { type: 'string', description: '比较时提供的基准组开始期间 YYYY-MM，与 baselineEnd 同时提供。' },
      baselineEnd: { type: 'string', description: '基准组结束期间 YYYY-MM。' },
      exportExcel: { type: 'boolean', description: '仅在用户要求导出 Excel 时设为 true；文件包含当前条件的分组及期间差额。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户帐套的 Finance 会话中汇总应收应付。')
      const agent = exec.agent
      if ((args.baselineStart === undefined) !== (args.baselineEnd === undefined)) throw new Error('基准起止期间须同时提供。')
      const query = {
        direction: args.direction, groupBy: args.groupBy,
        current: { periodStart: args.periodStart, periodEnd: args.periodEnd },
        ...args.baselineStart === undefined || args.baselineEnd === undefined ? {} : {
          baseline: { periodStart: args.baselineStart, periodEnd: args.baselineEnd },
        },
      }
      if (args.exportExcel) {
        const { report, file } = await financeModelCall(() =>
          ctx.xiaojingFinanceDomain.exportOpenItems(agent, query, exec.signal))
        return financeModelJson({ accountName: report.accountName, direction: report.selection.direction,
          periodStart: report.current.periodStart, periodEnd: report.current.periodEnd,
          recordCount: report.current.recordCount, groupCount: report.current.groups.length,
          differenceCount: report.differences?.length ?? 0,
          exportFile: { path: file.path, name: file.name } })
      }
      return financeModelJson(await financeModelCall(() =>
        ctx.xiaojingFinanceDomain.analyzeOpenItems(agent, query, exec.signal)))
    },
    presentCall: args => ({ card: 'generic', title: args.exportExcel ? '导出应收应付 Excel' : '汇总应收应付', kind: args.exportExcel ? 'other' : 'read' }),
    presentResult: (args, result) => ({ card: 'generic', title: result.isError ? '应收应付汇总失败'
      : args.exportExcel ? '应收应付汇总导出完成' : '应收应付汇总结果',
    content: financeResultContent(result.content, result.isError, 'open-item-analysis') }),
  })))
}
