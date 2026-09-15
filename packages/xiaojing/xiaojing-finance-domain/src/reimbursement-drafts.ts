/** Bounded reimbursement discovery and draft-only invoice workflow with durable retry receipts. */
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import type { ReimbursementApi } from './reimbursement.ts'
import type { FinanceAttachmentUpload } from './types.ts'

const id = z.union([z.string().min(1).max(200), z.number().int()]).transform(String)
const component = z.object({ code: z.string(), type: z.string(), name: z.string().optional(), label: z.string().optional(),
  require: z.boolean(), configureObject: z.record(z.string(), z.unknown()).optional() })
const template = z.object({ templateCode: z.string(), templateName: z.string(), templateType: z.number(),
  orderTemplateType: z.number().optional(), parentTemplateCode: z.string(), status: z.number(), components: z.array(component) })
type Template = z.infer<typeof template>
const user = z.object({ userId: id, userName: z.string(), corpId: id, defaultDepartment: z.unknown().optional() })
const department = z.object({ deptId: id, deptName: z.string(), parentId: id, status: z.number() })
const payee = z.object({ cardId: z.number().int(), bankCardNum: z.string(), holdName: z.string(), bankName: z.string() })
const value = z.object({ code: z.string().min(1).max(200), bindingVal: z.string().min(1).max(4000) }).strict()
const money = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/u)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
})
const draft = z.object({
  templateCode: z.string().min(1).max(200), submitterId: z.string().min(1).max(200),
  departmentId: z.string().min(1).max(200), title: z.string().trim().min(1).max(60), date,
  employeeId: z.string().min(1).max(200).optional(),
  approvalUserId: z.string().min(1).max(200).optional(), payeeCardId: z.number().int().optional(),
  fields: z.array(value).max(80),
  fees: z.array(z.object({ templateCode: z.string().min(1).max(200), amount: money, fields: z.array(value).max(80),
    invoices: z.array(z.string().min(1).max(32768)).min(1).max(10) }).strict()).min(1).max(20),
}).strict()

/** Only discovery, explicit draft creation, and receipt lookup are admitted. */
export const reimbursementRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('templates'), kind: z.enum(['order', 'fee']), search: z.string().max(200).default(''), page: z.number().int().positive().default(1) }).strict(),
  z.object({ action: z.literal('template'), code: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.enum(['users', 'departments', 'payees']), search: z.string().min(1).max(200), page: z.number().int().positive().default(1) }).strict(),
  z.object({ action: z.literal('create'), draft }).strict(),
  z.object({ action: z.literal('status'), operationId: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
])
/** Parsed tool request with all defaults resolved at the JSON boundary. */
export type ReimbursementRequest = z.infer<typeof reimbursementRequestSchema>

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error('有成报销数据字段异常，未继续写入。')
  return result.data
}
async function templates(api: ReimbursementApi, templateCode?: string): Promise<Template[]> {
  return parse(z.array(template), await api.call('templates', { needParentTemplate: true, ...templateCode === undefined ? {} : { templateCode } }))
}
const pageOf = <T>(rows: T[], page: number) => ({
  total: rows.length, page, hasMore: page * 20 < rows.length, items: rows.slice((page - 1) * 20, page * 20),
})
function property(config: Record<string, unknown> | undefined, key: string): unknown {
  const setting = config?.[key]
  return setting !== null && typeof setting === 'object' && 'value' in setting ? setting.value : undefined
}

/**
 * Project only the metadata needed to select a reimbursement template and its identities.
 * @param api - Authorized read-only transport.
 * @param request - Discovery action.
 * @returns Paginated, credential-free metadata.
 */
