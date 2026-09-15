/** XLSX serialization of Host-produced open-item reports; external values are never formulas. */
import { createHash } from 'node:crypto'
import writeExcelFile, { type Row } from 'write-excel-file/node'
import type { OpenItemAggregate, OpenItemAnalysisResult } from './open-item-analysis.ts'

import { workbookRow as row } from './workbook-row.ts'

/**
 * Serialize a completed backend report without recomputing amounts or accepting model-authored rows.
 * @param report - Host-produced, count-reconciled report with its original query and limitations.
 * @returns XLSX bytes; money and identifiers remain exact text, including values beginning with equals.
 */
export async function openItemWorkbook(report: OpenItemAnalysisResult): Promise<Buffer> {
  const digest = createHash('sha256').update(JSON.stringify(report)).digest('hex')
  const metadata: Row[] = [
    row('项目', '值'), row('账套 ID', report.accountId), row('账套名称', report.accountName),
    row('方向', report.selection.direction), row('分组', report.selection.groupBy),
    row('完整性', report.coverage), row('结果 SHA256', digest), row('限制', report.notice),
    row('金额格式', '金额以精确文本保存，不是 Excel 数值；不可直接使用 SUM 当作已验证合计。'),
    row('来源', '/finance/cashjournal/getCashierList；后端逐页查询并按原币分组'),
  ]
  const groups: Row[] = [row('查询组', '开始期间', '结束期间', '币种', '分组 ID', '分组名称', '金额（文本）', '余额（文本）')]
  const sources: Row[] = [row('查询组', '币种', '分组 ID', '来源记录 ID')]
  const append = (label: string, aggregate: OpenItemAggregate): void => {
    metadata.push(row(`${label}期间`, `${aggregate.periodStart} 至 ${aggregate.periodEnd}`),
      row(`${label}记录数`, String(aggregate.recordCount)), row(`${label}读取页数`, String(aggregate.pagesRead)))
    for (const group of aggregate.groups) {
      groups.push(row(label, aggregate.periodStart, aggregate.periodEnd, group.currencyCode,
        group.dimensionId, group.dimensionName, group.amount, group.balance))
      for (const id of group.recordIds) sources.push(row(label, group.currencyCode, group.dimensionId, id))
    }
  }
  append('当前', report.current)
  if (report.baseline) append('基准', report.baseline)
  const differences: Row[] = [row('币种', '分组 ID', '金额差额（文本）', '余额差额（文本）')]
  for (const difference of report.differences ?? []) {
    differences.push(row(difference.currencyCode, difference.dimensionId, difference.amount, difference.balance))
  }
  return writeExcelFile([
    { sheet: '查询说明', data: metadata }, { sheet: '分组结果', data: groups },
    { sheet: '来源记录', data: sources },
    ...(report.baseline ? [{ sheet: '期间差额', data: differences }] : []),
  ]).toBuffer()
}
