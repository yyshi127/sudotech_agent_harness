/** Finance-only sourced open-item preparation and mandatory single-version creation. */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import { openItemPreparationRequestSchema, openItemCreateRequestSchema } from './open-item-preparation.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader-visible plugin identity. */
export const name = 'xiaojing-finance-open-item-preparation-tool'
/** Client-bound Host and scoped tool registry. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Complete proposal, durable record and transport-result limit. */
export interface Config { maxBytes: number }
/** Deployment-owned operation size limit. */
export const Config: s<Config> = s.object({ maxBytes: s.number().min(1).step(1).default(131072) })

/**
 * Register account-source reads, local preparation and separately confirmed creation.
 * @param ctx - Finance preset scope; the Host supplies client identity and credentials.
 * @param config - Deployment size limit.
 */
export function apply(ctx: Context, config: Config): void {
  const queryProperties: ParameterSchemaSpec = {
    direction: { type: 'string' as const, enum: ['receivable', 'payable'], required: true },
    periodStart: { type: 'string' as const, required: true, description: '明确的开始期间YYYY-MM，不自动扫描全部历史。' },
    periodEnd: { type: 'string' as const, required: true, description: '明确的结束期间YYYY-MM。' },
    page: { type: 'integer' as const, required: true }, pageSize: { type: 'integer' as const, required: true },
  }
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_open_item_accounts',
    description: '读取当前客户指定方向、期间和页码的已有应收应付记录所带账户ID、名称、状态和币种。仅是该页观察，不是完整账户目录；未返回不能说不存在，也不能用cash-accounts的资金账户、科目编码或猜测ID替代。用于finance_prepare_open_item的accountId和原样accountReferenceQuery。无已有记录或属性不全时明确账户无法核实，不自动造数或扫描其他期间。',
    parameters: queryProperties,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的Finance会话中查询往来账户。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain
        .queryObservedOpenItemAccounts(agent, args, exec.signal)))
    },
    presentCall: () => ({ card: 'generic', title: '查询已有往来账户属性', kind: 'other' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '往来账户查询失败' : '已有往来账户',
      content: financeResultContent(result.content, result.isError, 'references') }),
  })))
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_prepare_open_item',
    description: '理解用户自然语言的新增应收或应付意图，不要求精确关键词。先用finance_open_item_accounts获取真实账户及来源页，用finance_references查cash-categories、auxiliary-categories和auxiliary-items取得匹配的类别及往来项目ID；Host按真实类别名称:项目名称组装，不能自行猜名称或ID。prepare只生成本地预览；revise传准确id/version及完整新内容；inspect只查看原记录和核验结果。日期、金额、往来对象或记账人缺失时澄清，同名不猜选。只支持已核实本位币账户，不自动创建资料，不执行收付款、核销或生成凭证。',
    parameters: {
      action: { type: 'string', enum: ['prepare', 'revise', 'inspect'], required: true },
      id: { type: 'string' }, version: { type: 'integer' },
      input: { type: 'object', additionalProperties: false, properties: {
        direction: { type: 'string', enum: ['receivable', 'payable'], required: true },
        accountId: { type: 'string', required: true, description: 'finance_open_item_accounts已返回且核实的账户ID。' },
        categoryId: { type: 'string', required: true, description: '方向匹配的cash-categories真实ID。' },
        auxiliaryCategoryCode: { type: 'string', required: true }, auxiliaryItemId: { type: 'string', required: true },
        date: { type: 'string', required: true, description: '用户指定或确认的YYYY-MM-DD。' },
        amount: { type: 'string', required: true, description: '正数，两位小数，例如100.00；不自行换算币种。' },
        summary: { type: 'string', required: true }, keeperName: { type: 'string', required: true },
        accountReferenceQuery: { type: 'object', required: true, additionalProperties: false, properties: queryProperties },
      } },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的Finance会话中准备往来。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain.prepareOpenItem(agent,
        openItemPreparationRequestSchema.parse(args), exec.signal, config.maxBytes)))
    },
    presentCall: args => ({ card: 'generic', title: args.action === 'inspect' ? '查看原往来记录' : '准备应收应付预览', kind: 'other' }),
    presentResult: (args, result) => ({ card: 'generic', title: result.isError ? '往来记录操作失败'
      : args.action === 'inspect' ? '应收应付记录' : '应收应付预览（未创建）',
    content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_create_open_item',
    description: '仅在用户要求新增应收或应付时，提交finance_prepare_open_item展示的准确id/version。系统必须请求本次强制确认，聊天口头确认不能绕过。接口返回记录标识后，仍须以独立回查判断记录内容、关联与初始余额是否核验，不代表已收付款或核销。超时或结果未知只inspect原记录，不重发，不另建相同内容规避防重复。',
    parameters: { id: { type: 'string', required: true }, version: { type: 'integer', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的Finance会话中创建往来。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain.createOpenItem(agent,
        openItemCreateRequestSchema.parse(args), exec.signal, config.maxBytes)))
    },
    presentCall: () => ({ card: 'generic', title: '确认并创建应收应付', kind: 'other' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '往来创建未完成' : '应收应付创建结果',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
}