export async function discoverReimbursement(api: ReimbursementApi, request: Exclude<ReimbursementRequest, { action: 'create' | 'status' }>): Promise<object> {
  if (request.action === 'templates') {
    const rows = (await templates(api)).filter(t => (request.kind === 'fee'
      ? t.templateType === 2 : t.templateType === 1 && t.orderTemplateType === 1)
      && t.templateName.includes(request.search))
    return pageOf(rows.map(t => ({
      code: t.templateCode, name: t.templateName, parent: t.parentTemplateCode, status: t.status,
    })), request.page)
  }
  if (request.action === 'template') {
    const match = (await templates(api, request.code)).find(t => t.templateCode === request.code)
    if (!match) throw new Error('未找到指定报销/费用模板。')
    return { code: match.templateCode, name: match.templateName, type: match.templateType, orderType: match.orderTemplateType,
      attachmentTransfer: '原件通过固定 attachment 字段传入；模板列表未列出该字段不代表不支持附件，无需因此更换模板。',
      components: match.components.map(c => ({ code: c.code, name: c.label ?? c.name ?? c.code, type: c.type, required: c.require,
        multiple: property(c.configureObject, 'multiple'), maxLength: property(c.configureObject, 'maxLength'),
        note: c.code === 'staff' && c.type === 'staff' ? '独立员工字段：以 employeeId 提供 users 中用户明确选择的员工；不能默认等同于申请人。'
          : c.type === 'invoice' ? '当前不创建发票台账或关联发票组件；此项必填时不能自动创建。'
            : ['text', 'number', 'date', 'dateMerge', 'amount', 'attachment', 'staff', 'department', 'payeeInfo', 'importDetails'].includes(c.type)
              ? '标准字段；金额、附件、发票张数、申请人、部门及收款信息由后端填充，其余提供 fields。' : '此类型暂未支持自动填写；必填时停止并提示，不能猜测 ID。' })) }
  }
  if (request.action === 'users') {
    const rows = parse(z.array(user), await api.call('users', { userName: request.search, ifAppAuth: 'true' }))
      .filter(u => u.userName.includes(request.search))
    return pageOf(rows.map(u => ({ id: u.userId, name: u.userName, corpId: u.corpId })), request.page)
  }
  if (request.action === 'departments') {
    const rows = parse(z.array(department), await api.call('departments', { showDisabled: false }))
      .filter(d => d.status === 1 && d.deptName.includes(request.search))
    return pageOf(rows.map(d => ({ id: d.deptId, name: d.deptName, parentId: d.parentId })), request.page)
  }
  const rows = parse(z.array(payee), await api.call('payees', {})).filter(p => p.holdName.includes(request.search))
  return pageOf(rows.map(p => ({ id: p.cardId, name: p.holdName, bank: p.bankName, lastFour: p.bankCardNum.slice(-4) })), request.page)
}

function cents(text: string): number {
  const [whole = '', fraction = ''] = text.split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('报销金额必须为正数，最多两位小数。')
  return result
}

function components(
  t: Template, fields: z.infer<typeof value>[], supplied: Record<string, string>, fees: boolean,
): z.infer<typeof value>[] {
  const result = new Map<string, string>()
  for (const field of fields) {
    const c = t.components.find(c => c.code === field.code)
    if (!c || result.has(field.code) || field.code in supplied || ['invoice', 'attachment', 'payeeInfo', 'staff', 'department', 'importDetails', 'amount'].includes(c.type)) {
      throw new Error(`${t.templateName}：字段 ${field.code} 未知、重复或由后端管理。`)
    }
    if (!['text', 'number', 'date', 'dateMerge'].includes(c.type)) throw new Error(`${t.templateName}：暂不支持自动填写 ${c.label ?? c.name ?? c.code}（${c.type}）。`)
    if ((c.type === 'date' || c.type === 'dateMerge') && !date.safeParse(field.bindingVal).success) throw new Error('当前仅支持单日 YYYY-MM-DD 日期。')
    if (c.type === 'number' && !/^-?\d+(?:\.\d+)?$/u.test(field.bindingVal)) throw new Error('数字字段格式不正确。')
    const max = property(c.configureObject, 'maxLength')
    if (typeof max === 'number' && field.bindingVal.length > max) throw new Error(`${c.label ?? c.code} 超出长度限制。`)
    result.set(field.code, field.bindingVal)
  }
  for (const c of t.components) {
    const generated = supplied[c.code]
    if (generated !== undefined) result.set(c.code, generated)
    if (c.require && !result.has(c.code) && !(c.type === 'importDetails' && fees)) {
      throw new Error(`${t.templateName} 缺少必填项：${c.label ?? c.name ?? c.code}（${c.code}，${c.type}）。请补齐，不能虚构。`)
    }
  }
  return [...result].map(([code, bindingVal]) => ({ code, bindingVal }))
}

