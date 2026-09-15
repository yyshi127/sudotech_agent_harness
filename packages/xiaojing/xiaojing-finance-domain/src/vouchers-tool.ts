/** Temporary Finance-only voucher query; identity and credentials remain owned by the Host. */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'

/** Loader-visible plugin identity. */
export const name = 'xiaojing-finance-vouchers-tool'
/** Required tool registry and Finance Host. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Default page size for the temporary query. */
export interface Config { pageSize: number }
/** Deployment-controlled default; the executor admits at most 100 vouchers per call. */
export const Config: s<Config> = s.object({ pageSize: s.number().min(1).max(100).default(20) })

/** Register the read-only query in the Finance preset. @param ctx - Preset scope. @param config - Default page size. */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'finance_voucher_detail',
    description: '只读查询当前绑定账套的一张有成财务凭证详情。voucherId 使用列表结果或用户明确提供的 ID，不是“记-1”等凭证号。用户说“刚才那笔”“提现那张”时，结合会话中已核实的列表、科目、借贷方向和金额定位；多个候选则列出让用户选择，不猜 ID。没有候选时先用 finance_vouchers 查询，不能要求用户记住接口字段。账套和凭据由后端确定。结果仅包含会计分录、期间和状态，不包含附件、辅助核算及外币明细。',
    parameters: { voucherId: { type: 'string', required: true, description: '指定凭证 ID，必须来自查询结果或用户明确提供，不得编造。' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        accountId: { type: 'string', required: true }, accountName: { type: 'string', required: true },
        voucherId: { type: 'string', required: true }, date: { type: 'string', required: true },
        number: { type: 'string', required: true }, period: { type: 'string', required: true },
        audited: { type: 'boolean', required: true }, settled: { type: 'boolean', required: true },
        documentMaker: { type: 'string', required: true }, notice: { type: 'string', required: true },
        rows: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          voucherId: { type: 'string', required: true }, date: { type: 'string', required: true },
          number: { type: 'string', required: true }, summary: { type: 'string', required: true },
          subjectCode: { type: 'string', required: true }, subjectName: { type: 'string', required: true },
          debit: { type: 'string', required: true }, credit: { type: 'string', required: true },
        } } },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户帐套的 Finance 会话中查询凭证。')
      return ctx.xiaojingFinanceDomain.queryVoucherDetail(exec.agent, args.voucherId, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: '查询凭证详情', kind: 'read', rawInput: args }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '凭证详情查询失败' : '凭证详情', content: result.content }),
  }))
  ctx.tools.register(defineTool({
    name: 'finance_vouchers',
    description: '查询当前客户帐套绑定的有成财务凭证，只读临时测试能力。查询凭证时优先直接调用本工具，不要搜索工作区、源码或配置文件，不要向用户索取 AppKey、AppSecret、账套 ID。后端自动使用当前绑定和已保存凭据。month=current 表示北京时间本月，YYYY-MM 表示指定月份；省略 month 查询不限月份的指定页（不是最近日期排序）。按日期、凭证号、摘要、借方、贷方逐分录展示，注明账套、月份、总张数和分页；有下一页时继续按需调用，不将一页或空页称为全部结果。失败时如实说明，不编造数据，不回退到 shell 取密钥。',
    parameters: {
      month: { type: 'string', description: '会计期间 YYYY-MM 或 current（北京时间本月）；省略则不限期间。不是制单日期筛选；逐笔期间未复核，须遵守结果 notice。' },
      monthEnd: { type: 'string', description: '范围结束会计期间 YYYY-MM，含本期间；必须同时提供 month，且结束不早于开始。不填则 month 只查一个期间。' },
      summary: { type: 'string', description: '仅用于用户明确指定的摘要文字，不是自然语言搜索框。例如“取现”不一定匹配“银行提现”；口语、近义表达或按业务含义查找时先省略此条件，读取指定期间的凭证后结合全部分录、科目、借贷方向和金额判断候选。不可把关键词无结果解释为业务不存在。翻页保留原条件，不删掉凭证其他分录。' },
      page: { type: 'integer', description: '页码，从 1 开始；省略为第一页。' },
      pageSize: { type: 'integer', description: '每页凭证张数，1–100；不等于分录行数。' },
      exportExcel: { type: 'boolean', description: '用户要求导出本查询页为 Excel 时设 true。重新查询并导出本次返回的所有分录；不是此前结果快照或全部分页。金额为精确文本，保留分页范围，不附加币种或合计。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        accountId: { type: 'string', required: true }, accountName: { type: 'string', required: true },
        month: { type: 'string', required: true }, page: { type: 'integer', required: true },
        monthEnd: { type: 'string' }, summary: { type: 'string' },
        exportFile: { type: 'object', additionalProperties: false, properties: {
          path: { type: 'string', required: true }, name: { type: 'string', required: true },
          sha256: { type: 'string', required: true }, size: { type: 'integer', required: true },
        } },
        pageSize: { type: 'integer', required: true }, total: { type: 'integer', required: true },
        hasMore: { type: 'boolean', required: true }, voucherCount: { type: 'integer', required: true },
        notice: { type: 'string', required: true, description: '必须遵守的会计期间、总张数、分页完整性说明。' },
        rows: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          voucherId: { type: 'string', required: true }, date: { type: 'string', required: true },
          number: { type: 'string', required: true }, summary: { type: 'string', required: true },
          subjectCode: { type: 'string', required: true }, subjectName: { type: 'string', required: true },
          debit: { type: 'string', required: true }, credit: { type: 'string', required: true },
        } } },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户帐套的 Finance 会话中查询凭证。')
      const month = args.month === 'current'
        ? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7) : args.month
      const query = {
        ...month === undefined ? {} : { month }, page: args.page ?? 1, pageSize: args.pageSize ?? config.pageSize,
        ...args.monthEnd === undefined ? {} : { monthEnd: args.monthEnd },
        ...args.summary === undefined ? {} : { summary: args.summary },
      }
      if (args.exportExcel) {
        const { report, file } = await ctx.xiaojingFinanceDomain.exportVouchers(exec.agent, query, exec.signal)
        return { ...report, exportFile: { path: file.path, name: file.name, sha256: file.sha256, size: file.size } }
      }
      return ctx.xiaojingFinanceDomain.queryVouchers(exec.agent, query, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: args.exportExcel ? '导出凭证查询页' : '查询有成凭证', kind: args.exportExcel ? 'other' : 'read', rawInput: args }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '凭证查询失败' : '凭证查询结果', content: result.content }),
  }))
}
