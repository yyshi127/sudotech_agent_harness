/** Finance-only balance report consumer; Host owns ledger authority and limits. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { withFinanceCard } from './finance-card.ts'
import type {} from './index.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'

/** Loader-visible plugin identity. */
export const name = 'xiaojing-finance-balances-tool'
/** Required registry and Finance Host. */
export const inject = ['tools', 'xiaojingFinanceDomain']

/** Register a read-only balance query in the Finance preset. @param ctx - Preset scope. */
export function apply(ctx: Context): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_balances',
    description: '只读查询当前绑定账套的有成财务科目余额表。用户问现金、银行、某科目余额或本期发生额时，结合上下文确定会计期间，使用本工具后根据科目名称和层级理解用户意图，不要求严格关键词。期间有歧义才询问；不要索取密钥或账套 ID，不搜索文件代替查询。'
      + '\n用户要核对合计、统计一致/无法核对列数、汇总或跨月比较时，调用 analyze=true；核对接口合计用 subjectLevel=1，另一月份用 compareMonth。不要用两次原始查询替代程序核对。回答仅使用本次 reconciliation 和 reconciliationCounts，八个借贷列之外的 Balance 字段不进入核对计数；历史回答冲突时纠正历史答案，不沿用旧计数。'
      + '\n回答列名固定：期初借方/贷方、本期借方/贷方、本年累计借方/贷方、期末借方/贷方；Balance 字段称“接口余额”，不要改成“本月净额”。用户说进出也不能把所有科目的借贷统一标成增加/减少或进账/出账。没有凭证关联证据，不从现金银行金额相等或相反推断划转、收款、付款。'
      + '\n空值统一写“未提供”，包括科目表、接口汇总、标题和结论。发生额留空只能说明未提供，不能称“本期无发生”；期初期末相等也不能证明期间没有发生。禁止用“无”“无（空）”代替 null，保留负数所在借贷列，不自行推算缺失金额。'
      + '\nrows 为科目行，summaries 为有成返回的小计/合计，不把父子科目和汇总重复相加。直接引用返回的合计，不添加自行展开的算式；用户要求计算时，须先取得对应口径的可验证计算结果。数据范围不足时不能宣称全账套完整、试算平衡或无异常。',
    parameters: {
      month: { type: 'string', required: true, description: '起始会计期间 YYYY-MM；current 表示北京时间本月。' },
      monthEnd: { type: 'string', description: '含本月的结束期间 YYYY-MM；省略则只查起始月份。' },
      analyze: { type: 'boolean', description: '用户要求比较、汇总、核对接口合计或统计一致/无法核对列数时必须设 true，同时提供 subjectLevel；接口合计核对用一级 subjectLevel=1。使用返回的 reconciliation 和 reconciliationCounts，不根据原始查询自行计数。跨月提供 compareMonth；不支持真正的月份或层级范围。' },
      compareMonth: { type: 'string', description: 'analyze=true 时的基准月份 YYYY-MM。差额为 month 减本月；按科目 ID 对齐，缺失行和金额不补零。' },
      subjectLevel: { type: 'integer', description: '可选的单个科目层级，正整数。查询已知层级的子科目时使用；省略采用接口默认层级。可先查询科目资料确定层级，不将父级未包含的子科目当作不存在，不宣称已查询全部层级。' },
      subjectLevelEnd: { type: 'integer', description: '可选结束层级，必须同时提供 subjectLevel 作为起始层级且不大于结束层级。指定范围时关闭分页，按本位币查询该范围并包含禁用科目；仍遵守完整性限制，不能将父子科目重复累计。' },
      exportExcel: { type: 'boolean', description: '用户要求将科目余额结果导出 Excel 时设 true；文件保留空值、负借贷列及有成返回的独立汇总。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户帐套的 Finance 会话中查询科目余额表。')
      const agent = exec.agent
      const month = args.month === 'current'
        ? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7) : args.month
      if (args.compareMonth !== undefined && !args.analyze) throw new Error('余额跨期比较需要 analyze=true。')
      if (args.analyze) {
        if (args.subjectLevel === undefined || (args.monthEnd !== undefined && args.monthEnd !== month)
          || (args.subjectLevelEnd !== undefined && args.subjectLevelEnd !== args.subjectLevel)) {
          throw new Error('余额分析须指定单个 subjectLevel，不与期间范围或层级范围混用。')
        }
        const selection = { month, subjectLevel: args.subjectLevel,
          ...args.compareMonth === undefined ? {} : { compareMonth: args.compareMonth } }
        if (args.exportExcel) {
          const { report, file } = await financeModelCall(() =>
            ctx.xiaojingFinanceDomain.exportBalanceAnalysis(agent, selection, exec.signal))
          return financeModelJson({ accountName: report.accountName, month: report.selection.month,
            ...report.selection.compareMonth === undefined ? {} : { compareMonth: report.selection.compareMonth },
            subjectCount: report.current.rows.length, differenceCount: report.differences?.length ?? 0,
            exportFile: { path: file.path, name: file.name } })
        }
        return financeModelJson(await financeModelCall(() =>
          ctx.xiaojingFinanceDomain.analyzeBalances(agent, selection, exec.signal)))
      }
      const query = {
        month, ...args.monthEnd === undefined ? {} : { monthEnd: args.monthEnd },
        ...args.subjectLevel === undefined ? {} : { subjectLevel: args.subjectLevel },
        ...args.subjectLevelEnd === undefined ? {} : { subjectLevelEnd: args.subjectLevelEnd },
      }
      if (args.exportExcel) {
        const { report, file } = await financeModelCall(() =>
          ctx.xiaojingFinanceDomain.exportBalances(agent, query, exec.signal))
        return financeModelJson({ accountName: report.accountName, month: report.month, monthEnd: report.monthEnd,
          subjectCount: report.rows.length, summaryCount: report.summaries.length,
          exportFile: { path: file.path, name: file.name } })
      }
      return financeModelJson(await financeModelCall(() =>
        ctx.xiaojingFinanceDomain.queryBalances(agent, query, exec.signal)))
    },
    presentCall: args => ({ card: 'generic', title: args.exportExcel ? '导出科目余额查询' : '查询科目余额表', kind: args.exportExcel ? 'other' : 'read' }),
    presentResult: (args, result) => ({ card: 'generic', title: result.isError ? '科目余额表查询失败' : args.exportExcel ? '科目余额表导出完成' : '科目余额表',
      content: financeResultContent(result.content, result.isError, 'balance') }),
  })))
}