const receiptSchema = z.object({
  schemaVersion: z.literal(1), operationId: z.string(), owner: z.string(), revision: z.number(),
  phase: z.enum(['uploading', 'pushing', 'draft', 'failed', 'unexpected-status']),
  attachmentNames: z.array(z.string()), orderCode: z.string().optional(), message: z.string(),
}).strict()
type Receipt = z.infer<typeof receiptSchema>

/** Host-only callbacks; the caller resolves identity and owns the mandatory confirmation. */
export interface ReimbursementDraftOwner {
  /** Opaque account-book/session identity, not supplied by the model. */
  id: string
  label: string
  /** @param reason - Validated bill summary. @returns After affirmative one-time user confirmation. */
  approve(reason: string): Promise<void>
  /** @returns After verifying the saved account-book and credential have not changed. */
  checkCurrent(): Promise<void>
  /** @param path - Imported invoice selected by the user. @returns Host-only private transfer receipt. */
  upload(path: string): Promise<FinanceAttachmentUpload>
}

/** Durable draft executor. Unknown writes remain blocked until readback or manual reconciliation. */
export class ReimbursementDrafts {
  /** @param directory - Private Host receipt directory, outside model workspaces. */
  constructor(private readonly directory: string) {}

  private async read(path: string): Promise<Receipt | undefined> {
    let text: string
    try { text = await readFile(path, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
    return parse(receiptSchema, JSON.parse(text))
  }
  private write(path: string, receipt: Receipt): Promise<void> {
    return writeFileAtomic(path, `${JSON.stringify(receipt)}\n`, { mode: 0o600, dirMode: 0o700 })
  }
  private async reconcile(api: ReimbursementApi, receipt: Receipt, path: string): Promise<Receipt> {
    if (receipt.phase === 'uploading') return { ...receipt, message: '附件阶段未完成；使用完全相同的请求可继续。' }
    const results = parse(z.array(z.object({ orderId: z.string(), orderCode: z.string().nullish(), failReason: z.string().nullish() })),
      await api.call('result', { orderIdList: [receipt.operationId] }))
    const match = results.find(r => r.orderId === receipt.operationId)
    if (!match) return { ...receipt, message: '推送结果尚不可见；仅继续回查，不能重复创建。' }
    if (!match.orderCode) {
      if (!match.failReason) return { ...receipt, message: '有成仍在处理；仅回查，不重复创建。' }
      receipt.phase = 'failed'; receipt.message = '有成未生成单据，请在有成推送记录中查看失败原因；不自动重新创建。'
    } else {
      receipt.orderCode = match.orderCode
      const statuses = parse(z.array(z.object({ orderCode: z.string(), status: z.number() })), await api.call('status', { type: 1, list: [match.orderCode] }))
      const status = statuses.find(s => s.orderCode === match.orderCode)?.status
      receipt.phase = status === 1 ? 'draft' : 'unexpected-status'
      receipt.message = status === 1 ? '已回查：报销单处于待提交草稿状态，未提交审批、未支付。附件链接已随单据传入；有成是否转存原件尚未核验。' : `单据已生成，但未核实为草稿（状态 ${String(status)}）；请人工检查，不再写入。`
    }
    await this.write(path, receipt)
    return receipt
  }

  /**
   * Create a confirmed draft or reconcile an existing operation without blind retries.
   * @param api - Snapshot-scoped authorization.
   * @param owner - Verified caller and confirmation owner.
   * @param request - Validated action.
   * @returns Receipt without signed links or secrets.
   */
  async run(api: ReimbursementApi, owner: ReimbursementDraftOwner, request: Extract<ReimbursementRequest, { action: 'create' | 'status' }>): Promise<object> {
    const operationId = request.action === 'status' ? request.operationId
      : createHash('sha256').update(`${owner.id}/${JSON.stringify(request.draft)}`).digest('hex')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const path = join(this.directory, `${operationId}.json`)
    const ownerLock = join(this.directory, `owner-${createHash('sha256').update(owner.id).digest('hex')}`)
    return withFileLock(ownerLock, async () => {
      let receipt = await this.read(path)
      if (receipt && (receipt.owner !== owner.id || receipt.revision !== api.revision)) throw new Error('该任务不属于当前会话，或报销配置已变更；请人工核对原任务。')
      if (request.action === 'status') {
        if (!receipt) throw new Error('当前会话没有此报销任务。')
        return this.reconcile(api, receipt, path)
      }
      if (receipt && receipt.phase !== 'uploading') return this.reconcile(api, receipt, path)
      for (const name of await readdir(this.directory)) {
        if (!/^[a-f0-9]{64}\.json$/u.test(name) || name === `${operationId}.json`) continue
        const pending = await this.read(join(this.directory, name))
        if (pending?.owner === owner.id && (pending.phase === 'pushing' || pending.phase === 'unexpected-status')) {
          return { ...pending, message: '本会话已有写入结果尚未确认的报销任务；请使用此 operationId 回查，不要改标题、模板或发票重复创建。' }
        }
      }
      const input = request.draft
      const [tree, people, departments, cards] = await Promise.all([
        templates(api), api.call('users', { ifAppAuth: 'true' }), api.call('departments', { showDisabled: false }),
        input.payeeCardId === undefined ? Promise.resolve([]) : api.call('payees', {}),
      ])
      const applicant = parse(z.array(user), people).find(u => u.userId === input.submitterId)
      const dept = parse(z.array(department), departments).find(d => d.deptId === input.departmentId && d.status === 1)
      if (!applicant || !dept) throw new Error('申请人或部门不在当前报销凭据可访问的名单中。')
      if (input.approvalUserId !== undefined && !parse(z.array(user), people).some(u => u.userId === input.approvalUserId && u.corpId === applicant.corpId)) throw new Error('审批人不属于当前报销企业。')
      const order = tree.find(t => t.templateCode === input.templateCode && t.templateType === 1 && t.orderTemplateType === 1)
      if (!order) throw new Error('请选择实际可访问的报销单模板，不能创建借款、付款或其他单据。')
      const employee = input.employeeId === undefined ? undefined
        : parse(z.array(user), people).find(u => u.userId === input.employeeId && u.corpId === applicant.corpId)
      const staff = order.components.find(c => c.code === 'staff' && c.type === 'staff')
      if (input.employeeId !== undefined && (!employee || !staff || property(staff.configureObject, 'multiple') === true)) {
        throw new Error('员工必须是当前企业可访问的人员，且所选表单需有单选员工字段；不能默认使用申请人。')
      }
      const selectedCard = parse(z.array(payee), cards).find(p => p.cardId === input.payeeCardId)
      if (input.payeeCardId !== undefined && !selectedCard) throw new Error('收款账户不在实际可访问列表中。')
      const total = input.fees.reduce((sum, fee) => sum + cents(fee.amount), 0)
      const paths = input.fees.flatMap(f => f.invoices)
      if (new Set(paths).size !== paths.length) throw new Error('同一张发票不能在本次请求中重复报销。')
      const collection = order.components.find(c => c.code === 'collectionInfo')
      const orderFields = components(order, input.fields, {
        title: input.title, proposer: applicant.userId, department: dept.deptId, reimbursementDate: input.date, amount: String(total / 100), attachment: '[]',
        ...employee === undefined ? {} : { staff: employee.userId },
        ...(selectedCard === undefined ? {} : { collectionInfo: property(collection?.configureObject, 'multiple') === true
          ? JSON.stringify([{ id: selectedCard.cardId, amount: total / 100 }]) : String(selectedCard.cardId) }),
      }, true)
      const fees = input.fees.map((fee) => {
        const t = tree.find(t => t.templateCode === fee.templateCode && t.templateType === 2)
        if (!t) throw new Error('所选费用模板不可访问。')
        if (t.components.some(c => c.type === 'invoice' && c.require)) throw new Error('此费用类型强制关联发票台账；当前仅支持普通附件，请告知用户缺少台账关联能力，不得擅自换模板或省略要求。')
        return { templateCode: t.templateCode, amount: cents(fee.amount) / 100,
          feeComponentList: components(t, fee.fields, { consumptionMoney: fee.amount, invoiceNumber: String(fee.invoices.length), attachment: '[]' }, false) }
      })
      await owner.approve(`仅保存有成报销草稿，不提交审批、不支付。\n帐套上下文：${owner.label}\n报销企业 ID：${applicant.corpId}\n申请人：${applicant.userName}\n员工：${employee?.userName ?? '未指定'}\n部门：${dept.deptName}\n模板：${order.templateName}\n标题：${input.title}\n日期：${input.date}\n金额：CNY ${(total / 100).toFixed(2)}\n收款：${selectedCard ? `${selectedCard.holdName} / ${selectedCard.bankName} / 尾号${selectedCard.bankCardNum.slice(-4)}` : '无'}\n附件：${paths.join('、')}\n费用：${JSON.stringify(fees)}\n其他字段：${JSON.stringify(orderFields)}\n将把这些附件上传到已配置的私有 OSS 并传入有成。`)
      await owner.checkCurrent()
      receipt ??= { schemaVersion: 1, operationId, owner: owner.id, revision: api.revision, phase: 'uploading', attachmentNames: [], message: '' }
      await this.write(path, receipt)
      try {
        const attachments: FinanceAttachmentUpload[] = []
        const uploadedByPath = new Map<string, FinanceAttachmentUpload>()
        for (const invoicePath of paths) {
          await owner.checkCurrent()
          const uploaded = await owner.upload(invoicePath)
          attachments.push(uploaded)
          uploadedByPath.set(invoicePath, uploaded)
        }
        receipt.attachmentNames = attachments.map(file => file.name)
        const attachmentField = { code: 'attachment', bindingVal: JSON.stringify(attachments.map(file => file.downloadUrl)) }
        const submittedFields = [...orderFields.filter(field => field.code !== 'attachment'), attachmentField]
        const submittedFees = fees.map((fee, index) => {
          const selected = input.fees[index]
          assert(selected, 'Every prepared fee must retain its selected originals')
          const urls = selected.invoices.map((path) => {
            const uploaded = uploadedByPath.get(path)
            assert(uploaded, 'Every selected original must finish uploading before bill submission')
            return uploaded.downloadUrl
          })
          return { ...fee, feeComponentList: fee.feeComponentList.map(field => field.code === 'attachment'
            ? { ...field, bindingVal: JSON.stringify(urls) } : field) }
        })
        await owner.checkCurrent()
        receipt.phase = 'pushing'
        await this.write(path, receipt)
        await api.call('create', { submitterId: applicant.userId, orderList: [{ id: operationId, templateCode: input.templateCode,
          pushOrderStatus: '1', submitAmount: total / 100, orderComponentList: submittedFields, feeList: submittedFees,
          ...(input.approvalUserId === undefined ? {} : { approvalUser: input.approvalUserId }),
        }] })
        return await this.reconcile(api, receipt, path)
      } catch (error) {
        return { ...receipt, message: error instanceof Error ? error.message : '任务未完成。请使用任务编号回查，不要创建新任务。' }
      }
    })
  }
}
