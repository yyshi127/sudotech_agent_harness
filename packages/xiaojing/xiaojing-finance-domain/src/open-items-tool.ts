/** Finance-only receivable/payable query consumer; connection authority belongs to the Host. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import s from '@deepseek-ai/schemastery'
import type {} from './index.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader-visible plugin identity. */
export const name = 'xiaojing-finance-open-items-tool'
/** Required registry and bound Finance service. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Deployment-owned default page size. */
export interface Config { pageSize: number }
/** Maximum requested page size is 100 business records. */
export const Config: s<Config> = s.object({ pageSize: s.number().min(1).max(100).default(20) })

/** Register read-only open-item querying. @param ctx - Finance preset scope. @param config - Default page size. */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_open_items',
    description: `只读查询当前绑定账套的有成应收或应付。结合自然语言与上下文识别意图：别人欠我们、待收款通常为 receivable；我们欠别人、待付款通常为 payable，不要求固定关键词。方向不清楚时澄清，不猜测。期间必填；查询两种方向须分别调用。按返回的币种、金额、余额、科目和辅助项目展示，不把辅助项目名称直接当作已核实的客户或供应商身份。不索取密钥或搜索配置。汇总不是业务记录，不重复加总；空值不当零，不跨币种相加。一页不是全部，结清不代表银行已收付款。不执行新增、删除或核销。
汇总标签：previous-page 只称“上一页总计”，不能改称“初始余额”“期初余额”；total 只称“接口合计”，不能在未核实其范围时改称“本页合计”。标题、表格及总结均遵守此规则，不用免责声明抵消错误标签。
余额时点：期间筛选限定记录所属期间，不把返回余额还原为该期间末的历史余额。结论应写“本次查询记录的未结余额”，不能写“某月末还欠多少”。按币种的 groups 是本地业务行汇总，不称接口合计；summaries 币种为空时不能借用业务行币种。发送前检查全文，尤其最终结论是否违反上述限制。
用户同时要求查询和导出时，可在同一次调用设 exportExcel=true。导出须沿用已确认的方向和期间；后端完整读取当前条件，page/pageSize 只影响普通查询，不限制导出。文件链接使用回执给出的完整 path，不自行拼接或缩短为不存在的路径。`,
    parameters: {
      exportExcel: { type: 'boolean', description: '用户要求导出应收或应付 Excel 时设 true；文件包含当前方向和期间内读取到的全部记录。' },
      direction: { type: 'string', enum: ['receivable', 'payable'], required: true, description: 'receivable 应收；payable 应付。' },
      periodStart: { type: 'string', required: true, description: '开始会计期间 YYYY-MM 或 current（北京时间本月）。' },
      periodEnd: { type: 'string', required: true, description: '结束会计期间 YYYY-MM 或 current，含本期，不早于开始。' },
      page: { type: 'integer', description: '从 1 开始；省略查询第一页。' },
      pageSize: { type: 'integer', description: '每页 1–100 笔业务记录，汇总行另列。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户帐套的 Finance 会话中查询应收应付。')
      const agent = exec.agent
      const current = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7)
      const query = {
        direction: args.direction,
        periodStart: args.periodStart === 'current' ? current : args.periodStart,
        periodEnd: args.periodEnd === 'current' ? current : args.periodEnd,
        page: args.page ?? 1, pageSize: args.pageSize ?? config.pageSize,
      }
      if (args.exportExcel) {
        const { report, file } = await financeModelCall(() =>
          ctx.xiaojingFinanceDomain.exportOpenItemPage(agent, query, exec.signal))
        return financeModelJson({ accountName: report.accountName, direction: report.selection.direction,
          periodStart: report.selection.periodStart, periodEnd: report.selection.periodEnd,
          recordCount: report.rows.length, exportFile: { path: file.path, name: file.name } })
      }
      return financeModelJson(await financeModelCall(() =>
        ctx.xiaojingFinanceDomain.queryOpenItems(agent, query, exec.signal)))
    },
    presentCall: args => ({ card: 'generic', title: args.exportExcel ? `导出${args.direction === 'receivable' ? '应收' : '应付'}` : '查询应收应付', kind: args.exportExcel ? 'other' : 'read' }),
    presentResult: (args, result) => ({ card: 'generic', title: result.isError ? '应收应付查询失败'
      : args.exportExcel ? `${args.direction === 'receivable' ? '应收' : '应付'}导出完成` : '应收应付查询结果',
    content: financeResultContent(result.content, result.isError, 'open-item') }),
  })))
}
