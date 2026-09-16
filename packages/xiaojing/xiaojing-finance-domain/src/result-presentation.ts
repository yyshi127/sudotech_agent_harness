/** Business-facing summaries for Finance tool cards over the model-safe result projection. */

/** Supported finance result layouts. */
export type FinanceResultPresentation =
  | 'voucher-detail'
  | 'voucher-list'
  | 'balance'
  | 'journal'
  | 'open-item'
  | 'open-item-analysis'
  | 'references'
  | 'file'
  | 'operation'

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : typeof value === 'number' ? String(value) : undefined
}

function count(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function rawText(content: unknown): string | undefined {
  if (!Array.isArray(content) || content.length !== 1) return undefined
  const block = record(content[0])
  return block?.type === 'text' ? text(block.text) : undefined
}

function businessError(value: string | undefined): string {
  if (value === undefined) return '财务操作未完成，请检查帐套连接、有成财务权限和网络后重试。'
  const normalized = value
    .replace(/^Error:\s*/u, '')
    .replace(/[（(][^）)]*[A-Za-z][^）)]*[）)]/gu, '')
    .replace(/[（(][a-z][a-z0-9_-]*[)）]/giu, '')
    .replace(/不能仅凭此错误判定是配置或有成服务故障。?/gu, '')
    .replace(/不要通过文件搜索或索取密钥代替查询。?/gu, '')
    .replace(/凭证 ID/gu, '目标凭证')
    .replace(/接口权限/gu, '有成财务权限')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/；$/u, '。')
  if (normalized === '' || /https?:\/\/|\/finance\/|[{}\[\]]|\b(?:pageSize|pageNum|rawInput|sourceQuery|fingerprint|sha256|version)\b/u.test(normalized)) {
    return '财务操作未完成，请检查帐套连接、有成财务权限和网络后重试。'
  }
  return normalized
}

function parse(content: unknown): RecordValue | undefined {
  const source = rawText(content)
  if (source === undefined) return undefined
  try { return record(JSON.parse(source)) }
  catch { return undefined }
}

function appendAccount(lines: string[], value: RecordValue): void {
  const account = record(value.account)
  const preview = record(value.preview)
  const target = record(value.target)
  const name = text(value.accountName) ?? text(account?.name) ?? text(value.ledgerName)
    ?? text(preview?.accountName) ?? text(target?.accountName)
  if (name !== undefined) lines.push(`账套：${name}`)
}

function appendExport(lines: string[], value: RecordValue): void {
  const file = record(value.exportFile) ?? record(value.file)
  const name = text(file?.name)
  const path = text(file?.path)
  if (name !== undefined) lines.push(`导出文件：${name}`)
  if (path !== undefined) lines.push(`保存位置：${path}`)
}

function period(start: unknown, end?: unknown): string | undefined {
  const from = text(start)
  const to = text(end) ?? from
  return from === undefined ? undefined : from === to ? from : `${from} 至 ${to}`
}

function voucherDetail(value: RecordValue): string[] {
  const lines: string[] = []
  appendAccount(lines, value)
  const number = text(value.number)
  const date = text(value.date)
  if (number !== undefined) lines.push(`凭证：${number}${date === undefined ? '' : `（${date}）`}`)
  lines.push(`分录：${count(value.rows) ?? 0} 行`)
  if (typeof value.audited === 'boolean') lines.push(`审核状态：${value.audited ? '已审核' : '未审核'}`)
  if (typeof value.settled === 'boolean') lines.push(`结账状态：${value.settled ? '已结账' : '未结账'}`)
  return lines
}

function voucherList(value: RecordValue): string[] {
  const report = record(value.report) ?? value
  const lines: string[] = []
  appendAccount(lines, report)
  const range = period(report.month, report.monthEnd)
  if (range !== undefined) lines.push(`查询期间：${range}`)
  lines.push(`凭证：${text(report.voucherCount) ?? '0'} 张；分录：${count(report.rows) ?? text(report.rowCount) ?? '0'} 行`)
  const page = text(report.page)
  if (page !== undefined && report.pagesRead === undefined) lines.push(`当前页：第 ${page} 页${report.hasMore === true ? '，还有下一页' : ''}`)
  appendExport(lines, value)
  appendExport(lines, report)
  return lines
}

