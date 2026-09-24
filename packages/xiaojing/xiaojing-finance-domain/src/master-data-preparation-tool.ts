/** Finance-only subject/auxiliary previews and exact-version creation through the credential-owning Host. */
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import { masterDataPreparationRequestSchema, masterDataCreateRequestSchema, validateMasterDataProposal } from './master-data-preparation.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader-visible plugin identity. */
export const name = 'xiaojing-finance-master-data-preparation-tool'
/** Required registry and client-bound Finance Host. */
export const inject = ['tools', 'xiaojingFinanceDomain']
/** Deployment limit for complete previews, records and sender responses. */
export interface Config { maxBytes: number }
/** Explicit operation-size policy. */
export const Config: s<Config> = s.object({ maxBytes: s.number().min(1).step(1).default(131072) })

const preparationCommand = z.strictObject({ action: z.enum(['prepare', 'revise', 'inspect']),
  id: z.uuid().optional(), version: z.number().int().positive().optional(),
  kind: z.enum(['subject', 'auxiliary-item']).optional(), input: z.unknown().optional() })

/**
 * Register local preparation and separately confirmed subject/auxiliary creation.
 * @param ctx - Finance preset scope.
 * @param config - Complete operation size limit.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_prepare_master_data',
    description: '准备、修改或查看当前客户的会计科目(subject)或辅助核算项目(auxiliary-item)。理解自然语言需求，先用finance_references查真实科目类型、父科目或辅助类别/项目，不猜编号、类别或提交人。新增资料必须是用户明确要求，不能因凭证缺资料就自动新增。prepare仅本地预览，传kind和input；revise使用最新id/version及完整kind/input；inspect只传action和id。科目支持一级科目（四位编码，parentCode为null）或普通已有分支下的下级，可用accounting明确选择辅助类别及已观察币种；不支持末级提升或数量核算，不修改已有资料、不注册币种或设置汇率。',
    parameters: {
      action: { type: 'string', enum: ['prepare', 'revise', 'inspect'], required: true },
      id: { type: 'string', description: '本会话此前返回的本地准备ID，修改或查看时必填。' },
      version: { type: 'integer', description: '修改时使用最近预览版本。' },
      kind: { type: 'string', enum: ['subject', 'auxiliary-item'], description: '准备、修改时必填；查看时省略。' },
      input: { type: 'object', additionalProperties: false,
        description: '准备、修改时的完整内容，查看时省略。科目必填subjectCode/subjectName/parentCode/subjectCategory/subjectType/direction/status/documentMaker/numberUnit(null)。辅助项目只填categoryCode/itemCode/itemName/status/documentMaker。', properties: {
          subjectCode: { type: 'string' }, subjectName: { type: 'string' }, parentCode: { oneOf: [{ type: 'string' }, { type: 'null' }], description: '一级科目填null；下级填写真实父科目编码。' },
          subjectCategory: { type: 'string', enum: ['1', '2', '3', '4', '5'], description: '科目总分类，必须与编码首位一致，不是subjectType。' },
          subjectType: { type: 'string', description: '有成科目类型名称，例如“流动资产”；保留用户确认的中文名称，不转换成general等自造枚举。一级科目核对当前账套同总分类下已返回的类型，下级核对父科目实际类型；不匹配时不会自动改写。' },
          direction: { type: 'string', enum: ['debit', 'credit'] }, numberUnit: { type: 'null' },
          accounting: { type: 'object', additionalProperties: false, description: '仅科目可选；省略表示普通科目。填写时两个数组都必填，不配置的一项填空数组。辅助类别必须来自当前账套，币种必须已在当前账套科目中出现；不传类别ID、币种ID或汇率。', properties: {
            auxiliaryCategoryCodes: { type: 'array', items: { type: 'string' }, required: true },
            currencyCodes: { type: 'array', items: { type: 'string' }, required: true },
          } },
          categoryCode: { type: 'string' }, itemCode: { type: 'string' }, itemName: { type: 'string' },
          status: { type: 'string', enum: ['enabled', 'disabled'], required: true },
          documentMaker: { type: 'string', required: true, description: '用户提供并确认的有成财务成员姓名；缺失则询问用户，不调用报销users/staff接口替代核实，不是随意填写的系统来源名称。' },
        } },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的Finance会话中准备基础资料。')
      const agent = exec.agent
      const { kind, input, ...command } = preparationCommand.parse(args)
      const request = masterDataPreparationRequestSchema.parse(args.action === 'inspect' ? args
        : { ...command, proposal: { kind, input } })
      if (request.action !== 'inspect') validateMasterDataProposal(request.proposal, config.maxBytes)
      return financeModelJson(await financeModelCall(() =>
        ctx.xiaojingFinanceDomain.prepareMasterData(agent, request, exec.signal, config.maxBytes)))
    },
    presentCall: args => ({ card: 'generic', title: args.action === 'inspect' ? '查看基础资料记录' : '准备基础资料预览', kind: 'other' }),
    presentResult: (args, result) => ({ card: 'generic', title: result.isError ? '基础资料操作未完成'
      : args.action === 'inspect' ? '基础资料记录与回查' : '基础资料预览（未创建）',
    content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_create_master_data',
    description: '仅在用户要求新增科目或辅助项目时提交finance_prepare_master_data返回的准确id/version。系统强制确认完整版本，聊天中的同意不能绕过。接口接收不等于新增内容已完成核验，须依据独立回查给出业务结论；辅助启用状态未提供，不能宣称全面核验。未知结果只inspect原记录，不重发，不换编码或会话规避防重复；不修改历史资料或凭证。',
    parameters: { id: { type: 'string', required: true }, version: { type: 'integer', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户账套的Finance会话中创建基础资料。')
      const agent = exec.agent
      return financeModelJson(await financeModelCall(() => ctx.xiaojingFinanceDomain.createMasterData(agent,
        masterDataCreateRequestSchema.parse(args), exec.signal, config.maxBytes)))
    },
    presentCall: () => ({ card: 'generic', title: '确认并创建基础资料', kind: 'other' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '基础资料创建未完成' : '基础资料创建结果',
      content: financeResultContent(result.content, result.isError, 'operation') }),
  })))
}
