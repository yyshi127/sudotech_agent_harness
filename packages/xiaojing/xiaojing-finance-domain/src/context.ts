/** Finance-preset consumer for logged client context and current reimbursement capabilities. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Required Host service for Finance prompt context. */
export const inject = ['xiaojingFinanceDomain']

const FINANCE_READ_RULES = [
  '财务查询证据规则：',
  '- 凭证、科目余额、账户日记账和应收应付是不同来源，分别说明查询范围和金额；名称相同不证明账户与科目对应。',
  '- 跨来源比较前，必须确认账户映射、币种、期间口径、记录范围及记账状态可比。未确认时只写“尚未核对”，不能判为异常，也不能判为正常；测试账套或来源不同都不能证明“金额不同属正常”。开头、过程说明及结论必须一致，不能先定性再用免责声明否定。',
  '- “未提供”只适用于对应来源、科目和字段。某个余额字段或汇总为空，不代表所有期初余额缺失；保留已返回的借方、贷方金额及其方向，不用空值覆盖它们，也不补零。借方列负数仍按“借方列负数”展示，不能解释成“即贷方余额”；贷方列同理。完整性也逐来源引用，不能把一个来源的限制泛化为所有查询都未提供总数或都未核验。',
  '- 直接引用工具返回的金额；比较和汇总使用已核验口径的分析工具结果，不把不同来源的合计混算，不自行重建余额。',
  '- 财务制单人／提交人使用用户提供并确认的有成财务成员姓名；缺失时询问，不猜姓名。不能调用报销模块的users/staff接口来核实财务成员，两个模块的人员结果不互相证明。用户已经确认姓名时，不额外要求报销连接或密钥。',
].join('\n')

const REIMBURSEMENT_CONTEXT = [
  '当前报销附件能力（适用于继续的旧会话）：',
  '- finance_reimbursement 的 create 会在逐单确认后，将本会话导入的 PDF、PNG、JPEG 原件上传私有 OSS，再把签名链接数组写入有成报销单的固定 attachment 字段并保存草稿。无需另行上传或转换文件格式。',
  '- 模板查询未列出 attachment 不代表不能带附件。历史消息中“所选报销单模板没有附件组件，无法随单据传入发票原件”的错误已不适用；不得因此要求换模板、去掉原件或重复询问已确认的模板。',
  '- 费用模板有 attachment 时，create 还会把每行所选原件的链接写入该行 feeComponentList，不会把所有发票混放到每一行。普通附件不是 invoice 发票台账关联；若必填 invoice 关联无法满足，必须说明具体限制，不能绕过或擅自换模板。',
  '- 成功草稿回执中的 attachmentNames 表示后台已上传并传参的原件名称。签名链接只在后台处理，不返回给模型；看不到链接不代表没有上传。若有成界面未显示附件，应核查单据和对应费用行，不能建议重复上传 OSS 或把文件名当成附件链接。',
  '- 沿用用户已确认的模板和发票范围，仅补问当前确实缺少的必填信息。员工 staff 与申请人是独立字段，不得自动视为同一人。取消确认后暂停写入；新指令也不能替代逐单确认。',
  '- 历史写入结果不确定时先用 status 回查，不能直接重复创建。成功以草稿状态回读为准；附件已传入不等于已验证有成长久保存了原件。',
].join('\n')

/** Register the Finance-only prompt context listener. @param ctx - Finance agent scope. */
export function apply(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const agent = context.agent
    if (agent !== undefined && ctx.xiaojingFinanceDomain.isFinanceAgent(agent)) {
      assembly.contexts.push({
        name: 'xiaojing:finance-client',
        text: await ctx.xiaojingFinanceDomain.promptContext(agent),
      })
      if (ctx.xiaojingFinanceDomain.currentClientBinding(agent) !== undefined) {
        assembly.sections.push({ name: 'xiaojing:finance-read-evidence', text: FINANCE_READ_RULES })
        assembly.contexts.push({ name: 'xiaojing:reimbursement', text: REIMBURSEMENT_CONTEXT })
      }
    }
    return next()
  })
}