function balance(value: RecordValue): string[] {
  const report = record(value.report) ?? value
  const lines: string[] = []
  appendAccount(lines, report)
  const range = period(report.month, report.monthEnd)
  if (range !== undefined) lines.push(`查询期间：${range}`)
  lines.push(`科目：${count(report.rows) ?? 0} 行；系统汇总：${count(report.summaries) ?? 0} 行`)
  const reconciliation = record(report.reconciliation)
  const counts = record(reconciliation?.counts)
  if (counts !== undefined) {
    lines.push(`合计核对：一致 ${text(counts.matched) ?? '0'} 列；不一致 ${text(counts.mismatch) ?? '0'} 列`)
  }
  appendExport(lines, value)
  return lines
}

function journal(value: RecordValue): string[] {
  const report = record(value.report) ?? value
  const lines: string[] = []
  appendAccount(lines, report)
  const selection = record(report.selection)
  const current = record(report.current)
  const range = current === undefined
    ? period(selection?.dateStart ?? selection?.month, selection?.dateEnd)
    : period(current.dateStart, current.dateEnd)
  if (range !== undefined) lines.push(`查询期间：${range}`)
  if (current === undefined) lines.push(`流水：${count(report.rows) ?? 0} 笔；系统汇总：${count(report.summaries) ?? 0} 行`)
  else lines.push(`流水：${count(current.rows) ?? 0} 笔；收入 ${text(current.income) ?? '未提供'}；支出 ${text(current.expense) ?? '未提供'}`)
  appendExport(lines, value)
  return lines
}

function direction(value: unknown): string | undefined {
  return value === 'receivable' ? '应收' : value === 'payable' ? '应付' : undefined
}

function openItem(value: RecordValue): string[] {
  const report = record(value.report) ?? value
  const selection = record(report.selection)
  const lines: string[] = []
  appendAccount(lines, report)
  const label = direction(selection?.direction)
  const range = period(selection?.periodStart, selection?.periodEnd)
  if (label !== undefined) lines.push(`往来方向：${label}`)
  if (range !== undefined) lines.push(`查询期间：${range}`)
  lines.push(`往来记录：${count(report.rows) ?? 0} 笔${text(report.totalCount) === undefined ? '' : `；系统返回总数：${text(report.totalCount)}`}`)
  appendExport(lines, value)
  return lines
}

function openItemAnalysis(value: RecordValue): string[] {
  const report = record(value.report) ?? value
  const selection = record(report.selection)
  const current = record(report.current)
  const lines: string[] = []
  appendAccount(lines, report)
  const label = direction(selection?.direction)
  if (label !== undefined) lines.push(`往来方向：${label}`)
  const range = period(current?.periodStart, current?.periodEnd)
  if (range !== undefined) lines.push(`查询期间：${range}`)
  lines.push(`记录：${text(current?.recordCount) ?? '0'} 笔；分组：${count(current?.groups) ?? 0} 组`)
  if (report.baseline !== undefined) lines.push(`期间差额：${count(report.differences) ?? 0} 组`)
  appendExport(lines, value)
  return lines
}

function references(value: RecordValue): string[] {
  const labels: Record<string, string> = {
    subjects: '会计科目', 'auxiliary-categories': '辅助核算类别', 'auxiliary-items': '辅助核算项目',
    'cash-accounts': '出纳账户', 'cash-categories': '收支类别',
  }
  const lines: string[] = []
  appendAccount(lines, value)
  const label = value.observations === undefined ? labels[text(value.kind) ?? ''] ?? '基础资料' : '已有往来账户'
  lines.push(`资料类型：${label}`)
  lines.push(`返回记录：${count(value.rows) ?? count(value.observations) ?? 0} 条`)
  return lines
}

