/** Finance-only reference lookup; Host owns ledger identity, credentials, and bounded results. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { referenceQuerySchema } from './references.ts'
import type {} from './index.ts'
import { financeModelCall, financeModelJson } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader-visible plugin identity. */
export const name = 'xiaojing-finance-references-tool'
/** Required Finance service and tool registry. */
export const inject = ['tools', 'xiaojingFinanceDomain']

/** Register a reversible read-only tool in the Finance preset. @param ctx - Preset scope. */
export function apply(ctx: Context): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_references',
    description: '只读查询当前客户有成财务基础资料：subjects 科目、auxiliary-categories 辅助类别、auxiliary-items 辅助项目、cash-accounts 出纳账户、cash-categories 收支类别。辅助项目先查类别取得 categoryCode。name/code 是对本次返回的精确匹配，不是模糊搜索。用户要求某科目及全部下级时，必须用 subjects + subjectTreeRootCode 一次读取本次返回的树根和全部后代，不能按记忆中的名称逐个抽样。同名或多结果必须让用户明确，不取第一项；未找到不代表全库不存在，绝不自动新增。接口没有已验证的翻页机制或总数，不把结果称为全账套完整清单。保留层级和停用状态，unknown 不当启用。科目与出纳账户 directionRaw：0借1贷；收支类别：0收1支，不能跨类型套用或推断缺失方向。科目 subjectType 保留实际类型名称，不等于编码首位的总分类；未返回或空白时不能推断。直接使用本工具，不搜索配置文件、不索取密钥或账套ID，不改用报销接口。',
    parameters: {
      kind: { type: 'string', enum: ['subjects', 'auxiliary-categories', 'auxiliary-items', 'cash-accounts', 'cash-categories'], required: true },
      categoryCode: { type: 'string', description: '仅辅助项目必填：当前账套中已查询到的类别编码。' },
      code: { type: 'string', description: '可选，精确匹配本次返回资料的编码。' },
      name: { type: 'string', description: '可选，精确匹配名称，保留全部同名候选。' },
      subjectTreeRootCode: { type: 'string', description: '仅科目查询可用：返回本次接口结果中的树根科目及其全部后代；不能与 name/code 同时使用。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('请在客户帐套的 Finance 会话中查询基础资料。')
      const agent = exec.agent
      const parsed = referenceQuerySchema.safeParse(args)
      if (!parsed.success) throw new Error('请指定有效资料类型；只有辅助项目必须填写 categoryCode。')
      return financeModelJson(await financeModelCall(() =>
        ctx.xiaojingFinanceDomain.queryReferences(agent, parsed.data, exec.signal)))
    },
    presentCall: () => ({ card: 'generic', title: '查询有成财务基础资料', kind: 'read' }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '基础资料查询失败' : '基础资料查询结果',
      content: financeResultContent(result.content, result.isError, 'references') }),
  })))
}
