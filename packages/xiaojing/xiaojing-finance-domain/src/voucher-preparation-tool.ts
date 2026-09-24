/** Finance voucher preparation and confirmed creation; the Host owns validation and durable sending records. */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import { voucherCreateRequestSchema } from './voucher-preparation.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader-visible plugin identity. */
export const name = 'xiaojing-finance-voucher-preparation-tool'
/** Required tool registry and Finance Host. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Deployment bounds for prepared entries and complete records/results. */
export interface Config { maxEntries: number; maxBytes: number }
/** Explicit preview resource limits, independent of vendor write limits. */
export const Config: s<Config> = s.object({
  maxEntries: s.number().min(2).step(1).default(100),
  maxBytes: s.number().min(1).step(1).default(131072),
})

/**
 * Register preparation and separately confirmed creation.
 * @param ctx - Preset scope.
 * @param config - Preview bounds.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_prepare_voucher',
    description: '准备、修改或查看当前客户账套的财务凭证预览，不创建有成凭证，也不代表用户已确认。根据日常语言和已读取材料理解业务，使用 finance_references 查询真实科目及辅助编码；不把用户原话当精确关键词，不猜编码、制单人、日期或缺失事实。prepare 新建本地预览；revise 必须使用最新 id/version 并传完整新内容；inspect 查看 id。来源路径只能引用本会话已导入文件，没有原件用空数组并如实说明。展示账套、全部分录、借贷合计、来源及待核验项，区分用户事实和你的会计建议，不宣称已上传原件或写入成功。',
    parameters: {
      action: { type: 'string', enum: ['prepare', 'revise', 'inspect'], required: true,
        description: 'inspect 可查看已有提交记录：有凭证ID时只读回查；结果未知时不重发，不推定未创建。回查相符不代表附件等完整核验通过。' },
      id: { type: 'string', description: '修改或查看时使用此前返回的本地准备记录 ID。' },
      version: { type: 'integer', description: '仅修改时必填：最近预览返回的版本。' },
      input: { type: 'object', additionalProperties: false, description: '准备和修改时必填；查看时省略。', properties: {
        date: { type: 'string', required: true, description: '凭证日期 YYYY-MM-DD。' },
        documentMaker: { type: 'string', required: true, description: '用户指定或已确认的制单人。' },
        certificateCode: { type: 'integer', description: '凭证号，1至2147483647。尚未确定可先省略，提交前必须进入预览确认；不猜号。' },
        entries: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          summary: { type: 'string', required: true }, subjectCode: { type: 'string', required: true },
          side: { type: 'string', enum: ['debit', 'credit'], required: true },
          amount: { type: 'string', required: true, description: '本位币正金额，两位小数，如 100.00。' },
          auxiliary: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            categoryCode: { type: 'string', required: true }, itemCode: { type: 'string', required: true },
          } } },
          foreignCurrency: { type: 'object', additionalProperties: false, properties: {
            code: { type: 'string', required: true }, amount: { type: 'string', required: true },
            exchangeRate: { type: 'string', required: true, description: '用户指定或已确认的正汇率。原币乘汇率逐条按十进制四舍五入到分，必须与本位币amount一致；不自动选择汇率或改金额。' },
          } },
        } } },
        sourcePaths: { type: 'array', required: true, items: { type: 'string' } },
      } },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户帐套的 Finance 会话中准备凭证。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain
        .prepareVoucher(agent, args, exec.signal, config)))
    },
    presentCall: args => ({ card: 'generic', title: args.action === 'inspect' ? '查看财务凭证记录' : '准备财务凭证预览', kind: 'other' }),
    presentResult: (args, result) => ({ card: 'generic',
      title: result.isError ? '凭证记录操作失败' : args.action === 'inspect' ? '财务凭证记录与回查' : '本地凭证预览（未创建）',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_create_voucher',
    description: '将 finance_prepare_voucher 已展示的准确 id/version 提交创建。仅在用户要求创建时调用；系统会展示完整内容请求本次强制确认，聊天中的“已确认”不能绕过确认。不得重新生成分录或猜凭证号。已选择的PDF/PNG/JPG原件确认后先上传OSS、保存回执，再将全部临时链接交给有成；任一上传失败就不创建，不能省略。上传回执不等于有成转存证明，签名链接不返回模型。外币保留原币金额和已确认汇率，按预览中的逐条十进制舍入校验，不得删除外币信息绕过检查。仅创建，不审核、过账、结账、付款。结果未知或回查失败时用 finance_prepare_voucher inspect 查看原记录，不重发、不新建同内容记录。接口返回凭证标识不等于完整核验通过。',
    parameters: {
      id: { type: 'string', required: true, description: '此前本会话预览返回的本地记录ID。' },
      version: { type: 'integer', required: true, description: '用户看到的最新预览版本。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户帐套的 Finance 会话中创建凭证。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain.createVoucher(
        agent, voucherCreateRequestSchema.parse(args), exec.signal, config)))
    },
    presentCall: () => ({ card: 'generic', title: '确认并创建财务凭证', kind: 'other' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '凭证创建未完成' : '凭证创建结果',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
}