function file(value: RecordValue): string[] {
  const lines = [value.action === 'archive' ? '财务文件已归档' : '财务成果已保存']
  const name = text(value.name)
  const path = text(value.path)
  if (name !== undefined) lines.push(`文件：${name}`)
  if (path !== undefined) lines.push(`位置：${path}`)
  return lines
}

function phase(value: RecordValue): string {
  const execution = record(value.execution)
  const executionState = text(execution?.state)
  const state = executionState === 'unavailable' || executionState === 'requires-confirmation'
    ? executionState
    : text(value.phase) ?? text(record(value.outcome)?.state) ?? executionState
  if (state === 'prepared' || state === 'requires-confirmation') return '已准备，等待确认'
  if (state === 'accepted') return value.complete === true ? '已完成并核对' : '已提交，核对尚未完成'
  if (state === 'outcome-unknown') return '结果待确认，请勿重复操作'
  if (state === 'rejected' || state === 'denied') return '系统未接受本次操作'
  if (state === 'not-sent' || state === 'cancelled') return '未发送'
  if (state === 'unavailable') return '当前条件不足，未执行'
  if (state === 'recorded') return '操作记录已保存'
  return value.complete === true ? '已完成并核对' : '结果已返回'
}

function operation(value: RecordValue): string[] {
  const lines: string[] = []
  appendAccount(lines, value)
  lines.push(`状态：${phase(value)}`)
  const proposal = record(value.proposal)
  const preview = record(value.preview)
  const target = record(value.target)
  const candidate = record(value.input) ?? record(proposal?.input) ?? record(preview?.row)
    ?? record(preview?.target) ?? record(target?.row) ?? preview ?? target
  const label = direction(candidate?.direction ?? preview?.direction)
  if (label !== undefined) lines.push(`业务类型：${label}`)
  const date = text(candidate?.date)
  if (date !== undefined) lines.push(`日期：${date}`)
  const summary = text(candidate?.summary) ?? text(candidate?.abstractStr)
  if (summary !== undefined) lines.push(`摘要：${summary}`)
  const amount = text(candidate?.amount) ?? text(candidate?.money)
  if (amount !== undefined) lines.push(`金额：${amount}`)
  const totalDebit = text(value.totalDebit)
  const totalCredit = text(value.totalCredit)
  if (totalDebit !== undefined || totalCredit !== undefined) lines.push(`借方合计：${totalDebit ?? '未提供'}；贷方合计：${totalCredit ?? '未提供'}`)
  const execution = record(value.execution)
  const reason = text(execution?.reason)
  if (reason !== undefined && execution?.state === 'unavailable') lines.push(`原因：${businessError(reason)}`)
  return lines
}

/**
 * Replace raw finance JSON in a completed UI card with a compact business summary.
 * @param content - Model-safe tool content.
 * @param isError - Whether execution failed; failures retain business-readable guidance.
 * @param presentation - Result layout selected by the owning tool.
 * @returns UI-only content blocks; the Host retains the complete internal record separately.
 */
export function financeResultContent(content: unknown, isError: boolean,
  presentation: FinanceResultPresentation): { type: 'text'; text: string }[] {
  if (isError) {
    return [{ type: 'text', text: businessError(rawText(content)) }]
  }
  const value = parse(content)
  if (value === undefined) return [{ type: 'text', text: '财务结果已返回，小兢会计将根据结果继续处理。' }]
  const lines = presentation === 'voucher-detail' ? voucherDetail(value)
    : presentation === 'voucher-list' ? voucherList(value)
      : presentation === 'balance' ? balance(value)
        : presentation === 'journal' ? journal(value)
          : presentation === 'open-item' ? openItem(value)
            : presentation === 'open-item-analysis' ? openItemAnalysis(value)
              : presentation === 'references' ? references(value)
                : presentation === 'file' ? file(value) : operation(value)
  return [{ type: 'text', text: lines.join('\n') }]
}
