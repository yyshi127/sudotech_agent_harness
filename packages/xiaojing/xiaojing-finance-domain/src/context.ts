/** Finance-preset consumer for logged client context and the current capability inventory. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { renderFinanceCapabilityContext } from './capabilities.ts'

/** Required Host service for Finance prompt context. */
export const inject = ['xiaojingFinanceDomain']

const FINANCE_READ_RULES = [
  '财务查询证据规则：',
  '- 凭证、科目余额、账户日记账和应收应付是不同来源，分别说明查询范围和金额；名称相同不证明账户与科目对应。',
  '- 跨来源比较前，必须确认账户映射、币种、期间口径、记录范围及记账状态可比。未确认时只写“尚未核对”，不能判为异常，也不能判为正常；账套或来源不同都不能证明“金额不同属正常”。开头、过程说明及结论必须一致，不能先定性再用免责声明否定。',
  '- “未提供”只适用于对应来源、科目和字段。某个余额字段或汇总为空，不代表所有期初余额缺失；保留已返回的借方、贷方金额及其方向，不用空值覆盖它们，也不补零。借方列负数仍按“借方列负数”展示，不能解释成“即贷方余额”；贷方列同理。完整性也逐来源引用，不能把一个来源的限制泛化为所有查询都未提供总数或都未核验。',
  '- 直接引用工具返回的金额；比较和汇总使用已核验口径的分析工具结果，不把不同来源的合计混算，不自行重建余额。',
  '- 财务制单人／提交人使用用户提供并确认的有成财务成员姓名；缺失时询问，不猜姓名。不能调用报销模块的users/staff接口来核实财务成员，两个模块的人员结果不互相证明。用户已经确认姓名时，不额外要求报销连接或密钥。',
  '财务业务交付规则：',
  '- 面向用户的最终回答、表格和文件先给业务结果与实际数据，不把查询说明、接口调用过程、内部核验记录或测试口径当成交付结果。',
  '- 除非用户明确要求技术诊断，不展示工具名、接口路径、参数名、原始 JSON、内部记录 ID、版本号、哈希、指纹、分页字段或英文状态码。业务凭证号、科目编码等用户本来就要使用的编号不属于内部记录 ID。',
  '- 只有当限制会影响金额理解、数据范围、操作安全或下一步行动时才说明，并紧跟相关结论用日常语言简短表达；不要倾倒内部证据，也不要用大段免责声明掩盖结果。',
  '- 导出成功后只报告业务数量和生成文件，不复述哈希、字节数、分页过程、接口错误历史、内部完整性核对或测试数据判断。用户要求全部数据时，成功结果应是一个完整文件；不得自行拆成多个期间文件后要求用户再合并。',
  '- 内部查询、校验和持久记录仍保持完整准确；展示层精简不得改变金额、范围、执行状态或风险判断。',
].join('\n')

/** Register the Finance-only prompt context listener. @param ctx - Finance agent scope. */
export function apply(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const agent = context.agent
    if (agent !== undefined && ctx.xiaojingFinanceDomain.isFinanceAgent(agent)) {
      const clientContext = await ctx.xiaojingFinanceDomain.promptContext(agent)
      const clientBound = ctx.xiaojingFinanceDomain.currentClientBinding(agent) !== undefined
      assembly.contexts.push({
        name: 'xiaojing:finance-client',
        text: clientContext,
      })
      assembly.sections.push({
        name: 'xiaojing:finance-capabilities',
        text: renderFinanceCapabilityContext({ clientBound }),
      })
      if (clientBound) {
        assembly.sections.push({ name: 'xiaojing:finance-read-evidence', text: FINANCE_READ_RULES })
      }
    }
    return next()
  })
}
