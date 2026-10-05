/** Business-readable mandatory approval text for finance writes. */

import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { FinanceClientId } from './types.ts'

type FinanceCreationAction = Extract<FinanceApprovalAction, `create-${string}`>

const CREATION_LABELS: Record<FinanceCreationAction, { en: string; zh: string }> = {
  'create-master-data': { en: 'Create master data', zh: '新增基础资料' },
  'create-open-item': { en: 'Create receivables or payables', zh: '新增应收或应付' },
  'create-journal': { en: 'Create journal entries', zh: '新增日记账' },
  'create-voucher': { en: 'Create vouchers', zh: '创建凭证' },
}

const VARIANT_LABELS: Record<string, { en: string; zh: string }> = {
  subject: { en: 'accounting subjects', zh: '会计科目' },
  'auxiliary-item': { en: 'auxiliary items', zh: '辅助核算项目' },
  income: { en: 'income', zh: '收入' },
  expense: { en: 'expense', zh: '支出' },
  receivable: { en: 'receivables', zh: '应收' },
  payable: { en: 'payables', zh: '应付' },
}

/**
 * Identify repeatable finance creation within one verified ledger configuration.
 * Each subsequent preparation still reserves and rechecks its exact version before dispatch.
 * @param action - Host-selected creation operation, excluding deletion and settlement.
 * @param clientId - Bound client identity.
 * @param configurationDigest - Verified ledger, credentials and client revision digest.
 * @param preview - Host-verified account presentation.
 * @param variant - Direction or master-data kind, or attachment storage configuration digest.
 * @returns The session authorization classification and localized scope label.
 */
export function financeCreationApprovalScope(action: FinanceCreationAction, clientId: FinanceClientId,
  configurationDigest: string, preview: unknown, variant: string): NonNullable<ApprovalRequest['reusable']> {
  const name = accountName(record(preview) ?? {})
  const labels = CREATION_LABELS[action]
  const variantLabel = action === 'create-voucher'
    ? variant === 'no-attachments' ? { en: 'without attachments', zh: '不上传附件' }
      : { en: 'attachments to the current storage', zh: '附件上传到当前存储' }
    : VARIANT_LABELS[variant]
  const en = `${labels.en} in ledger “${name}”${variantLabel === undefined ? '' : ` (${variantLabel.en})`}`
  const zh = `${labels.zh}：账套“${name}”${variantLabel === undefined ? '' : `（${variantLabel.zh}）`}`
  return {
    category: `xiaojing-finance:${action}`,
    scope: JSON.stringify([clientId, configurationDigest, variant]),
    label: en,
    displayLabel: { en, zh },
  }
}

