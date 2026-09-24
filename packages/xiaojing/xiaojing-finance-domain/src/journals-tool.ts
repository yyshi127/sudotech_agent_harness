/** Finance-only journal consumer; ledger and credential authority remain in the Host. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import s from '@deepseek-ai/schemastery'
import type {} from './index.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader-visible plugin identity. */
export const name = 'xiaojing-finance-journals-tool'
/** Required registry and Finance service. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Deployment-owned page size. */
export interface Config { pageSize: number }
/** The executor admits at most 100 business rows per page. */
export const Config: s<Config> = s.object({ pageSize: s.number().min(1).max(100).default(20) })

/** Register the bounded read-only journal tool. @param ctx - Finance preset scope. @param config - Default page size. */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_journals',
    description: '只读查询或核对当前绑定账套的有成日记账。比较、汇总或问进账/花费差多少，必须使用 analyze:true：先用 finance_references 的 cash-accounts 确定账户 ID，再传 cashAccountId、month 和比较时的 baselineMonth，直接使用返回的核对结果与差额；不要分查两个月第一页后自行相减。即使同时查询凭证、余额或应收应付，这一要求也不变。仅查看原始流水时才使用普通分页查询。'
      + '\n用户说进账、花了多少钱、银行收支等，结合上下文理解收入/支出及账户，不要求严格关键词。month 必填，省略日期时后端自动补齐月初月末；原始分页查询每次只查一个月。账户不明确时先用 finance_references 查询 cash-accounts，cashAccountId 必须来自该账套的查询结果，不把科目编码当账户 ID；省略则不限定出纳账户。不搜索配置或索取密钥。按结果日期、账户、收入、支出展示：空页不等于当天没有流水，缺失币种不补人民币或元，相邻余额一致不等于独立核验。汇总不是业务流水，不重复加总；空值不当零，不跨币种相加。不自行新增或生成凭证。'
      + '\n回答组织：先写查询范围及本页返回记录，再写“接口初始余额”和“接口合计”，最后写未验证事项及实际导出文件。标题也必须保留接口标签，不能命名为“当天开始/结束结余”“日初/日末余额”。用户询问这些结余时直接说明现有证据不足以确认，随后展示原始汇总供参考。不要因两项余额相等而解释为“当天无发生额，故余额不变”。'
      + '\n发送最终回答前检查全部标题、表格、总结和过渡句：没有任何一句将“本页未返回业务流水”缩写为“当天无业务流水”，没有把汇总标签改成已确认的日初日末，也没有补造币种。删除相互矛盾的断言，不用免责声明来修补它。'
      + '\n需要指定账户的收支汇总或两期比较时使用 analyze:true，并提供已查询确认的 cashAccountId；不要提供 page/pageSize，后端自动完整读取当前条件并核对有成合计。baselineMonth 可选，表示基准月份，差额由后端计算为当前减基准。仅支持同一账户、业务币种一致的收支比较，不计算余额趋势或全账套汇总。缺失金额单元格数不是缺少流水记录，失败不能自行用原始页凑合计。',
    parameters: {
      analyze: { type: 'boolean', description: '汇总指定出纳账户收支或比较两期时为 true，后端取数并核对；默认仅查询原始页。' },
      baselineMonth: { type: 'string', description: '仅 analyze:true 时可选：基准期间 YYYY-MM；不提供则只汇总当前日期范围。' },
      baselineDateStart: { type: 'string', description: '基准月内开始日期，须和 baselineDateEnd 同时提供。' },
      baselineDateEnd: { type: 'string', description: '基准月内结束日期，包含当日；省略日期则查询整个基准月。' },
      exportExcel: { type: 'boolean', description: '用户要求导出日记账 Excel 时设 true；文件包含当前筛选范围内读取到的业务流水及有成汇总。' },
      month: { type: 'string', required: true, description: '会计期间 YYYY-MM 或 current（北京时间本月）。' },
      dateStart: { type: 'string', description: '可选，月份内开始日期 YYYY-MM-DD，与 dateEnd 同时提供。' },
      dateEnd: { type: 'string', description: '月份内结束日期 YYYY-MM-DD，包含当日。' },
      cashAccountId: { type: 'string', description: '当前账套基础资料查询返回的出纳账户 ID，不是科目编码。' },
      page: { type: 'integer', description: '从 1 开始；省略查询第一页。' },
      pageSize: { type: 'integer', description: '每页最多 1–100 笔业务记录；接口汇总不算业务记录。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户帐套的 Finance 会话中查询日记账。')
      const agent = exec.agent
      const month = args.month === 'current'
        ? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7) : args.month
      if (args.analyze) {
        if (!args.cashAccountId) throw new Error('日记账汇总须先查询并选择一个出纳账户。')
        if (args.page !== undefined || args.pageSize !== undefined) throw new Error('日记账汇总由后端控制分页，不接受 page/pageSize。')
        if (!args.baselineMonth && (args.baselineDateStart !== undefined || args.baselineDateEnd !== undefined)) {
          throw new Error('基准日期须提供所属基准月份。')
        }
        const query = { cashAccountId: args.cashAccountId,
          current: { month,
            ...args.dateStart === undefined ? {} : { dateStart: args.dateStart },
            ...args.dateEnd === undefined ? {} : { dateEnd: args.dateEnd } },
          ...args.baselineMonth === undefined ? {} : { baseline: { month: args.baselineMonth,
            ...args.baselineDateStart === undefined ? {} : { dateStart: args.baselineDateStart },
            ...args.baselineDateEnd === undefined ? {} : { dateEnd: args.baselineDateEnd } } } }
        if (args.exportExcel) {
          const { report, file } = await financeModelCall(() =>
            ctx.xiaojingFinanceDomain.exportJournalAnalysis(agent, query, exec.signal))
          return financeModelJson({ accountName: report.accountName,
            month: report.current.month, dateStart: report.current.dateStart, dateEnd: report.current.dateEnd,
            recordCount: report.current.rows.length,
            ...report.baseline === undefined ? {} : { baselineMonth: report.baseline.month },
            exportFile: { path: file.path, name: file.name } })
        }
        return financeModelJson(await financeModelCall(() =>
          ctx.xiaojingFinanceDomain.analyzeJournals(agent, query, exec.signal)))
      }
      if (args.baselineMonth !== undefined || args.baselineDateStart !== undefined || args.baselineDateEnd !== undefined) throw new Error('两期比较须使用 analyze:true。')
      const query = {
        month, page: args.page ?? 1, pageSize: args.pageSize ?? config.pageSize,
        ...args.dateStart === undefined ? {} : { dateStart: args.dateStart },
        ...args.dateEnd === undefined ? {} : { dateEnd: args.dateEnd },
        ...args.cashAccountId === undefined ? {} : { cashAccountId: args.cashAccountId },
      }
      if (args.exportExcel) {
        const { report, file } = await financeModelCall(() =>
          ctx.xiaojingFinanceDomain.exportJournals(agent, query, exec.signal))
        return financeModelJson({ accountName: report.accountName, month: report.selection.month,
          dateStart: report.selection.dateStart, dateEnd: report.selection.dateEnd,
          recordCount: report.rows.length, exportFile: { path: file.path, name: file.name } })
      }
      return financeModelJson(await financeModelCall(() =>
        ctx.xiaojingFinanceDomain.queryJournals(agent, query, exec.signal)))
    },
    presentCall: args => ({ card: 'generic', title: args.analyze ? args.exportExcel ? '导出日记账收支核对' : '核对日记账收支' : args.exportExcel ? '导出日记账' : '查询日记账', kind: args.exportExcel ? 'other' : 'read' }),
    presentResult: (args, result) => ({ card: 'generic', title: result.isError ? '日记账查询失败'
      : args.exportExcel ? '日记账导出完成' : args.analyze ? '日记账收支汇总' : '日记账查询结果',
    content: financeResultContent(result.content, result.isError, 'journal') }),
  })))
}