/** Finance operations whose prepared versions require approval. */
export type FinanceApprovalAction =
  | 'create-master-data'
  | 'create-open-item'
  | 'create-journal'
  | 'create-voucher'
  | 'delete-voucher'
  | 'delete-journal'
  | 'delete-open-item'
  | 'write-off-open-item'

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue | undefined {
  if (typeof value === 'string') {
    try { return record(JSON.parse(value)) }
    catch { return undefined }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : typeof value === 'number' ? String(value) : undefined
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function accountName(value: RecordValue): string {
  return text(value.accountName) ?? text(record(value.account)?.name) ?? text(record(value.preview)?.accountName) ?? '当前账套'
}

function direction(value: unknown): string {
  return value === 'receivable' ? '应收' : value === 'payable' ? '应付' : value === 'income' ? '收入' : '支出'
}

function createVoucher(value: RecordValue, attachmentsWillUpload: boolean): string[] {
  const input = record(value.input) ?? {}
  const references = array(value.references).map(record)
  const entries = array(input.entries).map(record)
  const lines = [
    '将创建一张财务凭证，请核对：',
    `账套：${accountName(value)}`,
    `日期：${text(input.date) ?? '未提供'}`,
    `凭证号：${text(input.certificateCode) ?? '未提供'}`,
    `制单人：${text(input.documentMaker) ?? '未提供'}`,
    `借方合计：${text(value.totalDebit) ?? '未提供'}；贷方合计：${text(value.totalCredit) ?? '未提供'}`,
    '分录：',
  ]
  entries.forEach((entry, index) => {
    const subject = record(references[index]?.subject)
    const side = entry?.side === 'debit' ? '借' : '贷'
    const baseAmount = text(entry?.amount) ?? '未提供'
    const foreign = record(entry?.foreignCurrency)
    const currency = foreign === undefined ? ''
      : `；原币：${text(foreign.code) ?? '未提供'}；原币金额：${text(foreign.amount) ?? '未提供'}；汇率：${text(foreign.exchangeRate) ?? '未提供'}；本位币金额：${baseAmount}`
    lines.push(`${index + 1}. ${side} ${text(entry?.subjectCode) ?? ''} ${text(subject?.name) ?? ''} ${baseAmount}；摘要：${text(entry?.summary) ?? '未提供'}${currency}`)
  })
  const sourceCount = array(input.sourcePaths).length
  lines.push(sourceCount === 0 ? '附件：无' : attachmentsWillUpload
    ? `附件：${sourceCount} 个原件将先上传，再随凭证提交。`
    : `附件：${sourceCount} 个原件。`)
  lines.push('影响：仅创建凭证，不审核、过账、结账或付款。')
  return lines
}

function createJournal(value: RecordValue): string[] {
  const input = record(value.input) ?? {}
  const references = record(value.references) ?? {}
  return [
    '将新增一笔日记账，请核对：',
    `账套：${accountName(value)}`,
    `业务：${direction(input.direction)} ${text(input.amount) ?? '未提供'}`,
    `日期：${text(input.date) ?? '未提供'}`,
    `资金账户：${text(references.cashAccountName) ?? '未提供'}`,
    `收支类别：${text(references.categoryName) ?? '未设置'}`,
    `摘要：${text(input.summary) ?? '未提供'}`,
    `经手人：${text(input.keeperName) ?? '未提供'}`,
    '影响：只新增日记账记录，不执行实际收付款，也不生成凭证。',
  ]
}

function createOpenItem(value: RecordValue): string[] {
  const input = record(value.input) ?? {}
  const references = record(value.references) ?? {}
  const counterparty = record(references.counterparty) ?? {}
  return [
    `将新增一笔${direction(input.direction)}，请核对：`,
    `账套：${accountName(value)}`,
    `日期：${text(input.date) ?? '未提供'}`,
    `金额：${text(input.amount) ?? '未提供'}`,
    `往来对象：${text(counterparty.categoryName) ?? '未提供'}：${text(counterparty.itemName) ?? '未提供'}`,
    `往来账户：${text(references.accountName) ?? '未提供'}`,
    `类别：${text(references.categoryName) ?? '未提供'}`,
    `摘要：${text(input.summary) ?? '未提供'}`,
    `经手人：${text(input.keeperName) ?? '未提供'}`,
    '影响：只新增应收或应付记录，不执行收付款、核销或生成凭证。',
  ]
}

function createMasterData(value: RecordValue): string[] {
  const proposal = record(value.proposal) ?? {}
  const input = record(proposal.input) ?? {}
  if (proposal.kind === 'subject') {
    const references = record(value.references) ?? {}
    const accounting = record(references.accounting)
    const auxiliary = array(accounting?.auxiliaryCategories).map(record)
    const currencies = array(accounting?.currencies).map(record)
    const lines = [
      '将新增一个会计科目，请核对：',
      `账套：${accountName(value)}`,
      `科目：${text(input.subjectCode) ?? '未提供'} ${text(input.subjectName) ?? '未提供'}`,
      `上级科目：${input.parentCode === null ? '一级科目' : text(record(references.parent)?.name) ?? text(input.parentCode) ?? '未提供'}`,
      `科目类型：${text(input.subjectType) ?? '未提供'}`,
      `余额方向：${input.direction === 'debit' ? '借方' : '贷方'}`,
      `状态：${input.status === 'disabled' ? '停用' : '启用'}`,
    ]
    if (auxiliary.length > 0) lines.push(`辅助核算：${auxiliary.map(item => text(item?.name) ?? text(item?.code) ?? '未提供').join('、')}`)
    if (currencies.length > 0) lines.push(`外币核算：${currencies.map((item) => {
      const code = text(item?.code)
      const name = text(item?.name)
      return name === undefined ? code ?? '未提供' : code === undefined ? name : `${name}（${code}）`
    }).join('、')}`)
    if (auxiliary.length === 0 && currencies.length === 0) lines.push('核算设置：普通科目')
    lines.push('影响：只新增该科目，不修改已有资料或历史凭证。')
    return lines
  }
  return [
    '将新增一个辅助核算项目，请核对：',
    `账套：${accountName(value)}`,
    `辅助类别：${text(input.categoryCode) ?? '未提供'}`,
    `项目：${text(input.itemCode) ?? '未提供'} ${text(input.itemName) ?? '未提供'}`,
    `状态：${input.status === 'disabled' ? '停用' : '启用'}`,
    '影响：只新增该项目，不修改已有资料或历史凭证。',
  ]
}

function deleteVoucher(value: RecordValue): string[] {
  const target = record(value.detail) ?? record(value.preview) ?? value
  return [
    '将删除以下凭证，请核对：',
    `账套：${accountName(target)}`,
    `凭证：${text(target.number) ?? '未提供'}（${text(target.date) ?? '日期未提供'}）`,
    `制单人：${text(target.documentMaker) ?? '未提供'}`,
    `分录：${array(target.rows).length} 行`,
    '影响：凭证及其分录将被删除，无法自动撤销；不会执行实际收付款。原 OSS 文件不会随凭证删除。',
  ]
}

function deleteJournal(value: RecordValue): string[] {
  const target = record(value.target) ?? value
  const row = record(target.row) ?? {}
  return [
    '将删除以下日记账记录，请核对：',
    `账套：${accountName(target)}`,
    `日期：${text(row.date) ?? '未提供'}`,
    `账户：${text(row.accountName) ?? '未提供'}`,
    `业务：${text(row.income) === undefined ? `支出 ${text(row.expense) ?? '未提供'}` : `收入 ${text(row.income)}`}`,
    `摘要：${text(row.summary) ?? '未提供'}`,
    '影响：该流水将被删除并影响账户余额，无法自动撤销；不会执行实际收付款。',
  ]
}

function deleteOpenItem(value: RecordValue): string[] {
  const target = record(value.target) ?? record(value.preview) ?? value
  const row = record(target.row) ?? {}
  return [
    `将删除以下${direction(target.direction)}记录，请核对：`,
    `账套：${accountName(target)}`,
    `日期：${text(row.date) ?? '未提供'}`,
    `往来对象：${text(row.auxiliaryItemName) ?? '未提供'}`,
    `金额：${text(row.amount) ?? '未提供'}；未结余额：${text(row.balance) ?? '未提供'}`,
    `摘要：${text(row.summary) ?? '未提供'}`,
    '影响：记录可能连带影响关联对冲、核销或收入记录，无法自动撤销；只发送一次，结果不明时不会重发。',
  ]
}

function writeOffOpenItem(value: RecordValue): string[] {
  const input = record(value.input) ?? record(value.preview) ?? {}
  const target = record(value.target) ?? record(input.target) ?? {}
  const cash = record(value.cash) ?? record(input.cash) ?? {}
  const cashAccount = record(cash.cashAccount) ?? record(input.cashAccount) ?? {}
  return [
    `将整笔核销以下${direction(input.direction)}记录，请核对：`,
    `账套：${accountName(value)}`,
    `往来对象：${text(target.auxiliaryItemName) ?? '未提供'}`,
    `核销金额：${text(input.amount) ?? '未提供'} ${text(input.currencyCode) ?? ''}`.trim(),
    `核销日期：${text(input.date) ?? '未提供'}`,
    `资金账户：${text(cashAccount.name) ?? '未提供'}`,
    `经手人：${text(input.keeperName) ?? '未提供'}`,
    '影响：记录整笔已收或已付并可能生成资金流水，但不会发起银行收付款；不支持部分核销或自动反核销。',
  ]
}

/**
 * Format one verified finance write for the approval dialog without exposing internal JSON.
 * @param action - Business operation being confirmed.
 * @param value - Host-verified preview or target.
 * @param options - User-visible attachment behavior for voucher creation.
 * @returns Plain Chinese approval text containing the target and irreversible effect.
 */
export function financeApprovalReason(action: FinanceApprovalAction, value: unknown,
  options: { attachmentsWillUpload?: boolean } = {}): string {
  const parsed = record(value) ?? {}
  const lines = action === 'create-voucher' ? createVoucher(parsed, options.attachmentsWillUpload === true)
    : action === 'create-journal' ? createJournal(parsed)
      : action === 'create-open-item' ? createOpenItem(parsed)
        : action === 'create-master-data' ? createMasterData(parsed)
          : action === 'delete-voucher' ? deleteVoucher(parsed)
            : action === 'delete-journal' ? deleteJournal(parsed)
              : action === 'delete-open-item' ? deleteOpenItem(parsed) : writeOffOpenItem(parsed)
  return `${lines.join('\n')}\n请确认是否执行本次操作。`
}
